# WFX-AGENT-PORT-REDELIVER-1 — the WebFlix agent panel's dead-end at `timed-out` closed

- **Status**: DONE (2026-10-24)
- **Base**: ab8a8c9 (post WFX-WEB-LOOK-1 main)
- **Owner**: TL3 (operator-directed takeover lane)

## The directive

The operator authorized removing friction from the zcode lane ("remove the
zcode login gate if it enables you to work with it better") and the sandbox
audit surfaced the exact live failure this lane closes: the WebFlix agent
panel dead-ends at its honest `agent runtime unavailable` state with
`databasePhase "ready"` + `hasPendingPort false` + `phase "timed-out"` —
the runtime WAS ready, but the renderer never received the service port.

## Root cause

The initial `ServicePort` is posted by main at host-spawn /
reload-reattach (dom-ready), while the renderer's startup listener installs
only when its DYNAMICALLY-imported boot chunk evaluates (`main.tsx`:
`void import("./webflix/boot.js")` / `void import("./zcodeBoot.js")`). A
slow (dev vite graph) or racing (packaged) boot chunk drops the port
`MessageEvent` with no listener installed — the WebFlix runtimeAdmission
then times out honestly, and the agent panel shows its unavailable state.

## The fix (one file + its battery)

`packages/desktop/src/main/databaseStartupRelay.ts`:

1. **Snapshot re-delivery** — a `snapshot` control (the renderer's
   "my listener is up" signal — both boots send it at module evaluation)
   now re-delivers the service port through the SAME `AttachServicePort`
   flow a renderer reload takes, so admission pairs state+port regardless
   of boot-chunk timing.
2. **First-ready re-delivery (companion path)** — a snapshot can arrive
   BEFORE the host reaches ready (boot chunk up while storage preparation
   still running); at that moment the re-delivery is a no-op because
   `latest.phase !== "ready"`. A once-per-generation hook on the FIRST
   ready transition re-delivers the port alongside the state forward.

## Boundary ruling

- **Flavor-gated (freeze: WEBFLIX_IDENTITY unset ⇒ zero ZCode impact)**:
  only the `webflix` product re-delivers. The inherited ZCode flavors keep
  exactly-once port delivery VERBATIM — pinned by the zero-impact test
  (`flavor: "production"` through the `options` seam mirroring
  `webflixAgentWorkspaceIpc.ts`).
- **Bounded cost**: exactly one extra attachment per relay generation
  (reload-reattach adds the same cost on every reload — same order).
- **Duplicate-port safety**: both boots already ignore duplicate ports
  after admission (`appInitialized` / the admission handle guard) and the
  pending-port swap closes the superseded port
  (`databaseStartupAdmission.acceptPort`).
- No renderer changes: both boots already send the snapshot at module
  evaluation (pinned by `zcodeRendererPath.test.ts` /
  `runtimeAdmission.test.ts`).

## Gates

- `pnpm exec vitest run packages/desktop/src/main/databaseStartupRelay.test.ts`
  → 12/12 (4 inherited forwarding pins, 7 new lane pins, 1 exit-control pin).
- Full battery + typecheck + oxlint — see the ledger row.

## Honest residual

None for this seam: the re-delivery is battery-pinned for both orderings
(snapshot-before-ready and ready-before-listener).
