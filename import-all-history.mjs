/**
 * Import ALL historical QBIM data into DynamoDB.
 * Imports games into qbim-games and scores into qbim-scores.
 * Also updates player stats in qbim-players.
 *
 * Run: node import-all-history.mjs
 */
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, BatchWriteCommand } from "@aws-sdk/lib-dynamodb";
import { readFileSync } from "node:fs";
import crypto from "node:crypto";

const client = new DynamoDBClient({ region: "us-east-1" });
const ddb = DynamoDBDocumentClient.from(client);

const NAME_TO_SLACK = {
  JOE: "U03KBK8EA1W",
  BEAU: "U05UEDYBPPF",
  JASON: "U03F65324NS",
  KANE: "U03FRD18WJV",
  DAVID: "U03F9E9EEA1",
  SCOTT: "U093FPM6DFD",
  SEAN: "U0A2G784MGA",
};

const data = JSON.parse(readFileSync("//BIRD/Shared/QBIM/qbim_data.json", "utf8"));

function getWinner(totals) {
  let best = null, bestV = -Infinity;
  for (const [p, v] of Object.entries(totals)) {
    if (v > bestV) { bestV = v; best = p; }
  }
  return best;
}

// Batch write with 25-item limit
async function batchPut(tableName, items) {
  const batches = [];
  for (let i = 0; i < items.length; i += 25) {
    batches.push(items.slice(i, i + 25));
  }
  for (const batch of batches) {
    await ddb.send(new BatchWriteCommand({
      RequestItems: {
        [tableName]: batch.map((item) => ({ PutRequest: { Item: item } })),
      },
    }));
  }
}

console.log(`Importing ${data.games.length} games...\n`);

let totalScoreRecords = 0;

for (let gi = 0; gi < data.games.length; gi++) {
  const g = data.games[gi];
  const gameId = `hist-${String(gi + 1).padStart(3, "0")}`;
  const winnerName = getWinner(g.totals);
  const winnerId = NAME_TO_SLACK[winnerName] || null;

  const playerIds = g.players_present.map((n) => NAME_TO_SLACK[n]).filter(Boolean);
  const startHands = {};
  for (const pid of playerIds) startHands[pid] = 3;

  // Game record
  const gameRecord = {
    game_id: gameId,
    game_date: g.date,
    game_number: gi + 1,
    game_type: g.game_type === "quickler" ? "Quickler" : "QBIM",
    status: "COMPLETE",
    players: playerIds,
    player_start_hands: startHands,
    mulligans: {},
    host_slack_id: playerIds[0],
    winner: winnerId,
    created_at: `${g.date}T12:00:00.000Z`,
    completed_at: `${g.date}T13:00:00.000Z`,
  };

  await ddb.send(new PutCommand({ TableName: "qbim-games", Item: gameRecord }));

  // Score records
  const scoreRecords = [];
  for (const hand of g.hands) {
    for (const [playerName, [rawScore, stars]] of Object.entries(hand.scores)) {
      const pid = NAME_TO_SLACK[playerName];
      if (!pid) continue;

      scoreRecords.push({
        game_id: gameId,
        player_hand_key: `${pid}#${hand.hand}`,
        player_slack_id: pid,
        hand: hand.hand,
        raw_score: rawScore,
        words: "",  // historical data doesn't have words
        word_count: 0,
        longest_word_letters: 0,
        mulligans: 0,
        breakdown: "",
        stars: stars,
        star_longest_word: false,
        star_most_words: false,
        submitted_at: `${g.date}T12:${String(hand.hand).padStart(2, "0")}:00.000Z`,
      });
    }
  }

  await batchPut("qbim-scores", scoreRecords);
  totalScoreRecords += scoreRecords.length;

  const playerList = g.players_present.join(", ");
  console.log(`  Game ${gi + 1} (${g.date}) ${g.game_type} — ${playerList} — Winner: ${winnerName}`);
}

console.log(`\nDone! Imported ${data.games.length} games, ${totalScoreRecords} score records.`);
