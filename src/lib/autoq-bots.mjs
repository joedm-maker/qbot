/**
 * AutoQ bot opponents — select plays from historical game data.
 *
 * Bots don't get dealt cards. Instead, they pick a random historical
 * hand submission for the round. Validation only checks that the cards
 * used are still available in the remaining deck (after the human's
 * dealt cards and other bots' picks are removed).
 */
import * as db from "./db.mjs";

export const BOT_NAMES = [
  "Underpants", "Unterdaria", "Gigglelack", "Lololol", "Bumblebee",
  "Bindlemeg", "Gapplesap", "Gravelsap", "Fffffffff", "Flippinbird",
  "Anglebottom", "Boarsend", "Krinkle", "Latesun", "Glitterfall",
  "Highmount", "Indigum", "Jamshire", "Craw", "Dent", "Egg", "Flappingcap",
];

/**
 * Pick N unique random bot names.
 */
export function pickRandomBotNames(count) {
  const shuffled = [...BOT_NAMES].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

/**
 * Load only historical scores that have actual words + breakdowns.
 * Filters at the DB level to avoid scanning 3,600+ empty records.
 */
export async function loadHistoricalScores() {
  return db.getScoresWithWords();
}

/**
 * Build a mutable card pool (multiset) from a flat array of card strings.
 */
function buildPool(cards) {
  const pool = new Map();
  for (const c of cards) pool.set(c, (pool.get(c) || 0) + 1);
  return pool;
}

/**
 * Try to remove `usedCards` from `pool`. Returns true and mutates pool
 * if all cards are available; returns false and leaves pool unchanged if not.
 */
function tryConsume(usedCards, pool) {
  // Check first
  const needed = new Map();
  for (const c of usedCards) needed.set(c, (needed.get(c) || 0) + 1);
  for (const [c, n] of needed) {
    if ((pool.get(c) || 0) < n) return false;
  }
  // Consume
  for (const [c, n] of needed) pool.set(c, pool.get(c) - n);
  return true;
}

/**
 * Select plays for all bots in a single hand.
 *
 * Takes the remaining deck pool (after the human's cards are removed)
 * and assigns each bot a random historical play whose cards can be
 * drawn from the remaining pool. Each bot's pick further depletes the pool.
 *
 * @param {number} botCount — number of bots
 * @param {number} hand — hand number (3-10)
 * @param {Map} remainingPool — mutable card pool (deck minus human's dealt cards)
 * @param {Array} allScores — pre-loaded historical scores
 * @returns {Array} — one play object per bot
 */
export function selectBotPlays(botCount, hand, remainingPool, allScores) {
  const handScores = allScores.filter((s) => s.hand === hand);
  // Shuffle so each game is different
  const shuffled = handScores.sort(() => Math.random() - 0.5);

  const plays = [];
  const usedWords = new Set(); // prevent two bots from playing the same words

  for (let b = 0; b < botCount; b++) {
    let found = false;
    for (const s of shuffled) {
      const wordsKey = s.words.toLowerCase();
      if (usedWords.has(wordsKey)) continue;

      const usedCards = s.breakdown.split(/\s+/).flatMap((word) =>
        word.split("-").filter(Boolean).map((c) => c.toUpperCase())
      );

      if (tryConsume(usedCards, remainingPool)) {
        plays.push({
          words: wordsKey,
          raw_score: s.raw_score,
          word_count: s.word_count || 1,
          longest_word_letters: s.longest_word_letters || 0,
          breakdown: s.breakdown,
        });
        usedWords.add(wordsKey);
        found = true;
        break;
      }
    }
    if (!found) {
      plays.push(zeroBotPlay());
    }
  }

  return plays;
}

/**
 * Build the remaining deck pool after removing the human's dealt cards.
 */
export { buildPool };

function zeroBotPlay() {
  return {
    words: "",
    raw_score: 0,
    word_count: 0,
    longest_word_letters: 0,
    breakdown: "",
  };
}
