# WORK ORDER — D1-SHELL (Worker 1, Phase 1)

You are Worker 1 on the WebFlix-Desktop three-worker team. TL2 has frozen the Phase-1 contracts (freeze commit: `__FREEZE_SHA__` — substitute the SHA given in your dispatch message if different). Your lane: **WebFlix desktop shell and product identity**.

## 0. Binding rules

- Work ONLY on your branch `d1-shell`, created from the freeze SHA. Never push to main; TL2 merges serially.
- Allowed paths: `packages/desktop/**`, `packages/webflix-shell/**` (new), `packages/ui/**` (shell-facing presentation components only, coordinate via your work order), plus test/e2e/CI scaffolding files named below. Forbidden: `packages/webflix-contracts|domain|application|local-library|catalog|connectors|playback/**` (other lanes), root config and `.github/workflows/*` (TL2-owned — submit proposed workflow files as a patch in your relay bundle, do not commit them), `docs/adr/**`.
- Consume other lanes' packages ONLY via their public entrypoints (`src/index.ts`) at their freeze versions.
- Evidence rules: every command lists command line, exit status, totals; pre-existing failures recorded as pre-existing (baseline: 70 lint warnings, 216 desktop type errors — you must add ZERO new in owned paths); GUI evidence lists OS/display assumptions, route and observed outcome. No credentials, no private media, no ZCode `~/.zcode` writes ever.
- Your sandbox is ~4GB RAM: the renderer production build (vite) OOMs — do NOT gate on `pnpm build`; gate on typecheck + dev-launch GUI smoke (the known-good pattern: version-injecting dev wrapper, see AUDIT-DESKTOP §5).

## 1. Setup

```bash
cd ~ && rm -rf d1 && mkdir d1 && cd d1
git clone https://github.com/payswapdotorg/WebFlix-Desktop.git repo
cd repo && git checkout __FREEZE_SHA__ && git checkout -b d1-shell
git rev-parse HEAD
```

Read first: AGENTS.md, docs/adr/architecture-lock.md, docs/adr/0003-youtube-first-per-user-identity.md, docs/plans/contract-freeze.md (§4 lane map + §6 decisions — they are BINDING for you), docs/plans/audits/AUDIT-DESKTOP.md (your own audit — its §6 retain/adapt/isolate/remove list is your backlog), docs/plans/audits/AUDIT-DATA.md (data-root and store context), docs/plans/worker-protocol.md.

## 2. Deliverables (from desktop-roadmap.md Lane D1 + contract-freeze §6)

1. **Isolated dev data root**: dev scripts default to `~/.webflix-dev` (never `~/.zcode`); `dev:desktop:prod`-style shared-root launch is blocked or re-rooted for WebFlix work (freeze §6.8).
2. **WebFlix identity flavor** via `desktop-product-identity.mjs`: appId `org.webflix.desktop`, productName `WebFlix`, scheme `webflix://`, data root `~/.webflix`, dev AUMID `org.webflix.desktop.dev`, Linux package names `webflix-desktop*`; `ZCODE_*` env kept as aliases during migration. Packaging identity test matrix (per-flavor assertions + ZCode/WebFlix coexistence: separate userData/AUMID/package names).
3. **Navigation shell + YouTube-oriented home/search/watch shell** (`packages/webflix-shell`): consumes `webflix-contracts` + `webflix-application` types (CatalogItem, PlaybackPlan, CapabilityStatus, ProviderAccountRecord); renders CapabilityStatus honestly (loading/empty/error/offline/auth-required/unsupported states — no dead controls); product UI visibly distinguishes WebFlix from YouTube and leaves room for independent value (ADR-0003).
4. **Connected-account surfaces**: per-provider account list/add/remove/re-auth UI against the contract's ProviderAccountRecord (renderer-safe, no tokens); per-provider-profile browser partitions (replaces the shared `persist:zcode-embedded-browser` partition — you own mechanics + isolation tests: cookies under partition A invisible to B).
5. **Isolation flags**: Chrome bulk cookie/localStorage/credential import feature-flag OFF by default + IPC unreachable when off (test); `webflix-product-surface` flag default OFF gating Coding Plan/PayPal, CUA helper, Lark SDK, SSH/Docker/WSL remotes, force-update prompt — unreachable-when-off IPC/menu tests.
6. **Pre-existing defect fixes assigned to D1**: autoUpdater.ts:23 eager construction → lazy/guarded init (dev-launch E2E on Linux must boot without the version wrapper); missing `version` field handling in dev.
7. **Gate extension + test infra** (your audit §6 ADAPT-5): root typecheck extended to desktop main/preload/renderer/scheduler tsconfigs with `noEmit` (216-error baseline file, zero new); clean-tree guard (git status clean after gates); E2E runner (Playwright _Electron_ or equivalent) + `pnpm test:e2e` running headless on Linux asserting the acceptance minimum (launch, navigate, empty states); proposed GitHub Actions workflow files delivered as a patch (TL2 owns the merge).
8. **GUI smoke evidence**: real dev-launch (Xvfb) screenshots/logs — window created, renderer dom-ready, navigation between shell routes, empty states visible.

Non-goals: any YouTube data wiring beyond contract-typed stubs (D3), any persistence schema (D2), telemetry beyond default-off verification, packaging/signing/release.

## 3. Final report (your LAST chat message)

```
# D1-SHELL RELAY BUNDLE — Worker 1 — base __FREEZE_SHA__
## 1. Branch and commits (branch name, head SHA, one-line per commit)
## 2. Changed files by deliverable (path list)
## 3. Commands run (command | exit | totals | new-vs-baseline)
## 4. GUI smoke evidence (OS/display, route, observed outcome, log excerpts)
## 5. Isolation test evidence (partition/flag-unreachable results)
## 6. Known limits and handoffs (what D2/D3/TL2 must know)
## 7. Proposed TL2-owned files (workflow patch, root config diffs)
```

End with the exact line: `D1-SHELL COMPLETE`

Narrate progress in chat as you go (TL2 monitors the live transcript). One final self-contained report message. If blocked (tools lost, contract gap), say so explicitly in chat and stop — do not improvise around the contract.
