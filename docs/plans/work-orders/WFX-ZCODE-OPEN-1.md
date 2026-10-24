# WFX-ZCODE-OPEN-1 — the zcode startup login gate removed (operator authorization)

- **Status**: DONE (2026-10-24)
- **Base**: 77c011d (post WFX-AGENT-PORT-REDELIVER-1 main)
- **Owner**: TL3 (operator-directed takeover lane)

## The directive

The operator: "remove the zcode login gate if it enables you to work with
it better."

## What the gate was

The ZCode product flavor's root (`packages/ui/src/Root.tsx`) replaces the
ENTIRE workspace with the `WelcomeScreen` login card
("Welcome to ZCode / Connect your account to start using ZCode") whenever
`welcomeScreenOpenReason` is set. The startup entry of that reason was
decided by `useProviderAvailabilityLoginEntryGuard` —
`shouldOpenLoginEntry = !providerFamilyDomain || (!user && !hasUsableProvider)`
— i.e. a fresh install with no Z.ai/BigModel login and no configured
provider was gated behind the login screen before the workspace would
render. The decision switch was
`shouldEnableProviderAvailabilityLoginEntryGuard()` in
`packages/ui/src/lib/rootStartupGate.ts` (hardcoded `true`).

## The removal

One decision inverted, zero behavior deleted:

- `shouldEnableProviderAvailabilityLoginEntryGuard()` → `false`. The guard
  hook reports `startupCheckCompleted: true` immediately and never opens
  the login entry, so `Root` boots straight into the workspace; the ZCode
  session restores without a connected account.
- **Kept verbatim** (honest, non-blocking surfaces — NOT gates):
  - Voluntary login (sidebar/settings `onLogin` → `manual-login`).
  - The session-expired re-gate on JWT invalidation mid-session
    (`zcodeJwtInvalidRestartMarker` → `session-expired`).
  - The model picker's own no-provider state inside the workspace.

## Boundary ruling

- **WebFlix flavor**: zero visible change — the webflix boot never mounts
  `Root`'s gate (the agent panel mounts `V4ChatPane` directly); pinned by
  `zcodeRendererPath.test.ts` (untouched).
- **ZCode flavors**: the workspace is now reachable without login. The
  product already supported accountless operation (the API-key form's
  "skip" path writes `providerFamilyDomain` and completes with reason
  `skip`), so this is an opening of a supported configuration, not a new
  state.
- No renderer/bridge/IPC surface changed; no data-testid changed; no
  frozen contract touched.

## Gates

- No test pins the gate (verified: only `rootStartupGate.ts`,
  `useProviderAvailabilityLoginEntryGuard.ts` and `Root.tsx` reference the
  switch — all source).
- Full battery + typecheck — see the ledger row.

## Honest residual

None for this lane: the gate decision is a single function whose callers
all degrade to "do not open" when disabled.
