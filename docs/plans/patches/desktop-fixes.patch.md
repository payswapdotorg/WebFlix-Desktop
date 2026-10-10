# Patch spec — desktop defect fixes + isolation flags (D2-LOCAL, milestone 3/4)

**Lane:** WebFlix-Desktop D2-LOCAL · Worker 2 · milestone 3/4
**Status:** SPEC ONLY — deliberately NOT applied in this environment (the desktop package's build tooling is not available here). The testable logic ships as pure, vitest-green modules in `packages/webflix-shell` (§3); the desktop maintainer applies this spec verbatim at integration time.
**Base:** the `d1-shell` branch base of the desktop files (snapshots in §5; the quoted anchors are authoritative if the live files have drifted).
**Lane commit:** `d1(fixes): updater guard + isolation flags (testable logic) + desktop patch specs`
**Depends on:** milestone 2 lane commit `d1(identity): frozen WebFlix identity values + desktop-product-identity patch spec` — Edit E of this spec imports the patched `desktop-product-identity.mjs` (webflix flavor with `devDataRoot: '~/.webflix-dev'`).

## 1. Scope — what this spec fixes (AUDIT-DESKTOP)

| Ref | Defect                                                                                                                                                           | Fix                                                                                                    | Specified in                                                   |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| (a) | Finding 7: `autoUpdater.ts:23` constructs the platform updater eagerly at import time; dev boots report version `0.0` (invalid semver) and crash in construction | Lazy + guarded init: skip construction on missing/invalid version, construct at most once              | §6.A, logic in `packages/webflix-shell/src/updater-guard.ts`   |
| (b) | Chrome cookie/localStorage/credential import IPC is registered unconditionally — reachable from any renderer                                                     | `chromeImportEnabled` (default OFF): NO handler registered while OFF → surface unreachable, not hidden | §6.B, logic in `packages/webflix-shell/src/isolation-flags.ts` |
| (c) | Product surfaces (Coding Plan/PayPal, CUA, Lark, SSH/Docker/WSL remotes, force-update) registered unconditionally                                                | `webflixProductSurface` (default OFF): gated registrations skipped entirely while OFF                  | §6.C (follow-ups §7)                                           |
| (d) | Every provider webview shares ONE `persist:zcode-embedded-browser` partition (`browserDataManager.ts:30`) — cross-provider session leakage                       | Per-provider-profile partitions derived purely from provider id + account key                          | §6.D                                                           |
| (e) | Dev scripts default the data root to the legacy `~/.zcode`                                                                                                       | Dev data root resolves through identity: `~/.webflix-dev`, and never a ZCode root                      | §6.E (follow-ups §7)                                           |

## 2. Normative references

- AUDIT-DESKTOP findings as mapped in §1 (finding 7 is the pinned citation `autoUpdater.ts:23`).
- freeze §6.1 (binding identity values) as mirrored in `packages/webflix-shell/src/identity.ts`.
- `docs/plans/patches/desktop-product-identity.patch.md` (milestone 2) — webflix flavor block, ZCode dev-AUMID fix, `linuxPackageBase` derivation. Edit E requires it applied first.

## 3. Testable logic shipped in this lane (already in-repo, vitest-green)

- `packages/webflix-shell/src/updater-guard.ts` — pure lazy/guarded init:
  `validateAppVersion` (strict semver; `0.0` rejected, `0.0.0` accepted),
  `initializeAutoUpdater(getVersion, constructUpdater)` (LAZY — construct only from the ready
  path; GUARDED — skip on missing/invalid version; ONCE — memoized per process),
  `safeCheckForUpdates` (never-throwing check). Pinned by `updater-guard.test.ts`:
  boot with `'0.0'` does NOT construct; valid version constructs exactly once.
- `packages/webflix-shell/src/isolation-flags.ts` — flag surface + policy:
  `DEFAULT_ISOLATION_FLAGS` (both `false`), `parseIsolationFlagValue` (fail-closed: only
  `1`/`true`/`yes`/`on` enable), `resolveIsolationFlags` (`WEBFLIX_*` over legacy `ZCODE_*`
  aliases per freeze §6.1), `ISOLATION_FLAG_POLICY` (documents the unreachable-IPC guarantee
  per flag), `requireFlagEnabled` / `FlagDisabledError`. Pinned by `isolation-flags.test.ts`.

Both modules are Electron-free and import-free (isolation-flags imports only `./identity`), so
they vendor into the desktop package unchanged.

## 4. Shared Edit 0 — vendor the pure modules into the desktop package

From the merge that contains both lane commits, run exactly:
