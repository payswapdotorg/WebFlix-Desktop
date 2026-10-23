# Work Order — WFX-OAUTH-CONNECT-1

Status: DONE (2026-10-23 — see docs/testing/wfx-parity-evidence.md section F
for the delivered surface, the gate totals, and the verbatim live-probe
evidence; the consent round-trip gate remains honestly BLOCKED on the
operator's Cloud Console redirect registration — zero code changes to
unblock)
Owner: TL3 (single-lane wave — no parallel workers required; the change is one
vertical slice across desktop-main + mirrors, with the contract surface owned
by the TL exactly like the WFX-INTEGRATE-1 lane)
Priority: The standing AS-Q3 unblock — the operator has provisioned the
desktop OAuth client.
Primary repo: https://github.com/payswapdotorg/WebFlix-Desktop
Base SHA: 950a80c (the WFX wave completion record)

## 1. Trigger and product outcome

The TL2 handoff record closed the WFX wave with the standing BLOCKED gate:
"Native desktop YouTube OAuth remains BLOCKED on the operator-provisioned
client (AS-Q3)." The operator has now supplied a Google OAuth client
(client id + client secret) for the desktop app.

The outcome of this lane: the Accounts surface's Connect action stops being an
honest refusal and becomes the REAL per-user loopback+PKCE authorization flow
against the operator-provisioned client — the system browser opens Google
consent, the loopback redirect completes, tokens land in the OS vault
(encrypted at rest), and the renderer sees only the renderer-safe account
record. When the client is NOT provisioned in an environment, connect stays
the honest typed refusal (unchanged law, updated wording).

## 2. Binding decisions (all follow the frozen architecture)

1. **The connectors package stays network-free.** The frozen
   `YouTubeOAuthSession` (connectors/src/youtube/oauth.ts) is consumed exactly
   as exported: injected `tokenFetcher`, injected `config`. The real Google
   token fetcher lives in the desktop main process (the same boundary the
   OS vault uses).
2. **Credential provisioning mirrors the Data API key precedent**
   (webflixAgentWorkspaceIpc.ts): main-process env FIRST, then a
   user-managed file under the WebFlix data root. Env:
   `WEBFLIX_YOUTUBE_OAUTH_CLIENT_ID` + `WEBFLIX_YOUTUBE_OAUTH_CLIENT_SECRET`.
   File: `<dataRoot>/youtube-oauth-client.json`
   (`{"clientId": "...", "clientSecret": "..."}`). NEVER baked into the
   binary, never committed, never logged, never renderer-visible.
3. **The client secret never crosses IPC.** The connect outcome vocabulary
   carries only typed codes + human reasons. The authorization URL carries
   only the client id (the public half), state and the PKCE challenge.
4. **System browser, not an embedded webview** (work order
   WFX-DESKTOP-WEBFLIX-UX-1 §3.7): consent opens via `shell.openExternal`.
   An explicit `WEBFLIX_YOUTUBE_OAUTH_OPEN=manual` env mode skips the browser
   launch and logs the URL for manual copy (RFC 8252 §5.2.2 permits the
   manual fallback; useful on headless systems) — the typed outcome says
   exactly which mode ran.
5. **Fail-closed order for connect**: unknown provider → typed
   `invalid-provider`; safeStorage unavailable → typed refusal (no vault, no
   flow, nothing authorized); client not provisioned → typed
   `connect-unavailable`; a flow already waiting → typed
   `authorization-in-progress`; listener/browser failure → typed
   `flow-error`; otherwise → `authorization-started` (ok) and the completion
   happens in the background.
6. **Single canonical installation account id** `primary`
   (`WEBFLIX_YOUTUBE_PRIMARY_ACCOUNT_ID`), mirrored + battery-pinned across
   main/preload/renderer exactly like the channel strings. The host's
   getStatus now queries the real pointer (the previous `getStatus([])`
   empty-pointer read could never show a connected account).
7. **The pending flow is bounded**: the loopback listener expires
   (default 300s) and cleans up. Late failure details live in the main log;
   the renderer's honest signal is the record appearing (or not) in
   getStatus — a bounded poll while authorization is pending.
8. **Outcome vocabulary is additive**: existing codes keep their meaning;
   new codes: `authorization-started`, `authorization-in-progress`,
   `flow-error`. The preload/renderer mirrors + batteries are updated in the
   same commit (the mirror-pin law).
9. **No claims beyond evidence**: the live consent round-trip requires the
   operator's Google account sign-in. This lane live-verifies (a) the
   authorization endpoint accepts the client + loopback redirect, and (b)
   the token endpoint accepts the client credentials — both recorded
   verbatim. The full consent round-trip gate stays BLOCKED (operator
   account consent), never mocked.

## 3. Allowed paths (this lane only)

- `packages/desktop/src/main/webflix/oauthConnectFlow.ts` (NEW)
- `packages/desktop/src/main/webflixAccountIpc.ts` + `webflixAccountIpc.test.ts`
- `packages/desktop/src/preload/webflixAccountBridge.ts`
- `packages/desktop/src/renderer/src/webflix/accountsBridge.ts`
- `packages/desktop/src/renderer/src/webflix/useAccountRetentionHandlers.ts`
  (+ its renderer battery files that pin the mirrors)
- Docs: this work order, `docs/plans/work-claims.md` (new row),
  `docs/testing/wfx-parity-evidence.md` (gate updates),
  `docs/plans/tl2-handoff.md` (continuation record).

## 4. Definition of done

- Battery: the account IPC battery pins the full connect state machine
  (unconfigured refusal, authorization-started with a REAL loopback listener
  on an ephemeral port, simulated Google redirect completing through the REAL
  session + injected fetcher into the REAL vault store double, state-mismatch
  refusal, single-flight, browser-failure typing, secret-never-in-outcome).
- The existing gates stay green: full vitest battery, typecheck, lint on
  touched paths.
- Live probes recorded verbatim (authorization URL + token endpoint), with
  the consent round-trip honestly BLOCKED.
- Ledger row closed with the exact SHA; handoff + parity matrix updated.
