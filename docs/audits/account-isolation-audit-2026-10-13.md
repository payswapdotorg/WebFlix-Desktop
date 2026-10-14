# Account-isolation audit — WF-030 (P7-AUDIT-ISOLATION-1)

- Work ID: P7-AUDIT-ISOLATION-1 (Phase-7 wave-3, read-only audit grant)
- Requirement: WF-030 — "Provider accounts, tokens and writes are scoped to
  the connecting user/profile" (acceptance: cross-profile and
  disconnect/revoke tests; no operator-session leakage)
- Owner: D2-lane worker. Base: `18f8fa4` (main after the wave-1/2/3-stream
  merges; recorded as BASE at clone). Tree state: UNTOUCHED product code —
  this document plus the ledger row are the only deliverables.
- Method: source-level trace of every provider-account storage/lookup path,
  every disconnect/revoke flow, and a tree-wide operator-session pattern
  sweep, each claim cited as `path:line` at this BASE. No credentials, no
  provider accounts, no live provider calls, no network.

## 0. Verdict summary (one line per audited axis)

| Axis                                                  | Verdict                                                                                              | Anchor   |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | -------- |
| Cross-profile isolation at the account seams          | PASS (structural; no production store exists to violate it)                                          | §1       |
| CredentialPort foreign-account acceptance             | PASS-with-finding (port loads by caller-supplied id; no test pins the session-own account invariant) | §1.4, §4 |
| Provider writes scoping                               | PASS by absence (the only write primitive has zero production callers)                               | §1.8     |
| Disconnect/revoke credential death                    | PASS at the vault seam for all five providers (fixture-tested)                                       | §2       |
| Revocation propagation beyond the seam                | UNVERIFIED (no production vault/partition wiring exists)                                             | §2.3, §5 |
| Operator-session / CDP-broker reuse in provider paths | PASS — none exists (rg-proven; handoff isolation frozen and test-asserted)                           | §3       |
| Declared-but-unwired `webflixProductSurface` flag     | FINDING (policy names enforcement files that do not exist in the tree)                               | §3.4     |
| Isolation test coverage                               | PARTIAL — lifecycle well covered; cross-account/cross-profile OAuth cases absent                     | §4       |

## 1. Cross-profile isolation audit (every provider-account storage/lookup path)

### 1.1 Contract shapes — renderer-safe by construction

`packages/webflix-contracts/src/account.ts`:

- `ProviderAccountRecordSchema` is a `z.strictObject`
  (account.ts:15-26): unknown keys — and therefore tokens or any credential
  material — are rejected at parse time. The doc comment states the boundary
  explicitly: "Tokens never leave the main process; renderers only ever
  reference credentials through CredentialRef handles" (account.ts:8-14).
- `CredentialRef` is `{ handle: string }` only — an opaque lookup key, "NOT
  a token" (account.ts:29-36).
- `CredentialPort` is the frozen READ-ONLY seam:
  `getToken(providerId, internalAccountId) → CredentialRef`
  (account.ts:38-46). There is no canonical write/delete seam (the freeze
  deviation MR-FD6, acknowledged in
  packages/connectors/src/youtube/oauth.ts:35-43).

Verdict: PASS — no account record crossing the IPC boundary can carry a
credential.

Test evidence: `packages/webflix-contracts/src/tests/contracts.test.ts:725-738`
(round-trip of a renderer-safe record) and `:740-758` (an `accessToken` key
and an illegal status are both rejected).

### 1.2 The connector-local account stores — keyed by `internalAccountId` only

All five provider OAuth modules define a connector-local
`*OAuthAccountStore` interface whose EVERY method is scoped by
`internalAccountId`:

- YouTube: `packages/connectors/src/youtube/oauth.ts:110-117`
  (`loadAccount/saveAccount/removeAccount/loadTokens/saveTokens/removeTokens`,
  each taking `internalAccountId`).
- TikTok: `packages/connectors/src/tiktok/oauth.ts:123-129`.
- Instagram: `packages/connectors/src/instagram/oauth.ts:138-144`.
- Twitch: `packages/connectors/src/twitch/oauth.ts:125-131`.
- Reddit: `packages/connectors/src/reddit/oauth.ts:123-130`.

Records and raw tokens are stored as separate maps keyed by the same id
(the test double makes the split visible:
`packages/connectors/tests/connectors.test.ts:120-148`; the one in-tree
implementation is the explicitly-labeled test substrate
`InMemoryRedditOAuthAccountStore`, "test substrate; the vault owns the real
one", packages/connectors/src/reddit/oauth.ts:506-533).

Verdict per path: every storage/lookup method names exactly one account
key; there is no enumerate/list/lookup-by-user surface at all, so no store
path can read "another profile's account" — it can only address the account
id it is handed.

### 1.3 Session binding — one account per session instance

Each `*OAuthSession` is constructed with a single `internalAccountId`
(`YouTubeOAuthSessionOptions.internalAccountId`,
youtube/oauth.ts:371-379, bound at :396-403; tiktok/oauth.ts:228,235-237;
instagram/oauth.ts:255,262-264; twitch/oauth.ts:297,304-306;
reddit/oauth.ts:245,258-260). Every lifecycle operation —
`completeAuthorization` (youtube/oauth.ts:496-506), `getToken`
(:511-537), `refresh` (:540-593), `revoke` (:596-620),
`acknowledgeRevocation` (:627-641) — reads and writes through
`this.internalAccountId` only. A session cannot even name another account.

Verdict: PASS — per-account scoping is enforced by construction at the
session layer.

### 1.4 The CredentialPort view — the one seam that accepts a foreign id (finding)

`session.credentialPort().getToken(providerId, internalAccountId)`
validates the provider id (mismatch → `RequiresAuthError`,
youtube/oauth.ts:426-431; same guard in tiktok/oauth.ts:274-281,
instagram/oauth.ts:297-304, twitch/oauth.ts:343-350,
reddit/oauth.ts:477-484) but then loads
`this.store.loadAccount(internalAccountId)` /
`loadTokens(internalAccountId)` with the CALLER-SUPPLIED id
(youtube/oauth.ts:432-433) and, when usable, mints the opaque handle
`${providerId}:${internalAccountId}` (:442; reddit appends `:access`,
reddit/oauth.ts:495).

What this means, stated honestly:

- The handle is an opaque lookup key, never a token (the contract
  account.ts:29-36), so this is not a credential disclosure at the seam —
  the host still has to open the handle.
- But the port itself does NOT restrict resolution to the session's own
  account. The only current caller is the application layer's
  `RefreshProviderMetadata`, which passes `input.internalAccountId` — a
  caller-declared "connected account" — through the port
  (packages/webflix-application/src/refresh-provider-metadata.ts:49-57,92-97).
- With today's tree there is no production host that shares one store
  across profiles, so there is no live cross-profile read path (§1.5). The
  residual risk is forward-looking: a future host that (a) instantiates
  ONE store for multiple profiles and (b) forwards renderer-supplied
  account ids into the port would mint handles for another profile's
  account. The structural mitigation already in the tree is the
  composition discipline — per-profile store instantiation, the same
  ADR-0003 discipline the local-library stores pin by test (§1.6).

Verdict: PASS-with-finding. No current violation; the session-own-account
invariant is enforced by convention, not by the port, and it is NOT pinned
by any test (the exact missing test cases are named in §4).

### 1.5 Production wiring — there is none (isolation holds by construction)

- The ONLY `OAuthAccountStore` implementations in the tree are test
  doubles: the per-suite memory stores (e.g.
  packages/connectors/tests/connectors.test.ts:120-148) and the labeled
  test substrate `InMemoryRedditOAuthAccountStore`
  (reddit/oauth.ts:511-533). No vault/keychain adapter exists anywhere
  (rg `keychain|safeStorage` over the WebFlix packages: matches are
  comments only; the desktop's own chrome credential machinery at
  packages/desktop/src/main/chromeCredentialManager.ts is
  ZCode-substrate Chrome-import code, gated OFF per §3.2).
- The web client host mounts the accounts surface with `accounts={[]}`
  (apps/web-client/src/App.tsx:290) — no account storage is wired.
- The desktop does not mount the WebFlix shell at all yet: "the shell is a
  component library not yet mounted in the desktop renderer (Phase-2
  wiring)" (packages/desktop/scripts/e2e/webflix-smoke.mjs:19-22).

Verdict: PASS by absence — there is no production account persistence
today, therefore no production cross-profile read path. This also means
the isolation claim is UNVERIFIED at runtime (see §5).

### 1.6 The profile model — what "profile" means in this tree

There is NO multi-user/profile-switcher model in WebFlix code. Two
scoping notions exist:

- `internalAccountId` — "Stable, installation-local id for the linked
  account" (account.ts:17-18). One WebFlix install is effectively a single
  profile: the desktop identity resolves one data root
  (`~/.webflix` / `~/.webflix-dev`,
  packages/desktop/src/main/webflix/identity-env.ts:24-38 and
  packages/desktop/src/main/desktopRuntimeEnv.ts:48-60).
- Profile-scoped WebFlix-local stores — the local-library SQLite stores
  bind to ONE profile directory per store set: "openStore mints one store
  per profile directory — no adapter ever crosses profiles, no ad\_\* row
  ever leaves this profile's database"
  (packages/local-library/src/ads-stores.ts:29-35; same discipline stated
  in packages/webflix-application/src/in-memory-ad-memory-stores.ts:6-11
  and in-memory-retention-stores.ts:5-11).

Per-profile isolation of WebFlix-local data is pinned by tests (§4.1). The
OAuth account seam has the same structural discipline available (per-
profile store sets) but no test yet pins it (§4.2).

### 1.7 Provider reads — per-account clients, no global credential lookup

Every provider API client receives its credential through constructor
injection; none looks accounts up globally:

- YouTube: `YouTubeDataApiClient` takes an injected `accessTokenProvider`
  (packages/connectors/src/youtube/dataApi.ts:83-84,353-365,378-380);
  per call it resolves the token or throws the typed
  `MissingCredentialError` (:600-611).
- Twitch Helix sends Client-Id + the caller-supplied bearer
  (packages/connectors/src/twitch/helixApi.ts; honest pre-I/O refusals
  when no Client-Id/token, per tests twitch.test.ts:404-418); the
  app-only client-credentials token is an OPERATOR item (client secret),
  not a user account credential (twitch/oauth.ts:48-49,89,220).
- TikTok display API, Instagram Graph API: same injected-fetch +
  per-account token pattern, with honest typed refusals
  (tiktok/displayApi.ts; instagram/graphApi.ts:561).
- Federated search takes NO credentials at all — auth surfaces as the
  typed `auth-required` source state
  (packages/webflix-application/src/federated-search.ts:83,98-100;
  packages/webflix-contracts/src/search.ts:123).

Verdict: PASS — no cross-account read path exists inside the connectors;
account binding is the host's job at client construction.

### 1.8 Provider writes — explicit ops only, zero production callers

- The ONLY provider-write primitive is `toProviderHistoryWrite`
  (packages/playback/src/resolve.ts:403-418): an explicit op builder whose
  doc states "NOTHING in this package (resolution, progress tracking)
  calls this; the app layer must invoke it deliberately" (:404-406).
  rg over the tree: the only callers are its own tests
  (packages/playback/**tests**/playback.test.ts:496-503). No application
  or host code performs a provider write.
- Resolution/progress never emit provider writes — pinned by test
  (playback.test.ts:466-492: JSON of plan and progress asserted free of
  "provider-history-write").
- The op shape (`ProviderHistoryWriteOp`, resolve.ts:50-56) carries
  `providerId` + `externalId` + progress — it does NOT carry an account
  id. Honest observation for the future wiring order: when a caller
  finally wires this op, the acting account must come from the caller's
  session context; the op itself is account-agnostic.
- WebFlix-local progress is WebFlix-owned and never exchanged
  (packages/webflix-application/src/track-playback-progress.ts:1-10,46-95).

Verdict: PASS by absence — no provider write flows today; the write seam
is explicit-only and test-pinned against implicit emission.

## 2. Disconnect/revoke audit (do credentials die with the disconnect?)

### 2.1 Per-provider flows (all fixture-tested; the token fetcher is injected and live network is disabled — youtube/oauth.ts:69-71,361-365)

- YouTube: `revoke()` exchanges at the official revocation endpoint, then
  `removeTokens` + persists the revoked record (youtube/oauth.ts:596-620,
  token removal at :617). A provider-rejected refresh (`invalid_grant`)
  honestly revokes AND clears the vault (:559-566).
  `acknowledgeRevocation()` removes tokens AND the record (:627-641) —
  "absence of a record is the frozen not-connected state" (:622-626).
  Tests: connectors.test.ts:684-758 (full lifecycle walk incl. acknowledge
  and vault-empty assertions at :750-758), :761-779 (revoke clears the
  vault; `getToken` then rejects with `RequiresAuthError`).
- TikTok: no official revocation endpoint exists for this flow —
  `disconnect()` performs ZERO network calls, removes the tokens and marks
  the record revoked (tiktok/oauth.ts:465-476; the honesty rationale at
  :36-41), `acknowledgeRevocation()` removes tokens + record (:483-496).
  Test: tiktok.test.ts:908-931 ("disconnects LOCALLY with ZERO network
  calls"). Honest limit: the provider-side token stays valid until
  natural expiry — stated in the module header, not hidden.
- Instagram: disconnect goes through the official revocation; a FAILED
  revoke surfaces the error and leaves the record intact (retryable,
  never silent) — instagram/oauth.ts:478-509 (token removal at :502),
  acknowledge at :511-524. Tests: instagram.test.ts:870-892 (official
  revoke; failed revoke leaves record intact :916-924), :926-930 (cannot
  disconnect without the Facebook user id — the revocation target).
- Twitch: disconnect performs the OFFICIAL revocation then destroys local
  state (twitch/oauth.ts:552-581, token removal at :574; the Twitch-
  difference rationale at :24-28), acknowledge at :583-596. Tests:
  twitch.test.ts:775-792 (official call, then local destruction), :794-810
  (failed revocation leaves the account connected), :812-826 (acknowledged
  revocation removes the record).
- Reddit: disconnect revokes the refresh token FIRST, then the access
  token (both official calls; a failed revoke leaves the record intact
  and retryable) — reddit/oauth.ts:428-470 (token removal at :468, record
  transition at :466-467). Test: reddit.test.ts:635+.

Verdict: at the account-store seam, EVERY disconnect/revoke path removes
the vault-side tokens; every failed-provider path keeps the record honest
and retryable rather than silently deleting or keeping credentials.

### 2.2 What layers hold tokens at all (and therefore need propagation)

- The renderer: never holds tokens (§1.1; record is strict-parsed).
- The session objects: hold no token copies — every read goes back to the
  store (e.g. youtube/oauth.ts:511-537 re-loads from the store each call).
- In-flight pending authorizations: hold only `codeVerifier` +
  `redirectUri` + `createdAt` (youtube/oauth.ts:381-385), deleted on
  completion (:477) and single-use by state.
- API clients: resolve the token per call from the injected provider
  (youtube dataApi.ts:600); no token cache in the client. The Twitch
  app-token cache is the OPERATOR client-credentials token (public-read
  app token, not a user account credential) — twitch.test.ts:597-633.
- WebFlix-local caches that reference provider data: provider-sourced
  field sets (`putProviderFieldSet`) hold PUBLIC provider metadata keyed
  by trackId+provider with a 30-day TTL — no account key, no credentials
  (packages/webflix-application/src/refresh-provider-metadata.ts:22-34,113-135;
  local-library localStore.ts mapProviderMetadata :136-146). Not
  credential material; nothing to revoke.

### 2.3 Revocation propagation — where it stops today (honest)

`removeTokens` is the last call the connectors can make; the REAL vault
(the OS keychain / encrypted store the host will implement behind
`OAuthAccountStore`) does not exist yet (§1.5). Therefore:

- OS-keychain entry deletion, encrypted-blob cleanup and any
  vault-internal caching are UNVERIFIED — there is no implementation to
  audit.
- The Electron per-provider session partitions
  (`persist:webflix-embedded-<provider>-<accounthash>`,
  packages/desktop/src/main/browserDataManager.ts:45-77) have a
  provider/account-scoped clear available
  (`clearEmbeddedBrowserData({providerId, accountKey})`,
  browserDataManager.ts:263-290) — but NO disconnect flow calls it yet,
  because no provider webview surface is wired (the `isolated-website`
  plan kind exists in the frozen contracts,
  packages/webflix-contracts/src/playback.ts:54-59, with control-surface
  handling in packages/playback/src/controls.ts:309-312,350,420, and no
  connector emits it — rg over packages/connectors/src: zero builders).
- The streaming handoff needs no such cleanup by design: it opens in the
  external context and never inherits the app session
  (packages/connectors/src/streaming/manifest.ts:199-220; handoff.ts:37-41).

Verdict: credentials die at the seam on every path; propagation beyond
the seam is structurally prepared (scoped partition clear) but UNWIRED —
an honest unknown, not a defect claim.

## 3. Operator-session leakage audit (the ADR-0003 forbidden pattern)

ADR-0003 forbids, for provider access: "a single operator session and a
CDP-driven broker", "shared operator identity, shared user session, or
cross-user account action"
(docs/adr/0003-youtube-first-per-user-identity.md:9,21; the rejected
alternative at :39).

### 3.1 WebFlix provider code — zero instances (rg-proven)

rg `cookie|cdp|operator|webContents|electronSession` over
`packages/connectors/src`, `packages/webflix-application/src`,
`packages/webflix-shell/src`, `packages/webflix-contracts/src`,
`packages/webflix-domain/src`, `packages/playback/src`,
`packages/local-library/src`, `packages/catalog/src` (excluding tests):
every hit is either (a) an honest "pending operator credential" client-id
placeholder (e.g. twitch/oauth.ts:89,220; instagram/graphApi.ts:57-58) or
(b) a policy comment stating cookies are NOT used (e.g. twitch/manifest.ts:10;
streaming/manifest.ts:81,206-207; streaming/handoff.ts:39). NO provider
path attaches cookies, drives CDP, or reuses any operator session.

### 3.2 The legacy substrate surface — present but unreachable in WebFlix boots

The ZCode substrate retains the Chrome cookie/localStorage/credential
import + CDP browser-automation family
(packages/desktop/src/main/chromeCookieManager.ts,
chromeCredentialManager.ts, chromeLocalStorageManager.ts,
browserView/\*). In the WebFlix desktop:

- The chrome-import IPC is NOT REGISTERED while `chromeImportEnabled` is
  OFF — the fail-closed default; "the surface is UNREACHABLE from the
  renderer, not merely hidden"
  (packages/desktop/src/main/desktopBrowserDataIpc.ts:10-35, flag at
  :20-25; parsing fail-closed in
  packages/desktop/src/main/webflix/isolation-flags.ts:48-56).
- Desktop boot asserts it: the tier-4 smoke records
  "isolation:chrome-import-off" — the ImportChromeBrowserData handler is
  absent (packages/desktop/scripts/e2e/webflix-smoke.mjs:229-234; the
  assertion contract at :16).
- The flag policy itself is pinned by unit tests
  (packages/webflix-shell/src/isolation-flags.test.ts:24-63 fail-closed
  parsing; :92-148 policy shape; the vendored desktop copy is
  byte-identical by README contract,
  packages/desktop/src/main/webflix/README.md:3-8).

### 3.3 Shared-partition residue — known, recorded in-tree, unwired

`persist:zcode-embedded-browser` (browserDataManager.ts:30) remains the
fallback partition for callers WITHOUT provider context, with the
per-provider derivation available but "back-compat until the provider
webview work (Phase 2) threads provider identity through every attach
site" (browserDataManager.ts:32-44,72-77). Current callers without
provider scope: the network policy and the bootstrap protocol install
(:41-43), plus the IPC clear handler
(desktopBrowserDataIpc.ts:36-41). No WebFlix provider surface attaches a
webview today (§2.3), so no provider session data lands in ANY partition
via WebFlix code. This is a recorded Phase-2 wiring precondition, not a
live leak.

### 3.4 FINDING — `webflixProductSurface` is declared but not wired

`ISOLATION_FLAG_POLICY` declares that `webflixProductSurface` (default
OFF) gates "Coding Plan / PayPal, CUA, Lark, SSH/Docker/WSL remotes,
force-update" and names its enforcement sites as
`ipc-router.ts`, `app-menu.ts`, `deep-links.ts`
(packages/desktop/src/main/webflix/isolation-flags.ts:100-123).

Honest verification: NONE of those three files exist in the tree
(rg over packages/desktop/src/main: only
desktopBrowserDataIpc.ts consumes `resolveIsolationFlags`, and only for
`chromeImportEnabled` — desktopBrowserDataIpc.ts:4,20-21). No code
anywhere reads `webflixProductSurface` or `WEBFLIX_ENABLE_PRODUCT_SURFACE`
outside the isolation-flags module and its tests. The integration commit
that applied the patch spec (c40eff1) records that the spec's §4-§7 text
was truncated at lane delivery and lists findings b/d/e as applied — §6.C
(the product-surface gating) is not among them.

Scope honesty for WF-030: the gated surfaces are ZCode-account surfaces
(e.g. the Coding Plan webview lives in its own partition
`persist:zcode-coding-plan`,
packages/desktop/src/main/desktopCommandHandlers.ts:44,141),
not WebFlix provider accounts — so this is NOT a provider-account
isolation violation. It IS a drift between the declared isolation policy
and the tree, on the axis ADR-0003 cares about (which sessions exist in a
WebFlix build). Recorded here for TL2 routing; the unit test
isolation-flags.test.ts:117 verifies only that the policy DATA names
paths — it cannot verify enforcement in files that do not exist.

### 3.5 Verdict

NO operator-session/CDP-broker reuse exists in any WebFlix provider-access
path (§3.1); the legacy import surface is unreachable-by-default and
boot-asserted (§3.2); one declared-flag/enforcement drift recorded as a
finding (§3.4) and one recorded Phase-2 partition precondition (§3.3).

## 4. Test-coverage map (what has tests, what lacks them)

### 4.1 COVERED (with the pinning tests)

1. Renderer-safety of account records: strict-parse rejects token keys —
   contracts.test.ts:725-758.
2. Secret-free playback plans (no session/credential/cookie material):
   contracts.test.ts:351-379 (secret URLs and secret-bearing embed specs
   rejected); the frozen plan shapes carry no session fields at all
   (playback.ts:42-97).
3. OAuth lifecycle per provider (5 suites): CSRF state guard, code
   exchange, refresh-near-expiry, invalid_grant → honest revocation +
   vault clear, official revoke, failed-revoke-leaves-record-intact,
   acknowledge-removes-record, credential-port-resolves-handles-never-tokens
   (e.g. twitch.test.ts:661-848 incl. the provider-mismatch guard at :846;
   connectors.test.ts:684-808; reddit.test.ts:635+;
   instagram.test.ts:870-930; tiktok.test.ts:883-931).
4. Provider writes are explicit-only: playback.test.ts:466-492 (never
   emitted from resolution/progress) and :496-503 (the explicit op).
5. Streaming-handoff isolation flags (never inherits app session, no
   credentials, no cookies, external context): streaming.test.ts:361-380.
6. Per-profile isolation of WebFlix-local stores (4 families + ad memory):
   ranker-selection-store.test.ts:140-158 (two baseDirs never see each
   other's choice); intelligence-stores.test.ts:346-349+;
   transcript-payload-store.test.ts:321+; ads-stores.test.ts:745+;
   ad-memory.test.ts:618-660+ (profile A's grants/memory invisible to
   profile B; independent grants).
7. Fail-closed isolation-flag parsing + policy shape:
   isolation-flags.test.ts:24-63,92-148.
8. Honest unauthenticated behavior of the credential consumer:
   application.test.ts:939-955 (refresh skips everything, calls nothing,
   when no credential resolves).

### 4.2 NOT COVERED — the exact missing test cases (follow-up order payload; NOT written in this row)

1. Cross-account isolation at the OAuth seam (the core WF-030 acceptance
   gap): no test anywhere constructs TWO sessions with DIFFERENT
   `internalAccountId`s over ONE store. Missing cases:
   a. session A's `credentialPort().getToken(providerId, "<B's id>")` —
   pin the intended behavior (resolve-only-own-account, or an explicit
   typed refusal for a foreign id); today every port test passes the
   session's own id (twitch.test.ts:839-846; connectors.test.ts:721,746)
   or a mismatched PROVIDER (twitch.test.ts:846) — never a foreign
   ACCOUNT id on the same store.
   b. account B's disconnect/revoke leaves account A's record AND vault
   entry untouched (the store fake at connectors.test.ts:120-148 can
   express this today; no test does).
   c. two YouTube accounts ("local-user-1"/"local-user-2" exist as ids in
   SEPARATE tests — connectors.test.ts:178,766,786,801 — but never in
   one store in one test).
2. Multi-profile OAuth store discipline: no test instantiates two
   profile-scoped store sets (the local-library per-profile pattern) at
   the OAuthAccountStore seam and asserts cross-profile invisibility of
   accounts/tokens.
3. Disconnect → partition/cache propagation: no test wires a disconnect
   to `clearEmbeddedBrowserData({providerId, accountKey})`
   (browserDataManager.ts:263-290) and asserts the per-provider partition
   is cleared while other providers' partitions survive. (Blocked on
   wiring that does not exist yet — the test case is named for the
   follow-up order.)
4. `webflixProductSurface` enforcement: no desktop-side test that gated
   channels/menus/deep-links are unregistered while the flag is OFF (the
   chrome-import analogue of webflix-smoke.mjs:229-234). Blocked on the
   finding in §3.4 (the enforcement sites do not exist).
5. RefreshProviderMetadata account-scope: the test fake keys credentials
   by PROVIDER only (application.test.ts:371-394 — `getToken` ignores the
   account id for lookup), so no test can express "refresh as account A
   must not use account B's credential". The fake needs a
   (provider,account) key before the test can be written.
6. Renderer-boundary negative test (forward-looking): once a preload
   surface exists, a test that the renderer cannot invoke
   `credentialPort.getToken` directly. Today there is no preload surface
   for accounts at all (nothing to test yet — listed for completeness).

### 4.3 Coverage-honesty note

All OAuth tests are FIXTURE-TESTED (injected token fetchers; live network
disabled — youtube/oauth.ts:69-71). No test in the tree exercises a real
provider, a real keychain, or a real Electron partition — those are
live/packaged tiers that remain pending-operator-credential per the
connectors work orders.

## 5. Honest unknowns and limits of this audit

1. No production vault exists. Every §1/§2 verdict is a verdict about
   SEAMS and test doubles. OS-keychain storage, encryption at rest,
   keychain-entry naming and removal are entirely unimplemented and
   therefore unaudited.
2. No runtime account surface exists. The audit is source-level; there is
   no GUI/E2E evidence of a connect/disconnect flow (the desktop smoke
   asserts only that the chrome-import IPC is absent; the web host mounts
   accounts=[]; the desktop does not mount the shell).
3. The tier-4 desktop smoke was NOT run in this audit session (it needs
   an X server/Xvfb and DISPLAY). Its in-tree contract
   (webflix-smoke.mjs:11-18,229-234) is cited as shipped evidence from
   the DESKTOP-ACCEPTANCE lane; the numbers in §6 do not include it.
4. "Profile" has no user-facing model. Cross-profile isolation can only
   be asserted structurally (per-profile store instantiation discipline,
   §1.6); no in-app profile switcher exists to test against.
5. The §3.4 flag drift is verified as absent-wiring by rg (no consumer of
   `webflixProductSurface` outside the flags module); what the ZCode
   renderer actually exposes at runtime in a WebFlix build was NOT
   audited (out of WF-030 scope: no WebFlix provider-account surface is
   involved) — flagged for TL2 routing to the desktop/release lane.
6. Live provider revocation semantics (does the provider actually kill
   the grant?) are fixture-tested only. TikTok's provider-side residue on
   local disconnect is a documented, honest limitation (§2.1).
7. This audit does not opine on the matrix status transition
   (audit-pending → audited) — that ruling is TL2's on this evidence.

## 6. Gates actually run in this session (untouched tree, BASE 18f8fa4)

- `npx tsc -b --force packages/webflix-contracts packages/webflix-domain
packages/webflix-application packages/local-library packages/webflix-shell`
  — exit 0 (group 1).
- `npx tsc -b --force packages/catalog packages/connectors packages/playback`
  — exit 0 (group 2).
- `pnpm test:unit` — 1481/1481 passed, 62 test files (exact base green).
- `pnpm test:integration` — 1/1 passed.
- `pnpm lint` — 69 warnings / 0 errors (the recorded baseline; this row
  changes documentation only, so zero new by construction).
- `pnpm fmt:check` — PASS (3369 files; the new audit file is formatted to
  the same standard).
- `pnpm architecture:check` — 0 violations / 0 baseline / 0 new.

Environment honesty: `pnpm` is not on PATH in this sandbox; the pinned
`pnpm@10.33.2` (package.json:85) was invoked through `corepack pnpm …`
for the pnpm-based gates, and `npx tsc` directly for the two tsc groups,
on node v24.21.0. The TL2 station re-runs all gates itself on this branch
per the v2 transport doctrine.

## 7. Source index (every path cited, at BASE 18f8fa4)

contracts: packages/webflix-contracts/src/account.ts:8-46;
src/playback.ts:42-97; src/internal/primitives.ts:64-77;
src/tests/contracts.test.ts:351-379,725-758 — connectors:
packages/connectors/src/youtube/oauth.ts:35-43,110-117,371-379,381-385,396-403,424-445,496-537,559-566,596-620,627-641;
src/youtube/dataApi.ts:83-84,353-365,378-380,600-611;
src/tiktok/oauth.ts:36-41,123-129,228,235-237,274-283,465-496;
src/instagram/oauth.ts:138-144,255,262-264,297-306,478-524;
src/twitch/oauth.ts:24-28,48-49,89,125-131,220,297,304-306,343-352,552-596;
src/reddit/oauth.ts:123-130,245,258-260,428-470,477-498,506-533;
src/streaming/manifest.ts:81,199-220; src/streaming/handoff.ts:37-41;
tests: connectors.test.ts:120-148,178,684-808; twitch.test.ts:404-418,597-633,661-848;
reddit.test.ts:635+; instagram.test.ts:870-930; tiktok.test.ts:883-931;
streaming.test.ts:361-380 — application:
packages/webflix-application/src/refresh-provider-metadata.ts:22-34,49-57,92-108,113-135;
src/track-playback-progress.ts:1-10,46-95; src/federated-search.ts:83,98-100,166-171;
src/in-memory-ad-memory-stores.ts:6-11; src/in-memory-retention-stores.ts:5-11;
src/tests/application.test.ts:371-394,939-955;
src/tests/ad-memory.test.ts:618-660 — playback:
packages/playback/src/resolve.ts:17-18,50-56,403-418;
src/controls.ts:309-312,350,420; **tests**/playback.test.ts:466-503 —
local library: packages/local-library/src/ads-stores.ts:29-35;
src/localStore.ts:136-146;
**tests**/{ranker-selection-store,intelligence-stores,transcript-payload-store,ads-stores}.test.ts
(per-profile sections at :137-158, :346-349, :321, :745) — shell + web
host: packages/webflix-shell/src/isolation-flags.ts:48-56,100-123;
src/isolation-flags.test.ts:24-63,92-148; tests/shell.test.tsx:380-420;
apps/web-client/src/App.tsx:290 — desktop substrate:
packages/desktop/src/main/desktopBrowserDataIpc.ts:10-41;
src/main/browserDataManager.ts:30,32-44,45-77,120-176,263-290;
src/main/webflix/isolation-flags.ts (vendored copy);
src/main/webflix/identity-env.ts:24-38; src/main/desktopRuntimeEnv.ts:48-60;
src/main/desktopCommandHandlers.ts:44,141;
scripts/e2e/webflix-smoke.mjs:11-22,229-234 — docs:
docs/adr/0003-youtube-first-per-user-identity.md:9,21,39;
docs/plans/patches/desktop-fixes.patch.md:13-17;
docs/product/requirements-matrix.md:50 (WF-030 row).
