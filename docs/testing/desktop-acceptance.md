# Desktop acceptance and release gates

This is the user-visible release acceptance contract. Keep it in sync with requirements matrix and architecture lock.

## Gate tiers

1. **Static:** lint, typecheck, format check, module/architecture policy, dependency/cycle rules.
2. **Unit/contract:** canonical domain policy, schemas, capability statuses, source adapters against fixtures, storage and job state.
3. **Integration:** actual local persistence, adapter lifecycle, playback session, provider auth/capability handling, cache/quota/error paths.
4. **Desktop GUI/E2E:** launch Electron; interact through real desktop windows and renderer; verify navigation, accessibility, playback, persistence and failures.
5. **External source smoke:** only for permitted and authorized operation; record exact source, date, region/auth mode and tested actions separately from fixtures.
6. **Packaging:** produce a desktop distributable for the supported target OS, launch it from the packaged artifact, verify product identity, data directory, updater/security expectations and the core vertical slice.

A lower tier never substitutes for a higher tier. If a tier is not run, report it as not run with the reason and do not call the feature accepted.

## First release-candidate scenario

Test from a clean WebFlix development profile with no imported ZCode settings/session:

1. App starts with WebFlix identity, expected icon/title/menu and correct isolated user-data directory.
2. User can navigate the shell, reach library/settings and see clear initial/empty/error states.
3. User opens a local media file/folder through an explicit file-picker flow.
4. The local item is indexed and visible with real metadata where available; unavailable metadata is shown as such.
5. Local media plays in the intended UI; supported play/pause, seek and volume work. Other controls are shown only when supported by the selected player/asset.
6. User creates a collection/library entry and adds the item.
7. Playback progress/resume point persists after clean app restart and is not written to a provider account.
8. Renamed/moved/deleted/unreadable source file yields a recoverable state; reindex does not silently duplicate everything.
9. Airplane/offline network state still permits local library and local playback. External-source views show offline/partial coverage truthfully.
10. Fresh state with no auth never leaks a shared operator account. A protected operation reports requires-auth with an explicit connection path.
11. IPC/security tests show untrusted remote content cannot access host filesystem/credentials or privileged commands.
12. Architecture and automated gates pass on the exact merged SHA.
13. Packaged artifact launches and passes the same core scenario on a documented target OS.

## YouTube-first desktop acceptance

In addition to the local-first scenario above, test the first external-platform slice with a dedicated test user's own YouTube account and a fresh WebFlix profile:

1. Connect the test account using the approved authorization flow. The UI shows the connected provider identity/scopes without exposing tokens or cookies.
2. Search/browse real YouTube content through an approved path, see source attribution and open an item using the correct official playback experience.
3. Verify the specific supported account operation(s) against the same test user's YouTube account; no shared operator account, background credential substitution or cross-profile action is possible.
4. Test unauthenticated, missing-scope, expired/revoked, network error, quota/rate-limit and unsupported-operation states. Reconnect and disconnect/revoke behavior is accurate.
5. Verify required player behaviors and advertisements are not removed or blocked. Ensure YouTube-derived data is not presented as an unlabelled mixed-platform metric.
6. Check WebFlix's independent value rationale and current policy mapping. Where intended API-client behavior remains uncertain, do not call it accepted until TL2 records compliance guidance/audit decision.
7. Record tested surfaces and unsupported parity gaps individually; do not make a broad “full YouTube parity” claim based on one working video.

## Provider acceptance

For every provider operation:

- Current official docs/policy are linked in provider-policy-matrix.md with reviewer/date.
- Manifest declares supported media, operations, auth scopes, regions, quota, retention and known failures.
- Contract/adapter tests cover success and error statuses.
- External smoke tests demonstrate only the operations claimed supported.
- UI displays source provenance, coverage, auth requirement and limitations.
- No private credentials or personal media appear in tests/logs/screenshots.
- Data ownership/deletion behavior is explicit.

## Recommendation and media-intelligence acceptance

- Built-in recommendation path works without external model credentials.
- Ranking, filter policy and inference provider are separate; no silent watch-time maximization.
- Every explanation is grounded in available features, not fabricated user intent.
- Feedback, retention/reset and model/policy version can be traced.
- Derived artifacts are labelled and linked to source; source inputs/rights/permissions are recorded.
- Jobs report progress/cost where available and support retry/cancel/recovery.
- Original media/captions are unchanged by translation/dubbing/transformation.
- Tests include unavailable model/provider, invalid input, cancellation, repeated job and storage/restart.

## Ad Center acceptance

- Search UI states the queried source list and coverage; no global-completeness claim.
- Every AdAsset/AdvertiserIdentity/AdClaim/Offer/EvidenceRecord/ReviewSignal has source provenance and timestamps.
- Each factual claim displays supported/partial/contradicted/unsupported/unable-to-verify status and linked evidence.
- Unable-to-verify is not styled/labeled as false.
- Advertiser identity and offer fields distinguish verified, source-reported, conflicting and unknown.
- Review analysis explains volume, recency, source mix, verification signals and repeated themes where data allows; do not present a standalone average rating as factual validation.
- Qualification score/level, if used, has documented versioned criteria/weights and visible contributing evidence.
- User observation/ambient collection/cross-source linking require separate explicit consent and can be revoked/deleted as documented.

## Test evidence schema

For each accepted wave record: commit SHA, requirement IDs, OS/build identity, commands with exit status, unit/contract/integration totals, GUI/E2E scenarios, live smoke details, artifact link/checksum, redacted screenshots/logs, residual limitations and reviewer. Never infer test success from a commit message.
