/**
 * Shared home tab rendering and helper functions.
 * Used by both game-flow and score-entry handlers.
 */
import { slack } from "./slack.mjs";
import * as db from "./db.mjs";
import * as blocks from "./blocks.mjs";

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
      const completedScores = filterCompletedHands(allScores, game);
      const totals = aggregateScores(completedScores);
      const v = blocks.homeActive(game, names, round, totals, completedScores, userId, showOwnScore);
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

  // Always append the player's stats card
  const player = await db.getPlayer(userId);
  if (player && player.games_played) {
    viewBlocks.push(...blocks.playerCard(player));
  }

  await slack().views.publish({
    user_id: userId,
    view: { type: "home", blocks: viewBlocks },
  });
}

// ── Admin Home Tab ──────────────────────────────────────

async function renderAdminHome(userId) {
  // Find the most recent game (today or yesterday)
  const recentGames = await db.getRecentGames();
  const game = recentGames[recentGames.length - 1] || null;

  const viewBlocks = [
    { type: "section", text: { type: "mrkdwn", text: "*Admin Panel*" } },
    { type: "divider" },
  ];

  if (!game) {
    viewBlocks.push({ type: "section", text: { type: "mrkdwn", text: "No recent games found." } });
  } else {
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
    viewBlocks.push({
      type: "section",
      text: { type: "mrkdwn", text: totalLines.join("\n") },
    });

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

    // Action buttons
    viewBlocks.push({ type: "divider" });
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
    viewBlocks.push({ type: "actions", elements: actionBtns });
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
  for (let h = 3; h <= 10; h++) {
    // Players eligible for this hand
    const eligible = game.players.filter((pid) => (startHands[pid] || 3) <= h);
    const handScores = scores.filter((s) => s.hand === h);
    if (handScores.length < eligible.length) {
      // Check if this user is eligible and hasn't submitted
      const userStart = startHands[userId] || 3;
      if (userStart > h) continue; // user joined later, skip this hand
      const myScore = handScores.find((s) => s.player_slack_id === userId);
      const mulligans = game.mulligans?.[`${userId}#${h}`] || 0;
      return {
        hand: h,
        canSubmit: !myScore,
        myWords: myScore?.words || null,
        myScore: myScore?.raw_score || null,
        mulligans,
        maxCards: h - mulligans,
      };
    }
  }
  return { hand: null, canSubmit: false, myWords: null, myScore: null };
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
