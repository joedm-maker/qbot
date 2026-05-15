/**
 * Web-app game endpoints — let the React /play UI act as a first-class
 * client alongside the Slack home tab.
 *
 *   GET  /games/me        → round info for the authenticated user vs the live game
 *   POST /games/join      → join the live game
 *   POST /games/mulligan  → take a mulligan
 *   POST /games/drop      → leave the current game
 *   POST /games/finish    → host ends the game early (final standings + COMPLETE)
 *   POST /scores          → submit a hand score (with optional `chosen` for multi-option flow)
 *   POST /votes/start     → start a vote on dictionary-rejected words
 *
 * All require a Bearer JWT issued by /auth/slack/callback.
 */
import * as db from "../lib/db.mjs";
import { verifyJwt } from "../lib/jwt.mjs";
import { getScoreOptions } from "../lib/cards.mjs";
import { validateWords } from "../lib/dictionary.mjs";
import { findCurrentRound } from "../lib/home.mjs";
import { dealFromPool, filterOptionsAgainstDealt } from "../lib/autoq-deck.mjs";
import { invokeScoreWorker, finalizeGame } from "./score-entry.mjs";
import { createNewGame, findActiveGameForUser, notifyRegulars, postLobbyMessage } from "./game-flow.mjs";
import { deleteQuicklerTimer } from "../lib/quickler.mjs";
import { startWordVote } from "../lib/vote.mjs";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

export async function handleWebGameRequest(event) {
  try {
    const userId = authUserId(event);
    if (!userId) return jsonResp(401, { error: "Unauthorized" });

    const path = event.path;
    const method = event.httpMethod;

    if (method === "GET" && path === "/games/me") return await getMe(userId);
    if (method === "POST" && path === "/games/create") return await createGame(userId, event);
    if (method === "POST" && path === "/games/join") return await joinLive(userId);
    if (method === "POST" && path === "/games/mulligan") return await takeMulligan(userId, event);
    if (method === "POST" && path === "/games/drop") return await dropFromGame(userId, event);
    if (method === "POST" && path === "/games/finish") return await finishGameEarly(userId, event);
    if (method === "POST" && path === "/scores") return await submitScore(userId, event);
    if (method === "POST" && path === "/votes/start") return await startVote(userId, event);

    return jsonResp(404, { error: "Not found" });
  } catch (err) {
    console.error("web-game error:", err);
    return jsonResp(500, { error: err.message });
  }
}

function authUserId(event) {
  const auth = event.headers?.Authorization || event.headers?.authorization;
  if (!auth?.startsWith("Bearer ")) return null;
  const claims = verifyJwt(auth.slice("Bearer ".length), process.env.SESSION_SECRET);
  return claims?.sub || null;
}

async function getLiveGame() {
  // Active games are always today's (or yesterday's at the latest) so the
  // date-indexed query is cheaper than a full scan and catches the same thing.
  const games = await db.getRecentGames();
  const active = (games || []).filter((g) => g.status === "OPEN" || g.status === "ACTIVE");
  if (!active.length) return null;
  return active.sort((a, b) => (b.game_number || 0) - (a.game_number || 0))[0];
}

async function getMe(userId) {
  const game = await getLiveGame();
  if (!game) return jsonResp(200, { game: null });

  const inGame = game.players.includes(userId);
  if (!inGame) {
    return jsonResp(200, { game: { game_id: game.game_id, game_number: game.game_number, status: game.status, game_type: game.game_type, players: game.players }, joined: false });
  }

  const scores = await db.getScoresForGame(game.game_id);
  const round = findCurrentRound(scores, userId, game);
  return jsonResp(200, { game, scores, round, joined: true });
}

async function joinLive(userId) {
  const game = await getLiveGame();
  if (!game) return jsonResp(404, { error: "No live game" });
  if (game.status !== "OPEN" && game.status !== "ACTIVE") {
    return jsonResp(400, { error: `Game is ${game.status}` });
  }
  if (game.players.includes(userId)) return jsonResp(200, { game, joined: true, alreadyJoined: true });

  // Determine the player's start hand the same way game-flow.joinGame does
  let startHand = 3;
  if (game.status === "ACTIVE") {
    const scores = await db.getScoresForGame(game.game_id);
    for (let h = 3; h <= 10; h++) {
      const eligibleCount = game.players.filter(
        (pid) => (game.player_start_hands?.[pid] || 3) <= h
      ).length;
      const handScores = scores.filter((s) => s.hand === h);
      if (handScores.length < eligibleCount) { startHand = h; break; }
      startHand = h + 1;
    }
    if (startHand > 10) return jsonResp(400, { error: "Game is past its last hand" });
  }

  await db.addPlayerToGame(game.game_id, userId);
  await db.setPlayerStartHand(game.game_id, userId, startHand);

  // Digital deck: deal cards for the joiner's current hand
  if (game.deck_type === "Digital") {
    const seen = game.player_seen_cards?.[userId] || [];
    const { cards, shortBy } = dealFromPool(seen, startHand);
    if (shortBy > 0) {
      return jsonResp(409, { error: `Deck depleted — only ${cards.length} card${cards.length === 1 ? "" : "s"} left, need ${startHand} for Hand ${startHand}.` });
    }
    await db.recordDeal(game.game_id, userId, startHand, cards);
  }

  const refreshed = await db.getGame(game.game_id);
  const scores = await db.getScoresForGame(game.game_id);
  const round = findCurrentRound(scores, userId, refreshed);
  return jsonResp(200, { game: refreshed, scores, round, joined: true });
}

async function createGame(userId, event) {
  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { return jsonResp(400, { error: "Invalid JSON" }); }
  const gameType = body.game_type;
  if (gameType !== "QBIM" && gameType !== "Quickler") {
    return jsonResp(400, { error: "game_type must be QBIM or Quickler" });
  }
  const deckType = body.deck_type === "Digital" ? "Digital" : "Physical";
  // Match the Slack qbim_start_game_submit guard — one active game per user.
  const existing = await findActiveGameForUser(userId);
  if (existing) {
    return jsonResp(409, { error: `You already have an active game (#${existing.game_number}). Leave or end it first.` });
  }
  const game = await createNewGame(userId, gameType, deckType);
  // Slack-side fanout (DM host + notify regulars) — best-effort, doesn't gate
  // the web response.
  postLobbyMessage(game).catch((err) => console.warn("postLobbyMessage:", err.message));
  notifyRegulars(game).catch((err) => console.warn("notifyRegulars:", err.message));
  return jsonResp(200, { game });
}

async function dropFromGame(userId, event) {
  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { return jsonResp(400, { error: "Invalid JSON" }); }
  const { game_id } = body;
  if (!game_id) return jsonResp(400, { error: "game_id required" });

  const game = await db.getGame(game_id);
  if (!game) return jsonResp(404, { error: "Game not found" });
  if (!game.players.includes(userId)) return jsonResp(400, { error: "You're not in this game" });

  // If dropping closes out the active Quickler hand, clean up the timer first.
  if (game.quickler_timer_schedule_name) {
    const tHand = game.quickler_timer_hand;
    const handScores = await db.getScoresForGameHand(game_id, tHand);
    const startHands = game.player_start_hands || {};
    const eligible = game.players.filter((pid) => pid !== userId && (startHands[pid] || 3) <= tHand);
    const submitted = handScores.filter((s) => s.player_slack_id !== userId);
    if (submitted.length >= eligible.length) {
      try { await deleteQuicklerTimer(game.quickler_timer_schedule_name); } catch (err) { console.warn("Timer cleanup:", err.message); }
      await db.updateGameAttr(game_id, { quickler_timer_started_at: null, quickler_timer_hand: null, quickler_timer_schedule_name: null });
    }
  }

  await db.removePlayerFromGame(game_id, userId);
  const updated = await db.getGame(game_id);

  if (!updated.players || updated.players.length === 0) {
    if (updated.quickler_timer_schedule_name) {
      try { await deleteQuicklerTimer(updated.quickler_timer_schedule_name); } catch (err) { console.warn("Timer cleanup:", err.message); }
    }
    await db.updateGameStatus(game_id, "COMPLETE", { completed_at: new Date().toISOString() });
  } else {
    // Award stars on any hands that just became complete (one less eligible player)
    const scores = await db.getScoresForGame(game_id);
    const startHands = updated.player_start_hands || {};
    for (let h = 3; h <= 10; h++) {
      const eligible = updated.players.filter((pid) => (startHands[pid] || 3) <= h);
      const handScores = scores.filter((s) => s.hand === h);
      const allZeroStars = handScores.every((s) => (s.stars || 0) === 0);
      if (handScores.length >= eligible.length && handScores.length > 0 && allZeroStars) {
        const { autoAwardStars } = await import("./score-entry.mjs");
        await autoAwardStars(updated, h, handScores, true);
      }
    }
  }

  return jsonResp(200, { dropped: true });
}

async function finishGameEarly(userId, event) {
  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { return jsonResp(400, { error: "Invalid JSON" }); }
  const { game_id } = body;
  if (!game_id) return jsonResp(400, { error: "game_id required" });

  const game = await db.getGame(game_id);
  if (!game) return jsonResp(404, { error: "Game not found" });
  if (game.host_slack_id !== userId) return jsonResp(403, { error: "Only the host can end the game" });
  if (game.status === "COMPLETE") return jsonResp(400, { error: "Game already complete" });

  if (game.quickler_timer_schedule_name) {
    try { await deleteQuicklerTimer(game.quickler_timer_schedule_name); } catch (err) { console.warn("Timer cleanup:", err.message); }
  }

  // finalizeGame handles status→COMPLETE, final-leaderboard DM, stats update, home refresh
  await finalizeGame(game_id);
  return jsonResp(200, { finished: true });
}

async function startVote(userId, event) {
  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { return jsonResp(400, { error: "Invalid JSON" }); }
  const { game_id, hand, words, invalid_words, button_pressed_at } = body;
  if (!game_id || !Number.isInteger(hand)) return jsonResp(400, { error: "game_id and hand required" });

  const game = await db.getGame(game_id);
  if (!game) return jsonResp(404, { error: "Game not found" });
  if (!game.players.includes(userId)) return jsonResp(403, { error: "Not in this game" });

  try {
    const vote = await startWordVote({ userId, game_id, hand, words, invalid_words, button_pressed_at });
    return jsonResp(200, { vote_id: vote.vote_id, voters: vote.voters });
  } catch (err) {
    return jsonResp(400, { error: err.message });
  }
}

async function takeMulligan(userId, event) {
  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { return jsonResp(400, { error: "Invalid JSON" }); }
  const { game_id, hand } = body;
  if (!game_id || !Number.isInteger(hand) || hand < 3 || hand > 10) {
    return jsonResp(400, { error: "game_id and hand (3-10) required" });
  }
  const game = await db.getGame(game_id);
  if (!game) return jsonResp(404, { error: "Game not found" });
  if (game.status !== "OPEN" && game.status !== "ACTIVE") {
    return jsonResp(400, { error: `Game is ${game.status}` });
  }
  if (!game.players.includes(userId)) {
    return jsonResp(403, { error: "Join the game first" });
  }
  const ok = await db.tryAddMulligan(game_id, userId, hand);
  if (!ok) {
    return jsonResp(400, { error: "Can't take another mulligan — would drop below the 2-card minimum (or you just took one)." });
  }
  // Digital deck: re-deal with one fewer card. The discarded hand is already
  // in player_seen_cards (added when first dealt), so dealFromPool naturally
  // excludes it; previous mulligan discards stay excluded too. The pool can
  // be depleted across many mulligans — by design.
  if (game.deck_type === "Digital") {
    const mulligans = await db.getMulliganCount(game_id, userId, hand);
    const cardCount = hand - mulligans;
    const refreshed = await db.getGame(game_id);
    const seen = refreshed.player_seen_cards?.[userId] || [];
    const { cards, shortBy } = dealFromPool(seen, cardCount);
    if (shortBy > 0) {
      return jsonResp(409, { error: `Deck depleted — only ${cards.length} card${cards.length === 1 ? "" : "s"} left, need ${cardCount}.` });
    }
    await db.recordDeal(game_id, userId, hand, cards);
  }
  const refreshed = await db.getGame(game_id);
  const scores = await db.getScoresForGame(game_id);
  const round = findCurrentRound(scores, userId, refreshed);
  return jsonResp(200, { round });
}

async function submitScore(userId, event) {
  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { return jsonResp(400, { error: "Invalid JSON" }); }
  const { game_id, hand, words, chosen, button_pressed_at } = body;
  if (!game_id || !Number.isInteger(hand) || hand < 3 || hand > 10) {
    return jsonResp(400, { error: "game_id and hand (3-10) required" });
  }

  const game = await db.getGame(game_id);
  if (!game) return jsonResp(404, { error: "Game not found" });
  if (game.status !== "OPEN" && game.status !== "ACTIVE") {
    return jsonResp(400, { error: `Game is ${game.status}` });
  }
  if (!game.players.includes(userId)) {
    return jsonResp(403, { error: "Join the game before submitting" });
  }

  const wordsInput = (words || "").trim();

  // Empty submission = 0 points (matches Slack behavior; deliberate blank rule).
  // Fire-and-forget the worker so the web caller doesn't wait for the Slack
  // home-tab fanout — polling /games/me catches the saved state within ~2s.
  if (!wordsInput) {
    await invokeScoreWorker({
      mode: "regular", userId, game_id, hand, wordsInput: "",
      chosen: { score: 0, cards: 0, breakdown: "—" },
      buttonPressedAt: button_pressed_at, validated: true,
    });
    return jsonResp(200, { status: "submitted", raw_score: 0, breakdown: "—", words: "" });
  }

  const mulligans = await db.getMulliganCount(game_id, userId, hand);
  const maxCards = hand - mulligans;

  // Digital games filter options to those actually formable from the player's
  // dealt cards; Physical games fall back to the cards-count check.
  let options, invalid, tooShort;
  const dealtCards = game.deck_type === "Digital" ? game.dealt_cards?.[`${userId}#${hand}`] : null;
  if (dealtCards) {
    ({ options, invalid, tooShort } = filterOptionsAgainstDealt(wordsInput, maxCards, dealtCards));
  } else {
    ({ options, invalid, tooShort } = getScoreOptions(wordsInput, maxCards));
  }

  if (invalid.length) {
    return jsonResp(400, { error: `Invalid cards: ${invalid.join(", ")}` });
  }
  if (tooShort?.length) {
    return jsonResp(400, { error: `Every word must use at least 2 cards: ${tooShort.join(", ")}` });
  }
  if (!options.length) {
    if (dealtCards) {
      return jsonResp(400, { error: `Those words can't be formed from your dealt cards: ${dealtCards.join(" ")}` });
    }
    return jsonResp(400, { error: `Too many cards for Hand ${hand}${mulligans > 0 ? ` with ${mulligans} mulligan${mulligans > 1 ? "s" : ""}` : ""} (max ${maxCards} cards).` });
  }

  // Dictionary validation — sync so the user gets an inline error before commit
  const dictCheck = await validateWords(wordsInput);
  if (dictCheck.invalid.length) {
    return jsonResp(200, {
      status: "dictionary_rejected",
      invalid: dictCheck.invalid.map((w) => w.word || w),
    });
  }

  // Multiple readings — caller must pick one
  if (options.length > 1 && !chosen) {
    return jsonResp(200, { status: "choice_required", options });
  }

  const chosenOption = chosen || options[0];
  await invokeScoreWorker({
    mode: "regular", userId, game_id, hand, wordsInput,
    chosen: chosenOption, buttonPressedAt: button_pressed_at, validated: true,
  });
  return jsonResp(200, {
    status: "submitted",
    raw_score: chosenOption.score,
    breakdown: chosenOption.breakdown,
    words: wordsInput,
  });
}

function jsonResp(statusCode, body) {
  return { statusCode, headers: { ...CORS, "Content-Type": "application/json" }, body: JSON.stringify(body) };
}
