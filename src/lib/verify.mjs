import crypto from "node:crypto";

/**
 * Verify Slack request signature.
 * Returns true if valid, false otherwise.
 */
export function verifySlackSignature(signingSecret, headers, rawBody) {
  // API Gateway may preserve original header casing — normalise to lowercase
  const lc = Object.fromEntries(
    Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])
  );
  const timestamp = lc["x-slack-request-timestamp"];
  const slackSig = lc["x-slack-signature"];

  if (!timestamp || !slackSig) return false;

  // Reject requests older than 5 minutes to prevent replay attacks
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number(timestamp)) > 300) return false;

  const baseString = `v0:${timestamp}:${rawBody}`;
  const hmac = crypto
    .createHmac("sha256", signingSecret)
    .update(baseString)
    .digest("hex");
  const computed = `v0=${hmac}`;

  return crypto.timingSafeEqual(
    Buffer.from(computed, "utf8"),
    Buffer.from(slackSig, "utf8")
  );
}

/**
 * Parse a Slack payload — handles both URL-encoded (interactive payloads)
 * and JSON (Events API) bodies.
 */
export function parseSlackBody(body, isBase64Encoded) {
  const raw = isBase64Encoded ? Buffer.from(body, "base64").toString("utf8") : body;

  if (raw.startsWith("payload=")) {
    return { raw, parsed: JSON.parse(decodeURIComponent(raw.slice(8))) };
  }
  return { raw, parsed: JSON.parse(raw) };
}
