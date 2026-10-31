# Recycle recovery + final-tree journey verification — 2026-10-31

Audience: the next TL. This is the honest record of sandbox recycle #9 and the
verification wave that followed it. No conversation access is required.

## The event

The previous epoch ended in a hard box freeze mid-wave (the journey e2e attack,
runbook step 2 of that wave): every tool layer (shell, filesystem, subagent
spawn) went unresponsive for 2+ hours. The box came back **rebooted** — and the
reboot was a full sandbox reprovision, not a revive:

- `/home/z/webflix-desktop` — wiped entirely (repo + node_modules + out/)
- `.wfx-archive` bundle + the restore script with its LATEST marker — wiped
- `my-project/mini-services/desktop-bridge` (the :3033 bridge stack) — wiped
- `my-project` git history (the harness checkpoint commits) — reset to a fresh
  initial commit; the working tree is the stock scaffold
- Survivors: the GitHub remote (sole source of truth) and the credentials
  supplied by the operator

## The loss inventory (honest — what is gone and cannot be recovered)

1. **The local-only repo lineage at `6879cd5`** — the restore chain's HEAD from
   the previous epoch. It is absent from every remote ref; its in-flight
   journey-fix commit never landed anywhere. The remote's `main` at `e3dc1e2`
   is the only surviving lineage; the recovery below re-derives from it.
2. **The 36-step gapclose journey suite** (`wfxGapcloseSteps.mjs`,
   `wfxWatchUxSteps.mjs` — 36 steps, last recorded 31 PASS / 0 FAIL / 4
   BLOCKED at an older commit) — local-only files, never committed to any
   remote branch. Gone. The one defect it had surfaced (a TS non-null
   assertion inside a plain `.mjs`) was in a file that no longer exists
   anywhere; the surviving remote journey suite (below) parses clean.
3. **The desktop-bridge mini-service source** (:3033) — local-only under
   `my-project/mini-services/`, wiped with the harness tree. It is being
   rebuilt this wave (see the bridge note at the bottom).

## The recovery (verified, exact commands)

From the fresh clone of `main` @ `e3dc1e2` (307 commits):

- `pnpm install --frozen-lockfile` (pnpm 10.33.2, `ELECTRON_MIRROR`
  per mise.toml) — Done in 1m 57.7s, node-pty rebuilt against Electron
- `node scripts/build-desktop-agent-cli.mjs` — workspace dependency set +
  `apps/zcode-cli/packages/cli/dist/zcode.cjs` (16.0 MB at this tree), staged
  into `packages/desktop/bundled-agents/linux-x64/glm/`
- desktop `tsup` — out/{main,preload,host,scheduler} + the webflix flavor pin
  (`true ? "webflix" : void 0` in out/preload/index.cjs) verified
- `Xvfb :99 -screen 0 1440x900x24`

## The final-tree journey re-run (the interrupted wave's own goal)

The journey had last executed at `9383f35`; **seven commits** landed after it
without a re-run (web-look, agent-port-redeliver, zcode-open, netflix-source,
netflix-p45-look, anon-view) — exactly the residual the previous TL was
attacking when the box froze.

Environment: Linux sandbox 2 vCPU / 4 GB (3.5 GB free at launch — the :3000
tree parked per the exclusive-port protocol, :5175/:9334 verified free),
node v24.22.1, pnpm 10.33.2, Xvfb :99.

One journey fix was required first (commit `2d39708`, part of this wave): the
honest home-state step pinned the pre-anon tree where home was permanently
auth-gated. At the anon tree the home feed serves REAL keyless rows — a ready
feed with real cards is the equally-honest outcome (the never-invent law is
battery-pinned upstream of the check). The step now polls for either a phase
panel or the ready feed's real cards.

Results (`DISPLAY=:99 node scripts/e2e/webflix-wfx-journey.mjs`, exit 0):

- **18 PASS / 0 FAIL / 2 BLOCKED** (was 17/0/3 at 9383f35)
- `wfx-journey:mrbeast-live` **flipped BLOCKED → PASS, live**: resolveChannel
  resolved MrBeast over the anonymous public engine with 12 newest uploads —
  keyless, no operator Data API key involved. The standing C.1 gate is closed
  by the anon lane in practice (the keyed engine's precedence path remains
  pinned verbatim for when a key is provisioned).
- `wfx-home:honest-state` PASS — home ready with **20 real cards** from the
  public engine (live upstream, datacenter-egress ladder).
- Remaining BLOCKED (unchanged, honest): the composer mount (dev-tier lazy
  chunk — the packaged tier is its venue) and the live chat round-trip
  (provider credentials — the no-mock rule).
- Evidence: `scripts/e2e/evidence/wfx/wfx-{01..06}.png`,
  `wfx-journey-results.json`, `wfx-journey-run-2026-10-31.log`,
  `wfx-smoke-run-2026-10-31.log`.

Companion gates, same tree:

- `node scripts/e2e/webflix-smoke.mjs` → **11/11** (exit 0), incl. the
  gate-aware F2 dev-path pin
- `pnpm typecheck` (root `tsc -b`) → **exit 0**
- The full unit battery is recorded 1946/1946 (88 files) at `e3dc1e2` by the
  WFX-ANON-VIEW-1 wave's own gates; the only commit since touches an e2e
  `.mjs` outside every vitest project, so the battery was not re-run for this
  record (a decision, not an omission).

## The bridge (durable home changed)

The rebuilt desktop-bridge stack lives from this wave forward under
`my-project/mini-services/desktop-bridge` (bun, :3033) and is committed to the
harness repository's git — not just the local filesystem — so the next recycle
restores it from the harness instead of losing it. The operator-facing console
rides the harness web app (`/`).

## Standing residuals (unchanged by this wave)

- The OAuth consent round-trip BLOCKED on the operator's Cloud Console
  redirect registration (see wfx-parity-evidence.md C.4 — narrowed, zero code
  changes once registered).
- The packaged-tier composer mount + live provider round-trips (P9 packaging
  venue).
- The durable local-library/history bridge (later order).
