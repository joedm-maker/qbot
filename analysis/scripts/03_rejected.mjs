// Rejected-words analysis: which letters were players reaching for that didn't pan out?
// Source: /stats/dictionary snapshot. These are MW-rejection caches (660 words).
// This is a soft "demand signal" — players tried to play these, dictionary blocked them.

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const DATA = path.join(ROOT, "data");

const dict = JSON.parse(fs.readFileSync(path.join(DATA, "dictionary.json"), "utf8"));
const rejected = (dict.invalid || []).map(w => w.toLowerCase()).filter(w => /^[a-z]+$/.test(w));
console.log(`Rejected words: ${rejected.length}`);

const corpus = JSON.parse(fs.readFileSync(path.join(DATA, "corpus_summary.json"), "utf8"));
const playtest = JSON.parse(fs.readFileSync(path.join(DATA, "playtest_summary.json"), "utf8"));

const LETTERS = "abcdefghijklmnopqrstuvwxyz".split("");
const cnt = Object.fromEntries(LETTERS.map(l => [l, 0]));
let total = 0;
for (const w of rejected) {
  for (const ch of w) { cnt[ch]++; total++; }
}

console.log("\n--- Rejected-word letter frequency vs ENABLE1 length-weighted vs playtest ---");
console.log("Lt | Rejected% | ENABLE1% | Playtest% | Rej vs Corpus | Rej vs Play");
console.log("---+-----------+----------+-----------+---------------+-------------");
const rejectedPct = {};
for (const l of LETTERS) {
  const U = l.toUpperCase();
  const r = +(cnt[l] / total * 100).toFixed(3);
  rejectedPct[U] = r;
  const c = corpus.enable_length_weighted_pct[U];
  const p = playtest.playtest_letter_pct[U];
  const relC = c ? ((r - c) / c * 100).toFixed(1) : "0";
  const relP = p ? ((r - p) / p * 100).toFixed(1) : "0";
  console.log(`${U}  | ${r.toFixed(2).padStart(8)} | ${c.toFixed(2).padStart(7)} | ${p.toFixed(2).padStart(8)} | ${String(relC).padStart(8)}%     | ${String(relP).padStart(8)}%`);
}

// Length histogram of rejected words
const lenHist = {};
for (const w of rejected) lenHist[w.length] = (lenHist[w.length] || 0) + 1;
console.log("\nRejected-word length histogram:", lenHist);

// Sample of short rejected words (most informative — they're attempted near-misses)
const shortRejects = rejected.filter(w => w.length <= 4).slice(0, 60);
console.log("\nSample short rejected words (≤4 letters):", shortRejects);

fs.writeFileSync(path.join(DATA, "rejected_summary.json"), JSON.stringify({
  count: rejected.length,
  total_letters: total,
  letter_count: cnt,
  rejected_pct: rejectedPct,
  length_histogram: lenHist,
}, null, 2));
console.log("\nRejected summary written to analysis/data/rejected_summary.json");
