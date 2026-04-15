// Extract all unique words played, then check against Merriam-Webster API.
// Usage: node --import ./test-env.mjs check-words.mjs

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand } from "@aws-sdk/lib-dynamodb";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: "us-east-1" }));

async function scanAll(table) {
  const items = [];
  let lastKey;
  do {
    const r = await ddb.send(new ScanCommand({ TableName: table, ExclusiveStartKey: lastKey }));
    items.push(...(r.Items || []));
    lastKey = r.LastEvaluatedKey;
  } while (lastKey);
  return items;
}

const MW_KEY = process.env.MW_API_KEY;

async function checkMW(word) {
  const url = `https://www.dictionaryapi.com/api/v3/references/collegiate/json/${encodeURIComponent(word)}?key=${MW_KEY}`;
  const target = word.toLowerCase();
  try {
    const r = await fetch(url);
    if (!r.ok) return { valid: false, definition: null };
    const data = await r.json();
    if (!Array.isArray(data) || !data.length) return { valid: false, definition: null };
    if (typeof data[0] === "string") return { valid: false, definition: null };

    // Accept if any entry's stems array contains our word (handles inflected forms),
    // OR if the meta.id (minus ":N" homograph suffix) matches our word
    for (const entry of data) {
      const metaId = (entry.meta?.id || "").split(":")[0].toLowerCase();
      const stems = (entry.meta?.stems || []).map((s) => s.toLowerCase());
      if (metaId === target || stems.includes(target)) {
        return { valid: true, definition: entry.shortdef?.[0] || null, headword: metaId };
      }
    }
    return { valid: false, definition: null };
  } catch (e) {
    console.error(`  ERROR checking "${word}":`, e.message);
    return { valid: false, definition: null };
  }
}

async function main() {
  console.log("Scanning scores...");
  const items = await scanAll("qbim-scores");

  const allWords = new Set();
  for (const s of items) {
    if (!s.words) continue;
    const words = s.words.replace(/[\s,+]+/g, " ").trim().split(" ").filter(Boolean);
    for (const w of words) {
      const clean = w.toLowerCase().replace(/-/g, "");
      if (clean) allWords.add(clean);
    }
  }

  const wordList = [...allWords].sort();
  console.log(`\nUnique words played: ${wordList.length}`);
  console.log(`API calls needed: ${wordList.length}\n`);

  if (wordList.length > 950) {
    console.log("WARNING: too many words for the 1000/day limit. Batching would exceed quota.");
    console.log("Words:", wordList.join(", "));
    return;
  }

  // Check each word with a small delay to be polite
  const valid = [];
  const invalid = [];
  let checked = 0;

  for (const word of wordList) {
    const result = await checkMW(word);
    if (result.valid) valid.push({ word, definition: result.definition });
    else invalid.push(word);
    checked++;
    if (checked % 20 === 0) console.log(`  checked ${checked}/${wordList.length}...`);
    // 150ms delay between calls
    await new Promise((r) => setTimeout(r, 150));
  }

  console.log(`\n=== RESULTS ===`);
  console.log(`Total unique words: ${wordList.length}`);
  console.log(`Valid: ${valid.length} (${(valid.length/wordList.length*100).toFixed(1)}%)`);
  console.log(`Rejected: ${invalid.length} (${(invalid.length/wordList.length*100).toFixed(1)}%)`);
  console.log(`API calls used: ${wordList.length}`);
  console.log(`\nRejected words (${invalid.length}):`);
  for (const w of invalid) {
    console.log(`  ❌ ${w}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
