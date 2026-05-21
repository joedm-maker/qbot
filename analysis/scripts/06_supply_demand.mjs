// Letter supply-vs-demand: compare each letter's effective deck supply (singles + digraph contributions)
// against corpus length-weighted demand and playtest play rate.
// Flags letters where corpus & playtest agree on under- or over-supply.

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

// Effective per-letter supply: single counts + digraph contributions (each digraph card contributes 1 to each constituent letter pool)
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

const eff = effectiveSupply(QUIDDLER_COUNTS);
const totalSupply = Object.values(eff).reduce((a, b) => a + b, 0);

console.log("=== Effective letter supply (incl. digraph contributions) ===");
console.log("Lt | Singles | +Digraph | Eff total | Supply% | Corpus% | Playtest% | Rejected% | Supply-Corpus rel% | Playtest-Supply rel%");
console.log("---+---------+----------+-----------+---------+---------+-----------+-----------+---------------------+---------------------");

const supplyAnalysis = {};
const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
for (const l of LETTERS) {
  const singles = QUIDDLER_COUNTS[l] || 0;
  const digraphAdd = eff[l] - singles;
  const supplyPct = +(eff[l] / totalSupply * 100).toFixed(2);
  const corpusPct = corpus.enable_length_weighted_pct[l];
  const playtestPct = playtest.playtest_letter_pct[l];
  const rejectedPct = rejected.rejected_pct[l];
  const supplyVsCorpus = +(((supplyPct - corpusPct) / corpusPct) * 100).toFixed(1);
  const playVsSupply = +(((playtestPct - supplyPct) / supplyPct) * 100).toFixed(1);
  supplyAnalysis[l] = { singles, digraphAdd, effective: eff[l], supplyPct, corpusPct, playtestPct, rejectedPct, supplyVsCorpus, playVsSupply };
  console.log(
    `${l}  | ${String(singles).padStart(7)} | ${String(digraphAdd).padStart(8)} | ${String(eff[l]).padStart(9)} | ${String(supplyPct).padStart(6)}% | ${String(corpusPct).padStart(6)}% | ${String(playtestPct).padStart(7)}% | ${String(rejectedPct).padStart(7)}% | ${String(supplyVsCorpus).padStart(8)}%        | ${String(playVsSupply).padStart(8)}%`
  );
}

// Interpretation flags
console.log("\n=== Interpretation flags ===");
console.log("Letters where data CONVERGES toward under-supply (corpus says under-supplied AND playtest plays MORE than supply share):");
for (const l of LETTERS) {
  const a = supplyAnalysis[l];
  if (a.supplyVsCorpus < -15 && a.playVsSupply > 15) {
    console.log(`  ${l}: supply ${a.supplyPct}% (corpus ${a.corpusPct}%, playtest ${a.playtestPct}%) — both signals under`);
  }
}

console.log("\nLetters where corpus says under-supplied but playtest plays LESS (commodity letters players ignore):");
for (const l of LETTERS) {
  const a = supplyAnalysis[l];
  if (a.supplyVsCorpus < -15 && a.playVsSupply < 0) {
    console.log(`  ${l}: supply ${a.supplyPct}% (corpus ${a.corpusPct}%, playtest ${a.playtestPct}%) — under per corpus, ignored in play`);
  }
}

console.log("\nLetters where supply > corpus AND playtest still plays MORE than supply (high-value over-supplied AND in heavy demand — bomb letters):");
for (const l of LETTERS) {
  const a = supplyAnalysis[l];
  if (a.supplyVsCorpus > 15 && a.playVsSupply > 15) {
    console.log(`  ${l}: supply ${a.supplyPct}% (corpus ${a.corpusPct}%, playtest ${a.playtestPct}%)`);
  }
}

console.log("\nLetters where supply > corpus AND playtest plays AT OR BELOW supply (potential over-supply candidates):");
for (const l of LETTERS) {
  const a = supplyAnalysis[l];
  if (a.supplyVsCorpus > 15 && a.playVsSupply <= 0) {
    console.log(`  ${l}: supply ${a.supplyPct}% (corpus ${a.corpusPct}%, playtest ${a.playtestPct}%)`);
  }
}

fs.writeFileSync(path.join(DATA, "supply_demand.json"), JSON.stringify({
  effective_supply: eff,
  total_supply: totalSupply,
  analysis: supplyAnalysis,
}, null, 2));
console.log("\nSupply/demand written to analysis/data/supply_demand.json");
