# P6-MOBILE-AUDIT-1 — the mobile-viewport audit results (per surface, per width)

Status: DELIVERED 2026-10-12 by the D2-lane worker (branch
p6-mobile-audit-1 on base c00c77c). The harness:
`apps/web-client/tests/mobile-viewport-audit.test.ts` (57 tests) —
device-emulated Chromium against the BUILT host (`dist/`, served over
loopback HTTP), four profiles: phone-375 / phone-390 / phone-430 /
tablet-768. The suite result at delivery: **98/98 green** (41 prior
web-client tests + 57 audit tests). This doc is the per-surface honest
accounting the work order demands.

## The emulation law (recorded honestly)

This environment's Chromium build reports a corrupted `window.innerWidth`
(a desktop-width value) when a context is created with `isMobile: true` —
verified before the harness was written, and again while diagnosing. The
harness therefore composes each device profile from the three flags that
report honestly here: `viewport` + `hasTouch` + `deviceScaleFactor: 2`.
The audit's phone widths are device-emulation profiles, not claims about
any specific handset.

## Pre-fix findings (the probe, run before any fix)

A throwaway probe (serving the same `dist/`, measuring geometry) recorded
the honest pre-fix state — these defects are what "fixed-by-this-row"
below refers to:

- Horizontal document overflow on EVERY screen at every phone width:
  `document.scrollWidth` 556-557px vs viewport 375-430px → 126-186px of
  horizontal scroll. Root cause: the shell's primary nav is a flex row
  that never wraps (the shell sets no `flexWrap` inline; its min-content
  ≈ 532px), so the shell root grid's middle column cannot shrink below
  the nav's width.
- Touch targets below the 44px bar everywhere: nav buttons 35px at
  tablet width (52px at phones only because labels wrapped to two
  lines), the host's own persistence select 31px, run/clear buttons
  29px, the shell's search input + submit 39px, the shell's ranker
  option labels 18px.
- The tablet width (768px) had NO overflow (the nav fits) — every
  defect above is phone-width-specific except the touch-target sizes,
  which were sub-44px at every width.

## Per-surface results matrix

Vocabulary: **pass** (no defect found) / **fixed-by-this-row** (defect
found, host-level fix delivered, test proves the fix) / **shell-defect**
(defect lives in webflix-shell's own inline styles; composed around at
the host level, recorded here, NEVER patched in place — zero changes
under packages/).

| Surface (owner)                             | phone-375               | phone-390               | phone-430               | tablet-768              | Proof (test names)                                                                                                                                                                                                       |
| ------------------------------------------- | ----------------------- | ----------------------- | ----------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Home screen (shell)                         | fixed-by-this-row       | fixed-by-this-row       | fixed-by-this-row       | pass                    | `overflow: home screen — no horizontal document overflow, screen marker visible` @ each width                                                                                                                            |
| Search screen (shell)                       | fixed-by-this-row       | fixed-by-this-row       | fixed-by-this-row       | pass                    | `overflow: search screen …` @ each width                                                                                                                                                                                 |
| Library screen (shell)                      | fixed-by-this-row       | fixed-by-this-row       | fixed-by-this-row       | pass                    | `overflow: library screen …` @ each width                                                                                                                                                                                |
| Accounts screen (shell)                     | fixed-by-this-row       | fixed-by-this-row       | fixed-by-this-row       | pass                    | `overflow: accounts screen …` @ each width                                                                                                                                                                               |
| Ad Center screen (shell)                    | fixed-by-this-row       | fixed-by-this-row       | fixed-by-this-row       | pass                    | `overflow: ads screen …` @ each width                                                                                                                                                                                    |
| MI Evaluation screen (shell)                | fixed-by-this-row       | fixed-by-this-row       | fixed-by-this-row       | pass                    | `overflow: evaluation screen …` @ each width                                                                                                                                                                             |
| Primary nav, reachable/usable (shell)       | shell-defect → composed | shell-defect → composed | shell-defect → composed | shell-defect → composed | `nav: reachable and usable — six labeled buttons; tap navigation switches the active screen` @ each width                                                                                                                |
| Primary nav, touch targets (shell)          | shell-defect → composed | shell-defect → composed | shell-defect → composed | shell-defect → composed | `nav: every nav button meets the 44px touch-target bar (host-composed min-height)` @ each width                                                                                                                          |
| Search form touch targets (shell)           | shell-defect → composed | shell-defect → composed | shell-defect → composed | shell-defect → composed | `search: the search form's input and submit meet the 44px bar (shell surface, host-composed min-height)` @ each width                                                                                                    |
| Ranker option labels, touch targets (shell) | shell-defect → composed | shell-defect → composed | shell-defect → composed | shell-defect → composed | `evaluation: ranker option labels meet the 44px bar (shell surface, host-composed min-height)` @ each width                                                                                                              |
| Persistence control, usable (host)          | fixed-by-this-row       | fixed-by-this-row       | fixed-by-this-row       | fixed-by-this-row       | `persistence: control usable — enabled, 44px target, honest options; host honesty buttons meet the 44px bar` + `persistence: opt-in is usable — choosing durable flips the notice to the durable statement` @ each width |
| Degraded path, exercised (host)             | pass                    | pass                    | pass                    | pass                    | `degraded: IndexedDB unavailable — typed notice, disabled control, session-only fallback; no overflow on any screen` @ each width                                                                                        |
| Unavailable-surface registry (host)         | pass                    | pass                    | pass                    | pass                    | `unavailable registry: all four surfaces declare themselves honestly (typed data, desktop paths named)` @ each width                                                                                                     |
| Harness profile registration (harness)      | pass                    | pass                    | pass                    | pass                    | `registers the charter's four device profiles exactly (375/390/430 phones + 768 tablet)`                                                                                                                                 |

Cell semantics: "fixed-by-this-row" = a real pre-fix defect measured by
the probe, a host-level fix delivered, and the named test green at that
width. "shell-defect → composed" = the defect lives in the shell's
inline styles; this row composes the responsive value at the host level
(see the fixes section) and records the shell debt below. "pass" = no
defect at that width (the probe measured it before any fix).

## The fixes this row delivered (host-level, apps/web-client ONLY)

1. `apps/web-client/index.html` — a composition `<style>` block in the
   host document: `nav[aria-label="Primary"] { flex-wrap: wrap; }` (the
   shell never sets flexWrap inline; at 375 the nav now wraps to two
   rows — Accounts/Ad Center/MI Evaluation wrap to the second row — and
   the document's horizontal overflow collapses to zero), plus
   `min-height: 44px` on the nav buttons, the search screen's
   input/submit, and the ranker option labels — each selector scoped to
   the shell's stable, semantic markup (`section[aria-label="Search"]`,
   `label[for^="ranker-adapter-option-"]`). Only properties the shell
   leaves UNSET are composed (no `!important`, no fights with inline
   styles).
2. `apps/web-client/src/App.tsx` — `minHeight: 44` on the HOST's own
   `select` and button styles (the persistence control, the run and
   forget buttons).
3. `apps/web-client/package.json` + root `pnpm-lock.yaml` —
   `playwright-core@1.64.0` as a web-client devDependency (the audit
   engine; the lockfile diff is the importer block + one package entry,
   nothing else moves — the wiring precedent of the
   fake-indexeddb devDependency from P6-DURABLE-WEB-1).

Post-fix measurements (the same probe, re-run): zero horizontal overflow
at all four widths on all six screens; every measured touch target
exactly ≥ 44px; the nav wraps to two rows at 375.

## The shell debt (honest limits) + the demanded follow-up

The defects this row composed around live in `packages/webflix-shell`:
the primary nav never wraps and renders sub-44px buttons at tablet+
widths; the search form controls render 39px; the ranker option labels
render 18px. Per the work order these are recorded here, never patched
in place. Every future host that composes the shell onto a phone will
meet the same debt — which is why this audit doc drafts the follow-up
below.

## Queued follow-up order (DRAFTED — NOT dispatched; TL2 owns dispatch)

### Draft order — P6-SHELL-RESPONSIVE-1 (the shell's own responsive pass)

- Work ID: P6-SHELL-RESPONSIVE-1. Requirement IDs: WF-032 (mobile half);
  phase6-mobile-ruling.md §3 condition 3 (the unavailable-surface
  registry re-read on mobile + mobile-only unavailability as typed data).
  Owner: D2-lane worker (packages/webflix-shell additive-styling grant).
  Branch: p6-shell-responsive-1; base: main after the P6-MOBILE-AUDIT-1
  merge.
- Objective: move the responsive truth INTO the shell — additive-only
  style changes in webflix-shell components (nav `flexWrap: wrap` +
  `minHeight: 44` on nav buttons; `minHeight: 44` on search form
  controls and ranker option labels), shell component tests extended to
  pin the geometry, and a mobile-only unavailability review: any
  capability the mobile runtime lacks that the shell surfaces must be
  declared as TYPED data (the registry pattern), never prose. When this
  lands, the web host's composition CSS in `index.html` shrinks or
  disappears (the host stops compensating).
- Honest non-goals: NO component-API changes (props stay
  additive-optional), NO new screens, NO contract changes (0.11.0), NO
  PWA artifacts, NO changes to application/domain/contracts, NO new
  architecture registrations (shell is already a registered module).
- Gates: the seven standard commands + `pnpm --filter webflix-shell
test:components` (80 prior + the new geometry tests) + `pnpm --filter
web-client test` (98, unchanged green — the host keeps passing as the
  shell takes over the responsive truth) + `pnpm --filter web-client
build` emits.
- Transport: same bundle protocol (code commit + separate ledger-row
  commit; git bundle + tmpfiles.org + sha256 in the report).

## Honest limits of THIS row

- The audit is device EMULATION in headless Chromium (four profiles),
  not physical-handset testing — no claim about any specific device,
  engine version, or touch hardware.
- The emulation-law workaround (no `isMobile: true`) is recorded above;
  it cost nothing the audit needed (viewport widths, touch targets and
  layout are the audit's subjects).
- The `hasTouch` context flag is set, but the tests exercise TAP via
  Playwright's click; no multi-touch/gesture claims.
- The durable opt-in is verified in the emulated engine at each width;
  iOS-Safari-specific storage behaviors (quota eviction, private-mode)
  are NOT emulated — those remain P6-MOBILE-RULING.md §3 condition 2's
  territory for a later, engine-specific verification.
- No matrix edit: this row's ledger grant carries no
  docs/product/requirements-matrix.md path; the WF-032 mobile half
  stays exactly as the ruling left it (web half tested; mobile half not
  claimed until TL2 rules on this row's evidence).
- FD PROPOSALS: none — no contract, interface or runtime-seam change
  was needed or proposed (the composition-CSS approach is host-level
  only).
