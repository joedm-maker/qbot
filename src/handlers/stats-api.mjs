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
    if (path === "/stats/autoq-scores") return await getAutoqScores();
    if (path === "/stats/live") return await getLiveGame();
    if (path === "/stats/validatewords") return await validateWordsEndpoint(event);
    if (path === "/stats/dictionary") return await getDictionary();
    return { statusCode: 404, headers: CORS_HEADERS, body: '{"error":"Not found"}' };
  } catch (err) {
    console.error("stats-api error:", err);
    return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: err.message }) };
  }
}

async function getScores() {
  const [scores, games] = await Promise.all([
    scanAll("qbim-scores"),
    scanAll("qbim-games"),
  ]);
  // Build game lookup so we can stamp deck_variant onto each score.
  // Legacy games predate the field — they're implicitly "Quiddler".
  const variantByGame = {};
  for (const g of games) variantByGame[g.game_id] = g.deck_variant || "Quiddler";
  const normalized = scores.map((s) => ({
    ...s,
    player_id: s.player_slack_id,
    deck_variant: variantByGame[s.game_id] || "Quiddler",
  }));
  return respond(normalized);
}

// AutoQ hand scores from the qbim-autoq table. AutoQ is solo against
// historical-derived bots; only the human's plays are stored as items
// with sk = "HAND#<n>". Returns the normalized rows so the dashboard's
// word-stats can merge them with regular qbim-scores word data.
// Words from AutoQ are dictionary-validated, so they're safe to fold
// into the same pool.
async function getAutoqScores() {
  const items = await scanAll(process.env.AUTOQ_TABLE || "qbim-autoq");
  // Index AutoQ STATE items so each HAND# record can pick up its parent
  // game's deck_variant. Legacy AutoQ games default to "Quiddler".
  const variantByGame = {};
  for (const it of items) {
    if (it.sk === "STATE" && typeof it.pk === "string") {
      const gid = it.pk.replace(/^autoq-/, "");
      variantByGame[gid] = it.deck_variant || "Quiddler";
    }
  }
  const handItems = items.filter((it) => typeof it.sk === "string" && it.sk.startsWith("HAND#"));
  const normalized = handItems.map((it) => {
    const gameId = typeof it.pk === "string" ? it.pk.replace(/^autoq-/, "") : null;
    return {
      game_id: gameId,
      player_id: it.player_id,
      player_slack_id: it.player_id,
      hand: it.hand,
      raw_score: it.raw_score || 0,
      stars: it.stars || 0,
      words: it.words || "",
      breakdown: it.breakdown || "",
      word_count: it.word_count || 0,
      longest_word_letters: it.longest_word_letters || 0,
      submitted_at: it.submitted_at || null,
      source: "autoq",
      deck_variant: (gameId && variantByGame[gameId]) || "Quiddler",
    };
  });
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

  // "Fully complete" = status COMPLETE AND every player on the roster
  // submitted a score for every hand H3-H10. Partial games (someone
  // dropped, host ended early) stay in storage but never surface here,
  // so the dashboard's sequencing only counts true 8-hand games.
  const ALL_HANDS = [3, 4, 5, 6, 7, 8, 9, 10];
  const fullyComplete = games.filter((g) => {
    if (g.status !== "COMPLETE") return false;
    const gScores = scoresByGame[g.game_id] || [];
    const handsByPlayer = {};
    for (const s of gScores) {
      if (!handsByPlayer[s.player_slack_id]) handsByPlayer[s.player_slack_id] = new Set();
      handsByPlayer[s.player_slack_id].add(s.hand);
    }
    return (g.players || []).every((pid) => {
      const hands = handsByPlayer[pid];
      return hands && ALL_HANDS.every((h) => hands.has(h));
    });
  });

  // Assign complete_number 1..N in creation order (ascending by game_number).
  // game_number stays untouched on the record — it's the storage-order id.
  // Stamp deck_variant default for legacy records that predate the field.
  const ascByCreation = [...fullyComplete].sort((a, b) => (a.game_number || 0) - (b.game_number || 0));
  ascByCreation.forEach((g, idx) => {
    g.complete_number = idx + 1;
    g.deck_variant = g.deck_variant || "Quiddler";
  });

  const completed = ascByCreation.sort((a, b) => b.complete_number - a.complete_number);

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
  // Default deck_variant on legacy game records so the per-deck filtering works.
  const games = rawGames
    .filter((g) => g.status === "COMPLETE")
    .map((g) => ({ ...g, deck_variant: g.deck_variant || "Quiddler" }));

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

  // Build game lookup for type + deck_variant
  const gameById = {};
  for (const g of games) gameById[g.game_id] = g;

  // Compute one deck's stats block for a player. Pulled out as a helper so the
  // main fields (Quiddler) and the power_stats sub-object share the same logic.
  function computeDeckBlock(pid, variant, playerScores) {
    const filteredScores = playerScores.filter((s) => (gameById[s.game_id]?.deck_variant || "Quiddler") === variant);

    const scoresByGame = {};
    for (const s of filteredScores) {
      if (!scoresByGame[s.game_id]) scoresByGame[s.game_id] = [];
      scoresByGame[s.game_id].push(s);
    }

    const completeGameIds = [];
    for (const [gid, gScores] of Object.entries(scoresByGame)) {
      const hands = new Set(gScores.map((s) => s.hand));
      const gameType = gameById[gid]?.game_type;
      const requiredHands = getHandRange(gameType);
      if (requiredHands.every((h) => hands.has(h))) completeGameIds.push(gid);
    }
    const completeGames = games.filter((g) => completeGameIds.includes(g.game_id) && g.deck_variant === variant);

    const gp = completeGames.length;
    const wins = completeGames.filter((g) => g.winner === pid).length;
    const completeGameTotals = completeGameIds.map((gid) =>
      scoresByGame[gid].reduce((sum, s) => sum + (s.raw_score || 0) + (s.stars || 0) * 10, 0)
    );

    let totalStars = 0, totalMulligans = 0;
    for (const s of filteredScores) { totalStars += s.stars || 0; totalMulligans += s.mulligans || 0; }

    const rawOnly = filteredScores.map((s) => s.raw_score || 0);
    return {
      games_played: gp,
      all_time_wins: wins,
      win_pct: gp > 0 ? Math.round((wins / gp) * 1000) / 10 : 0,
      avg_game_total: completeGameTotals.length ? Math.round(completeGameTotals.reduce((a, b) => a + b, 0) / completeGameTotals.length * 10) / 10 : 0,
      highest_game_total: completeGameTotals.length ? Math.max(...completeGameTotals) : 0,
      lowest_game_total: completeGameTotals.length ? Math.min(...completeGameTotals) : 0,
      all_time_stars: totalStars,
      all_time_mulligans: totalMulligans,
      stars_per_game: gp > 0 ? Math.round(totalStars / gp * 100) / 100 : 0,
      highest_hand_score: rawOnly.length ? Math.max(...rawOnly) : 0,
      avg_hand_score: rawOnly.length ? Math.round(rawOnly.reduce((a, b) => a + b, 0) / rawOnly.length * 10) / 10 : 0,
      total_hands_played: filteredScores.length,
    };
  }

  for (const [pid, p] of Object.entries(players)) {
    const playerScores = scoresByPlayerId[pid] || [];

    // Main fields stay Quiddler-only so any dashboard built today is unaffected
    // by Power games. Power gets its own parallel block.
    const quiddler = computeDeckBlock(pid, "Quiddler", playerScores);
    Object.assign(p, quiddler);

    p.power_stats = computeDeckBlock(pid, "Power", playerScores);

    // Persisted-only counters (not computed from scores). Keep across decks.
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
  game.deck_variant = game.deck_variant || "Quiddler";

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

// Returns just the rejected words — everything else is valid by omission.
// Small payload (~a few hundred entries), cacheable on the client.
async function getDictionary() {
  const items = await scanAll("qbim-dictionary");
  const invalid = items
    .filter((i) => i.valid === false)
    .map((i) => String(i.word).toLowerCase());
  return respond({ invalid });
}

function respond(data) {
  return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify(data) };
}
