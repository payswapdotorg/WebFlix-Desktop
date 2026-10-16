# Packaged-smoke evidence — candidate 0125462 (WebFlix 3.14.3, run 38917537084)

Raw per-lane output of `node scripts/e2e/webflix-packaged-smoke.mjs` (see
docs/operations/ubuntu-release-evidence.md for commands, environment, results
and findings): `results.json` (per-assertion pass/fail/blocked + detail),
`main-<flavor>.log` (full main-process log of launch + restart), and the six
PNG screenshots per lane (home, accounts, search, library-imported,
watch-player, restart-library). Regenerate with the commands in the evidence doc.

## Candidate

| Field   | Value                                                                                                      |
| ------- | ---------------------------------------------------------------------------------------------------------- |
| SHA     | `0125462de05d3735425517af7026ce66a4b83fd1` (P9-FIX-1 merge head)                                           |
| Product | WebFlix 3.14.3, flavor `webflix`, appId `org.webflix.desktop`, scheme `webflix://`, data root `~/.webflix` |
| Branch  | `p9-qa-2` (QA lane branch at the merge head)                                                               |

## CI run

| Field    | Value                                                                                           |
| -------- | ----------------------------------------------------------------------------------------------- |
| Workflow | `webflix-ubuntu-build`, run id `38917537084`, event `workflow_dispatch`, conclusion **SUCCESS** |
| Run URL  | https://github.com/payswapdotorg/WebFlix-Desktop/actions/runs/38917537084                       |
| Window   | 2026-10-16T14:39:31Z → ~2026-10-16T14:46:44Z (build)                                            |

Dispatch mechanism (honest): the dispatch API rejected the raw SHA
`0125462…` as a ref (HTTP 422 "No ref found"); the workflow was dispatched on
ref `p9-fix-1`, which resolves to `0125462de05d3735425517af7026ce66a4b83fd1`
(verified). The run's `head_sha` was verified to be `0125462…`.

## Artifacts (downloaded, unzipped, digest-verified)

| Artifact                   | File                                   | Size          | SHA-256                                                            |
| -------------------------- | -------------------------------------- | ------------- | ------------------------------------------------------------------ |
| `webflix-desktop-deb`      | `WebFlix-3.14.3-linux-amd64.deb`       | 140,516,364 B | `fc74e443fd7f50718caf43ff2c771799f67079162ceed5ad332af1fed380f839` |
| `webflix-desktop-appimage` | `WebFlix-3.14.3-linux-x86_64.AppImage` | 191,119,086 B | `880afc2b567921567cd629ddbde0786a19dd06197cc526a5c2bbd842d53b3af0` |

Both digests match the CI sidecar checksums (`*.sha256`) shipped inside the
downloaded artifacts AND the run manifest (`webflix-ubuntu-build-manifest`:
`sourceSha = 0125462de05d3735425517af7026ce66a4b83fd1`, run URL matches).

## Commands run (from the repo at `0125462`, per lane)

```bash
node scripts/e2e/webflix-packaged-smoke.mjs \
  --deb   /home/z/p9-artifacts/dl/deb/WebFlix-3.14.3-linux-amd64.deb \
  --media /home/z/p9-artifacts/webflix-smoke-test-clip.mp4 \
  --out   packages/desktop/scripts/e2e/evidence/ubuntu-0125462/deb
node scripts/e2e/webflix-packaged-smoke.mjs \
  --appimage /home/z/p9-artifacts/dl/appimage/WebFlix-3.14.3-linux-x86_64.AppImage \
  --media    /home/z/p9-artifacts/webflix-smoke-test-clip.mp4 \
  --out      packages/desktop/scripts/e2e/evidence/ubuntu-0125462/appimage
```

Machine: Linux x86_64, 2 cores, 4GB RAM, Xvfb (harness spawns its own), no
D-Bus/system secret service, rootless `dpkg-deb -x` for the deb tree, the
documented `--appimage-extract` no-FUSE path for the AppImage, fresh
throwaway `HOME` per lane. Same station class as the prior P9-QA-1 lane.

## Results

| Lane        | Assertions | Passed | Failed | Blocked | Verdict line (verbatim)                                         |
| ----------- | ---------- | ------ | ------ | ------- | --------------------------------------------------------------- |
| `.deb`      | 35         | 35     | 0      | 0       | `[smoke:packaged] 35/35 assertions passed, 0 failed, 0 blocked` |
| `.AppImage` | 33         | 33     | 0      | 0       | `[smoke:packaged] 33/33 assertions passed, 0 failed, 0 blocked` |

Findings closed on this run (assertions PASS in each lane's `results.json`):

- **F1 (user-level desktop entry)** — `desktop-entry:deb:user-level` and
  `desktop-entry:appimage:user-level` PASS: `webflix.desktop` with
  `Name=WebFlix`, `Icon=webflix`, `MimeType=x-scheme-handler/webflix;`,
  `Comment=WebFlix Desktop App`; **no `zcode.desktop`** written.
- **F2 (CLI data root)** — `data-root:deb:no-zcode-root` and
  `data-root:appimage:no-zcode-root` PASS: `~/.zcode` absent on disk
  (positive path `~/.webflix` asserted by `data-root:*:webflix`).

## Honest notes

- **No `~/.webflix/cli/db/db.sqlite` materialized in either lane.** The
  packaged smoke does not exercise the CLI session store, so the F2 positive
  path (identity-scoped CLI data root) is pinned by the merged P9-FIX-1 unit
  tests, not by this smoke run. The negative path (no `~/.zcode`) is what
  this run proves on the real packaged process.
- The prior lane's AppImage restart stall (observed 1/3 on candidate
  `33681f7`) was **not observed** in this run (both lanes restarted cleanly).
- **External YouTube authorized-account flows remain BLOCKED** (no authorized
  test-account credentials; standing operator order — never counted as
  passed). Unauthenticated/keychain-unavailable surfaces are the ones
  asserted here.
- The six PNGs are byte-identical across the deb and AppImage lanes (same
  deterministic rendered states captured per lane); they are genuine
  per-lane captures, not copies.
- The run's scratch trees (extracted `deb-tree/`, throwaway `home-deb/` /
  `home-appimage/`, extracted `appimage-run/`) were moved out of the repo
  (kept at `/home/z/p9-artifacts/scratch-debris/`, not committed). The
  `results.json` detail fields still reference those paths as recorded at
  run time.

## VLM screenshot verification

Post-run, all 12 PNGs were described with a vision-language model
(`glm-4.5v` via `z-ai-web-dev-sdk`; raw JSON kept outside the repo at
`/home/z/p9-artifacts/vlm-descriptions.json`): **12/12 described**, each
plausibly matching its expected harness state (title + tagline, nav tabs,
fail-closed vault banner, SMPTE bars, honest empty library). Two
representative descriptions, verbatim:

> **05-deb-watch-player.png** — "The screenshot displays a media player
> window with the title "webflix-smoke-test-clip.mp4" in the top-left
> corner. The main view shows a standard SMPTE color bar test pattern,
> featuring vertical stripes of gray, cyan, magenta, blue, yellow, green,
> and red, along with a circular mask and a small rectangle in the
> lower-right red section. A color gradient bar is visible at the very
> bottom of the screen. A vertical scrollbar is present on the right edge
> of the window."

> **02-deb-accounts.png** — "This screenshot displays the **WebFlix**
> desktop application, specifically the **Accounts** view, as indicated by
> the active "Accounts" tab in the navigation bar. The interface features
> a dark theme with a prominent yellow warning banner at the top stating
> that account storage is unavailable due to a missing OS
> keyring/secret-service backend. The main content area shows a
> **YouTube** account section with the status "Not connected. Nothing has
> been authorized yet," a teal **Connect** button, and an orange error
> message explaining that the YouTube connection is unavailable because
> WebFlix lacks an operator-provisioned OAuth client in this build. No
> video or media content is currently playing or displayed on the
> screen."

Honest notes: the `01-*-home.png` captures show the state **after the
harness's full nav walk** (Settings tab active) — the same harness
convention as the `ubuntu-33681f7` lane; the smoke script is unchanged.
The VLM pass was delayed ~40 minutes by a transient account-level 429
wall; all 12 screenshots were described in one final pass.
