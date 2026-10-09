# WORK ORDER — D2-LOCAL (Worker 2, Phase 1)

You are Worker 2 on the WebFlix-Desktop three-worker team. TL2 has frozen the Phase-1 contracts (freeze commit: `5549208` — substitute the SHA given in your dispatch message if different). Your lane: **contracts / domain / local persistence**.

## 0. Binding rules

- Work ONLY on your branch `d2-local`, created from the freeze SHA. Never push to main; TL2 merges serially.
- Allowed paths: `packages/webflix-contracts/**`, `packages/webflix-domain/**`, `packages/webflix-application/**`, `packages/local-library/**` (all new packages), plus the workspace registration entries TL2 pre-created at freeze. Forbidden: `packages/desktop/**` (Worker 1), `packages/catalog|connectors|playback/**` (Worker 3), root config (TL2), `docs/adr/**`.
- The contract SHAPES in docs/plans/contract-freeze.md §2 are LOCKED. You implement them exactly; if an implementation reality forces a shape change, STOP and report it in chat as a TL2 decision (contract change = TL2 decision + versioning + changelog per worker-protocol).
- Evidence rules: every command lists command line, exit status, totals; tests are hermetic (no network, no real provider, fixture-only claims stated as fixture-only). No credentials in code/tests/logs — CredentialPort implementations read from the OS vault boundary only. Data root for ALL tests and dev: `~/.webflix-dev` (never `~/.zcode`).
- Your sandbox is ~4GB RAM: gate on typecheck + hermetic tests, never on the vite renderer build.

## 1. Setup

```bash
cd ~ && rm -rf d2 && mkdir d2 && cd d2
git clone https://github.com/payswapdotorg/WebFlix-Desktop.git repo
cd repo && git checkout 5549208 && git checkout -b d2-local
git rev-parse HEAD
```

Read first: AGENTS.md, docs/adr/architecture-lock.md (§3 dependency direction, §7 store rules), docs/adr/0003-youtube-first-per-user-identity.md (§2 per-user account model), docs/adr/data-ownership.md, docs/plans/contract-freeze.md (§1 package roots, §2 locked shapes, §4 lane map, §6 decisions), docs/plans/audits/AUDIT-DATA.md (YOUR audit — its findings are your implementation notes), docs/plans/worker-protocol.md.

## 2. Deliverables (from desktop-roadmap.md Lane D2 + AUDIT-DATA folds)

1. **`packages/webflix-contracts`** — the locked §2 shapes as TypeScript types + zod schemas + contract tests: catalog (CatalogItem/ProviderAsset/MediaKind/MatchEvidence), playback (PlaybackPlan discriminated union/UnavailableReason/PlaybackProgress), capability (CapabilityStatus/ConnectorManifest), library (LocalLibraryEntry/Collection/LocalPlaylist/WatchedState), account (ProviderAccountRecord/CredentialPort interface — implementations stay behind the OS vault), jobs (JobDescriptor/JobState), plus typed WebFlixError { code, reason, retryable, context }. Public entrypoint `src/index.ts` only; IPC payloads validate against the same zod schemas.
2. **`packages/webflix-domain`** — pure domain logic over the contracts (catalog merge with MatchEvidence confidence, library/collection rules, watched-state transitions, job retry/cancel semantics). No I/O, no Electron, no DB imports.
3. **`packages/webflix-application`** — use-cases orchestrating domain + ports (LocalStore port, CredentialPort, indexing port); dependency direction inward only (clients → adapters → app → domain → contracts).
4. **`packages/local-library`** — migration-backed SQLite store at the WebFlix data root (`~/.webflix`, tests `~/.webflix-dev`): adapt the mature `tasks-index.sqlite` WAL/migration blueprint from your audit (adapt the patterns, not the file); path-safe file/folder indexing (fingerprints, no media bytes in store); local library + collection CRUD; resume/watch state; **backup/restore** of the library store (Phase-1 deliverable, not deferred); profile-scoped data isolation.
5. **First-class test commands**: `pnpm test:unit` + `pnpm test:integration` (hermetic) wired into the workspace and passing; contract tests exercise every zod schema round-trip; migration tests prove forward-only + backup/restore round-trip.
6. **Credential boundary proof**: a test showing CredentialPort implementations never persist tokens outside the OS vault and never log token values (fixture-based, stated as fixture-only).

Non-goals: any provider connector (D3), any UI (D1), any Electron host code, telemetry.

## 3. Final report (your LAST chat message)

```
# D2-LOCAL RELAY BUNDLE — Worker 2 — base 5549208
## 1. Branch and commits (branch name, head SHA, one-line per commit)
## 2. Changed files by deliverable (path list)
## 3. Commands run (command | exit | totals)
## 4. Test evidence (suite | pass/fail | hermetic-or-fixture class)
## 5. Migration + backup/restore evidence
## 6. Known limits and handoffs (what D1/D3/TL2 must know)
## 7. Contract deviations found (or "none — shapes implemented as locked")
```

End with the exact line: `D2-LOCAL COMPLETE`

Narrate progress in chat as you go (TL2 monitors the live transcript). One final self-contained report message. If a locked shape cannot be implemented as specified, STOP and report in chat — do not silently deviate.

## 5. ADDENDUM (TL2, 2026-10-09 — all Phase-1 lanes)

`packages/webflix-*`, `catalog`, `connectors`, `playback` and `local-library` do NOT exist at the freeze SHA 5549208 — Worker 2 creates the contract packages on branch `d2-local`. Therefore:

- **D2 (Worker 2)**: you own the canonical implementation of exactly the locked §2 shapes — every other lane codes against your public entrypoints after TL2 integration.
- **D1 / D3 (Workers 1, 3)**: implement against the LOCKED SHAPES in `docs/plans/contract-freeze.md` §2 using local type declarations in YOUR OWN owned paths only (e.g. `packages/webflix-shell/src/contract-types.ts`, `packages/connectors/src/contract-types.ts`), each file clearly marked `// swap-at-integration: re-point to packages/webflix-contracts at TL2 merge`. NEVER create, stub or edit another lane's package paths. At TL2 serial integration, imports re-point to the real packages and the local mirrors are deleted.
