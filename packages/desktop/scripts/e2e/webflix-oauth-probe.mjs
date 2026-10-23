#!/usr/bin/env node
/**
 * WFX-OAUTH-CONNECT-1 — the operator's live OAuth client probe (plain node,
 * zero repo dependencies; secrets ONLY via env, never argv, never disk).
 *
 * What it probes (verbatim evidence, no consent is ever requested):
 *   A. The authorization endpoint — does Google accept THIS client id with
 *      the app's loopback redirect shape (http://127.0.0.1:<port>/oauth/callback)?
 *      A redirect_uri_mismatch answer means the client exists but the
 *      loopback redirect is not registered for it (the operator's Cloud
 *      Console configuration step — zero code changes unblock it).
 *   B. The token endpoint — does Google accept the client CREDENTIALS? A
 *      deliberately-bogus authorization code isolates client validity:
 *      invalid_grant = credentials ACCEPTED (the code was what failed);
 *      invalid_client = credentials REJECTED.
 *
 * Usage:
 *   WEBFLIX_YOUTUBE_OAUTH_CLIENT_ID=... WEBFLIX_YOUTUBE_OAUTH_CLIENT_SECRET=... \
 *     node packages/desktop/scripts/e2e/webflix-oauth-probe.mjs
 *
 * NOTE: this diagnostic mirrors the request shape the desktop app builds
 * (client id + loopback redirect + PKCE S256 + state). The in-app
 * construction itself is battery-pinned (webflixAccountIpc.test.ts asserts
 * the exact consent-URL shape), so drift here is caught by the battery, not
 * by this script.
 */
import { createHash } from "node:crypto";

const AUTHORIZATION_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const SCOPES = ["https://www.googleapis.com/auth/youtube.readonly"];
const LOOPBACK_PATH = "/oauth/callback";
const REDIRECT_PORT = 39123; // representative ephemeral loopback port

const clientId = process.env.WEBFLIX_YOUTUBE_OAUTH_CLIENT_ID?.trim();
const clientSecret = process.env.WEBFLIX_YOUTUBE_OAUTH_CLIENT_SECRET?.trim();
if (!clientId || !clientSecret) {
  console.error(
    "webflix-oauth-probe: set WEBFLIX_YOUTUBE_OAUTH_CLIENT_ID and " +
      "WEBFLIX_YOUTUBE_OAUTH_CLIENT_SECRET (env only — the probe never writes them anywhere)",
  );
  process.exit(2);
}

function codeChallenge(verifier) {
  return createHash("sha256").update(verifier, "ascii").digest("base64url");
}

async function probeAuthorization(redirectUri, label) {
  const url = new URL(AUTHORIZATION_ENDPOINT);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", SCOPES.join(" "));
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("state", "probe-state");
  url.searchParams.set("code_challenge", codeChallenge("probe-verifier-probe-verifier-probe-verifier"));
  url.searchParams.set("code_challenge_method", "S256");
  const response = await fetch(url, { redirect: "manual" });
  const location = response.headers.get("location") ?? "";
  // Google encodes redirect_uri_mismatch into the error-redirect authError
  // (base64 of the error name) and into the rendered error page.
  const mismatch =
    /authError=ChVyZWRpcmVjdF91cmlfbWlzbWF0Y2g|redirect_uri_mismatch|did not match a registered redirect/i.test(
      location,
    );
  const invalidClient = /authError=.*aW52YWxpZF9jbGllbnQ|invalid_client|Client not found|deleted client/i.test(
    location,
  );
  console.log(`  [${label}] redirect_uri=${redirectUri}`);
  console.log(`    status=${response.status} redirect_uri_mismatch=${mismatch} invalid_client=${invalidClient}`);
  return { mismatch, invalidClient };
}

async function probeToken(redirectUri) {
  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: "4/0ProbeInvalidCodeWebFlixClientValidation",
      code_verifier: "probe-verifier-probe-verifier-probe-verifier",
      redirect_uri: redirectUri,
      client_id: clientId,
      client_secret: clientSecret,
    }).toString(),
  });
  const payload = await response.json().catch(() => ({}));
  const error = typeof payload.error === "string" ? payload.error : "(none)";
  console.log(`    status=${response.status} error=${error}`);
  return error;
}

console.log("=== PROBE A: authorization endpoint (client + loopback redirect validity) ===");
const loopback = `http://127.0.0.1:${REDIRECT_PORT}${LOOPBACK_PATH}`;
const localhost = `http://localhost:${REDIRECT_PORT}${LOOPBACK_PATH}`;
const a1 = await probeAuthorization(loopback, "127.0.0.1 loopback");
const a2 = await probeAuthorization(localhost, "localhost loopback");

console.log("=== PROBE B: token endpoint (client credentials validity — bogus code isolates the client) ===");
console.log(`  [loopback redirect] redirect_uri=${loopback}`);
const b1 = await probeToken(loopback);

console.log("");
console.log("=== INTERPRETATION (honest) ===");
console.log(
  `  client credentials: ${
    b1 === "invalid_client"
      ? "REJECTED by Google (invalid_client — check the client id/secret pair)"
      : b1 === "invalid_grant"
        ? "ACCEPTED by Google (invalid_grant on the deliberately-bogus code means the client id + secret validated)"
        : `endpoint answered "${b1}" — see Google's error docs`
  }`,
);
if (a1.invalidClient || a2.invalidClient) {
  console.log("  client id: Google reports an INVALID/unknown client at the authorization endpoint");
} else if (a1.mismatch && a2.mismatch) {
  console.log(
    "  loopback redirect: NOT registered on this client (redirect_uri_mismatch for both 127.0.0.1 and localhost).",
  );
  console.log(
    "    UNBLOCK (operator, zero code changes): in Google Cloud Console → APIs & Services → Credentials,",
  );
  console.log(
    "    either register the loopback redirect for this client or create an OAuth client of type",
  );
  console.log(
    "    \"Desktop app\" (the native-app loopback+PKCE venue per",
  );
  console.log(
    "    https://developers.google.com/identity/protocols/oauth2/native-app) and supply its credentials",
  );
  console.log(
    "    through the same env/file seam (WEBFLIX_YOUTUBE_OAUTH_CLIENT_ID/_SECRET or <dataRoot>/youtube-oauth-client.json).",
  );
} else {
  console.log(
    "  loopback redirect: ACCEPTED — the connect flow can complete a real consent round trip once a user signs in.",
  );
}
