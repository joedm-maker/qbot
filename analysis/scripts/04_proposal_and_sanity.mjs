// Synthesis: propose new point values + run sanity checks.
//
// Scope (from user direction):
//   - Per-letter counts FIXED at Quiddler defaults.
//   - Add CH as a new card (count 2 = conventional digraph count, leaving 6 of the 126-target slots open).
//   - Retune point values only, where data supports a move.
//   - CH discounted vs C+H=15; user range 10-12.
//
// Decision rules used here:
//   - Don't move a value unless ≥2 independent signals agree.
//   - "Iconic" Quiddler letters (Q=15, Z=14, J=13, X=12, V=11, W=10) — held even where data slightly disagrees.
//   - Strong corpus+playtest+rejection convergence required to move a value.

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const DATA = path.join(ROOT, "data");

const corpus = JSON.parse(fs.readFileSync(path.join(DATA, "corpus_summary.json"), "utf8"));
const playtest = JSON.parse(fs.readFileSync(path.join(DATA, "playtest_summary.json"), "utf8"));
const rejected = JSON.parse(fs.readFileSync(path.join(DATA, "rejected_summary.json"), "utf8"));

const QUIDDLER_COUNTS = {
  A: 10, B: 2, C: 2, D: 4, E: 12, F: 2, G: 4, H: 2,
  I: 8, J: 2, K: 2, L: 4, M: 2, N: 6, O: 8, P: 2,
  Q: 2, R: 6, S: 4, T: 6, U: 6, V: 2, W: 2, X: 2,
  Y: 4, Z: 2,
  QU: 2, IN: 2, ER: 2, CL: 2, TH: 2,
};
const QUIDDLER_VALUES = {
  A: 2, B: 8, C: 8, D: 5, E: 2, F: 6, G: 6, H: 7,
  I: 2, J: 13, K: 8, L: 3, M: 5, N: 5, O: 2, P: 6,
  Q: 15, R: 5, S: 3, T: 3, U: 4, V: 11, W: 10, X: 12,
  Y: 4, Z: 14,
  QU: 9, IN: 7, ER: 7, CL: 10, TH: 9,
};

// === Proposed counts (deck total 120 cards = Quiddler 118 + CH×2; 6 slots vs 126 target deferred) ===
const PROPOSED_COUNTS = { ...QUIDDLER_COUNTS, CH: 2 };

// === Proposed values ===
//   CH = 11   (new; 4-pt discount vs C+H=15, mid of user 10-12 range)
//   U  = 5    (was 4) — top-hands over-rep +27%, rejected-words over-rep +30%, Q-enabler
//   G  = 5    (was 6) — G is 2x more common in corpus than F (which stays at 6)
//   Y  = 5    (was 4) — playtest +61% over corpus, rejected +24% over playtest, dual-role
// Everything else holds Quiddler.
const PROPOSED_VALUES = {
  ...QUIDDLER_VALUES,
  U: 5,
  G: 5,
  Y: 5,
  CH: 11,
};

// ── Sanity 1: deck totals ─────────────────────────────
function deckTotal(counts, values) {
  let total = 0, cards = 0;
  for (const k of Object.keys(counts)) {
    total += counts[k] * values[k];
    cards += counts[k];
  }
  return { total, cards, avg: +(total / cards).toFixed(3) };
}
const oldDeck = deckTotal(QUIDDLER_COUNTS, QUIDDLER_VALUES);
const newDeck = deckTotal(PROPOSED_COUNTS, PROPOSED_VALUES);
console.log("=== Deck totals ===");
console.log(`Quiddler:  ${oldDeck.cards} cards, ${oldDeck.total} pts (avg ${oldDeck.avg}/card)`);
console.log(`Proposed:  ${newDeck.cards} cards, ${newDeck.total} pts (avg ${newDeck.avg}/card)`);

// ── Sanity 2: comparison table ────────────────────────
const ALL_KEYS = [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ".split(""), "QU", "IN", "ER", "CL", "TH", "CH"];
console.log("\n=== Comparison vs Quiddler ===");
console.log("Card | QC | NC | ΔC | QV | NV | ΔV | Notes");
for (const k of ALL_KEYS) {
  const qc = QUIDDLER_COUNTS[k] ?? 0;
  const nc = PROPOSED_COUNTS[k] ?? 0;
  const qv = QUIDDLER_VALUES[k] ?? "-";
  const nv = PROPOSED_VALUES[k] ?? "-";
  const dc = nc - qc;
  const dv = (typeof nv === "number" && typeof qv === "number") ? nv - qv : "-";
  console.log(`${k.padEnd(4)} | ${String(qc).padStart(2)} | ${String(nc).padStart(2)} | ${String(dc).padStart(2)} | ${String(qv).padStart(2)} | ${String(nv).padStart(2)} | ${String(dv).padStart(2)} |`);
}

// ── Sanity 3: replay top-100 playtest hands under proposed values ──
const scores = JSON.parse(fs.readFileSync(path.join(DATA, "scores.json"), "utf8"));
const wordBearing = scores.filter(s => (s.word_count || 0) > 0 && s.breakdown);

const VALID_CARDS = new Set(Object.keys(PROPOSED_VALUES));

function scoreBreakdown(breakdown, values) {
  let total = 0;
  let parsed = true;
  const wordTokens = String(breakdown).split(/\s{2,}/).map(w => w.trim()).filter(Boolean);
  for (const wt of wordTokens) {
    const cards = wt.split("-").map(c => c.trim().toUpperCase()).filter(Boolean);
    for (const c of cards) {
      if (!VALID_CARDS.has(c)) { parsed = false; continue; }
      total += values[c];
    }
  }
  return { total, parsed };
}

const deltas = [];
for (const s of wordBearing) {
  const oldS = scoreBreakdown(s.breakdown, QUIDDLER_VALUES);
  const newS = scoreBreakdown(s.breakdown, PROPOSED_VALUES);
  if (!oldS.parsed || !newS.parsed) continue;
  // Sanity: oldS.total should match s.raw_score modulo digraph reading nuance
  const reported = s.raw_score || 0;
  deltas.push({
    game_id: s.game_id, hand: s.hand, player: s.player_slack_id, reported,
    oldComputed: oldS.total, newComputed: newS.total,
    delta: newS.total - oldS.total,
  });
}

const reportedMatchedOld = deltas.filter(d => d.reported === d.oldComputed).length;
const meanDelta = deltas.reduce((a, b) => a + b.delta, 0) / deltas.length;
const positiveShift = deltas.filter(d => d.delta > 0).length;
const negativeShift = deltas.filter(d => d.delta < 0).length;
const unchanged = deltas.filter(d => d.delta === 0).length;
console.log("\n=== Playtest replay ===");
console.log(`Hands scored: ${deltas.length}`);
console.log(`Reported = recomputed (old values): ${reportedMatchedOld} / ${deltas.length}`);
console.log(`Mean delta (new − old): ${meanDelta.toFixed(2)} pts/hand`);
console.log(`Hands w/ positive shift: ${positiveShift}`);
console.log(`Hands w/ negative shift: ${negativeShift}`);
console.log(`Hands unchanged: ${unchanged}`);

// By hand size
console.log("\nMean delta by hand size:");
for (let h = 3; h <= 10; h++) {
  const slice = deltas.filter(d => d.hand === h);
  if (!slice.length) continue;
  const m = slice.reduce((a, b) => a + b.delta, 0) / slice.length;
  console.log(`  Hand ${h}: ${slice.length} hands, mean delta ${m.toFixed(2)}`);
}

// Would top scorers shift? Recompute top 20 by raw_score, see new ranks.
const sortedOld = [...deltas].sort((a, b) => b.oldComputed - a.oldComputed);
const sortedNew = [...deltas].sort((a, b) => b.newComputed - a.newComputed);
const top20Old = new Set(sortedOld.slice(0, 20).map(d => `${d.game_id}#${d.hand}#${d.player}`));
const top20New = new Set(sortedNew.slice(0, 20).map(d => `${d.game_id}#${d.hand}#${d.player}`));
let shared = 0;
for (const k of top20Old) if (top20New.has(k)) shared++;
console.log(`\nTop-20 hands stability (old vs new values): ${shared}/20 identical`);

// ── Sanity 4: expected raw score per hand from corpus simulation ──
// Approach: for each hand size H, sample N random distinct corpus words of length L≤(H+3),
// keep only words buildable from a fresh deal, compute hypothetical "best 1-word play" score.
// Simplification: rather than full game sim, we just measure mean letter value per card
// across the corpus weighted by word length — gives "ceiling per card" estimate.
function averageLetterValuePerWord(corpusLetterPct, values) {
  // approximate: mean letter value = sum_l (pct(l) * value(l)) / 100
  let sum = 0;
  for (const l of Object.keys(corpusLetterPct)) {
    if (typeof values[l] === "number") sum += (corpusLetterPct[l] / 100) * values[l];
  }
  return sum;
}
const avgLetterValOld = averageLetterValuePerWord(corpus.enable_length_weighted_pct, QUIDDLER_VALUES);
const avgLetterValNew = averageLetterValuePerWord(corpus.enable_length_weighted_pct, PROPOSED_VALUES);
console.log(`\nMean letter value (length-weighted corpus mix):`);
console.log(`  Quiddler values: ${avgLetterValOld.toFixed(3)} pts/letter`);
console.log(`  Proposed values: ${avgLetterValNew.toFixed(3)} pts/letter`);

// Expected best-word score at each hand size if player builds a word using all H cards
// from the average corpus letter mix:
console.log("\nNotional expected raw score per hand (avg-letter-value * H):");
for (let H = 3; H <= 10; H++) {
  console.log(`  Hand ${H}: old ≈ ${(avgLetterValOld * H).toFixed(1)} pts, new ≈ ${(avgLetterValNew * H).toFixed(1)} pts`);
}

// ── Save proposal summary ─────────────────────────────
fs.writeFileSync(path.join(DATA, "proposal_summary.json"), JSON.stringify({
  proposed_counts: PROPOSED_COUNTS,
  proposed_values: PROPOSED_VALUES,
  deck_total_old: oldDeck,
  deck_total_new: newDeck,
  replay_stats: {
    hands_scored: deltas.length,
    reported_matched_old: reportedMatchedOld,
    mean_delta_per_hand: +meanDelta.toFixed(2),
    positive_shift_hands: positiveShift,
    negative_shift_hands: negativeShift,
    unchanged_hands: unchanged,
    top20_stability: shared,
  },
  avg_letter_value_old: +avgLetterValOld.toFixed(3),
  avg_letter_value_new: +avgLetterValNew.toFixed(3),
}, null, 2));
console.log("\nProposal summary written to analysis/data/proposal_summary.json");
