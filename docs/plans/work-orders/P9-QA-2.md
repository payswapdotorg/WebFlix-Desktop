# P9-QA-2 — Packaged smoke re-run on the fixed SHA (close F1/F2, finish the release candidate)

Order owner: TL2. Worker grant: single worker lane (any free worker).
Base: `origin/main` @ the P9-FIX-1 merge head **`0125462`** (verify `git rev-parse HEAD` after checkout; if origin/main moved past this, still branch from `0125462` and note the drift in your report).

## Context (binding)

- P9-QA-1 (merged) ran the tier-6 packaged smoke on the `33681f7` artifacts and recorded **two honest FAIL findings**: F1 (runtime self-registers a ZCode-branded user-level desktop entry `zcode.desktop`) and F2 (runtime creates `~/.zcode/cli/db/db.sqlite`). Evidence: `docs/operations/ubuntu-release-evidence.md` ("Findings (open…)" section) + `packages/desktop/scripts/e2e/evidence/ubuntu-33681f7/{deb,appimage}/results.json`.
- P9-FIX-1 (merged at your base) fixed both: F1 profile-driven WebFlix deep-link registration, F2 identity-scoped CLI data root (`~/.webflix`) + `ZCODE_SESSION_DB_PATH` spawn-env pinning. Unit pins prove the resolution logic per flavor; the packaged end-to-end proof is THIS order.
- The release candidate is NOT clean until the packaged smoke re-run passes on a **fresh CI build of the fixed SHA**. This order is that re-run. On green evidence the 9-item release-candidate checklist closes and Phase 9 is complete.

## Allowed paths (HARD LAW)

- `packages/desktop/scripts/e2e/**` — ONLY mechanical run-mode adjustments if the existing harness itself fails to run (record exactly what and why); do not weaken any assertion.
- `packages/desktop/scripts/e2e/evidence/ubuntu-0125462/**` — the NEW evidence directory (results, screenshots, logs) for this re-run.
- `docs/operations/ubuntu-release-evidence.md` — close F1/F2, record the fresh CI run + evidence pointers, refresh the release-candidate checklist status.
- Nothing else. No product code, no renderer/shell, no electron-builder/workflow YAML, no claims ledger (TL owns it). If a product defect resurfaces on the fresh artifacts, do NOT patch it — record it as a finding and STOP (a fix lane would follow).

## Requirements

1. **Record the base battery at `0125462` BEFORE anything else** (verbatim counts): `corepack pnpm run fmt:check` / `lint` / `architecture:check` / `typecheck`; `test:unit`; `test:integration`; renderer battery (`vitest run --config packages/desktop/src/renderer/vitest.config.ts`); shell battery (`pnpm --filter webflix-shell run test:components`). Expected at this base: fmt PASS 3431 files, lint 69w/0e, arch 0/0/0, unit 78 files/1712 tests, integration 1/1, renderer 9/100, shell 10/135 (tsc -b exit 0). If `typecheck` OOM-aborts, split per-project and record exactly which projects completed.
2. **Trigger a FRESH `webflix-ubuntu-build` workflow_dispatch CI run on ref `0125462`** (GitHub API with the PAT; never echo it). Record the run id + run URL. Wait for completion (poll the API; the prior lane's run took ~35 min). From the completed run download the `.deb`, `.AppImage` and manifest artifacts; record byte sizes + sha256 digests.
3. **Run the tier-6 packaged smoke on the FRESH artifacts** with the existing harness (rootless `dpkg-deb -x` deb tree + `--appimage-extract` AppImage, fresh `HOME` + own `Xvfb` per lane, CDP via playwright-core, real file-picker import + real playback). Key assertions this re-run must now show PASS:
   - `desktop-entry:webflix:user-level` — the user-level entry is `webflix.desktop` with WebFlix identity fields (Name=WebFlix, Icon=webflix, `MimeType=x-scheme-handler/webflix;`, WebFlix comment); no `zcode.desktop` is written by the WebFlix runtime.
   - `data-root:webflix:no-zcode-root` — the CLI session store lands under `~/.webflix/cli/db/db.sqlite`; NO `~/.zcode` directory is created by the packaged runtime.
4. **No regressions**: the remaining deb/AppImage assertions hold at the P9-QA-1 levels (then 33/35 + 31/33 with F1/F2 as the honest fails; now expected all-PASS, or an honest accounting of any environment-limited item). YouTube authorized-account assertions remain **BLOCKED per the standing operator order — never reported as passed**.
5. **Evidence**: write the new evidence dir `packages/desktop/scripts/e2e/evidence/ubuntu-0125462/{deb,appimage}/results.json` (same schema as the ubuntu-33681f7 records) + screenshots + logs; VLM-verify the screenshots describe the actual visible state. Update `docs/operations/ubuntu-release-evidence.md`: close F1/F2 in the findings section with pointers to the new passing assertions, record the fresh CI run id + artifact digests, and fill the 9-item release-candidate checklist (see P9-UBUNTU-WEBFLIX-1.md "Release-candidate acceptance") with evidence links per item.
6. **Head battery after the evidence lands** (the delta is evidence/docs only — counts must match base; if `fmt:check` flags the new files, apply the standing oxfmt realignment to ONLY the new files and record the final counts).
7. **Push branch `p9-qa-2`** (PAT in remote URL; never echo/commit it) and verify `git ls-remote origin refs/heads/p9-qa-2`.
8. **Final message with markers** `=== P9-QA-2 REPORT BEGIN ===` … `=== P9-QA-2 REPORT END ===` containing: BASE sha, CI RUN (id + URL + fresh artifact digests), SMOKE RESULTS (verbatim counts, deb + AppImage, with the F1/F2 assertions explicitly listed PASS), EVIDENCE (paths + screenshot count + VLM verification), HEAD BATTERY (verbatim counts), RELEASE-CANDIDATE CHECKLIST (the 9 items, each with status + evidence pointer), HONEST LIMITS (numbered).

## Non-goals

- No product code changes (a resurfaced defect is a recorded finding, not a patch).
- No public production release, homepage/author metadata, or update-feed work.
- No re-litigating the F1/F2 unit pins (merged at your base).

## Field notes (from your fleet's history — binding lessons)

- NEVER report a claimed result without a real run. Record commands + counts verbatim.
- CI artifacts expire — download the fresh run's artifacts promptly after completion and verify digests against the manifest.
- The station has 3.9GB shared RAM: if `typecheck` (tsc -b) OOM-aborts, split it per-project and record exactly which projects completed.
- Do not touch the claims ledger (docs/plans/work-claims.md) — the TL owns it.
