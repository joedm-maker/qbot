// One-shot backfill: recompute every player's `times_hand_screwed` and
// `times_screwed_others` (Screwed / Villain) under the corrected "stolen hand"
// rule and OVERWRITE the stored values.
//
// The old rule only credited a villain when the top raw score had a SINGLE
// holder, so a star stealing a hand from two tied raw leaders scored nobody.
// The fix (src/lib/screwed.mjs): a hand is stolen whenever there is a sole
// effective winner whose raw was below the top raw — and every tied raw leader
// is credited as screwed. This script re-derives the canonical totals from the
// score rows so the values are correct-by-construction, not patched deltas.
//
// Game set = games the live code counted at finalize time: status COMPLETE, or
// archived games that were COMPLETE when finalized (prev_status === COMPLETE).
// This keeps these two fields consistent with the other stats (games_played,
// wins, stars) that still include those archived games.
//
// Usage:
//   AWS_PROFILE=qbim node backfill-screwed-stats.mjs           # dry run
//   AWS_PROFILE=qbim node backfill-screwed-stats.mjs --apply   # write

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { computeScrewedCounts } from "./src/lib/screwed.mjs";

const APPLY = process.argv.includes("--apply");
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: "us-east-1" }));

async function scanAll(TableName) {
  const out = [];
  let ExclusiveStartKey;
  do {
    const r = await ddb.send(new ScanCommand({ TableName, ExclusiveStartKey }));
    out.push(...(r.Items || []));
    ExclusiveStartKey = r.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return out;
}

// A game contributed to lifetime stats iff it reached COMPLETE at finalize time.
const wasCounted = (g) => g.status === "COMPLETE" || g.prev_status === "COMPLETE";

async function main() {
  console.log(APPLY ? "APPLY MODE — will overwrite DynamoDB" : "DRY RUN — pass --apply to write");

  const [games, scores, players] = await Promise.all([
    scanAll("qbim-games"),
    scanAll("qbim-scores"),
    scanAll("qbim-players"),
  ]);
  console.log(`Loaded ${games.length} games, ${scores.length} scores, ${players.length} players.`);

  const scoresByGame = new Map();
  for (const s of scores) {
    if (!scoresByGame.has(s.game_id)) scoresByGame.set(s.game_id, []);
    scoresByGame.get(s.game_id).push(s);
  }

  const counted = games.filter(wasCounted);
  console.log(`Counting ${counted.length} games (COMPLETE or prev_status=COMPLETE).`);

  // Accumulate recomputed totals per player across every counted game.
  const newScrewed = new Map();
  const newVillain = new Map();
  const seenPlayers = new Set(players.map((p) => p.slack_id));
  for (const g of counted) {
    const gScores = scoresByGame.get(g.game_id) || [];
    if (gScores.length === 0) continue;
    const { screwedCounts, screwedOthersCounts } = computeScrewedCounts(g, gScores);
    for (const [pid, n] of screwedCounts) {
      newScrewed.set(pid, (newScrewed.get(pid) || 0) + n);
      seenPlayers.add(pid);
    }
    for (const [pid, n] of screwedOthersCounts) {
      newVillain.set(pid, (newVillain.get(pid) || 0) + n);
      seenPlayers.add(pid);
    }
  }

  const stored = new Map(players.map((p) => [p.slack_id, p]));
  const rows = [...seenPlayers]
    .map((pid) => {
      const p = stored.get(pid) || {};
      return {
        pid,
        oldS: p.times_hand_screwed || 0,
        oldV: p.times_screwed_others || 0,
        newS: newScrewed.get(pid) || 0,
        newV: newVillain.get(pid) || 0,
      };
    })
    .sort((a, b) => b.newV - a.newV);

  console.log("\nplayer          screwed (old→new)    villain (old→new)");
  let tOldS = 0, tNewS = 0, tOldV = 0, tNewV = 0, changed = 0;
  for (const r of rows) {
    tOldS += r.oldS; tNewS += r.newS; tOldV += r.oldV; tNewV += r.newV;
    const delta = r.oldS !== r.newS || r.oldV !== r.newV;
    if (delta) changed++;
    const mark = delta ? " *" : "";
    console.log(
      `${r.pid.padEnd(14)}  ${String(r.oldS).padStart(4)} → ${String(r.newS).padEnd(4)}        ${String(r.oldV).padStart(4)} → ${String(r.newV).padEnd(4)}${mark}`
    );
  }
  console.log(`\nTotals: screwed ${tOldS} → ${tNewS}   |   villain ${tOldV} → ${tNewV}`);
  console.log(`New totals are recomputed from score rows, so they also shed any historical`);
  console.log(`drift in the stored values (re-finalizes / post-hoc score edits), not just the`);
  console.log(`villain-rule fix. Per player, the rule fix only ever ADDS villain/screwed events.`);
  console.log(`${changed} player(s) change.`);

  if (!APPLY) {
    console.log("\nDry run only. Re-run with --apply to overwrite times_hand_screwed / times_screwed_others.");
    return;
  }

  let written = 0;
  for (const r of rows) {
    await ddb.send(new UpdateCommand({
      TableName: "qbim-players",
      Key: { slack_id: r.pid },
      UpdateExpression: "SET times_hand_screwed = :s, times_screwed_others = :v",
      ExpressionAttributeValues: { ":s": r.newS, ":v": r.newV },
    }));
    written++;
  }
  console.log(`\nOverwrote screwed/villain stats for ${written} player(s).`);
}

main().catch((err) => { console.error(err); process.exit(1); });
