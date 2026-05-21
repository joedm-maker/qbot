// Corpus analysis: ENABLE1 letter + digraph frequencies on the 2-10 letter subset.
// Reports raw count, length-weighted count, position-flexibility, and digraph rates.
// Compares against Norvig's published Google Books letter frequency table.
//
// Output: writes analysis/data/corpus_summary.json and prints a human-readable digest.

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const DATA = path.join(ROOT, "data");

// Norvig's "Mayzner Revisited" letter frequencies, derived from Google Books 1- to 9-letter words.
// Source: https://norvig.com/mayzner.html — single static table, no API.
const GOOGLE_BOOKS_PCT = {
  E: 12.49, T: 9.28, A: 8.04, O: 7.64, I: 7.57, N: 7.23, S: 6.51, R: 6.28,
  H: 5.05, L: 4.07, D: 3.82, C: 3.34, U: 2.73, M: 2.51, F: 2.40, P: 2.14,
  G: 1.87, W: 1.68, Y: 1.66, B: 1.48, V: 1.05, K: 0.54, X: 0.23, J: 0.16,
  Q: 0.12, Z: 0.09,
};

const raw = fs.readFileSync(path.join(DATA, "enable1.txt"), "utf8");
const allWords = raw.split(/\r?\n/).map(w => w.trim().toLowerCase()).filter(Boolean);
const words = allWords.filter(w => w.length >= 2 && w.length <= 10 && /^[a-z]+$/.test(w));

console.log(`ENABLE1 total: ${allWords.length}`);
console.log(`Filtered to 2-10 letters, alpha-only: ${words.length}`);

const LETTERS = "abcdefghijklmnopqrstuvwxyz".split("");
const rawCount = Object.fromEntries(LETTERS.map(l => [l, 0]));
const lenWeighted = Object.fromEntries(LETTERS.map(l => [l, 0]));
const startCount = Object.fromEntries(LETTERS.map(l => [l, 0]));
const endCount = Object.fromEntries(LETTERS.map(l => [l, 0]));
const midCount = Object.fromEntries(LETTERS.map(l => [l, 0]));

// Length-stratified frequency (for inspecting whether long words use letters differently)
const lenStrata = {};
for (let L = 2; L <= 10; L++) {
  lenStrata[L] = Object.fromEntries(LETTERS.map(l => [l, 0]));
}

let totalLetters = 0;
let totalLenWeighted = 0;
const lenHisto = {};
for (const w of words) {
  lenHisto[w.length] = (lenHisto[w.length] || 0) + 1;
  for (let i = 0; i < w.length; i++) {
    const ch = w[i];
    rawCount[ch]++;
    lenWeighted[ch] += w.length;
    lenStrata[w.length][ch]++;
    if (i === 0) startCount[ch]++;
    else if (i === w.length - 1) endCount[ch]++;
    else midCount[ch]++;
    totalLetters++;
    totalLenWeighted += w.length;
  }
}

const DIGRAPHS = ["CH", "CL", "ER", "IN", "QU", "TH"];
const digraphCount = Object.fromEntries(DIGRAPHS.map(d => [d, 0]));
// Count words that contain the digraph as a substring (any position)
const digraphWords = Object.fromEntries(DIGRAPHS.map(d => [d, 0]));
for (const w of words) {
  const up = w.toUpperCase();
  for (const d of DIGRAPHS) {
    let idx = 0;
    let seen = false;
    while ((idx = up.indexOf(d, idx)) !== -1) {
      digraphCount[d]++;
      seen = true;
      idx += 1;
    }
    if (seen) digraphWords[d]++;
  }
}

// Total digraph slots in corpus = sum over words of (w.length - 1)
let totalAdjacentPairs = 0;
for (const w of words) totalAdjacentPairs += w.length - 1;

// Build the summary
const enablePct = {};
const enableLenWeightedPct = {};
for (const l of LETTERS) {
  enablePct[l.toUpperCase()] = +(rawCount[l] / totalLetters * 100).toFixed(3);
  enableLenWeightedPct[l.toUpperCase()] = +(lenWeighted[l] / totalLenWeighted * 100).toFixed(3);
}

// Position flexibility: a simple score = min over positions (start, mid, end) of share-of-letter-occurrences.
// Letters that overwhelmingly start, end, or middle words have low flexibility.
const positionShare = {};
for (const l of LETTERS) {
  const total = rawCount[l] || 1;
  positionShare[l.toUpperCase()] = {
    start: +(startCount[l] / total).toFixed(3),
    mid: +(midCount[l] / total).toFixed(3),
    end: +(endCount[l] / total).toFixed(3),
  };
}

// Divergence vs Google Books
const divergence = {};
for (const L of LETTERS) {
  const U = L.toUpperCase();
  const corpus = enablePct[U];
  const google = GOOGLE_BOOKS_PCT[U];
  const rel = (corpus - google) / google;
  divergence[U] = {
    enable_pct: corpus,
    google_pct: google,
    rel_diff: +(rel * 100).toFixed(1), // % relative difference
    flagged: Math.abs(rel) > 0.15,
  };
}

// Digraph utilization metrics
const digraphMetrics = {};
for (const d of DIGRAPHS) {
  digraphMetrics[d] = {
    occurrences: digraphCount[d],
    words_containing: digraphWords[d],
    word_share_pct: +(digraphWords[d] / words.length * 100).toFixed(2),
    occurrences_per_word: +(digraphCount[d] / words.length).toFixed(4),
    share_of_adjacent_pairs_pct: +(digraphCount[d] / totalAdjacentPairs * 100).toFixed(3),
  };
}

const summary = {
  corpus: "ENABLE1 (Norvig mirror), filtered 2-10 letters, alpha-only",
  total_corpus_words: allWords.length,
  filtered_words: words.length,
  total_letter_occurrences: totalLetters,
  total_adjacent_pairs: totalAdjacentPairs,
  length_histogram: lenHisto,
  raw_letter_count: Object.fromEntries(LETTERS.map(l => [l.toUpperCase(), rawCount[l]])),
  length_weighted_letter_count: Object.fromEntries(LETTERS.map(l => [l.toUpperCase(), lenWeighted[l]])),
  enable_pct: enablePct,
  enable_length_weighted_pct: enableLenWeightedPct,
  position_share: positionShare,
  google_books_pct: GOOGLE_BOOKS_PCT,
  divergence_vs_google: divergence,
  digraph_metrics: digraphMetrics,
};

fs.writeFileSync(path.join(DATA, "corpus_summary.json"), JSON.stringify(summary, null, 2));

// Print digest
console.log("\n--- Letter frequency (ENABLE1 raw vs length-weighted vs Google Books) ---");
console.log("Lt | ENABLE% | LenWt% | Google% | Δ vs Google (rel%) | flag");
console.log("---+---------+--------+---------+--------------------+-----");
const sortedByGoogle = [...LETTERS].sort((a, b) => GOOGLE_BOOKS_PCT[b.toUpperCase()] - GOOGLE_BOOKS_PCT[a.toUpperCase()]);
for (const l of sortedByGoogle) {
  const U = l.toUpperCase();
  const d = divergence[U];
  console.log(
    `${U}  | ${enablePct[U].toFixed(2).padStart(6)} | ${enableLenWeightedPct[U].toFixed(2).padStart(5)} | ${GOOGLE_BOOKS_PCT[U].toFixed(2).padStart(6)} | ${String(d.rel_diff).padStart(8)}%         | ${d.flagged ? "FLAG" : ""}`
  );
}

console.log("\n--- Digraph metrics (ENABLE1, 2-10 letter words) ---");
console.log("Digraph | Occurrences | Words containing | Word-share% | Occ/word | Adj-pair%");
for (const d of DIGRAPHS) {
  const m = digraphMetrics[d];
  console.log(
    `${d}      | ${String(m.occurrences).padStart(11)} | ${String(m.words_containing).padStart(15)} | ${String(m.word_share_pct).padStart(10)} | ${String(m.occurrences_per_word).padStart(8)} | ${String(m.share_of_adjacent_pairs_pct).padStart(8)}`
  );
}

console.log("\nCorpus summary written to analysis/data/corpus_summary.json");
