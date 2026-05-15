/**
 * AutoQ virtual Quiddler deck — 118 cards.
 *
 * Shuffled fresh per hand (not across hands).
 * Deals cards to human + bot players, validates submissions against dealt hand.
 */
import { CARD_VALUES, getScoreOptions, allBreakdowns } from "./cards.mjs";

// Card frequencies in the physical Quiddler deck
const CARD_FREQUENCIES = {
  A: 10, B: 2, C: 2, D: 4, E: 12, F: 2, G: 4, H: 2, I: 8, J: 2,
  K: 2, L: 4, M: 2, N: 6, O: 8, P: 2, Q: 2, R: 6, S: 4, T: 6,
  U: 6, V: 2, W: 2, X: 2, Y: 4, Z: 2, QU: 2, IN: 2, ER: 2, CL: 2, TH: 2,
};

// Expand frequency map into a 118-card array
export const QUIDDLER_DECK = [];
for (const [card, count] of Object.entries(CARD_FREQUENCIES)) {
  for (let i = 0; i < count; i++) QUIDDLER_DECK.push(card);
}

/**
 * Fisher-Yates shuffle (in-place, returns the array).
 */
export function shuffleDeck(deck) {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

/**
 * Shuffle a fresh deck and deal `handSize` cards to each of `playerCount` players.
 * Returns an array of card arrays, one per player.
 */
export function dealForHand(playerCount, handSize) {
  const deck = shuffleDeck([...QUIDDLER_DECK]);
  const hands = [];
  for (let p = 0; p < playerCount; p++) {
    hands.push(deck.splice(0, handSize));
  }
  return hands;
}

/**
 * Multiset subtract — return a copy of `deck` with one occurrence of each
 * element in `removed` taken out.
 */
function multisetSubtract(deck, removed) {
  const result = [...deck];
  for (const card of removed) {
    const idx = result.indexOf(card);
    if (idx >= 0) result.splice(idx, 1);
  }
  return result;
}

/**
 * Deal `count` cards from the 118-card deck minus the player's `seenCards`
 * (every card they've already been dealt this game — initial deals + previous
 * mulligan discards). Returns `{ cards, shortBy }`; `shortBy > 0` means the
 * pool has been depleted and the deal can't be filled.
 */
export function dealFromPool(seenCards, count) {
  const pool = multisetSubtract(QUIDDLER_DECK, seenCards || []);
  if (pool.length < count) {
    return { cards: pool.slice(0), shortBy: count - pool.length };
  }
  return { cards: shuffleDeck(pool).slice(0, count), shortBy: 0 };
}

/**
 * Check whether `usedCards` is a valid multiset subset of `dealtCards`.
 * Both are arrays of card strings (e.g. ["QU", "I", "Z"]).
 */
export function validateCardsAgainstDealt(usedCards, dealtCards) {
  const available = new Map();
  for (const c of dealtCards) {
    available.set(c, (available.get(c) || 0) + 1);
  }
  for (const c of usedCards) {
    const count = available.get(c) || 0;
    if (count <= 0) return false;
    available.set(c, count - 1);
  }
  return true;
}

/**
 * Parse a hyphenated word into explicit cards.
 */
function parseExplicit(upper) {
  const cards = [];
  const invalid = [];
  for (const token of upper.split("-")) {
    if (!token) continue;
    if (CARD_VALUES[token] !== undefined) cards.push(token);
    else invalid.push(token);
  }
  return { cards, invalid };
}

function scoreCards(cards) {
  return cards.reduce((sum, c) => sum + (CARD_VALUES[c] || 0), 0);
}

function cartesian(arrays) {
  if (arrays.length === 0) return [[]];
  return arrays.reduce(
    (acc, arr) => acc.flatMap((combo) => arr.map((item) => [...combo, item])),
    [[]]
  );
}

/**
 * Get score options filtered against dealt cards.
 *
 * Unlike getScoreOptions() which auto-resolves IN/ER (same-score digraphs),
 * this function keeps ALL breakdowns and filters by what's actually in the dealt hand.
 * This ensures a player with an IN digraph card can play "ink" without hyphenating.
 */
export function filterOptionsAgainstDealt(input, handSize, dealtCards) {
  const cleaned = (input || "").replace(/[\s,+]+/g, " ").trim();
  if (!cleaned) return { options: [], invalid: [] };

  const wordTokens = cleaned.split(" ").filter((t) => t.length > 0);
  if (wordTokens.length === 0) return { options: [], invalid: [] };

  const allInvalid = [];
  const tooShort = [];

  // Get ALL breakdowns per word (no grouping)
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
      allInvalid.push(token);
      return [{ cards: [], raw: token }];
    }
    const filtered = breakdowns.filter((bd) => bd.length >= 2);
    if (filtered.length === 0) {
      tooShort.push(token);
      return [{ cards: [], raw: token }];
    }
    return filtered.map((cards) => ({ cards, raw: token }));
  });

  if (allInvalid.length) return { options: [], invalid: allInvalid, tooShort };
  if (tooShort.length) return { options: [], invalid: [], tooShort };

  // Cartesian product, then filter by hand size AND dealt cards
  const combos = cartesian(perWord);
  const rawOptions = [];

  for (const combo of combos) {
    const allCards = combo.flatMap((w) => w.cards);
    if (allCards.length > handSize) continue;
    if (!validateCardsAgainstDealt(allCards, dealtCards)) continue;

    const totalScore = scoreCards(allCards);
    const breakdown = combo.map((w) => w.cards.join("-")).join("  ");
    rawOptions.push({ score: totalScore, cards: allCards.length, breakdown });
  }

  // Group by score — within each score, keep card count closest to hand limit
  const byScore = new Map();
  for (const opt of rawOptions) {
    const existing = byScore.get(opt.score);
    if (!existing) {
      byScore.set(opt.score, opt);
    } else {
      const existingDist = Math.abs(handSize - existing.cards);
      const newDist = Math.abs(handSize - opt.cards);
      if (newDist < existingDist) byScore.set(opt.score, opt);
    }
  }

  const options = [...byScore.values()]
    .map(({ score, cards, breakdown }) => ({ score, cards, breakdown }))
    .sort((a, b) => b.score - a.score);

  return { options, invalid: [], tooShort: [] };
}

/**
 * Format dealt cards with superscript point values.
 * e.g. ["A", "E", "QU", "N", "R"] → "a² e² qu⁹ n⁵ r⁵"
 */
const SUPERSCRIPT = { "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹" };

function toSuperscript(n) {
  return String(n).split("").map((d) => SUPERSCRIPT[d] || d).join("");
}

export function formatDealtCards(cards) {
  return cards
    .map((c) => `${c.toLowerCase()}${toSuperscript(CARD_VALUES[c] || 0)}`)
    .join(" ");
}
