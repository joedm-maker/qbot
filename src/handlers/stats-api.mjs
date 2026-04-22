/**
 * Read-only stats API for the dashboard.
 * GET /stats/players, /stats/games, /stats/scores
 * No Slack signature required — public read endpoints.
 */
import * as db from "../lib/db.mjs";
import { validateWords } from "../lib/dictionary.mjs";

const CORS_HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET",
};

import { getHandRange } from "../lib/cards.mjs";


export async function handleStatsRequest(event) {
  const path = event.path;

  try {
    if (path === "/stats/players") return await getPlayers();
    if (path === "/stats/games") return await getGames();
    if (path === "/stats/scores") return await getScores();
    if (path === "/stats/live") return await getLiveGame();
    if (path === "/stats/validatewords") return await validateWordsEndpoint(event);
    return { statusCode: 404, headers: CORS_HEADERS, body: '{"error":"Not found"}' };
  } catch (err) {
    console.error("stats-api error:", err);
    return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: err.message }) };
  }
}

async function getScores() {
  const scores = await scanAll("qbim-scores");
  // Normalize player_id
  const normalized = scores.map((s) => ({ ...s, player_id: s.player_slack_id }));
  return respond(normalized);
}

async function getGames() {
  const games = await scanAll("qbim-games");
  const scores = await scanAll("qbim-scores");

  // Build lookup map once
  const scoresByGame = {};
  for (const s of scores) {
    if (!scoresByGame[s.game_id]) scoresByGame[s.game_id] = [];
    scoresByGame[s.game_id].push(s);
  }

  const completed = games
    .filter((g) => g.status === "COMPLETE")
    .sort((a, b) => (b.game_number || 0) - (a.game_number || 0));

  // Add winner if missing
  for (const g of completed) {
    if (!g.winner) {
      const gameScores = scoresByGame[g.game_id] || [];
      const totals = {};
      for (const s of gameScores) {
        const pid = s.player_slack_id;
        if (!totals[pid]) totals[pid] = 0;
        totals[pid] += (s.raw_score || 0) + (s.stars || 0) * 10;
      }
      const entries = Object.entries(totals);
      if (entries.length) g.winner = entries.sort((a, b) => b[1] - a[1])[0][0];
    }
  }

  return respond(completed);
}

async function getPlayers() {
  const [rawPlayers, rawGames, rawScores] = await Promise.all([
    scanAll("qbim-players"),
    scanAll("qbim-games"),
    scanAll("qbim-scores"),
  ]);

  const players = {};
  for (const p of rawPlayers) players[p.slack_id] = p;

  const scores = rawScores.map((s) => ({ ...s, player_id: s.player_slack_id }));
  const games = rawGames.filter((g) => g.status === "COMPLETE");

  // Build lookup maps once
  const scoresByGameId = {};
  const scoresByPlayerId = {};
  for (const s of scores) {
    if (!scoresByGameId[s.game_id]) scoresByGameId[s.game_id] = [];
    scoresByGameId[s.game_id].push(s);
    if (!scoresByPlayerId[s.player_id]) scoresByPlayerId[s.player_id] = [];
    scoresByPlayerId[s.player_id].push(s);
  }

  // Add winner to games
  for (const g of games) {
    if (!g.winner) {
      const gs = scoresByGameId[g.game_id] || [];
      const totals = {};
      for (const s of gs) { totals[s.player_id] = (totals[s.player_id] || 0) + (s.raw_score || 0) + (s.stars || 0) * 10; }
      const e = Object.entries(totals);
      if (e.length) g.winner = e.sort((a, b) => b[1] - a[1])[0][0];
    }
  }

  // Build game lookup for type
  const gameById = {};
  for (const g of games) gameById[g.game_id] = g;

  // Enrich with computed stats
  for (const [pid, p] of Object.entries(players)) {
    const playerScores = scoresByPlayerId[pid] || [];

    const scoresByGame = {};
    for (const s of playerScores) {
      if (!scoresByGame[s.game_id]) scoresByGame[s.game_id] = [];
      scoresByGame[s.game_id].push(s);
    }

    // Complete games only
    const completeGameIds = [];
    for (const [gid, gScores] of Object.entries(scoresByGame)) {
      const hands = new Set(gScores.map((s) => s.hand));
      const gameType = gameById[gid]?.game_type;
      const requiredHands = getHandRange(gameType);
      if (requiredHands.every((h) => hands.has(h))) completeGameIds.push(gid);
    }
    const completeGames = games.filter((g) => completeGameIds.includes(g.game_id));

    const gp = completeGames.length;
    const wins = completeGames.filter((g) => g.winner === pid).length;
    const completeGameTotals = completeGameIds.map((gid) =>
      scoresByGame[gid].reduce((sum, s) => sum + (s.raw_score || 0) + (s.stars || 0) * 10, 0)
    );

    p.games_played = gp;
    p.all_time_wins = wins;
    p.win_pct = gp > 0 ? Math.round((wins / gp) * 1000) / 10 : 0;

    if (completeGameTotals.length) {
      p.avg_game_total = Math.round(completeGameTotals.reduce((a, b) => a + b, 0) / completeGameTotals.length * 10) / 10;
      p.highest_game_total = Math.max(...completeGameTotals);
      p.lowest_game_total = Math.min(...completeGameTotals);
    } else {
      p.avg_game_total = 0; p.highest_game_total = 0; p.lowest_game_total = 0;
    }

    // Hand-level (all hands)
    let totalStars = 0, totalMulligans = 0;
    for (const s of playerScores) { totalStars += s.stars || 0; totalMulligans += s.mulligans || 0; }

    p.all_time_stars = totalStars;
    p.all_time_mulligans = totalMulligans;
    p.stars_per_game = gp > 0 ? Math.round(totalStars / gp * 100) / 100 : 0;

    if (playerScores.length) {
      const rawOnly = playerScores.map((s) => s.raw_score || 0);
      p.highest_hand_score = Math.max(...rawOnly);
      p.avg_hand_score = Math.round(rawOnly.reduce((a, b) => a + b, 0) / rawOnly.length * 10) / 10;
      p.total_hands_played = playerScores.length;
    } else {
      p.highest_hand_score = 0; p.avg_hand_score = 0; p.total_hands_played = 0;
    }

    p.hands_won = p.hands_won || 0;
    p.times_hand_screwed = p.times_hand_screwed || 0;
    p.times_screwed_others = p.times_screwed_others || 0;
  }

  return respond(players);
}

async function getLiveGame() {
  const games = await scanAll("qbim-games");
  const active = games.filter((g) => g.status === "OPEN" || g.status === "ACTIVE");
  if (!active.length) return respond(null);

  // Pick the most recent active game
  const game = active.sort((a, b) => (b.game_number || 0) - (a.game_number || 0))[0];

  // Get scores and player names
  const allScores = await scanAll("qbim-scores");
  const gameScores = allScores
    .filter((s) => s.game_id === game.game_id)
    .map((s) => ({ ...s, player_id: s.player_slack_id }));

  const rawPlayers = await scanAll("qbim-players");
  const playerNames = {};
  for (const p of rawPlayers) {
    playerNames[p.slack_id] = p.display_name || p.slack_id;
  }

  return respond({
    game,
    scores: gameScores,
    playerNames,
  });
}

// Full table scan with pagination
async function scanAll(tableName) {
  const { DynamoDBClient } = await import("@aws-sdk/client-dynamodb");
  const { DynamoDBDocumentClient, ScanCommand } = await import("@aws-sdk/lib-dynamodb");
  const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

  const items = [];
  let lastKey;
  do {
    const result = await ddb.send(new ScanCommand({ TableName: tableName, ExclusiveStartKey: lastKey }));
    items.push(...(result.Items || []));
    lastKey = result.LastEvaluatedKey;
  } while (lastKey);
  return items;
}

async function validateWordsEndpoint(event) {
  const words = event.queryStringParameters?.words;
  if (!words) return respond({ valid: [], invalid: [] });
  const result = await validateWords(words);
  return respond(result);
}

function respond(data) {
  return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify(data) };
}
