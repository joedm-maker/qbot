import { verifySlackSignature, parseSlackBody } from "../lib/verify.mjs";
import { slack, CHANNEL, dmAllPlayers } from "../lib/slack.mjs";
import * as db from "../lib/db.mjs";
import * as blocks from "../lib/blocks.mjs";
import { getScoreOptions } from "../lib/cards.mjs";
import { renderHome, resolveNames, aggregateScores, findCurrentRound, ADMIN_USER } from "../lib/home.mjs";

export async function handler(event) {
  const { raw, parsed } = parseSlackBody(event.body, event.isBase64Encoded);

  if (!verifySlackSignature(process.env.SLACK_SIGNING_SECRET, event.headers, raw)) {
    return respond(401, { error: "Invalid signature" });
  }

  try {
    // Interactive actions (button taps)
    if (parsed.type === "block_actions") {
      await handleAction(parsed);
      return respond(200);
    }

    // Modal submissions
    if (parsed.type === "view_submission") {
      return await handleViewSubmission(parsed);
    }

    return respond(200);
  } catch (err) {
    console.error("score-entry error:", err);
    return respond(200);
  }
}

// ── Actions ────────────────────────────────────────────

async function handleAction(payload) {
  const action = payload.actions[0];

  switch (action.action_id) {
    case "qbim_open_hand_modal": {
      const [gameId, handStr] = action.value.split("|");
      const hand = Number(handStr);
      if (hand < 3 || hand > 10 || !Number.isInteger(hand)) return;
      await slack().views.open({
        trigger_id: payload.trigger_id,
        view: blocks.handScoreModal(gameId, hand),
      });
      break;
    }

    case "qbim_finalize_game": {
      await finalizeGame(action.value);
      break;
    }

    case "qbim_award_stars": {
      const [gameId, hand] = (action.value || "").split("|");
      const game = await db.getGame(gameId);
      const names = await resolveNames(game.players);
      const playerOptions = game.players.map((id) => ({
        text: { type: "plain_text", text: names.get(id) || id, emoji: true },
        value: id,
      }));
      await slack().views.open({
        trigger_id: payload.trigger_id,
        view: blocks.awardStarsModal(gameId, Number(hand), playerOptions),
      });
      break;
    }

    case "qbim_admin_recalc_stars": {
      if (payload.user.id !== ADMIN_USER) return;
      await adminRecalcAllStars(action.value);
      await renderHome(payload.user.id);
      break;
    }

    case "qbim_admin_republish": {
      if (payload.user.id !== ADMIN_USER) return;
      const game = await db.getGame(action.value);
      if (game) {
        const allScores = await db.getScoresForGame(action.value);
        await postFinalLeaderboard(game, allScores);
      }
      break;
    }

    case "qbim_admin_edit_picker": {
      if (payload.user.id !== ADMIN_USER) return;
      const gameId = action.value;
      const game = await db.getGame(gameId);
      if (!game) break;
      const allScores = await db.getScoresForGame(gameId);
      const allPlayerIds = [...new Set(allScores.map((s) => s.player_slack_id).filter(Boolean))];
      const names = await resolveNames(allPlayerIds);
      const playerOptions = allPlayerIds.map((id) => ({
        text: { type: "plain_text", text: names.get(id) || id, emoji: true },
        value: id,
      }));
      const hands = [...new Set(allScores.map((s) => s.hand))].sort((a, b) => a - b);
      const handOptions = hands.map((h) => ({
        text: { type: "plain_text", text: `Hand ${h}`, emoji: true },
        value: String(h),
      }));
      await slack().views.open({
        trigger_id: payload.trigger_id,
        view: blocks.adminPickerModal(gameId, playerOptions, handOptions),
      });
      break;
    }

    default: {
      break;
    }
  }
}

// ── View Submissions ───────────────────────────────────

async function handleViewSubmission(payload) {
  const callbackId = payload.view.callback_id;

  if (callbackId === "qbim_submit_score") {
    return await submitScore(payload);
  }

  if (callbackId === "qbim_confirm_score") {
    return await confirmScore(payload);
  }

  if (callbackId === "qbim_submit_stars") {
    return await submitStars(payload);
  }

  if (callbackId === "qbim_admin_pick_edit") {
    if (payload.user.id !== ADMIN_USER) return respond(200);
    return await adminPickEdit(payload);
  }

  if (callbackId === "qbim_admin_save_edit") {
    if (payload.user.id !== ADMIN_USER) return respond(200);
    return await adminSaveEdit(payload);
  }

  return respond(200);
}

// ── Score Submission ───────────────────────────────────

async function submitScore(payload) {
  const userId = payload.user.id;
  let game_id, hand;
  try { ({ game_id, hand } = JSON.parse(payload.view.private_metadata)); } catch { return respond(200); }
  const values = payload.view.state.values;
  const wordsInput = values.words_block.words?.value || "";

  // Empty submission = couldn't form a word, scores 0
  if (!wordsInput.trim()) {
    return await saveScore(userId, game_id, hand, "", { score: 0, cards: 0, breakdown: "—" });
  }

  // Check for mulligans — reduces max card count
  const mulligans = await db.getMulliganCount(game_id, userId, hand);
  const maxCards = hand - mulligans;

  // Get all possible score options with adjusted card limit
  const { options, invalid } = getScoreOptions(wordsInput, maxCards);

  if (invalid.length) {
    return validationError(`Invalid cards: ${invalid.join(", ")}. Valid cards: A-Z, QU, IN, ER, TH, CL`);
  }

  if (options.length === 0) {
    return validationError(`Too many cards for Hand ${hand}${mulligans > 0 ? ` with ${mulligans} mulligan${mulligans > 1 ? "s" : ""}` : ""} (max ${maxCards} cards).`);
  }

  // Multiple score options — let player choose
  if (options.length > 1) {
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        response_action: "update",
        view: blocks.scoreChoiceModal(game_id, hand, wordsInput, options),
      }),
    };
  }

  // Single option — save directly
  const chosen = options[0];
  return await saveScore(userId, game_id, hand, wordsInput, chosen);
}

/**
 * Handle the player's choice from the score selection modal.
 */
async function confirmScore(payload) {
  const userId = payload.user.id;
  let meta;
  try { meta = JSON.parse(payload.view.private_metadata); } catch { return respond(200); }
  const { game_id, hand, words } = meta;
  const values = payload.view.state.values;
  const selectedValue = values.score_choice_block.score_choice.selected_option.value;
  let chosen;
  try { chosen = JSON.parse(selectedValue); } catch { return respond(200); }

  return await saveScore(userId, game_id, hand, words, chosen);
}

/**
 * Save the score record and handle game state transitions.
 */
async function saveScore(userId, game_id, hand, wordsInput, chosen) {
  const rawScore = chosen.score;
  const breakdown = chosen.breakdown;

  // Parse words — players may separate with spaces, commas, or + signs
  const words = wordsInput.replace(/[\s,+]+/g, " ").trim().split(" ").filter(Boolean);
  const wordCount = words.length;

  // Calculate longest word by letter count (strip hyphens, count alpha only)
  let longestWordLetters = 0;
  for (const w of words) {
    const letters = w.replace(/[^a-zA-Z]/g, "").length;
    if (letters > longestWordLetters) longestWordLetters = letters;
  }

  // Check if this is an edit (player already submitted for this hand)
  const existingScores = await db.getScoresForGameHand(game_id, hand);
  const isEdit = existingScores.some((s) => s.player_slack_id === userId);

  // Get mulligan count for this hand
  const mulligans = await db.getMulliganCount(game_id, userId, hand);

  // Write score record (overwrites if exists)
  await db.putScore({
    game_id,
    player_hand_key: `${userId}#${hand}`,
    player_slack_id: userId,
    hand,
    raw_score: rawScore,
    words: wordsInput,
    word_count: wordCount,
    longest_word_letters: longestWordLetters,
    mulligans,
    breakdown,
    stars: 0,
    star_longest_word: false,
    star_most_words: false,
    submitted_at: new Date().toISOString(),
  });

  // If this is the first hand 3 score, transition OPEN → ACTIVE
  const game = await db.getGame(game_id);
  if (game.status === "OPEN" && hand === 3) {
    await db.updateGameStatus(game_id, "ACTIVE", {
      locked_at: new Date().toISOString(),
    });
  }

  // Check if all eligible players submitted this hand
  const startHands = game.player_start_hands || {};
  const eligiblePlayers = game.players.filter((pid) => (startHands[pid] || 3) <= hand);
  const handScores = await db.getScoresForGameHand(game_id, hand);
  if (handScores.length >= eligiblePlayers.length) {
    // Re-calculate stars; only post channel summary & check game completion on first completion
    await autoAwardStars(game, hand, handScores, !isEdit);
  }

  // Refresh the user's home tab
  await renderHome(userId);

  return respond(200, { response_action: "clear" });
}

/**
 * Automatically award stars for a completed hand.
 * Longest word (by letter count) → 1 star
 * Most words → 1 star
 * No star if any tie.
 * @param {boolean} announce — post to channel and check game completion (false on edits)
 */
export async function autoAwardStars(game, hand, handScores, announce = true) {
  const names = await resolveNames(game.players);

  // No stars with 2 or fewer players
  const skipStars = handScores.length <= 2;

  // Find longest word winner(s) by letter count
  let maxLetters = 0;
  for (const s of handScores) {
    const letters = s.longest_word_letters || 0;
    if (letters > maxLetters) maxLetters = letters;
  }
  const longestWinners = maxLetters > 0
    ? handScores.filter((s) => (s.longest_word_letters || 0) === maxLetters).map((s) => s.player_slack_id)
    : [];

  // Find most words winner(s)
  let maxWords = 0;
  for (const s of handScores) {
    const wc = s.word_count || 0;
    if (wc > maxWords) maxWords = wc;
  }
  const mostWordsWinners = maxWords > 0
    ? handScores.filter((s) => (s.word_count || 0) === maxWords).map((s) => s.player_slack_id)
    : [];

  // Only award if there is exactly one winner (no ties) and 3+ players
  const longestWinner = !skipStars && longestWinners.length === 1 ? longestWinners[0] : null;
  const mostWordsWinner = !skipStars && mostWordsWinners.length === 1 ? mostWordsWinners[0] : null;

  // Update star fields for all players
  for (const s of handScores) {
    const pid = s.player_slack_id;
    const isLongest = pid === longestWinner;
    const isMost = pid === mostWordsWinner;
    const starCount = (isLongest ? 1 : 0) + (isMost ? 1 : 0);
    await db.updateScoreStars(game.game_id, `${pid}#${hand}`, starCount, isLongest, isMost);
  }

  // Build star summary for channel message
  const parts = [];
  if (longestWinner) {
    parts.push(`Longest word: *${names.get(longestWinner) || longestWinner}* (${maxLetters} letters)`);
  }
  if (mostWordsWinner) {
    parts.push(`Most words: *${names.get(mostWordsWinner) || mostWordsWinner}* (${maxWords})`);
  }

  const starSummary = parts.length > 0
    ? parts.join("  |  ")
    : "No stars — everyone tied!";

  if (announce) {
    // Build per-player summary lines
    const playerLines = handScores.map((s) => {
      const name = names.get(s.player_slack_id) || s.player_slack_id;
      const starStr = (s.player_slack_id === longestWinner ? "★" : "") + (s.player_slack_id === mostWordsWinner ? "★" : "");
      return `• *${name}*: ${s.words || "(no words)"}  — *${s.raw_score} pts*${starStr ? "  " + starStr : ""}`;
    });

    // Determine next dealer: most cumulative raw points, tiebreak by least recent dealer
    let dealerLine = "";
    if (hand < 10) {
      const allScores = await db.getScoresForGame(game.game_id);
      const rawTotals = {};
      for (const s of allScores) {
        rawTotals[s.player_slack_id] = (rawTotals[s.player_slack_id] || 0) + (s.raw_score || 0);
      }

      const maxRaw = Math.max(...Object.values(rawTotals));
      const candidates = Object.entries(rawTotals).filter(([, v]) => v === maxRaw).map(([pid]) => pid);

      let nextDealer;
      if (candidates.length === 1) {
        nextDealer = candidates[0];
      } else {
        // Tiebreak: who dealt least recently (latest index in dealers array = most recent)
        const dealers = game.dealers || [];
        nextDealer = candidates.sort((a, b) => {
          const aLast = dealers.lastIndexOf(a);
          const bLast = dealers.lastIndexOf(b);
          return aLast - bLast; // lower index (or -1) = dealt less recently = should deal
        })[0];
      }

      await db.addDealer(game.game_id, nextDealer);
      const dealerName = names.get(nextDealer) || nextDealer;
      dealerLine = `\n:point_right: *${dealerName} deals Hand ${hand + 1}*`;
    }

    const msgBlocks = [
      { type: "section", text: { type: "mrkdwn", text: `*Hand ${hand} complete!*\n${playerLines.join("\n")}\n\n${starSummary}${dealerLine}` } },
    ];
    await dmAllPlayers(game.players, { text: `Hand ${hand} complete! ${starSummary}`, blocks: msgBlocks });

    // After hand 10, enter review mode instead of completing immediately
    if (hand === 10) {
      const allScores = await db.getScoresForGame(game.game_id);
      const startHands = game.player_start_hands || {};
      const eligible10 = game.players.filter((pid) => (startHands[pid] || 3) <= 10);
      const hand10Scores = allScores.filter((s) => s.hand === 10);
      if (hand10Scores.length >= eligible10.length && !game.review_started_at) {
        await db.updateGameStatus(game.game_id, "ACTIVE", {
          review_started_at: new Date().toISOString(),
        });
      }
    }

    // Refresh all players' home tabs so waiting players see the next hand
    for (const pid of game.players) {
      await renderHome(pid);
    }
  }
}

// ── Game Finalization ────────────────────────────────────

export async function finalizeGame(gameId) {
  const game = await db.getGame(gameId);
  if (!game || game.status === "COMPLETE") return;

  await db.updateGameStatus(gameId, "COMPLETE", {
    completed_at: new Date().toISOString(),
  });

  const allScores = await db.getScoresForGame(gameId);
  await postFinalLeaderboard(game, allScores);
  await updatePlayerStats(game, allScores);

  // Refresh all players' home tabs
  for (const pid of game.players) {
    await renderHome(pid);
  }
}

// ── Admin Functions ──────────────────────────────────────

async function adminPickEdit(payload) {
  let game_id;
  try { ({ game_id } = JSON.parse(payload.view.private_metadata)); } catch { return respond(200); }
  const values = payload.view.state.values;
  const playerId = values.player_block.player_select.selected_option.value;
  const hand = Number(values.hand_block.hand_select.selected_option.value);

  // Look up current words for this player + hand
  const scores = await db.getScoresForGameHand(game_id, hand);
  const existing = scores.find((s) => s.player_slack_id === playerId);
  const currentWords = existing?.words || "";

  const playerRecord = await db.getPlayer(playerId);
  const playerName = playerRecord?.display_name || playerId;

  // Push the edit modal on top of the picker
  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      response_action: "update",
      view: blocks.adminEditModal(game_id, playerId, playerName, hand, currentWords),
    }),
  };
}

async function adminSaveEdit(payload) {
  let game_id, player_id, hand;
  try { ({ game_id, player_id, hand } = JSON.parse(payload.view.private_metadata)); } catch { return respond(200); }
  const wordsInput = payload.view.state.values.words_block.words?.value || "";

  // Calculate score from words
  const { options, invalid } = getScoreOptions(wordsInput, hand);
  if (invalid.length) {
    return validationError(`Invalid cards: ${invalid.join(", ")}`);
  }
  if (options.length === 0) {
    return validationError(`No valid card combinations fit within Hand ${hand}.`);
  }

  // Use highest scoring option
  const chosen = options[0];
  const words = wordsInput.replace(/[\s,+]+/g, " ").trim().split(" ").filter(Boolean);
  const wordCount = words.length;
  let longestWordLetters = 0;
  for (const w of words) {
    const letters = w.replace(/[^a-zA-Z]/g, "").length;
    if (letters > longestWordLetters) longestWordLetters = letters;
  }

  // Overwrite the score record
  await db.putScore({
    game_id,
    player_hand_key: `${player_id}#${hand}`,
    player_slack_id: player_id,
    hand,
    raw_score: chosen.score,
    words: wordsInput,
    word_count: wordCount,
    longest_word_letters: longestWordLetters,
    breakdown: chosen.breakdown,
    stars: 0,
    star_longest_word: false,
    star_most_words: false,
    submitted_at: new Date().toISOString(),
  });

  // Recalculate stars for this hand
  const game = await db.getGame(game_id);
  const handScores = await db.getScoresForGameHand(game_id, hand);
  await autoAwardStars(game, hand, handScores, false);

  // Refresh admin home
  await renderHome(payload.user.id);
  return respond(200, { response_action: "clear" });
}

async function adminRecalcAllStars(gameId) {
  const game = await db.getGame(gameId);
  if (!game) return;

  const allScores = await db.getScoresForGame(gameId);
  const hands = [...new Set(allScores.map((s) => s.hand))].sort((a, b) => a - b);

  for (const h of hands) {
    const handScores = allScores.filter((s) => s.hand === h);
    await autoAwardStars(game, h, handScores, false);
  }
}

// ── Final Leaderboard ──────────────────────────────────

async function postFinalLeaderboard(game, allScores) {
  // Resolve names for all players who submitted scores (including dropped players)
  const allPlayerIds = [...new Set(allScores.map((s) => s.player_slack_id).filter(Boolean))];
  const names = await resolveNames(allPlayerIds);
  const totals = aggregateScores(allScores);
  const standings = [...totals.entries()]
    .map(([id, t]) => ({
      name: names.get(id) || id,
      raw: t.raw,
      stars: t.stars,
      final: t.raw + t.stars * 10,
    }))
    .sort((a, b) => b.final - a.final);

  const medals = [":first_place_medal:", ":second_place_medal:", ":third_place_medal:"];
  const lines = standings.map((s, i) => {
    const prefix = i < 3 ? `${medals[i]} ` : `${i + 1}. `;
    return `${prefix}*${s.name}* — Raw: ${s.raw} | Stars: ${"★".repeat(s.stars)} (${s.stars}) | Bonus: +${s.stars * 10} | *Final: ${s.final}*`;
  });

  const msgBlocks = [
    { type: "section", text: { type: "mrkdwn", text: `*Game #${game.game_number} — Final Standings*\n\n${lines.join("\n")}` } },
  ];
  await dmAllPlayers(allPlayerIds, { text: "Game complete! Final standings:", blocks: msgBlocks });
}

// ── Player Stats Update ────────────────────────────────

async function updatePlayerStats(game, allScores) {
  const startHands = game.player_start_hands || {};
  const totals = aggregateScores(allScores);

  // A player has a "complete" game only if they started at hand 3 (played all hands)
  const completePlayers = game.players.filter((pid) => (startHands[pid] || 3) === 3);

  // Find winner among complete players only
  let maxFinal = -Infinity;
  let winnerId = null;
  for (const pid of completePlayers) {
    const t = totals.get(pid);
    if (!t) continue;
    const final = t.raw + t.stars * 10;
    if (final > maxFinal) {
      maxFinal = final;
      winnerId = pid;
    }
  }

  for (const playerId of game.players) {
    const t = totals.get(playerId) || { stars: 0 };
    const isComplete = completePlayers.includes(playerId);
    // Count mulligans for this player across all hands
    const playerMulligans = allScores
      .filter((s) => s.player_slack_id === playerId)
      .reduce((sum, s) => sum + (s.mulligans || 0), 0);
    await db.incrementPlayerStats(playerId, {
      gamesPlayed: isComplete ? 1 : 0,
      wins: isComplete && playerId === winnerId ? 1 : 0,
      stars: t.stars,
      mulligans: playerMulligans,
    });
  }
}


function validationError(message) {
  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      response_action: "errors",
      errors: { words_block: message },
    }),
  };
}

function respond(statusCode, body = {}) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}
