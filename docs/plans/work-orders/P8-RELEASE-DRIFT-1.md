# Work order — P8-RELEASE-DRIFT-1 (Phase-8 successor): release-safety drift fixes R1-R4 + H1 + T-map unit pins

## Identity

- Work ID: P8-RELEASE-DRIFT-1
- Requirement IDs: successor payload to WF-001/WF-034 (NOT a matrix row — the TL3 ruling keeps the matrix closed; this is the audit-named follow-up)
- Owner: D1-lane worker
- Branch: p8-release-drift-1
- Base SHA: main at d6fa375 (or later; clone main; record HEAD as BASE)
- Design authority: docs/plans/phase8-successor-payload.md (TL2 rulings — BINDING; read it FIRST)

## Precondition (hard)

main contains docs/plans/phase8-successor-payload.md AND
docs/audits/release-safety-audit-2026-10-13.md. If either is absent,
STOP and report the blocker.

## Objective

Repair the four release-safety identity drifts and the updater hazard
the WF-034 audit FAILED, and pin them with the audit's own missing-test
map (§4.2). After this order, a packaged WebFlix build resolves WebFlix
identity at runtime WITHOUT any env var, registers `webflix://`, never
claims `zcode://`, stamps WebFlix artifact metadata, and its updater is
fail-closed against every ZCode feed.

Concretely, per the TL2 rulings (phase8-successor-payload.md):

1. **R1 (env.ts flavor)**: `ZCodeProductFlavor` gains `"webflix"`;
   `normalizeZCodeProductFlavor` preserves a baked `"webflix"` verbatim;
   unknown/absent keep today's zcodeEnv fallback. Every consumer
   (index.ts:1983/2018/2261, desktopTray.ts, desktopCommandHandlers.ts,
   desktopApplicationMenu.ts, desktopRuntimeEnv.ts) handles the
   `"webflix"` member explicitly — no silent fallthrough into ZCode
   branches, no boot throw.
2. **R2 (packaged identity default)**: runtime flavor `"webflix"` +
   `isElectronAppPackaged()` → WebFlix identity ON by default
   (`~/.webflix`); `WEBFLIX_IDENTITY` env stays explicit override
   (1/0, invalid throws — current semantics); dev runtime keeps
   default-off opt-in (`~/.webflix-dev`). Thread the baked flavor into
   `resolveWebFlixDataRootName`/`isWebFlixIdentityRequested` as an
   option — keep desktop-product-identity.mjs dual-context (build tool
   AND bundled import), no module fork.
3. **R3 (deep-link scheme)**: `registerDeepLinkProtocol`
   (desktopOAuthDeepLink.ts:405-431) and electron-builder.config.js
   `schemes` (":652-658") select `webflix://` under WebFlix identity and
   never claim `zcode://` on that surface; scheme values sourced from
   the identity module (identity.ts:46-47), no new literals.
4. **R4 (artifact metadata)**: extraMetadata homepage/author
   (":459-467"), deb maintainer (":706"), Windows install-manifest
   filename (":170"), dev updater cache dir
   (packages/desktop/dev-app-update.yml) switch by product identity.
   The freeze names no homepage/author/maintainer values — propose
   identity-consistent values citing freeze §6.1, and flag EACH
   proposal in the delivery notes for TL2 review. deb/rpm non-empty
   field requirement must stay satisfied.
5. **H1 (updater fail-closed)**: `initAutoUpdater` stays disabled for
   flavor ≠ "production"; ADD a product guard inside the updater chain
   (init or manifestUpdateProvider) that REFUSES enablement when the
   runtime product identity is WebFlix, logged with a reason. The
   force-update gate (index.ts:2261) never fires for `"webflix"`. NO
   feed is created (freeze §6.1 deferral stands; placeholder stays
   provably inert).

## Test pins (the audit §4.2 map — the acceptance)

Unit-testable, ALL required in this order:

- T-1 packaged-runtime identity (R2): desktopRuntimeEnv under
  isPackaged=true + baked webflix + WEBFLIX_IDENTITY unset → WebFlix
  identity resolves.
- T-2 flavor normalization (R1): `normalizeZCodeProductFlavor("webflix", …)` preserves it.
- T-3 packaged AUMID (R1): WebFlix packaged →
  `org.webflix.desktop` (never `dev.zcode.app*`).
- T-4 freeze §6.1 placeholder-inertness: packaged updater in every
  state makes NO request to `http://localhost:8081`.
- T-5 ManifestUpdateProvider battery: manifest URL construction
  (platform/channel/device_mid), missing-checksum rejection, tampered-
  checksum rejection, cross-format Linux rejection, channel staleness
  propagation.
- T-6 scheme registration (R3): WebFlix registers `webflix://`, does
  not claim `zcode://` (build-config-level + runtime registration
  unit pins).
- T-8 updater-enabled product guard (H1): updater refuses enablement
  against a foreign-product feed for a WebFlix build.
- T-9 identity-env bootstrap ordering: `applyWebFlixDataRootEnv`
  idempotency + precedence over services path resolution.
- T-7/T-10 UNIT-LEVEL halves only: identity-separation assertions
  (distinct userData/AUMID/package names) and the autoUpdater.ts:854-905
  notice logic. The e2e halves (real installs, real feed) stay
  honestly out of scope — the audit itself blocks them.

## Non-goals

- NO updater feed creation, NO publish config changes beyond the
  identity switch (freeze §6.1 deferral stands).
- NO signing changes, NO key handling.
- NO package/install RUN (the 4GB-OOM class) — packaging changes stay
  source-level, pinned by unit tests; cite, never claim platform runs.
- NO parked-row work (WF-013/014/015/020/031 stay parked).
- NO matrix edit (successor payload is not a matrix row).
- NO new frozen identity values (reuse WEBFLIX_IDENTITY's frozen
  fields; flag proposals in notes).

## Allowed and forbidden paths

- Allowed: packages/shared/src/env.ts (+ its tests),
  packages/desktop/scripts/desktop-product-identity.mjs (+ .d.mts +
  tests), packages/desktop/src/main/{index.ts (the named sites),
  desktopRuntimeEnv.ts, desktopTray.ts, desktopCommandHandlers.ts,
  desktopApplicationMenu.ts, desktopOAuthDeepLink.ts,
  webflix/_}, packages/desktop/electron-builder.config.js,
  packages/desktop/dev-app-update.yml, updater chain files
  (autoUpdater.ts, manifestUpdateProvider.ts + tests),
  packages/webflix-shell/_ ONLY if a guard needs a shell-side pin,
  docs/plans/work-claims.md (ledger row), oxfmt realignment on
  touched files.
- Forbidden: everything else; no churn outside the named surfaces;
  no refactor drives beyond the drift fixes.
- Shared-file owner: TL2 (ledger).
- Architecture policy update: none expected; if a new package root
  appears, STOP and report instead.

## Dependencies and parallelism

- Must land first: none (base is merged main).
- Can run concurrently with: nothing in flight.
- Merge order: single order; TL2 reviews + merges.

## Contract and state

- Public interfaces used: ZCODE_PRODUCT_FLAVOR (shared/env.ts),
  WEBFLIX_IDENTITY (webflix/identity.ts), resolveWebFlixDataRootName /
  isWebFlixIdentityRequested / resolveDesktopProductFlavor /
  resolveWindowsAppUserModelIdForFlavor (desktop-product-identity.mjs).
- Public interface changes proposed: ZCodeProductFlavor union + the
  option-parameter threading per the TL2 rulings — additive, backward
  compatible (defaults preserve current behavior when flavor is not
  webflix).
- State owner: n/a (identity resolution only; no new stores).
- Events and idempotency: applyWebFlixDataRootEnv idempotency pinned
  by T-9.

## Behavior and acceptance

- Happy path: a packaged WebFlix bundle (baked flavor "webflix") boots
  with appName WebFlix, userData ~/.webflix, AUMID
  org.webflix.desktop, scheme webflix://, updater disabled with a
  logged product guard, force-update gate silent — with ZERO env vars
  set.
- ZCode regression path: a ZCode build (no webflix bake) is
  BYTE-IDENTICAL in behavior to today — every existing test passes
  unchanged, no new env requirement, flavor resolves exactly as
  before.
- Dev path: unbundled dev runtime unchanged (default ZCode identity;
  WEBFLIX_IDENTITY=1 opt-in → ~/.webflix-dev).
- Empty/no-results: n/a. Requires-auth: n/a. Unsupported/unavailable:
  updater stays disabled (honest, logged).

## Gates (station runs them; worker cites honestly, never blocks)

- npx tsc -b --force both groups — exit 0.
- pnpm test:unit — ALL existing tests pass + the new T-map pins;
  report exact file/test counts.
- pnpm lint — zero NEW warnings beyond the 69 baseline;
  pnpm fmt:check — PASS.
- pnpm architecture:check — 0/0/0.

## Transport (git push delivery — v2 doctrine)

- Commits on branch p8-release-drift-1: code/test commit(s) + SEPARATE
  ledger-row update commit (P8-RELEASE-DRIFT-1 row -> delivered in
  docs/plans/work-claims.md, format per the P7 rows).
- DELIVER BY PUSHING YOUR BRANCH TO ORIGIN:
  git push $PUSH_URL p8-release-drift-1:refs/heads/p8-release-drift-1
  ($PUSH_URL is provided VERBATIM in your dispatch directive —
  the token is redacted from this repo file by GitHub push
  protection; use the full URL from the directive as-is).
  If push is rejected, run git pull --rebase origin main once and
  re-push.
- Final reply with VERBATIM ENGLISH markers:
  === P8-RELEASE-DRIFT-1 REPORT BEGIN === (BASE / BRANCH / PUSHED
  <head-sha> / WORK SUMMARY: each drift R1-R4 + H1 with the files+lines
  touched and its pinning test / HONEST LIMITS)
  === P8-RELEASE-DRIFT-1 REPORT END ===

Reminder: report numbers must come from the gates you ACTUALLY ran. If
a gate cannot run, say so plainly with the reason — an honest failure
beats a fabricated pass. ENGLISH report markers, verbatim.
Reminder: an honest failure beats a fabricated pass. ENGLISH markers.
