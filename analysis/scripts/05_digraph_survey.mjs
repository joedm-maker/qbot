// Broad digraph survey: rank candidate digraphs by corpus productivity + position flexibility.
// Compare against existing Quiddler digraphs (CL, ER, IN, QU, TH) as benchmarks.
// Also score "earning a card slot" via positional spread.

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const DATA = path.join(ROOT, "data");

const raw = fs.readFileSync(path.join(DATA, "enable1.txt"), "utf8");
const words = raw.split(/\r?\n/).map(w => w.trim().toLowerCase()).filter(w => /^[a-z]{2,10}$/.test(w));
console.log(`Corpus: ${words.length} words (2-10 letters)`);

// All 26x26 digraph candidates: we score them all and then surface the interesting ones.
const LETTERS = "abcdefghijklmnopqrstuvwxyz".split("");
const candidates = [];
for (const a of LETTERS) {
  for (const b of LETTERS) {
    candidates.push((a + b).toUpperCase());
  }
}

// For each digraph: count words containing it, and break out positions (initial/medial/terminal/standalone).
// A digraph at position 0 = initial; at position word.length-2 = terminal; else medial.
const stats = {};
for (const d of candidates) {
  stats[d] = { occ: 0, words: 0, initial: 0, medial: 0, terminal: 0, only: 0 };
}

for (const w of words) {
  const up = w.toUpperCase();
  // First find all positions per digraph
  const seenInWord = {}; // digraph -> first position counted
  for (let i = 0; i <= up.length - 2; i++) {
    const d = up.slice(i, i + 2);
    if (!stats[d]) continue;
    stats[d].occ++;
    if (i === 0) {
      if (up.length === 2) stats[d].only++;
      else stats[d].initial++;
    } else if (i === up.length - 2) {
      stats[d].terminal++;
    } else {
      stats[d].medial++;
    }
    if (!seenInWord[d]) {
      seenInWord[d] = true;
      stats[d].words++;
    }
  }
}

// Per-word % and position spread score
const ranked = candidates.map(d => {
  const s = stats[d];
  const wordPct = s.words / words.length * 100;
  // Position spread = how evenly the digraph appears across initial/medial/terminal.
  // Higher spread = more versatile card. Compute Shannon-like entropy across 3 buckets.
  const total = s.initial + s.medial + s.terminal + s.only;
  function entropy(parts) {
    let h = 0;
    for (const p of parts) {
      if (p <= 0) continue;
      const q = p / total;
      h -= q * Math.log2(q);
    }
    return h; // max log2(4)=2 when fully spread
  }
  const spread = total ? entropy([s.initial, s.medial, s.terminal, s.only]) : 0;
  return {
    digraph: d,
    occurrences: s.occ,
    words: s.words,
    word_pct: +wordPct.toFixed(2),
    initial: s.initial,
    medial: s.medial,
    terminal: s.terminal,
    only: s.only,
    position_spread_bits: +spread.toFixed(2),
  };
}).filter(r => r.words > 0);

// Sort by word_pct
ranked.sort((a, b) => b.word_pct - a.word_pct);

console.log("\n=== Top 50 digraphs by word-share (% of corpus 2-10 letter words containing the digraph) ===");
console.log("Rank | DG | Word% | Words   | Initial | Medial  | Terminal | Spread bits");
const top50 = ranked.slice(0, 50);
top50.forEach((r, i) => {
  console.log(
    `${String(i+1).padStart(4)} | ${r.digraph} | ${r.word_pct.toFixed(2).padStart(5)} | ${String(r.words).padStart(7)} | ${String(r.initial).padStart(7)} | ${String(r.medial).padStart(7)} | ${String(r.terminal).padStart(8)} | ${r.position_spread_bits.toFixed(2)}`
  );
});

// Compare existing Quiddler digraphs to top candidates
const QUIDDLER_DIGRAPHS = ["CL", "ER", "IN", "QU", "TH"];
const CH_CANDIDATE = "CH";
console.log("\n=== Existing Quiddler digraphs (for benchmarking) ===");
console.log("DG | Word% | Words   | Initial | Medial | Terminal | Spread bits");
for (const d of [...QUIDDLER_DIGRAPHS, CH_CANDIDATE]) {
  const r = ranked.find(x => x.digraph === d);
  console.log(`${r.digraph} | ${r.word_pct.toFixed(2).padStart(5)} | ${String(r.words).padStart(7)} | ${String(r.initial).padStart(7)} | ${String(r.medial).padStart(6)} | ${String(r.terminal).padStart(8)} | ${r.position_spread_bits.toFixed(2)}`);
}

// Suggested follow-on digraphs to investigate (common letters + scarce-letter combinations)
const FOLLOW_ONS = ["SH", "CK", "PH", "WH", "BL", "BR", "CR", "DR", "FR", "GR", "PR", "TR", "PL", "FL", "GL",
  "ED", "RE", "ST", "LY", "AN", "ON", "OR", "IT", "IS", "AR", "AT", "AL", "EN", "ES", "OU", "NG", "ND", "NT", "GH"];
console.log("\n=== Follow-on candidates ===");
console.log("DG | Word% | Words   | Initial | Medial | Terminal | Spread bits");
for (const d of FOLLOW_ONS) {
  const r = ranked.find(x => x.digraph === d);
  if (!r) continue;
  console.log(`${r.digraph} | ${r.word_pct.toFixed(2).padStart(5)} | ${String(r.words).padStart(7)} | ${String(r.initial).padStart(7)} | ${String(r.medial).padStart(6)} | ${String(r.terminal).padStart(8)} | ${r.position_spread_bits.toFixed(2)}`);
}

// Also compute "unlock potential" — corpus words that contain digraph AND require letters currently scarce in deck
// (where scarce = single-letter count of 2 in Quiddler deck)
const SCARCE_LETTERS = new Set(["B","C","F","H","J","K","M","P","Q","V","W","X","Z"]);
function unlockScore(digraph) {
  const [a, b] = digraph;
  // Count corpus words containing this digraph where BOTH constituent letters are scarce singles in current deck.
  // These words are particularly hard to build today (need both scarce letters in same hand).
  const aScarce = SCARCE_LETTERS.has(a);
  const bScarce = SCARCE_LETTERS.has(b);
  if (!aScarce && !bScarce) return { both_scarce: false, unlock_words: 0 };
  let unlock = 0;
  for (const w of words) {
    const up = w.toUpperCase();
    if (up.includes(digraph) && (aScarce ? true : false) && (bScarce ? true : false)) {
      unlock++;
    }
  }
  return { both_scarce: aScarce && bScarce, a_scarce: aScarce, b_scarce: bScarce, unlock_words: unlock };
}

const KEY_DIGRAPHS = ["CH","SH","CK","PH","WH","TH","CL","QU"];
console.log("\n=== Scarcity unlock for key digraphs (words requiring BOTH constituents that are currently scarce singles) ===");
for (const d of KEY_DIGRAPHS) {
  const u = unlockScore(d);
  console.log(`${d}: both_scarce=${u.both_scarce}, unlock_words=${u.unlock_words}`);
}

fs.writeFileSync(path.join(DATA, "digraph_survey.json"), JSON.stringify({
  total_words: words.length,
  ranked,
  follow_ons: FOLLOW_ONS.map(d => ranked.find(r => r.digraph === d)).filter(Boolean),
}, null, 2));
console.log("\nDigraph survey written to analysis/data/digraph_survey.json");
