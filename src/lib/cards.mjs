/**
 * Quiddler card deck and scoring logic.
 *
 * Valid cards: A–Z (single letters) plus digraphs QU, IN, ER, TH, CL.
 * Words can be entered as "quiz" or "qu-i-z" (hyphens delineate cards).
 *
 * Game types:
 *   QBIM, Quickler, AutoQ all use hands 3–10 (8 hands).
 *
 * Scoring notes:
 *   IN (7) = I (2) + N (5)  — same score, use whichever fits hand limit
 *   ER (7) = E (2) + R (5)  — same score, use whichever fits hand limit
 *   QU (9) ≠ Q (15) + U (4) = 19  — different score, player chooses
 *   TH (9) ≠ T (3) + H (7)  = 10  — different score, player chooses
 *   CL (10) ≠ C (8) + L (3) = 11  — different score, player chooses
 */

/**
 * Get the hand range for a game type.
 */
export function getHandRange(gameType) {
  // QBIM, Quickler, and AutoQ all use hands 3-10.
  return [3, 4, 5, 6, 7, 8, 9, 10];
}

/**
 * How many cards to deal for a given hand. All three game types (QBIM,
 * Quickler, AutoQ) deal `hand + 3` cards — the extra 3 are "discards" the
 * player doesn't need to score with (standard Quiddler rule). Mulligans
 * subtract from the dealt count one card at a time.
 */
export function dealSizeForHand(gameType, hand, mulligans = 0) {
  return hand + 3 - mulligans;
}

const SUPERSCRIPT = { "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹" };

function toSuperscript(n) {
  return String(n).split("").map((d) => SUPERSCRIPT[d] || d).join("");
}

/**
 * Format a word submission with superscript point values per card.
 * Input: "fox+quiz" or "qu-i-z fox"
 * Output: "F⁶O²X¹²  QU⁹I²Z¹⁴"
 */
export function formatWordsWithPoints(input) {
  if (!input || !input.trim()) return "—";
  const wordTokens = input.replace(/[\s,+]+/g, " ").trim().split(" ").filter(Boolean);

  return wordTokens.map((token) => {
    const upper = token.toUpperCase().trim();
    const cards = [];

    if (upper.includes("-")) {
      // Explicit card boundaries
      for (const t of upper.split("-")) {
        if (t && CARD_VALUES[t] !== undefined) cards.push(t);
        else if (t) cards.push(t);
      }
    } else {
      // Greedy parse: try digraphs first
      let i = 0;
      while (i < upper.length) {
        let matched = false;
        if (i + 1 < upper.length) {
          const pair = upper.slice(i, i + 2);
          if (DIGRAPHS.includes(pair)) {
            cards.push(pair);
            i += 2;
            matched = true;
          }
        }
        if (!matched) {
          cards.push(upper[i]);
          i++;
        }
      }
    }

    return cards.map((c) => {
      const val = CARD_VALUES[c.toUpperCase()];
      if (val !== undefined) return `${c.toLowerCase()}${toSuperscript(val)}`;
      return c.toLowerCase();
    }).join("");
  }).join("  ");
}

/**
 * Canonicalize a words submission: strip leading/trailing separators,
 * collapse internal runs of (+, whitespace, comma) into a single "+".
 * "rump+" → "rump", "hi+clef" → "hi+clef", "  a ,, b " → "a+b".
 */
export function normalizeWords(input) {
  return String(input || "")
    .replace(/[\s,+]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .join("+");
}

export const CARD_VALUES = {
  A: 2,  B: 8,  C: 8,  D: 5,  E: 2,  F: 6,  G: 6,  H: 7,
  I: 2,  J: 13, K: 8,  L: 3,  M: 5,  N: 5,  O: 2,  P: 6,
  Q: 15, R: 5,  S: 3,  T: 3,  U: 4,  V: 11, W: 10, X: 12,
  Y: 4,  Z: 14,
  ER: 7, CL: 10, IN: 7, TH: 9, QU: 9,
};

const DIGRAPHS = ["QU", "IN", "ER", "TH", "CL"];

// Digraphs where the score differs from individual cards — player must choose
const SCORE_AFFECTING = new Set(["QU", "TH", "CL"]);

// Digraphs where the score is the same — auto-pick based on hand fit
// IN = I+N, ER = E+R
const NEUTRAL_DIGRAPHS = new Set(["IN", "ER"]);

// ── Word Parsing ────────────────────────────────────────

/**
 * Parse a hyphenated word into explicit cards.
 * @returns {{ cards: string[], invalid: string[] }}
 */
function parseExplicit(upper) {
  const cards = [];
  const invalid = [];
  for (const token of upper.split("-")) {
    if (!token) continue;
    if (CARD_VALUES[token] !== undefined) {
      cards.push(token);
    } else {
      invalid.push(token);
    }
  }
  return { cards, invalid };
}

/**
 * Find ALL possible card breakdowns for an unhyphenated word.
 * Returns an array of card arrays, e.g. [["QU","I","Z"], ["Q","U","I","Z"]]
 */
export function allBreakdowns(upper) {
  // Strip any non-alpha characters
  const clean = upper.replace(/[^A-Z]/g, "");
  if (!clean) return [];

  const results = [];

  function dfs(pos, cards) {
    if (pos === clean.length) {
      results.push([...cards]);
      return;
    }

    // Try digraphs (2-char)
    if (pos + 1 < clean.length) {
      const pair = clean.slice(pos, pos + 2);
      if (DIGRAPHS.includes(pair)) {
        cards.push(pair);
        dfs(pos + 2, cards);
        cards.pop();
      }
    }

    // Try single letter
    const ch = clean[pos];
    if (CARD_VALUES[ch] !== undefined) {
      cards.push(ch);
      dfs(pos + 1, cards);
      cards.pop();
    }
  }

  dfs(0, []);
  return results;
}

/**
 * Calculate score for a card array.
 */
function scoreCards(cards) {
  return cards.reduce((sum, c) => sum + (CARD_VALUES[c] || 0), 0);
}

// ── Score Options ───────────────────────────────────────

/**
 * Given an input string and hand size, return all distinct scoring options.
 *
 * - Hyphenated words are taken as explicit card choices.
 * - Unhyphenated words are expanded into all possible card breakdowns.
 * - IN/ER (same score as I+N / E+R) are auto-resolved to fit closest to hand limit.
 * - QU/TH/CL (different scores) generate separate options for the player to choose.
 *
 * @param {string} input — e.g. "quiz fox" or "qu-i-z fox"
 * @param {number} handSize — max cards allowed (e.g. 3 for hand 3)
 * @returns {{ options: Array<{ score: number, cards: number, breakdown: string }>, invalid: string[] }}
 */
export function getScoreOptions(input, handSize) {
  // Normalize whitespace and word separators (spaces, commas, + signs)
  const cleaned = input.replace(/[\s,+]+/g, " ").trim();
  if (!cleaned) return { options: [], invalid: [], tooShort: [] };

  const wordTokens = cleaned.split(" ").filter((t) => t.length > 0);
  if (wordTokens.length === 0) return { options: [], invalid: [], tooShort: [] };

  const allInvalid = [];
  const tooShort = [];

  // Get breakdowns per word
  const perWord = wordTokens.map((token) => {
    const upper = token.toUpperCase().trim();
    if (!upper) return [{ cards: [], raw: token }];
    if (upper.includes("-")) {
      const { cards, invalid } = parseExplicit(upper);
      allInvalid.push(...invalid);
      if (!invalid.length && cards.length < 2) tooShort.push(token);
      return [{ cards, raw: token }];
    }
    const breakdowns = allBreakdowns(upper);
    if (breakdowns.length === 0) {
      // Every character was invalid
      allInvalid.push(token);
      return [{ cards: [], raw: token }];
    }
    // 2-card minimum per word — drop any 1-card interpretations
    const filtered = breakdowns.filter((bd) => bd.length >= 2);
    if (filtered.length === 0) {
      tooShort.push(token);
      return [{ cards: [], raw: token }];
    }
    return filtered.map((cards) => ({ cards, raw: token }));
  });

  if (allInvalid.length) {
    return { options: [], invalid: allInvalid, tooShort };
  }
  if (tooShort.length) {
    return { options: [], invalid: [], tooShort };
  }

  // Cartesian product of all word breakdowns
  const combos = cartesian(perWord);

  // Build raw options
  const rawOptions = [];
  for (const combo of combos) {
    const allCards = combo.flatMap((w) => w.cards);
    const totalCards = allCards.length;
    if (totalCards > handSize) continue;

    const totalScore = scoreCards(allCards);
    const breakdown = combo.map((w) => w.cards.join("-")).join("  ");
    rawOptions.push({ score: totalScore, cards: totalCards, breakdown, allCards });
  }

  // Group by score. Within each score group, pick the card count closest to hand limit.
  // This auto-resolves IN/ER choices (same score, different card count).
  const byScore = new Map();
  for (const opt of rawOptions) {
    const existing = byScore.get(opt.score);
    if (!existing) {
      byScore.set(opt.score, opt);
    } else {
      // Prefer card count closest to hand limit
      const existingDist = Math.abs(handSize - existing.cards);
      const newDist = Math.abs(handSize - opt.cards);
      if (newDist < existingDist) {
        byScore.set(opt.score, opt);
      }
    }
  }

  // Sort options by score descending
  const options = [...byScore.values()]
    .map(({ score, cards, breakdown }) => ({ score, cards, breakdown }))
    .sort((a, b) => b.score - a.score);

  return { options, invalid: [], tooShort: [] };
}

/**
 * Cartesian product of arrays.
 * cartesian([[a,b],[c,d]]) => [[a,c],[a,d],[b,c],[b,d]]
 */
function cartesian(arrays) {
  if (arrays.length === 0) return [[]];
  return arrays.reduce(
    (acc, arr) => acc.flatMap((combo) => arr.map((item) => [...combo, item])),
    [[]]
  );
}

