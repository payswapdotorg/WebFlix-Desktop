# Phase 5 — Ad Center execution plan (TL2 decision doc)

Status: ACTIVE (Phase 4 complete at ba089a5 — all seven MI rows merged).
Base: main @ ba089a5. This plan binds all Phase-5 workers.

## What Phase 5 is (desktop-roadmap.md, verbatim scope)

"Add supported transparency libraries, advertiser identity, claim
extraction, evidence graph, independent review signals, offer
verification and explainable qualification. Never promise global ad
coverage; keep Ad Center separate from organic recommendations."

## Binding constraints (from frozen decisions + AUDIT-SOURCES — workers must honor)

1. **Ad-transparency access truths (AUDIT-SOURCES §6 finding 13 — BINDING)**:
   Google Ads Transparency Center has NO official API (public UI only;
   third-party scrapers are NOT an approved path) — its connector is
   BLOCKED until a sanctioned access method exists. Meta Ad Library API
   (ads_archive) requires app review + business verification + ID
   verification, coverage limited to social-issues/elections/politics
   by region. TikTok Commercial Content API requires approved research
   access (EU/US). Both stay pending-authorization: adapters ship as
   TYPED not-authorized states with the application path named — never
   a silent failure, never scraping.
2. **Observation only, never interception (AUDIT-SOURCES §5 ad policy)**:
   no ad-blocking, modification, or interception anywhere, ever. Ad
   Center observes ads ONLY via transparency sources and user-imported
   data — never by intercepting playback or network traffic.
3. **Separation is structural (roadmap)**: Ad Center data NEVER enters
   the organic ranking path. Not a convention — an architecture: ad
   shapes live in their own contract module, their own stores, their
   own use cases; the ranking use cases take no ad types. An
   architecture-check rule pins the separation.
4. **No global ad coverage — ever (roadmap + architecture-lock)**: every
   surface declares its coverage honestly (supported regions/categories
   per source); "no results" states are honest, never padded.
5. **Honesty rules carry over from Phase 4 (phase4-mi-plan §1-§8)**:
   additive contracts + semver minor + changelog; §2.6 jobs for long
   work; originals never mutated; explainability mandatory (reasons[]
   with evidence pointers); deterministic local engines with labeled
   test doubles; no network in engines; no fabricated ground truth —
   verification states what was CHECKED and against WHAT, never a
   "verified" badge without evidence.
6. **Claim extraction is EXTRACTIVE (the Phase-4 pattern)**: deterministic
   pattern-matched claim spans with citations to their source text; NO
   LLM, NO generative text, NO invented claims. A claim the source did
   not state is a defect.

## Sequencing (TL2 ruling)

| Order | Work ID      | Lane     | Scope                                                                                                                                                                                                                            |
| ----- | ------------ | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | P5-CONTRACTS | D2       | Ad Center contract module (additive sibling): AdRecord, AdvertiserIdentity, Claim, EvidenceLink, ReviewSignal, OfferVerification, QualificationExplanation + separation-pinning architecture rule + stores-ready shapes          |
| 2     | P5-STORES    | D2       | Durable Ad Center stores (migration 0006: records, identities, claims, evidence edges, review signals — own ad\_\* tables, per-profile isolation) + the import seam                                                              |
| 3     | P5-CLAIMS    | D2       | Deterministic claim extraction (extractive, cited spans) + evidence-graph construction over imported ad records                                                                                                                  |
| 4     | P5-VERIFY    | D2       | Offer verification (checks against declared sources — states WHAT was checked) + independent review signals (local, provenance-carrying)                                                                                         |
| 5     | P5-QUALIFY   | D2+shell | Explainable qualification (deterministic, reasons[] + evidence pointers, §4 pattern) + the Ad Center shell panel (scoped grant, tested, unmounted)                                                                               |
| 6     | P5-SOURCES   | D2       | Transparency-source port + honest adapters: Meta/TikTok TYPED pending-authorization (application path named), Google TYPED blocked; the manifest declares per-source coverage; the import path serves until authorizations clear |

Each order lands with the full gate battery + ledger row. Later-phase
platform writes remain parked (not Phase-5).

## Honest boundaries (recorded up front)

- No automated transparency access until authorizations clear (row 6
  ships the SEAM + typed states, not live scraping).
- No "verified" without named evidence; no coverage claims beyond what
  the manifest declares; no ad data in organic ranking — pinned by the
  architecture rule, not by convention.
- If a Phase-5 capability cannot map onto these rules: honest
  unavailable + freeze-deviation proposal, never force.
