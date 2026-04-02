import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";

const client = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(client);

const GAMES_TABLE = process.env.GAMES_TABLE;
const SCORES_TABLE = process.env.SCORES_TABLE;
const PLAYERS_TABLE = process.env.PLAYERS_TABLE;

// ── Games ──────────────────────────────────────────────

export async function getGame(gameId) {
  const { Item } = await ddb.send(
    new GetCommand({ TableName: GAMES_TABLE, Key: { game_id: gameId } })
  );
  return Item;
}

export async function getGamesByDate(dateStr) {
  const { Items } = await ddb.send(
    new QueryCommand({
      TableName: GAMES_TABLE,
      IndexName: "date-index",
      KeyConditionExpression: "game_date = :d",
      ExpressionAttributeValues: { ":d": dateStr },
      ScanIndexForward: true,
    })
  );
  return Items || [];
}

export async function getRecentGames(limit = 5) {
  // Scan and sort by created_at descending — works fine for small datasets
  const { Items } = await ddb.send(
    new QueryCommand({
      TableName: GAMES_TABLE,
      IndexName: "date-index",
      KeyConditionExpression: "game_date = :d",
      ExpressionAttributeValues: { ":d": new Date().toISOString().slice(0, 10) },
      ScanIndexForward: false,
    })
  );
  // If no games today, check yesterday
  if (!Items || Items.length === 0) {
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const { Items: yItems } = await ddb.send(
      new QueryCommand({
        TableName: GAMES_TABLE,
        IndexName: "date-index",
        KeyConditionExpression: "game_date = :d",
        ExpressionAttributeValues: { ":d": yesterday },
        ScanIndexForward: false,
      })
    );
    return yItems || [];
  }
  return Items;
}

export async function createGame(game) {
  await ddb.send(new PutCommand({ TableName: GAMES_TABLE, Item: game }));
  return game;
}

export async function updateGameStatus(gameId, status, extraAttrs = {}) {
  let updateExpr = "SET #s = :s";
  const names = { "#s": "status" };
  const values = { ":s": status };

  for (const [k, v] of Object.entries(extraAttrs)) {
    updateExpr += `, ${k} = :${k}`;
    values[`:${k}`] = v;
  }

  await ddb.send(
    new UpdateCommand({
      TableName: GAMES_TABLE,
      Key: { game_id: gameId },
      UpdateExpression: updateExpr,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
    })
  );
}

export async function addPlayerToGame(gameId, slackId) {
  await ddb.send(
    new UpdateCommand({
      TableName: GAMES_TABLE,
      Key: { game_id: gameId },
      UpdateExpression:
        "SET players = list_append(if_not_exists(players, :empty), :p)",
      ConditionExpression: "NOT contains(players, :pid)",
      ExpressionAttributeValues: {
        ":p": [slackId],
        ":empty": [],
        ":pid": slackId,
      },
    })
  );
}

export async function setPlayerStartHand(gameId, slackId, hand) {
  await ddb.send(
    new UpdateCommand({
      TableName: GAMES_TABLE,
      Key: { game_id: gameId },
      UpdateExpression: "SET player_start_hands.#pid = :h",
      ExpressionAttributeNames: { "#pid": slackId },
      ExpressionAttributeValues: { ":h": hand },
    })
  );
}

export async function addMulligan(gameId, playerId, hand) {
  const key = `${playerId}#${hand}`;
  await ddb.send(
    new UpdateCommand({
      TableName: GAMES_TABLE,
      Key: { game_id: gameId },
      UpdateExpression: "SET mulligans.#k = if_not_exists(mulligans.#k, :zero) + :one",
      ExpressionAttributeNames: { "#k": key },
      ExpressionAttributeValues: { ":zero": 0, ":one": 1 },
    })
  );
}

export async function getMulliganCount(gameId, playerId, hand) {
  const game = await getGame(gameId);
  return game?.mulligans?.[`${playerId}#${hand}`] || 0;
}

export async function initMulligansMap(gameId) {
  // Ensure the mulligans map exists on the game record
  await ddb.send(
    new UpdateCommand({
      TableName: GAMES_TABLE,
      Key: { game_id: gameId },
      UpdateExpression: "SET mulligans = if_not_exists(mulligans, :empty)",
      ExpressionAttributeValues: { ":empty": {} },
    })
  );
}

export async function addDealer(gameId, slackId) {
  await ddb.send(
    new UpdateCommand({
      TableName: GAMES_TABLE,
      Key: { game_id: gameId },
      UpdateExpression: "SET dealers = list_append(if_not_exists(dealers, :empty), :d)",
      ExpressionAttributeValues: { ":empty": [], ":d": [slackId] },
    })
  );
}

export async function removePlayerFromGame(gameId, slackId) {
  const game = await getGame(gameId);
  if (!game) return;
  const updated = (game.players || []).filter((id) => id !== slackId);
  await ddb.send(
    new UpdateCommand({
      TableName: GAMES_TABLE,
      Key: { game_id: gameId },
      UpdateExpression: "SET players = :p",
      ExpressionAttributeValues: { ":p": updated },
    })
  );
}

// ── Scores ─────────────────────────────────────────────

export async function putScore(score) {
  await ddb.send(new PutCommand({ TableName: SCORES_TABLE, Item: score }));
}

export async function getScoresForGame(gameId) {
  const { Items } = await ddb.send(
    new QueryCommand({
      TableName: SCORES_TABLE,
      KeyConditionExpression: "game_id = :g",
      ExpressionAttributeValues: { ":g": gameId },
    })
  );
  return Items || [];
}

export async function getScoresForGameHand(gameId, hand) {
  const { Items } = await ddb.send(
    new QueryCommand({
      TableName: SCORES_TABLE,
      KeyConditionExpression: "game_id = :g",
      FilterExpression: "hand = :h",
      ExpressionAttributeValues: { ":g": gameId, ":h": hand },
    })
  );
  return Items || [];
}

export async function updateScoreStars(gameId, playerHandKey, stars, longestWord, mostWords) {
  try {
    await ddb.send(
      new UpdateCommand({
        TableName: SCORES_TABLE,
        Key: { game_id: gameId, player_hand_key: playerHandKey },
        UpdateExpression:
          "SET stars = :s, star_longest_word = :lw, star_most_words = :mw",
        ConditionExpression: "attribute_exists(player_slack_id)",
        ExpressionAttributeValues: {
          ":s": stars,
          ":lw": longestWord,
          ":mw": mostWords,
        },
      })
    );
  } catch (err) {
    if (err.name === "ConditionalCheckFailedException") return; // score not submitted yet, skip
    throw err;
  }
}

// ── Players ────────────────────────────────────────────

export async function getPlayer(slackId) {
  const { Item } = await ddb.send(
    new GetCommand({ TableName: PLAYERS_TABLE, Key: { slack_id: slackId } })
  );
  return Item;
}

export async function upsertPlayer(slackId, displayName) {
  await ddb.send(
    new UpdateCommand({
      TableName: PLAYERS_TABLE,
      Key: { slack_id: slackId },
      UpdateExpression:
        "SET display_name = :dn, games_played = if_not_exists(games_played, :zero), all_time_wins = if_not_exists(all_time_wins, :zero), all_time_stars = if_not_exists(all_time_stars, :zero)",
      ExpressionAttributeValues: { ":dn": displayName, ":zero": 0 },
    })
  );
}

export async function setPlayerPreference(slackId, key, value) {
  await ddb.send(
    new UpdateCommand({
      TableName: PLAYERS_TABLE,
      Key: { slack_id: slackId },
      UpdateExpression: "SET preferences.#k = :v",
      ExpressionAttributeNames: { "#k": key },
      ExpressionAttributeValues: { ":v": value },
    })
  );
}

export async function initPreferences(slackId) {
  await ddb.send(
    new UpdateCommand({
      TableName: PLAYERS_TABLE,
      Key: { slack_id: slackId },
      UpdateExpression: "SET preferences = if_not_exists(preferences, :empty)",
      ExpressionAttributeValues: { ":empty": {} },
    })
  );
}

export async function incrementPlayerStats(slackId, { gamesPlayed = 0, wins = 0, stars = 0, mulligans = 0 }) {
  const parts = [];
  const values = {};
  if (gamesPlayed) { parts.push("games_played :gp"); values[":gp"] = gamesPlayed; }
  if (wins) { parts.push("all_time_wins :w"); values[":w"] = wins; }
  if (stars) { parts.push("all_time_stars :st"); values[":st"] = stars; }
  if (mulligans) { parts.push("all_time_mulligans :ml"); values[":ml"] = mulligans; }
  if (!parts.length) return;

  await ddb.send(
    new UpdateCommand({
      TableName: PLAYERS_TABLE,
      Key: { slack_id: slackId },
      UpdateExpression: `ADD ${parts.join(", ")}`,
      ExpressionAttributeValues: values,
    })
  );
}
