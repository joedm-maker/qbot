/**
 * Quickler Timer Expiry Handler
 *
 * Invoked by EventBridge Scheduler 30 seconds after the first player
 * submits a hand in a Quickler game. Auto-zeros any players who
 * haven't submitted, then completes the hand.
 */
import * as db from "../lib/db.mjs";
import { renderHome } from "../lib/home.mjs";

export async function handler(event) {
  const { game_id, hand } = event;
  console.log(`Quickler timer fired: game=${game_id} hand=${hand}`);

  const game = await db.getGame(game_id);
  if (!game || game.status !== "ACTIVE") {
    console.log("Game not active, skipping");
    return;
  }

  // Guard: only process if this timer matches the current active timer
  if (game.quickler_timer_hand !== hand) {
    console.log(`Timer hand mismatch: expected ${game.quickler_timer_hand}, got ${hand}`);
    return;
  }

  const startHands = game.player_start_hands || {};
  const eligiblePlayers = game.players.filter((pid) => (startHands[pid] || 3) <= hand);
  const existingScores = await db.getScoresForGameHand(game_id, hand);
  const submittedIds = new Set(existingScores.map((s) => s.player_slack_id));

  // Find players who haven't submitted
  const missing = eligiblePlayers.filter((pid) => !submittedIds.has(pid));

  if (missing.length === 0) {
    console.log("All players already submitted, nothing to do");
    // Clear timer fields just in case
    await db.updateGameAttr(game_id, {
      quickler_timer_started_at: null,
      quickler_timer_hand: null,
      quickler_timer_schedule_name: null,
    });
    return;
  }

  console.log(`Auto-zeroing ${missing.length} player(s):`, missing);

  // Auto-submit zero score for each missing player
  for (const pid of missing) {
    const mulligans = await db.getMulliganCount(game_id, pid, hand);
    await db.putScore({
      game_id,
      player_hand_key: `${pid}#${hand}`,
      player_slack_id: pid,
      hand,
      raw_score: 0,
      words: "",
      word_count: 0,
      longest_word_letters: 0,
      mulligans,
      breakdown: "—",
      stars: 0,
      star_longest_word: false,
      star_most_words: false,
      submitted_at: new Date().toISOString(),
      quickler_timed_out: true,
    });
  }

  // Clear timer fields
  await db.updateGameAttr(game_id, {
    quickler_timer_started_at: null,
    quickler_timer_hand: null,
    quickler_timer_schedule_name: null,
  });

  // Now complete the hand — award stars and announce
  const handScores = await db.getScoresForGameHand(game_id, hand);
  const { autoAwardStars } = await import("./score-entry.mjs");
  await autoAwardStars(game, hand, handScores, true);

  // Refresh all players' home tabs
  await Promise.all(game.players.map((pid) => renderHome(pid).catch((err) => console.warn("Failed to refresh home for:", pid, err.message))));
}
