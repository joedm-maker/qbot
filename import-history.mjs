/**
 * Import historical QBIM data into the Players table.
 * Run: node import-history.mjs
 *
 * Reads from \\BIRD\Shared\QBIM\qbim_data.json and computes
 * per-player stats, then writes them to the qbim-players DynamoDB table.
 *
 * Player name → Slack ID mapping must be provided below.
 */
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { readFileSync } from "node:fs";

const client = new DynamoDBClient({ region: "us-east-1" });
const ddb = DynamoDBDocumentClient.from(client);
const TABLE = "qbim-players";

// Map historical names → Slack IDs (fill these in)
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

function computeStats(games) {
  const stats = {};

  for (const game of games) {
    const winner = getWinner(game.totals);
    for (const player of game.players_present) {
      if (!stats[player]) {
        stats[player] = {
          games_played: 0, games_won: 0, total_stars: 0,
          hands_won: 0, total_hands: 0,
          all_totals: [], all_hand_scores: [],
          highest_hand: 0, highest_game: 0, lowest_game: Infinity,
          times_hand_screwed: 0, times_screwed_others: 0,
          scores_by_hand: {}, wins_by_hand: {},
        };
      }
      const ps = stats[player];
      ps.games_played++;
      const total = game.totals[player] || 0;
      ps.all_totals.push(total);
      if (total > ps.highest_game) ps.highest_game = total;
      if (total < ps.lowest_game) ps.lowest_game = total;
      if (player === winner) ps.games_won++;

      for (const hand of game.hands) {
        if (!hand.scores[player]) continue;
        const [val, stars] = hand.scores[player];
        const hn = hand.hand;
        ps.total_hands++;
        ps.all_hand_scores.push(val);
        ps.total_stars += stars;
        if (val > ps.highest_hand) ps.highest_hand = val;
        if (!ps.scores_by_hand[hn]) ps.scores_by_hand[hn] = [];
        ps.scores_by_hand[hn].push(val);

        // Hand winner (by effective score)
        const entries = Object.entries(hand.scores);
        let effBestP = null, effBestV = -Infinity;
        let baseBestP = null, baseBestV = -Infinity;
        for (const [p, [v, s]] of entries) {
          const eff = v + 10 * s;
          if (eff > effBestV) { effBestV = eff; effBestP = p; }
          if (v > baseBestV) { baseBestV = v; baseBestP = p; }
        }
        if (effBestP === player) {
          ps.hands_won++;
          ps.wins_by_hand[hn] = (ps.wins_by_hand[hn] || 0) + 1;
        }
        if (baseBestP !== effBestP) {
          if (player === baseBestP) ps.times_hand_screwed++;
          if (player === effBestP) ps.times_screwed_others++;
        }
      }
    }
  }

  // Compute derived stats
  for (const [name, ps] of Object.entries(stats)) {
    ps.win_pct = ps.games_played > 0 ? (ps.games_won / ps.games_played * 100) : 0;
    ps.avg_game_total = ps.all_totals.length > 0
      ? ps.all_totals.reduce((a, b) => a + b, 0) / ps.all_totals.length : 0;
    ps.avg_hand_score = ps.all_hand_scores.length > 0
      ? ps.all_hand_scores.reduce((a, b) => a + b, 0) / ps.all_hand_scores.length : 0;
    ps.stars_per_game = ps.games_played > 0 ? ps.total_stars / ps.games_played : 0;
    if (ps.lowest_game === Infinity) ps.lowest_game = 0;

    // Best hand
    const handNums = Object.keys(ps.wins_by_hand).map(Number);
    if (handNums.length > 0) {
      let bestH = handNums[0];
      for (const h of handNums) {
        if (ps.wins_by_hand[h] > ps.wins_by_hand[bestH]) bestH = h;
      }
      const sc = ps.scores_by_hand[bestH] || [];
      const avg = sc.length > 0 ? sc.reduce((a, b) => a + b, 0) / sc.length : 0;
      ps.best_hand = { hand: bestH, wins: ps.wins_by_hand[bestH], avg: Math.round(avg * 10) / 10 };
    }

    // Cleanup
    delete ps.all_totals;
    delete ps.all_hand_scores;
    delete ps.scores_by_hand;
    delete ps.wins_by_hand;
  }

  return stats;
}

const stats = computeStats(data.games);

console.log("Computed stats for", Object.keys(stats).length, "players\n");

for (const [name, ps] of Object.entries(stats)) {
  const slackId = NAME_TO_SLACK[name];
  console.log(`${name}: ${ps.games_played}G ${ps.games_won}W ${ps.win_pct.toFixed(1)}% avg=${ps.avg_game_total.toFixed(0)} stars=${ps.total_stars} screwed=${ps.times_hand_screwed} screwedOthers=${ps.times_screwed_others}`);

  if (!slackId) {
    console.log(`  ⚠ No Slack ID mapped — skipping DynamoDB write\n`);
    continue;
  }

  await ddb.send(new UpdateCommand({
    TableName: TABLE,
    Key: { slack_id: slackId },
    UpdateExpression: `SET
      display_name = :name,
      games_played = :gp,
      all_time_wins = :w,
      all_time_stars = :stars,
      win_pct = :wpct,
      avg_game_total = :avg,
      highest_game_total = :high,
      lowest_game_total = :low,
      highest_hand_score = :hh,
      avg_hand_score = :ahs,
      hands_won = :hw,
      total_hands_played = :thp,
      stars_per_game = :spg,
      times_hand_screwed = :ths,
      times_screwed_others = :tso,
      best_hand = :bh,
      historical_games = :hg`,
    ExpressionAttributeValues: {
      ":name": name.charAt(0) + name.slice(1).toLowerCase(),
      ":gp": ps.games_played,
      ":w": ps.games_won,
      ":stars": ps.total_stars,
      ":wpct": Math.round(ps.win_pct * 10) / 10,
      ":avg": Math.round(ps.avg_game_total * 10) / 10,
      ":high": ps.highest_game,
      ":low": ps.lowest_game,
      ":hh": ps.highest_hand,
      ":ahs": Math.round(ps.avg_hand_score * 10) / 10,
      ":hw": ps.hands_won,
      ":thp": ps.total_hands,
      ":spg": Math.round(ps.stars_per_game * 100) / 100,
      ":ths": ps.times_hand_screwed,
      ":tso": ps.times_screwed_others,
      ":bh": ps.best_hand || null,
      ":hg": ps.games_played, // total historical games count
    },
  }));

  console.log(`  ✓ Written to DynamoDB (${slackId})\n`);
}

console.log("\nDone. Players without Slack IDs need to be mapped in NAME_TO_SLACK.");
