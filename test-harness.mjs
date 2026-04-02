/**
 * QBIMBOT Test Harness — tests game mechanics against real DynamoDB.
 *
 * Mocks Slack API, simulates a full 2-player game through all hands.
 * Run:  node --import ./test-env.mjs test-harness.mjs [--auto | --interactive]
 *       Defaults to --auto
 */
import crypto from "node:crypto";
import readline from "node:readline";
import { setMockClient } from "./src/lib/slack.mjs";
import * as db from "./src/lib/db.mjs";
import { handler as router } from "./src/handlers/router.mjs";

// ── Test players ────────────────────────────────────────
const playerNames = {
  U_ALICE: "Alice",
  U_BOB: "Bob",
  U_CHARLIE: "Charlie",
};
const PLAYERS = Object.keys(playerNames);

// ── Mock Slack API ──────────────────────────────────────
const channelMessages = [];
const homeViews = {};

const mockSlack = {
  conversations: {
    open: async ({ users }) => ({ channel: { id: `DM_${users}` } }),
  },
  chat: {
    postMessage: async (opts) => {
      channelMessages.push(opts);
      const prefix = opts.channel?.startsWith("DM_") ? `[DM→${opts.channel.slice(3,7)}]` : "[#qbim]";
      if (opts.blocks) {
        for (const b of opts.blocks) {
          if (b.type === "section" && b.text) {
            for (const line of b.text.text.split("\n")) {
              console.log(`  ${prefix}`, line);
            }
          }
        }
      } else {
        console.log(`\n  ${prefix}`, opts.text || "(no content)");
      }
      return { ok: true };
    },
  },
  views: {
    publish: async (opts) => {
      homeViews[opts.user_id] = opts.view;
      console.log(`\n  [HOME TAB for ${playerNames[opts.user_id] || opts.user_id}]`);
      printBlocks(opts.view);
      return { ok: true };
    },
    open: async (opts) => {
      console.log("  [MODAL]", opts.view.title?.text || opts.view.callback_id);
      return { ok: true };
    },
  },
  users: {
    info: async ({ user }) => ({
      user: {
        profile: {
          display_name: playerNames[user] || user,
          real_name: playerNames[user] || user,
        },
      },
    }),
  },
};

setMockClient(mockSlack);

// ── Helpers ─────────────────────────────────────────────
function printBlocks(view) {
  if (!view?.blocks) return;
  for (const block of view.blocks) {
    if (block.type === "section" && block.text) {
      for (const line of block.text.text.split("\n")) {
        console.log("    ", line);
      }
    }
    if (block.type === "actions") {
      const labels = block.elements.map((e) => `[ ${e.text?.text} ]`);
      console.log("    ", labels.join("  "));
    }
    if (block.type === "divider") {
      console.log("     ─────────────────────────────");
    }
  }
}

function sign(body) {
  const raw = typeof body === "string" ? body : JSON.stringify(body);
  const ts = Math.floor(Date.now() / 1000).toString();
  const hmac = crypto
    .createHmac("sha256", process.env.SLACK_SIGNING_SECRET)
    .update(`v0:${ts}:${raw}`)
    .digest("hex");
  return {
    body: raw,
    isBase64Encoded: false,
    headers: {
      "X-Slack-Request-Timestamp": ts,
      "X-Slack-Signature": `v0=${hmac}`,
      "Content-Type": "application/json",
    },
  };
}

async function startGame(userId) {
  heading(`${playerNames[userId]} starts a QBIM game`);
  return router(sign({
    type: "view_submission",
    user: { id: userId },
    view: {
      callback_id: "qbim_start_game_submit",
      state: { values: { game_type_block: { game_type: { selected_option: { value: "QBIM" } } } } },
    },
  }));
}

async function joinGame(gameId, userId) {
  heading(`${playerNames[userId]} joins the game`);
  return router(sign({
    type: "block_actions",
    user: { id: userId },
    actions: [{ action_id: "qbim_join_game", value: gameId }],
    trigger_id: "t",
  }));
}

async function openHome(userId) {
  heading(`${playerNames[userId]} opens Home tab`);
  return router(sign({
    type: "event_callback",
    event: { type: "app_home_opened", user: userId, tab: "home" },
  }));
}

async function submitScore(gameId, userId, hand, words) {
  heading(`${playerNames[userId]} → Hand ${hand}: "${words}"`);
  const result = await router(sign({
    type: "view_submission",
    user: { id: userId },
    view: {
      callback_id: "qbim_submit_score",
      private_metadata: JSON.stringify({ game_id: gameId, hand }),
      state: {
        values: {
          words_block: { words: { value: words } },
        },
      },
    },
  }));

  // If the response is a score choice modal, auto-pick the highest score
  const body = JSON.parse(result.body || "{}");
  if (body.response_action === "update" && body.view?.callback_id === "qbim_confirm_score") {
    const opts = body.view.blocks[1]?.element?.options;
    if (opts?.length) {
      // Pick the first option (highest score, since sorted desc)
      const chosen = opts[0].value;
      console.log(`  >> Multiple scores available (${opts.length} options), auto-picking highest`);
      for (const o of opts) {
        const parsed = JSON.parse(o.value);
        console.log(`     ${parsed.score} pts — ${parsed.breakdown} (${parsed.cards} cards)`);
      }
      return router(sign({
        type: "view_submission",
        user: { id: userId },
        view: {
          callback_id: "qbim_confirm_score",
          private_metadata: body.view.private_metadata,
          state: {
            values: {
              score_choice_block: {
                score_choice: { selected_option: { value: chosen } },
              },
            },
          },
        },
      }));
    }
  }

  return result;
}

async function awardStars(gameId, userId, hand, longestPlayer, mostPlayer) {
  heading(`Stars for Hand ${hand}: Longest=${playerNames[longestPlayer] || "None"}, Most=${playerNames[mostPlayer] || "None"}`);
  return router(sign({
    type: "view_submission",
    user: { id: userId },
    view: {
      callback_id: "qbim_submit_stars",
      private_metadata: JSON.stringify({ game_id: gameId, hand }),
      state: {
        values: {
          longest_word_block: { longest_word_player: { selected_option: { value: longestPlayer } } },
          most_words_block: { most_words_player: { selected_option: { value: mostPlayer } } },
        },
      },
    },
  }));
}

function heading(msg) {
  console.log(`\n${"═".repeat(60)}`);
  console.log(`  ${msg}`);
  console.log("═".repeat(60));
}

// ── Cleanup ─────────────────────────────────────────────
async function cleanup() {
  console.log("Cleaning up test data...");
  const { DynamoDBClient } = await import("@aws-sdk/client-dynamodb");
  const { DynamoDBDocumentClient, DeleteCommand, ScanCommand } = await import("@aws-sdk/lib-dynamodb");
  const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

  for (const table of ["qbim-games", "qbim-scores", "qbim-players"]) {
    const { Items } = await ddb.send(new ScanCommand({ TableName: table }));
    for (const item of Items || []) {
      const key = table === "qbim-games"
        ? { game_id: item.game_id }
        : table === "qbim-scores"
          ? { game_id: item.game_id, player_hand_key: item.player_hand_key }
          : { slack_id: item.slack_id };
      await ddb.send(new DeleteCommand({ TableName: table, Key: key }));
    }
  }
  console.log("Clean.\n");
}

// ── Auto Test ───────────────────────────────────────────
async function autoTest() {
  console.log("\n╔══════════════════════════════════════════════════════════╗");
  console.log("║   QBIMBOT AUTO-TEST: 2-player full game (hands 3–10)   ║");
  console.log("╚══════════════════════════════════════════════════════════╝");

  await cleanup();

  // Start game
  await startGame(PLAYERS[0]);
  const today = new Date().toISOString().slice(0, 10);
  const games = await db.getGamesByDate(today);
  const game = games[games.length - 1];
  const gid = game.game_id;
  console.log(`\n  Game ID: ${gid}`);

  // Bob joins
  await joinGame(gid, PLAYERS[1]);

  // Alice views Home — should see "Enter Hand 3 Score"
  await openHome(PLAYERS[0]);

  // Sample words for hands 3–10 (3 cards in hand 3, 4 in hand 4, etc.)
  const rounds = [
    { hand: 3,  alice: "cat",          bob: "dog",            lw: 0, mw: 0 },
    { hand: 4,  alice: "th-in",        bob: "quiz",           lw: 0, mw: 1 },
    { hand: 5,  alice: "er-a-s-e",     bob: "cl-i-m-b",       lw: 0, mw: 0 },
    { hand: 6,  alice: "in-k pot",     bob: "qu-a-k-er",      lw: 1, mw: 1 },
    { hand: 7,  alice: "bl-in-d-er",   bob: "th-u-m-b-s",     lw: 0, mw: 0 },
    { hand: 8,  alice: "cl-e-v-er go", bob: "th-in-k-in-g",   lw: 1, mw: 0 },
    { hand: 9,  alice: "j-u-m-p fire", bob: "qu-i-z w-a-x",   lw: 0, mw: 1 },
    { hand: 10, alice: "b-l-a-z-e opt", bob: "th-er-m-a-l icy", lw: 1, mw: 0 },
  ];

  for (const s of rounds) {
    // Alice submits
    await submitScore(gid, PLAYERS[0], s.hand, s.alice);

    // Check status after first score
    if (s.hand === 3) {
      const g = await db.getGame(gid);
      console.log(`\n  >> Status after Alice's first score: ${g.status}`);
    }

    // Bob submits (triggers auto star award)
    await submitScore(gid, PLAYERS[1], s.hand, s.bob);
  }

  // Check final state
  const finalGame = await db.getGame(gid);
  console.log(`\n\n${"★".repeat(60)}`);
  console.log(`  FINAL STATUS: ${finalGame.status}`);

  const allScores = await db.getScoresForGame(gid);
  let aliceTotal = 0, bobTotal = 0, aliceStars = 0, bobStars = 0;
  for (const s of allScores) {
    if (s.player_slack_id === PLAYERS[0]) { aliceTotal += s.raw_score; aliceStars += s.stars || 0; }
    if (s.player_slack_id === PLAYERS[1]) { bobTotal += s.raw_score; bobStars += s.stars || 0; }
  }
  console.log(`  Alice: Raw=${aliceTotal} Stars=${aliceStars} Final=${aliceTotal + aliceStars * 10}`);
  console.log(`  Bob:   Raw=${bobTotal} Stars=${bobStars} Final=${bobTotal + bobStars * 10}`);
  console.log(`${"★".repeat(60)}\n`);

  // View final home tabs
  await openHome(PLAYERS[0]);
  await openHome(PLAYERS[1]);

  console.log("\n  Auto-test complete.\n");
}

// ── Interactive Mode ────────────────────────────────────
async function interactive() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q) => new Promise((r) => rl.question(q, r));

  let gid = null;

  // Check for existing game
  const today = new Date().toISOString().slice(0, 10);
  const existing = await db.getGamesByDate(today);
  const active = existing.find((g) => g.status === "OPEN" || g.status === "ACTIVE");
  if (active) {
    gid = active.game_id;
    console.log(`Resuming game: ${gid} (${active.status})\n`);
  }

  while (true) {
    console.log("\n┌──────────────────────────────────────┐");
    console.log("│  1. Start game (Alice)               │");
    console.log("│  2. Join (Bob)   3. Join (Charlie)   │");
    console.log("│  4. Submit score                     │");
    console.log("│  5. Award stars                      │");
    console.log("│  6. View Home tab                    │");
    console.log("│  7. Show DB state                    │");
    console.log("│  8. Reset all data                   │");
    console.log("│  0. Exit                             │");
    console.log("└──────────────────────────────────────┘");

    const c = (await ask("Choice: ")).trim();

    if (c === "0") { rl.close(); return; }

    if (c === "1") {
      await startGame(PLAYERS[0]);
      const games = await db.getGamesByDate(today);
      gid = games[games.length - 1]?.game_id;
    } else if (c === "2") {
      if (!gid) { console.log("No game."); continue; }
      await joinGame(gid, PLAYERS[1]);
    } else if (c === "3") {
      if (!gid) { console.log("No game."); continue; }
      await joinGame(gid, PLAYERS[2]);
    } else if (c === "4") {
      if (!gid) { console.log("No game."); continue; }
      const p = await ask("Player (1=Alice 2=Bob 3=Charlie): ");
      const h = await ask("Hand (3-10): ");
      const w = await ask("Words (e.g. qu-i-z fox): ");
      await submitScore(gid, PLAYERS[Number(p) - 1], Number(h), w);
    } else if (c === "5") {
      if (!gid) { console.log("No game."); continue; }
      const h = await ask("Hand (3-10): ");
      const lw = await ask("Longest word (1=Alice 2=Bob 3=Charlie 0=None): ");
      const mw = await ask("Most words (1=Alice 2=Bob 3=Charlie 0=None): ");
      await awardStars(gid, PLAYERS[0], Number(h), lw === "0" ? "none" : PLAYERS[Number(lw) - 1], mw === "0" ? "none" : PLAYERS[Number(mw) - 1]);
    } else if (c === "6") {
      const p = await ask("Player (1=Alice 2=Bob 3=Charlie): ");
      await openHome(PLAYERS[Number(p) - 1]);
    } else if (c === "7") {
      if (!gid) { console.log("No game."); continue; }
      const game = await db.getGame(gid);
      console.log("\n  Game:", JSON.stringify(game, null, 2));
      const scores = await db.getScoresForGame(gid);
      console.log("  Scores:", JSON.stringify(scores, null, 2));
    } else if (c === "8") {
      await cleanup();
      gid = null;
    }
  }
}

// ── Entry point ─────────────────────────────────────────
const mode = process.argv[2] || "--auto";
if (mode === "--interactive" || mode === "-i") {
  await interactive();
} else {
  await autoTest();
}
