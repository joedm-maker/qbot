import { verifySlackSignature, parseSlackBody } from "../lib/verify.mjs";
import { slack, CHANNEL, dmAllPlayers, dmUser } from "../lib/slack.mjs";
import * as db from "../lib/db.mjs";
import * as blocks from "../lib/blocks.mjs";
import { getScoreOptions, getHandRange, formatWordsWithPoints, normalizeWords, dealSizeForHand, CARD_VALUES } from "../lib/cards.mjs";
import { renderHome, resolveNames, aggregateScores, findCurrentRound, ADMIN_USER } from "../lib/home.mjs";
import { createQuicklerTimer, deleteQuicklerTimer } from "../lib/quickler.mjs";
import { validateWords } from "../lib/dictionary.mjs";
import { resolveVote, startWordVote } from "../lib/vote.mjs";

// Lambda client for async-invoking the score worker. Lazy-loaded.
let _lambda;
async function getLambda() {
  if (_lambda) return _lambda;
  const { LambdaClient } = await import("@aws-sdk/client-lambda");
  _lambda = new LambdaClient({});
  return _lambda;
}
export async function invokeScoreWorker(payload) {
  const functionName = process.env.SCORE_WORKER_FUNCTION_NAME;
  if (!functionName) {
    console.warn("SCORE_WORKER_FUNCTION_NAME not set; cannot invoke worker");
    return;
  }
  const { InvokeCommand } = await import("@aws-sdk/client-lambda");
  const client = await getLambda();
  await client.send(new InvokeCommand({
    FunctionName: functionName,
    InvocationType: "Event", // fire-and-forget
    Payload: Buffer.from(JSON.stringify(payload)),
  }));
}

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
      // Capture Slack's action timestamp as the closest proxy for when the user pressed the button
      const buttonPressedAt = action.action_ts || null;
      // Pre-fill with the player's existing submission so Edit doesn't wipe their score on blank submit.
      const priorScores = await db.getScoresForGameHand(gameId, hand);
      const prior = priorScores.find((s) => s.player_slack_id === payload.user.id);
      const wordsInput = prior?.words ? prior.words.replace(/\+/g, " ") : "";
      await slack().views.open({
        trigger_id: payload.trigger_id,
        view: blocks.handScoreModal(gameId, hand, buttonPressedAt, { wordsInput }),
      });
      break;
    }

    case "qbim_retry_hand": {
      let retryMeta;
      try { retryMeta = JSON.parse(action.value); } catch { return; }
      const { game_id, hand, words } = retryMeta;
      if (!game_id || hand < 3 || hand > 10) return;
      const buttonPressedAt = action.action_ts || null;
      await slack().views.open({
        trigger_id: payload.trigger_id,
        view: blocks.handScoreModal(game_id, hand, buttonPressedAt, { wordsInput: words || "" }),
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

    case "qbim_admin_toggle_points": {
      if (payload.user.id !== ADMIN_USER) return;
      const newVal = action.value === "on";
      await db.initPreferences(ADMIN_USER);
      await db.setPlayerPreference(ADMIN_USER, "show_card_points", newVal);
      await renderHome(ADMIN_USER);
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

    case "qbim_admin_select_game": {
      if (payload.user.id !== ADMIN_USER) return;
      const selectedId = action.selected_option?.value;
      if (selectedId) {
        await db.initPreferences(ADMIN_USER);
        await db.setPlayerPreference(ADMIN_USER, "admin_selected_game", selectedId);
      }
      await renderHome(ADMIN_USER);
      break;
    }

    case "qbim_admin_delete_game": {
      if (payload.user.id !== ADMIN_USER) return;
      const gameId = action.value;
      // Clean up any pending Quickler timer
      const gameToDelete = await db.getGame(gameId);
      if (gameToDelete?.quickler_timer_schedule_name) {
        try { await deleteQuicklerTimer(gameToDelete.quickler_timer_schedule_name); } catch (err) { console.warn("Timer cleanup:", err.message); }
      }
      await db.deleteAllScoresForGame(gameId);
      await db.deleteGame(gameId);
      // Clear admin preference
      await db.initPreferences(ADMIN_USER);
      await db.setPlayerPreference(ADMIN_USER, "admin_selected_game", "");
      await renderHome(ADMIN_USER);
      break;
    }

    case "qbim_admin_force_finalize": {
      if (payload.user.id !== ADMIN_USER) return;
      await finalizeGame(action.value);
      await renderHome(ADMIN_USER);
      break;
    }

    case "qbim_admin_nudge": {
      if (payload.user.id !== ADMIN_USER) return;
      const gameId = action.value;
      const game = await db.getGame(gameId);
      if (!game || game.status !== "ACTIVE") break;
      const allScores = await db.getScoresForGame(gameId);
      const round = findCurrentRound(allScores, ADMIN_USER, game);
      if (round && round.hand && round.missingPlayerIds && round.missingPlayerIds.length > 0) {
        for (const pid of round.missingPlayerIds) {
          try {
            await dmUser(pid, {
              text: `Reminder: everyone's waiting on you for Hand ${round.hand}!`,
            });
          } catch (err) {
            console.warn("Failed to nudge player:", pid, err.message);
          }
        }
      }
      await renderHome(ADMIN_USER);
      break;
    }

    case "qbim_admin_guest_join": {
      if (payload.user.id !== ADMIN_USER) return;
      const gameId = action.value;
      await slack().views.open({
        trigger_id: payload.trigger_id,
        view: blocks.adminGuestJoinModal(gameId),
      });
      break;
    }

    case "qbim_vote_word": {
      await handleVoteWord(payload, action);
      break;
    }

    case "qbim_check_words": {
      await handleCheckWords(payload, action);
      break;
    }

    case "qbim_vote_yes":
    case "qbim_vote_no": {
      await handleVoteResponse(payload, action);
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

  if (callbackId === "qbim_admin_guest_join_submit") {
    if (payload.user.id !== ADMIN_USER) return respond(200);
    return await adminGuestJoinSubmit(payload);
  }

  return respond(200);
}

// ── Score Submission ───────────────────────────────────

async function submitScore(payload) {
  const userId = payload.user.id;
  let game_id, hand, button_pressed_at;
  try { ({ game_id, hand, button_pressed_at } = JSON.parse(payload.view.private_metadata)); } catch { return respond(200); }
  const values = payload.view.state.values;
  const wordsInput = values.words_block.words?.value || "";

  // Empty submission = couldn't form a word, scores 0
  if (!wordsInput.trim()) {
    return await saveScore(userId, game_id, hand, "", { score: 0, cards: 0, breakdown: "—" }, button_pressed_at);
  }

  // Check for mulligans — reduces max card count
  const mulligans = await db.getMulliganCount(game_id, userId, hand);
  const gameForMax = await db.getGame(game_id);
  const maxCards = dealSizeForHand(gameForMax?.game_type, hand, mulligans);

  // Get all possible score options with adjusted card limit
  const { options, invalid, tooShort } = getScoreOptions(wordsInput, maxCards);

  if (invalid.length) {
    return validationError(`Invalid cards: ${invalid.join(", ")}. Valid cards: A-Z, QU, IN, ER, TH, CL`);
  }

  if (tooShort?.length) {
    return validationError(`Every word must use at least 2 cards: ${tooShort.join(", ")}`);
  }

  if (options.length === 0) {
    return validationError(`Too many cards for Hand ${hand}${mulligans > 0 ? ` with ${mulligans} mulligan${mulligans > 1 ? "s" : ""}` : ""} (max ${maxCards} cards).`);
  }

  // Dictionary validation (sync — shows rejection modal with Vote button)
  const dictCheck = await validateWords(wordsInput);
  if (dictCheck.invalid.length) {
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        response_action: "update",
        view: blocks.handScoreModal(game_id, hand, button_pressed_at, {
          wordsInput,
          invalidWords: dictCheck.invalid.map((w) => w.word),
          chosen: null,
        }),
      }),
    };
  }

  // Multiple score options — let player choose
  if (options.length > 1) {
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        response_action: "update",
        view: blocks.scoreChoiceModal(game_id, hand, wordsInput, options, button_pressed_at),
      }),
    };
  }

  // Valid single option — hand off save to async worker, close modal immediately
  await invokeScoreWorker({
    userId, game_id, hand,
    wordsInput, chosen: options[0], buttonPressedAt: button_pressed_at,
    validated: true,
  });
  return respond(200, { response_action: "clear" });
}

/**
 * Handle the player's choice from the score selection modal.
 */
async function confirmScore(payload) {
  const userId = payload.user.id;
  let meta;
  try { meta = JSON.parse(payload.view.private_metadata); } catch { return respond(200); }
  const { game_id, hand, words, button_pressed_at } = meta;
  const values = payload.view.state.values;
  const selectedValue = values.score_choice_block.score_choice.selected_option.value;
  let chosen;
  try { chosen = JSON.parse(selectedValue); } catch { return respond(200); }

  // Dictionary validation (sync — shows rejection modal with Vote button)
  const dictCheck = await validateWords(words);
  if (dictCheck.invalid.length) {
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        response_action: "update",
        view: blocks.handScoreModal(game_id, hand, button_pressed_at, {
          wordsInput: words,
          invalidWords: dictCheck.invalid.map((w) => w.word),
          chosen,
        }),
      }),
    };
  }

  // Valid — save async, close modal immediately
  await invokeScoreWorker({
    userId, game_id, hand,
    wordsInput: words, chosen, buttonPressedAt: button_pressed_at,
    validated: true,
  });
  return respond(200, { response_action: "clear" });
}

/**
 * Save the score record and handle game state transitions.
 */
export async function saveScore(userId, game_id, hand, wordsInput, chosen, buttonPressedAt = null, bankCard = null) {
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

  // Block edits to hands where all eligible players have submitted
  if (isEdit) {
    const game = await db.getGame(game_id);
    const startHands = game.player_start_hands || {};
    const eligiblePlayers = game.players.filter((pid) => (startHands[pid] || 3) <= hand);
    if (existingScores.length >= eligiblePlayers.length) {
      return validationError(`Whoops, sorry that hand is complete. Please wait while we refresh.`);
    }
  }

  // Quickler timer validation — check if submission is within the 30s window
  const gameForTimer = await db.getGame(game_id);
  if (gameForTimer.game_type === "Quickler" && gameForTimer.quickler_timer_started_at && gameForTimer.quickler_timer_hand === hand && !isEdit) {
    const timerStart = new Date(gameForTimer.quickler_timer_started_at).getTime() / 1000; // epoch seconds
    const pressedAt = buttonPressedAt ? Number(buttonPressedAt) : Date.now() / 1000;
    if (pressedAt - timerStart > 30) {
      return validationError("Time's up! The 30-second Quickler timer expired.");
    }
  }

  // Get mulligan count for this hand
  const mulligans = await db.getMulliganCount(game_id, userId, hand);

  // Preserve the original submission time across re-submissions so pace
  // tracking reflects when the player first thought they were done.
  const priorRecord = existingScores.find((s) => s.player_slack_id === userId);
  const nowIso = new Date().toISOString();
  const firstSubmittedAt = priorRecord?.first_submitted_at || priorRecord?.submitted_at || nowIso;

  // Write score record (overwrites if exists)
  await db.putScore({
    game_id,
    player_hand_key: `${userId}#${hand}`,
    player_slack_id: userId,
    hand,
    raw_score: rawScore,
    words: normalizeWords(wordsInput),
    word_count: wordCount,
    longest_word_letters: longestWordLetters,
    mulligans,
    breakdown,
    stars: 0,
    star_longest_word: false,
    star_most_words: false,
    first_submitted_at: firstSubmittedAt,
    submitted_at: nowIso,
  });

  // Increment play count for each unique word (used by Phase 4 definition-DM logic).
  // Skip on edits so we don't double-count. Fire and forget — don't block submission on cache writes.
  if (!isEdit && words.length) {
    const unique = new Set(words.map((w) => w.toLowerCase().replace(/[^a-z]/g, "")).filter(Boolean));
    for (const w of unique) {
      db.incrementDictionaryPlayCount(w).catch(() => { /* ignore */ });
    }
  }

  // If this is the first hand 3 score, transition OPEN → ACTIVE
  const game = await db.getGame(game_id);
  if (game.status === "OPEN" && hand === 3) {
    await db.updateGameStatus(game_id, "ACTIVE", {
      locked_at: new Date().toISOString(),
    });
  }

  // Hot Swap: persist (or clear) the banked card. Skipped for edits and
  // for hand 10 (no next deal). Digital validates that the chosen card
  // is actually in the player's discards for this hand; Physical accepts
  // any valid card label (honor system — server has no deal record).
  if (game.game_type === "HotSwap" && !isEdit && hand < 10) {
    if (bankCard != null) {
      if (game.deck_type === "Digital") {
        const dealt = game.dealt_cards?.[`${userId}#${hand}`] || [];
        const usedCards = breakdown.split(/\s+/).flatMap((seg) => seg.split("-")).filter(Boolean);
        const remaining = new Map();
        for (const c of dealt) remaining.set(c, (remaining.get(c) || 0) + 1);
        for (const c of usedCards) remaining.set(c, (remaining.get(c) || 0) - 1);
        if ((remaining.get(bankCard) || 0) <= 0) {
          return validationError(`Can't bank ${bankCard} — not in your discards.`);
        }
      } else if (!CARD_VALUES[bankCard]) {
        return validationError(`Can't bank ${bankCard} — not a valid card.`);
      }
      await db.setBankedCard(game_id, userId, bankCard);
    } else {
      // Player chose not to bank — clear any stale entry from a prior submit.
      await db.setBankedCard(game_id, userId, null);
    }
  }

  // Quickler: start 30s timer on first submission for a hand
  const startHands = game.player_start_hands || {};
  const eligiblePlayers = game.players.filter((pid) => (startHands[pid] || 3) <= hand);

  if (game.game_type === "Quickler" && !isEdit && !game.quickler_timer_started_at) {
    // First submission for this hand (existingScores was fetched before our write)
    if (existingScores.length === 0 && eligiblePlayers.length > 1) {
      const timerStartedAt = new Date().toISOString();
      const scheduleName = `qbim-timer-${game_id}-hand-${hand}`.replace(/[^a-zA-Z0-9_-]/g, "-");
      await db.updateGameAttr(game_id, {
        quickler_timer_started_at: timerStartedAt,
        quickler_timer_hand: hand,
        quickler_timer_schedule_name: scheduleName,
      });
      await createQuicklerTimer(scheduleName, game_id, hand);
      // Quickler is in-person; no DM blast — home tabs refresh on submit.
    }
  }

  // Check if all eligible players submitted this hand
  const handScores = await db.getScoresForGameHand(game_id, hand);
  if (handScores.length >= eligiblePlayers.length) {
    // Hand complete — clear Quickler timer if active
    if (game.game_type === "Quickler" && game.quickler_timer_schedule_name) {
      try { await deleteQuicklerTimer(game.quickler_timer_schedule_name); } catch (err) { console.warn("Timer cleanup:", err.message); }
      await db.updateGameAttr(game_id, {
        quickler_timer_started_at: null,
        quickler_timer_hand: null,
        quickler_timer_schedule_name: null,
      });
    }
    // Re-calculate stars; only post channel summary & check game completion on first completion
    await autoAwardStars(game, hand, handScores, !isEdit);
  } else if (eligiblePlayers.length - handScores.length === 1) {
    // Exactly one player remaining — record timestamp for slow submitter nudge
    await db.updateGameAttr(game_id, { last_waiting_since: new Date().toISOString() });
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

  // Build effective scores using the just-awarded stars
  const effectiveScores = handScores.map((s) => {
    const pid = s.player_slack_id;
    const starCount = (pid === longestWinner ? 1 : 0) + (pid === mostWordsWinner ? 1 : 0);
    return { pid, eff: (s.raw_score || 0) + starCount * 10 };
  });

  // ── Achievement: Strategic Retreat ────────────────────
  // Awarded when a player takes a mulligan and still wins the round (sole highest effective score)
  if (handScores.length >= 2) {
    const maxEff = Math.max(...effectiveScores.map((e) => e.eff));
    const effWinners = effectiveScores.filter((e) => e.eff === maxEff);
    if (effWinners.length === 1) {
      const winnerPid = effWinners[0].pid;
      const mulliganKey = `${winnerPid}#${hand}`;
      if ((game.mulligans?.[mulliganKey] || 0) > 0) {
        const isNew = await db.addAchievement(winnerPid, "strategic-retreat", {
          game_id: game.game_id, game_number: game.game_number, hand,
        });
        if (isNew) {
          const def = db.ACHIEVEMENTS["strategic-retreat"];
          await dmUser(winnerPid, {
            text: `${def.emoji} Achievement unlocked: *${def.name}*\n${def.description}`,
          });
        }
      }
    }
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
    // Check if card points display is enabled
    const adminPlayer = await db.getPlayer(ADMIN_USER);
    const showCardPoints = adminPlayer?.preferences?.show_card_points ?? true;

    const playerLines = handScores.map((s) => {
      const name = names.get(s.player_slack_id) || s.player_slack_id;
      const starStr = (s.player_slack_id === longestWinner ? "★" : "") + (s.player_slack_id === mostWordsWinner ? "★" : "");
      const wordsFormatted = s.words
        ? (showCardPoints ? formatWordsWithPoints(s.words) : s.words.toLowerCase().replace(/\+/g, " "))
        : "(no words)";
      return `• *${name}*: ${wordsFormatted}  — *${s.raw_score} pts*${starStr ? "  " + starStr : ""}`;
    });

    // Determine next dealer: highest raw score on THIS hand, tiebreak by least recent dealer
    const gameHands = getHandRange(game.game_type);
    const lastHand = gameHands[gameHands.length - 1];
    let dealerLine = "";
    if (hand < lastHand) {
      const maxRaw = Math.max(...handScores.map((s) => s.raw_score || 0));
      const candidates = handScores.filter((s) => (s.raw_score || 0) === maxRaw).map((s) => s.player_slack_id);

      let nextDealer;
      if (candidates.length === 1) {
        nextDealer = candidates[0];
      } else {
        const dealers = game.dealers || [];
        nextDealer = candidates.sort((a, b) => {
          const aLast = dealers.lastIndexOf(a);
          const bLast = dealers.lastIndexOf(b);
          return aLast - bLast;
        })[0];
      }

      await db.addDealer(game.game_id, nextDealer);
      const dealerName = names.get(nextDealer) || nextDealer;
      dealerLine = `\n:point_right: *${dealerName} deals Hand ${hand + 1}* (${3 + hand + 1} cards each)`;
    }

    if (game.game_type !== "Quickler") {
      const msgBlocks = [
        { type: "section", text: { type: "mrkdwn", text: `*Hand ${hand} complete!*\n${playerLines.join("\n")}\n\n${starSummary}${dealerLine}` } },
      ];
      await dmAllPlayers(game.players, { text: `Hand ${hand} complete! ${starSummary}`, blocks: msgBlocks });
    }

    // After last hand, enter review mode instead of completing immediately
    if (hand === lastHand) {
      const allScores = await db.getScoresForGame(game.game_id);
      const startHands = game.player_start_hands || {};
      const eligibleLast = game.players.filter((pid) => (startHands[pid] || gameHands[0]) <= lastHand);
      const lastHandScores = allScores.filter((s) => s.hand === lastHand);
      if (lastHandScores.length >= eligibleLast.length && !game.review_started_at) {
        await db.updateGameStatus(game.game_id, "ACTIVE", {
          review_started_at: new Date().toISOString(),
        });
      }
    } else if (game.deck_type === "Digital") {
      // Digital deck: each new hand reshuffles, so deal next-hand cards for
      // every eligible player from a freshly shuffled full 118-card deck.
      // Hot Swap: if a player banked a card last hand, prepend it and deal
      // one fewer fresh card so the total stays at hand+3.
      const { dealFromPool } = await import("../lib/autoq-deck.mjs");
      const nextHand = hand + 1;
      const startHands = game.player_start_hands || {};
      const nextEligible = game.players.filter((pid) => (startHands[pid] || gameHands[0]) <= nextHand);
      const dealSize = dealSizeForHand(game.game_type, nextHand, 0);
      const banked = game.game_type === "HotSwap" ? (game.banked_cards || {}) : {};
      for (const pid of nextEligible) {
        const carried = banked[pid] || null;
        const freshSize = carried ? Math.max(0, dealSize - 1) : dealSize;
        const { cards } = dealFromPool([], freshSize);
        const finalCards = carried ? [carried, ...cards] : cards;
        await db.recordDeal(game.game_id, pid, nextHand, finalCards);
      }
      // Clear banked cards once consumed for this hand transition.
      if (game.game_type === "HotSwap" && Object.keys(banked).length > 0) {
        await db.updateGameAttr(game.game_id, { banked_cards: {} });
      }
    }

    // Refresh all players' home tabs so waiting players see the next hand
    await Promise.all(game.players.map((pid) => renderHome(pid).catch((err) => console.warn("renderHome failed:", pid, err.message))));
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
  // await postSuperlatives(game, allScores); // tabled — building up the pool first
  await updatePlayerStats(game, allScores);

  // Refresh all players' home tabs
  await Promise.all(game.players.map((pid) => renderHome(pid).catch((err) => console.warn("renderHome failed:", pid, err.message))));
}

// ── Admin Functions ──────────────────────────────────────

async function adminPickEdit(payload) {
  let game_id;
  try { ({ game_id } = JSON.parse(payload.view.private_metadata)); } catch { return respond(200); }
  const values = payload.view.state.values;
  const playerId = values.player_block.player_select.selected_option.value;
  const hand = Number(values.hand_block.hand_select.selected_option.value);

  // Admin can only edit completed hands (not the current in-progress hand)
  const game = await db.getGame(game_id);
  const startHands = game.player_start_hands || {};
  const eligiblePlayers = game.players.filter((pid) => (startHands[pid] || 3) <= hand);
  const handScores = await db.getScoresForGameHand(game_id, hand);
  if (handScores.length < eligiblePlayers.length) {
    return validationError(`Hand ${hand} is still in progress. Admin edits are only allowed on completed hands.`);
  }

  // Look up current words for this player + hand
  const scores = handScores;
  const existing = scores.find((s) => s.player_slack_id === playerId);
  const currentWords = existing?.words || "";

  // Look up current mulligan count
  const currentMulligans = await db.getMulliganCount(game_id, playerId, hand);

  const playerRecord = await db.getPlayer(playerId);
  const playerName = playerRecord?.display_name || playerId;

  // Push the edit modal on top of the picker
  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      response_action: "update",
      view: blocks.adminEditModal(game_id, playerId, playerName, hand, currentWords, currentMulligans),
    }),
  };
}

async function adminSaveEdit(payload) {
  let game_id, player_id, hand;
  try { ({ game_id, player_id, hand } = JSON.parse(payload.view.private_metadata)); } catch { return respond(200); }
  const wordsInput = payload.view.state.values.words_block.words?.value || "";

  // Read and apply mulligan count from the modal
  const mulliganValue = payload.view.state.values.mulligans_block?.mulligans?.value;
  const newMulligans = mulliganValue != null ? Number(mulliganValue) : 0;
  await db.setMulliganCount(game_id, player_id, hand, newMulligans);

  // Calculate score from words (accounting for mulligans)
  const gameForMax2 = await db.getGame(game_id);
  const maxCards = dealSizeForHand(gameForMax2?.game_type, hand, newMulligans);
  const { options, invalid, tooShort } = getScoreOptions(wordsInput, maxCards);
  if (invalid.length) {
    return validationError(`Invalid cards: ${invalid.join(", ")}`);
  }
  if (tooShort?.length) {
    return validationError(`Every word must use at least 2 cards: ${tooShort.join(", ")}`);
  }
  if (options.length === 0) {
    return validationError(`No valid card combinations fit within Hand ${hand}${newMulligans > 0 ? ` with ${newMulligans} mulligan${newMulligans > 1 ? "s" : ""}` : ""} (max ${maxCards} cards).`);
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

  // Preserve the player's original submission time across admin edits.
  const priorHandScores = await db.getScoresForGameHand(game_id, hand);
  const priorRecord = priorHandScores.find((s) => s.player_slack_id === player_id);
  const nowIso = new Date().toISOString();
  const firstSubmittedAt = priorRecord?.first_submitted_at || priorRecord?.submitted_at || nowIso;

  // Overwrite the score record
  await db.putScore({
    game_id,
    player_hand_key: `${player_id}#${hand}`,
    player_slack_id: player_id,
    hand,
    raw_score: chosen.score,
    words: normalizeWords(wordsInput),
    word_count: wordCount,
    longest_word_letters: longestWordLetters,
    breakdown: chosen.breakdown,
    stars: 0,
    star_longest_word: false,
    star_most_words: false,
    first_submitted_at: firstSubmittedAt,
    submitted_at: nowIso,
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

// ── Admin Guest Join ─────────────────────────────────────

async function adminGuestJoinSubmit(payload) {
  let game_id;
  try { ({ game_id } = JSON.parse(payload.view.private_metadata)); } catch { return respond(200); }
  const guestName = payload.view.state.values.guest_name_block.guest_name?.value || "Guest";

  // Set the Office account's display_name to the guest name
  await db.upsertPlayer(ADMIN_USER, guestName);

  // Add to game (uses same logic as joinGame in game-flow)
  const game = await db.getGame(game_id);
  if (!game || (game.status !== "OPEN" && game.status !== "ACTIVE")) return respond(200);

  // Determine start hand
  let startHand = 3;
  if (game.status === "ACTIVE") {
    const scores = await db.getScoresForGame(game_id);
    for (let h = 3; h <= 10; h++) {
      const eligibleCount = game.players.filter(
        (pid) => (game.player_start_hands?.[pid] || 3) <= h
      ).length;
      const handScores = scores.filter((s) => s.hand === h);
      if (handScores.length < eligibleCount) {
        startHand = h;
        break;
      }
      startHand = h + 1;
    }
    if (startHand > 10) return respond(200);
  }

  try {
    await db.addPlayerToGame(game_id, ADMIN_USER);
  } catch (err) {
    // Condition check failed — already in the game
    if (err.name !== "ConditionalCheckFailedException") throw err;
  }
  await db.setPlayerStartHand(game_id, ADMIN_USER, startHand);

  await renderHome(ADMIN_USER);
  return respond(200, { response_action: "clear" });
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

  if (game.game_type !== "Quickler") {
    const msgBlocks = [
      { type: "section", text: { type: "mrkdwn", text: `*Game #${game.game_number} — Final Standings*\n\n${lines.join("\n")}` } },
    ];
    await dmAllPlayers(allPlayerIds, { text: "Game complete! Final standings:", blocks: msgBlocks });
  }
}

async function postSuperlatives(game, allScores) {
  const allPlayerIds = [...new Set(allScores.map((s) => s.player_slack_id).filter(Boolean))];
  const names = await resolveNames(allPlayerIds);
  const gameHands = getHandRange(game.game_type);
  const lastHand = gameHands[gameHands.length - 1];

  const pool = []; // { id, text } — all eligible superlatives

  // Fetch all historical scores for personal average comparisons
  const historicalScores = await db.getAllScores();
  const handSums = {}; // "pid#hand" → { sum, count }
  for (const s of historicalScores) {
    if (s.game_id === game.game_id) continue;
    const k = `${s.player_slack_id}#${s.hand}`;
    if (!handSums[k]) handSums[k] = { sum: 0, count: 0 };
    handSums[k].sum += s.raw_score || 0;
    handSums[k].count++;
  }

  // Best Hand: largest percentage above personal hand average
  let bestPctAbove = -Infinity, bestHandPid = null, bestHandNum = null, bestHandScore = 0;
  for (const s of allScores) {
    const k = `${s.player_slack_id}#${s.hand}`;
    const hist = handSums[k];
    if (!hist || hist.count < 3) continue;
    const avg = hist.sum / hist.count;
    if (avg <= 0) continue;
    const pctAbove = ((s.raw_score || 0) - avg) / avg * 100;
    if (pctAbove > bestPctAbove) {
      bestPctAbove = pctAbove;
      bestHandPid = s.player_slack_id;
      bestHandNum = s.hand;
      bestHandScore = s.raw_score || 0;
    }
  }
  if (bestHandPid && bestPctAbove > 0) {
    pool.push({ id: "best-hand", text: `:muscle: *Best Hand* — ${names.get(bestHandPid)} with ${bestHandScore} pts on Hand ${bestHandNum}` });
  }

  // Star Player: most stars
  const starsByPlayer = {};
  for (const s of allScores) {
    starsByPlayer[s.player_slack_id] = (starsByPlayer[s.player_slack_id] || 0) + (s.stars || 0);
  }
  let maxStars = 0, starPid = null;
  for (const [pid, count] of Object.entries(starsByPlayer)) {
    if (count > maxStars) { maxStars = count; starPid = pid; }
  }
  if (starPid && maxStars > 0) {
    pool.push({ id: "star-player", text: `:star: *Star Player* — ${names.get(starPid)} with ${maxStars} star${maxStars > 1 ? "s" : ""}` });
  }

  // Biggest Villain: most villain hands (skip last hand)
  const villainCounts = {};
  for (const h of gameHands) {
    if (h === lastHand) continue;
    const handScores = allScores.filter((s) => s.hand === h);
    if (handScores.length < 2) continue;
    const maxEff = Math.max(...handScores.map((s) => (s.raw_score || 0) + (s.stars || 0) * 10));
    const maxRaw = Math.max(...handScores.map((s) => s.raw_score || 0));
    const effWinners = handScores.filter((s) => (s.raw_score || 0) + (s.stars || 0) * 10 === maxEff);
    const rawWinners = handScores.filter((s) => (s.raw_score || 0) === maxRaw);
    if (effWinners.length === 1 && rawWinners.length === 1 && effWinners[0].player_slack_id !== rawWinners[0].player_slack_id) {
      const vPid = effWinners[0].player_slack_id;
      villainCounts[vPid] = (villainCounts[vPid] || 0) + 1;
    }
  }
  let maxVillain = 0, villainPid = null;
  for (const [pid, count] of Object.entries(villainCounts)) {
    if (count > maxVillain) { maxVillain = count; villainPid = pid; }
  }
  if (villainPid && maxVillain > 0) {
    pool.push({ id: "villain", text: `:smiling_imp: *Biggest Villain* — ${names.get(villainPid)} stole ${maxVillain} hand${maxVillain > 1 ? "s" : ""}` });
  }

  // Most Improved: biggest positive difference between first half and second half avg
  const midpoint = gameHands[Math.floor(gameHands.length / 2)];
  let bestImprovement = -Infinity, improvedPid = null;
  for (const pid of allPlayerIds) {
    const firstHalf = allScores.filter((s) => s.player_slack_id === pid && s.hand < midpoint);
    const secondHalf = allScores.filter((s) => s.player_slack_id === pid && s.hand >= midpoint);
    if (firstHalf.length === 0 || secondHalf.length === 0) continue;
    const avgFirst = firstHalf.reduce((sum, s) => sum + (s.raw_score || 0), 0) / firstHalf.length;
    const avgSecond = secondHalf.reduce((sum, s) => sum + (s.raw_score || 0), 0) / secondHalf.length;
    const improvement = avgSecond - avgFirst;
    if (improvement > bestImprovement) {
      bestImprovement = improvement;
      improvedPid = pid;
    }
  }
  if (improvedPid && bestImprovement > 0) {
    pool.push({ id: "most-improved", text: `:chart_with_upwards_trend: *Most Improved* — ${names.get(improvedPid)} (+${Math.round(bestImprovement)} avg pts in second half)` });
  }

  // Strong Finish: highest raw score on the last hand (must be > 62)
  const firstHand = gameHands[0];
  const lastHandScores = allScores.filter((s) => s.hand === lastHand);
  if (lastHandScores.length > 0) {
    const best = lastHandScores.reduce((a, b) => ((a.raw_score || 0) > (b.raw_score || 0) ? a : b));
    if ((best.raw_score || 0) > 62) {
      pool.push({ id: "strong-finish", text: `:checkered_flag: *Strong Finish* — ${names.get(best.player_slack_id)} with ${best.raw_score} pts on Hand ${lastHand}` });
    }
  }

  // Strong Start: highest raw score on the first hand (must be > 20)
  const firstHandScores = allScores.filter((s) => s.hand === firstHand);
  if (firstHandScores.length > 0) {
    const best = firstHandScores.reduce((a, b) => ((a.raw_score || 0) > (b.raw_score || 0) ? a : b));
    if ((best.raw_score || 0) > 20) {
      pool.push({ id: "strong-start", text: `:rocket: *Strong Start* — ${names.get(best.player_slack_id)} with ${best.raw_score} pts on Hand ${firstHand}` });
    }
  }

  // Pick up to 4 superlatives from the pool, rotating via game_number
  if (pool.length === 0) return;
  const maxAwards = Math.min(4, pool.length);
  // Shuffle deterministically based on game_number so different games highlight different things
  const seeded = pool.map((a, i) => ({ ...a, sort: ((game.game_number || 0) * 7 + i * 13) % 97 }));
  seeded.sort((a, b) => a.sort - b.sort);
  const awards = seeded.slice(0, maxAwards).map((a) => a.text);

  const msgBlocks = [
    { type: "section", text: { type: "mrkdwn", text: `*Game #${game.game_number} — Superlatives*\n\n${awards.join("\n")}` } },
  ];
  await dmAllPlayers(allPlayerIds, { text: "Game superlatives:", blocks: msgBlocks });
}

// ── Player Stats Update ────────────────────────────────

async function updatePlayerStats(game, allScores) {
  const startHands = game.player_start_hands || {};
  const totals = aggregateScores(allScores);

  // A player has a "complete" game only if they started at the first hand (played all hands)
  const gameHands = getHandRange(game.game_type);
  const firstHand = gameHands[0];
  const completePlayers = game.players.filter((pid) => (startHands[pid] || firstHand) === firstHand);

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

  // Compute screwed/villain counts per player across all hands
  // No villain on the last hand (no deal afterward)
  const screwedCounts = new Map(); // times_hand_screwed per player
  const screwedOthersCounts = new Map(); // times_screwed_others per player
  const lastGameHand = gameHands[gameHands.length - 1];
  const hands = [...new Set(allScores.map((s) => s.hand))];
  for (const h of hands) {
    if (h === lastGameHand) continue; // no villain on last hand
    const handScores = allScores.filter((s) => s.hand === h);
    if (handScores.length < 2) continue;

    // Effective score = raw_score + (stars * 10)
    const withEff = handScores.map((s) => ({
      pid: s.player_slack_id,
      raw: s.raw_score || 0,
      eff: (s.raw_score || 0) + (s.stars || 0) * 10,
    }));

    // Find single highest effective score player
    const maxEff = Math.max(...withEff.map((p) => p.eff));
    const effWinners = withEff.filter((p) => p.eff === maxEff);

    // Find single highest raw score player
    const maxRaw = Math.max(...withEff.map((p) => p.raw));
    const rawWinners = withEff.filter((p) => p.raw === maxRaw);

    // Both must be single winners (no ties) and must differ
    if (effWinners.length === 1 && rawWinners.length === 1 && effWinners[0].pid !== rawWinners[0].pid) {
      const rawWinnerId = rawWinners[0].pid;
      const effWinnerId = effWinners[0].pid;
      screwedCounts.set(rawWinnerId, (screwedCounts.get(rawWinnerId) || 0) + 1);
      screwedOthersCounts.set(effWinnerId, (screwedOthersCounts.get(effWinnerId) || 0) + 1);
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
      incompleteGames: isComplete ? 0 : 1,
      wins: isComplete && playerId === winnerId ? 1 : 0,
      stars: t.stars,
      mulligans: playerMulligans,
      handScrewed: screwedCounts.get(playerId) || 0,
      screwedOthers: screwedOthersCounts.get(playerId) || 0,
    });
  }
}


// ── Vote Handlers ─────────────────────────────────────

async function handleVoteWord(payload, action) {
  const userId = payload.user.id;
  let ctx;
  try { ctx = JSON.parse(action.value); } catch { return; }
  const { game_id, hand, words, invalid_words, button_pressed_at, chosen } = ctx;

  // Vote button is always rendered (so its position never shifts) but is only
  // actionable when the modal is in dictionary-rejection state.
  if (!Array.isArray(invalid_words) || invalid_words.length === 0) return;

  try {
    await startWordVote({ userId, game_id, hand, words, invalid_words, chosen, button_pressed_at });
  } catch (err) {
    console.warn("startWordVote failed:", err.message);
    return;
  }

  // Update the submitter's modal to "waiting" state
  try {
    await slack().views.update({
      view_id: payload.view.id,
      view: blocks.voteWaitingModal(hand, invalid_words),
    });
  } catch (err) {
    console.warn("Failed to update modal:", err.message);
  }
}

async function handleCheckWords(payload, action) {
  let ctx;
  try { ctx = JSON.parse(action.value); } catch { return; }
  const { game_id, hand, button_pressed_at, invalid_words, chosen } = ctx;

  const values = payload.view.state.values;
  const wordsInput = values.words_block?.words?.value || "";

  const testResult = wordsInput.trim() ? await validateWords(wordsInput) : { valid: [], invalid: [] };

  const view = blocks.handScoreModal(game_id, hand, button_pressed_at, {
    wordsInput,
    testResult,
    invalidWords: invalid_words || null,
    chosen: chosen || null,
  });

  try {
    await slack().views.update({ view_id: payload.view.id, view });
  } catch (err) {
    console.warn("Failed to update modal (check words):", err.message);
  }
}

async function handleVoteResponse(payload, action) {
  const voterId = payload.user.id;
  const voteId = action.value;
  const isYes = action.action_id === "qbim_vote_yes";

  const vote = await db.getVote(voteId);
  if (!vote || vote.status !== "open") return;

  // Record vote
  vote.votes[voterId] = isYes ? "yes" : "no";
  await db.putVote(vote);

  // Update voter's poll message to show their choice
  const pollMsg = vote.poll_messages?.[voterId];
  if (pollMsg) {
    const bad = vote.invalid_words.map((w) => `*${w}*`).join(", ");
    try {
      await slack().chat.update({
        channel: pollMsg.channel,
        ts: pollMsg.ts,
        text: `You voted ${isYes ? "✅ Yes" : "❌ No"}`,
        blocks: [{
          type: "section",
          text: { type: "mrkdwn", text: `🗳️ You voted ${isYes ? "✅ Yes" : "❌ No"} for ${bad}. Waiting for others…` },
        }],
      });
    } catch (err) {
      console.warn("Failed to update poll message:", err.message);
    }
  }

  // Check for early resolution
  const yesCount = Object.values(vote.votes).filter((v) => v === "yes").length;
  const noCount = Object.values(vote.votes).filter((v) => v === "no").length;
  const remaining = vote.voters.length - yesCount - noCount;

  // Approved early: even if all remaining vote no, yes still >2/3
  const approvedEarly = yesCount * 3 > (vote.voters.length) * 2;
  // Rejected early: even if all remaining vote yes, can't reach >2/3
  const rejectedEarly = (yesCount + remaining) * 3 <= (vote.voters.length) * 2;

  if (approvedEarly || rejectedEarly || remaining === 0) {
    const approved = approvedEarly || (yesCount * 3 > (yesCount + noCount) * 2);
    await resolveVote(vote, approved);
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
