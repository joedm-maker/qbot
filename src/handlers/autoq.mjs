/**
 * AutoQ handler — single-player Quiddler variant.
 *
 * Actions: autoq_start, autoq_open_hand_modal, autoq_mulligan, autoq_quit
 * Views: autoq_start_submit, autoq_submit_score, autoq_confirm_score
 */
import crypto from "node:crypto";
import { verifySlackSignature, parseSlackBody } from "../lib/verify.mjs";
import { slack } from "../lib/slack.mjs";
import { getHandRange } from "../lib/cards.mjs";
import { dealForHand, filterOptionsAgainstDealt } from "../lib/autoq-deck.mjs";
import { pickRandomBotNames, selectBotPlays, loadHistoricalScores, buildPool } from "../lib/autoq-bots.mjs";
import { QUIDDLER_DECK } from "../lib/autoq-deck.mjs";
import * as autoqDb from "../lib/autoq-db.mjs";
import * as autoqBlocks from "../lib/autoq-blocks.mjs";
import { renderHome } from "../lib/home.mjs";

// Lazy Lambda client for invoking the score worker async
let _lambda;
async function invokeScoreWorker(payload) {
  const functionName = process.env.SCORE_WORKER_FUNCTION_NAME;
  if (!functionName) {
    console.warn("SCORE_WORKER_FUNCTION_NAME not set; cannot invoke worker");
    return;
  }
  const { LambdaClient, InvokeCommand } = await import("@aws-sdk/client-lambda");
  if (!_lambda) _lambda = new LambdaClient({});
  await _lambda.send(new InvokeCommand({
    FunctionName: functionName,
    InvocationType: "Event",
    Payload: Buffer.from(JSON.stringify(payload)),
  }));
}

export async function handler(event) {
  const { raw, parsed } = parseSlackBody(event.body, event.isBase64Encoded);

  if (!verifySlackSignature(process.env.SLACK_SIGNING_SECRET, event.headers, raw)) {
    return respond(401, { error: "Invalid signature" });
  }

  try {
    if (parsed.type === "block_actions") {
      await handleAction(parsed);
      return respond(200);
    }

    if (parsed.type === "view_submission") {
      return await handleViewSubmission(parsed);
    }

    return respond(200);
  } catch (err) {
    console.error("autoq error:", err);
    return respond(200);
  }
}

// ── Actions ────────────────────────────────────────────

async function handleAction(payload) {
  const action = payload.actions[0];
  const userId = payload.user.id;

  switch (action.action_id) {
    case "autoq_start": {
      await slack().views.open({
        trigger_id: payload.trigger_id,
        view: autoqBlocks.autoqStartModal(),
      });
      break;
    }

    case "autoq_open_hand_modal": {
      const [gameId, handStr] = action.value.split("|");
      const hand = Number(handStr);
      const game = await autoqDb.getAutoQGame(gameId);
      if (!game) return;
      const dealtCards = game.dealt_hands?.[String(hand)]?.[0];
      if (!dealtCards) return;
      const buttonPressedAt = action.action_ts || null;
      await slack().views.open({
        trigger_id: payload.trigger_id,
        view: autoqBlocks.autoqHandScoreModal(gameId, hand, dealtCards, buttonPressedAt),
      });
      break;
    }

    case "autoq_retry_hand": {
      let retryMeta;
      try { retryMeta = JSON.parse(action.value); } catch { return; }
      const { game_id, hand, words, dealt_cards } = retryMeta;
      if (!game_id || !dealt_cards) return;
      const buttonPressedAt = action.action_ts || null;
      await slack().views.open({
        trigger_id: payload.trigger_id,
        view: autoqBlocks.autoqHandScoreModal(game_id, hand, dealt_cards, buttonPressedAt, words || ""),
      });
      break;
    }

    case "autoq_quit": {
      const gameId = action.value;
      console.log("autoq_quit triggered, gameId:", gameId, "userId:", userId);
      try {
        await autoqDb.updateAutoQGame(gameId, {
          status: "ABANDONED",
          current_hand: null,
          completed_at: new Date().toISOString(),
        });
        console.log("autoq_quit: game updated successfully");
      } catch (err) {
        console.error("autoq_quit: update failed:", err);
      }
      await renderHome(userId);
      break;
    }

    case "autoq_mulligan": {
      const [gameId, handStr] = action.value.split("|");
      const hand = Number(handStr);
      const game = await autoqDb.getAutoQGame(gameId);
      if (!game) return;
      const currentCount = game.mulligans?.[String(hand)] || 0;
      const currentCards = game.dealt_hands?.[String(hand)]?.[0] || [];
      const newSize = currentCards.length - 1;
      if (newSize < 1) break; // can't mulligan below 1 card

      // Collect cards to exclude: player's current hand + all previous mulligan hands
      const excluded = [...currentCards];
      const prevExcluded = game.mulligan_excluded?.[String(hand)] || [];
      excluded.push(...prevExcluded);

      // Also exclude cards used by bots in their plays
      const botPlays = game.bot_plays?.[String(hand)] || [];
      for (const bp of botPlays) {
        if (!bp.breakdown) continue;
        const botCards = bp.breakdown.split(/\s+/).flatMap((w) =>
          w.split("-").filter(Boolean).map((c) => c.toUpperCase())
        );
        excluded.push(...botCards);
      }

      // Build remaining pool and deal new hand
      const { buildPool } = await import("../lib/autoq-bots.mjs");
      const { QUIDDLER_DECK, shuffleDeck } = await import("../lib/autoq-deck.mjs");
      const pool = buildPool(QUIDDLER_DECK);
      for (const c of excluded) {
        pool.set(c, Math.max(0, (pool.get(c) || 0) - 1));
      }
      // Flatten pool back to an array and shuffle
      const remaining = [];
      for (const [card, count] of pool) {
        for (let i = 0; i < count; i++) remaining.push(card);
      }
      shuffleDeck(remaining);
      const newCards = remaining.slice(0, newSize);

      // Update game state
      const dealtHands = { ...game.dealt_hands };
      dealtHands[String(hand)] = [newCards];
      const mulligans = { ...game.mulligans, [String(hand)]: currentCount + 1 };
      const mulliganExcluded = { ...(game.mulligan_excluded || {}), [String(hand)]: [...prevExcluded, ...currentCards] };

      await autoqDb.updateAutoQGame(gameId, {
        dealt_hands: dealtHands,
        mulligans,
        mulligan_excluded: mulliganExcluded,
      });
      await renderHome(userId);
      break;
    }
  }
}

// ── View Submissions ──────────────────────────────────

async function handleViewSubmission(payload) {
  const callbackId = payload.view.callback_id;
  const userId = payload.user.id;

  if (callbackId === "autoq_start_submit") {
    const opponentCount = Number(
      payload.view.state.values.opponent_count_block.opponent_count.selected_option.value
    );
    await createAutoQGame(userId, opponentCount);
    await renderHome(userId);
    return respond(200, { response_action: "clear" });
  }

  if (callbackId === "autoq_submit_score") {
    return await submitScore(payload);
  }

  if (callbackId === "autoq_confirm_score") {
    return await confirmScore(payload);
  }

  return respond(200);
}

// ── Game Creation ─────────────────────────────────────

async function createAutoQGame(userId, opponentCount) {
  const gameId = crypto.randomUUID();
  const botNames = opponentCount > 0 ? pickRandomBotNames(opponentCount) : [];
  const hands = getHandRange("AutoQ");

  // Load historical scores once for all bot play selection
  const allScores = opponentCount > 0 ? await loadHistoricalScores() : [];

  // Pre-deal cards to human only, bots pick from remaining deck
  const dealtHands = {};
  const botPlays = {};

  for (const hand of hands) {
    // Deal only to the human player (index 0)
    const dealt = dealForHand(1, hand + 3);
    dealtHands[String(hand)] = dealt; // dealt[0] = human's cards

    // Bot plays: pick random historical hands, validated against remaining deck
    if (opponentCount > 0) {
      const remainingPool = buildPool(QUIDDLER_DECK);
      // Remove human's cards from the pool
      for (const c of dealt[0]) {
        remainingPool.set(c, (remainingPool.get(c) || 0) - 1);
      }
      botPlays[String(hand)] = selectBotPlays(opponentCount, hand, remainingPool, allScores);
    }
  }

  const game = {
    game_id: gameId,
    player_id: userId,
    status: "ACTIVE",
    current_hand: hands[0],
    opponent_count: opponentCount,
    bot_names: botNames,
    dealt_hands: dealtHands,
    bot_plays: botPlays,
    mulligans: {},
    created_at: new Date().toISOString(),
  };

  await autoqDb.createAutoQGame(game);
  return game;
}

// ── Score Submission ──────────────────────────────────

async function submitScore(payload) {
  const userId = payload.user.id;
  let meta;
  try { meta = JSON.parse(payload.view.private_metadata); } catch { return respond(200); }
  const { game_id, hand, dealt_cards } = meta;

  const wordsInput = payload.view.state.values.words_block.words.value || "";

  // Empty submission = 0 points
  if (!wordsInput.trim()) {
    await saveAutoQScore(userId, game_id, hand, "", { score: 0, cards: 0, breakdown: "" }, dealt_cards);
    await renderHome(userId);
    return respond(200, { response_action: "clear" });
  }

  const game = await autoqDb.getAutoQGame(game_id);
  if (!game) return respond(200);

  // Max playable cards = hand - mulligans, minimum 2
  const mulligans = game.mulligans?.[String(hand)] || 0;
  const maxCards = Math.max(2, hand - mulligans);

  // Filter options against dealt cards
  const { options, invalid } = filterOptionsAgainstDealt(wordsInput, maxCards, dealt_cards);

  if (invalid.length) {
    return validationError("words_block", `Invalid cards: ${invalid.join(", ")}`);
  }

  if (options.length === 0) {
    // Distinguish: too many cards vs wrong cards
    const { getScoreOptions } = await import("../lib/cards.mjs");
    const unconstrained = getScoreOptions(wordsInput, maxCards);
    if (unconstrained.options.length === 0) {
      return validationError("words_block", `Too many cards — you can only play ${maxCards} cards this hand.`);
    }
    return validationError("words_block", "Those cards aren't in your dealt hand.");
  }

  if (options.length === 1) {
    // Fire-and-forget async: validate + save in the worker, respond immediately
    await invokeScoreWorker({
      mode: "autoq",
      userId, game_id, hand, wordsInput,
      chosen: options[0], dealtCards: dealt_cards,
    });
    return respond(200, { response_action: "clear" });
  }

  // Multiple options — show choice modal (dictionary check happens on confirm)
  return respond(200, {
    response_action: "update",
    view: autoqBlocks.autoqScoreChoiceModal(game_id, hand, wordsInput, options, dealt_cards, meta.button_pressed_at),
  });
}

async function confirmScore(payload) {
  const userId = payload.user.id;
  let meta;
  try { meta = JSON.parse(payload.view.private_metadata); } catch { return respond(200); }
  const { game_id, hand, words, dealt_cards } = meta;

  const chosen = JSON.parse(
    payload.view.state.values.score_choice_block.score_choice.selected_option.value
  );

  await invokeScoreWorker({
    mode: "autoq",
    userId, game_id, hand, wordsInput: words,
    chosen, dealtCards: dealt_cards,
  });
  return respond(200, { response_action: "clear" });
}

export async function saveAutoQScore(userId, gameId, hand, wordsInput, chosen, dealtCards) {
  const game = await autoqDb.getAutoQGame(gameId);
  if (!game) return;

  // Guard against double submission
  if (game.current_hand !== hand) return;

  // Parse word count and longest word letters
  const wordTokens = wordsInput ? wordsInput.replace(/[\s,+]+/g, " ").trim().split(" ").filter(Boolean) : [];
  const wordCount = wordTokens.length;

  let longestWordLetters = 0;
  for (const w of wordTokens) {
    const letters = w.replace(/[-]/g, "").length;
    if (letters > longestWordLetters) longestWordLetters = letters;
  }

  // Build hand score data
  const playerScore = {
    hand,
    player_id: userId,
    words: wordsInput,
    raw_score: chosen.score,
    word_count: wordCount,
    longest_word_letters: longestWordLetters,
    breakdown: chosen.breakdown,
    dealt_cards: dealtCards,
    submitted_at: new Date().toISOString(),
  };

  // Calculate stars
  const starResult = calculateAutoQStars(playerScore, game.bot_plays?.[String(hand)] || [], game.opponent_count, game.bot_names || []);
  playerScore.stars = starResult.playerStars;
  playerScore.star_longest_word = starResult.playerLongest;
  playerScore.star_most_words = starResult.playerMost;
  playerScore.star_summary = starResult.summary;
  playerScore.is_personal_best = false;

  // Bot scores with stars
  const botScoresWithStars = (game.bot_plays?.[String(hand)] || []).map((bp, i) => ({
    name: game.bot_names[i],
    words: bp.words,
    raw_score: bp.raw_score,
    word_count: bp.word_count,
    longest_word_letters: bp.longest_word_letters,
    stars: starResult.botStars[i] || 0,
  }));
  playerScore.bot_scores = botScoresWithStars;

  // Check personal best for this hand
  const pbResult = await autoqDb.updatePersonalBest(userId, hand, chosen.score, wordsInput);
  playerScore.is_personal_best = pbResult;

  // Save hand score (after PB check so is_personal_best is accurate)
  await autoqDb.putAutoQHandScore(gameId, hand, playerScore);

  // Advance to next hand or complete game
  const hands = getHandRange("AutoQ");
  const currentIdx = hands.indexOf(hand);

  if (currentIdx < hands.length - 1) {
    // Advance to next hand
    await autoqDb.updateAutoQGame(gameId, { current_hand: hands[currentIdx + 1] });
  } else {
    // Game complete — calculate total and check total personal best
    const allHandScores = await autoqDb.getAutoQHandScores(gameId);
    let totalScore = 0;
    let totalStars = 0;
    for (const hs of allHandScores) {
      totalScore += hs.raw_score || 0;
      totalStars += hs.stars || 0;
    }
    // Include current hand (might not be in query yet due to eventual consistency)
    if (!allHandScores.find((hs) => hs.hand === hand)) {
      totalScore += chosen.score;
      totalStars += starResult.playerStars;
    }

    const finalTotal = totalScore + totalStars * 10;
    await autoqDb.updatePersonalBest(userId, "TOTAL", finalTotal, "");

    await autoqDb.updateAutoQGame(gameId, {
      status: "COMPLETE",
      current_hand: null,
      final_score: finalTotal,
      completed_at: new Date().toISOString(),
    });
  }
}

/**
 * Calculate stars for an AutoQ hand.
 * Same rules as regular QBIM: 3+ players, no ties, longest word + most words.
 */
function calculateAutoQStars(playerScore, botPlays, opponentCount, botNames) {
  const totalPlayers = 1 + opponentCount;
  const skipStars = totalPlayers < 3;

  // Collect all scores (player + bots)
  const allScores = [
    { id: "player", longest_word_letters: playerScore.longest_word_letters, word_count: playerScore.word_count },
    ...botPlays.map((bp, i) => ({
      id: `bot-${i}`,
      longest_word_letters: bp.longest_word_letters || 0,
      word_count: bp.word_count || 0,
    })),
  ];

  // Longest word
  let maxLetters = 0;
  for (const s of allScores) {
    if (s.longest_word_letters > maxLetters) maxLetters = s.longest_word_letters;
  }
  const longestWinners = maxLetters > 0
    ? allScores.filter((s) => s.longest_word_letters === maxLetters)
    : [];

  // Most words
  let maxWords = 0;
  for (const s of allScores) {
    if (s.word_count > maxWords) maxWords = s.word_count;
  }
  const mostWordsWinners = maxWords > 0
    ? allScores.filter((s) => s.word_count === maxWords)
    : [];

  const longestWinner = !skipStars && longestWinners.length === 1 ? longestWinners[0].id : null;
  const mostWordsWinner = !skipStars && mostWordsWinners.length === 1 ? mostWordsWinners[0].id : null;

  // Calculate stars for each participant
  const playerLongest = longestWinner === "player";
  const playerMost = mostWordsWinner === "player";
  const playerStars = (playerLongest ? 1 : 0) + (playerMost ? 1 : 0);

  const botStars = botPlays.map((_, i) => {
    const id = `bot-${i}`;
    return (longestWinner === id ? 1 : 0) + (mostWordsWinner === id ? 1 : 0);
  });

  // Build summary
  const parts = [];
  if (longestWinner) {
    const winnerName = longestWinner === "player" ? "You" : (botNames[Number(longestWinner.split("-")[1])] || longestWinner);
    parts.push(`Longest word: ${winnerName} (${maxLetters} letters)`);
  }
  if (mostWordsWinner) {
    const winnerName = mostWordsWinner === "player" ? "You" : (botNames[Number(mostWordsWinner.split("-")[1])] || mostWordsWinner);
    parts.push(`Most words: ${winnerName} (${maxWords})`);
  }
  const summary = parts.length > 0 ? parts.join("  |  ") : (skipStars ? "No stars (fewer than 3 players)" : "No stars — tied!");

  return { playerStars, playerLongest, playerMost, botStars, summary };
}

// ── Helpers ───────────────────────────────────────────

function respond(statusCode, body = {}) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

function validationError(blockId, msg) {
  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      response_action: "errors",
      errors: { [blockId]: msg },
    }),
  };
}
