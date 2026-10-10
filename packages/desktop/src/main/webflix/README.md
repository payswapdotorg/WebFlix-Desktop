# Vendored WebFlix guard modules (integration-time application, 2026-10-10)

Vendored verbatim from `packages/webflix-shell/src/` per
`docs/plans/patches/desktop-fixes.patch.md` §3/§4 (D1-SHELL lane): the modules
are Electron-free and dependency-free (isolation-flags imports only ./identity)
so they vendor unchanged. Canonical source of truth remains the webflix-shell
package and its vitest suite (updater-guard.test.ts, isolation-flags.test.ts,
identity.test.ts); re-copy on change and keep both copies byte-identical.
