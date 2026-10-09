# Work order template

Copy this template into a new file under docs/plans/work-orders/ or use it in a tracked issue and link the issue from work-claims.md.

## Identity
- Work ID:
- Requirement IDs:
- Owner:
- Branch:
- Base SHA:
- Contract version / prerequisite SHA:

## Objective
Describe the user-visible outcome and why it matters.

## Non-goals
Name adjacent behavior intentionally not changed. Do not leave provider rights, user identity or failure behavior ambiguous.

## Allowed and forbidden paths
- Allowed:
- Forbidden:
- Shared-file owner:
- Architecture policy update needed:

## Dependencies and parallelism
- Must land first:
- Can run concurrently with:
- Must not overlap with:
- Merge order:

## Contract and state
- Public interfaces used:
- Public interface changes proposed:
- State owner:
- Events and idempotency:
- Provider/user/profile scope:
- Cache and retention rules:

## Behavior and acceptance
- Happy path:
- Empty/no-results:
- Requires-auth:
- Unsupported/unavailable:
- Timeout/rate-limited:
- Offline/restart/recovery:
- Permission and cancellation:
- Accessibility/keyboard/error UI:
- OS/package coverage:

## Security/policy
- External source/documentation:
- Authentication and user consent:
- Rights/retention constraints:
- Untrusted content boundary:
- Secrets/logging considerations:

## Required tests and commands
List the exact existing root/package commands and new test names. Separate hermetic fixtures, live source smoke tests, GUI/E2E and packaging tests.

## Evidence packet
- Base and head SHA:
- Changed file list:
- Design/ADR updates:
- Commands with exit status and test totals:
- Live/source verification (if authorized):
- OS/artifact/GUI results:
- Screenshots/logs sanitized:
- Known failures and residual limits:
- Requirement status change requested:

## Definition of done
- Contracts and implementation match.
- All required failure/permission states are honest.
- Tests cover behavior and meaningful regressions.
- Relevant architecture gates pass.
- UI works in the actual desktop app.
- Requirement/evidence/claim ledger updated.
- TL2 review and merge acceptance complete.