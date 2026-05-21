// One-shot cleanup: hard-delete the 4 single-player test games (and any
// score rows for them) that were previously archived. These are
// abandoned one-hand entries from someone testing the system, not real
// games.
//
// Usage:
//   AWS_PROFILE=qbim node delete-test-games.mjs           # dry run
//   AWS_PROFILE=qbim node delete-test-games.mjs --apply   # delete

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";

const APPLY = process.argv.includes("--apply");

const GAME_IDS = [
  "5996c971-1659-4de1-815c-8cb6d62d9a8f", // #109
  "4ed17711-d525-4604-9b14-af30e756bfef", // #118
  "1605e37f-0921-49c3-900c-df19b61beca1", // #129
  "57f34e99-1496-4f78-9117-9872c3b6dd72", // #131
];

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
  console.log(APPLY ? "APPLY MODE — will hard-delete" : "DRY RUN — pass --apply to actually delete");

  const [games, scores] = await Promise.all([
    scanAll("qbim-games"),
    scanAll("qbim-scores"),
  ]);

  const targetIds = new Set(GAME_IDS);
  const targetGames = games.filter((g) => targetIds.has(g.game_id));
  const targetScores = scores.filter((s) => targetIds.has(s.game_id));

  console.log(`Found ${targetGames.length} games and ${targetScores.length} associated score rows.`);
  for (const g of targetGames) {
    console.log(`  game #${g.game_number ?? "?"}  ${g.game_id}  status=${g.status ?? "?"}  ${g.game_date ?? "?"}`);
  }
  for (const s of targetScores) {
    console.log(`  score game_id=${s.game_id} player=${s.player_slack_id} hand=${s.hand}`);
  }

  if (!APPLY) {
    console.log("\nDry run only. Re-run with --apply to delete.");
    return;
  }

  let dGames = 0, dScores = 0;
  for (const g of targetGames) {
    await ddb.send(new DeleteCommand({ TableName: "qbim-games", Key: { game_id: g.game_id } }));
    dGames++;
  }
  // qbim-scores PK varies — most common shape is { game_id, player_hand_key }.
  // Fall back to the actual keys present on each item.
  for (const s of targetScores) {
    const Key = {};
    if (s.game_id != null) Key.game_id = s.game_id;
    if (s.player_hand_key != null) Key.player_hand_key = s.player_hand_key;
    if (s.player_slack_id != null && Key.player_hand_key == null) Key.player_slack_id = s.player_slack_id;
    if (s.hand != null && Key.player_hand_key == null) Key.hand = s.hand;
    try {
      await ddb.send(new DeleteCommand({ TableName: "qbim-scores", Key }));
      dScores++;
    } catch (err) {
      console.warn(`Failed to delete score ${JSON.stringify(Key)}: ${err.message}`);
    }
  }

  console.log(`\nDeleted ${dGames} games and ${dScores} score rows.`);
}

main().catch((err) => { console.error(err); process.exit(1); });
