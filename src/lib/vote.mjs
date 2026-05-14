/**
 * Vote system — handles word challenges when dictionary rejects a submission.
 *
 * Flow:
 *   1. Player submits words → dictionary rejects one or more → modal updates with Vote button
 *   2. Player taps Vote → vote record created, other players DM'd with Yes/No poll, 2-min timer starts
 *   3. Voters tap Yes/No → tally checked for early resolution
 *   4. Timer fires (or early resolution) → resolveVote tallies, approves/rejects, saves score or DMs retry
 *
 * Approval rule: >2/3 of votes cast (strict super-majority).
 */
import { SchedulerClient, CreateScheduleCommand, DeleteScheduleCommand } from "@aws-sdk/client-scheduler";
import * as db from "./db.mjs";
import { slack, dmUser } from "./slack.mjs";
import { getScoreOptions } from "./cards.mjs";

const scheduler = new SchedulerClient({});

// ── Start a vote — shared by Slack handleVoteWord and web POST /votes/start ─

/**
 * Create a vote record, schedule the 2-minute timer, and DM all other players
 * the Yes/No poll. Returns the persisted vote (with poll_messages populated).
 * Throws on invalid inputs / no voters.
 */
export async function startWordVote({ userId, game_id, hand, words, invalid_words, chosen, button_pressed_at }) {
  if (!Array.isArray(invalid_words) || invalid_words.length === 0) {
    throw new Error("No rejected words to vote on");
  }
  const game = await db.getGame(game_id);
  if (!game) throw new Error("Game not found");
  const voters = game.players.filter((pid) => pid !== userId);
  if (voters.length === 0) throw new Error("No other players to vote");

  const voteId = `vote-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const scheduleName = `qbim-vote-${voteId}`.replace(/[^a-zA-Z0-9_-]/g, "-");

  let resolvedChosen = chosen;
  if (!resolvedChosen) {
    resolvedChosen = computeChosen(words, hand, await db.getMulliganCount(game_id, userId, hand));
  }

  const vote = {
    vote_id: voteId, game_id, hand,
    submitter: userId, words, invalid_words,
    chosen: resolvedChosen,
    button_pressed_at,
    voters, votes: {}, poll_messages: {},
    status: "open",
    created_at: new Date().toISOString(),
    schedule_name: scheduleName,
  };
  await db.putVote(vote);
  await createVoteTimer(scheduleName, voteId);

  const bad = invalid_words.map((w) => `*${w}*`).join(", ");
  for (const voterId of voters) {
    try {
      const result = await dmUser(voterId, {
        text: `Word vote: ${invalid_words.join(", ")}`,
        blocks: [
          { type: "section", text: { type: "mrkdwn", text: `🗳️ <@${userId}> played ${bad} — is it a real word?\n\nYou have 2 minutes to vote.` } },
          {
            type: "actions",
            elements: [
              { type: "button", action_id: "qbim_vote_yes", text: { type: "plain_text", text: "✅ Yes", emoji: true }, value: voteId, style: "primary" },
              { type: "button", action_id: "qbim_vote_no",  text: { type: "plain_text", text: "❌ No",  emoji: true }, value: voteId, style: "danger"  },
            ],
          },
        ],
      });
      vote.poll_messages[voterId] = { channel: result.channel, ts: result.ts };
    } catch (err) {
      console.warn("Failed to DM voter:", voterId, err.message);
    }
  }
  await db.putVote(vote);
  return vote;
}

// ── EventBridge Scheduler helpers ─────────────────────

export async function createVoteTimer(scheduleName, voteId) {
  const fireAt = new Date(Date.now() + 120_000); // 2 minutes
  const scheduleExpression = `at(${fireAt.toISOString().replace(/\.\d{3}Z$/, "")})`;

  await scheduler.send(new CreateScheduleCommand({
    Name: scheduleName,
    ScheduleExpression: scheduleExpression,
    ScheduleExpressionTimezone: "UTC",
    FlexibleTimeWindow: { Mode: "OFF" },
    Target: {
      Arn: process.env.VOTE_TIMER_FUNCTION_ARN,
      RoleArn: process.env.VOTE_TIMER_ROLE_ARN,
      Input: JSON.stringify({ vote_id: voteId }),
    },
    ActionAfterCompletion: "DELETE",
  }));
}

export async function deleteVoteTimer(scheduleName) {
  try {
    await scheduler.send(new DeleteScheduleCommand({ Name: scheduleName }));
  } catch (err) {
    if (err.name !== "ResourceNotFoundException") throw err;
  }
}

// ── Score worker invocation ───────────────────────────

async function invokeScoreWorker(payload) {
  const functionName = process.env.SCORE_WORKER_FUNCTION_NAME;
  if (!functionName) {
    console.warn("SCORE_WORKER_FUNCTION_NAME not set; cannot invoke worker from vote resolve");
    return;
  }
  const { LambdaClient, InvokeCommand } = await import("@aws-sdk/client-lambda");
  const client = new LambdaClient({});
  await client.send(new InvokeCommand({
    FunctionName: functionName,
    InvocationType: "Event",
    Payload: Buffer.from(JSON.stringify(payload)),
  }));
}

// ── Resolve a completed vote ──────────────────────────

export async function resolveVote(vote, approved) {
  if (vote.status !== "open") return;

  vote.status = approved ? "approved" : "rejected";
  await db.updateVoteStatus(vote.vote_id, vote.status);

  // Clean up timer (may have already fired / auto-deleted)
  if (vote.schedule_name) {
    deleteVoteTimer(vote.schedule_name).catch(() => {});
  }

  const bad = vote.invalid_words.map((w) => `*${w}*`).join(", ");
  const yesCount = Object.values(vote.votes).filter((v) => v === "yes").length;
  const noCount = Object.values(vote.votes).filter((v) => v === "no").length;
  const tally = `(${yesCount} yes, ${noCount} no)`;

  if (approved) {
    // Add words to custom dictionary
    const now = new Date().toISOString();
    for (const word of vote.invalid_words) {
      await db.putDictionaryWord({
        word: word.toLowerCase(),
        valid: true,
        definition: null,
        url: null,
        source: "vote",
        cached_at: now,
      });
    }

    // Check if the player already submitted a score while the vote was pending
    const existing = await db.getScoresForGameHand(vote.game_id, vote.hand);
    const alreadySubmitted = existing.some((s) => s.player_slack_id === vote.submitter);

    if (!alreadySubmitted && vote.chosen) {
      await invokeScoreWorker({
        userId: vote.submitter,
        game_id: vote.game_id,
        hand: vote.hand,
        wordsInput: vote.words,
        chosen: vote.chosen,
        buttonPressedAt: vote.button_pressed_at,
        validated: true,
      });
      await dmUser(vote.submitter, {
        text: `✅ Vote approved! ${bad} accepted ${tally}. Your score has been submitted.`,
      });
    } else if (alreadySubmitted) {
      await dmUser(vote.submitter, {
        text: `✅ Vote approved! ${bad} accepted ${tally}. (You already submitted a score for this hand.)`,
      });
    } else {
      // No chosen — DM with retry
      await dmUser(vote.submitter, {
        text: `✅ Vote approved! ${bad} accepted ${tally}.`,
        blocks: [
          {
            type: "section",
            text: { type: "mrkdwn", text: `✅ ${bad} approved ${tally}! Tap below to submit your score.` },
          },
          {
            type: "actions",
            elements: [{
              type: "button",
              action_id: "qbim_retry_hand",
              text: { type: "plain_text", text: `Submit Hand ${vote.hand}`, emoji: true },
              style: "primary",
              value: JSON.stringify({ game_id: vote.game_id, hand: vote.hand, words: vote.words }),
            }],
          },
        ],
      });
    }
  } else {
    // Rejected — DM submitter with retry button
    await dmUser(vote.submitter, {
      text: `Vote rejected: ${vote.invalid_words.join(", ")}`,
      blocks: [
        {
          type: "section",
          text: { type: "mrkdwn", text: `❌ ${bad} was not approved ${tally}. Try different words.` },
        },
        {
          type: "actions",
          elements: [{
            type: "button",
            action_id: "qbim_retry_hand",
            text: { type: "plain_text", text: `Edit Hand ${vote.hand}`, emoji: true },
            style: "primary",
            value: JSON.stringify({ game_id: vote.game_id, hand: vote.hand, words: vote.words }),
          }],
        },
      ],
    });
  }

  // Update all poll messages with final result
  for (const [voterId, msg] of Object.entries(vote.poll_messages || {})) {
    try {
      const choice = vote.votes[voterId];
      const choiceText = choice === "yes" ? "✅ Yes" : choice === "no" ? "❌ No" : "⏰ No vote";
      await slack().chat.update({
        channel: msg.channel,
        ts: msg.ts,
        text: `Vote ${approved ? "approved" : "rejected"}: ${vote.invalid_words.join(", ")}`,
        blocks: [{
          type: "section",
          text: { type: "mrkdwn", text: `🗳️ ${approved ? "✅ Approved" : "❌ Rejected"}: ${bad} ${tally}\nYour vote: ${choiceText}` },
        }],
      });
    } catch (err) {
      console.warn("Failed to update poll message:", voterId, err.message);
    }
  }
}

// ── Compute chosen score option for vote record ───────

export function computeChosen(wordsInput, hand, mulligans) {
  const maxCards = hand - mulligans;
  const { options } = getScoreOptions(wordsInput, maxCards);
  if (options.length === 0) return null;
  return options.sort((a, b) => b.score - a.score)[0];
}
