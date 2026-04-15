// Pre-warm the qbim-dictionary cache with all previously-played words.
// For each unique word, queries MW, then writes the word + every inflected stem
// to the cache. After this runs, ~all real gameplay words will be cache-only (no MW calls).
//
// Usage: MW_API_KEY=... AWS_PROFILE=qbim node --import ./test-env.mjs prewarm-dictionary.mjs

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand, PutCommand, GetCommand } from "@aws-sdk/lib-dynamodb";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: "us-east-1" }));
const MW_KEY = process.env.MW_API_KEY;
const MW_BASE = "https://www.dictionaryapi.com/api/v3/references/collegiate/json";

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

async function callMW(word) {
  const url = `${MW_BASE}/${encodeURIComponent(word)}?key=${MW_KEY}`;
  const r = await fetch(url);
  if (!r.ok) return null;
  const data = await r.json();
  if (!Array.isArray(data) || !data.length || typeof data[0] === "string") return { valid: false };
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
}

function buildUrl(word) {
  return `https://www.merriam-webster.com/dictionary/${encodeURIComponent(word)}`;
}

async function cachedAlready(word) {
  const { Item } = await ddb.send(new GetCommand({ TableName: "qbim-dictionary", Key: { word } }));
  return !!Item;
}

async function main() {
  console.log("Scanning scores for all unique words...");
  const items = await scanAll("qbim-scores");
  const allWords = new Set();
  for (const s of items) {
    if (!s.words) continue;
    const words = s.words.replace(/[\s,+]+/g, " ").trim().split(" ").filter(Boolean);
    for (const w of words) {
      const clean = w.toLowerCase().replace(/[^a-z]/g, "");
      if (clean) allWords.add(clean);
    }
  }
  const wordList = [...allWords].sort();
  console.log(`Found ${wordList.length} unique words\n`);

  let apiCalls = 0;
  let cacheHits = 0;
  let written = 0;
  const now = new Date().toISOString();

  for (const word of wordList) {
    if (await cachedAlready(word)) { cacheHits++; continue; }

    const result = await callMW(word);
    apiCalls++;

    if (!result) {
      console.log(`  ⚠️  MW error for "${word}" — skipping`);
      await new Promise((r) => setTimeout(r, 150));
      continue;
    }

    if (result.valid) {
      const url = buildUrl(result.headword || word);
      await ddb.send(new PutCommand({
        TableName: "qbim-dictionary",
        Item: { word, valid: true, definition: result.definition, url, source: "mw", headword: result.headword, cached_at: now },
      }));
      written++;
      // Also cache every stem
      for (const stem of result.stems || []) {
        if (stem === word) continue;
        if (await cachedAlready(stem)) continue;
        await ddb.send(new PutCommand({
          TableName: "qbim-dictionary",
          Item: { word: stem, valid: true, definition: result.definition, url, source: "mw", headword: result.headword, cached_at: now },
        }));
        written++;
      }
    } else {
      await ddb.send(new PutCommand({
        TableName: "qbim-dictionary",
        Item: { word, valid: false, source: "mw", cached_at: now },
      }));
      written++;
    }

    if (apiCalls % 25 === 0) console.log(`  ${apiCalls} API calls, ${written} cache writes...`);
    await new Promise((r) => setTimeout(r, 150));
  }

  console.log(`\n=== DONE ===`);
  console.log(`Cache hits (skipped): ${cacheHits}`);
  console.log(`MW API calls:         ${apiCalls}`);
  console.log(`Cache writes:         ${written}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
