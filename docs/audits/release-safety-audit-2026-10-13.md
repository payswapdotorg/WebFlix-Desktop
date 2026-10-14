# Release-safety audit — WF-034 (P7-AUDIT-RELEASE-1)

- Work ID: P7-AUDIT-RELEASE-1 (Phase-7 wave-3, read-only audit grant)
- Requirement: WF-034 — "Reproducible package identity, signed/verified
  update path and notices" (docs/product/requirements-matrix.md:54;
  acceptance: "Distribution/identity audit and target-platform smoke
  tests"). Identity anchor: WF-001 (requirements-matrix.md:21) — "App
  name, bundle IDs, protocols, updater, data root and telemetry isolated
  from ZCode".
- Owner: D1-lane worker. Base: `7260f79` (origin/main at clone; the
  dispatch named `c35bf86` — the "or later" clause applies, and
  `7260f79` is main after the P7-AUDIT-ISOLATION-1 merge). Tree state:
  UNTOUCHED product code — this document plus the ledger row are the
  only deliverables. Authored 2026-10-14 (filename fixed by the work
  order).
- Method: source-level trace of the packaging identity chain, the
  updater configuration, and the `pnpm bundle:desktop` evidence surface,
  every claim cited as `path:line` at this BASE. NO build was run, NO
  signing key was touched, NO network request was made, NO platform
  claim is fabricated — everything a real target platform would have to
  prove is listed as a gap (§3.5, §5).

## 0. Verdict summary (one line per audited axis)

| Axis                                                                    | Verdict                                                                                                                                                   | Anchor     |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| Build-time installer identity (appId/productName/Linux names/artifacts) | PASS — WebFlix-isolated when `WEBFLIX_IDENTITY=1`, values frozen, guarded, test-pinned                                                                    | §1.2, §1.3 |
| Runtime flavor reachability (`"webflix"` at runtime)                    | FAIL-DRIFT (R1) — flavor normalization erases `webflix`; the WebFlix AUMID branch is unreachable in packaged runs                                         | §1.4       |
| Packaged runtime identity (appName/userData/data root)                  | FAIL-DRIFT (R2) — depends on `process.env.WEBFLIX_IDENTITY`, which nothing sets in packaged boots → ZCode layout (`~/.zcode`)                             | §1.5       |
| Deep-link scheme                                                        | FAIL-DRIFT (R3) — `zcode://` hardcoded at build AND runtime; `webflix://` never registered                                                                | §1.6       |
| Artifact metadata isolation (homepage/author/maintainer/cache names)    | DRIFT (R4) — ZCode strings stamped into WebFlix artifacts (known AUDIT-DESKTOP class, still present)                                                      | §1.7       |
| Updater state for WebFlix today                                         | PASS-as-designed — DISABLED via flavor gating (fail-closed; freeze §6.1 defers the feed); the drift case re-enables it against the ZCode feed (hazard H1) | §2.2       |
| Update integrity (signature/checksum)                                   | PARTIAL — manifest sha512/sha2 checksum-enforced; NO installer-signature verification, NO publisher pinning; NSIS unsigned; mac signing env-gated         | §2.3       |
| Rollback behavior                                                       | NONE in-tree — no previous-version retention; NSIS user-driven; auto-install-on-quit off on Windows; force-update is a kill-switch, not a rollback        | §2.4       |
| Freeze §6.1 "provably inert placeholder" mandate                        | MISSING TEST — the `publish.url` localhost placeholder ships with no inertness pin (the D1 test freeze §6.1 mandates does not exist)                      | §2.5, §4.2 |
| `pnpm bundle:desktop` evidence surface                                  | EXISTS, mechanical, real (asar closure + native policy + size audit) — but no target-platform smokes and no signing proof                                 | §3         |

Reading note: PASS here means "source-verified at this BASE". No
packaged artifact of any platform was produced or inspected in this
audit (§5) — the ledger records the desktop packaging tier as never run
(docs/plans/work-claims.md, DESKTOP-ACCEPTANCE-1 row: "Packaging
tier-6 NOT RUN on this box — renderer production build OOMs in 4GB").

## 1. Packaging identity audit (WF-001: is the packaged app WebFlix-isolated?)

### 1.1 The frozen values and their mirrors

Freeze §6.1 (docs/plans/contract-freeze.md:97) fixes the WebFlix
identity: appId `org.webflix.desktop`, productName `WebFlix`, scheme
`webflix://`, data root `~/.webflix` (dev `~/.webflix-dev`), dev AUMID
`org.webflix.desktop.dev`, Linux packages `webflix-desktop*`, and —
directly relevant to §2 — "updater feed origin: DEFERRED (no Phase-1
releases; the packaged `publish.url` placeholder must be provably inert
— D1 test)".

The values live in two byte-identical mirror modules
(packages/webflix-shell/src/identity.ts and
packages/desktop/src/main/webflix/identity.ts — verified identical via
`cmp`; only the header comment differs), frozen with `Object.freeze`
(identity.ts:41-61), with a coexistence guard `assertWebFlixIdentity`
that rejects the legacy appId/AUMID/`~/.zcode` root/`zcode://` scheme
on any WebFlix surface (identity.ts:140-178), and pinned value-by-value
by 33 tests (packages/webflix-shell/src/identity.test.ts — scheme pin
at :30-31, forbidden-AUMID rejections at :123-131, scheme disjointness
at :154). The desktop build-side switch point additionally carries
`assertWebFlixIdentityNeverLeaksZCode`
(packages/desktop/scripts/desktop-product-identity.mjs:190-200), which
throws on any forbidden ZCode value in a resolved identity and is
asserted by the e2e identity matrix
(packages/desktop/scripts/e2e/webflix-smoke.mjs:248-259).

### 1.2 The build-time switch point (correct, fail-closed)

`desktop-product-identity.mjs` is the single identity switch
(AUDIT-DESKTOP designation). The WebFlix flavor
(desktop-product-identity.mjs:42-59) carries exactly the frozen values,
including the two freeze §6.1 coexistence repairs: a dedicated dev AUMID
`org.webflix.desktop.dev` (never the legacy `cn.aminer.zcode`
production-reuse bug, :55-57) and Linux package names
`webflix-desktop`/`webflix-desktop-dev` (:47-48). Selection is
fail-closed: only the exact spelling `WEBFLIX_IDENTITY=1` enables it,
any other non-empty spelling throws (:93-102), and
`WEBFLIX_IDENTITY=1` + `ZCODE_PREVIEW_IDENTITY=1` together throw
(mutual exclusion, :109-116). Data-root resolution honors the explicit
`WEBFLIX_DATA_ROOT` override for test isolation and otherwise returns
`.webflix` (packaged) / `.webflix-dev` (dev) (:172-183).

### 1.3 What electron-builder actually stamps (PASS, build-time)

With `WEBFLIX_IDENTITY=1` in the build environment, the identity chain
into the installer is WebFlix-isolated:

- `appId: desktopProductIdentity.appId`
  (packages/desktop/electron-builder.config.js:456) →
  `org.webflix.desktop`;
- `productName: desktopProductIdentity.productName` (:482) → `WebFlix`
  (also drives macOS `productFilename`, protocol display name :656, and
  artifact names via `buildDesktopArtifactName` :239-242, used by
  mac :663 / win :695 / linux :699 / pacman :719 — artifacts are named
  `WebFlix-<version>-<platform>-<arch>[_TEST]`);
- Linux `executableName: desktopProductIdentity.linuxExecutableName`
  (:704) → `webflix`; deb/pacman/rpm
  `packageName: desktopProductIdentity.linuxPackageName` (:710, :714,
  :725) → `webflix-desktop` — separate package identity from
  `zcode`/`zcode-preview` per flavor isolation comments (:708-713).

This is the identity chain WF-001's "packaged app/data path have
WebFlix identity" acceptance note refers to, and it is real at build
time. The four drift findings below are what the chain does NOT cover.

### 1.4 DRIFT R1 — the runtime flavor can never be `"webflix"`

The desktop bundles bake `__ZCODE_PRODUCT_FLAVOR__` from the same
switch point (packages/desktop/tsup.config.ts:64-65, :104;
packages/desktop/vite.config.ts:149, :196) — so a WebFlix build CAN
bake the string `"webflix"`. But the runtime constant re-normalizes it:
`normalizeZCodeProductFlavor` accepts ONLY `"production"` or
`"preview"` and falls through everything else to
`zcodeEnv === "production" ? "production" : "preview"`
(packages/shared/src/env.ts:25-34; exported as `ZCODE_PRODUCT_FLAVOR`
:36-39). Consequences, all source-verified:

1. **Windows AUMID**: `app.setAppUserModelId(resolveWindowsAppUserModelIdForFlavor(ZCODE_PRODUCT_FLAVOR, …))`
   (packages/desktop/src/main/index.ts:1983). The resolver's WebFlix
   branch (desktop-product-identity.mjs:150-155) is reachable only when
   flavor === `"webflix"` — which the normalized runtime constant can
   never be. A packaged WebFlix app therefore sets
   `dev.zcode.app` (production-backend build) or
   `dev.zcode.app.preview` (test-backend build) as its AUMID — a
   freeze §6.1 forbidden value on a WebFlix surface, and a taskbar/
   notification collision with a real ZCode install.
2. **Updater enablement** — see §2.2 (hazard H1).
3. **Force-update gate** — runs whenever flavor === `"production"`
   (index.ts:2261), i.e. a WebFlix production-backend build would query
   the ZCode client-configs kill-switch API at startup
   (packages/desktop/src/main/forceUpdateGuard.ts:8-10,
   index.ts:2260-2278).

No test pins this (§4.2 T-2/T-3).

### 1.5 DRIFT R2 — packaged runtime identity depends on an env var nothing sets

The runtime data-root chain is correct ONLY when
`process.env.WEBFLIX_IDENTITY=1` is present in the process:

- `webFlixDataRootName = resolveWebFlixDataRootName(process.env, …)`
  (packages/desktop/src/main/desktopRuntimeEnv.ts:55-57) returns
  `undefined` when the env is unset;
- `runtimeApplicationName` then falls back to `"ZCode"` /
  `"ZCode Preview"` (desktopRuntimeEnv.ts:77-87) — `app.setName` is
  called with it (index.ts:260);
- `runtimeUserDataPath` falls back to
  `join(appData, runtimeApplicationName)` — the ZCode Electron layout
  (desktopRuntimeEnv.ts:95-103), applied via `app.setPath("userData"/…)`
  (index.ts:266-269);
- the services-layer data-root segment returns `".zcode"` when
  `WEBFLIX_IDENTITY` is unset/`"0"` (packages/services/src/paths.ts:52-54)
  — so every services path (workspace, telemetry state, settings)
  resolves under `~/.zcode`;
- the earliest main-process import
  (`import "./desktopEarlyDataBaseDirBootstrap.js"` — index.ts:3) reads
  `~/.zcode/v2/setting.json` unconditionally
  (packages/desktop/src/main/desktopDataBaseDirBootstrap.ts:6-7), and
  the main settings file likewise falls back to `~/.zcode/v2/setting.json`
  (index.ts:534: `webFlixDataRootName ?? ".zcode"`).

Nothing in the packaged boot path sets `WEBFLIX_IDENTITY`: the build
defines bake only `__ZCODE_*__` compile-time constants
(tsup.config.ts:97-113 — no `process.env.WEBFLIX_IDENTITY` injection);
`electron-builder` `extraMetadata` writes `zcodeProductFlavor`
(electron-builder.config.js:461) which no runtime code reads (tree-wide
grep: zero consumers in packages/_/src); the `.env_` files checked into
the repo do not contain it (.env.production is a comment-only file;
.env.example lists ZCode endpoints only); the dev harness
(packages/desktop/scripts/dev.mjs:125) and the e2e smoke
(webflix-smoke.mjs:143-151) set it explicitly — which is exactly why
the smoke passes while the packaged path drifts.

Verdict: the e2e smoke proves the DEV identity chain (fresh
`~/.webflix-dev`, no `~/.zcode`, frozen matrix — webflix-smoke.mjs:12,
:210-215, :248-259). The PACKAGED chain is untested and, per the source
above, a packaged WebFlix app booted today would run named "ZCode"
against `~/.zcode` and `appData/ZCode` — directly violating freeze
§6.1/§6.8 coexistence (docs/plans/contract-freeze.md:97, :104:
"WebFlix dev NEVER writes `~/.zcode`"; the packaged case is the same
isolation promise one tier up). This is the same
declared-but-unwired-at-packaged-runtime family as the isolation
audit's `webflixProductSurface` finding
(docs/audits/account-isolation-audit-2026-10-13.md §3.4). Routed to
TL2 as the release-blocking finding: either the build must bake the
identity selection (a define the packaged main reads), or the packaged
boot must derive it from the installer-stamped flavor — that design
choice is TL2's, not this audit's.

### 1.6 DRIFT R3 — the deep-link scheme is `zcode://`, not `webflix://`

- Build time: the electron-builder protocol registration hardcodes
  `schemes: ["zcode"]` (electron-builder.config.js:652-658) — only the
  display name follows the product identity (:656). A WebFlix installer
  registers itself as a `zcode://` handler on every platform
  (macOS CFBundleURLTypes, Windows registry, Linux desktop file).
- Runtime: `registerDeepLinkProtocol` hardcodes
  `const scheme = "zcode"` and calls
  `app.setAsDefaultProtocolClient(scheme)`
  (packages/desktop/src/main/desktopOAuthDeepLink.ts:405-431), with a
  Linux AppImage xdg registration path (:433-439).

`webflix://` is never registered anywhere (tree-wide grep: the string
appears only in the identity modules, their tests, and the freeze). The
WebFlix scheme value exists and is test-pinned
(identity.ts:46-47; identity.test.ts:30-31) but unwired — the mirror
image of R1. Consequences for release: a WebFlix install competes with
a real ZCode install for `zcode://` handler ownership ("最后注册者成为
默认 handler" — electron-builder.config.js:654-655 comment says exactly
this), and the P7-STREAM-HANDOFF-1 deep-link surfaces inherit the wrong
scheme. No test pins scheme registration (§4.2 T-6).

### 1.7 DRIFT R4 — ZCode metadata stamped into artifacts

Beyond identity proper, these ZCode strings ship inside WebFlix
artifacts (all pre-existing, AUDIT-DESKTOP §2 flagged the class):

- `extraMetadata`: `homepage: "https://zcode.z.ai"`, author
  `ZCode <dev@zcode.z.ai>` (electron-builder.config.js:459-467) —
  deb/rpm/fpm metadata validation requires these fields (:457-458
  comment), so the drift is load-bearing for Linux packaging;
- deb maintainer `ZCode <dev@zcode.z.ai>` (:706);
- the Windows install manifest filename `.zcode-install-manifest`
  (:170);
- the dev updater cache dir `zcode-dev-updater`
  (packages/desktop/dev-app-update.yml:6).

Display-level, not identity-level — but they are exactly what a
"reproducible package identity" (WF-034) audit must record as drift
against WF-001.

### 1.8 Signing config inventory (no keys handled — non-goal honored)

- macOS: signing is opt-in via `ZCODE_ENABLE_MAC_SIGN=1` AND a
  `APPLE_SIGNING_IDENTITY`/`CSC_NAME` identity
  (electron-builder.config.js:82-86, :673); Preview + sign-requested +
  no identity throws before producing an unsigned artifact (:214-222) —
  a good fail-closed pattern; builder-side notarization is explicitly
  off (`notarize: false`, :677) in favor of a two-stage pipeline whose
  pre-sign/staple stages live outside this repo's configs (comments
  :674-691 — CI-side, unverified here, §5); `hardenedRuntime` only when
  signing (:678).
- Windows: the `win` block configures NSIS only (:693-696) — no
  certificateFile/signtool configuration exists; NSIS installers are
  unsigned by construction today.
- Linux: no signing configuration (AppImage/deb/rpm/pacman all
  unsigned; pacman dependency list :159-168, :712-720 is correctness,
  not authenticity).

This audit touched no signing keys and makes no signed-build claims
(work-order non-goal). The release-evidence consequences are in §3.5.

### 1.9 Per-surface verdict table

| Surface                                   | Source of truth                                               | WebFlix value when `WEBFLIX_IDENTITY=1`          | Verdict                      |
| ----------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------ | ---------------------------- |
| electron-builder appId                    | electron-builder.config.js:456                                | `org.webflix.desktop`                            | PASS (build-time)            |
| productName / artifact names              | :482, :239-242                                                | `WebFlix`, `WebFlix-<ver>-…`                     | PASS (build-time)            |
| Linux executable/package names            | :704, :710, :714, :725                                        | `webflix`, `webflix-desktop*`                    | PASS (build-time)            |
| Frozen values + coexistence guard         | identity.ts (both mirrors), identity.test.ts (33 tests)       | freeze §6.1 exact                                | PASS (value-level, tested)   |
| Windows AUMID in packaged run             | index.ts:1983 via env.ts:25-34                                | `dev.zcode.app[.preview]` (flavor normalization) | FAIL-DRIFT (R1)              |
| appName / userData / data root (packaged) | desktopRuntimeEnv.ts:55-103, paths.ts:52-54, index.ts:260-269 | `"ZCode"`, `appData/ZCode`, `~/.zcode`           | FAIL-DRIFT (R2)              |
| Deep-link scheme (build + runtime)        | electron-builder.config.js:657, desktopOAuthDeepLink.ts:405   | `zcode://` registered; `webflix://` never        | FAIL-DRIFT (R3)              |
| Artifact metadata (homepage/author/etc.)  | :459-467, :706, :170, dev-app-update.yml:6                    | ZCode strings                                    | DRIFT (R4)                   |
| Updater feed                              | §2 below                                                      | disabled (compliant) / ZCode feed (drift case)   | PASS-as-designed + HAZARD H1 |

## 2. Update-path audit

### 2.1 The feed chain (when the updater is enabled)

The updater never uses the electron-builder `publish` config at
runtime. It installs a custom provider:

- `updater.setFeedURL({ provider: "custom", updateProvider:
ManifestUpdateProvider, endpointOrigin: DEFAULT_ZCODE_ENDPOINT_ORIGIN,
… , resolveEndpointOrigin: options.resolveEndpointOrigin ??
(() => resolveRuntimeZCodeEndpointOrigin(process.env)) })`
  (packages/desktop/src/main/autoUpdater.ts:809-822);
- the provider GETs a YAML manifest at
  `{origin}/api/v1/releases/electron/manifest?platform=<plat>&channel=<1|3>[&device_mid=…]`
  with `X-Platform`/`X-Release-Channel`/`X-Device-Mid` headers
  (packages/desktop/src/main/manifestUpdateProvider.ts:22, :77-93,
  :218-223);
- the origin resolves from `ZCODE_BASE_URL` /
  `ZCODE_ENDPOINT_ORIGIN` runtime env, default
  `https://zcode.z.ai` (packages/shared/src/zcodeEndpoint.ts:3,
  :142-152) — there is NO WebFlix endpoint override anywhere in the
  tree (tree-wide grep: no `WEBFLIX_ENDPOINT` exists);
- download behavior: `autoDownload = false` (autoUpdater.ts:1588 — the
  main process decides, comparing remote vs already-ready versions),
  `autoInstallOnAppQuit = process.platform !== "win32"` (:1592 —
  Windows requires an explicit user action), differential downloads
  restricted to single-range (`useMultipleRangeRequest: false` both in
  the publish config electron-builder.config.js:764 and the provider
  override manifestUpdateProvider.ts:201-203);
- construction is lazy + guarded + once (the vendored
  webflix/updater-guard.ts:98-125): a dev boot with the placeholder
  version `0.0` never constructs the platform updater
  (validateAppVersion :57-69 rejects non-semver), fixing the
  AUDIT-DESKTOP finding-7 eager-construction crash; pinned by 20 tests
  (packages/webflix-shell/src/updater-guard.test.ts) and the e2e boot
  assertion (webflix-smoke.mjs:219-228).

### 2.2 The WebFlix state today: DISABLED — and the drift hazard H1

`initAutoUpdater({ enabled: ZCODE_PRODUCT_FLAVOR === "production", … })`
(index.ts:2017-2018). Because of R1 (§1.4), the flavor is
`"production"` exactly when the build backend was production —
regardless of WebFlix identity. So:

- **Test-backend WebFlix build** (the current e2e/smoke configuration,
  `ZCODE_ENV=test`): flavor normalizes to `"preview"` → updater
  DISABLED, manual checks fail-closed inside the module
  (autoUpdater.ts:99-102, :1540-1548) → **the compliant state**.
  Freeze §6.1 defers the WebFlix feed origin ("no Phase-1 releases");
  a disabled updater is the only state that can honestly satisfy that
  deferral today, and the smoke pins it
  (webflix-smoke.mjs:219-226 accepts "disabled for this desktop
  product flavor" OR guard-skip).
- **HAZARD H1 — production-backend WebFlix build**: flavor normalizes
  to `"production"` → updater ENABLED, feed = the ZCode manifest API on
  `zcode.z.ai` serving ZCode installers, updater compares versions
  against a WebFlix-named package (`WebFlix-<version>-…` artifact,
  §1.3) and, on an offer, would download and run a ZCode installer over
  a WebFlix install — cross-product update contamination, plus the
  force-update gate (§1.4) would consult the ZCode kill-switch API. The
  updater code has no product guard: nothing in
  applyManifestUpdateProvider or the provider checks the desktop
  identity (autoUpdater.ts:800-828,
  manifestUpdateProvider.ts:181-259 — `desktopProductIdentity` is not
  imported there at all).

H1 is a structural hazard of the current tree, not an observed
incident: no WebFlix package has ever been built (ledger,
DESKTOP-ACCEPTANCE-1 row: packaging tier never run), and the only
packaged flavors this updater has ever served are ZCode's own. It is
recorded here because WF-034's core question is exactly "what happens
when this app updates itself".

### 2.3 Integrity: checksum-enforced, not signature-verified

- The provider REQUIRES a checksum per file: a manifest entry without
  `sha512` and without `sha2` throws before any download
  (manifestUpdateProvider.ts:150-153); an empty file list for the
  running Linux package format throws (:141-149) — no cross-format
  updates.
- electron-updater 6.8.3 (packages/desktop/package.json dependencies)
  verifies the downloaded artifact hash against the manifest checksum
  (library behavior, config-visible here only through the checksum
  requirement above — not runtime-observed in this audit, §5).
- There is NO installer-signature verification and NO publisher-name
  pinning anywhere in the desktop config (`verifyUpdateCodeSignature`
  is not configured; NSIS builds are unsigned §1.8). The trust root is
  the feed: a compromised or mis-scoped feed response is constrained
  only by TLS to the origin and by the manifest's own checksums
  (which the same feed provides). `allowDowngrade` is not set
  (electron-updater default: no downgrades).
- Notices: post-update release notes are localized, persisted,
  stale-version-discarded and delivered once per version
  (autoUpdater.ts:854-897, :905+; the "notices" half of WF-034's
  wording) — implemented for the ZCode feed's note schema; unverified
  against any WebFlix feed (none exists).

### 2.4 Rollback behavior: NONE in-tree

- No previous-version retention, no automatic rollback, no
  "keep-last-known-good" mechanism exists anywhere in the desktop
  source (tree-wide survey of the updater modules —
  autoUpdater.ts/manifestUpdateProvider.ts/forceUpdateGuard.ts/
  forceUpdatePrompt.ts contain no rollback path).
- What exists instead: the install is user-driven on Windows
  (`autoInstallOnAppQuit = false` on win32, autoUpdater.ts:1592; NSIS
  `oneClick: false` + changeable install dir,
  electron-builder.config.js:750-757), the quit-and-install path
  prepares child processes before the installer takes over
  (index.ts:2019-2025; autoUpdater.ts:441+ with an in-flight guard), a
  failed/corrupted download is discarded by the checksum check (§2.3),
  and the force-update gate can REFUSE to start an old client
  (index.ts:2260-2278) — a kill-switch, not a rollback.
- If an installed update is broken, the recovery story is "reinstall
  the previous artifact manually" — the release evidence template (§3)
  therefore requires retaining the previous artifact's hash, since
  nothing in the product provides it.

### 2.5 The placeholder feed and the unmet freeze mandate

electron-builder requires a publish config to emit updater metadata;
the repo ships `provider: generic, url: http://localhost:8081` as a
deliberate placeholder (electron-builder.config.js:759-768 with the
rationale comment, and dev-app-update.yml:1-6 for dev auto-update
experiments). At runtime the custom provider overrides it (§2.1), so
the placeholder is inert BY CONSTRUCTION in the current wiring — but
freeze §6.1 explicitly mandates this be PROVEN: "the packaged
`publish.url` placeholder must be provably inert — D1 test"
(contract-freeze.md:97; AUDIT-DESKTOP finding :153 asked for the same
test: "no HTTP request to the placeholder URL in any state"). No such
test exists (§4.2 T-4). Until it does, "provably inert" is a claim of
this audit's source-reading only.

### 2.6 Telemetry identity on update checks

When enabled, every manifest request transmits a stable device
identifier (`device_mid` param + `X-Device-Mid` header,
manifestUpdateProvider.ts:88-90, :222) plus platform and channel to the
feed origin. Under H1 (a production-backend WebFlix build) that would
send WebFlix device identifiers to `zcode.z.ai` — a WF-001
telemetry-isolation concern in the update path, recorded with H1.

## 3. Release evidence template (reproducible run checklist)

Everything below is the surface AS IT EXISTS at this BASE. No step was
executed in this audit (read-only; §5) — commands and expected outputs
are cited from the scripts' own code.

### 3.1 Pre-flight (any box; all six gates worker-runnable)

```text
corepack pnpm install --frozen-lockfile
# expect: exit 0 ("Done" — hoisted linker per .npmrc node-linker=hoisted)

corepack pnpm exec tsc -b --force \
  packages/webflix-contracts packages/webflix-domain \
  packages/webflix-application packages/local-library packages/webflix-shell
corepack pnpm exec tsc -b --force \
  packages/catalog packages/connectors packages/playback
# expect: both exit 0 (the "both groups" gate)

corepack pnpm test:unit
# expect at this BASE: 63 files, 1513/1513 passed (verified in this audit's session, §6)

corepack pnpm lint
# expect: 69 warnings, 0 errors (recorded baseline; zero NEW is the gate)

corepack pnpm fmt:check
# expect: "All matched files use the correct format."

corepack pnpm architecture:check
# expect: violations: 0 / baseline: 0 / new: 0
```

### 3.2 The bundle run (`pnpm bundle:desktop` — the exact surface)

```text
WEBFLIX_IDENTITY=1 corepack pnpm bundle:desktop -- --os <mac|win|linux> --arch <x64|arm64>
# dry-run first (prints the exact electron-builder invocation, exits 0):
WEBFLIX_IDENTITY=1 corepack pnpm bundle:desktop -- --dry-run
```

What one run executes and mechanically proves
(packages/desktop/scripts/bundle.mjs:704-754):

1. `pnpm prepare:runtime-assets` then `pnpm build` (:730-736) —
   full desktop build incl. the tsup flavor bake (tsup.config.ts:64-104
   — verify the `[tsup] ZCODE_PRODUCT_FLAVOR=webflix` log line appears
   when `WEBFLIX_IDENTITY=1`; it is the build-time identity receipt);
2. `electron-builder --config electron-builder.config.js <os> <arch>`
   with retry (:738-740, :476+), whose hooks additionally enforce:
   hoisted runtime-module injection into app.asar
   (electron-builder.config.js:344-410), packaged sourcemap-reference
   stripping (:412-430), native cross-platform policy
   (:432-443 — throws on out-of-target native resources), node-pty
   target prebuild presence (:445-452), Windows install manifest
   (:172-192), NSIS section patch + restore (:505-534);
3. `bundle:verify-runtime-dependencies` (:742-744, :641-702) — a SECOND
   asar pass re-verifying the runtime-module closure and native policy
   on the final artifact (belt-and-suspenders against hook drift);
4. `bundle:audit-bundle-size` (:746-753) — artifact size against the
   budget table (packages/desktop/scripts/audit-bundle-size.mjs).

With `WEBFLIX_IDENTITY=1` the emitted artifacts carry the build-time
WebFlix identity chain (§1.3). The `[bundle]`/`[ci][timer]` logs plus
the two asar verification stages are the reproducibility evidence a
release record should attach verbatim.

### 3.3 Artifact evidence (hashes and names)

```text
sha256sum packages/desktop/dist/WebFlix-<version>-<platform>-<arch>*.*
# record every artifact hash + the root package.json version (3.14.3 at this BASE)
# in the release record; also record `git rev-parse HEAD` (reproducibility anchor)
```

Previous-artifact hashes must be retained by the release process
itself: the product has no rollback (§2.4), so the previous artifact is
the only recovery path and its hash is the only integrity proof for it.

### 3.4 Post-install smokes that exist today

- `pnpm --filter @zcode/desktop run test:e2e`
  (packages/desktop/scripts/e2e/webflix-smoke.mjs; requires DISPLAY /
  Xvfb): dev-boot tier — launch, renderer dom-ready, userData
  `~/.webflix-dev` with no `~/.zcode`, updater surface absent, frozen
  identity matrix, clean shutdown (11 assertions, :9-22, :210-259).
- `bash scripts/doctor-macos-release-app.sh /Applications/WebFlix.app`
  (scripts/doctor-macos-release-app.sh:1-50): `codesign --verify
--deep --strict` + `spctl -a -vv -t exec` — meaningful ONLY for a
  signed build (§1.8; on an unsigned build these correctly fail).
- CLI-tier references (NOT desktop, recorded to prevent
  mis-citation): `scripts/deterministic-tar-archive.mjs` and
  `scripts/zcode-distribution-smoke.mjs` (TUI/web CLI archive smokes)
  are the zcode-cli release surface, not the Electron app's.

### 3.5 What this surface CANNOT yet prove (the honest gap list)

A target-platform release run must additionally prove — none of which
any current command or test does:

1. **Packaged runtime identity** (R1/R2): launch the INSTALLED app and
   assert appName "WebFlix", userData `~/.webflix`, no `~/.zcode`
   access, Windows AUMID `org.webflix.desktop`. Per §1.4/§1.5 this
   would FAIL today — the gap is the finding.
2. **Scheme registration** (R3): `webflix://` opens the installed app;
   the app does NOT claim `zcode://`.
3. **Coexistence**: a WebFlix install beside a real ZCode install —
   separate userData, AUMIDs, Linux package names, no handler
   hijacking (freeze §6.1 coexistence; AUDIT-DESKTOP asked for this
   test; nothing implements it).
4. **Updater end-to-end**: against a real WebFlix feed — offer,
   checksum-verified download, install, release-notes notice,
   downgrade refusal, and the no-rollback recovery procedure. The feed
   itself is freeze-§6.1-DEFERRED, so this is blocked on a TL2 feed
   decision, not on test code alone.
5. **Placeholder inertness** (§2.5): packaged app in every updater
   state makes no request to `http://localhost:8081`.
6. **Signed-build verification**: macOS codesign/notarization staple
   and (if ever configured) Windows signature — no signing config
   exists for win; mac is env-gated (§1.8); no keys were handled here.
7. **Signing-key handling itself** — out of scope for this audit per
   the work order and unproven by anything in-tree.

### 3.6 Known environment limits (recorded, not speculated)

The desktop packaging tier has never completed on record: the
DESKTOP-ACCEPTANCE-1 ledger row states "Packaging tier-6 NOT RUN on
this box — renderer production build OOMs in 4GB (environment class
recorded at baseline; needs a CI-class machine)". Any first real
release run must happen on a CI-class machine and will be the first
packaging evidence of any kind for this fork.

## 4. Test-coverage map

### 4.1 COVERED (the pins that exist)

- Identity values, freeze §6.1 exact, forbidden-ZCode rejection, scheme
  disjointness — packages/webflix-shell/src/identity.test.ts (33 tests;
  scheme :30-31, AUMID rejection :123-131, disjoint :154).
- Updater lazy/guarded/once construction + strict semver validation —
  packages/webflix-shell/src/updater-guard.test.ts (20 tests).
- Isolation-flag fail-closed defaults —
  packages/webflix-shell/src/isolation-flags.test.ts (18 tests).
- Dev-boot e2e tier (launch/identity/updater-absence/isolation/shutdown)
  — packages/desktop/scripts/e2e/webflix-smoke.mjs (11 assertions;
  updater :219-228 accepts flavor-disabled OR guard-skip, identity
  matrix :248-259 asserts the build-time values incl.
  assertWebFlixIdentityNeverLeaksZCode).
- Vitest scope: the root battery includes exactly
  `packages/{webflix-*,local-library,catalog,connectors,playback}`
  (vitest.config.ts:10) — note for release evidence: packages/desktop
  has NO unit tests in the battery; its only automated evidence is the
  e2e smoke tier.

### 4.2 NOT COVERED — the exact missing test cases (follow-up payload; NOT written in this row)

- **T-1 packaged-runtime identity**: desktopRuntimeEnv under
  `isPackaged=true` with `WEBFLIX_IDENTITY` unset must resolve
  WebFlix identity — would fail today (R2, §1.5).
- **T-2 flavor normalization**: `normalizeZCodeProductFlavor("webflix", …)`
  must preserve the WebFlix flavor — would fail today (env.ts:25-34,
  R1 §1.4).
- **T-3 packaged AUMID**: `resolveWindowsAppUserModelIdForFlavor(ZCODE_PRODUCT_FLAVOR, {isPackaged:true})`
  === `org.webflix.desktop` under WebFlix identity — would fail today
  (index.ts:1983 via env.ts normalization).
- **T-4 freeze §6.1-mandated placeholder-inertness**: packaged updater
  in every state makes no request to `http://localhost:8081`
  (contract-freeze.md:97 "provably inert — D1 test";
  AUDIT-DESKTOP :153) — absent entirely.
- **T-5 ManifestUpdateProvider unit battery**: manifest URL
  construction (platform/channel/device_mid), missing-checksum
  rejection (manifestUpdateProvider.ts:150-153), tampered-checksum
  rejection, cross-format Linux rejection (:141-149), channel
  staleness propagation — zero provider tests exist (AUDIT-DESKTOP
  :130 recommended the tampered/missing-checksum cases; still open).
- **T-6 scheme registration**: WebFlix package registers `webflix://`
  and does not claim `zcode://` (R3 §1.6) — absent.
- **T-7 WebFlix/ZCode coexistence**: side-by-side installs keep
  separate userData/AUMID/package names (freeze §6.1; AUDIT-DESKTOP
  :131) — absent.
- **T-8 updater-enabled product guard**: the updater must not enable
  against a foreign-product feed for a WebFlix build (H1 §2.2) —
  absent; today only the disabled path is pinned (T-4-adjacent but
  distinct: this is the contamination guard, that is the placeholder
  probe).
- **T-9 identity-env bootstrap ordering**: `applyWebFlixDataRootEnv`
  idempotency and its precedence over services path resolution
  (identity-env.ts:24-38) — no direct test.
- **T-10 update notices + recovery drill**: release-notes
  once-per-version delivery and the manual-rollback recovery procedure
  (§2.4) — blocked on a real feed (T-4/T-8 prerequisite for e2e; the
  unit-level notice logic in autoUpdater.ts:854-905 is also untested —
  desktop has no unit battery, §4.1 note).

## 5. Honest unknowns and limits of this audit

- **No build, no package, no install was run.** Read-only grant + the
  recorded 4GB OOM environment class (§3.6). Every packaging claim is
  source-cited; zero platform behavior was observed.
- **Linux-only sandbox**: macOS/Windows behaviors (AUMID effect,
  NSIS/registry, codesign/spctl, notarization) are cited from source
  and comments, never executed.
- **electron-updater 6.8.3 internals** (blockmap differential, cache
  layout, hash verification flow) are described from the library's
  public contract and this repo's config; not runtime-observed.
- **The macOS two-stage signing/notarization pipeline** lives in CI
  outside this repo (electron-builder.config.js:674-691 comments);
  unverifiable here.
- **No WebFlix feed exists** (freeze §6.1 DEFERRED) — the entire
  enabled-updater path is unavoidably unproven end-to-end; this audit
  characterizes it, it does not validate it.
- **BASE discrepancy, recorded**: the dispatch named main at `c35bf86`;
  origin/main was `7260f79` at clone (the P7-AUDIT-ISOLATION-1 merge).
  The work order's "or later" clause applies; `7260f79` is recorded as
  BASE. The isolation merge's own subject confirms the tree is the
  wave-3 merged state plus docs only.
- **R1/R2 remedies are design decisions** (bake-time define vs
  installer-derived flavor vs boot-time detection) — this audit states
  the drift and the evidence; choosing the fix belongs to TL2 and a
  follow-up order, not to a read-only audit.
- Gates in §6 were run on the UNTOUCHED tree at BASE; the audit
  document and ledger row are the only changes this branch introduces.

## 6. Gates actually run in this session (untouched tree, BASE 7260f79)

- `tsc -b --force` group 1 (contracts/domain/application/local-library/
  webflix-shell): **exit 0**.
- `tsc -b --force` group 2 (catalog/connectors/playback): **exit 0**.
- `pnpm test:unit`: **63 files, 1513/1513 passed** (23.4s).
- `pnpm lint`: **69 warnings / 0 errors** (recorded baseline; zero new
  — tree untouched).
- `pnpm fmt:check`: **PASS** ("All matched files use the correct
  format." — run BEFORE this document existed; the committed document
  is oxfmt-normalized in this branch).
- `pnpm architecture:check`: **violations 0 / baseline 0 / new 0**.
- Not run (and why): `pnpm bundle:desktop` and every target-platform
  smoke — read-only audit + §3.6 environment class; `test:e2e` —
  requires a DISPLAY/Xvfb desktop session, and its dev-boot tier is
  already recorded in the ledger from DESKTOP-ACCEPTANCE-1 (11/11); no
  claim is made from it here.

## 7. Source index (every path cited, at BASE 7260f79)

- docs/plans/contract-freeze.md — §6.1 identity values + updater-feed
  deferral + placeholder mandate (:97), §6.8 coexistence (:104)
- docs/plans/audits/AUDIT-DESKTOP.md — §2 identity inventory (:21-45),
  test recommendations (:130-131, :153), dev-launch finding (:117)
- docs/product/requirements-matrix.md — WF-001 (:21), WF-034 (:54)
- docs/audits/account-isolation-audit-2026-10-13.md — §3.4
  declared-but-unwired precedent
- docs/plans/work-claims.md — DESKTOP-ACCEPTANCE-1 row (packaging tier
  never run; e2e 11/11), P7-AUDIT-ISOLATION-1 row (merge state)
- packages/desktop/scripts/desktop-product-identity.mjs — WebFlix
  flavor :42-59, fail-closed selection :93-124, AUMID :149-164,
  data-root :172-183, leak guard :190-200
- packages/desktop/electron-builder.config.js — appId :456,
  extraMetadata :459-467, productName :482, protocols :652-659, mac
  signing :660-692, win :693-696, linux :697-731, dmg/nsis :732-757,
  publish placeholder :758-768, artifact naming :239-242, install
  manifest :170, afterPack hooks :505-570
- packages/desktop/dev-app-update.yml — placeholder feed + cache name
- packages/desktop/tsup.config.ts — flavor bake :61-65, defines
  :97-113; packages/desktop/vite.config.ts :149, :196
- packages/shared/src/env.ts — flavor normalization :25-39
- packages/shared/src/zcodeEndpoint.ts — default origin :3, resolution
  :142-152
- packages/desktop/src/main/index.ts — early bootstrap import :3,
  setName/setPath :260-269, AUMID :1978-1984, updater init :2014-2034,
  force-update gate :2253-2278, settings fallback :534
- packages/desktop/src/main/desktopRuntimeEnv.ts — data-root/name/
  userData resolution :43-106
- packages/desktop/src/main/webflix/identity-env.ts — idempotent
  data-root env :21-38
- packages/desktop/src/main/webflix/identity.ts (mirror of
  packages/webflix-shell/src/identity.ts) — frozen values :41-61,
  guard :140-178
- packages/desktop/src/main/desktopDataBaseDirBootstrap.ts —
  unconditional `~/.zcode` read :6-7, :39-46
- packages/desktop/src/main/desktopOAuthDeepLink.ts — scheme :405-431,
  Linux registration :433-439
- packages/desktop/src/main/autoUpdater.ts — disabled-flag :99-102,
  feed application :800-828, init :1539-1594 (autoDownload :1588,
  autoInstallOnAppQuit :1592), quitAndInstall :441+
- packages/desktop/src/main/manifestUpdateProvider.ts — manifest path
  :22, URL :77-93, format/checksum enforcement :141-153, provider
  :181-259, headers :218-223, single-range :201-203
- packages/desktop/src/main/webflix/updater-guard.ts — lazy/guarded/
  once :49-125
- packages/desktop/src/main/forceUpdateGuard.ts — client-configs gate
- packages/services/src/paths.ts — data-root segment :47-64
- packages/desktop/scripts/bundle.mjs — main flow :704-754, asar
  verification :641-702
- packages/desktop/scripts/e2e/webflix-smoke.mjs — scope :9-26, env
  :143-151, assertions :210-259
- packages/webflix-shell/src/identity.test.ts (33 tests),
  updater-guard.test.ts (20 tests), isolation-flags.test.ts (18 tests)
- scripts/doctor-macos-release-app.sh — codesign/spctl surface
- scripts/deterministic-tar-archive.mjs, scripts/zcode-distribution-smoke.mjs
  — CLI-tier (non-desktop) references
- vitest.config.ts — battery scope :10; packages/desktop/package.json —
  electron-updater ^6.8.3, electron 41.0.3, bundle/e2e scripts
