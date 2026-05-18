/**
 * Slack OAuth (OpenID Connect) handler for web-app sign-in.
 *
 * Endpoints (no Slack signature — these are browser-driven):
 *   GET /auth/slack/login     → 302 to Slack authorize URL
 *   GET /auth/slack/callback  → exchanges code, signs JWT, 302 to dashboard
 *   GET /auth/me              → returns { player_id, name, email, avatar } from Bearer JWT
 */
import { randomBytes } from "node:crypto";
import * as db from "../lib/db.mjs";
import { signJwt, verifyJwt, decodeJwtUnverified } from "../lib/jwt.mjs";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

export async function handleAuthRequest(event) {
  const path = event.path;
  try {
    if (path === "/auth/slack/login") return await slackLogin(event);
    if (path === "/auth/slack/callback") return await slackCallback(event);
    if (path === "/auth/me") return await me(event);
    return jsonResp(404, { error: "Not found" });
  } catch (err) {
    console.error("auth error:", err);
    return jsonResp(500, { error: err.message });
  }
}

function redirectUri(event) {
  const ctx = event.requestContext || {};
  return `https://${ctx.domainName}/${ctx.stage}/auth/slack/callback`;
}

// Allowed origins for the post-OAuth redirect. Prod dashboard + any localhost
// port for dev. Anything else falls back to DASHBOARD_URL.
function isAllowedReturnOrigin(url) {
  try {
    const u = new URL(url);
    if (u.origin === process.env.DASHBOARD_URL) return true;
    if (u.hostname === "localhost" || u.hostname === "127.0.0.1") return true;
  } catch { /* not a URL */ }
  return false;
}

async function slackLogin(event) {
  // Caller may request a specific return origin (e.g. http://localhost:3000)
  // for dev testing. We JWT-sign it into the OAuth `state` so the callback
  // can trust it. Falls back to the production dashboard URL.
  const requestedReturn = event.queryStringParameters?.return_to;
  const returnTo = (requestedReturn && isAllowedReturnOrigin(requestedReturn))
    ? requestedReturn
    : process.env.DASHBOARD_URL;
  const state = signJwt({ rt: returnTo, nonce: randomBytes(8).toString("hex") }, process.env.SESSION_SECRET, 600);
  const params = new URLSearchParams({
    response_type: "code",
    scope: "openid email profile",
    client_id: process.env.SLACK_CLIENT_ID,
    state,
    redirect_uri: redirectUri(event),
  });
  if (process.env.SLACK_TEAM_ID) params.set("team", process.env.SLACK_TEAM_ID);
  return {
    statusCode: 302,
    headers: { Location: `https://slack.com/openid/connect/authorize?${params.toString()}`, ...CORS },
    body: "",
  };
}

async function slackCallback(event) {
  const code = event.queryStringParameters?.code;
  if (!code) return errPage("Missing authorization code");

  const tokenRes = await fetch("https://slack.com/api/openid.connect.token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.SLACK_CLIENT_ID,
      client_secret: process.env.SLACK_CLIENT_SECRET,
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri(event),
    }).toString(),
  });
  const tokenJson = await tokenRes.json();
  if (!tokenJson.ok) {
    console.warn("Slack OIDC exchange failed:", tokenJson);
    return errPage(`Sign-in failed: ${tokenJson.error || "unknown"}`);
  }

  // The id_token is a Slack-signed JWT. We trust it because we just got it
  // back from Slack over a direct HTTPS exchange authenticated with our
  // client_secret — only Slack could have produced it for this code.
  const claims = decodeJwtUnverified(tokenJson.id_token);
  if (!claims) return errPage("Invalid id_token from Slack");

  const slackId = claims["https://slack.com/user_id"] || claims.sub;
  const teamId = claims["https://slack.com/team_id"];
  const displayName = claims.name || claims.preferred_username || slackId;
  const email = claims.email || null;
  const picture = claims.picture || null;

  if (process.env.SLACK_TEAM_ID && teamId && teamId !== process.env.SLACK_TEAM_ID) {
    return errPage("This Slack workspace isn't authorized for QBIM.");
  }

  await db.upsertPlayerOAuthProfile(slackId, { displayName, email, avatarUrl: picture });

  // Internal tool — sign-in friction matters more than token rotation, so
  // session tokens never expire. Revoke by rotating SESSION_SECRET.
  const jwt = signJwt(
    { sub: slackId, email, name: displayName, picture },
    process.env.SESSION_SECRET,
    null
  );

  // Recover the signed return-to origin from the OAuth state. Defaults to
  // DASHBOARD_URL if the state is missing / unverifiable.
  let returnTo = process.env.DASHBOARD_URL;
  const stateJwt = event.queryStringParameters?.state;
  if (stateJwt) {
    const stateClaims = verifyJwt(stateJwt, process.env.SESSION_SECRET);
    if (stateClaims?.rt && isAllowedReturnOrigin(stateClaims.rt)) returnTo = stateClaims.rt;
  }

  return {
    statusCode: 302,
    headers: { Location: `${returnTo}/auth/callback?token=${encodeURIComponent(jwt)}` },
    body: "",
  };
}

async function me(event) {
  const auth = event.headers?.Authorization || event.headers?.authorization;
  if (!auth?.startsWith("Bearer ")) return jsonResp(401, { error: "Missing bearer token" });
  const claims = verifyJwt(auth.slice("Bearer ".length), process.env.SESSION_SECRET);
  if (!claims) return jsonResp(401, { error: "Invalid or expired token" });
  return jsonResp(200, {
    player_id: claims.sub,
    name: claims.name,
    email: claims.email,
    avatar: claims.picture,
  });
}

function jsonResp(statusCode, body) {
  return { statusCode, headers: { ...CORS, "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

function errPage(msg) {
  const html = `<!doctype html><meta charset="utf-8"><title>QBIM Sign-in error</title>
<style>body{font-family:system-ui;background:#0b0b10;color:#eee;padding:48px;max-width:560px;margin:auto}a{color:#7aa2ff}</style>
<h1>Sign-in error</h1><p>${msg.replace(/[<>&]/g, (c) => ({"<":"&lt;",">":"&gt;","&":"&amp;"}[c]))}</p>
<p><a href="${process.env.DASHBOARD_URL}/play">Back to QBIM</a></p>`;
  return { statusCode: 400, headers: { "Content-Type": "text/html; charset=utf-8" }, body: html };
}
