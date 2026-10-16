# Ubuntu release evidence — WebFlix Desktop (P9-QA-1 lane, re-run closed by P9-QA-2)

This is the operator-facing release evidence for the Ubuntu 24.04 x86_64 WebFlix
build. It records the exact candidate SHA, the CI artifacts, the real packaged-
build smoke runs (commands, environment, pass/fail counts, evidence files),
every finding and its current state, the release-candidate acceptance
checklist, and the operator walkthrough (download → verify → install →
launch → test → uninstall → bug report). Nothing here is inferred from a green
CI badge: every claim below was re-derived by launching the actual packaged
artifacts on the QA machine. The first lane (P9-QA-1) ran on candidate
`33681f7` and left two identity-leak findings (F1/F2) open; the P9-FIX-1 fix
lane merged, and P9-QA-2 re-ran the entire packaged smoke on the fresh
`0125462` build. The `33681f7` record is retained below as superseded history.

**Current candidate status: RELEASE CANDIDATE (0125462), with one standing
BLOCKED slice.** On the fresh CI build of the P9-FIX-1 merge head, both
packaged lanes are fully green — deb 35/35 assertions, AppImage 33/33 — and
both prior identity-leak findings are CLOSED on the packaged process itself
(F1/F2 below, with the closing assertions quoted). What is **not** claimed:
external YouTube authorized-account flows remain BLOCKED by standing operator
order (no authorized test-account credentials exist in this lane; recorded,
never counted as passed), and the CLI session-store positive path is pinned
by merged unit tests rather than by this smoke (the smoke does not exercise
the CLI session store — see F2). Read _BLOCKED_ and _Limitations_ before
treating this as shippable.

## Candidate build under evidence

| Field        | Value                                                                                                      |
| ------------ | ---------------------------------------------------------------------------------------------------------- |
| Source SHA   | `0125462de05d3735425517af7026ce66a4b83fd1` (P9-FIX-1 merge head; QA lane branch `p9-qa-2` sits on it)      |
| Workflow     | `webflix-ubuntu-build` (`.github/workflows/webflix-ubuntu-build.yml`)                                      |
| Run          | id `38917537084`, event `workflow_dispatch`, conclusion **SUCCESS**                                        |
| Run URL      | https://github.com/payswapdotorg/WebFlix-Desktop/actions/runs/38917537084                                  |
| Build window | 2026-10-16T14:39:31Z → ~2026-10-16T14:46:44Z (build)                                                       |
| Product      | WebFlix 3.14.3, flavor `webflix`, appId `org.webflix.desktop`, scheme `webflix://`, data root `~/.webflix` |

Dispatch mechanism (recorded honestly): the dispatch API rejected the raw SHA
`0125462…` as a ref (HTTP 422, "No ref found"); the workflow was therefore
dispatched on ref `p9-fix-1`, which resolves to
`0125462de05d3735425517af7026ce66a4b83fd1` (verified). The run's `head_sha`
was then verified to be `0125462…`, so the artifacts below are built from the
recorded candidate SHA.

Artifacts (GitHub Actions artifacts of run `38917537084`, downloaded,
unzipped, and digest-verified in this lane):

| Artifact                        | File inside                            | Size          | SHA-256                                                                                                |
| ------------------------------- | -------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------ |
| `webflix-desktop-deb`           | `WebFlix-3.14.3-linux-amd64.deb`       | 140,516,364 B | `fc74e443fd7f50718caf43ff2c771799f67079162ceed5ad332af1fed380f839`                                     |
| `webflix-desktop-appimage`      | `WebFlix-3.14.3-linux-x86_64.AppImage` | 191,119,086 B | `880afc2b567921567cd629ddbde0786a19dd06197cc526a5c2bbd842d53b3af0`                                     |
| `webflix-ubuntu-build-manifest` | manifest JSON + entry dumps            | —             | content verified: `sourceSha = 0125462…`, run URL matches (archive digest not re-derived in this lane) |

Both `.deb`/`.AppImage` digests match the CI sidecar checksums shipped inside
the artifacts (`*.sha256`) **and** the manifest's recorded source SHA.
`sha256sum` both files after download and compare before installing.

## What was actually tested (P9-QA-2 lane, 2026-10-16)

Machine: Linux x86_64, 2 cores, 4GB RAM, no graphical session of its own, no
D-Bus/system secret service, unprivileged user namespaces enabled (so the deb
binary boots faithfully without `--no-sandbox`), `Xvfb`, `dpkg-deb`,
`ffmpeg`, Node v24.21.0 — the same station class as the P9-QA-1 lane. The
smoke harness spawns its own `Xvfb` per lane and runs each artifact under a
fresh throwaway `HOME` — no real user state was touched.

Commands (from the repo at `0125462`, per artifact lane):

```bash
node scripts/e2e/webflix-packaged-smoke.mjs \
  --deb   <dl>/WebFlix-3.14.3-linux-amd64.deb \
  --media webflix-smoke-test-clip.mp4 \
  --out   <evidence>/deb
node scripts/e2e/webflix-packaged-smoke.mjs \
  --appimage <dl>/WebFlix-3.14.3-linux-x86_64.AppImage \
  --media    webflix-smoke-test-clip.mp4 \
  --out      <evidence>/appimage
```

The deb lane runs the rootless `dpkg-deb -x` installed tree
(`/opt/WebFlix/webflix`, faithful to the shipped entry — no `--no-sandbox`);
the AppImage lane uses the documented no-FUSE path (`--appimage-extract`,
then the extracted `AppRun --no-sandbox` form, exactly the entry the AppImage
ships). Both lanes drive the real packaged process over CDP
(`playwright-core`, a repo runtime dependency) and assert the live DOM and
the real filesystem the packaged app wrote.

Evidence files: `results.json` (every assertion with pass/fail/blocked +
detail), `main-<flavor>.log` (full main-process log of both launches), and
six PNG screenshots per lane (home, accounts, search, library-imported,
watch-player, restart-library), committed at
`packages/desktop/scripts/e2e/evidence/ubuntu-0125462/{deb,appimage}/` with a
lane `README.md` recording the candidate, run, digests, commands, results and
honest notes. The run's scratch trees (extracted deb/AppImage trees and
throwaway HOMEs) were kept out of the commit.

### Results

| Lane        | Assertions | Passed | Failed | Blocked | Verdict line (verbatim)                                         |
| ----------- | ---------- | ------ | ------ | ------- | --------------------------------------------------------------- |
| `.deb`      | 35         | 35     | 0      | 0       | `[smoke:packaged] 35/35 assertions passed, 0 failed, 0 blocked` |
| `.AppImage` | 33         | 33     | 0      | 0       | `[smoke:packaged] 33/33 assertions passed, 0 failed, 0 blocked` |

Both lanes proved, on the packaged process itself: primary-window creation
and renderer dom-ready; `document.title="WebFlix"` + product mark + WebFlix
splash handling; real-click navigation of Home / Search / Library / Accounts
/ Settings; **zero ZCode/Z.ai strings on the visible product surface**; the
fail-closed vault banner (`os_vault_unavailable: Electron safeStorage is
unavailable on this system …`) with no token-shaped material in renderer
text/storage; the honest not-connected account card and the typed connect
refusal (“not available in this build … nothing was authorized”);
requires-auth search; offline (emulated) local library; a REAL file-picker
import (`setInputFiles` on the hidden input) and REAL `<video>` playback of
the imported blob (t≈0.01–0.02s/3.00s, playing); the H1 fail-closed updater
refusal (packaged boot refused the ZCode updater — flavor guard fired); no
module/dlopen errors, no crashpad dumps; SIGTERM shutdown exit=0; restart on
the same HOME restores identity with the session-only library honestly empty
again; packaged static identity (desktop-entry fields exact for both flavors
— `Name=WebFlix`, `Icon=webflix`, `Comment=WebFlix Desktop App`,
`MimeType=x-scheme-handler/webflix;` — plus deb control
`Package=webflix-desktop` / `Description=WebFlix Desktop App` and 9 hicolor
`webflix.png` sizes).

Re-run stability (honest record): the prior lane's intermittent AppImage
restart stall (observed 1/3 on `33681f7`, recorded below) was **not
reproduced** in this run — both lanes restarted cleanly.

### Prior candidate `33681f7` (SUPERSEDED history, P9-QA-1 lane, 2026-10-15)

Run id `38661001316` (event `workflow_dispatch`, SUCCESS), artifacts
`WebFlix-3.14.3-linux-amd64.deb` 140,515,596 B
`2653a952e7782d32efd65063b7e8b9d2aba68d815c58755d785b6e9260c3a66c` and
`WebFlix-3.14.3-linux-x86_64.AppImage` 191,114,010 B
`439c777ae74e45b4f6bc6882d4a3df4a0a35992cce4fc146fd5d7ee0cd66d9e4`;
evidence at `packages/desktop/scripts/e2e/evidence/ubuntu-33681f7/`. The deb
lane passed 33/35 and the AppImage lane 31/33; the two failures per lane
were findings F1/F2 below, both since fixed by P9-FIX-1 and re-verified
closed on the current candidate `0125462` (the current run's numbers
supersede these). That lane also recorded one intermittent AppImage restart
stall (1/3 runs, SIGKILLed once, not reproduced then or since).

### BLOCKED (recorded, never counted as passed)

- **External YouTube authorized-account flows** (tier-5: connect with a
  dedicated test user's own account, real search/browse, expired/revoked
  states): no authorized test-account credentials exist in this lane and the
  standing operator order keeps this slice BLOCKED. The
  unauthenticated/keychain-unavailable surfaces WERE tested for real (above);
  the authorized-account slice is not claimed.

## Findings (from the real packaged runs — both CLOSED on 0125462)

- **F1 — runtime wrote a ZCode-branded user-level desktop entry — CLOSED.**
  Was (on `33681f7`): the packaged app self-registered the deep-link handler
  as `~/.local/share/applications/zcode.desktop` with `Icon=zcode`,
  `MimeType=x-scheme-handler/zcode;` and `Comment=ZCode Desktop App`. Fix
  (P9-FIX-1 @ `0125462`): profile-driven WebFlix deep-link registration —
  `packages/desktop/src/main/desktopLinuxDeepLinkRegistration.ts` now writes
  `webflix.desktop` with the WebFlix identity fields. Closing evidence (this
  run): `results.json` `desktop-entry:deb:user-level` and
  `desktop-entry:appimage:user-level` both PASS —
  `webflix.desktop: Name=WebFlix Icon=webflix
MimeType=x-scheme-handler/webflix;` — and **no `zcode.desktop`** is
  written (walked file list, `main-*.log`).
- **F2 — runtime created `~/.zcode/cli/db/db.sqlite` — CLOSED.** Was (on
  `33681f7`): the packaged WebFlix app wrote the inherited CLI session store
  under ZCode's data root. Fix (P9-FIX-1 @ `0125462`): identity-scoped CLI
  data root `~/.webflix` plus `ZCODE_SESSION_DB_PATH` spawn-env pinning for
  child processes. Closing evidence (this run): `results.json`
  `data-root:deb:no-zcode-root` and `data-root:appimage:no-zcode-root` both
  PASS — `~/.zcode` absent on disk — with the positive data-root assertions
  `data-root:deb:webflix` / `data-root:appimage:webflix` PASS (packaged app
  wrote `~/.webflix`). Honest scope: no `~/.webflix/cli/db/db.sqlite`
  materialized in either lane — this smoke does not exercise the CLI session
  store, so the positive CLI path is pinned by the merged P9-FIX-1 unit
  tests, while this run proves the negative (no `~/.zcode`) on the real
  packaged process.

Evidence pointers for both:
`packages/desktop/scripts/e2e/evidence/ubuntu-0125462/{deb,appimage}/results.json`
(assertions quoted above), `main-{deb,appimage}.log`, and the lane
`README.md` in the same directory.

## Release-candidate acceptance (P9-UBUNTU-WEBFLIX-1, all mandatory)

1. **Ubuntu 24.04 x86_64 `.deb` and `.AppImage` exist as non-empty
   downloadable workflow artifacts from the same recorded SHA — MET.** Run
   `38917537084` (workflow_dispatch, SUCCESS), artifacts and digests in the
   table above; manifest `sourceSha = 0125462…` verified against the
   artifacts' `*.sha256` sidecars.
2. **Both identify and launch as WebFlix — MET, one carried limitation.**
   App name, desktop entry, window title, icon, startup/empty state and the
   visible interface are asserted WebFlix with no ZCode/Z.ai branding
   (`identity:*`, `desktop-entry:*`, `packaged-entry:*`, `zcode-leak:*` PASS
   in both lanes; 12 screenshots under `evidence/ubuntu-0125462/`). Carried
   limitation: the native application-menu identity is still not separately
   asserted (window title, icon, splash and shell navigation are).
3. **Renderer actually mounts `packages/webflix-shell` with real use-case
   ports; no fake result data, no inert controls — MET.** Real-click
   navigation of all five shell screens with honest states
   (`nav:*`, `search:*:requires-auth`, `accounts:*:not-connected`,
   `accounts:*:connect-typed-refusal` PASS); the import/playback and offline
   paths below are real, and nothing renders invented media or status.
4. **Local media import, library, playback and persistence — MET, scoped
   honestly.** REAL file-picker import, library entry, and `<video>` playback
   of the imported blob pass in both lanes (`local-media:*:import`,
   `local-media:*:playback`); the library works offline
   (`offline:*:local-library`). Persistence across restart is the documented
   truthful behavior: identity and the `~/.webflix` data root persist
   (`restart:*:identity` PASS) while the session-only local library is
   honestly empty again (`restart:*:session-library-honest-empty` PASS).
   Library persistence across restarts is NOT claimed — it is session-only
   by design.
5. **Per-user account/auth surfaces use the merged OS vault and real scoped
   IPC; no plaintext fallback; truthful error when secure storage is
   unavailable — MET on the fail-closed slice, honestly scoped.** On this
   station (no D-Bus/secret service) the packaged app renders the truthful
   fail-closed vault banner and exposes no token-shaped material to the
   renderer (`vault:*:fail-closed`, `vault:*:no-token-material` PASS). The
   positive keyring path is not exercised in-package here (no secret service
   on the QA station); no shared account and no plaintext fallback were
   observed.
6. **YouTube operations shown as supported have current policy, per-user
   authorization, attribution and honest error/scope handling — NOT fully
   met: authorized slice BLOCKED.** The honest-refusal surfaces pass
   (`accounts:*:not-connected`, `accounts:*:connect-typed-refusal`,
   `search:*:requires-auth`), and no broad parity promise is made anywhere.
   The authorized-account flows themselves stay BLOCKED per the standing
   operator order (see _BLOCKED_) and are never counted as passed.
7. **Automated gates, package integrity checks, packaged-launch smoke,
   screenshots and logs recorded for the exact candidate SHA — MET.** The
   full battery at `0125462` was green (fmt:check PASS, lint 69 warnings / 0
   errors, architecture:check 0/0/0, `tsc -b` exit 0, unit 78 files / 1712
   tests, integration 1/1, renderer 9/100, shell 10/135 — re-measured in the
   P9-QA-2 sandbox; see the lane report); artifact digests verified against
   sidecar + manifest; the packaged smoke (35/35 deb, 33/33 AppImage),
   screenshots and logs are committed under
   `packages/desktop/scripts/e2e/evidence/ubuntu-0125462/`.
8. **ZCode production/preview renderer, updater/feed behavior and identity
   unchanged; automated tests cover the separation — MET.** The packaged
   WebFlix boot refuses the ZCode updater (flavor guard fired, both lanes:
   `updater:*:fail-closed` PASS) and never touches a ZCode feed; flavor
   separation is covered by the automated suite at the exact SHA (1712 unit
   tests incl. the flavor/renderer separation tests). An in-package ZCode
   build was not re-built in this lane — separation is pinned by the tests.
9. **The issue links to the completed evidence and directly downloadable
   workflow artifacts — NOT VERIFIED by this lane.** The evidence and the
   directly downloadable artifacts (run URL, names, digests above) are
   recorded here; the QA worker had no issue-read credentials to verify a
   GitHub issue link, so this item is left to the operator/TL linking step,
   stated honestly.

Until every applicable checkbox is evidenced, status is **NOT READY**; item
6 (authorized slice) and item 9 (issue link) are the outstanding ones on
this candidate.

## Operator guide

### 1. Download

From the run page (https://github.com/payswapdotorg/WebFlix-Desktop/actions/runs/38917537084)
download the artifacts `webflix-desktop-deb`, `webflix-desktop-appimage` and
`webflix-ubuntu-build-manifest` (GitHub zips). With the CLI:

```bash
gh run download 38917537084 --repo payswapdotorg/webflix-desktop \
  --name webflix-desktop-deb --dir .
gh run download 38917537084 --repo payswapdotorg/webflix-desktop \
  --name webflix-desktop-appimage --dir .
```

Fresh builds: the workflow is `workflow_dispatch` — run it from the Actions
tab (`webflix-ubuntu-build` → “Run workflow”). Note: dispatch by branch/ref
name (a raw SHA is rejected by the dispatch API with “No ref found”; this
lane dispatched on `p9-fix-1`, which resolves to the candidate SHA). The
workflow fails unless both artifacts plus the manifest are present and
identity-valid.

### 2. Verify

```bash
sha256sum WebFlix-3.14.3-linux-amd64.deb WebFlix-3.14.3-linux-x86_64.AppImage
# must match the table above for the 0125462 candidate (or the manifest's
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
`/opt/WebFlix/webflix`. First launch creates `~/.webflix` and nothing under
`~/.zcode` (F2 closed on this build; the runtime-registered user-level
entry is `webflix.desktop`, F1 closed). Without a secret service/keyring (or
on first run before login) the app is expected to show the truthful
fail-closed banner “Account storage is unavailable on this system …” — that
is correct behavior, not a bug; sign-in is withheld rather than storing
credentials in plaintext.

### 5. Test (the 5-minute operator smoke)

1. Launch; window title/WebFlix mark appear; `~/.webflix` is created and
   `~/.zcode` is not.
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
```

(On this build the runtime no longer writes
`~/.local/share/applications/zcode.desktop` — F1 closed; nothing ZCode is
left to clean up.)

### 7. Bug report

File an issue at https://github.com/payswapdotorg/WebFlix-Desktop/issues
with: artifact SHA-256, OS/desktop-environment, whether a keyring service
was available, the `~/.webflix` layout you observed, and any console/log
lines. Attach screenshots; never attach token material. For harness-rerun
evidence, note the exact commands from this doc and the `results.json` it
produced. Link the issue to the run URL above and to
`packages/desktop/scripts/e2e/evidence/ubuntu-0125462/`.

## Limitations (honest)

1. The authorized-account YouTube slice is BLOCKED (standing operator order;
   no test credentials) and is never counted as passed — checklist item 6
   stays open on that slice.
2. The packaged smoke does not exercise the CLI session store: no
   `~/.webflix/cli/db/db.sqlite` materialized in either lane. The F2
   positive path (identity-scoped CLI data root) is pinned by the merged
   P9-FIX-1 unit tests; this run proves the negative (no `~/.zcode`) on the
   packaged process.
3. The prior lane's intermittent AppImage restart stall (1/3 on `33681f7`)
   was not reproduced in this run; it remains a recorded historical flake,
   worth watching if it recurs.
4. The native application-menu identity was not separately asserted (window
   title, icon, splash and shell navigation were); a menu-focused assertion
   belongs in a follow-up lane.
5. Sandbox runs are headless (Xvfb); Wayland/compositor-specific behavior,
   real desktop-environment integration (launchers, protocol registration
   success path with `xdg-utils` present) and ARM64 are not covered here.
6. The QA station has no D-Bus/secret service, so the positive OS-keyring
   path is not exercised in-package (the fail-closed path is what this run
   proves).
7. Dispatch mechanism: the API rejected a raw-SHA ref; this lane dispatched
   on `p9-fix-1` (== `0125462`, run `head_sha` verified) — recorded so the
   run's provenance is reproducible.
8. The base battery numbers were re-measured fresh in this lane's sandbox
   (after the fleet infra recycle) and matched the expected counts exactly;
   the head battery re-run on the evidence/docs delta (this commit)
   reproduced every count exactly: fmt:check PASS on **3434** files (grown
   from 3431 with the 3 new evidence files; the 2 new markdown files were
   oxfmt-realigned first), lint 69 warnings / 0 errors, architecture:check
   0/0/0, `tsc -b` exit 0, unit 78 files / 1712 tests, integration 1/1,
   renderer 9/100, shell 10/135.
