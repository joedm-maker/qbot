import { test } from "node:test";
import assert from "node:assert/strict";
import { computeScrewedCounts } from "./screwed.mjs";

// Minimal score row for a QBIM-style game (hands 3-10).
const score = (pid, hand, raw, stars = 0) => ({
  player_slack_id: pid,
  hand,
  raw_score: raw,
  stars,
});
const game = { game_type: "QBIM" };

test("star steals a hand from two tied raw leaders: villain + both leaders screwed", () => {
  // Hand 3: P1 and P2 tie at raw 20; P3 has raw 15 + a star (eff 25) and
  // wins the hand. This is the case the old rawWinners===1 gate dropped.
  const scores = [
    score("P1", 3, 20),
    score("P2", 3, 20),
    score("P3", 3, 15, 1),
  ];
  const { screwedCounts, screwedOthersCounts } = computeScrewedCounts(game, scores);
  assert.equal(screwedOthersCounts.get("P3"), 1, "P3 is the villain");
  assert.equal(screwedOthersCounts.size, 1, "no other villains");
  assert.equal(screwedCounts.get("P1"), 1, "P1 got screwed");
  assert.equal(screwedCounts.get("P2"), 1, "P2 got screwed");
  assert.equal(screwedCounts.size, 2, "exactly the two tied leaders screwed");
});

test("star winner who already held the top raw is not a villain", () => {
  // P1 has the top raw AND a star — legitimately winning, not stealing.
  const scores = [
    score("P1", 3, 20, 1),
    score("P2", 3, 18),
    score("P3", 3, 15),
  ];
  const { screwedCounts, screwedOthersCounts } = computeScrewedCounts(game, scores);
  assert.equal(screwedOthersCounts.size, 0);
  assert.equal(screwedCounts.size, 0);
});

test("no villain is credited on the last hand (no deal follows it)", () => {
  const scores = [
    score("P1", 10, 20),
    score("P2", 10, 20),
    score("P3", 10, 15, 1),
  ];
  const { screwedCounts, screwedOthersCounts } = computeScrewedCounts(game, scores);
  assert.equal(screwedOthersCounts.size, 0);
  assert.equal(screwedCounts.size, 0);
});

test("hands with fewer than two players are skipped", () => {
  const scores = [score("P3", 3, 15, 1)];
  const { screwedCounts, screwedOthersCounts } = computeScrewedCounts(game, scores);
  assert.equal(screwedOthersCounts.size, 0);
  assert.equal(screwedCounts.size, 0);
});
