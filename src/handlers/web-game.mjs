/**
 * Web-app game endpoints — let the React /play UI act as a first-class
 * client alongside the Slack home tab.
 *
 *   GET  /games/me        → round info for the authenticated user vs the live game
 *   POST /games/join      → join the live game
 *   POST /scores          → submit a hand score (with optional `chosen` for multi-option flow)
 *
 * All require a Bearer JWT issued by /auth/slack/callback.
 */
import * as db from "../lib/db.mjs";
import { verifyJwt } from "../lib/jwt.mjs";
import { getScoreOptions } from "../lib/cards.mjs";
import { validateWords } from "../lib/dictionary.mjs";
import { findCurrentRound } from "../lib/home.mjs";
import { invokeScoreWorker } from "./score-entry.mjs";

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
    if (method === "POST" && path === "/games/join") return await joinLive(userId);
    if (method === "POST" && path === "/scores") return await submitScore(userId, event);

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

  const refreshed = await db.getGame(game.game_id);
  const scores = await db.getScoresForGame(game.game_id);
  const round = findCurrentRound(scores, userId, refreshed);
  return jsonResp(200, { game: refreshed, scores, round, joined: true });
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
  const { options, invalid, tooShort } = getScoreOptions(wordsInput, maxCards);

  if (invalid.length) {
    return jsonResp(400, { error: `Invalid cards: ${invalid.join(", ")}` });
  }
  if (tooShort?.length) {
    return jsonResp(400, { error: `Every word must use at least 2 cards: ${tooShort.join(", ")}` });
  }
  if (!options.length) {
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
