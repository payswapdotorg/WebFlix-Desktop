# Phase 8 — successor payload (post-TL3)

Recorded 2026-10-14 by the TL2 station after the TL3 roadmap-completion
ruling (phase7-expanded-rows-plan.md, final main 26d0abc/d6fa375).

The Phase-7 roadmap is complete (every non-parked row shipped). The two
wave-3 audits named a successor follow-up payload with source-cited
evidence. This plan records it as orders. NOTHING in this plan re-opens
the parked rows (WF-013/014/015 engine+rights, WF-020 consent model,
WF-031 sync deferral) — those remain the operator's explicit call.

## Successor payload inventory (from the audits; not matrix rows)

1. **Release-safety drifts R1-R4 + hazard H1** —
   docs/audits/release-safety-audit-2026-10-13.md §1.4-§1.7, §2.2:
   - R1 runtime flavor normalization erases `"webflix"` (env.ts:25-34)
     → packaged AUMID resolves `dev.zcode.app[.preview]`, force-update
     gate fires on production-backend builds;
   - R2 packaged runtime identity depends on `WEBFLIX_IDENTITY` env
     that nothing sets in packaged boots → appName `ZCode`, userData
     `appData/ZCode`, services root `~/.zcode` (freeze §6.1/§6.8
     violation; release-blocking);
   - R3 deep-link scheme hardcoded `zcode://` at build AND runtime —
     `webflix://` exists frozen + test-pinned but unwired;
   - R4 ZCode metadata stamped into WebFlix artifacts (homepage/author/
     maintainer, install-manifest filename, dev updater cache dir);
   - H1 production-backend WebFlix build would enable the updater
     against the ZCode manifest feed — cross-product contamination, no
     product guard in the updater chain.
2. **T-1..T-10 missing-test map** — same audit §4.2. T-1..T-9 are
   unit-testable in-sandbox; T-7's e2e half and T-10's feed-dependent
   half are honestly blocked (no real feed, no install tier).
3. **Account-isolation revocation propagation UNVERIFIED** — the
   isolation audit named it: no production wiring exists to verify.
4. **Target-platform smokes never run** (the recorded 4GB-OOM
   environment class) — blocked on a release-capable box; the release
   evidence template (release-safety-audit §3) is the runnable
   checklist when one exists.

## TL2 design rulings for the drift fixes (binding for P8-RELEASE-DRIFT-1)

The release audit §5 explicitly defers remedy choice to TL2. Rulings:

- **R1 — preserve the baked flavor**: `ZCodeProductFlavor` gains the
  `"webflix"` member; `normalizeZCodeProductFlavor` returns a baked
  `"webflix"` verbatim; unknown/absent values keep today's fail-closed
  fallback (zcodeEnv-based). Every `ZCODE_PRODUCT_FLAVOR` consumer
  (index.ts, desktopTray.ts, desktopCommandHandlers.ts,
  desktopApplicationMenu.ts, desktopRuntimeEnv.ts) must handle
  `"webflix"` EXPLICITLY — no silent fallthrough into ZCode branches,
  and no boot-time throw on a valid flavor.
- **R2 — packaged default follows the bake**: when the runtime flavor
  (baked define) is `"webflix"` AND `isElectronAppPackaged()`, WebFlix
  identity is ON by default (data root `~/.webflix` per freeze §6.1);
  `WEBFLIX_IDENTITY` stays an explicit override honored in both
  packaged and dev contexts (1 = force on, 0 = force off, invalid
  value still throws per current code); the unbundled dev runtime
  keeps default-off with `WEBFLIX_IDENTITY=1` opt-in (`~/.webflix-dev`).
  `desktop-product-identity.mjs` stays dual-context (build tool AND
  bundled main-process import) — thread the baked flavor in as an
  option, do not fork the module.
- **R3 — scheme follows identity**: `registerDeepLinkProtocol` and the
  electron-builder `schemes` config select `webflix://` when WebFlix
  identity is active and never claim `zcode://` on that surface; the
  scheme value comes from the identity module (identity.ts:46-47,
  already frozen + test-pinned), not new literals.
- **R4 — artifact metadata follows identity**: homepage/author
  (extraMetadata), deb maintainer, Windows install-manifest filename,
  dev updater cache dir switch by product identity. The freeze does
  NOT name homepage/author/maintainer values — the worker proposes
  identity-consistent values (citing freeze §6.1's product identity)
  and flags each proposal in the delivery notes for TL2 review; the
  deb/rpm non-empty field requirement (config :457-458) must remain
  satisfied.
- **H1 — fail-closed product guard**: with R1 fixed, `"webflix"` ≠
  `"production"` so `initAutoUpdater({enabled: …})` stays disabled;
  ADDITIONALLY a guard inside the updater chain (init or provider)
  refuses enablement when the runtime product identity is WebFlix,
  with a logged reason — defense in depth against future refactors.
  The force-update gate (index.ts:2261) must likewise never fire for
  the `"webflix"` flavor. No feed is created (freeze §6.1 deferral
  stands).

## Orders

- **P8-RELEASE-DRIFT-1** — the R1-R4 + H1 fixes + the unit-testable
  T-map pins (T-1..T-6, T-8, T-9, T-5 provider battery; T-7/T-10
  unit-level halves only). Work order:
  docs/plans/work-orders/P8-RELEASE-DRIFT-1.md.
- Future (blocked, honestly): target-platform smokes + release
  evidence run (needs a release-capable box), T-7 e2e coexistence
  installs, T-10 e2e notices/recovery (needs a real feed),
  revocation-propagation production wiring. These stay named-not-
  ordered until their blockers clear; the operator re-opens parked
  rows explicitly.
