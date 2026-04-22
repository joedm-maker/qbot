/**
 * Vote Timer Lambda — invoked by EventBridge Scheduler when a word vote hits its 2-minute timeout.
 * Tallies votes and resolves the vote (approve or reject).
 */
import * as db from "../lib/db.mjs";
import { resolveVote } from "../lib/vote.mjs";

export async function handler(event) {
  const { vote_id } = event;
  if (!vote_id) {
    console.warn("vote-timer: no vote_id in event");
    return { statusCode: 200 };
  }

  const vote = await db.getVote(vote_id);
  if (!vote) {
    console.warn("vote-timer: vote not found:", vote_id);
    return { statusCode: 200 };
  }
  if (vote.status !== "open") {
    console.log("vote-timer: vote already resolved:", vote_id, vote.status);
    return { statusCode: 200 };
  }

  const yesCount = Object.values(vote.votes).filter((v) => v === "yes").length;
  const noCount = Object.values(vote.votes).filter((v) => v === "no").length;
  const totalCast = yesCount + noCount;
  const approved = totalCast > 0 && yesCount * 3 > totalCast * 2;

  console.log(`vote-timer: resolving ${vote_id} — ${yesCount} yes, ${noCount} no → ${approved ? "approved" : "rejected"}`);
  await resolveVote(vote, approved);
  return { statusCode: 200 };
}
