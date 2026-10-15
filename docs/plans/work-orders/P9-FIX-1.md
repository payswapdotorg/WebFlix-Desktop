# P9-FIX-1 — WebFlix runtime identity-isolation fixes (F1 + F2)

Order owner: TL2. Worker grant: single worker lane (any free worker).
Base: `origin/main` @ the P9-QA-1 merge ledger head (record the exact SHA at dispatch; verify `git rev-parse HEAD` after checkout).

## Context (from the P9-QA-1 evidence — binding)

The packaged-build QA (`docs/operations/ubuntu-release-evidence.md`, results committed at `packages/desktop/scripts/e2e/evidence/ubuntu-33681f7/`) recorded two honest FAIL findings on the `33681f7` artifacts. The release candidate is NOT clean until both are fixed and the packaged smoke re-run passes on a fresh CI build of the fixed SHA. This order fixes the code; the evidence re-run is a follow-up (P9-QA-2) after this merge plus a fresh `webflix-ubuntu-build` run.

### F1 — runtime registers a ZCode-branded user-level desktop entry

Symptom: the packaged WebFlix app self-registers the deep-link handler as `~/.local/share/applications/zcode.desktop` with `Icon=zcode`, `MimeType=x-scheme-handler/zcode;`, `Comment=ZCode Desktop App` (Name/StartupWMClass are WebFlix).
Root cause: `packages/desktop/src/main/desktopLinuxDeepLinkRegistration.ts` hardcodes `LINUX_DEEP_LINK_DESKTOP_FILE = "zcode.desktop"` and its zcode-shaped template fields.

### F2 — runtime creates `~/.zcode/cli/db/db.sqlite`

Symptom: the packaged WebFlix runtime writes the inherited CLI session store under ZCode's data root (`~/.zcode/cli/...`) while the Chromium/userData layer is correctly `~/.webflix`.
Root cause: the services layer resolves the CLI home independently of the product identity — see `packages/services/src/node.ts` (`ZCODE_HOME` fallback `join(homedir(), ".zcode")`) and related resolution sites; an identity-aware path layer already exists (`packages/services/src/paths.ts`, which documents the frozen data-root segment under WebFlix identity).

## Allowed paths (HARD LAW)

- `packages/desktop/src/main/desktopLinuxDeepLinkRegistration.ts` (and its test file `packages/desktop/src/main/desktopLinuxDeepLinkRegistration.test.ts` if extending coverage)
- `packages/services/src/node.ts` (ONLY the CLI-home/data-root resolution sites needed for F2)
- `packages/services/src/paths.ts` (if the identity-aware resolution needs a narrow extension)
- New/extended focused tests under `packages/desktop/src/main/*.test.ts` / `packages/services/src/**/__tests__` covering the two fixes.
- Nothing else. Do not edit renderer/shell components, electron-builder config, workflow YAML, e2e harness, docs, or the claims ledger. If a needed change falls outside these paths, STOP and report the boundary in your final message instead of editing.

## Requirements

1. **F1 fix (identity-driven deep-link registration).** In the WebFlix product flavor, the user-level deep-link entry must be `webflix.desktop` with WebFlix identity fields (`Name=WebFlix`, `Icon=webflix`, `MimeType=x-scheme-handler/webflix;`, WebFlix comment) — consistent with the packaged system-level entry. In ZCode production/preview flavors the current `zcode.desktop` behavior must remain byte-compatible (regression-free). Use the existing product-identity module (the same source `desktop-product-identity.mjs` freezes) — do not invent a new identity channel. Preserve the ownership-marker/legacy-cleanup semantics (the cleanup path must remove the correct legacy file per flavor, and must not delete a foreign file it did not write).
2. **F2 fix (identity-scoped CLI data root).** In the packaged WebFlix runtime, the CLI session/config store must resolve under the WebFlix data root (`~/.webflix/...` — the frozen identity segment), never `~/.zcode`. The `ZCODE_HOME` env override must keep working (explicit operator override wins). ZCode flavors keep `~/.zcode` unchanged. Fail loud (a typed log line, not a silent swallow) if the resolution cannot determine the flavor.
3. **Focused proof.** Add/extend unit tests that pin: (a) the user-level desktop file name + fields per flavor (WebFlix: webflix.desktop/webflix fields; ZCode: zcode.desktop unchanged); (b) the CLI data-root resolution per flavor + the `ZCODE_HOME` override precedence. These tests must run inside the existing hermetic batteries (root `pnpm test:unit` include globs or the desktop main test glob) — if your test location is outside an existing include, put it inside `packages/desktop/src/main/*.test.ts` or `packages/services/src/**` per the include list in `vitest.config.ts`.
4. **Baseline gates at base BEFORE edits (record verbatim), and the full battery at head before delivery** — the exact commands are in the P9-QA-1 report / repo docs (fmt:check, lint, architecture:check, typecheck, test:unit, test:integration, renderer battery, shell battery). Zero new warnings/errors. All tests pass.
5. **Push branch `p9-fix-1`** (PAT in remote URL; never echo/commit it) and verify `git ls-remote origin refs/heads/p9-fix-1`.
6. **Final message with markers** `=== P9-FIX-1 REPORT BEGIN ===` … `=== P9-FIX-1 REPORT END ===` containing: BASE sha, BRANCH + pushed head sha, GATES (verbatim counts at base and head), WORK SUMMARY (F1 + F2: what changed, why minimal, which identity source drives it), TEST EVIDENCE (the new pins, verbatim), HONEST LIMITS (numbered — anything you could not verify and why; note explicitly that packaged-artifact re-verification belongs to P9-QA-2 on a fresh CI build).

## Non-goals

- No packaged-artifact smoke re-run in this order (needs a fresh CI build of the fixed SHA — that is P9-QA-2).
- No changes to the e2e harness or evidence docs (P9-QA-2 owns the re-run records).
- No public production release, homepage/author metadata, or update-feed work.
