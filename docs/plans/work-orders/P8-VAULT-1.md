# Work order — P8-VAULT-1 (Phase-8 successor): the production OS vault behind the OAuthAccountStore seam

## Identity

- Work ID: P8-VAULT-1
- Requirement IDs: successor payload to WF-030 (audit §1.5 "no production vault exists"; NOT a matrix row)
- Owner: D1-lane worker
- Branch: p8-vault-1
- Base SHA: main at 20343f4 (or later; clone main; record HEAD as BASE)
- Design authority: docs/plans/phase8-successor-payload.md (TL2 rulings below — BINDING) + docs/audits/account-isolation-audit-2026-10-13.md §1.5/§2.3 (path:line-cited) + contract-freeze §6.1/§6.2 (token boundary = main-process OS-vault adapter wrapping the inherited credentialService shape)

## Precondition (hard)

main contains docs/plans/phase8-successor-payload.md AND
docs/audits/account-isolation-audit-2026-10-13.md AND
packages/desktop/src/main/providerDisconnectClear.ts (the P8-ISOLATION-WIRING-1
adapter). If any is absent, STOP and report the blocker.

## Objective

Close audit §1.5's production-vault gap: the only OAuthAccountStore
implementations in the tree are test doubles — this order delivers the
REAL one. After it: a desktop main-process vault persists provider
account records and raw OAuth tokens ENCRYPTED AT REST with
namespaced per-(provider, account) keys, fails closed when the OS
keychain is unavailable, removes idempotently, and composes with the
disconnect partition clear — with every property test-pinned.

Concretely, per the TL2 rulings (BINDING):

1. **The vault module** (packages/desktop/src/main/webflix/, e.g.
   osVaultAccountStore.ts): a factory
   `createOsVaultAccountStore(providerId, deps)` implementing the
   OAuthAccountStore shape EXACTLY as frozen
   (connectors/src/youtube/oauth.ts:110-118 — loadAccount/saveAccount/
   removeAccount + loadTokens/saveTokens/removeTokens, keyed by
   internalAccountId). ZERO interface changes; the shapes are frozen.
2. **Encryption at rest**: Electron `safeStorage` for key management —
   the inherited credentialService's own named path
   (packages/services/src/credential/credentialService.ts:20-23:
   "后续可切换到 Electron safeStorage（钥匙串）托管密钥").
   Persistence through the inherited substrate OR the WebFlix data
   root (~/.webflix) using @zcode/shared/node's
   atomicWritePrivateTextFile — cite which path you take and why;
   do NOT fork the credentialService module.
   **Fail-closed unavailability**: when safeStorage is unavailable
   (e.g. Linux without libsecret), the vault REFUSES to store tokens
   with a typed error — NEVER a plaintext fallback.
3. **Scoped keys**: storage keys namespaced per
   (provider, internalAccountId) — e.g.
   `webflix.oauth.<providerId>.<internalAccountId>.tokens|record`.
   Cross-account invisibility BY CONSTRUCTION: keyed lookups only; NO
   enumeration of foreign accounts; the OAuthAccountStore interface
   has no list method — keep it that way.
4. **Encrypted-at-rest pin**: a test asserting the persisted bytes
   NEVER contain the plaintext token material (the raw accessToken
   string absent from the file content).
5. **Idempotent removes**: removeAccount/removeTokens succeed on
   absent keys (pinned).
6. **The disconnect composition**: an additive helper that composes
   the vault removal with the P8-ISOLATION-WIRING-1 scoped partition
   clear (providerDisconnectClear.ts — vault.removeTokens/
   removeAccount + clearDisconnectedProviderAccountPartition; both
   idempotent, order-independent; the helper is the account-host seam
   the future mount order calls). NO invented IPC/UI surfaces.
7. **Main-process-only boundary**: the vault module is never imported
   from renderer/shell code (pin: a shell-side import-absence test or
   the architecture check — cite which).

## Non-goals

- ZERO OAuthAccountStore/StoredOAuthTokens contract changes (frozen).
- NO IPC/preload/renderer surface (the mount order owns it).
- NO provider webview surfaces; NO account UI.
- NO live keychain/platform claims: fixture tests only (mocked
  safeStorage + temp-dir persistence); real platform behavior is the
  packaged tier, honestly named (audit §4.3/§5 precedent).
- NO new dependencies (safeStorage is Electron built-in; the file
  substrate is in-tree).
- NO parked-row work; NO matrix edit.
- NO credentialService module changes (wrap, don't fork — cite its
  API as consumed).

## Allowed and forbidden paths

- Allowed: packages/desktop/src/main/webflix/\* (new vault module +
  tests), packages/desktop/src/main/providerDisconnectClear.ts (the
  composition helper + tests only — additive), the disconnected
  clear's test file, docs/plans/work-claims.md (ledger row), oxfmt
  realignment on touched files. If the persistence path needs ONE
  shared-node helper import, cite it (no new helpers).
- Forbidden: everything else — especially connectors (the frozen
  interface stays untouched), contracts, services (wrap, don't
  modify), shell (import-absence only).
- Shared-file owner: TL2 (ledger).
- Architecture policy update: none expected; if a new package root
  appears, STOP and report instead.

## Dependencies and parallelism

- Must land first: P8-ISOLATION-WIRING-1 (merged at 20343f4 — the
  disconnect adapter + the seam pins are its descendants).
- Can run concurrently with: nothing in flight.
- Merge order: single order; TL2 reviews + merges.

## Contract and state

- Public interfaces used: OAuthAccountStore + StoredOAuthTokens
  (connectors/src/youtube/oauth.ts:96-118 — TYPE-ONLY imports; the
  vault implements the shape, does not re-export or change it),
  clearDisconnectedProviderAccountPartition
  (providerDisconnectClear.ts), Electron safeStorage, the
  @zcode/shared/node private-file helpers.
- Public interface changes proposed: the additive vault factory + the
  composition helper ONLY.
- State owner: the vault file(s) in the WebFlix data root — one
  writer (the main process), atomic writes, no caching layer.
- Events and idempotency: removes idempotent; saves atomic
  (atomicWritePrivateTextFile); the composition helper idempotent.

## Behavior and acceptance

- Happy path: saveAccount+saveTokens → the record and tokens persist
  encrypted; loadAccount/loadTokens round-trip; a second account on
  the same provider coexists; the store for provider P never sees
  another provider's or account's keys.
- Unavailable keychain: saveTokens → typed refusal; NO file written;
  loadTokens of previously-stored (never happens — nothing was
  written) → null. Fail closed, logged.
- Disconnect composition: vault remove + partition clear both
  idempotent; the helper succeeds when either target is already
  absent.
- Empty/no-results: loadAccount/loadTokens on absent keys → null.
- Requires-auth: n/a. Unsupported/unavailable: safeStorage
  unavailable → typed refusal (the honest state).
- ZCode regression path: ZERO — the vault is new WebFlix-surface code
  in the desktop main process; no existing test or surface changes.

## Gates (station runs them; worker cites honestly, never blocks)

- npx tsc -b --force both groups — exit 0.
- pnpm test:unit — ALL existing tests pass + the new pins; report exact
  file/test counts.
- pnpm lint — zero NEW warnings beyond the 69 baseline;
  pnpm fmt:check — PASS.
- pnpm architecture:check — 0/0/0.

## Transport (git push delivery — v2 doctrine)

- Commits on branch p8-vault-1: code/test commit(s) + SEPARATE
  ledger-row update commit (P8-VAULT-1 row -> delivered in
  docs/plans/work-claims.md, format per the P8 rows).
- DELIVER BY PUSHING YOUR BRANCH TO ORIGIN:
  git push $PUSH_URL p8-vault-1:refs/heads/p8-vault-1
  ($PUSH_URL is provided VERBATIM in your dispatch directive —
  the token is redacted from this repo file by GitHub push
  protection; use the full URL from the directive as-is).
  If push is rejected, run git pull --rebase origin main once and
  re-push.
- Final reply with VERBATIM ENGLISH markers:
  === P8-VAULT-1 REPORT BEGIN === (BASE / BRANCH / PUSHED <head-sha> /
  WORK SUMMARY: each ruling 1-7 with the files+lines touched and its
  pinning test / HONEST LIMITS)
  === P8-VAULT-1 REPORT END ===

Reminder: report numbers must come from the gates you ACTUALLY ran. If
a gate cannot run, say so plainly with the reason — an honest failure
beats a fabricated pass. ENGLISH report markers, verbatim.
Reminder: an honest failure beats a fabricated pass. ENGLISH markers.
