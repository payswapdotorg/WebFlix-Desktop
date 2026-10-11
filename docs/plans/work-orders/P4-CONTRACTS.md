# Work order — P4-CONTRACTS (Phase 4 opener): media-intelligence contracts + deterministic ranking core

## Identity

- Work ID: P4-CONTRACTS
- Requirement IDs: desktop-roadmap.md Phase 4; phase4-mi-plan.md (binding constraints §1–§8, sequencing row 1); contract-freeze §2 (binding shapes; §2.6 jobs reserved for media-intelligence) + §3 (additive changes, semver minor, changelog); ADR-0003 (per-user identity); AUDIT-SOURCES engine-license fold (not load-bearing this order)
- Owner: D2-lane worker (contracts + domain + application; TL2 arbitrates splits)
- Branch: p4-contracts
- Base SHA: 90d3cba (main after REDDIT-CONNECT merge + TL2 ruling)

## Objective

Open Phase 4 with the contract layer and the deterministic core. Add the
media-intelligence contract shapes (ADDITIVE — new module in
webflix-contracts, semver minor bump, changelog entry per §3), the domain
invariants, and the application use cases with a built-in DETERMINISTIC
ranker. Everything rides frozen shapes: jobs on §2.6 JobDescriptor,
errors on §3 typed WebFlixError, catalog references on §2.1, per-user
scope on ADR-0003.

Scope rows:

1. **Contract module `intelligence.ts`** (new, additive):
   - `UserObjective` — explicit, inspectable, editable user goals:
     time-budget constraints, topic focuses, exclusions. NEVER inferred;
     no silent defaults beyond a documented empty objective.
   - `FeedbackEvent` — explicit (e.g. not-interested, pin, up/down) +
     implicit (watched-fraction, skipped-at) with provenance (which
     surface, when, which item); idempotent-append semantics.
   - `Recommendation` / `RankedItem` — catalog item ref + score +
     `reasons[]` where each reason is human-readable AND carries evidence
     pointers to the concrete signals that produced it (which feedback,
     which objective, which library fact). A recommendation without
     reasons is a contract violation — enforce in domain + tests.
   - `RankingPolicy` — deterministic, versioned policy descriptor
     (weights over signal families); same inputs + same policy version =>
     same output, byte-for-byte.
   - `DerivedArtifact` — descriptor for transcripts, summaries,
     overviews, translations, dubs, Q&A answers: source item ref, kind,
     model/provenance lineage, created-at, license note field. Originals
     are never mutated — separation is structural (this order defines +
     type-enforces; persistence may be deferred to P4-ARTIFACTS).
   - `RankerPort` — the user-selected adapter interface: pure
     (catalog-snapshot + objectives + feedback-history + policy) =>
     ranked list with reasons. Default implementation = the built-in
     deterministic ranker; no hidden LLM, no network in the port contract.
   - zod schemas at the boundary; failures in the typed §3 vocabulary.
   - semver minor bump of webflix-contracts + changelog entry +
     consumer-impact note (§3 method for additive changes).
2. **Domain invariants** (webflix-domain): determinism given policy
   version; reasons-mandatory enforcement; feedback provenance rules;
   objective validation (e.g. negative time budgets rejected with typed
   errors); artifact lineage integrity (a derived artifact must reference
   an existing original; kind enum closed).
3. **Application use cases** (webflix-application, hexagonal style like
   the existing modules):
   - `generate-recommendations` — pure, deterministic, LOCAL signals only
     (library + history + feedback + objectives); honest empty state: no
     signals => empty list + honest reason ("not enough local signal
     yet"), NEVER fabricated results; cancellable via a §2.6 job wrapper.
   - `record-feedback` — idempotent append with provenance validation.
   - `set-objectives` / `get-objectives` — validation + storage port.
   - `derive-artifact-bookkeeping` — create/list derived-artifact
     descriptors with lineage checks (in-memory port OK this order if
     persistence is cleanly deferrable — say so explicitly either way).
4. **Deterministic default ranker** — the built-in RankingPolicy v1:
   documented signal families (library affinity, watch-history
   recency/fraction, explicit feedback weight, objective match),
   versioned weights, reasons generated from the actual contributing
   signals. No ML, no randomness, no network.

## Non-goals

- No model/LLM adapter implementations (P4-ADAPTERS; the port ships, the
  adapters don't).
- No transcripts/summaries/overviews/translation/dubbing/TTS/Q&A
  implementations (P4-TRANSCRIBE…P4-TRANSLATE; XTTS/NLLB are banned by
  phase4-mi-plan §7 regardless).
- No connector edits, no provider-API reads in ranking (local signals
  only — plan §5), no scraping, no training on user data (plan §honest
  boundaries: adapters infer, feedback is ranking signal not training
  data).
- No shell/UI surfaces (P4-ADAPTERS+ bring UI).
- No edits to frozen §2.1–2.6 shapes (additive only; deviations → TL2
  freeze-deviation queue with a P4-FD prefix).

## Allowed and forbidden paths

- Allowed: `packages/webflix-contracts/**`, `packages/webflix-domain/**`,
  `packages/webflix-application/**` (tests under each), plus the mandated
  ledger-row commit in `docs/plans/work-claims.md`.
- Forbidden: everything else (connectors, playback, shell, ui, web,
  desktop, services, catalog-impl, local-library — if a seam feels
  missing, STOP and propose; do not reach across lanes).

## Dependencies and parallelism

- Must land first: this order (Phase-4 sequencing row 1).
- Can run concurrently with: nothing in Phase 4 (subsequent orders bind
  to these shapes).
- Must not overlap with: any other lane's tree.
- Merge order: ff to main after TL2 review; P4-ARTIFACTS binds next.

## Contract and state

- Public interfaces used: frozen §2.1 catalog item refs, §2.6
  JobDescriptor/JobState, §3 WebFlixError/ErrorCode.
- Public interface changes proposed: ADDITIVE intelligence.ts (listed
  above) + webflix-contracts semver minor bump + changelog.
- State owner: application ports (objective store, feedback store,
  artifact bookkeeping port) — in-memory defaults OK if the port boundary
  is honest and deferrable persistence is recorded.
- Events and idempotency: feedback append idempotent by event id;
  recommendation generation pure (no side effects).
- Provider/user/profile scope: per-user, per-profile isolation (ADR-0003);
  no cross-user signals ever.
- Cache and retention rules: none invented this order (pure core); if a
  port caches, it says so in the port doc.

## Behavior and acceptance

- Happy path: signals present => ranked list, each item with reasons +
  evidence pointers; determinism test pins policy v1 output byte-for-byte
  on a fixture corpus.
- Empty/no-results: no signals => empty list + honest reason; never
  fabricated.
- Requires-auth: N/A this order (local only — no provider calls at all).
- Unsupported/unavailable: any future non-local ranker surface is OUT of
  scope; the port says so.
- Timeout/rate-limited: N/A (pure core); job wrapper honors §2.6
  cancellation honestly (cancelled => Cancelled state, partial results
  discarded or marked — pick + document).
- Offline/restart/recovery: pure core needs none; ports document their
  durability honestly (in-memory = not durable, said plainly).
- Permission and cancellation: cancellation via §2.6 jobs; no OS
  permissions.
- Accessibility/keyboard/error UI: no UI this order.
- OS/package coverage: platform-neutral pure TS.

## Security/policy

- External source/documentation: desktop-roadmap.md Phase 4;
  phase4-mi-plan.md; contract-freeze §2/§3 — no external APIs.
- Authentication and user consent: per-user isolation; objectives and
  feedback are user data (ADR-0003 scope).
- Data retention/deletion: ports document retention; no silent
  telemetry; nothing leaves the machine this order.
- Prohibited: scraping, provider reads, LLM defaults, training on user
  data, mutating originals, §2.1–2.6 edits.

## Acceptance evidence

- Full gate battery green (8-lane tsc incl. the three D2 lanes,
  test:unit / test:integration, lint zero-new vs 69w/0e baseline,
  fmt:check on touched files, components 34/34 untouched-green,
  architecture:check 0).
- Determinism test: fixture corpus + pinned policy v1 output.
- Reasons-mandatory test: a reasonless recommendation cannot be
  constructed (type-level or runtime guard — prove it in a test).
- Original/derived separation test: lineage check rejects dangling
  original refs; originals never mutated.
- Honest-empty test: no-signal corpus => empty + honest reason.
- Contract changelog + semver bump committed.
- rg evidence: no provider hosts, no fetch/network in the intelligence
  path, no randomness (seed or otherwise) in the ranker.

## Report protocol (same as prior orders)

Branch from base, commits (code + separate ledger row update), full gate
numbers, honest live-notes (N/A — local core), git-bundle relay base..p4-contracts
via tmpfiles.org with .txt rename, report with `=== P4-CONTRACTS REPORT
BEGIN/END ===` markers in the session.
