// Value tuning: given user-fixed deck composition (126 cards including +1B, +1P, +2 CH/SH/CK)
// and user-fixed values (SH=9, CK=12; G=5, U=5 protected from revert),
// find data-defensible value adjustments that bring avg pts/card from 5.37 toward 5.0.
//
// Approach: enumerate a candidate adjustment set per letter, score each set's
// data-defensibility, and emit two final proposals (one targeting ~5.05, one targeting ~5.00).

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const DATA = path.join(ROOT, "data");

const corpus = JSON.parse(fs.readFileSync(path.join(DATA, "corpus_summary.json"), "utf8"));
const playtest = JSON.parse(fs.readFileSync(path.join(DATA, "playtest_summary.json"), "utf8"));

// Deck composition (fixed by user — count proposal adopted)
const COUNTS = {
  A: 10, B: 3, C: 2, D: 4, E: 12, F: 2, G: 4, H: 2,
  I: 8, J: 2, K: 2, L: 4, M: 2, N: 6, O: 8, P: 3,
  Q: 2, R: 6, S: 4, T: 6, U: 6, V: 2, W: 2, X: 2,
  Y: 4, Z: 2,
  QU: 2, IN: 2, ER: 2, CL: 2, TH: 2, CH: 2, SH: 2, CK: 2,
};

// Starting values: AUTOQ_POINT_VALUES.md proposal + user's SH=9, CK=12 override
const START_VALUES = {
  A: 2, B: 8, C: 8, D: 5, E: 2, F: 6, G: 5, H: 7,
  I: 2, J: 13, K: 8, L: 3, M: 5, N: 5, O: 2, P: 6,
  Q: 15, R: 5, S: 3, T: 3, U: 5, V: 11, W: 10, X: 12,
  Y: 5, Z: 14,
  QU: 9, IN: 7, ER: 7, CL: 10, TH: 9, CH: 11,
  SH: 9, CK: 12,  // user-specified
};

// Protected (cannot move): G=5, U=5 (per user direction); SH=9, CK=12 (per user direction)
const LOCKED = new Set(["G", "U", "SH", "CK"]);

function deckTotal(counts, values) {
  let total = 0, cards = 0;
  for (const k of Object.keys(counts)) {
    total += counts[k] * (values[k] || 0);
    cards += counts[k];
  }
  return { total, cards, avg: +(total / cards).toFixed(3) };
}

function applyAdjustments(base, adj) {
  const v = { ...base };
  for (const [k, val] of Object.entries(adj)) v[k] = val;
  return v;
}

const start = deckTotal(COUNTS, START_VALUES);
console.log(`Starting deck:  ${start.cards} cards, ${start.total} pts, avg ${start.avg}/card`);

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

const eff = effectiveSupply(COUNTS);
const totalSupply = Object.values(eff).reduce((a, b) => a + b, 0);

console.log("\n=== Letter supply % vs corpus length-weighted % (data defensibility for moves) ===");
console.log("Lt | Eff supply | Supply% | Corpus% | Δ rel | Playtest% | move direction signal");
const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
for (const l of LETTERS) {
  const sp = +(eff[l] / totalSupply * 100).toFixed(2);
  const cp = corpus.enable_length_weighted_pct[l];
  const pp = playtest.playtest_letter_pct[l];
  const rel = +(((sp - cp) / cp) * 100).toFixed(0);
  // Move direction: positive Δ (over-supplied) + low playtest → could come DOWN
  const overSupplied = rel > 15;
  const underPlayed = pp < sp;
  const direction = overSupplied && underPlayed ? "↓ candidate" : (overSupplied ? "↓ if effective supply > demand" : "");
  console.log(`${l}  | ${String(eff[l]).padStart(8)} | ${String(sp).padStart(6)} | ${String(cp).padStart(6)} | ${String(rel).padStart(5)}% | ${String(pp).padStart(7)} | ${direction}`);
}

// === Two candidate proposals ===

// Proposal A — "Targeted 11 moves, lands ~5.08"
// Lower mid-frequency letters where effective supply outpaces corpus demand and playtest play rate.
// Keeps iconic Quiddler bombs (Q/Z/J/X/V/W) untouched. Keeps T at 3 to preserve TH discount.
const PROPOSAL_A = {
  Y: 4,   // revert weakest values-report move
  B: 7,   // 3 copies now, less scarce
  P: 5,   // 3 copies now, parity with G
  CH: 10, // parity with CL (both C-anchored discount digraphs)
  N: 4,   // eff supply 8 with IN; corpus 6.36%, supply 6.25% — close, but playtest plays it +8% over supply; -1 still defensible
  R: 4,   // eff supply 8 with ER; corpus 7.25%, supply 6.25% — modest under-supply, but R already common at value 5
  D: 4,   // 3.87% corpus, supply 3.13%; -1 reflects mid-frequency commodity
  H: 6,   // eff supply doubled (4 → 8) via CH+SH+TH; H=6 reflects new abundance
  M: 4,   // under-played in playtest (-40% vs corpus); 5 was high
  F: 5,   // close to G=5 in corpus terms (F 1.38% vs G 2.94%) — F=5 narrows the gap
  K: 7,   // eff supply doubled via CK; K=7 reflects less scarcity
};

// Proposal B — "Hit exactly 5.0, light bomb tier shift adds 6 more moves"
// Same as A plus -1 across each Quiddler bomb (Q/Z/J/X/V/W). 17 moves total.
const PROPOSAL_B = {
  ...PROPOSAL_A,
  Q: 14, Z: 13, J: 12, X: 11, V: 10, W: 9,
};

function showProposal(name, adj) {
  const newValues = applyAdjustments(START_VALUES, adj);
  const d = deckTotal(COUNTS, newValues);
  console.log(`\n=== ${name} ===`);
  console.log(`Deck: ${d.cards} cards, ${d.total} pts, avg ${d.avg}/card  (target 5.0)`);
  console.log("Moves:");
  let totalDelta = 0;
  for (const [k, v] of Object.entries(adj)) {
    if (LOCKED.has(k)) { console.log(`  ${k}: LOCKED but adjusted (BUG)`); continue; }
    const old = START_VALUES[k];
    const delta = (v - old) * COUNTS[k];
    totalDelta += delta;
    console.log(`  ${k}: ${old} → ${v}  (${COUNTS[k]} cards × ${v - old} = ${delta > 0 ? "+" : ""}${delta} pts)`);
  }
  console.log(`Total Δ: ${totalDelta > 0 ? "+" : ""}${totalDelta} pts`);
}

showProposal("Proposal A — 11 moves, avg 5.08", PROPOSAL_A);
showProposal("Proposal B — 17 moves, avg 5.00 (hits target exactly)", PROPOSAL_B);

// === Digraph math sanity check after H reduction ===
console.log("\n=== Digraph discount math under H=6, K=7 ===");
function digraphCheck(values, d) {
  const a = d[0], b = d[1];
  const aV = values[a];
  const bV = values[b];
  const dV = values[d];
  const sum = aV + bV;
  const diff = sum - dV;
  const status = diff > 0 ? `${diff}-pt discount` : diff < 0 ? `${-diff}-pt PENALTY` : "neutral";
  return { digraph: d, constituent_sum: sum, digraph_value: dV, status };
}

const finalA = applyAdjustments(START_VALUES, PROPOSAL_A);
for (const d of ["QU", "IN", "ER", "CL", "TH", "CH", "SH", "CK"]) {
  const r = digraphCheck(finalA, d);
  console.log(`  ${d}: ${d[0]}(${finalA[d[0]]}) + ${d[1]}(${finalA[d[1]]}) = ${r.constituent_sum}, ${d} = ${r.digraph_value}  →  ${r.status}`);
}

// === Compare to playtest replay for top hands ===
const scores = JSON.parse(fs.readFileSync(path.join(DATA, "scores.json"), "utf8"));
const wordBearing = scores.filter(s => (s.word_count || 0) > 0 && s.breakdown);
const VALID = new Set(Object.keys(finalA));
function scoreBreakdown(breakdown, values) {
  let total = 0;
  let parsed = true;
  const wordTokens = String(breakdown).split(/\s{2,}/).map(w => w.trim()).filter(Boolean);
  for (const wt of wordTokens) {
    const cards = wt.split("-").map(c => c.trim().toUpperCase()).filter(Boolean);
    for (const c of cards) {
      if (!VALID.has(c)) { parsed = false; continue; }
      total += values[c];
    }
  }
  return { total, parsed };
}

const startValues = { ...START_VALUES };
const propA = { ...finalA };
const propB = applyAdjustments(START_VALUES, PROPOSAL_B);

const deltasA = [];
const deltasB = [];
for (const s of wordBearing) {
  const o = scoreBreakdown(s.breakdown, startValues);
  const a = scoreBreakdown(s.breakdown, propA);
  const b = scoreBreakdown(s.breakdown, propB);
  if (!o.parsed || !a.parsed || !b.parsed) continue;
  deltasA.push({ old: o.total, neu: a.total });
  deltasB.push({ old: o.total, neu: b.total });
}

function summarize(deltas, label) {
  const n = deltas.length;
  const meanOld = deltas.reduce((s, d) => s + d.old, 0) / n;
  const meanNew = deltas.reduce((s, d) => s + d.neu, 0) / n;
  const ratio = meanNew / meanOld;
  console.log(`${label}: ${n} hands, mean old ${meanOld.toFixed(2)}, mean new ${meanNew.toFixed(2)}, ratio ${ratio.toFixed(3)}`);
}
console.log("\n=== Playtest replay (informational — scoring under new values for already-played hands) ===");
summarize(deltasA, "Proposal A");
summarize(deltasB, "Proposal B");

fs.writeFileSync(path.join(DATA, "value_tuning.json"), JSON.stringify({
  start_values: START_VALUES,
  proposal_A_adjustments: PROPOSAL_A,
  proposal_A_final_values: finalA,
  proposal_A_deck: deckTotal(COUNTS, finalA),
  proposal_B_adjustments: PROPOSAL_B,
  proposal_B_final_values: propB,
  proposal_B_deck: deckTotal(COUNTS, propB),
}, null, 2));
console.log("\nValue tuning written to analysis/data/value_tuning.json");
