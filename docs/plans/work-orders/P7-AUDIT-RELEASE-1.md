# Work order — P7-AUDIT-RELEASE-1 (Phase-7 wave-3): release-safety audit (WF-034)

## Identity

- Work ID: P7-AUDIT-RELEASE-1
- Requirement IDs: WF-034 (release safety — the `audit-pending` row)
- Owner: D1-lane worker (read-only audit grant)
- Branch: p7-audit-release-1
- Base SHA: main after the wave-1 merges (or later; clone main; record
  HEAD as BASE)
- Dispatch condition: wave-1 merges landing AND sandbox capacity free —
  TL2 dispatches when it is.

## Precondition (hard)

main contains phase7-expanded-rows-plan.md. If absent, STOP and report
the blocker.

## Objective (READ-ONLY audit — zero product-code changes)

The WF-034 audit delivery — distribution/identity and update-path safety:

1. **Packaging identity audit**: verify the packaged-app identity chain
   (product name, bundle IDs, app-data roots, updater feed, signing
   config) is WebFlix-isolated per WF-001 — cite the packaging configs,
   the identity tests, and any drift. Record what a target-platform
   smoke would need to prove beyond the current tests (the honest gap
   list — no fabricated platform claims).
2. **Update-path audit**: trace the updater configuration — feed URL,
   signature verification, rollback behavior. Cite evidence; flag every
   unverified link honestly.
3. **Release evidence template**: a concrete checklist (commands,
   expected outputs, artifact hashes) for a reproducible release run —
   the exact `pnpm bundle:desktop` surface as it exists, what it
   currently proves, and what it cannot yet prove (target-platform
   smokes).
4. **The report IS the deliverable** — commit it as
   `docs/audits/release-safety-audit-2026-10-13.md` (source-backed,
   honest unknowns section).

## Honest non-goals

- ZERO product-code changes, ZERO test changes — audit document ONLY
  (plus the ledger-row status commit).
- NO release build claims you did not run; NO signing-key handling.
- NO matrix edit (the audit-pending → audited transition is TL2's
  ruling on this evidence).

## Gates

- npx tsc -b --force both groups — exit 0 (unchanged tree must hold)
- pnpm test:unit — exact base green (the tree is untouched)
- pnpm lint — zero NEW; pnpm fmt:check — PASS
- pnpm architecture:check — 0/0/0

## Transport (NO push)

Same as the wave-1 orders: branch commits + separate delivered-status
ledger commit; git bundle → tmpfiles.org + verify + URL + sha256 (with
the BUNDLE_B64 fallback); verbatim ENGLISH markers:
=== P7-AUDIT-RELEASE-1 REPORT BEGIN === (BASE / BRANCH / GATES / AUDIT
VERDICTS / EVIDENCE INDEX / FOLLOW-UP ORDERS / HONEST LIMITS / BUNDLE)
=== P7-AUDIT-RELEASE-1 REPORT END ===

Reminder: an honest failure beats a fabricated pass. ENGLISH markers.
