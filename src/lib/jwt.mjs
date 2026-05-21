/**
 * HS256 JWT sign/verify — no external dependencies.
 *
 * Used for web-app session tokens after Slack OAuth. Tokens live in
 * the browser's localStorage and are sent as `Authorization: Bearer`.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

function b64urlEncode(input) {
  const b64 = Buffer.from(input).toString("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(input) {
  const pad = input.length % 4 === 0 ? 0 : 4 - (input.length % 4);
  const b64 = input.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat(pad);
  return Buffer.from(b64, "base64");
}

function sign(headerAndPayload, secret) {
  return b64urlEncode(createHmac("sha256", secret).update(headerAndPayload).digest());
}

// Pass `expiresInSeconds = null` to omit the `exp` claim entirely (token never
// expires). Used for web-app session tokens since this is an internal tool and
// re-signing-in is a friction point. The OAuth state JWT still passes a short
// TTL because that one genuinely needs to expire.
export function signJwt(payload, secret, expiresInSeconds = 60 * 60 * 24 * 30) {
  const now = Math.floor(Date.now() / 1000);
  const fullPayload = { ...payload, iat: now };
  if (expiresInSeconds != null) fullPayload.exp = now + expiresInSeconds;
  const headerPart = b64urlEncode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payloadPart = b64urlEncode(JSON.stringify(fullPayload));
  const signaturePart = sign(`${headerPart}.${payloadPart}`, secret);
  return `${headerPart}.${payloadPart}.${signaturePart}`;
}

export function verifyJwt(token, secret) {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [headerPart, payloadPart, signaturePart] = parts;
  const expected = sign(`${headerPart}.${payloadPart}`, secret);
  const a = Buffer.from(signaturePart);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  let payload;
  try { payload = JSON.parse(b64urlDecode(payloadPart).toString("utf8")); } catch { return null; }
  if (payload.exp && Math.floor(Date.now() / 1000) >= payload.exp) return null;
  return payload;
}

export function decodeJwtUnverified(token) {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try { return JSON.parse(b64urlDecode(parts[1]).toString("utf8")); } catch { return null; }
}
