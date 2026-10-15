# Ubuntu release evidence — WebFlix Desktop (P9-QA-1)

This is the operator-facing release evidence for the Ubuntu 24.04 x86_64 WebFlix
build. It records the exact candidate SHA, the CI artifacts, the real packaged-
build smoke runs (commands, environment, pass/fail counts, evidence files),
every open finding, and the operator walkthrough (download → verify → install →
launch → test → uninstall → bug report). Nothing here is inferred from a green
CI badge: every claim below was re-derived by launching the actual packaged
artifacts on the QA machine.

**Current candidate status: QA evidence recorded, NOT RELEASE-CLEAN** — two
identity-leak findings (F1/F2 below) are open on the runtime paths of the
`33681f7` artifacts. The core packaged experience (launch, identity, all five
screens, offline library, real import/playback, fail-closed vault/updater,
clean shutdown/restart) passes on both artifacts. See _Findings_ before
treating this as a release candidate.

## Candidate build under evidence

| Field        | Value                                                                                                      |
| ------------ | ---------------------------------------------------------------------------------------------------------- |
| Source SHA   | `33681f7fadc70117680c2b9e9a8b6bc1e620ac9c` (TL2 merge head, `origin/main`)                                 |
| Workflow     | `webflix-ubuntu-build` (`.github/workflows/webflix-ubuntu-build.yml`), run **#5**                          |
| Run          | id `38661001316`, event `workflow_dispatch`, conclusion **SUCCESS**                                        |
| Run URL      | https://github.com/payswapdotorg/WebFlix-Desktop/actions/runs/38661001316                                  |
| Build window | 2026-10-15T00:36:31Z → 2026-10-15T00:45:13Z                                                                |
| Product      | WebFlix 3.14.3, flavor `webflix`, appId `org.webflix.desktop`, scheme `webflix://`, data root `~/.webflix` |

Artifacts (GitHub Actions artifacts of run `38661001316`, all three
non-expired at evidence time, each carrying the run's `head_sha` =
`33681f7…`):

| Artifact                        | File inside                            | Size          | SHA-256                                                                            |
| ------------------------------- | -------------------------------------- | ------------- | ---------------------------------------------------------------------------------- |
| `webflix-desktop-deb`           | `WebFlix-3.14.3-linux-amd64.deb`       | 140,515,596 B | `2653a952e7782d32efd65063b7e8b9d2aba68d815c58755d785b6e9260c3a66c`                 |
| `webflix-desktop-appimage`      | `WebFlix-3.14.3-linux-x86_64.AppImage` | 191,114,010 B | `439c777ae74e45b4f6bc6882d4a3df4a0a35992cce4fc146fd5d7ee0cd66d9e4`                 |
| `webflix-ubuntu-build-manifest` | manifest JSON + entry dumps            | 2,532 B       | `554129353549282e8621fe607b47e384edc9650fecf8021fa7a6be1390b66d20` (GitHub digest) |

The `.deb`/`.AppImage` SHA-256 above match the CI sidecar checksums shipped
inside the artifacts (`*.sha256`). GitHub's own artifact-archive digests:
deb `8753e75e…595d7`, appimage `7969588b…0054`, manifest `55412935…66d20`.
`sha256sum` both files after download and compare before installing.

## What was actually tested (QA lane, 2026-10-15)

Machine: Linux x86_64 (kernel 5.10), 2 cores, no graphical session of its own,
no D-Bus/system secret service, unprivileged user namespaces enabled (so the
deb binary boots faithfully without `--no-sandbox`), `Xvfb`, `dpkg-deb`,
`ffmpeg`, Node v24.21.0. The smoke harness spawns its own `Xvfb` per lane and
runs each artifact under a fresh throwaway `HOME` — no real user state was
touched.

Commands (from the repo at `33681f7`, per artifact lane):

```bash
node scripts/e2e/webflix-packaged-smoke.mjs \
  --deb   WebFlix-3.14.3-linux-amd64.deb \
  --media webflix-smoke-test-clip.mp4 \
  --out   <evidence>/deb
node scripts/e2e/webflix-packaged-smoke.mjs \
  --appimage WebFlix-3.14.3-linux-x86_64.AppImage \
  --media    webflix-smoke-test-clip.mp4 \
  --out      <evidence>/appimage
```

The deb lane runs the rootless `dpkg-deb -x` installed tree
(`/opt/WebFlix/webflix`, faithful to the shipped entry — no `--no-sandbox`);
the AppImage lane uses the documented no-FUSE path (`--appimage-extract`,
then the extracted `AppRun --no-sandbox` form, exactly the entry the AppImage
ships). Both lanes drive the real packaged process over CDP
(`playwright-core`, a repo runtime dependency) and assert the live DOM and the
real filesystem the packaged app wrote.

Evidence files: `results.json` (every assertion with pass/fail/blocked +
detail), `main-<flavor>.log` (full main-process log of both launches), and
six PNG screenshots per lane (home, accounts, search, library-imported,
watch-player, restart-library). The copies reviewed for this evidence live at
`packages/desktop/scripts/e2e/evidence/ubuntu-33681f7/{deb,appimage}/`.

### Results

| Lane        | Assertions | Passed | Failed (open findings) | Blocked |
| ----------- | ---------- | ------ | ---------------------- | ------- |
| `.deb`      | 35         | 33     | 2 (F1, F2)             | 0       |
| `.AppImage` | 33         | 31     | 2 (F1, F2)             | 0       |

Both lanes proved, on the packaged process itself: primary-window creation and
renderer dom-ready; `document.title="WebFlix"` + product mark + WebFlix splash
aria-label; real-click navigation of Home / Search / Library / Accounts /
Settings; **zero ZCode/Z.ai strings on the visible product surface**; the
fail-closed vault banner (`os_vault_unavailable: Electron safeStorage is
unavailable on this system …`) with no token-shaped material in renderer
text/storage; the honest not-connected account card and the typed connect
refusal (“not available in this build … nothing was authorized”); requires-auth
search; offline (emulated) local library; a REAL file-picker import
(`setInputFiles` on the hidden input) and REAL `<video>` playback of the
imported blob (t≈0.01s/3.00s, playing); the H1 fail-closed updater refusal
(“refused (disabled for this desktop product flavor) … the ZCode manifest feed
must never serve a WebFlix build”); no module/dlopen errors, no crashpad
dumps; SIGTERM shutdown exit=0; restart on the same HOME restores identity
with the session-only library honestly empty again; packaged static identity
(desktop-entry fields exact for both flavors — `Name=WebFlix`,
`Icon=webflix`, `Comment=WebFlix Desktop App`,
`MimeType=x-scheme-handler/webflix;` — plus deb control
`Package=webflix-desktop` / `Description=WebFlix Desktop App` and 9 hicolor
`webflix.png` sizes).

Re-run flakiness (honest record): one AppImage restart attempt of three total
stalled >3 min before the browser process came up and had to be SIGKILLed;
the two subsequent AppImage runs (including the canonical evidence run)
restarted cleanly. Recorded as an intermittent restart stall, observed 1/3,
not reproduced — needs follow-up if it recurs (suspect: browser-process
startup race in this container, not the app's node main).

### BLOCKED (recorded, never counted as passed)

- **External YouTube authorized-account flows** (tier-5: connect with a
  dedicated test user's own account, real search/browse, expired/revoked
  states): no authorized test-account credentials exist in this lane. The
  unauthenticated/keychain-unavailable surfaces WERE tested for real (above);
  the authorized-account slice stays BLOCKED per the work order.

## Findings (open, from the real packaged runs)

- **F1 — runtime writes a ZCode-branded user-level desktop entry.** The
  packaged app self-registers the deep-link handler as
  `~/.local/share/applications/zcode.desktop` with `Icon=zcode`,
  `MimeType=x-scheme-handler/zcode;` and `Comment=ZCode Desktop App`
  (Name/StartupWMClass are WebFlix). Root cause:
  `packages/desktop/src/main/desktopLinuxDeepLinkRegistration.ts` hardcodes
  `LINUX_DEEP_LINK_DESKTOP_FILE = "zcode.desktop"` and its zcode-shaped
  fields. Operator impact: the OS application list can show a ZCode icon and
  a `zcode://` association next to a WebFlix-named entry; the packaged
  (system-level) entry is correctly `webflix.desktop`. Evidence:
  `results.json` `desktop-entry:<flavor>:user-level`, the `zcode.desktop`
  file under each lane's `home-<flavor>`, and the `[deep-link]` log lines.
- **F2 — runtime creates `~/.zcode/cli/db/db.sqlite`.** The packaged WebFlix
  app writes the inherited CLI session store under ZCode's data root (the
  services layer resolves `~/.zcode/cli` independently of the WebFlix
  identity — e.g. `packages/services/src/subagentStorage.ts` /
  `subagentsService.ts`). The Chromium/userData layer is fully `~/.webflix`.
  Operator impact: a `~/.zcode` directory appears on a WebFlix-only machine
  (shared state with any real ZCode install, and an identity leak on disk).
  Evidence: `results.json` `data-root:<flavor>:no-zcode-root`, the walked
  file list, and `main-*.log`.

Both findings are product defects outside the QA lane's allowed paths
(`packages/desktop/scripts/e2e/**` + these docs); they are recorded here and
in `results.json` as FAIL findings, and the release candidate is not clean
until a follow-up lane fixes them and this evidence is re-run.

## Operator guide

### 1. Download

From the run page (https://github.com/payswapdotorg/WebFlix-Desktop/actions/runs/38661001316)
download the artifacts `webflix-desktop-deb`, `webflix-desktop-appimage` and
`webflix-ubuntu-build-manifest` (GitHub zips). With the CLI:

```bash
gh run download 38661001316 --repo payswapdotorg/webflix-desktop \
  --name webflix-desktop-deb --dir .
gh run download 38661001316 --repo payswapdotorg/webflix-desktop \
  --name webflix-desktop-appimage --dir .
```

Fresh builds: the workflow is `workflow_dispatch` — run it from the Actions
tab (`webflix-ubuntu-build` → “Run workflow”, branch `main`) and it fails
unless both artifacts plus the manifest are present and identity-valid.

### 2. Verify

```bash
sha256sum WebFlix-3.14.3-linux-amd64.deb WebFlix-3.14.3-linux-x86_64.AppImage
# must match the table above for the 33681f7 candidate (or the manifest's
# checksums for a newer run)
```

The `webflix-ubuntu-build-manifest` artifact records the source SHA, product
flavor, identity (appId/productName/scheme/dataRoot) and build command.

### 3. Install (Ubuntu 24.04 x86_64)

System packages the deb depends on (apt resolves these automatically):
`libgtk-3-0 libnotify4 libnss3 libxss1 libxtst6 xdg-utils libatspi2.0-0
libuuid1 libsecret-1-0` (recommends `libappindicator3-1`).

```bash
sudo apt install ./WebFlix-3.14.3-linux-amd64.deb   # installs /opt/WebFlix
# or: sudo dpkg -i WebFlix-3.14.3-linux-amd64.deb && sudo apt -f install
```

AppImage (no install; FUSE-less machines use the documented extract path):

```bash
chmod +x WebFlix-3.14.3-linux-x86_64.AppImage
./WebFlix-3.14.3-linux-x86_64.AppImage                 # with FUSE
./WebFlix-3.14.3-linux-x86_64.AppImage --appimage-extract && \
  ./squashfs-root/AppRun --no-sandbox                  # without FUSE
```

### 4. Launch

The deb installs the menu entry “WebFlix” (`webflix.desktop`,
`Icon=webflix`, deep link `webflix://`); the binary is
`/opt/WebFlix/webflix`. First launch creates `~/.webflix` (NEVER `~/.zcode`
by design — see finding F2 for the current exception). Without a secret
service/keyring (or on first run before login) the app is expected to show
the truthful fail-closed banner “Account storage is unavailable on this
system …” — that is correct behavior, not a bug; sign-in is withheld rather
than storing credentials in plaintext.

### 5. Test (the 5-minute operator smoke)

1. Launch; window title/WebFlix mark appear; `~/.webflix` is created.
2. Click Home / Search / Library / Accounts / Settings — each renders its
   honest state (Search: “Sign-in required”; Accounts: “Not connected”).
3. Library → import a local video via the file picker → it plays in the
   watch screen.
4. Disconnect the network — the local library and playback still work.
5. Quit (window close / SIGTERM) and relaunch — the app comes back as
   WebFlix; the session-only local library is honestly empty again (recorded
   behavior, not data loss).
6. Optional full automation: check out the repo at the candidate SHA and run
   the harness from _What was actually tested_ — it reproduces every
   assertion and writes the same evidence bundle.

### 6. Uninstall

```bash
sudo apt remove webflix-desktop        # deb (add --purge to drop system files)
rm -rf ~/WebFlix…AppImage squashfs-root  # AppImage: delete the file(s)
rm -rf ~/.webflix                        # optional: your WebFlix data
rm -rf ~/.local/share/applications/zcode.desktop  # see finding F1 — the
                                                   # runtime-registered entry
```

### 7. Bug report

File an issue at https://github.com/payswapdotorg/WebFlix-Desktop/issues
with: artifact SHA-256, OS/desktop-environment, whether a keyring service
was available, the `~/.webflix`/`~/.zcode` layout you observed, and any
console/log lines. Attach screenshots; never attach token material. For
harness-rerun evidence, note the exact commands from this doc and the
`results.json` it produced.

## Requirement mapping (P9-QA-1 work order)

1. **Packaged smoke coverage** — `webflix-packaged-smoke.mjs` launches the
   real deb tree + AppImage (never the dev server), captures screenshots and
   full logs per run. Covered above.
2. **Startup/identity/navigation/no-leak/offline/import/playback/shutdown/
   restart + unauthenticated states** — all asserted per lane; external
   authorized-YouTube recorded BLOCKED (no credentials).
3. **Crashes/native modules/sandbox/desktop-entry/data paths/secret
   service** — scanned per lane; two open findings (F1/F2); exact SHA,
   commands, environment, counts and evidence locations recorded here.
4. **Operator guide + discoverable artifacts** — this doc links the run and
   its downloadable artifacts directly; the acceptance doc
   (`docs/testing/desktop-acceptance.md`) defines the tier-6 contract.

## Limitations (honest)

- Findings F1/F2 are open; the candidate is not release-clean.
- The authorized-account YouTube slice is BLOCKED (no test credentials).
- The native application-menu identity was not separately asserted (window
  title, icon, splash and shell navigation were); a menu-focused assertion
  belongs in a follow-up lane.
- One intermittent AppImage restart stall (1/3 runs, not reproduced).
- Sandbox runs are headless (Xvfb); Wayland/compositor-specific behavior,
  real desktop-environment integration (launchers, protocol registration
  success path with `xdg-utils` present) and ARM64 are not covered here.
