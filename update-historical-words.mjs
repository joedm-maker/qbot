// Backfill historical hand-record words onto the most recent matching score entry.
// Usage:
//   node --experimental-vm-modules --import ./test-env.mjs update-historical-words.mjs         (dry run)
//   node --experimental-vm-modules --import ./test-env.mjs update-historical-words.mjs --live  (apply)

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  ScanCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";

const DRY_RUN = !process.argv.includes("--live");

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: "us-east-1" }));

const TARGETS = [
  { hand: 3,  player_slack_id: "U0A2G784MGA", player_name: "Sean",  raw_score: 25, words: "jaw",             breakdown: "j-a-w" },
  { hand: 4,  player_slack_id: "U03FRD18WJV", player_name: "Kane",  raw_score: 35, words: "quiz",            breakdown: "q-u-i-z" },
  { hand: 5,  player_slack_id: "U03KBK8EA1W", player_name: "Joe",   raw_score: 41, words: "vex thin",        breakdown: "v-e-x th-in" },
  { hand: 6,  player_slack_id: "U03KBK8EA1W", player_name: "Joe",   raw_score: 56, words: "jazzing",         breakdown: "j-a-z-z-in-g" },
  { hand: 7,  player_slack_id: "U093FPM6DFD", player_name: "Scott", raw_score: 60, words: "jazz sex",        breakdown: "j-a-z-z s-e-x" },
  { hand: 8,  player_slack_id: "U03KBK8EA1W", player_name: "Joe",   raw_score: 64, words: "zinger ze ox",    breakdown: "z-in-g-er z-e o-x" },
  { hand: 9,  player_slack_id: "U0A2G784MGA", player_name: "Sean",  raw_score: 65, words: "jazz in pun",     breakdown: "j-a-z-z i-n p-u-n" },
  { hand: 10, player_slack_id: "U03F65324NS", player_name: "Jason", raw_score: 72, words: "qi oh thin ox ze", breakdown: "q-i o-h th-in o-x z-e" },
];

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

async function main() {
  console.log(`=== Historical word backfill (${DRY_RUN ? "DRY RUN" : "LIVE"}) ===\n`);

  const [scores, games] = await Promise.all([
    scanAll("qbim-scores"),
    scanAll("qbim-games"),
  ]);

  const gameById = {};
  for (const g of games) gameById[g.game_id] = g;

  for (const t of TARGETS) {
    const matches = scores.filter(
      (s) =>
        s.hand === t.hand &&
        s.player_slack_id === t.player_slack_id &&
        (s.raw_score || 0) === t.raw_score
    );

    if (matches.length === 0) {
      console.log(`❌ H${t.hand} ${t.player_name} ${t.raw_score}pts — NO MATCH`);
      continue;
    }

    // Sort by game_number desc, pick most recent
    matches.sort((a, b) => {
      const ga = gameById[a.game_id]?.game_number || 0;
      const gb = gameById[b.game_id]?.game_number || 0;
      return gb - ga;
    });
    const target = matches[0];
    const gn = gameById[target.game_id]?.game_number;
    const existingWords = target.words || "";
    const existingBreakdown = target.breakdown || "";

    const status =
      matches.length > 1
        ? `${matches.length} matches → picking most recent (Game #${gn})`
        : `(Game #${gn})`;
    console.log(`✓ H${t.hand} ${t.player_name} ${t.raw_score}pts ${status}`);
    console.log(`    existing words: "${existingWords}" | breakdown: "${existingBreakdown}"`);
    console.log(`    new words:      "${t.words}"  | breakdown: "${t.breakdown}"`);

    if (!DRY_RUN) {
      await ddb.send(
        new UpdateCommand({
          TableName: "qbim-scores",
          Key: { game_id: target.game_id, player_hand_key: target.player_hand_key },
          UpdateExpression: "SET words = :w, breakdown = :b",
          ExpressionAttributeValues: { ":w": t.words, ":b": t.breakdown },
        })
      );
      console.log(`    ✅ updated`);
    }
  }

  console.log(`\n${DRY_RUN ? "DRY RUN complete. Re-run with --live to apply." : "LIVE updates complete."}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
