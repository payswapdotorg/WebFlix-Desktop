# Work order — P9-UBUNTU-WEBFLIX-1: ship a downloadable, genuinely WebFlix-branded Ubuntu build

## Outcome

Deliver a real Ubuntu desktop build that the operator can download, launch, and test. The visible product must be **WebFlix**, not ZCode. Packaging the inherited app with only a renamed installer is not completion.

## Baseline facts verified on 2026-10-14

- `origin/main` was observed at `d250be23944c642f40b2d15a62e615a7e4d55e4b`. Each worker MUST fetch the current `origin/main` and record the actual base SHA before branching; do not trust this historical SHA if main moved.
- No `.github/workflows/**` files were present in the observed main tree; the GitHub Actions workflow-runs collection was empty and the Releases collection had no releases/assets.
- Linux targets already exist in `packages/desktop/electron-builder.config.js` (AppImage, deb, rpm, pacman), and the bundler recognizes Linux x64/arm64. This is packaging capability, not proof that a working artifact exists.
- The root package manifest and desktop manifest retain ZCode internal identifiers. More importantly, `packages/desktop/src/renderer/index.html` still has a ZCode title and inherited ZCode startup mark, and `packages/desktop/src/renderer/src/main.tsx` still boots the inherited `@zcode/ui` `Root`. The existing `packages/webflix-shell` has real product components (Home, Search, Library, Accounts, Ad Center, Evaluation, Settings), but it must be wired into the actual desktop product route.
- `packages/desktop/scripts/desktop-product-identity.mjs` and `electron-builder.config.js` already contain a WebFlix identity lane. Reuse and verify them; do not create a competing identity/configuration system. WebFlix's proposed homepage/author/maintainer metadata is not yet operator-approved.

## Source-of-truth order

Read, in order:

1. `docs/architecture/architecture-lock.md`
2. `docs/architecture/data-ownership.md` and `security-boundaries.md`
3. `docs/architecture/provider-policy-matrix.md`
4. `docs/adr/0003-youtube-first-per-user-identity.md`
5. `docs/plans/phase8-successor-payload.md`
6. `docs/plans/work-orders/P8-VAULT-1.md` and the current `docs/plans/work-claims.md`
7. `docs/testing/desktop-acceptance.md`

## Hard dependency and sequencing

- `P8-VAULT-1` is currently recorded as queued. The production per-user credential vault and its isolation guarantees must be merged before the release candidate claims that provider-account connection is production-ready. Do not bypass this dependency with plaintext storage, a shared operator account, cookie reuse, mocked credentials, or an undocumented browser session.
- Workers may begin the disjoint UI/packaging/test-harness work below in parallel immediately, after independently confirming their base SHA and registering their child claim. Do not write files owned by another child claim. Account-connect IPC/preload wiring and the final candidate acceptance wait until P8-VAULT-1 has landed.
- If an actual blocker prevents this sequence, report it in the ledger; do not redefine an unverified state as complete.

## Parallel worker grants

### P9-UI-1 — Worker 1: mount WebFlix as the actual desktop product

Allowed paths: `packages/desktop/src/renderer/**`; `packages/desktop/src/main/desktopWindowChrome.ts` only when required for product window chrome; `packages/desktop/build/webflix-icons/**` (new product-only assets); `packages/webflix-shell/src/components/**` and `packages/webflix-shell/src/theme.ts`. Do not edit the claims ledger, electron-builder config, release workflow, or P8 vault files.

Requirements:

1. Add a real WebFlix renderer root/route selected from the baked product flavor/identity. In WebFlix flavor, mount the existing WebFlix shell and wire it to real available catalog, local-library, playback, account, settings, and connector application ports. Do not leave `@zcode/ui`'s ZCode `Root` as the rendered WebFlix application. In ZCode production/preview flavors, preserve the inherited ZCode root and behavior.
2. Make the whole visible shell WebFlix: product title, startup/empty/loading/error states, navigation, typography/theme, icons, application menu/window chrome, and About/help copy. Create a WebFlix-specific icon set from the real WebFlix brand assets or a clearly distinct new WebFlix mark; no ZCode/Z.ai glyph, splash, title or branded UI element may remain visible in the WebFlix flavor. Do not simply change the window title.
3. Use the existing `packages/webflix-shell/src/components/AppShell.tsx` and related screens where applicable instead of building a disconnected mock UI. Functional minimum: Home, Search, local Library, Accounts and Settings; Ad Center/Evaluation must show truthful not-yet-run/unsupported states where their engine is not wired. Do not invent media, account status, search results, or metrics.
4. Keep the local-media path useful without network credentials. The first external-platform interface remains YouTube-first and uses only the signed-in user's own authorization through a reviewed provider operation. Preserve standard player behaviors/ads and current provider-policy gates; do not implement scraping/private-endpoint/cookie-replay workarounds.
5. After P8-Vault-1 merges, connect account UI through the real main-process vault and explicitly permissioned IPC/preload boundary. Tokens stay in the main-process OS vault; renderer gets only minimal typed status/results. Fail closed when OS secure storage is unavailable.
6. Add/extend component/renderer tests for route selection by baked flavor, product branding, primary navigation, truthful empty/error states, and no WebFlix-to-ZCode identity leakage. Explicitly prove ZCode's renderer path is unchanged.

### P9-LINUX-1 — Worker 2: reproducible Ubuntu packaging and downloadable CI artifact

Allowed paths: `packages/desktop/electron-builder.config.js`; `packages/desktop/scripts/bundle.mjs`; `packages/desktop/scripts/desktop-product-identity.mjs` only for evidence-backed packaging fixes; `packages/desktop/package.json` only for package metadata actually used by the packaged UI; new `.github/workflows/webflix-ubuntu-build.yml`. Do not edit renderer/shell components or the claims ledger.

Requirements:

1. Build for **Ubuntu 24.04 LTS x86_64** first. Produce both a `.deb` and `.AppImage` from the exact WebFlix flavor. Add ARM64 only after it has its own actual build and launch evidence.
2. Add a GitHub Actions workflow that is runnable by `workflow_dispatch` and validates relevant PR changes. Pin Node/pnpm to the repository requirements. Build with the existing supported bundler entry point and explicit Linux/x64 arguments. Cache dependencies safely; do not cache user credentials or built secrets.
3. Upload the resulting `.deb` and `.AppImage` as named, downloadable workflow artifacts with checksums and a small manifest recording source SHA, product flavor, target OS/architecture, build command, artifact SHA-256 and build time. Fail the workflow if either required artifact is absent, has the wrong identity/name, or is an empty/unvalidated placeholder.
4. Ensure Linux package metadata, executable, desktop entry, app ID, protocol scheme, data root, icon, installer/package name and artifact filename agree with the existing WebFlix identity module. Verify the WebFlix build uses the baked `webflix` product flavor, isolated `~/.webflix` data and `webflix://` scheme; it must never default to ZCode's data root/protocol. Verify the inherited ZCode flavor still builds/identifies as ZCode.
5. Keep WebFlix auto-updating disabled/fail-closed until a dedicated WebFlix update feed is approved and exists. Do not point WebFlix at a ZCode feed. Do not create or publish a public production GitHub Release from proposed homepage/author metadata without operator approval; the requested downloadable test artifact should be provided through the workflow artifact.
6. Verify runtime Linux dependencies and secret-service expectations (including `safeStorage`/libsecret behavior) in the target environment; no fallback to plaintext credentials. Document any system packages users need and exact install/launch commands.

### P9-QA-1 — Worker 3: real packaged-build smoke tests and evidence

Allowed paths: `packages/desktop/scripts/e2e/webflix-smoke.mjs` and new/assigned files under `packages/desktop/scripts/e2e/**`; `docs/testing/desktop-acceptance.md`; new `docs/operations/ubuntu-release-evidence.md`. Do not edit product components, Electron Builder config, workflow YAML or the claims ledger.

Requirements:

1. Extend/create automated smoke coverage that launches the **packaged** WebFlix Linux artifact, not only the dev server. Use the project's supported desktop/browser automation harness and capture real screenshots/logs. Test the actual installed app entry point and, where feasible, launch both .deb-installed and AppImage builds.
2. Verify startup, product title/icon/splash/menu, Home/Search/Library/Accounts/Settings navigation, no ZCode UI leak, offline local-library state, a real local file picker/import/playback path, and a clean shutdown/restart. Test unauthenticated/expired/revoked/keychain-unavailable states without exposing tokens. External YouTube tests must use a dedicated authorized test user's own account; if credentials or approved scopes are unavailable, report that test as BLOCKED, not passed.
3. Check for crashes, missing native modules, sandbox/permission problems, menu/desktop-entry mismatch, invalid runtime data paths and secret-service failures. Run the automated suite on the exact merged SHA; record actual commands, environment, pass/fail counts, screenshots/log locations and limitations. Never quote a claimed test result without a real run.
4. Include a short operator guide with artifact download, install, launch, uninstall, and bug-report steps. Make the workflow artifact link directly discoverable from the issue/PR and the repo evidence doc.

## TL2 integration/merge duties

- TL2 owns the overall order and all shared docs/claim-ledger/roadmap changes; refresh the claim ledger before dispatch. Keep the three worker grants path-disjoint. Review each worker's code and evidence, merge only reviewed commits, then rerun the release gate on the exact merged `main` SHA.
- Use real source files/tests/CI logs and git SHAs as evidence. A worker summary, a green badge from another SHA, or a successful dev-mode screenshot is not release proof.
- Ensure no enabled ZCode-only feature/control becomes reachable from WebFlix and no existing ZCode path regresses.

## Release-candidate acceptance (all mandatory)

- [ ] The Ubuntu 24.04 x86_64 `.deb` and `.AppImage` exist as non-empty downloadable workflow artifacts built from the same recorded WebFlix SHA.
- [ ] Both identify and launch as WebFlix: app name, desktop entry, process/window title, icon, startup/empty state, menus and visible interface; no ZCode/Z.ai branding in the WebFlix product surface.
- [ ] WebFlix renderer actually mounts `packages/webflix-shell` and its real use-case ports; no fake result data and no inert primary controls.
- [ ] Local media import, library, playback and persistence pass from the packaged artifact.
- [ ] Per-user account/auth surfaces use the merged OS vault and real scoped IPC; no shared account, plaintext token fallback or token exposure to renderer. If secure storage is unavailable, UI reports a recoverable truthful error.
- [ ] YouTube operations shown as supported have a current policy decision, user-specific authorization, source attribution, and honest error/scope handling. No broad parity promise based on a single happy-path test.
- [ ] Automated gates, package integrity checks, packaged-launch smoke, screenshots and logs are recorded for the exact candidate SHA.
- [ ] The ZCode production/preview renderer, updater/feed behavior and identity remain unchanged; automated tests cover the separation.
- [ ] The issue links to the completed evidence and directly downloadable workflow artifacts.

Until every applicable checkbox is evidenced, status is **NOT READY**. A build command finishing is not proof that the Ubuntu app launches or that its UI is WebFlix.
