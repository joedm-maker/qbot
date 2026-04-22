/**
 * Single entry point for all Slack payloads.
 *
 * API Gateway sends everything here. The router parses the payload,
 * verifies the signature, and dispatches to the correct handler module
 * based on action_id or callback_id.
 */
import { verifySlackSignature, parseSlackBody } from "../lib/verify.mjs";
import { handler as gameFlowHandler } from "./game-flow.mjs";
import { handler as scoreEntryHandler } from "./score-entry.mjs";
import { handler as leaderboardHandler } from "./leaderboard.mjs";
import { handleStatsRequest } from "./stats-api.mjs";
import { handler as autoqHandler } from "./autoq.mjs";

// Action IDs handled by each module
const GAME_FLOW_ACTIONS = new Set([
  "qbim_start_game",
  "qbim_join_game",
  "qbim_end_game",
  "qbim_mulligan",
  "qbim_toggle_score",
]);
const GAME_FLOW_CALLBACKS = new Set([
  "qbim_start_game_submit",
  "qbim_end_game_confirm",
]);

const SCORE_ACTIONS = new Set([
  "qbim_open_hand_modal",
  "qbim_retry_hand",
  "qbim_finalize_game",
  "qbim_admin_edit_picker",
]);
const SCORE_CALLBACKS = new Set([
  "qbim_submit_score",
  "qbim_confirm_score",
]);

const AUTOQ_ACTIONS = new Set([
  "autoq_start",
  "autoq_open_hand_modal",
  "autoq_retry_hand",
  "autoq_mulligan",
  "autoq_quit",
]);
const AUTOQ_CALLBACKS = new Set([
  "autoq_start_submit",
  "autoq_submit_score",
  "autoq_confirm_score",
]);

const LEADERBOARD_ACTIONS = new Set([
  "qbim_view_scores",
  "qbim_history",
]);

export async function handler(event) {
  // Lambda warmer — scheduled ping to prevent cold starts
  if (event.source === "aws.events" || event.detail?.warmup) {
    console.log("Warmer ping — staying hot");
    return { statusCode: 200, body: "warm" };
  }

  // Stats API — GET requests, no Slack signature needed
  if (event.httpMethod === "GET" && event.resource?.startsWith("/stats/")) {
    // Normalize path to strip stage prefix
    event.path = event.resource;
    return handleStatsRequest(event);
  }

  const { raw, parsed } = parseSlackBody(event.body, event.isBase64Encoded);

  console.log("router parsed.type:", parsed.type, "headers:", JSON.stringify(Object.keys(event.headers || {})));

  // URL verification (no signature check needed)
  if (parsed.type === "url_verification") {
    return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ challenge: parsed.challenge }) };
  }

  // Verify signature
  if (!verifySlackSignature(process.env.SLACK_SIGNING_SECRET, event.headers, raw)) {
    console.warn("Signature verification FAILED");
    return { statusCode: 401, body: '{"error":"Invalid signature"}' };
  }
  console.log("Signature verified OK");

  // Events API — always game-flow
  if (parsed.type === "event_callback") {
    return gameFlowHandler(event);
  }

  // Block actions — route by action_id
  if (parsed.type === "block_actions" && parsed.actions?.length) {
    const actionId = parsed.actions[0].action_id;
    if (GAME_FLOW_ACTIONS.has(actionId)) return gameFlowHandler(event);
    if (SCORE_ACTIONS.has(actionId)) return scoreEntryHandler(event);
    if (AUTOQ_ACTIONS.has(actionId)) return autoqHandler(event);
    if (LEADERBOARD_ACTIONS.has(actionId)) return leaderboardHandler(event);
    // Vote actions (qbim_vote_word, qbim_vote_yes, qbim_vote_no)
    if (actionId.startsWith("qbim_vote_")) return scoreEntryHandler(event);
    // Admin actions (dynamic IDs)
    if (actionId.startsWith("qbim_admin_")) return scoreEntryHandler(event);
  }

  // View submissions — route by callback_id
  if (parsed.type === "view_submission") {
    const callbackId = parsed.view?.callback_id;
    if (GAME_FLOW_CALLBACKS.has(callbackId)) return gameFlowHandler(event);
    if (AUTOQ_CALLBACKS.has(callbackId)) return autoqHandler(event);
    if (SCORE_CALLBACKS.has(callbackId)) return scoreEntryHandler(event);
    if (callbackId === "qbim_admin_pick_edit") return scoreEntryHandler(event);
    if (callbackId === "qbim_admin_save_edit") return scoreEntryHandler(event);
    if (callbackId === "qbim_admin_guest_join_submit") return scoreEntryHandler(event);
  }

  console.warn("Unrouted payload type:", parsed.type);
  return { statusCode: 200, body: "" };
}
