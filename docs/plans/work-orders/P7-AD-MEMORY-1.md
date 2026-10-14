# Work order — P7-AD-MEMORY-1 (Phase-7 row 5): ad personal memory, honestly

## Identity

- Work ID: P7-AD-MEMORY-1
- Requirement IDs: WF-029 (ad personal memory); NOT WF-026 (claim
  evidence stays as-is), NOT WF-028
- Owner: D2-lane worker (ads memory grant)
- Branch: p7-ad-memory-1
- Base SHA: main AFTER the P7-SEARCH-1 merge (contracts 0.12.0 must be
  merged — this row bumps to 0.13.0; clone main; record HEAD as BASE)
- Dispatch condition: P7-SEARCH-1 merged on main — NOT YET SATISFIED;
  TL2 dispatches when it is.

## Precondition (hard)

P7-SEARCH-1 is `merged` in docs/plans/work-claims.md at your base (the
contracts entrypoint already carries the 0.12.0 export line — this row's
additive export lands AFTER it). If absent, STOP and report the blocker.

## Objective

Explicit opt-in personal memory for the Ad Center — three groups:

1. **Contracts 0.12.0 → 0.13.0 (additive sibling)** — NEW file
   `packages/webflix-contracts/src/ads-memory.ts` + one additive
   `export * from "./ads-memory";` line in `src/index.ts` + version bump
   to 0.13.0. Same separation discipline as ads.ts / ads-sources.ts
   (imports ONLY shared primitives + ads shapes — never
   intelligence/ranking modules):
   - `AdMemoryScope` (explicit consent scopes — e.g. saved-ads,
     observations; closed union)
   - `AdMemoryConsent` (scope grants + revocations with timestamps —
     consent is DATA, never ambient)
   - `SavedAdRecord` (an AdRecord reference + user note + saved-at)
   - `UserObservation` (user-reported claim/evidence note against an ad
     or claim, with provenance = user-stated, clearly labeled)
   - `AdMemoryEntry` union + typed refusal reasons
     (`ads-memory/consent-required`, `ads-memory/scope-revoked`) — the
     same data-not-thrown discipline
2. **Application use cases** — NEW files
   `packages/webflix-application/src/ad-memory.ts` (saveAd / forgetAd /
   recordObservation / listMemory, each gated by the explicit per-scope
   consent; typed refusal when consent is absent or revoked) and
   `in-memory-ad-memory-stores.ts` (the pure-test double following the
   in-memory-ads-stores.ts precedent), registered additively in the
   package public entry exports.
3. **Tests (fixture-only, hermetic)**: consent gating (every write
   refuses without the scope grant, typed reason), save/forget
   semantics, revocation mid-flight (subsequent writes refuse),
   observation provenance labeling (user-stated is never conflated with
   source-backed evidence), no cross-source linking without consent
   (memory entries never auto-join across sources — linkage only via
   explicit user action), per-profile isolation (per the ADR-0003 law).

## Honest non-goals

- NO ambient observation, NO automatic capture, NO cross-source
  auto-linking (explicit user actions only — that IS the requirement).
- NO shell/UI changes, NO durable storage (in-memory double only; the
  durable adapter follows the P5-STORES pattern in a later row if
  sanctioned).
- NO edits to existing contract files (only the NEW ads-memory.ts + the
  one additive export line + version bump) and NO engine rework.
- NO provider calls, NO telemetry.
- NO matrix edit (status advance is TL2's ruling).

## Gates (run ALL; record exact commands + totals — real numbers)

- npx tsc -b --force (group 1: contracts/domain/application/
  local-library/shell) — exit 0
- npx tsc -b --force (group 2: catalog/connectors/playback) — exit 0
- pnpm test:unit — exact base green + the new ad-memory tests
- pnpm test:integration — 1/1
- pnpm lint — zero NEW vs base
- pnpm fmt:check — PASS
- pnpm architecture:check — 0 violations / 0 baseline / 0 new

## Transport (git push delivery — v2 doctrine 2026-10-13)

- Commits on branch p7-ad-memory-1: code/docs commit(s) + SEPARATE
  ledger-row update commit (P7-AD-MEMORY-1 row -> delivered in
  docs/plans/work-claims.md).
- DELIVER BY PUSHING YOUR BRANCH TO ORIGIN (the TL2 station pulls and
  runs ALL gates itself on your branch — you do NOT need to run gates
  worker-side; cite any numbers you have, never block on them):
  git push $PUSH_URL
  ($PUSH_URL is provided VERBATIM in your dispatch directive —
  the token is redacted from this repo file by GitHub push
  protection; use the full URL from the directive as-is) p7-ad-memory-1:refs/heads/p7-ad-memory-1
- Final reply with VERBATIM ENGLISH markers:
  === P7-AD-MEMORY-1 REPORT BEGIN === (BASE / BRANCH / PUSHED <head-sha> /
  WORK SUMMARY / HONEST LIMITS)
  === P7-AD-MEMORY-1 REPORT END ===
  The PUSH is the delivery: no git bundle, no base64 block, no tmpfiles.
  If push is rejected, run git pull --rebase origin main once and re-push.
  If a tool call serializes into the function-name field, pause and emit
  it again as ONE separate properly-formed call — that cure is proven.

Reminder: report numbers must come from the gates you ACTUALLY ran. If a
gate cannot run, say so plainly with the reason — an honest failure beats
a fabricated pass. ENGLISH report markers, verbatim.
Reminder: report numbers must come from the gates you ACTUALLY ran. If a
gate cannot run, say so plainly with the reason — an honest failure beats
a fabricated pass. ENGLISH report markers, verbatim.
