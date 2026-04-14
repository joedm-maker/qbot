/**
 * AutoQ DynamoDB operations.
 *
 * Single table `qbim-autoq` with pk/sk design:
 * - Game state: pk=autoq-{uuid}, sk=STATE
 * - Hand scores: pk=autoq-{uuid}, sk=HAND#N
 * - Personal bests: pk=PBEST#{userId}, sk=HAND#N (plus sk=TOTAL for game total)
 * - GSI on player_id + created_at for history queries
 */
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

const TABLE = () => process.env.AUTOQ_TABLE;

// ── Game State ────────────────────────────────────────

export async function createAutoQGame(game) {
  await ddb.send(new PutCommand({
    TableName: TABLE(),
    Item: {
      pk: `autoq-${game.game_id}`,
      sk: "STATE",
      ...game,
    },
  }));
  return game;
}

export async function getAutoQGame(gameId) {
  const { Item } = await ddb.send(new GetCommand({
    TableName: TABLE(),
    Key: { pk: `autoq-${gameId}`, sk: "STATE" },
  }));
  return Item || null;
}

export async function updateAutoQGame(gameId, attrs) {
  const setParts = [];
  const removeParts = [];
  const names = {};
  const values = {};

  for (const [k, v] of Object.entries(attrs)) {
    const safe = k.replace(/[^a-zA-Z0-9_]/g, "_");
    names[`#${safe}`] = k;
    if (v === null || v === undefined) {
      removeParts.push(`#${safe}`);
    } else {
      setParts.push(`#${safe} = :${safe}`);
      values[`:${safe}`] = v;
    }
  }

  let expr = "";
  if (setParts.length) expr += `SET ${setParts.join(", ")}`;
  if (removeParts.length) expr += ` REMOVE ${removeParts.join(", ")}`;
  if (!expr) return;

  const params = {
    TableName: TABLE(),
    Key: { pk: `autoq-${gameId}`, sk: "STATE" },
    UpdateExpression: expr.trim(),
    ExpressionAttributeNames: names,
  };
  if (Object.keys(values).length) params.ExpressionAttributeValues = values;

  await ddb.send(new UpdateCommand(params));
}

// ── Hand Scores ───────────────────────────────────────

export async function putAutoQHandScore(gameId, hand, scoreData) {
  await ddb.send(new PutCommand({
    TableName: TABLE(),
    Item: {
      pk: `autoq-${gameId}`,
      sk: `HAND#${hand}`,
      ...scoreData,
    },
  }));
}

export async function getAutoQHandScores(gameId) {
  const { Items } = await ddb.send(new QueryCommand({
    TableName: TABLE(),
    KeyConditionExpression: "pk = :pk AND begins_with(sk, :prefix)",
    ExpressionAttributeValues: {
      ":pk": `autoq-${gameId}`,
      ":prefix": "HAND#",
    },
  }));
  return Items || [];
}

// ── Personal Bests ────────────────────────────────────

export async function getAllPersonalBests(userId) {
  const { Items } = await ddb.send(new QueryCommand({
    TableName: TABLE(),
    KeyConditionExpression: "pk = :pk",
    ExpressionAttributeValues: { ":pk": `PBEST#${userId}` },
  }));
  return Items || [];
}

/**
 * Conditionally update personal best — only if new score > existing.
 */
export async function updatePersonalBest(userId, hand, score, words) {
  const sk = hand === "TOTAL" ? "TOTAL" : `HAND#${hand}`;
  try {
    await ddb.send(new UpdateCommand({
      TableName: TABLE(),
      Key: { pk: `PBEST#${userId}`, sk },
      UpdateExpression: "SET best_score = :s, best_words = :w, updated_at = :t",
      ConditionExpression: "attribute_not_exists(best_score) OR best_score < :s",
      ExpressionAttributeValues: {
        ":s": score,
        ":w": words,
        ":t": new Date().toISOString(),
      },
    }));
    return true; // new best!
  } catch (err) {
    if (err.name === "ConditionalCheckFailedException") return false;
    throw err;
  }
}
