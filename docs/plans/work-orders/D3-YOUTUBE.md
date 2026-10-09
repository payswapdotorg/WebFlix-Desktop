# WORK ORDER — D3-YOUTUBE (Worker 3, Phase 1)

You are Worker 3 on the WebFlix-Desktop three-worker team. TL2 has frozen the Phase-1 contracts (freeze commit: `5549208` — substitute the SHA given in your dispatch message if different). Your lane: **connector registry and the first real YouTube integration**.

## 0. Binding rules

- Work ONLY on your branch `d3-youtube`, created from the freeze SHA. Never push to main; TL2 merges serially.
- Allowed paths: `packages/catalog/**`, `packages/connectors/**`, `packages/playback/**` (new packages), plus the workspace registration entries TL2 pre-created at freeze. Forbidden: `packages/desktop/**` (Worker 1), `packages/webflix-contracts|domain|application|local-library/**` (Worker 2 — you CONSUME contracts via `src/index.ts`, you never edit them), root config, `docs/adr/**`.
- ADR-0003 is BINDING: YouTube-first, per-user identity, official surfaces only (Data API v3 + IFrame Player API), NO shared operator session, NO scraping, NO private endpoints, NO cookie replay, NO undocumented gap fillers. Every capability row cites its official source (your AUDIT-SOURCES tables seed these).
- Evidence rules: every command lists command line, exit status, totals. Provider verification names source, account mode, test date and tested operations; no credentials in code/tests/logs/reports. A fixture/mocked test proves only its stated contract behavior — the real-provider smoke is separate and explicitly labeled. Your sandbox is ~4GB RAM: typecheck + hermetic tests are the gate, not the vite build.

## 1. Setup

```bash
cd ~ && rm -rf d3 && mkdir d3 && cd d3
git clone https://github.com/payswapdotorg/WebFlix-Desktop.git repo
cd repo && git checkout 5549208 && git checkout -b d3-youtube
git rev-parse HEAD
```

Read first: AGENTS.md, docs/adr/architecture-lock.md, docs/adr/0002-provider-capabilities-and-playback.md, docs/adr/0003-youtube-first-per-user-identity.md, docs/adr/capability-registry.md, docs/adr/provider-policy-matrix.md, docs/plans/contract-freeze.md (§2.2 playback, §2.3 capability, §2.5 account, §4 lane map, §6 decisions), docs/plans/audits/AUDIT-SOURCES.md (YOUR audit — its capability/policy tables are your seed data), docs/plans/worker-protocol.md.

## 2. Deliverables (from desktop-roadmap.md Lane D3 + ADR-0003)

1. **`packages/catalog`** — catalog domain over the locked contract types (CatalogItem/ProviderAsset/MediaKind, merge with MatchEvidence, ambiguous matches stay separate).
2. **`packages/connectors`** — the connector registry: `ConnectorManifest` per provider (per-operation `OperationCapability` with CapabilityStatus vocabulary — unknown is honest and distinct from unsupported), seeded from your AUDIT-SOURCES policy rows; the YouTube connector implementing the officially supported operations ONLY: browse/search/metadata via Data API v3 (quota-cost-aware), official playback via IFrame Player embed spec (PlaybackPlan `official-embed`), per-user authorization via the reviewed supported OAuth 2.0 flow (installed-app or TV-limited-input; tokens through CredentialPort — never renderer-visible, never logged); honest requires-auth/unsupported/rate-limited states everywhere; refresh + revocation handling; every operation cites its official source link in the manifest.
3. **`packages/playback`** — typed PlaybackPlan resolution (the §2.2 discriminated union): official-embed for YouTube, local-file delegation to the local-library adapter path, `unavailable` with UnavailableReason/RecoveryHint for everything not officially supported. Progress tracking is WebFlix-owned PlaybackProgress, distinct from provider history; provider writes are explicit connector ops.
4. **Policy evidence pack**: the provider-policy rows from your audit, updated with any implementation-time discoveries, committed as the connector manifest's provenance (per-row official source links + open questions).
5. **Tests**: contract tests for every manifest operation + zod round-trips; hermetic unit tests with recorded fixtures (clearly labeled fixture-only); ONE real-provider smoke if and only if the operator provides a test API key through the sanctioned channel — otherwise mark the live smoke as pending-operator-credential and prove everything else hermetically.
6. **First real YouTube browse/search/watch path**: the end-to-end composition (catalog → connector → playback plan) consumable by D1's shell through public entrypoints, with honest states for every failure mode in the contract vocabulary.

Non-goals: persistence schema (D2), UI (D1), any second provider (Phase 3), any unofficial API surface, ad blocking/skipping, background-play workarounds — the IFrame Player terms govern.

## 3. Final report (your LAST chat message)

```
# D3-YOUTUBE RELAY BUNDLE — Worker 3 — base 5549208
## 1. Branch and commits (branch name, head SHA, one-line per commit)
## 2. Changed files by deliverable (path list)
## 3. Commands run (command | exit | totals)
## 4. Test evidence (suite | pass/fail | hermetic/fixture/live class)
## 5. Manifest excerpt (operation | status | official source link)
## 6. Authorization flow design (flow, token boundary, refresh/revocation)
## 7. Known limits and handoffs (what D1/D2/TL2 must know; live-smoke status)
```

End with the exact line: `D3-YOUTUBE COMPLETE`

Narrate progress in chat as you go (TL2 monitors the live transcript). One final self-contained report message. If a policy constraint blocks a roadmap-desired operation, render it honestly as unsupported and flag it in your report — never improvise an undocumented mechanism.

## 5. ADDENDUM (TL2, 2026-10-09 — all Phase-1 lanes)

`packages/webflix-*`, `catalog`, `connectors`, `playback` and `local-library` do NOT exist at the freeze SHA 5549208 — Worker 2 creates the contract packages on branch `d2-local`. Therefore:

- **D2 (Worker 2)**: you own the canonical implementation of exactly the locked §2 shapes — every other lane codes against your public entrypoints after TL2 integration.
- **D1 / D3 (Workers 1, 3)**: implement against the LOCKED SHAPES in `docs/plans/contract-freeze.md` §2 using local type declarations in YOUR OWN owned paths only (e.g. `packages/webflix-shell/src/contract-types.ts`, `packages/connectors/src/contract-types.ts`), each file clearly marked `// swap-at-integration: re-point to packages/webflix-contracts at TL2 merge`. NEVER create, stub or edit another lane's package paths. At TL2 serial integration, imports re-point to the real packages and the local mirrors are deleted.
