/**
 * Replay the real game from 2026-03-31 with the exact words entered.
 * Tests the + separator fix and star assignment.
 *
 * Run: node --import ./test-env.mjs test-replay.mjs
 */
import crypto from "node:crypto";
import { setMockClient } from "./src/lib/slack.mjs";
import * as db from "./src/lib/db.mjs";
import { handler as router } from "./src/handlers/router.mjs";

// Player mapping (short names for readability)
const PLAYERS = {
  JOE:   "U03KBK8EA1W",
  SCOTT: "U093FPM6DFD",
  BEAU:  "U05UEDYBPPF",
  KANE:  "U03FRD18WJV",
  JASON: "U03F65324NS",
  SEAN:  "U0A2G784MGA",
  DAVID: "U03F9E9EEA1",
};

const playerNames = {};
for (const [name, id] of Object.entries(PLAYERS)) playerNames[id] = name;

// Mock Slack
setMockClient({
  conversations: { open: async ({ users }) => ({ channel: { id: `DM_${users}` } }) },
  chat: { postMessage: async (opts) => {
    const prefix = opts.channel?.startsWith("DM_") ? `[DM→${(playerNames[opts.channel.slice(3)] || opts.channel.slice(3,7))}]` : "[#qbim]";
    if (opts.blocks) {
      for (const b of opts.blocks) {
        if (b.type === "section" && b.text) {
          for (const line of b.text.text.split("\n")) console.log(`  ${prefix}`, line);
        }
      }
    }
    return { ok: true };
  }},
  views: {
    publish: async () => ({ ok: true }),
    open: async () => ({ ok: true }),
  },
  users: { info: async ({ user }) => ({
    user: { profile: { display_name: playerNames[user] || user, real_name: playerNames[user] || user } }
  })},
});

function sign(body) {
  const raw = JSON.stringify(body);
  const ts = Math.floor(Date.now() / 1000).toString();
  const hmac = crypto.createHmac("sha256", process.env.SLACK_SIGNING_SECRET).update(`v0:${ts}:${raw}`).digest("hex");
  return { body: raw, isBase64Encoded: false, headers: { "X-Slack-Request-Timestamp": ts, "X-Slack-Signature": `v0=${hmac}`, "Content-Type": "application/json" } };
}

async function startGame(userId) {
  return router(sign({ type: "view_submission", user: { id: userId }, view: { callback_id: "qbim_start_game_submit", state: { values: { game_type_block: { game_type: { selected_option: { value: "QBIM" } } } } } } }));
}

async function joinGame(gameId, userId) {
  return router(sign({ type: "block_actions", user: { id: userId }, actions: [{ action_id: "qbim_join_game", value: gameId }], trigger_id: "t" }));
}

async function submitScore(gameId, userId, hand, words) {
  const result = await router(sign({ type: "view_submission", user: { id: userId }, view: { callback_id: "qbim_submit_score", private_metadata: JSON.stringify({ game_id: gameId, hand }), state: { values: { words_block: { words: { value: words } } } } } }));
  const body = JSON.parse(result.body || "{}");
  if (body.response_action === "update" && body.view?.callback_id === "qbim_confirm_score") {
    const opts = body.view.blocks[1]?.element?.options;
    if (opts?.length) {
      const chosen = opts[0].value;
      return router(sign({ type: "view_submission", user: { id: userId }, view: { callback_id: "qbim_confirm_score", private_metadata: body.view.private_metadata, state: { values: { score_choice_block: { score_choice: { selected_option: { value: chosen } } } } } } }));
    }
  }
  return result;
}

async function dropPlayer(gameId, userId) {
  return router(sign({ type: "view_submission", user: { id: userId }, view: { callback_id: "qbim_end_game_confirm", private_metadata: JSON.stringify({ game_id: gameId }), state: { values: { end_game_choice_block: { end_game_choice: { selected_option: { value: "drop" } } } } } } }));
}

// Exact words from the real game
const GAME_DATA = [
  { hand: 3, scores: { JASON: "Ruth+", DAVID: "Van", KANE: "Liner", JOE: "god", BEAU: "Tax", SCOTT: "ray", SEAN: "Ab+" } },
  { hand: 4, scores: { JASON: "Fars+", DAVID: "Diet", KANE: "M-in-c-e", JOE: "at+the", BEAU: "Jar", SCOTT: "glob", SEAN: "Barn" } },
  { hand: 5, scores: { JASON: "Is+hi", DAVID: "Doer+ye", KANE: "Evade", JOE: "ox+win", BEAU: "Go+rip", SCOTT: "ze+doer", SEAN: "Qi+bet" } },
  { hand: 6, scores: { JASON: "The+pin+me", DAVID: "Quiz+pine", KANE: "Qat+rho", JOE: "fawn+ew", BEAU: "Hot+nob", SCOTT: "joy+fad", SEAN: "Maid+Ze" } },
  // DAVID dropped after hand 6
  { hand: 7, scores: { JASON: "Verge+rain", KANE: "Quiver+ok", JOE: "thin+chime", BEAU: "Jog+rots", SCOTT: "fax+musk", SEAN: "Cloy+trip" } },
  { hand: 8, scores: { JASON: "Vet+pander+", KANE: "Ai+or+be+it", JOE: "club+keg+le", BEAU: "Ask+awe+on", SCOTT: "nor+qua+ax", SEAN: "Mess+quid" } },
  { hand: 9, scores: { JASON: "The+gnarl+gi+", KANE: "Cop+razorer", JOE: "find+hex+quo", BEAU: "Her+dux+jew", SCOTT: "vat+saint", SEAN: "Ok+clams+vie+" } },
  { hand: 10, scores: { JASON: "On+gin+yo+ax+qi", KANE: "Ugh+jerk+ward", JOE: "hun+clef+clerk", BEAU: "To+zit+plaza", SCOTT: "rudd+ax+try", SEAN: "Coif+vain+job" } },
];

// Cleanup
async function cleanup() {
  const { DynamoDBClient } = await import("@aws-sdk/client-dynamodb");
  const { DynamoDBDocumentClient, DeleteCommand, ScanCommand } = await import("@aws-sdk/lib-dynamodb");
  const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
  for (const table of ["qbim-games", "qbim-scores"]) {
    const { Items } = await ddb.send(new ScanCommand({ TableName: table }));
    for (const item of Items || []) {
      const key = table === "qbim-games" ? { game_id: item.game_id } : { game_id: item.game_id, player_hand_key: item.player_hand_key };
      await ddb.send(new DeleteCommand({ TableName: table, Key: key }));
    }
  }
}

// Run
console.log("=== REPLAY: Real game from 2026-03-31 ===\n");
await cleanup();

// Start game (Joe)
await startGame(PLAYERS.JOE);
const today = new Date().toISOString().slice(0, 10);
const games = await db.getGamesByDate(today);
const gid = games[games.length - 1].game_id;

// Everyone joins
for (const name of ["SCOTT", "BEAU", "KANE", "JASON", "SEAN", "DAVID"]) {
  await joinGame(gid, PLAYERS[name]);
}
console.log("All players joined.\n");

// Play hands
for (const round of GAME_DATA) {
  console.log(`\n── Hand ${round.hand} ──`);

  // Drop David after hand 6
  if (round.hand === 7) {
    console.log("  DAVID drops...");
    await dropPlayer(gid, PLAYERS.DAVID);
  }

  for (const [name, words] of Object.entries(round.scores)) {
    const pid = PLAYERS[name];
    console.log(`  ${name}: "${words}"`);
    await submitScore(gid, pid, round.hand, words);
  }
}

// Final state
const finalGame = await db.getGame(gid);
console.log(`\n\n${"★".repeat(50)}`);
console.log(`FINAL STATUS: ${finalGame.status}`);
const allScores = await db.getScoresForGame(gid);
const byPlayer = {};
for (const s of allScores) {
  const name = playerNames[s.player_slack_id] || s.player_slack_id;
  if (!byPlayer[name]) byPlayer[name] = { raw: 0, stars: 0 };
  byPlayer[name].raw += s.raw_score || 0;
  byPlayer[name].stars += s.stars || 0;
}
for (const [name, t] of Object.entries(byPlayer).sort((a,b) => (b[1].raw + b[1].stars*10) - (a[1].raw + a[1].stars*10))) {
  console.log(`  ${name}: Raw=${t.raw} Stars=${t.stars} Final=${t.raw + t.stars * 10}`);
}
console.log("★".repeat(50));

// Show per-hand star detail
console.log("\nPer-hand star detail:");
for (const s of allScores.sort((a,b) => a.hand - b.hand)) {
  if (s.stars > 0) {
    const name = playerNames[s.player_slack_id] || s.player_slack_id;
    const reasons = [];
    if (s.star_longest_word) reasons.push("longest");
    if (s.star_most_words) reasons.push("most words");
    console.log(`  H${s.hand} ${name}: ${s.stars} star(s) [${reasons.join(", ")}] — "${s.words}" (${s.longest_word_letters} letters, ${s.word_count} words)`);
  }
}
