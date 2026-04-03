/**
 * Full re-import: wipes historical data, re-imports games + scores + player stats,
 * and renumbers games (oldest = #1).
 *
 * Run: node reimport.mjs
 */
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand, DeleteCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { execSync } from "node:child_process";

const client = new DynamoDBClient({ region: "us-east-1" });
const ddb = DynamoDBDocumentClient.from(client);

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

// Step 1: Delete all historical games and scores (hist-* prefix)
console.log("Step 1: Cleaning historical data...");
const games = await scanAll("qbim-games");
const histGames = games.filter((g) => g.game_id.startsWith("hist-"));
for (const g of histGames) {
  const scores = await scanAll("qbim-scores");
  const gameScores = scores.filter((s) => s.game_id === g.game_id);
  for (const s of gameScores) {
    await ddb.send(new DeleteCommand({ TableName: "qbim-scores", Key: { game_id: s.game_id, player_hand_key: s.player_hand_key } }));
  }
  await ddb.send(new DeleteCommand({ TableName: "qbim-games", Key: { game_id: g.game_id } }));
}
console.log(`  Deleted ${histGames.length} historical games`);

// Step 2: Import all history
console.log("\nStep 2: Importing games + scores...");
execSync("node import-all-history.mjs", { stdio: "inherit" });

// Step 3: Import player stats
console.log("\nStep 3: Importing player stats...");
execSync("node import-history.mjs", { stdio: "inherit" });

// Step 4: Renumber games (oldest = #1)
console.log("\nStep 4: Renumbering games...");
const allGames = await scanAll("qbim-games");
const histOnly = allGames.filter((g) => g.game_id.startsWith("hist-"));
const sorted = histOnly.sort((a, b) => {
  const dc = a.game_date.localeCompare(b.game_date);
  if (dc !== 0) return dc;
  return Number(b.game_id.replace("hist-", "")) - Number(a.game_id.replace("hist-", ""));
});
for (let i = 0; i < sorted.length; i++) {
  await ddb.send(new UpdateCommand({
    TableName: "qbim-games",
    Key: { game_id: sorted[i].game_id },
    UpdateExpression: "SET game_number = :n",
    ExpressionAttributeValues: { ":n": i + 1 },
  }));
}
console.log(`  Renumbered ${sorted.length} games (#1 = ${sorted[0]?.game_date}, #${sorted.length} = ${sorted[sorted.length - 1]?.game_date})`);

// Step 5: Clean test players
console.log("\nStep 5: Cleaning test players...");
for (const id of ["U_ALICE", "U_BOB"]) {
  try { await ddb.send(new DeleteCommand({ TableName: "qbim-players", Key: { slack_id: id } })); } catch {}
}

console.log("\nDone! All historical data re-imported and renumbered.");
