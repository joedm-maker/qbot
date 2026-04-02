import { verifySlackSignature, parseSlackBody } from "../lib/verify.mjs";
import { slack, CHANNEL } from "../lib/slack.mjs";
import * as db from "../lib/db.mjs";
import { resolveNames, aggregateScores } from "../lib/home.mjs";

export async function handler(event) {
  const { raw, parsed } = parseSlackBody(event.body, event.isBase64Encoded);

  if (!verifySlackSignature(process.env.SLACK_SIGNING_SECRET, event.headers, raw)) {
    return respond(401, { error: "Invalid signature" });
  }

  try {
    if (parsed.type === "block_actions") {
      const action = parsed.actions[0];

      if (action.action_id === "qbim_view_scores") {
        await viewScores(action.value, parsed.user.id);
      }

      if (action.action_id === "qbim_history") {
        await viewHistory(parsed.user.id);
      }
    }

    return respond(200);
  } catch (err) {
    console.error("leaderboard error:", err);
    return respond(200);
  }
}

// ── View Scores ────────────────────────────────────────

async function viewScores(gameId, userId) {
  const game = await db.getGame(gameId);
  if (!game) return;

  const scores = await db.getScoresForGame(gameId);
  const names = await resolveNames(game.players);
  const totals = aggregateScores(scores);
  const isComplete = game.status === "COMPLETE";

  const standings = [...totals.entries()]
    .map(([id, t]) => ({
      name: names.get(id) || id,
      raw: t.raw,
      stars: t.stars,
      final: t.raw + t.stars * 10,
    }))
    .sort((a, b) => (isComplete ? b.final - a.final : b.raw - a.raw));

  const medals = [":first_place_medal:", ":second_place_medal:", ":third_place_medal:"];
  const lines = standings.map((s, i) => {
    const prefix = isComplete && i < 3 ? `${medals[i]} ` : `${i + 1}. `;
    if (isComplete) {
      return `${prefix}*${s.name}* — Raw: ${s.raw} | Stars: ${"★".repeat(s.stars)} (${s.stars}) | Bonus: +${s.stars * 10} | *Final: ${s.final}*`;
    }
    return `${prefix}*${s.name}* — Raw: ${s.raw} | Stars: ${"★".repeat(s.stars)} (${s.stars})`;
  });

  await slack().chat.postEphemeral({
    channel: CHANNEL(),
    user: userId,
    text: lines.join("\n"),
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Game #${game.game_number} — ${game.game_type}*\n${isComplete ? "_Final Standings_" : "_In Progress_"}\n\n${lines.join("\n")}`,
        },
      },
    ],
  });
}

// ── Game History ───────────────────────────────────────

async function viewHistory(userId) {
  // Get games from the last 7 days (max 10 games)
  const games = [];
  const today = new Date();

  for (let i = 0; i < 7 && games.length < 10; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    const dayGames = await db.getGamesByDate(dateStr);
    games.push(...dayGames.filter((g) => g.status === "COMPLETE"));
  }
  games.splice(10); // cap at 10

  if (!games.length) {
    await slack().chat.postEphemeral({
      channel: CHANNEL(),
      user: userId,
      text: "No completed games in the last 7 days.",
    });
    return;
  }

  // Collect all player IDs across games and resolve names once
  const allPlayerIds = [...new Set(games.flatMap((g) => g.players))];
  const namesCache = await resolveNames(allPlayerIds);

  const lines = [];
  for (const game of games) {
    const scores = await db.getScoresForGame(game.game_id);
    const names = namesCache;
    const totals = aggregateScores(scores);

    let maxFinal = -Infinity;
    let winnerName = "—";
    for (const [id, t] of totals) {
      const final = t.raw + t.stars * 10;
      if (final > maxFinal) {
        maxFinal = final;
        winnerName = names.get(id) || id;
      }
    }

    lines.push(`• *${game.game_date}* Game #${game.game_number} (${game.game_type}) — Winner: *${winnerName}* (${maxFinal})`);
  }

  await slack().chat.postEphemeral({
    channel: CHANNEL(),
    user: userId,
    text: "Recent games",
    blocks: [
      {
        type: "section",
        text: { type: "mrkdwn", text: `*Recent Games*\n\n${lines.join("\n")}` },
      },
    ],
  });
}

// ── Helpers ────────────────────────────────────────────

function respond(statusCode, body = {}) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}
