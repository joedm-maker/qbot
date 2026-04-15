/**
 * Merriam-Webster Collegiate Dictionary integration.
 *
 * lookupWord(word) — returns { valid, definition, url, source } after checking:
 *   1. Local DynamoDB dictionary cache (qbim-dictionary)
 *   2. Falling back to the MW API and caching the result + all inflected stems
 *
 * validateWords(wordsInput) — returns { valid: [...], invalid: [...] }
 *
 * Cache entries:
 *   { word, valid (bool), definition, url, source: "mw"|"vote", cached_at, play_count }
 *
 * Fail-open: if MW API errors out, we allow the word through rather than blocking gameplay.
 */
import * as db from "./db.mjs";

const MW_KEY = process.env.MW_API_KEY;
const MW_BASE = "https://www.dictionaryapi.com/api/v3/references/collegiate/json";

/** Clean a submitted word to what we actually check against the dictionary. */
export function cleanWord(raw) {
  return String(raw || "").toLowerCase().replace(/[^a-z]/g, "");
}

/** Build the public MW reference URL for a word. */
function buildUrl(word) {
  return `https://www.merriam-webster.com/dictionary/${encodeURIComponent(word)}`;
}

/**
 * Call MW and parse the response. Returns:
 *   { valid: true, definition, headword, stems: [...] } if the word (or an inflection of it) is in MW
 *   { valid: false }                                    if MW returns suggestions (word not found)
 *   { error: true }                                     if the network/API fails — caller should fail-open
 */
async function callMW(word) {
  if (!MW_KEY) {
    console.warn("MW_API_KEY not set; cannot validate words");
    return { error: true };
  }
  const url = `${MW_BASE}/${encodeURIComponent(word)}?key=${MW_KEY}`;
  // Hard timeout so a slow MW response never eats Slack's 3s budget
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1500);
  try {
    const r = await fetch(url, { signal: controller.signal });
    if (!r.ok) {
      console.warn(`MW ${word}: HTTP ${r.status}`);
      return { error: true };
    }
    const data = await r.json();
    if (!Array.isArray(data) || data.length === 0) return { valid: false };
    // If MW returned suggestions (array of strings), the word isn't found
    if (typeof data[0] === "string") return { valid: false };

    // Accept if any entry's stems contains the word OR meta.id (minus ":N") matches
    for (const entry of data) {
      const metaId = (entry.meta?.id || "").split(":")[0].toLowerCase();
      const stems = (entry.meta?.stems || []).map((s) => s.toLowerCase());
      if (metaId === word || stems.includes(word)) {
        return {
          valid: true,
          definition: entry.shortdef?.[0] || null,
          headword: metaId,
          stems,
        };
      }
    }
    return { valid: false };
  } catch (e) {
    console.warn(`MW ${word}: error`, e.message);
    return { error: true };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Look up a word, checking cache first, falling back to MW.
 * Caches the result (and all inflected stems) so we never re-query the same word.
 */
export async function lookupWord(raw) {
  const word = cleanWord(raw);
  if (!word) return { valid: false };

  // 1. Check cache
  const cached = await db.getDictionaryWord(word);
  if (cached) {
    return {
      valid: !!cached.valid,
      definition: cached.definition || null,
      url: cached.url || (cached.valid ? buildUrl(cached.headword || word) : null),
      source: cached.source || "mw",
      headword: cached.headword || word,
    };
  }

  // 2. Fall back to MW
  const result = await callMW(word);

  // 3. On network/API error, fail open (return valid) but DON'T cache
  if (result.error) {
    return { valid: true, error: true, definition: null, url: null, source: "mw" };
  }

  const now = new Date().toISOString();

  if (result.valid) {
    // Cache the queried word
    const url = buildUrl(result.headword || word);
    await db.putDictionaryWord({
      word,
      valid: true,
      definition: result.definition,
      url,
      source: "mw",
      headword: result.headword,
      cached_at: now,
    });
    // Also cache every stem as a pointer to the headword
    // (saves future API calls for "jazzing", "leering", etc.)
    for (const stem of result.stems || []) {
      if (stem === word) continue;
      // Fire-and-forget; don't await each one. Use a promise chain.
      db.putDictionaryWord({
        word: stem,
        valid: true,
        definition: result.definition,
        url,
        source: "mw",
        headword: result.headword,
        cached_at: now,
      }).catch(() => { /* ignore cache failures */ });
    }
    return { valid: true, definition: result.definition, url, source: "mw", headword: result.headword };
  }

  // Cache the negative result too so we don't re-query
  await db.putDictionaryWord({ word, valid: false, source: "mw", cached_at: now });
  return { valid: false, source: "mw" };
}

/**
 * Validate all words in a submission. Parses the same way saveScore does
 * (spaces/commas/+ as separators, hyphens stripped).
 * Returns { valid: [...], invalid: [...] } with each entry { word, definition, url, source }.
 */
export async function validateWords(wordsInput) {
  const tokens = String(wordsInput || "").replace(/[\s,+]+/g, " ").trim().split(" ").filter(Boolean);
  const seen = new Set();
  const uniqueWords = [];
  for (const token of tokens) {
    const word = cleanWord(token);
    if (!word || seen.has(word)) continue;
    seen.add(word);
    uniqueWords.push(word);
  }

  // Look up all words in parallel
  const results = await Promise.all(uniqueWords.map((w) => lookupWord(w)));

  const valid = [];
  const invalid = [];
  for (let i = 0; i < uniqueWords.length; i++) {
    const word = uniqueWords[i];
    const result = results[i];
    if (result.valid) valid.push({ word, ...result });
    else invalid.push({ word });
  }
  return { valid, invalid };
}
