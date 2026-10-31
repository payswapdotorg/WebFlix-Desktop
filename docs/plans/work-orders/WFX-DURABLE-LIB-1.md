# WFX-DURABLE-LIB-1 — the durable local-library/history bridge

## Identity

- Work ID: WFX-DURABLE-LIB-1
- Requirement IDs: WF-004 (local library), WF-007 (resume and history), WF-021 (history/retention controls)
- Owner: TL3 (takeover lane)
- Branch: main (takeover-lane precedent: single branch, sequential commits)
- Base SHA: 6215497
- Contract version / prerequisite SHA: contracts 0.15.0 (no public-contract change); store migrations 0001–0007 at base

## Objective

Close the standing residual named in `docs/operations/recycle-recovery-2026-10-31.md`
("The durable local-library/history bridge (later order)") and pinned in
`docs/testing/wfx-parity-evidence.md` rows History + Library/You: the renderer's
watch history and local library are SESSION-scoped today (honestly labeled
"session-only … the durable local-library bridge is a later order"); the
migration-backed SQLite store (`packages/local-library`) exists, is tested, and
is wired to NOTHING.

User-visible outcome after this wave:

1. **Watch history survives restart** — what the user watched (and where they
   stopped, for local-file playback) reappears on the History screen and the
   Home continue rail after an app restart, on the same device profile.
2. **The local library survives restart** — files imported through the picker
   persist as durable device-local entries (path + fingerprint + metadata);
   after restart the entries re-list, missing files are marked honestly, and
   present files play again through a store-backed local protocol (no
   re-picking).
3. **Local-file playback records progress** — the existing-but-dead
   `recordProgress` seam is wired to the `<video>` player (timeupdate/pause/
   ended), positions persist, and continue cards resume from the stored
   position (auto-seek on play).
4. **Retention controls act on the REAL stores** — Settings pause/resume and
   the history reset scope now clear/pause the durable watch history (today a
   reset reports `removed.history: 0` against a never-written in-memory double
   while the visible History screen keeps its rows — two disconnected stores,
   both unified by this wave).

## Non-goals

- **Provider (YouTube IFrame-embed) position reporting is NOT wired**: the
  official embed runs without the JS API by design (no pinned origin; policy
  review is the gate for enabling it). Watch events for provider items still
  record (as today: positionMs 0 at play start).
- **Collections durability UI**: the UI has no collection-creating surface
  (host passes `collections: []`); no fake UI is added. The store's collection
  tables remain available for a later order.
- **Provider-metadata REFRESH on TTL expiry**: expired payloads are DELETED
  (the freeze §7.5 refresh-or-DELETE choice; refresh needs a live provider
  round-trip per item — recorded follow-up). The WebFlix-owned facts
  (itemId/timestamps/position) persist indefinitely per the same rule.
- **Cloud sync of any kind** (data-ownership: local-only initially).
- **Backup/restore UI**: the store's own tested backup seam is what the
  durability claim rides on; no new UI.

## Allowed and forbidden paths

- Allowed:
  - NEW `packages/local-library/src/db/migrations/0008_watch_history.ts`,
    NEW `packages/local-library/src/watch-history-store.ts` (+ tests),
    MODIFIED `packages/local-library/src/{store.ts,index.ts}`
  - NEW `packages/desktop/src/main/webflixLocalLibraryIpc.ts` (+ test),
    NEW `packages/desktop/src/main/webflixLocalProtocol.ts`,
    MODIFIED `packages/desktop/src/main/index.ts`
  - NEW `packages/desktop/src/preload/webflixLocalLibraryBridge.ts`,
    MODIFIED `packages/desktop/src/preload/index.ts`
  - NEW `packages/desktop/src/renderer/src/webflix/{localLibraryBridge,durableHistorySource}.ts` (+ tests)
  - MODIFIED renderer webflix modules: `mediaHostSupport.ts`, `localLibrarySession.ts`,
    `boot.tsx`, `watchPlan.ts`, `retentionSession.ts`, `__tests__/…`
  - MODIFIED `packages/webflix-shell/src/components/{WatchScreen,LibraryScreen,AppShell}.tsx`,
    `packages/desktop/src/renderer/src/webflix/WebFlixHostView.tsx`,
    `packages/webflix-shell/tests/shell.test.tsx`
  - MODIFIED `packages/desktop/package.json`, `packages/desktop/tsup.config.ts`
  - MODIFIED `packages/desktop/scripts/e2e/webflix-packaged-smoke.mjs` (the restart re-pin)
  - Docs: `docs/plans/work-claims.md`, this order, `docs/product/requirements-matrix.md`,
    `docs/testing/wfx-parity-evidence.md`, `docs/operations/recycle-recovery-2026-10-31.md`
- Forbidden: `packages/webflix-contracts/**` (no contract change), the agent
  CLI/runtime trees, `packages/desktop/src/main/webflix/identity*.ts` (frozen),
  every other lane's owned roots.
- Shared-file owner: local-library is Worker-2's lane — no active claim exists
  (all rows DONE); this wave adds one migration + one store class following
  the existing per-concern store pattern, with tests, and does not touch the
  existing migrations or store classes.
- Architecture policy update needed: none (no new package root; local-library
  is already a managed module).

## Dependencies and parallelism

- Must land first: none (base 6215497 is the final candidate tree).
- Can run concurrently with: nothing (single-lane takeover).
- Merge order: store → IPC → preload/renderer → shell → smoke re-pin → docs.

## Contract and state

- Public interfaces used: `MediaWatchHistorySource` (webflix-application,
  frozen seam — unchanged), `openStore`/`WebFlixStore` (local-library),
  `resolveWebFlixVaultDataRoot()` (osVaultAccountStore pattern), the
  `webflix:<domain>:<action>` IPC channel family + preload mirror + renderer
  accessor pattern (webflixAccountIpc family).
- Public interface changes proposed: NONE to webflix-contracts. Additive store
  API inside local-library (migration 0008 + WatchHistoryStore). New IPC
  channels (additive): `webflix:local-library:{status,history:list,
  history:record-watch,history:record-progress,history:clear,entries:list,
  entries:add,entries:remove}`.
- State owner: the main process owns the ONE store instance
  (`<webflix data root>/library/webflix.db`, dev `~/.webflix-dev/library/`,
  packaged `~/.webflix/library/` — device-scoped per the ownership table). The
  renderer never sees a path or a secret; it sees typed results.
- Event order: recordWatch/recordProgress are fire-and-forget write-throughs
  (session cache first — the session remains the read path for the current
  session; the durable store is merged at boot and on read fallback). No
  timeout-masking of sync problems: the IPC answers typed
  `{kind:"ok"|"unavailable"|"refused", …}` and the renderer degrades to
  session-scoped behavior honestly (the same surface as today when no bridge
  exists).

## Storage design (freeze §7.5 / AS-Q8 applied)

`watch_history` table (migration 0008):

- `item_id TEXT PRIMARY KEY` — the canonical CatalogItem id
- `provider_id TEXT NOT NULL` — e.g. `youtube`, `local`
- `item_payload TEXT` — the canonical CatalogItem JSON as recorded at watch
  time (nullable — see TTL), plus the VideoCardView when one existed
- `payload_fetched_at INTEGER` — epoch ms; watching an item again IS the
  refresh (upsert sets it to now)
- `position_ms INTEGER NOT NULL DEFAULT 0`, `duration_ms INTEGER NULL`
- `watched_at INTEGER NOT NULL`, `updated_at INTEGER NOT NULL`

Laws applied:

- WebFlix-owned facts (item_id, timestamps, position) persist indefinitely.
- The item_payload is cached provider metadata → 30-day refresh-or-delete
  (PROVIDER_METADATA_TTL_MS); the sweep (at store open + before list reads)
  nulls expired payloads; rows survive as facts but stop rendering (no card
  without the item). `provider_id = "local"` is WebFlix-owned end-to-end
  (file facts, not provider metadata) → exempt from the TTL.
- Local library entries ride the EXISTING LibraryEntry tables (path,
  fingerprint, missing marking, markEntriesMissing on boot stat) — the
  session import flow additionally persists entries when an OS path was
  resolved; restored entries mint their CatalogItem id from the durable
  LibraryEntry id (stable across restarts, so history rows correlate).

## Local playback protocol

`webflix-local://` — a privileged scheme registered in main
(`registerSchemesAsPrivileged` + `protocol.handle`), range-aware (206 +
Content-Range via createReadStream slices) so `<video>` seeking works. The
handler resolves ONLY durable entry ids through the store (entryId → stored
path, refused when missing/unsafe) — never a caller-supplied path. Absolute
paths never enter the renderer (device-scoped paths stay in main, per the
ownership table).

## Verification plan (real gates only)

1. local-library battery (hermetic temp dirs): migration 0008 pins +
   WatchHistoryStore unit tests (upsert/refresh semantics, TTL nulling,
   local-provider exemption, continue-watching filter, clear).
2. Desktop main battery: webflixLocalLibraryIpc.test.ts (mock-electron
   pattern + preload channel mirror pin + typed refusals + flavor gate +
   data-root fail-closed) and the protocol handler test (range slicing,
   missing-file refusal, entry-id-only resolution).
3. Renderer battery: durableHistorySource (session+durable merge, bridge-absent
   byte-fallback to session behavior), localLibrarySession durable mode
   (persist-on-import, restore, missing handling), bootIntegration additions,
   retentionSession durable adapters (pause-aware append, reset clears the
   real store, honest counts).
4. Shell battery: WatchScreen onProgress/initialPositionMs pins, LibraryScreen
   durable wording pins.
5. `pnpm typecheck`, `pnpm lint` on touched paths, scoped vitest runs, then the
   FULL battery (the station precedent: scoped realignment if oxfmt OOMs).
6. Dev-tier live verification: relaunch the stack under the console, CDP-verify
   import → play → progress → restart → restored entry + history + resume.
7. Journey + dev smoke re-run under the exclusive-port protocol.
8. Packaged tier: the smoke's restart step re-pinned honestly
   (`restart:durable-library-restored`: the imported file's entry re-lists
   after the same-HOME restart and plays again through the protocol; a history
   restart assertion joins it) — verified by the CI packaged run on push; if
   the engine fallback or the native policy blocks packaging, the failure is
   recorded honestly, never worked around.

## Honest states (no fake success)

- No bridge (non-desktop runtime / IPC absent): session-scoped behavior,
  byte-equivalent to today, stated in the UI.
- Store open failure (no engine): IPC answers typed `unavailable` with the
  engine error class; renderer degrades to session-only honestly.
- Missing files: entries list with a visible missing state; playback refuses
  with the honest reason; nothing is silently dropped.
- Provider-item history after TTL: the card disappears (payload deleted), the
  facts remain (retention counts explain the boundary).

## Verification record (executed, 2026-10-31 — the honest numbers)

Batteries (all green):

- Full root battery: **91 files / 1984 tests** (`pnpm exec vitest run`, exit 0)
- Renderer battery: **20 files / 223 tests** (`vitest --config
  packages/desktop/src/renderer/vitest.config.ts`, exit 0)
- Shell component battery: **307 tests** (`pnpm --filter webflix-shell
  test:components`, exit 0) — includes the new WatchScreen playhead/resume
  pins + the LibraryScreen durable-wording re-pin
- local-library: 216 tests incl. the migration-0008 re-pins (the
  7→8-count chain) + the new SqliteWatchHistoryStore suite (16) + the
  sqlite-adapter fallback battery (the two live-Electron findings, pinned)
- `pnpm typecheck` exit 0; `pnpm exec oxlint` 0 errors on every touched
  path (74 pre-existing warnings repo-wide, non-gating per the standing
  state); desktop tsup main/preload/host/scheduler all green with
  local-library inlined (renderer vite build OOMs — the known station
  limit, non-blocking)

Live verification (CDP against the running dev stack, the golden path):

1. The durable store opens under the dev identity root
   (`<bridge runtime-home>/.webflix-dev/library/webflix.db`), engine
   **node:sqlite** — after TWO live-caught findings were fixed:
   - **F1 (adapter)**: under Electron, a system-Node-built better-sqlite3
     IMPORTS but its INSTANTIATION throws the ABI mismatch — the adapter now
     degrades on constructor failure (pinned by adapter-fallback.test.ts).
   - **F2 (bundler)**: tsup's ESM code-splitting strips the `node:` prefix
     from dynamic imports (`import("node:sqlite")` → `import("sqlite")`),
     which does not resolve to the builtin under Electron's ESM loader — the
     fallback now loads through `createRequire` + `require("node:sqlite")`
     (the desktop services chunks' own proven pattern).
2. Import → the entry lists + persists (entryCount 1) with the honest
   durable metadata (osPath + durability).
3. Play → the throttled playhead records (paused at 3.965s → the durable
   row's positionMs 3965/6000).
4. **Restart** → the entry re-lists (the restored durable id), the history
   row survives, and the restored entry plays through the AUTHORIZED
   `zcode-media://` preview URL (duration loads — the native file loader
   owns Range/seek).
5. **The resume seek lands at exactly the pre-restart pause position**
   (3.965s) — the id-correlation law (importFilesDurable adopts the stable
   durable id as the catalog id; a third live finding, fixed in-wave) is
   what makes the restart's restored entry correlate with its own history.

Companion gates, same tree: the journey **18 PASS / 0 FAIL / 2 BLOCKED**
(the standing dispositions unchanged — composer gate's packaged venue +
the credentials round-trip) and the dev smoke **11/11** (exit 0), both
under the exclusive-port protocol.

Packaged tier (VERIFIED on the station against the CI artifacts —
run 41205642822 @ 30cf8ac, completed success; the workflow builds the
artifacts, the tier-6 smokes run against them on-station per the
established protocol): **deb 37/37 + AppImage 35/35**, the restart
durability gates PASSING in BOTH lanes — `durable-library-restored` (the
entry re-lists; engine=node:sqlite live in the packaged app) and
`durable-history-restored` (positionMs 1213 deb / 1184 AppImage restored
across the same-HOME restart, playback through the authorized
zcode-media:// preview URL). better-sqlite3 pruned from the packaged app
by the native policy — the adapter's node:sqlite fallback is the
packaged engine (the same engine the dev tier live-runs).

Two smoke-harness findings fixed on the way (the product code was
correct — a raw-CDP probe against the packaged app proved the durable
import works before either harness change):
- Playwright's setInputFiles over a connectOverCDP session attaches
  DataTransfer-built Files that carry NO OS path (webUtils answers
  null; the durable import honestly degraded session-only) — the smoke
  now attaches via raw CDP DOM.setFileInputFiles, the SAME path-backed
  File a real picker produces (commit 05bd293).
- The first shutdown raced the ~1s playhead heartbeat — the smoke now
  polls the REAL durable row (bounded, never a blind sleep) before
  shutting down, recorded as `local-media:durable-progress`.

Evidence: scripts/e2e/evidence/ubuntu-30cf8ac (the first run's honest
failure set — the null-path metadata is the finding's before-evidence)
and ubuntu-30cf8ac-rerun (the verified sets: both lanes green).

Honest scope notes (unchanged from the order): provider (IFrame-embed)
positions stay unreported (no JS API by design); collections durability UI
deferred (no fake UI); the retention preference stays session-scoped; the
§7.5 TTL refresh-vs-delete chooses DELETE for expired provider payloads
(refresh needs a live provider round-trip — recorded follow-up).

## Post-landing verification (takeover lane, same day @ 477702f)

The wave's records were re-verified against the tree (the standing
discipline: never trust the self-report). Three evidence-hygiene findings,
all closed in this follow-up:

1. **The deb lane's rerun results.json was CLOBBERED** — the rerun was two
   separate harness invocations against the same `--out` dir (deb first,
   appimage second); `results.json` is written whole per invocation
   (webflix-packaged-smoke.mjs:1108), so the appimage invocation overwrote
   the deb lane's 37/37 record. The deb run itself was always real
   (main-deb.log + 6 PNGs + home-deb snapshot committed; the committed
   `home-deb/.webflix/library/webflix.db` carries the durable proof:
   watch_history positionMs **1213**/3000, library_entries 1, entry id ==
   item_id — the id-correlation law holds at the artifact level).
   CLOSED: the deb lane RE-RUN at this tree (harness @ 477702f, same CI
   artifacts from run 41205642822 @ 30cf8ac — API-verified
   completed/success) into a fresh dir: **evidence/ubuntu-30cf8ac-deb-rerun
   — 37/37, 0 failed, 0 blocked**, both durability gates PASSING
   (`restart:deb:durable-library-restored` engine=node:sqlite entries=1;
   `restart:deb:durable-history-restored` positionMs=1167/3000), exit 0.
   The appimage lane's committed DB verified the same way (positionMs
   **1184** — matches its results.json assertion).
2. **Commit 477702f's message says "AppImage 35/37"** — a typo for 35/35;
   the honest number is the artifact's: results.json 35 assertions, 35 ok,
   0 blocked (the deb-only `packaged-deb:deb:{control,icons}` pair is why
   the lanes carry different totals: 37 vs 35).
3. **The "dev smoke 11/11" companion-gate claim had no artifact at this
   tree** (the archived log was the 04:04 recycle-9 run). CLOSED: re-run at
   477702f — evidence/wfx/wfx-smoke-run-2026-10-31-durable.log, **11/11,
   exit 0**.

Independent battery re-verification at 477702f (all exit 0): full root
battery **92 files / 1984 tests** (the order's "91 files" was the wave-era
count; the test total is identical), renderer **20 files / 223**, shell
**18 files / 307**. wfx-parity-evidence.md's stale "session-scoped
history" follow-up line removed (superseded by this wave; the matrix rows
already carry the durable state).
