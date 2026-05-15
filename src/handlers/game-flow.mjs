import crypto from "node:crypto";
import { verifySlackSignature, parseSlackBody } from "../lib/verify.mjs";
import { slack, CHANNEL, dmUser, dmAllPlayers } from "../lib/slack.mjs";
import * as db from "../lib/db.mjs";
import * as blocks from "../lib/blocks.mjs";
import { renderHome, resolveNames, aggregateScores } from "../lib/home.mjs";
import { deleteQuicklerTimer } from "../lib/quickler.mjs";
import { dealFromPool } from "../lib/autoq-deck.mjs";

export async function handler(event) {
  const { raw, parsed } = parseSlackBody(event.body, event.isBase64Encoded);

  // Slack URL verification challenge
  if (parsed.type === "url_verification") {
    return respond(200, { challenge: parsed.challenge });
  }

  // Verify signature
  if (!verifySlackSignature(process.env.SLACK_SIGNING_SECRET, event.headers, raw)) {
    return respond(401, { error: "Invalid signature" });
  }

  console.log("game-flow parsed.type:", parsed.type);

  try {
    // Events API (app_home_opened)
    if (parsed.type === "event_callback") {
      console.log("event_callback event.type:", parsed.event?.type);
      await handleEvent(parsed.event);
      return respond(200);
    }

    // Interactive payloads (button clicks, modal submissions)
    if (parsed.type === "block_actions") {
      await handleAction(parsed);
      return respond(200);
    }

    if (parsed.type === "view_submission") {
      return await handleViewSubmission(parsed);
    }

    return respond(200);
  } catch (err) {
    console.error("game-flow error:", JSON.stringify(err, Object.getOwnPropertyNames(err)));
    return respond(200); // always 200 to Slack
  }
}

// ── Events ─────────────────────────────────────────────

async function handleEvent(event) {
  if (event.type === "app_home_opened" && event.tab === "home") {
    await renderHome(event.user);
  }
}

// ── Actions ────────────────────────────────────────────

async function handleAction(payload) {
  const action = payload.actions[0];
  const userId = payload.user.id;

  switch (action.action_id) {
    case "qbim_start_game":
      await openStartGameModal(payload.trigger_id);
      break;

    case "qbim_join_game": {
      const gameToJoin = await db.getGame(action.value);
      if (!gameToJoin || (gameToJoin.status !== "OPEN" && gameToJoin.status !== "ACTIVE")) {
        // Game is complete — just refresh the home tab
        await renderHome(userId);
        break;
      }
      await joinGame(action.value, userId);
      await renderHome(userId);
      break;
    }

    case "qbim_end_game":
      await slack().views.open({
        trigger_id: payload.trigger_id,
        view: blocks.endGameModal(action.value),
      });
      break;

    case "qbim_toggle_score": {
      await db.initPreferences(userId);
      const player = await db.getPlayer(userId);
      const current = player?.preferences?.show_own_score || false;
      await db.setPlayerPreference(userId, "show_own_score", !current);
      await renderHome(userId);
      break;
    }

    case "qbim_mulligan": {
      const [gameId, handStr] = action.value.split("|");
      const hand = Number(handStr);
      const g = await db.getGame(gameId);
      // Digital pool check BEFORE recording the mulligan — if the deck is
      // too depleted to deal the new (smaller) hand, reject and don't count
      // the mulligan against the player.
      if (g.deck_type === "Digital") {
        const mPrior = await db.getMulliganCount(gameId, userId, hand);
        const target = hand - mPrior - 1; // size of the hand AFTER this mulligan
        const seen = g.hand_seen_cards?.[`${userId}#${hand}`] || [];
        const poolRemaining = 118 - seen.length;
        if (poolRemaining < target) {
          await renderHome(userId);
          break; // silent reject — UI re-renders with the button disabled
        }
      }
      // Atomic debounce + cap check. Ignores duplicate clicks (Slack retries,
      // impatient double-taps) within the debounce window.
      const ok = await db.tryAddMulligan(gameId, userId, hand);
      if (ok && g.deck_type === "Digital") {
        const m = await db.getMulliganCount(gameId, userId, hand);
        const refreshed = await db.getGame(gameId);
        const seen = refreshed.hand_seen_cards?.[`${userId}#${hand}`] || [];
        const { cards } = dealFromPool(seen, hand - m);
        await db.recordDeal(gameId, userId, hand, cards);
      }
      await renderHome(userId);
      break;
    }
  }
}

// ── View Submissions ───────────────────────────────────

async function handleViewSubmission(payload) {
  if (payload.view.callback_id === "qbim_start_game_submit") {
    const userId = payload.user.id;
    const gameType =
      payload.view.state.values.game_type_block.game_type.selected_option.value;

    // AutoQ: open the opponent-count modal instead of creating a regular game
    if (gameType === "AutoQ") {
      const { autoqStartModal } = await import("../lib/autoq-blocks.mjs");
      return respond(200, {
        response_action: "update",
        view: autoqStartModal(),
      });
    }

    // Reject if the user already has an OPEN or ACTIVE game
    const existing = await findActiveGameForUser(userId);
    if (existing) {
      return respond(200, {
        response_action: "errors",
        errors: {
          game_type_block: `You already have an active game (#${existing.game_number}). Finish or end it first.`,
        },
      });
    }

    const game = await createNewGame(userId, gameType);
    await postLobbyMessage(game);

    // Notify regular players (>5 games) about the new game
    await notifyRegulars(game);

    // Refresh home tab after modal closes
    await renderHome(userId);

    return respond(200, { response_action: "clear" });
  }

  if (payload.view.callback_id === "qbim_end_game_confirm") {
    const userId = payload.user.id;
    let game_id;
    try { ({ game_id } = JSON.parse(payload.view.private_metadata)); } catch { return respond(200); }
    const choice = payload.view.state.values.end_game_choice_block.end_game_choice.selected_option.value;

    if (choice === "stay") {
      // Do nothing, just close the modal
    } else if (choice === "drop") {
      // Clean up Quickler timer if the dropping player triggers it
      const gameBeforeDrop = await db.getGame(game_id);
      if (gameBeforeDrop.quickler_timer_schedule_name) {
        // Check if dropping makes the hand complete (handled below) — clean up timer
        const dropScores = await db.getScoresForGameHand(game_id, gameBeforeDrop.quickler_timer_hand);
        const dropStartHands = gameBeforeDrop.player_start_hands || {};
        const dropEligible = gameBeforeDrop.players.filter((pid) => pid !== userId && (dropStartHands[pid] || 3) <= gameBeforeDrop.quickler_timer_hand);
        const dropSubmitted = dropScores.filter((s) => s.player_slack_id !== userId);
        if (dropSubmitted.length >= dropEligible.length) {
          try { await deleteQuicklerTimer(gameBeforeDrop.quickler_timer_schedule_name); } catch (err) { console.warn("Timer cleanup:", err.message); }
          await db.updateGameAttr(game_id, { quickler_timer_started_at: null, quickler_timer_hand: null, quickler_timer_schedule_name: null });
        }
      }
      await db.removePlayerFromGame(game_id, userId);
      const game = await db.getGame(game_id);
      // If no players left, finish the game
      if (!game.players || game.players.length === 0) {
        if (game.quickler_timer_schedule_name) {
          try { await deleteQuicklerTimer(game.quickler_timer_schedule_name); } catch (err) { console.warn("Timer cleanup:", err.message); }
        }
        await db.updateGameStatus(game_id, "COMPLETE", { completed_at: new Date().toISOString() });
      } else {
        // Check if any hand is now complete with fewer players
        const scores = await db.getScoresForGame(game_id);
        const startHands = game.player_start_hands || {};
        for (let h = 3; h <= 10; h++) {
          const eligible = game.players.filter((pid) => (startHands[pid] || 3) <= h);
          const handScores = scores.filter((s) => s.hand === h);
          const allZeroStars = handScores.every((s) => (s.stars || 0) === 0);
          if (handScores.length >= eligible.length && handScores.length > 0 && allZeroStars) {
            // Dynamic import to avoid circular dependency
            const { autoAwardStars } = await import("./score-entry.mjs");
            await autoAwardStars(game, h, handScores, true);
          }
        }
      }
    } else if (choice === "finish") {
      // Clean up any pending Quickler timer
      const gameBeforeEnd = await db.getGame(game_id);
      if (gameBeforeEnd.quickler_timer_schedule_name) {
        try { await deleteQuicklerTimer(gameBeforeEnd.quickler_timer_schedule_name); } catch (err) { console.warn("Timer cleanup:", err.message); }
      }
      await db.updateGameStatus(game_id, "COMPLETE", { completed_at: new Date().toISOString() });
      const game = await db.getGame(game_id);
      const scores = await db.getScoresForGame(game_id);
      if (scores.length) {
        await postFinalStandings(game, scores);
      }
      await dmAllPlayers(game.players, { text: "Game ended early." });
    }

    await renderHome(userId);
    return respond(200, { response_action: "clear" });
  }

  return respond(200);
}

// ── Core Logic ─────────────────────────────────────────

export async function findActiveGameForUser(userId) {
  const today = todayStr();
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const todayGames = await db.getGamesByDate(today);
  const yesterdayGames = await db.getGamesByDate(yesterday);
  const allGames = [...todayGames, ...yesterdayGames];
  return allGames.find(
    (g) => (g.status === "OPEN" || g.status === "ACTIVE") && g.players.includes(userId)
  ) || null;
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

export async function createNewGame(hostSlackId, gameType, deckType = "Physical") {
  const today = todayStr();
  const maxGameNumber = await db.getMaxGameNumber();
  const gameNumber = maxGameNumber + 1;

  const initialDeal = deckType === "Digital" ? dealFromPool([], 3).cards : null;
  const game = {
    game_id: crypto.randomUUID(),
    game_date: today,
    status: "OPEN",
    game_type: gameType,
    deck_type: deckType,
    game_number: gameNumber,
    host_slack_id: hostSlackId,
    players: [hostSlackId],
    player_start_hands: { [hostSlackId]: 3 },
    mulligans: {},
    dealers: [],
    dealt_cards: initialDeal ? { [`${hostSlackId}#3`]: initialDeal } : {},
    hand_seen_cards: initialDeal ? { [`${hostSlackId}#3`]: initialDeal } : {},
    created_at: new Date().toISOString(),
  };

  await db.createGame(game);

  // Upsert host in Players table — Slack info call is best-effort (a host who
  // started the game from /play may not have a Slack profile lookup available
  // through this code path's bot token, but their record is already populated
  // via the OAuth callback).
  try {
    const info = await slack().users.info({ user: hostSlackId });
    await db.upsertPlayer(hostSlackId, info.user.profile.display_name || info.user.real_name);
  } catch (err) {
    console.warn("upsertPlayer from createNewGame skipped:", err.message);
  }

  return game;
}

async function joinGame(gameId, slackId) {
  const game = await db.getGame(gameId);

  // Determine what hand this player starts at
  let startHand = 3;
  if (game.status === "ACTIVE") {
    const scores = await db.getScoresForGame(gameId);
    // Find the current round (lowest incomplete hand among existing players)
    for (let h = 3; h <= 10; h++) {
      const eligibleCount = game.players.filter(
        (pid) => (game.player_start_hands?.[pid] || 3) <= h
      ).length;
      const handScores = scores.filter((s) => s.hand === h);
      if (handScores.length < eligibleCount) {
        startHand = h;
        break;
      }
      startHand = h + 1;
    }
    // If all hands are complete, reject the late join
    if (startHand > 10) return;
  }

  await db.addPlayerToGame(gameId, slackId);
  await db.setPlayerStartHand(gameId, slackId, startHand);

  // Digital deck: deal the joiner cards for whichever hand they're starting
  // at (fresh deck — per-hand seen set, so no prior history applies).
  if (game.deck_type === "Digital") {
    const { cards } = dealFromPool([], startHand);
    await db.recordDeal(gameId, slackId, startHand, cards);
  }

  const info = await slack().users.info({ user: slackId });
  await db.upsertPlayer(slackId, info.user.profile.display_name || info.user.real_name);
}

async function openStartGameModal(triggerId) {
  await slack().views.open({
    trigger_id: triggerId,
    view: blocks.startGameModal(),
  });
}

export async function notifyRegulars(game) {
  try {
    const regulars = await db.getRegularPlayers(5);
    const names = await resolveNames(game.players);
    const hostName = names.get(game.host_slack_id) || game.host_slack_id;
    for (const player of regulars) {
      // Skip the host — they already got a DM from postLobbyMessage
      if (player.slack_id === game.host_slack_id) continue;
      await dmUser(player.slack_id, {
        text: `${hostName} started a QBIM game! Open QBot to join.`,
      });
    }
  } catch (err) {
    console.warn("Failed to notify regulars:", err.message);
  }
}

export async function postLobbyMessage(game) {
  const names = await resolveNames(game.players);
  const hostName = [...names.values()][0];
  const text = `${hostName} started a ${game.game_type} game! Open the QBot Home tab to join.`;
  // DM the host
  await dmUser(game.host_slack_id, {
    text,
    blocks: blocks.lobbyMessage(game, [...names.values()]),
  });
}

async function postFinalStandings(game, scores) {
  const allPlayerIds = [...new Set(scores.map((s) => s.player_slack_id).filter(Boolean))];
  const names = await resolveNames(allPlayerIds);
  const totals = aggregateScores(scores);
  const standings = [...totals.entries()]
    .map(([id, t]) => ({
      name: names.get(id) || id,
      raw: t.raw,
      stars: t.stars,
      final: t.raw + t.stars * 10,
    }))
    .sort((a, b) => b.final - a.final);

  const medals = [":first_place_medal:", ":second_place_medal:", ":third_place_medal:"];
  const lines = standings.map((s, i) => {
    const prefix = i < 3 ? `${medals[i]} ` : `${i + 1}. `;
    return `${prefix}*${s.name}* — Raw: ${s.raw} | Stars: ${"★".repeat(s.stars)} (${s.stars}) | Bonus: +${s.stars * 10} | *Final: ${s.final}*`;
  });

  const msgBlocks = [
    { type: "section", text: { type: "mrkdwn", text: `*Game #${game.game_number} — Final Standings*\n\n${lines.join("\n")}` } },
  ];
  await dmAllPlayers(allPlayerIds, { text: "Game ended — Final standings:", blocks: msgBlocks });
}

function respond(statusCode, body = {}) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}
