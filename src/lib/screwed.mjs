import { getHandRange } from "./cards.mjs";

/**
 * Compute per-player "screwed" and "villain" counts across a game's hands.
 *
 * - screwed ("times_hand_screwed"): had the top raw score on a hand but lost
 *   it to another player's stars.
 * - screwed others / villain ("times_screwed_others"): was the sole effective
 *   winner of a hand while their raw score was below the top raw — a star
 *   pushed them past whoever actually scored highest on cards.
 *
 * No villain on the last hand (no deal follows it). A stolen hand credits the
 * villain once and every tied top-raw leader as screwed, so a single theft
 * from two co-leaders counts as two "screwed" events. Pure and dependency-light
 * so both live scoring (updatePlayerStats) and the backfill script share it and
 * never drift.
 *
 * @returns {{ screwedCounts: Map<string, number>, screwedOthersCounts: Map<string, number> }}
 */
export function computeScrewedCounts(game, allScores) {
  const gameHands = getHandRange(game.game_type);
  const lastGameHand = gameHands[gameHands.length - 1];
  const screwedCounts = new Map(); // times_hand_screwed per player
  const screwedOthersCounts = new Map(); // times_screwed_others per player
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

    // Single highest effective score player
    const maxEff = Math.max(...withEff.map((p) => p.eff));
    const effWinners = withEff.filter((p) => p.eff === maxEff);

    // Top raw score (may be tied by several players)
    const maxRaw = Math.max(...withEff.map((p) => p.raw));
    const rawWinners = withEff.filter((p) => p.raw === maxRaw);

    // A hand is "stolen" when there's a single effective winner whose raw
    // score is below the top raw. Ties among the raw leaders don't change
    // that: the villain screwed ALL of them, so credit each raw leader.
    if (effWinners.length === 1 && effWinners[0].raw < maxRaw) {
      const effWinnerId = effWinners[0].pid;
      screwedOthersCounts.set(effWinnerId, (screwedOthersCounts.get(effWinnerId) || 0) + 1);
      for (const victim of rawWinners) {
        screwedCounts.set(victim.pid, (screwedCounts.get(victim.pid) || 0) + 1);
      }
    }
  }
  return { screwedCounts, screwedOthersCounts };
}
