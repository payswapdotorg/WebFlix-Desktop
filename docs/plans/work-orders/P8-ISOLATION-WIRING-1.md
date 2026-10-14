# Work order — P8-ISOLATION-WIRING-1 (Phase-8 successor): isolation-audit follow-up — seam tests + disconnect propagation + product-surface enforcement

## Identity

- Work ID: P8-ISOLATION-WIRING-1
- Requirement IDs: successor payload to WF-030 (account isolation — the audit-named follow-up; NOT a matrix row)
- Owner: D2-lane worker
- Branch: p8-isolation-wiring-1
- Base SHA: main at 79e8b5b (or later; clone main; record HEAD as BASE)
- Design authority: docs/plans/phase8-successor-payload.md + docs/audits/account-isolation-audit-2026-10-13.md §2.3/§3.4/§4.2 (path:line-cited evidence — read BOTH first)

## Precondition (hard)

main contains docs/audits/account-isolation-audit-2026-10-13.md AND
docs/plans/phase8-successor-payload.md. If either is absent, STOP and
report the blocker.

## Objective

Close the isolation audit's orderable follow-up payload. After this
order: cross-account and cross-profile invisibility at the OAuth seam
is TEST-PINNED, a disconnect propagates to the per-provider embedded
partition (scoped clear wired + pinned), and the `webflixProductSurface`
flag (default OFF) actually GATES the ZCode commercial surfaces it
declares — with unreachable-when-off tests — instead of being a
declared-but-unwired policy entry.

Concretely, per the audit's §4.2 missing-test map (its own numbering):

1. **#1 Cross-account isolation at the OAuth seam** (the core WF-030
   acceptance gap — all three sub-cases):
   a. foreign-account `credentialPort().getToken(providerId, "<B's id>")`
   from session A: pin the intended behavior — resolve-only-own-account
   OR an explicit typed refusal for a foreign id; state which, with the
   contract cited;
   b. account B's disconnect/revoke leaves account A's record AND vault
   entry untouched (the store fake at connectors.test.ts:120-148 can
   express this today);
   c. two YouTube accounts ("local-user-1"/"local-user-2") in ONE store
   in ONE test.
2. **#2 Multi-profile OAuth store discipline**: two profile-scoped store
   sets (the local-library per-profile pattern) at the OAuthAccountStore
   seam; assert cross-profile invisibility of accounts/tokens.
3. **#3 Disconnect → partition/cache propagation (WIRING + test)**: wire
   the scoped clear — a disconnect at the application-layer account
   path calls `clearEmbeddedBrowserData({providerId, accountKey})`
   (browserDataManager.ts:263-290 — exists, per-account form, currently
   called only by the debug IPC at desktopBrowserDataIpc.ts:40 in
   mode form) — through the desktop adapter seam. Test: the
   disconnected account's partition is cleared, OTHER providers'
   partitions survive. If the structural wiring point does not exist
   (audit: no provider webview surface is wired), deliver the minimal
   honest seam (the application→desktop adapter function + test) and
   NAME the remaining blocker in the delivery notes — do NOT invent
   surfaces.
4. **#4 webflixProductSurface enforcement (the §3.4 FINDING)**: the
   policy declares gating of "Coding Plan / PayPal, CUA, Lark,
   SSH/Docker/WSL remotes, force-update" with enforcement sites
   ipc-router.ts/app-menu.ts/deep-links.ts — NONE exist (the policy
   names phantom files). Fix the drift BOTH ways: implement the gating
   at the REAL surface owners in the tree (e.g. the command/menu
   surfaces in packages/desktop/src/main that actually own those
   ZCode surfaces — cite them), default OFF, unreachable-when-off;
   AND realign the policy DATA (isolation-flags.ts:100-123) to name
   the real enforcement sites. Note: the force-update gating is
   ALREADY fail-closed for WebFlix by P8-RELEASE-DRIFT-1's H1 guard
   (updater-product-guard) — cite it, do not duplicate it.
   Unreachable-when-off tests: gated IPC channels unregistered +
   menu entries absent while OFF (the chrome-import analogue,
   webflix-smoke.mjs:229-234 / isolation-flags precedent).
5. **#5 RefreshProviderMetadata fake**: key the application.test.ts
   fake by (provider,account) (currently provider-only, :371-394),
   then pin "refresh as account A must not use account B's credential".

## Non-goals

- NO production OS vault / CredentialPort implementation (audit §1.5 —
  future order; the seam contracts stay as-is).
- NO renderer-boundary preload test (§4.2 #6 — no preload surface
  exists; listed for completeness only).
- NO provider webview surfaces / isolated-website emission (separate
  future work; this order wires the CLEAR side only).
- NO live/packaged-tier claims (fixture-tested only, audit §4.3).
- NO parked-row work; NO matrix edit; NO new frozen identity values.
- NO changes to the P8-RELEASE-DRIFT-1 guard surfaces (cite, don't
  touch).

## Allowed and forbidden paths

- Allowed: packages/connectors/src + tests (the seam tests, the store
  fakes), packages/webflix-application/src + tests (account path,
  RefreshProviderMetadata fake + tests), packages/desktop/src/main
  (browserDataManager.ts consumer wiring, the real surface owners for
  the product-surface gating, webflix/isolation-flags.ts policy-data
  realignment + tests, the desktop adapter for the disconnect clear),
  packages/webflix-shell/\* ONLY if a shell-side pin is needed,
  docs/plans/work-claims.md (ledger row), oxfmt realignment on touched
  files.
- Forbidden: everything else; no churn outside the named surfaces; no
  contract-schema changes (the seams are frozen); no new dependencies.
- Shared-file owner: TL2 (ledger).
- Architecture policy update: none expected; if a new package root
  appears, STOP and report instead.

## Dependencies and parallelism

- Must land first: P8-RELEASE-DRIFT-1 (merged at 29a0e6e; station
  hardening 79e8b5b) — BASE is its descendant.
- Can run concurrently with: nothing in flight.
- Merge order: single order; TL2 reviews + merges.

## Contract and state

- Public interfaces used: OAuthAccountStore / credentialPort seams
  (webflix-contracts), clearEmbeddedBrowserData
  (browserDataManager.ts:263-290), resolveIsolationFlags /
  ISOLATION_FLAG_POLICY (webflix/isolation-flags.ts).
- Public interface changes proposed: the disconnect→scoped-clear
  adapter function (additive); the isolation-flags policy DATA naming
  real sites (data realignment, not new semantics). If #1a requires a
  typed foreign-id refusal, that IS a contract-visible behavior choice
  — cite the contract text and flag it in the delivery notes for TL2
  review instead of silently choosing.
- State owner: n/a (no new stores).
- Events and idempotency: the scoped clear must be idempotent per
  (provider, account) — pin it.

## Behavior and acceptance

- Happy path: two accounts on one store — A reads A's, B disconnects —
  A's record/vault entry untouched, B's partition cleared, other
  providers' partitions survive; profile X cannot see profile Y's
  accounts; product-surface flag OFF — the ZCode commercial surfaces
  unreachable (IPC unregistered, menu absent).
- Empty/no-results: foreign-id getToken resolves nothing (or the typed
  refusal per #1a's pinned choice).
- Requires-auth: n/a. Unsupported/unavailable: n/a.
- ZCode regression path: every existing test passes unchanged; the
  product-surface gating must not affect ZCode-identity builds (the
  surfaces are WebFlix-build-gated — cite how the flavor interacts,
  P8-RELEASE-DRIFT-1's baked flavor is the discriminator).

## Gates (station runs them; worker cites honestly, never blocks)

- npx tsc -b --force both groups — exit 0.
- pnpm test:unit — ALL existing tests pass + the new pins; report exact
  file/test counts.
- pnpm lint — zero NEW warnings beyond the 69 baseline;
  pnpm fmt:check — PASS.
- pnpm architecture:check — 0/0/0.

## Transport (git push delivery — v2 doctrine)

- Commits on branch p8-isolation-wiring-1: code/test commit(s) +
  SEPARATE ledger-row update commit (P8-ISOLATION-WIRING-1 row ->
  delivered in docs/plans/work-claims.md, format per the P8 row).
- DELIVER BY PUSHING YOUR BRANCH TO ORIGIN:
  git push $PUSH_URL p8-isolation-wiring-1:refs/heads/p8-isolation-wiring-1
  ($PUSH_URL is provided VERBATIM in your dispatch directive —
  the token is redacted from this repo file by GitHub push
  protection; use the full URL from the directive as-is).
  If push is rejected, run git pull --rebase origin main once and
  re-push.
- Final reply with VERBATIM ENGLISH markers:
  === P8-ISOLATION-WIRING-1 REPORT BEGIN === (BASE / BRANCH / PUSHED
  <head-sha> / WORK SUMMARY: each numbered item #1a/#1b/#1c/#2/#3/#4/#5
  with the files+lines touched and its pinning test / HONEST LIMITS)
  === P8-ISOLATION-WIRING-1 REPORT END ===

Reminder: report numbers must come from the gates you ACTUALLY ran. If
a gate cannot run, say so plainly with the reason — an honest failure
beats a fabricated pass. ENGLISH report markers, verbatim.
Reminder: an honest failure beats a fabricated pass. ENGLISH markers.
