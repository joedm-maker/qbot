// Playtest analysis: letter and digraph frequencies in actually-played words.
// Source: /stats/scores snapshot (analysis/data/scores.json).
// Compares against ENABLE1 corpus baseline (analysis/data/corpus_summary.json).
//
// The `breakdown` field is the authoritative card sequence per played word — we use it directly.
// Letters: count each letter of each digraph as 2 separate letters (QU = Q+U) for the
// "letters per word" stratum. Card-form analysis is separate.

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const DATA = path.join(ROOT, "data");

const scores = JSON.parse(fs.readFileSync(path.join(DATA, "scores.json"), "utf8"));
const corpus = JSON.parse(fs.readFileSync(path.join(DATA, "corpus_summary.json"), "utf8"));

console.log(`Total score records: ${scores.length}`);

const wordBearing = scores.filter(s => (s.word_count || 0) > 0 && s.breakdown);
console.log(`Word-bearing hands: ${wordBearing.length}`);

const byPlayer = {};
const byHand = {};
const byStars = { 0: 0, 1: 0, 2: 0 };
for (const s of wordBearing) {
  byPlayer[s.player_slack_id] = (byPlayer[s.player_slack_id] || 0) + 1;
  byHand[s.hand] = (byHand[s.hand] || 0) + 1;
  byStars[s.stars || 0] = (byStars[s.stars || 0] || 0) + 1;
}
console.log("By player:", byPlayer);
console.log("By hand:", byHand);
console.log("By stars:", byStars);

// Each breakdown is a series of "  "-separated words; each word is "-" separated cards.
// We parse the cards directly. Cards: A-Z plus 5 digraphs (CL ER IN QU TH).
const VALID_CARDS = new Set([
  "A","B","C","D","E","F","G","H","I","J","K","L","M","N","O","P","Q","R","S","T","U","V","W","X","Y","Z",
  "CL","ER","IN","QU","TH",
]);

const cardCount = {}; // card form (incl. digraph forms)
const letterCount = {}; // letter-form: QU contributes Q+U
const wordsPlayed = [];

let parseFails = 0;
for (const s of wordBearing) {
  const breakdown = String(s.breakdown);
  // Split into word tokens by 2+ spaces (cards within a word are separated by single dash; words by 2+ spaces)
  const wordTokens = breakdown.split(/\s{2,}/).map(w => w.trim()).filter(Boolean);
  for (const wt of wordTokens) {
    const cards = wt.split("-").map(c => c.trim().toUpperCase()).filter(Boolean);
    let valid = true;
    for (const c of cards) {
      if (!VALID_CARDS.has(c)) { valid = false; break; }
    }
    if (!valid) { parseFails++; continue; }
    wordsPlayed.push({ cards, hand: s.hand, stars: s.stars, raw_score: s.raw_score, player: s.player_slack_id });
    for (const c of cards) {
      cardCount[c] = (cardCount[c] || 0) + 1;
      if (c.length === 1) {
        letterCount[c] = (letterCount[c] || 0) + 1;
      } else {
        // digraph -> contribute both letters
        letterCount[c[0]] = (letterCount[c[0]] || 0) + 1;
        letterCount[c[1]] = (letterCount[c[1]] || 0) + 1;
      }
    }
  }
}

console.log(`Words played (parsed): ${wordsPlayed.length} (parse failures: ${parseFails})`);

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
const totalLetterOccurrences = Object.values(letterCount).reduce((a, b) => a + b, 0);
const playtestPct = {};
for (const l of LETTERS) {
  playtestPct[l] = +((letterCount[l] || 0) / totalLetterOccurrences * 100).toFixed(3);
}

// Compare to corpus length-weighted % (length-weighted closer matches "letters in real words" too)
const corpusPct = corpus.enable_length_weighted_pct;

console.log("\n--- Played-word letter frequency vs ENABLE1 length-weighted ---");
console.log("Lt | Playtest% | ENABLE1% | Δ rel% | flag (|Δ|>20%)");
console.log("---+-----------+----------+--------+----------------");
for (const l of LETTERS) {
  const p = playtestPct[l];
  const c = corpusPct[l];
  const rel = c ? ((p - c) / c) * 100 : 0;
  const flag = Math.abs(rel) > 20 ? "FLAG" : "";
  console.log(`${l}  | ${p.toFixed(2).padStart(8)} | ${c.toFixed(2).padStart(7)} | ${rel.toFixed(1).padStart(6)}% | ${flag}`);
}

// Card-form analysis: how often did each card appear (including digraph cards)
const totalCardOccurrences = Object.values(cardCount).reduce((a, b) => a + b, 0);
console.log("\n--- Card-form usage (played counts, digraph cards separate) ---");
const cardsSorted = Array.from(VALID_CARDS).sort((a, b) => (cardCount[b] || 0) - (cardCount[a] || 0));
for (const c of cardsSorted) {
  const cnt = cardCount[c] || 0;
  console.log(`${c.padEnd(3)} | ${String(cnt).padStart(6)} | ${(cnt / totalCardOccurrences * 100).toFixed(2)}%`);
}

// Digraph utilisation: in cases where digraph LETTERS were used somewhere, how often was it via the digraph card vs split letters?
// We can directly measure this from the breakdowns: when "QU" appears as a card, that's a digraph use; we'd compare to when Q and U appear adjacent as separate cards in the same word.
function countDigraphVsSplit(d) {
  let asDigraph = 0;
  let asSplit = 0;
  for (const w of wordsPlayed) {
    const cards = w.cards;
    // each occurrence of digraph card
    for (const c of cards) if (c === d) asDigraph++;
    // adjacent single letters in same word matching d
    for (let i = 0; i < cards.length - 1; i++) {
      if (cards[i] === d[0] && cards[i+1] === d[1]) asSplit++;
    }
  }
  return { asDigraph, asSplit };
}
console.log("\n--- Digraph-card vs split-letter usage in played hands ---");
console.log("Digraph | As digraph | As split (X+Y) | Digraph-share% | Note");
for (const d of ["CL","ER","IN","QU","TH"]) {
  const { asDigraph, asSplit } = countDigraphVsSplit(d);
  const tot = asDigraph + asSplit;
  const share = tot ? +(asDigraph / tot * 100).toFixed(1) : 0;
  console.log(`${d}      | ${String(asDigraph).padStart(10)} | ${String(asSplit).padStart(14)} | ${String(share).padStart(13)}%`);
}

// CH usage (not a current card): how often did C+H appear adjacent in a played word?
let chSplit = 0;
for (const w of wordsPlayed) {
  for (let i = 0; i < w.cards.length - 1; i++) {
    if (w.cards[i] === "C" && w.cards[i+1] === "H") chSplit++;
  }
}
console.log(`\nCH (not a card today, but adjacent in played words): ${chSplit} occurrences across ${wordsPlayed.length} played words`);
console.log(`CH play rate: ${(chSplit / wordsPlayed.length * 100).toFixed(2)}% of played words contain a CH adjacency`);

// Words with high scores - what letters appear?
const sortedByScore = [...scores].filter(s => (s.raw_score || 0) > 0).sort((a, b) => b.raw_score - a.raw_score);
const top10pct = Math.floor(sortedByScore.length * 0.1);
const topHands = sortedByScore.slice(0, top10pct);
const topLetterCount = {};
let topTotal = 0;
for (const s of topHands) {
  const breakdown = String(s.breakdown || "");
  const wordTokens = breakdown.split(/\s{2,}/).map(w => w.trim()).filter(Boolean);
  for (const wt of wordTokens) {
    const cards = wt.split("-").map(c => c.trim().toUpperCase()).filter(Boolean);
    for (const c of cards) {
      if (!VALID_CARDS.has(c)) continue;
      if (c.length === 1) { topLetterCount[c] = (topLetterCount[c] || 0) + 1; topTotal++; }
      else { topLetterCount[c[0]] = (topLetterCount[c[0]] || 0) + 1; topLetterCount[c[1]] = (topLetterCount[c[1]] || 0) + 1; topTotal += 2; }
    }
  }
}

console.log(`\n--- Top 10% scoring hands letter use (${topHands.length} hands, ${topTotal} letter occurrences) ---`);
console.log("Lt | Top10%-% | All-% | Δ rel% | flag (>20% over)");
for (const l of LETTERS) {
  const tp = (topLetterCount[l] || 0) / topTotal * 100;
  const ap = playtestPct[l] || 0;
  const rel = ap ? ((tp - ap) / ap) * 100 : 0;
  const flag = rel > 20 ? "OVER-REP in top hands" : (rel < -20 ? "UNDER-REP" : "");
  console.log(`${l}  | ${tp.toFixed(2).padStart(7)} | ${ap.toFixed(2).padStart(6)} | ${rel.toFixed(1).padStart(6)}% | ${flag}`);
}

// Save
const out = {
  total_records: scores.length,
  word_bearing_hands: wordBearing.length,
  parse_failures: parseFails,
  by_player: byPlayer,
  by_hand: byHand,
  by_stars: byStars,
  total_letter_occurrences: totalLetterOccurrences,
  total_card_occurrences: totalCardOccurrences,
  card_count: cardCount,
  letter_count: letterCount,
  playtest_letter_pct: playtestPct,
  top10pct_hand_count: topHands.length,
  top10pct_letter_count: topLetterCount,
  ch_split_adjacencies: chSplit,
};
fs.writeFileSync(path.join(DATA, "playtest_summary.json"), JSON.stringify(out, null, 2));
console.log("\nPlaytest summary written to analysis/data/playtest_summary.json");
