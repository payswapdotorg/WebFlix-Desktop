# Work order — P5-CLAIMS (Phase 5 row 3): deterministic claim extraction + the evidence graph

## Identity

- Work ID: P5-CLAIMS
- Requirement IDs: desktop-roadmap.md Phase 5 ("claim extraction, evidence graph"); phase5-ad-plan.md §1-§6 (BINDING — especially §6: extraction is EXTRACTIVE, a claim the source did not state is a defect); P5-CONTRACTS Claim shapes (offsets + quote discipline) + P5-STORES (the claim/evidence stores + ads.import seam)
- Owner: D2-lane worker (application + domain invariants; contracts only for a genuinely-missing code)
- Branch: p5-claims
- Base SHA: 0cf8c1a (main after the P5-STORES merge)

## Objective

The deterministic claim-extraction engine: pattern-matched claim spans
extracted from IMPORTED ad records (the stored creative text), each a
Claim with byte-exact offsets + quote, persisted through the P5-STORES
claim store; plus evidence-graph construction: linking extracted claims
to evidence nodes (typed kinds per the P5-CONTRACTS EvidenceLink) when
the INPUT BATCH carries the evidence data — never inferring evidence
the input did not provide.

Scope rows:

1. **Extraction engine (application)**: `AdsClaimExtractor` — a PURE,
   deterministic, pattern-based extractor over an ad record's creative
   text: typed claim PATTERNS (e.g. quantified-statements, comparative
   superlatives, pricing/offer phrasings, guarantee/assurance phrasings
   — the pattern set is a documented, fixed parameter list in the
   module docblock, like the built-in summarizer's weights); each
   match produces a Claim (quoted span + UTF-16 offsets, the
   P5-CONTRACTS discipline: byte-equal quote, offsets within source,
   validated through the domain invariants). NO LLM, NO generative
   text, NO invented claims — rg-provable: the ONLY claim construction
   is the matched substring of the ad's own text. Pattern matches that
   overlap are resolved deterministically (documented rule);
   no-match => honest empty list, never a forced claim.
2. **Use case (application)**: `ads.extractClaims` — rides §2.6
   (cancellable at boundary + cooperative between records); reads the
   stored ad records by id batch, extracts, validates through the
   domain invariants, persists through the claim store (the P5-STORES
   put semantics — same extractor version + same record = idempotent
   replace; a different extractor version = new provenance append,
   history never silently overwritten); the source ad record is NEVER
   mutated (deep-equal test); cancelled => Cancelled + nothing stored.
   The extractor's identity/version rides the claim provenance.
3. **Evidence-graph construction (application)**: `ads.linkEvidence` —
   §2.6 cancellable; takes EXPLICIT input: claim ids + evidence-node
   data (the typed kinds: source-reported-fact, independent-review,
   offer-terms, user-imported-document) + relationships; validates
   referential shape (claims must exist, the domain invariant checks),
   persists through the evidence-edge store (append-only, idempotent
   by edge identity). NO inference: the engine links EXACTLY what the
   input provides — an evidence node is never auto-derived from a
   claim's text (that would fabricate evidence).
4. **Test double + determinism**: a fixture extractor pattern (labeled
   test double) for cancellation/contract tests; the REAL extractor
   gets a determinism corpus test (same records => byte-identical
   claim set, sha256-pinned) + quote-discipline tests (every claim's
   quote byte-equal to its offsets slice; zero claims whose text does
   not appear in the source).

## Honest non-goals

- NO verification (P5-VERIFY decides what evidence MEANS), NO
  qualification (P5-QUALIFY), NO connectors (P5-SOURCES), NO UI, NO
  network, NO LLM, NO semantic embedding/scoring — the pattern set is
  lexical and DETERMINISTIC, its limits documented (it finds what its
  patterns match; recall is not promised).
- No evidence inference (linking is explicit-input only).

## Gates (run all; record exact commands + totals)

```
npx tsc -b --force packages/webflix-contracts packages/webflix-domain packages/webflix-application packages/local-library packages/webflix-shell   # 0 each
npx tsc -b --force packages/catalog packages/connectors packages/playback    # 0
pnpm test:unit          # all green (1104 at base + your new tests)
pnpm test:integration   # green
pnpm lint               # zero NEW vs base 69w/0e
pnpm fmt:check          # PASS
pnpm architecture:check # 0 (separation stays green)
pnpm --filter webflix-shell test:components   # 57/57 unchanged
```

Also rg evidence: no network; the only claim-text construction is the
matched source substring; fixture extractor labeled.

## Transport (NO push)

- Commits on branch p5-claims: code commit(s) + SEPARATE ledger-row
  update commit (P5-CLAIMS row -> delivered).
- git bundle create /tmp/p5-claims-bundle.txt 0cf8c1a..p5-claims,
  upload to tmpfiles.org (.txt rename), verify (GET + cmp; the token
  re-mints via the landing page), URL + sha256 in the report.
- Final report (last message, VERBATIM, between markers):

```
=== P5-CLAIMS REPORT BEGIN ===
BASE: <base sha> (branch base <dispatch-lock sha>)
BRANCH: p5-claims (head <sha>, <n> commits)
GATES:
- tsc contracts/domain/application/local-library/shell: <errors each>
- tsc unchanged lanes: <errors each>
- test:unit: <pass>/<total> (+<n> new)
- test:integration: <pass>/<total>
- lint: <warnings> vs base 69 (new: <n>)
- fmt:check: PASS/FAIL
- architecture:check: <violations>
- components: <pass>/<total>
EXTRACTOR: <files> — <the documented pattern set, 1 line each + the overlap rule>
- quote-discipline evidence: <rg + tests statement>
- determinism corpus: <file + sha256>
USE CASES: ads.extractClaims + ads.linkEvidence — <cancellability + idempotency + source-untouched statements>
EVIDENCE GRAPH: <the explicit-input-only statement + edge-identity idempotency>
HONEST LIMITS: <plain list>
FD PROPOSALS: <ids or none>
BUNDLE: <url> (sha256 <hash>)
=== P5-CLAIMS REPORT END ===
```

Reminder: report numbers must come from the gates you ACTUALLY ran. If a
gate cannot run, say so plainly with the reason — an honest failure beats
a fabricated pass.
