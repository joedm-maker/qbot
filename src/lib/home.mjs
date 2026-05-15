/**
 * Shared home tab rendering and helper functions.
 * Used by both game-flow and score-entry handlers.
 */
import { slack, dmUser } from "./slack.mjs";
import * as db from "./db.mjs";
import * as blocks from "./blocks.mjs";
import { getHandRange, CARD_VALUES, formatWordsWithPoints } from "./cards.mjs";

// ── Home Tab Rendering ─────────────────────────────────

export const ADMIN_USER = process.env.SLACK_ADMIN_USER_ID || "U09MS4ZGBHN"; // Office account

export async function renderHome(userId) {
  // Admin gets a special view
  if (userId === ADMIN_USER) {
    return renderAdminHome(userId);
  }

  const today = new Date().toISOString().slice(0, 10);
  const games = await db.getGamesByDate(today);

  // Find the user's active/open games (games they're a player in)
  const myGames = games.filter(
    (g) => (g.status === "OPEN" || g.status === "ACTIVE") && g.players.includes(userId)
  );
  // Games the user can join (OPEN games they're NOT in)
  // Games the user can join (OPEN or ACTIVE games they're NOT in)
  const joinableGames = games.filter(
    (g) => (g.status === "OPEN" || g.status === "ACTIVE") && !g.players.includes(userId)
  );

  // Pick the user's primary game: prefer ACTIVE, then OPEN
  const myGame = myGames.find((g) => g.status === "ACTIVE")
    || myGames.find((g) => g.status === "OPEN")
    || null;

  // If user has no game, check for most recent complete game
  const lastComplete = !myGame
    ? games.filter((g) => g.status === "COMPLETE").pop()
    : null;

  const game = myGame || lastComplete;

  let viewBlocks = [];

  if (!game) {
    viewBlocks = blocks.homeNoGame().blocks;
  } else if (game.status === "OPEN") {
    const names = await resolveNames(game.players);
    const userInGame = game.players.includes(userId);
    const v = blocks.homeLobby(game, [...names.values()], userInGame);
    viewBlocks = v.blocks;
  } else if (game.status === "ACTIVE") {
    const names = await resolveNames(game.players);
    const allScores = await db.getScoresForGame(game.game_id);

    // Look up viewer's score preference
    const viewerPlayer = await db.getPlayer(userId);
    const showOwnScore = viewerPlayer?.preferences?.show_own_score || false;

    // Check if game is in review mode (all hands complete, waiting to finalize)
    if (game.review_started_at) {
      // Check 10-minute timeout.
      // NOTE: This only triggers on the next Home tab visit — there is no
      // background timer (e.g. CloudWatch scheduled event) to auto-finalize.
      const reviewStart = new Date(game.review_started_at).getTime();
      const elapsed = Date.now() - reviewStart;
      if (elapsed > 10 * 60 * 1000) {
        const { finalizeGame } = await import("../handlers/score-entry.mjs");
        await finalizeGame(game.game_id);
        const updatedGame = await db.getGame(game.game_id);
        const totals = aggregateScores(allScores);
        const v = blocks.homeComplete(updatedGame, totals, names, allScores);
        viewBlocks = v.blocks;
      } else {
        const totals = aggregateScores(allScores);
        const v = blocks.homeReview(game, names, allScores, totals, userId, showOwnScore);
        viewBlocks = v.blocks;
      }
    } else {
      const round = findCurrentRound(allScores, userId, game);

      // Slow submitter nudge: if last_waiting_since is > 2 min old and exactly 1 player missing
      if (game.last_waiting_since && round.missingPlayerIds?.length === 1) {
        const waitingSince = new Date(game.last_waiting_since).getTime();
        const elapsed = Date.now() - waitingSince;
        if (elapsed > 2 * 60 * 1000) {
          const slowPlayerId = round.missingPlayerIds[0];
          try {
            await dmUser(slowPlayerId, {
              text: `Everyone's waiting on you for Hand ${round.hand}!`,
            });
          } catch (err) {
            console.warn("Failed to nudge slow player:", err.message);
          }
          // Clear the timestamp so we don't nudge again
          await db.updateGameAttr(game.game_id, { last_waiting_since: null });
        }
      }

      const completedScores = filterCompletedHands(allScores, game);
      const totals = aggregateScores(completedScores);
      // Resolve names of players who haven't submitted yet
      const missingNames = (round.missingPlayerIds || []).map((pid) => names.get(pid) || pid);
      const v = blocks.homeActive(game, names, round, totals, completedScores, userId, showOwnScore, missingNames);
      viewBlocks = v.blocks;
    }
  } else if (game.status === "COMPLETE") {
    // Show completed game for 30 minutes, then revert to no-game view
    const completedAt = game.completed_at ? new Date(game.completed_at).getTime() : 0;
    const elapsed = Date.now() - completedAt;
    if (completedAt && elapsed > 30 * 60 * 1000) {
      viewBlocks = blocks.homeNoGame().blocks;
    } else {
      const names = await resolveNames(game.players);
      const allScores = await db.getScoresForGame(game.game_id);
      const totals = aggregateScores(allScores);
      const v = blocks.homeComplete(game, totals, names, allScores);
      viewBlocks = v.blocks;
    }
  } else {
    viewBlocks = blocks.homeNoGame().blocks;
  }

  // Append joinable games at the bottom
  if (joinableGames.length > 0) {
    viewBlocks.push({ type: "divider" });
    for (const jg of joinableGames) {
      const jNames = await resolveNames(jg.players);
      const hostName = jNames.get(jg.host_slack_id) || jg.host_slack_id;
      const playerList = [...jNames.values()].join(", ");
      viewBlocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Game #${jg.game_number}* — ${jg.game_type} (${hostName})\nPlayers: ${playerList}`,
        },
        accessory: {
          type: "button",
          text: { type: "plain_text", text: "Join", emoji: true },
          action_id: "qbim_join_game",
          value: jg.game_id,
        },
      });
    }
  }

  // ── AutoQ section ──────────────────────────────────────
  try {
    const autoqBlocks = await renderAutoQSection(userId);
    if (autoqBlocks.length > 0) {
      viewBlocks.push(...autoqBlocks);
    }
  } catch (err) {
    console.warn("AutoQ render error:", err.message);
  }

  // Card of the Day fun stat
  try {
    const cotdBlocks = await renderCardOfTheDay();
    if (cotdBlocks.length > 0) viewBlocks.push(...cotdBlocks);
  } catch (err) {
    console.warn("Card of the Day error:", err.message);
  }

  // Always append the player's stats card
  const player = await db.getPlayer(userId);
  if (player && player.games_played) {
    // Compute personal bests per hand
    const allScores = await db.getAllScores();
    const pb = {};
    for (const s of allScores) {
      if (s.player_slack_id !== userId) continue;
      const raw = s.raw_score || 0;
      if (!pb[s.hand] || raw > pb[s.hand]) pb[s.hand] = raw;
    }
    viewBlocks.push(...blocks.playerCard(player, pb));
  }

  await slack().views.publish({
    user_id: userId,
    view: { type: "home", blocks: viewBlocks },
  });
}

/**
 * Render AutoQ game section if the user has an active AutoQ game.
 */
async function renderAutoQSection(userId) {
  let autoqDb, autoqBlocksMod;
  try {
    autoqDb = await import("./autoq-db.mjs");
    autoqBlocksMod = await import("./autoq-blocks.mjs");
  } catch {
    return []; // AutoQ not deployed yet
  }

  const tableName = process.env.AUTOQ_TABLE;
  if (!tableName) return [];

  // Query for recent games for this player via GSI (no Limit — FilterExpression
  // is applied after the scan, so Limit:1 could miss active games behind completed ones)
  const { DynamoDBClient } = await import("@aws-sdk/client-dynamodb");
  const { DynamoDBDocumentClient, QueryCommand } = await import("@aws-sdk/lib-dynamodb");
  const ddbClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

  const { Items } = await ddbClient.send(new QueryCommand({
    TableName: tableName,
    IndexName: "player-index",
    KeyConditionExpression: "player_id = :pid",
    ExpressionAttributeValues: { ":pid": userId },
    ScanIndexForward: false,
  }));

  if (!Items || Items.length === 0) return [];

  // Prefer ACTIVE game, then most recent COMPLETE (for post-game summary)
  const activeGame = Items.find((g) => g.status === "ACTIVE");
  const recentComplete = !activeGame ? Items.find((g) => g.status === "COMPLETE") : null;
  const game = activeGame || recentComplete;
  if (!game) return [];

  // Get completed hand results
  const handScores = await autoqDb.getAutoQHandScores(game.game_id);
  const handResults = handScores
    .sort((a, b) => a.hand - b.hand)
    .map((hs) => ({
      hand: hs.hand,
      words: hs.words,
      raw_score: hs.raw_score,
      stars: hs.stars || 0,
      is_personal_best: hs.is_personal_best || false,
      bot_scores: hs.bot_scores || [],
      star_summary: hs.star_summary || "",
    }));

  const personalBests = await autoqDb.getAllPersonalBests(userId);

  if (game.status === "COMPLETE") {
    // Build standings for the completed game view
    let playerTotal = 0, playerStars = 0;
    const botTotals = (game.bot_names || []).map(() => ({ raw: 0, stars: 0 }));
    for (const hs of handScores) {
      playerTotal += hs.raw_score || 0;
      playerStars += hs.stars || 0;
      for (let i = 0; i < (hs.bot_scores || []).length; i++) {
        botTotals[i].raw += hs.bot_scores[i].raw_score || 0;
        botTotals[i].stars += hs.bot_scores[i].stars || 0;
      }
    }
    const standings = [
      { name: "You", raw: playerTotal, stars: playerStars },
      ...(game.bot_names || []).map((name, i) => ({
        name,
        raw: botTotals[i].raw,
        stars: botTotals[i].stars,
      })),
    ].sort((a, b) => (b.raw + b.stars * 10) - (a.raw + a.stars * 10));

    // Only show completed game for 30 minutes
    const completedAt = game.completed_at ? new Date(game.completed_at).getTime() : 0;
    if (completedAt && Date.now() - completedAt > 30 * 60 * 1000) return [];

    return autoqBlocksMod.autoqGameComplete(game, standings, personalBests);
  }

  return autoqBlocksMod.autoqHomeActive(game, game.current_hand, handResults, personalBests);
}

// ── Admin Home Tab ──────────────────────────────────────

async function renderAdminHome(userId) {
  // Gather games from today and yesterday
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const todayGames = await db.getGamesByDate(today);
  const yesterdayGames = await db.getGamesByDate(yesterday);
  const recentGames = [...todayGames, ...yesterdayGames]
    .sort((a, b) => (b.game_number || 0) - (a.game_number || 0));

  // Determine selected game from admin preference
  const adminPlayer = await db.getPlayer(ADMIN_USER);
  const selectedGameId = adminPlayer?.preferences?.admin_selected_game;
  let game = null;
  if (selectedGameId) {
    game = recentGames.find((g) => g.game_id === selectedGameId) || null;
  }
  if (!game) {
    // Default: prefer ACTIVE/OPEN, then latest COMPLETE
    game = recentGames.find((g) => g.status === "ACTIVE" || g.status === "OPEN")
      || recentGames[0]
      || null;
  }

  const viewBlocks = [
    { type: "section", text: { type: "mrkdwn", text: "*Admin Panel*" } },
    { type: "divider" },
  ];

  // Game selector dropdown
  if (recentGames.length > 0) {
    const options = recentGames.map((g) => ({
      text: { type: "plain_text", text: `Game #${g.game_number} — ${g.game_date} — ${g.status}` },
      value: g.game_id,
    }));
    const initialOption = game
      ? options.find((o) => o.value === game.game_id) || options[0]
      : options[0];
    viewBlocks.push({
      type: "section",
      text: { type: "mrkdwn", text: "*Select Game*" },
      accessory: {
        type: "static_select",
        action_id: "qbim_admin_select_game",
        initial_option: initialOption,
        options,
      },
    });
  }

  if (!game) {
    viewBlocks.push({ type: "section", text: { type: "mrkdwn", text: "No recent games found." } });
  } else {
    // If admin is a player in this game, show player controls first
    if (game.players.includes(ADMIN_USER) && (game.status === "ACTIVE" || game.status === "OPEN")) {
      const allScoresForPlayer = await db.getScoresForGame(game.game_id);
      const round = findCurrentRound(allScoresForPlayer, ADMIN_USER, game);
      if (round && round.hand) {
        const adminNames = await resolveNames([ADMIN_USER]);
        const mulliganNote = round.mulligans > 0
          ? ` (${round.mulligans} mulligan${round.mulligans > 1 ? "s" : ""} — max ${round.maxCards} cards)`
          : "";
        if (round.canSubmit) {
          viewBlocks.push({
            type: "section",
            text: { type: "mrkdwn", text: `*Your Turn:* Enter score for *Hand ${round.hand}*${mulliganNote}` },
          });
          const elements = [
            {
              type: "button",
              text: { type: "plain_text", text: `Enter Hand ${round.hand} Score`, emoji: true },
              action_id: "qbim_open_hand_modal",
              value: `${game.game_id}|${round.hand}`,
            },
          ];
          // Hide Mulligan when a further mulligan would leave fewer than 2 cards
          // (you can't form a word with 1 card under the 2-card minimum rule).
          if ((round.maxCards || 0) > 2) {
            elements.push({
              type: "button",
              text: { type: "plain_text", text: "Mulligan", emoji: true },
              action_id: "qbim_mulligan",
              value: `${game.game_id}|${round.hand}`,
            });
          }
          viewBlocks.push({ type: "actions", elements });
        } else {
          const myLine = round.myWords
            ? `You submitted: *${round.myWords}* (${round.myScore} pts)${mulliganNote}`
            : `Waiting for others on *Hand ${round.hand}*...`;
          viewBlocks.push({
            type: "section",
            text: { type: "mrkdwn", text: myLine },
          });
        }
        viewBlocks.push({ type: "divider" });
      }
    }

    const allScores = await db.getScoresForGame(game.game_id);

    // Resolve names for all players who have scores (including dropped)
    const scorePlayerIds = [...new Set([
      ...game.players,
      ...allScores.map((s) => s.player_slack_id).filter(Boolean),
    ])];
    const allNames = await resolveNames(scorePlayerIds);

    // Game header
    viewBlocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Game #${game.game_number}* — ${game.game_type} — _${game.status}_\n${game.game_date}`,
      },
    });

    // Player totals summary
    const totals = aggregateScores(allScores);
    const standings = [...totals.entries()]
      .map(([id, t]) => ({
        name: allNames.get(id) || id,
        raw: t.raw,
        stars: t.stars,
        final: t.raw + t.stars * 10,
      }))
      .sort((a, b) => b.final - a.final);
    const totalLines = standings.map((s) =>
      `*${s.name}*: ${s.raw} raw + ${s.stars * 10} bonus = *${s.final}* (${s.stars}★)`
    );
    if (totalLines.length) {
      viewBlocks.push({
        type: "section",
        text: { type: "mrkdwn", text: totalLines.join("\n") },
      });
    }

    // Compact score table — one line per player, hand scores inline
    viewBlocks.push({ type: "divider" });
    const byPlayer = new Map();
    for (const s of allScores) {
      if (!byPlayer.has(s.player_slack_id)) byPlayer.set(s.player_slack_id, new Map());
      byPlayer.get(s.player_slack_id).set(s.hand, s);
    }
    const hands = [...new Set(allScores.map((s) => s.hand))].sort((a, b) => a - b);

    for (const [pid, handMap] of byPlayer) {
      const name = allNames.get(pid) || pid;
      const t = totals.get(pid) || { raw: 0, stars: 0 };
      const handParts = hands.map((h) => {
        const s = handMap.get(h);
        if (!s) return `H${h}: —`;
        const star = s.stars > 0 ? "★".repeat(s.stars) : "";
        return `H${h}: ${s.raw_score}${star}`;
      });
      viewBlocks.push({
        type: "section",
        text: { type: "mrkdwn", text: `*${name}* — *${t.raw + t.stars * 10}*\n${handParts.join("  |  ")}` },
      });
    }

    // ── Game Log ──────────────────────────────────────────
    viewBlocks.push({ type: "divider" });
    viewBlocks.push({ type: "section", text: { type: "mrkdwn", text: "*Game Log*" } });

    const logEvents = [];

    // Game created
    if (game.created_at) {
      logEvents.push({ time: game.created_at, text: `Game created` });
    }

    // Players joined (from player_start_hands)
    const startHands = game.player_start_hands || {};
    for (const [pid, startHand] of Object.entries(startHands)) {
      const name = allNames.get(pid) || pid;
      logEvents.push({
        time: game.created_at || "",
        text: `${name} joined at Hand ${startHand}`,
      });
    }

    // Dealers
    if (game.dealers && game.dealers.length) {
      const gameHands = getHandRange(game.game_type);
      for (let i = 0; i < game.dealers.length; i++) {
        const dealerName = allNames.get(game.dealers[i]) || game.dealers[i];
        const dealtHand = gameHands[i + 1]; // dealers[0] dealt hand 4, etc.
        logEvents.push({
          time: "",
          text: `${dealerName} dealt${dealtHand ? ` Hand ${dealtHand}` : ""}`,
        });
      }
    }

    // Mulligans
    if (game.mulligans) {
      for (const [key, count] of Object.entries(game.mulligans)) {
        if (count > 0) {
          const [pid, hand] = key.split("#");
          const name = allNames.get(pid) || pid;
          logEvents.push({ time: "", text: `${name} took ${count} mulligan${count > 1 ? "s" : ""} on Hand ${hand}` });
        }
      }
    }

    // Hand submissions (grouped by hand)
    for (const s of allScores) {
      const name = allNames.get(s.player_slack_id) || s.player_slack_id;
      const ts = s.submitted_at || "";
      logEvents.push({
        time: ts,
        text: `${name} submitted H${s.hand}: ${s.raw_score} pts`,
      });
    }

    // Game completed
    if (game.completed_at) {
      logEvents.push({ time: game.completed_at, text: `Game completed` });
    }

    // Sort by time, then render
    logEvents.sort((a, b) => (a.time || "").localeCompare(b.time || ""));

    // Chunk into context blocks (max 10 elements each)
    const logLines = logEvents.map((e) => {
      const ts = e.time ? new Date(e.time).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }) : "";
      return ts ? `${ts} — ${e.text}` : e.text;
    });
    for (let i = 0; i < logLines.length; i += 10) {
      const chunk = logLines.slice(i, i + 10);
      viewBlocks.push({
        type: "context",
        elements: chunk.map((line) => ({ type: "mrkdwn", text: line })),
      });
    }

    // ── Action buttons ───────────────────────────────────
    viewBlocks.push({ type: "divider" });

    const showCardPoints = adminPlayer?.preferences?.show_card_points ?? true;
    const toggleLabel = showCardPoints ? "Card Points: ON" : "Card Points: OFF";

    const actionBtns = [
      {
        type: "button",
        text: { type: "plain_text", text: "Edit Score", emoji: true },
        action_id: "qbim_admin_edit_picker",
        value: game.game_id,
      },
      {
        type: "button",
        text: { type: "plain_text", text: "Recalculate Stars", emoji: true },
        action_id: "qbim_admin_recalc_stars",
        value: game.game_id,
        style: "primary",
      },
    ];
    if (game.status === "COMPLETE") {
      actionBtns.push({
        type: "button",
        text: { type: "plain_text", text: "Republish Standings", emoji: true },
        action_id: "qbim_admin_republish",
        value: game.game_id,
      });
    }
    actionBtns.push({
      type: "button",
      text: { type: "plain_text", text: toggleLabel, emoji: true },
      action_id: "qbim_admin_toggle_points",
      value: showCardPoints ? "off" : "on",
    });

    // Force Finalize — show when ACTIVE or has review_started_at
    if (game.status === "ACTIVE" || game.review_started_at) {
      actionBtns.push({
        type: "button",
        text: { type: "plain_text", text: "Force Finalize", emoji: true },
        action_id: "qbim_admin_force_finalize",
        value: game.game_id,
        style: "primary",
      });
    }

    // Delete Game — always available
    actionBtns.push({
      type: "button",
      text: { type: "plain_text", text: "Delete Game", emoji: true },
      action_id: "qbim_admin_delete_game",
      value: game.game_id,
      style: "danger",
    });

    viewBlocks.push({ type: "actions", elements: actionBtns });

    // ── Second row: Nudge + Guest Join ────────────────────
    const secondRow = [];

    // Nudge — show when ACTIVE and there's an incomplete hand
    if (game.status === "ACTIVE" && !game.review_started_at) {
      const round = findCurrentRound(allScores, ADMIN_USER, game);
      if (round && round.hand && round.missingPlayerIds && round.missingPlayerIds.length > 0) {
        const missingNames = round.missingPlayerIds.map((pid) => allNames.get(pid) || pid);
        secondRow.push({
          type: "button",
          text: { type: "plain_text", text: `Nudge (${missingNames.join(", ")})`, emoji: true },
          action_id: "qbim_admin_nudge",
          value: game.game_id,
        });
      }
    }

    // Guest Join — show when game is OPEN or ACTIVE and admin is NOT already in the game
    if ((game.status === "OPEN" || game.status === "ACTIVE") && !game.players.includes(ADMIN_USER)) {
      secondRow.push({
        type: "button",
        text: { type: "plain_text", text: "Join as Guest", emoji: true },
        action_id: "qbim_admin_guest_join",
        value: game.game_id,
      });
    }

    if (secondRow.length > 0) {
      viewBlocks.push({ type: "actions", elements: secondRow });
    }
  }

  await slack().views.publish({
    user_id: userId,
    view: { type: "home", blocks: viewBlocks },
  });
}

// ── Helpers ────────────────────────────────────────────

export async function resolveNames(playerIds) {
  const names = new Map();
  for (const id of playerIds) {
    const player = await db.getPlayer(id);
    if (player && player.display_name) {
      names.set(id, player.display_name);
    } else {
      try {
        const info = await slack().users.info({ user: id });
        const name = info.user.profile.display_name || info.user.real_name || info.user.name;
        if (name) {
          names.set(id, name);
          await db.upsertPlayer(id, name);
        } else {
          names.set(id, `<@${id}>`);
        }
      } catch (err) {
        console.warn("Failed to resolve name for", id, err.message);
        names.set(id, `<@${id}>`);
      }
    }
  }
  return names;
}

/**
 * Find the current round and whether this user can submit.
 * Only counts players whose start hand <= the hand being checked.
 */
export function findCurrentRound(scores, userId, game) {
  const startHands = game.player_start_hands || {};
  const hands = getHandRange(game.game_type);
  for (const h of hands) {
    // Players eligible for this hand
    const eligible = game.players.filter((pid) => (startHands[pid] || 3) <= h);
    const handScores = scores.filter((s) => s.hand === h);
    if (handScores.length < eligible.length) {
      // Check if this user is eligible and hasn't submitted
      const userStart = startHands[userId] || 3;
      if (userStart > h) continue; // user joined later, skip this hand
      const myScore = handScores.find((s) => s.player_slack_id === userId);
      const mulligans = game.mulligans?.[`${userId}#${h}`] || 0;
      // Find players who haven't submitted yet
      const submittedIds = new Set(handScores.map((s) => s.player_slack_id));
      const missingPlayerIds = eligible.filter((pid) => !submittedIds.has(pid));
      return {
        hand: h,
        canSubmit: !myScore,
        myWords: myScore?.words || null,
        myScore: myScore?.raw_score || null,
        mulligans,
        maxCards: h - mulligans,
        missingPlayerIds,
        dealtCards: game.dealt_cards?.[`${userId}#${h}`] || null,
        deckType: game.deck_type || "Physical",
      };
    }
  }
  return { hand: null, canSubmit: false, myWords: null, myScore: null, dealtCards: null, deckType: game.deck_type || "Physical" };
}

/**
 * Filter scores to only include hands where all eligible players have submitted.
 */
export function filterCompletedHands(scores, game) {
  const startHands = game.player_start_hands || {};
  return scores.filter((s) => {
    const eligible = game.players.filter((pid) => (startHands[pid] || 3) <= s.hand);
    const handScores = scores.filter((hs) => hs.hand === s.hand);
    return handScores.length >= eligible.length;
  });
}

// ── Card of the Day ──────────────────────────────────

const ALL_CARDS = [
  "A","B","C","D","E","F","G","H","I","J","K","L","M",
  "N","O","P","Q","R","S","T","U","V","W","X","Y","Z",
  "QU","IN","ER","TH","CL",
];

const SUPERSCRIPT = { "0":"⁰","1":"¹","2":"²","3":"³","4":"⁴","5":"⁵","6":"⁶","7":"⁷","8":"⁸","9":"⁹" };
function toSuperscript(n) {
  return String(n).split("").map((d) => SUPERSCRIPT[d] || d).join("");
}

/**
 * Simple seeded pseudo-random number generator (mulberry32).
 * Returns a function that produces deterministic values 0–1 for a given seed.
 */
function seededRng(seed) {
  return function () {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

/**
 * Pick today's card using a seeded random, excluding the last 14 days' picks.
 */
function pickCardOfTheDay() {
  const eastern = new Date(Date.now() - 5 * 3600000);
  const todayNum = Math.floor(eastern.getTime() / 86400000); // days since epoch

  // Determine which cards were shown in the last 14 days
  const recent = new Set();
  for (let d = 1; d <= 14; d++) {
    const pastDay = todayNum - d;
    const rng = seededRng(pastDay);
    const available = ALL_CARDS.filter((c) => !recent.has(c));
    // If we've exhausted all cards in the window, allow repeats
    const pool = available.length > 0 ? available : ALL_CARDS;
    const idx = Math.floor(rng() * pool.length);
    recent.add(pool[idx]);
  }

  // Pick today's card from whatever's not in the last 14 days
  const rng = seededRng(todayNum);
  const available = ALL_CARDS.filter((c) => !recent.has(c));
  const pool = available.length > 0 ? available : ALL_CARDS;
  const idx = Math.floor(rng() * pool.length);
  return pool[idx];
}

/**
 * Render "Card of the Day" — random card each day (excluding last 14 days),
 * shows the most-played word that uses that card.
 */
async function renderCardOfTheDay() {
  const card = pickCardOfTheDay();
  const cardLabel = `${card.toLowerCase()}${toSuperscript(CARD_VALUES[card])}`;

  const allScores = await db.getAllScores();

  // Find all individual words that used this card (parse breakdowns)
  const wordCounts = new Map();
  for (const s of allScores) {
    if (!s.breakdown || !s.words) continue;
    // breakdown format: "QU-I-Z  F-O-X" (words separated by 2+ spaces)
    const wordBreakdowns = s.breakdown.split(/\s{2,}/);
    const wordTokens = s.words.replace(/[\s,+]+/g, " ").trim().split(" ").filter(Boolean);

    for (let i = 0; i < wordBreakdowns.length && i < wordTokens.length; i++) {
      const cards = wordBreakdowns[i].split("-").map((c) => c.toUpperCase());
      if (cards.includes(card)) {
        const word = wordTokens[i].toLowerCase().replace(/-/g, "");
        wordCounts.set(word, (wordCounts.get(word) || 0) + 1);
      }
    }
  }

  if (wordCounts.size === 0) {
    return [
      { type: "divider" },
      { type: "context", elements: [{ type: "mrkdwn", text: `🃏 *Card of the Day:*  ${cardLabel}  — no words played yet!` }] },
    ];
  }

  // Find the most-played word
  let topWord = "";
  let topCount = 0;
  for (const [word, count] of wordCounts) {
    if (count > topCount) { topWord = word; topCount = count; }
  }

  const formatted = formatWordsWithPoints(topWord);

  return [
    { type: "divider" },
    { type: "context", elements: [{ type: "mrkdwn", text: `🃏 *Card of the Day:*  ${cardLabel}  — most played word: *${formatted}* (${topCount}×)` }] },
  ];
}

export function aggregateScores(scores) {
  const totals = new Map();
  for (const s of scores) {
    if (!totals.has(s.player_slack_id)) {
      totals.set(s.player_slack_id, { raw: 0, stars: 0 });
    }
    const t = totals.get(s.player_slack_id);
    t.raw += s.raw_score || 0;
    t.stars += s.stars || 0;
  }
  return totals;
}
