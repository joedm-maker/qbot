// One-shot cleanup: flip partial games (status=COMPLETE but missing
// some H3-H10 scores from at least one rostered player) to
// status=ARCHIVED. Reversible — original status is preserved in
// `prev_status` and a timestamp is set in `archived_at`.
//
// Usage:
//   AWS_PROFILE=qbim node archive-partial-games.mjs           # dry run
//   AWS_PROFILE=qbim node archive-partial-games.mjs --apply   # write
//
// ARCHIVED games are naturally dropped by every existing
// `status === "COMPLETE"` filter, so they vanish from the dashboard,
// home tab, and any post-game logic. Storage row is otherwise intact.

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";

const APPLY = process.argv.includes("--apply");
const ALL_HANDS = [3, 4, 5, 6, 7, 8, 9, 10];

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

async function main() {
  console.log(APPLY ? "APPLY MODE — will mutate DynamoDB" : "DRY RUN — pass --apply to actually update");

  const [games, scores] = await Promise.all([
    scanAll("qbim-games"),
    scanAll("qbim-scores"),
  ]);
  console.log(`Loaded ${games.length} games, ${scores.length} scores.`);

  const scoresByGame = new Map();
  for (const s of scores) {
    if (!scoresByGame.has(s.game_id)) scoresByGame.set(s.game_id, []);
    scoresByGame.get(s.game_id).push(s);
  }

  const partials = [];
  for (const g of games) {
    if (g.status !== "COMPLETE") continue;
    const gScores = scoresByGame.get(g.game_id) || [];
    const handsByPlayer = {};
    for (const s of gScores) {
      if (!handsByPlayer[s.player_slack_id]) handsByPlayer[s.player_slack_id] = new Set();
      handsByPlayer[s.player_slack_id].add(s.hand);
    }
    const fullyComplete = (g.players || []).every((pid) => {
      const hs = handsByPlayer[pid];
      return hs && ALL_HANDS.every((h) => hs.has(h));
    });
    if (!fullyComplete) partials.push(g);
  }

  console.log(`Found ${partials.length} partial COMPLETE games:`);
  for (const g of partials) {
    const gScores = scoresByGame.get(g.game_id) || [];
    const handCounts = {};
    for (const s of gScores) {
      const pid = s.player_slack_id;
      handCounts[pid] = (handCounts[pid] || 0) + 1;
    }
    const summary = (g.players || []).map((p) => `${p.slice(-4)}=${handCounts[p] || 0}h`).join(", ");
    console.log(`  #${g.game_number ?? "?"}  ${g.game_id}  ${g.game_date ?? "?"}  ${g.game_type ?? "?"}  players: ${summary}`);
  }

  if (!APPLY) {
    console.log("\nDry run only. Re-run with --apply to flip status to ARCHIVED.");
    return;
  }

  let archived = 0;
  for (const g of partials) {
    await ddb.send(new UpdateCommand({
      TableName: "qbim-games",
      Key: { game_id: g.game_id },
      UpdateExpression: "SET #s = :archived, archived_at = :ts, prev_status = :prev",
      ExpressionAttributeNames: { "#s": "status" },
      ExpressionAttributeValues: {
        ":archived": "ARCHIVED",
        ":ts": new Date().toISOString(),
        ":prev": g.status,
      },
    }));
    archived++;
  }
  console.log(`\nArchived ${archived} games. Set status=ARCHIVED, prev_status=COMPLETE.`);
}

main().catch((err) => { console.error(err); process.exit(1); });
