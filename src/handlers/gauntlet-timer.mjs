/**
 * Gauntlet Race Timer Handler
 *
 * Invoked by EventBridge Scheduler 60 seconds after the first player
 * finishes all 8 hands in a Gauntlet game. Auto-zeros every eligible
 * player's unsubmitted hands, then finalizes the game.
 */
import * as db from "../lib/db.mjs";
import { renderHome } from "../lib/home.mjs";

const ALL_HANDS = [3, 4, 5, 6, 7, 8, 9, 10];

export async function handler(event) {
  const { game_id } = event;
  console.log(`Gauntlet race timer fired: game=${game_id}`);

  const game = await db.getGame(game_id);
  if (!game || game.status === "COMPLETE") {
    console.log("Game not active, skipping");
    return;
  }
  if (game.game_type !== "Gauntlet") {
    console.log(`Game ${game_id} is not Gauntlet, skipping`);
    return;
  }

  // Build a map of submitted (player, hand) so we know what to zero.
  const allScores = await db.getScoresForGame(game_id);
  const submitted = new Set();
  for (const s of allScores) submitted.add(`${s.player_slack_id}#${s.hand}`);

  const startHands = game.player_start_hands || {};
  const toZero = [];
  for (const pid of game.players) {
    const required = ALL_HANDS.filter((h) => (startHands[pid] || 3) <= h);
    for (const h of required) {
      if (!submitted.has(`${pid}#${h}`)) toZero.push({ pid, hand: h });
    }
  }

  console.log(`Auto-zeroing ${toZero.length} (player, hand) pairs`);

  for (const { pid, hand } of toZero) {
    await db.putScore({
      game_id,
      player_hand_key: `${pid}#${hand}`,
      player_slack_id: pid,
      hand,
      raw_score: 0,
      words: "",
      word_count: 0,
      longest_word_letters: 0,
      mulligans: 0,
      breakdown: "—",
      stars: 0,
      star_longest_word: false,
      star_most_words: false,
      submitted_at: new Date().toISOString(),
      gauntlet_timed_out: true,
    });
  }

  // Clear the race timer marker and trigger finalize. finalizeGame for
  // Gauntlet loops H3-H10 awarding stars before posting the leaderboard,
  // so the zeroed hands feed into star calculation naturally.
  await db.updateGameAttr(game_id, {
    gauntlet_race_started_at: null,
    gauntlet_race_schedule_name: null,
  });

  const { finalizeGame } = await import("./score-entry.mjs");
  await finalizeGame(game_id);

  await Promise.all(game.players.map((pid) =>
    renderHome(pid).catch((err) => console.warn("Failed to refresh home for:", pid, err.message))
  ));
}
