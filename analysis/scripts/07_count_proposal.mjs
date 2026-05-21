// Count proposal: hold point values at Quiddler defaults, allocate 8 spare slots (118 → 126).
// Proposal tiers:
//   Tier 1 (strong, 6 slots): +1 B, +1 P, +2 CH, +2 SH
//   Tier 2 (moderate, 2 slots): +2 CK   ← preferred
//   Alternatives noted in report
//
// Sanity: replay each played hand. For each played breakdown, detect adjacent-card pairs
// that could be compressed by a proposed new digraph card (CH, SH, CK). Report potential
// card-slot savings and score deltas.

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const DATA = path.join(ROOT, "data");

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

// Proposed (Tier 1+2 final recommendation):
//   B: 2 → 3, P: 2 → 3
//   Add: CH×2, SH×2, CK×2
// Values held constant; CH/SH/CK get newly assigned values per neutrality / discount logic:
//   CH = 11 (per AUTOQ_POINT_VALUES.md proposal — used here only for sanity sim score deltas)
//   SH = 10 (S=3 + H=7 = 10; mark neutral like ER/IN)
//   CK = 14 (C=8 + K=8 = 16; 2-pt discount, parallel to CL=10 vs C+L=11) — judgment call
const PROPOSED_COUNTS = {
  ...QUIDDLER_COUNTS,
  B: 3, P: 3,
  CH: 2, SH: 2, CK: 2,
};
const PROPOSED_VALUES = {
  ...QUIDDLER_VALUES,
  CH: 11, SH: 10, CK: 14,
};

function deckTotal(counts, values) {
  let total = 0, cards = 0;
  for (const k of Object.keys(counts)) {
    total += counts[k] * (values[k] || 0);
    cards += counts[k];
  }
  return { total, cards, avg: +(total / cards).toFixed(3) };
}

const oldDeck = deckTotal(QUIDDLER_COUNTS, QUIDDLER_VALUES);
const newDeck = deckTotal(PROPOSED_COUNTS, PROPOSED_VALUES);
console.log("=== Deck totals ===");
console.log(`Quiddler:  ${oldDeck.cards} cards, ${oldDeck.total} pts (avg ${oldDeck.avg}/card)`);
console.log(`Proposed:  ${newDeck.cards} cards, ${newDeck.total} pts (avg ${newDeck.avg}/card)`);

// Per-letter effective supply
function effectiveSupply(counts) {
  const eff = {};
  const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
  for (const l of LETTERS) eff[l] = counts[l] || 0;
  for (const k of Object.keys(counts)) {
    if (k.length === 2) {
      eff[k[0]] += counts[k];
      eff[k[1]] += counts[k];
    }
  }
  return eff;
}
const oldEff = effectiveSupply(QUIDDLER_COUNTS);
const newEff = effectiveSupply(PROPOSED_COUNTS);

console.log("\n=== Effective per-letter supply change ===");
console.log("Lt | Old eff | New eff | Δ");
const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
for (const l of LETTERS) {
  const d = newEff[l] - oldEff[l];
  if (d === 0) continue;
  console.log(`${l}  | ${String(oldEff[l]).padStart(7)} | ${String(newEff[l]).padStart(7)} | ${d > 0 ? "+" : ""}${d}`);
}

// ── Playtest sanity sim ─────────────────────────────────────
// For each played breakdown, detect adjacent single-card pairs that could compress to a proposed digraph.
const NEW_DIGRAPHS = ["CH", "SH", "CK"];
const scores = JSON.parse(fs.readFileSync(path.join(DATA, "scores.json"), "utf8"));
const wordBearing = scores.filter(s => (s.word_count || 0) > 0 && s.breakdown);

let totalHandsScanned = 0;
const compressionOpportunities = { CH: 0, SH: 0, CK: 0 };
const handsWithOpportunity = new Set();
const compressionDetailsByHand = {};

for (const s of wordBearing) {
  totalHandsScanned++;
  const breakdown = String(s.breakdown);
  const wordTokens = breakdown.split(/\s{2,}/).map(w => w.trim()).filter(Boolean);
  for (const wt of wordTokens) {
    const cards = wt.split("-").map(c => c.trim().toUpperCase()).filter(Boolean);
    for (let i = 0; i < cards.length - 1; i++) {
      const pair = cards[i] + cards[i+1];
      if (NEW_DIGRAPHS.includes(pair)) {
        compressionOpportunities[pair]++;
        handsWithOpportunity.add(`${s.game_id}#${s.hand}#${s.player_slack_id}`);
        const key = `${s.game_id}#${s.hand}#${s.player_slack_id}`;
        if (!compressionDetailsByHand[key]) compressionDetailsByHand[key] = [];
        compressionDetailsByHand[key].push(pair);
      }
    }
  }
}

console.log("\n=== Sanity sim: compression opportunities in played hands ===");
console.log(`Hands scanned: ${totalHandsScanned}`);
console.log(`Hands with at least one new-digraph compression opportunity: ${handsWithOpportunity.size}`);
for (const d of NEW_DIGRAPHS) {
  console.log(`  ${d}: ${compressionOpportunities[d]} adjacent-pair occurrences in played cards`);
}

// Score-delta if compressed
console.log("\nScore impact if compressed:");
for (const d of NEW_DIGRAPHS) {
  const a = d[0], b = d[1];
  const oldScore = QUIDDLER_VALUES[a] + QUIDDLER_VALUES[b];
  const newScore = PROPOSED_VALUES[d];
  const delta = newScore - oldScore;
  console.log(`  ${d}: ${a}(${QUIDDLER_VALUES[a]}) + ${b}(${QUIDDLER_VALUES[b]}) = ${oldScore}  →  ${d} = ${newScore}  (Δ ${delta > 0 ? "+" : ""}${delta} pts, frees 1 card slot)`);
}

// What did existing CL/QU/TH digraphs look like by playtest compression?
const EXISTING_DIGRAPHS = ["CL", "QU", "TH", "ER", "IN"];
console.log("\n=== For reference: existing digraph compression rates in playtest ===");
for (const d of EXISTING_DIGRAPHS) {
  let asDigraph = 0;
  let asSplit = 0;
  for (const s of wordBearing) {
    const wordTokens = String(s.breakdown).split(/\s{2,}/).map(w => w.trim()).filter(Boolean);
    for (const wt of wordTokens) {
      const cards = wt.split("-").map(c => c.trim().toUpperCase()).filter(Boolean);
      for (const c of cards) if (c === d) asDigraph++;
      for (let i = 0; i < cards.length - 1; i++) {
        if (cards[i] === d[0] && cards[i+1] === d[1]) asSplit++;
      }
    }
  }
  console.log(`  ${d}: ${asDigraph} as digraph card, ${asSplit} as adjacent split (${asDigraph + asSplit > 0 ? (asDigraph/(asDigraph+asSplit)*100).toFixed(1) : 0}% digraph pref)`);
}

// Comparison table
console.log("\n=== Count comparison vs Quiddler ===");
console.log("Card | Quiddler | Proposed | Δ | Note");
const ALL_KEYS = [...LETTERS, "QU", "IN", "ER", "CL", "TH", "CH", "SH", "CK"];
for (const k of ALL_KEYS) {
  const qc = QUIDDLER_COUNTS[k] || 0;
  const nc = PROPOSED_COUNTS[k] || 0;
  const d = nc - qc;
  const flag = d !== 0 ? "★" : "";
  console.log(`${k.padEnd(4)} | ${String(qc).padStart(8)} | ${String(nc).padStart(8)} | ${String(d).padStart(2)} | ${flag}`);
}

fs.writeFileSync(path.join(DATA, "count_proposal.json"), JSON.stringify({
  proposed_counts: PROPOSED_COUNTS,
  proposed_values: PROPOSED_VALUES,
  old_deck: oldDeck,
  new_deck: newDeck,
  old_effective_supply: oldEff,
  new_effective_supply: newEff,
  compression_opportunities: compressionOpportunities,
  hands_with_opportunity: handsWithOpportunity.size,
  total_hands_scanned: totalHandsScanned,
}, null, 2));
console.log("\nCount proposal written to analysis/data/count_proposal.json");
