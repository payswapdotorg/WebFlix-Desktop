# WORK ORDER — AUDIT-SOURCES (Worker 3, Phase 0, read-only audit)

You are Worker 3 on a three-worker team building WebFlix-Desktop (an Electron desktop media product, YouTube-first, per-user accounts). TL2 (the technical lead) has dispatched you to perform Audit C: the sources/providers/media-engines audit. This is a READ-ONLY audit at one pinned SHA. You do not edit the repository. You deliver your report as your final chat message.

## 0. Non-negotiable rules

- READ-ONLY. Do not push branches, do not commit, do not open PRs. TL2 commits your report verbatim.
- Evidence rule: every claim about the repository cites `path:line` at the pinned SHA. Every claimed command lists the command line, exit status and actual totals. Pre-existing failures are recorded as pre-existing, never labeled new.
- NO credentials, NO operator cookies, NO tokens, NO real private media in your report or logs. If you find secrets in the repo, report their paths only, never their values.
- Do not fabricate. If something cannot be verified (no tool, no access, sandbox limit), say so explicitly in the report and continue with what IS verifiable. An honest "not verified" beats an invented fact.
- You have tools: bash (git clone, rg, etc.) and web search / web page reading. Use bash for the repo, web tools ONLY for official policy pages (YouTube/Google terms and API docs). Never log into any account.

## 1. Environment setup (do this first, exactly)

```bash
cd ~ && rm -rf wfx-audit && mkdir wfx-audit && cd wfx-audit
git clone https://github.com/payswapdotorg/WebFlix-Desktop.git repo
cd repo && git checkout 7a14bc9b24a1ac6f1b30c9a55efcdfaf4b8f9286
git rev-parse HEAD   # must print 7a14bc9b24a1ac6f1b30c9a55efcdfaf4b8f9286
```

Then read these binding documents IN THE REPO before anything else (they constrain your recommendations):

- AGENTS.md
- docs/adr/architecture-lock.md
- docs/adr/0001-webflix-product-boundaries.md
- docs/adr/0002-provider-capabilities-and-playback.md
- docs/adr/0003-youtube-first-per-user-identity.md (binding: YouTube-first, per-user identity, no shared operator session)
- docs/adr/capability-registry.md
- docs/adr/data-ownership.md
- docs/adr/provider-policy-matrix.md
- docs/adr/security-boundaries.md
- docs/plans/desktop-roadmap.md (your charter = "Audit C" section)

## 2. Audit C charter (from desktop-roadmap.md — verbatim scope)

Scope: inherited provider/model runtime, web/server playback/browser adapters, current WebFlix 2.0 integration/reference repo and target provider/engine landscape.

Deliver (each a numbered section of your report):

1. **YouTube capability-by-capability inventory**: browse/search, metadata, official playback, account auth, subscriptions/history/playlists/comments/likes/creator surfaces where supported, and actions NOT supported by official interfaces. For each: the official mechanism (Data API v3 method / IFrame Player / etc.), quota cost where documented, and the capability status per capability-registry.md vocabulary.
2. **Per-user OAuth/session/account ownership plan**: how a desktop app does per-user YouTube authorization through a reviewed supported flow (OAuth 2.0 installed-app flow / TV-limited-input flow etc.), token storage behind the OS vault boundary, refresh and revocation handling. Identify why the old operator-cookie/CDP broker (if present in the inherited runtime) is NOT reusable as a multi-user identity.
3. **Official YouTube policies/terms mapped to the desired interface**: independent value requirements, playback/advertising behavior (IFrame Player terms, no-ad-skipping, no background play constraints), API-data constraints (retention, caching, display rules), restricted access patterns (age-gate, region, API Terms of Service §limitations). Identify questions requiring compliance guidance — be explicit, do not guess legal conclusions.
4. **Candidate next social platforms ranked** by user value, supported capabilities, auth model, region, pricing/quota and policy risk (this feeds Phase 3).
5. **Engine candidates**: torrent engine candidate/license/maintenance/security investigation; plus media metadata/probe/ASR/translation/TTS/overview engine candidates and ad-transparency source access constraints.
6. **Provider policy rows** (table): provider | operation | official source link | policy constraint | open question | required smoke test. Seed it with YouTube rows; add candidate platforms from item 4.
7. **Inherited runtime inventory**: what provider/playback/browser-adapter code exists in the tree at the pinned SHA (paths + verdict retain/adapt/isolate/remove, with path:line citations), including anything inherited from the old WebFlix 2.0 reference.

## 3. Final report format (your LAST chat message, exactly this structure)

```
# AUDIT-SOURCES REPORT — Worker 3 — base 7a14bc9b24a1ac6f1b30c9a55efcdfaf4b8f9286

## 1. Executive summary (max 15 bullets, the decisions TL2 must make)
## 2. YouTube capability inventory (table: capability | official mechanism | quota cost | status | source link)
## 3. Per-user account ownership plan (flow, token boundary, why the cookie broker is not reusable)
## 4. YouTube policy mapping (policy | requirement | source link | constraint on our interface | open compliance question)
## 5. Next-platform candidates (ranked table with rationale)
## 6. Engine candidates (torrent / metadata / probe / ASR / translation / TTS / overview / ad-transparency)
## 7. Inherited runtime inventory (path:line | what it does | verdict)
## 8. Provider policy rows (table)
## 9. Commands run (command | purpose | exit code | totals | pre-existing failures)
## 10. Open questions for TL2 (numbered; each: why it blocks, what you verified vs not)
## 11. Sources (official links only; repo citations are internal)
```

End the report with the exact line: `AUDIT-SOURCES COMPLETE`

Work method: narrate progress in chat as you go (TL2's monitor reads the live transcript), but the report must be ONE final self-contained message. Take your time, verify citations, and do not rush the policy tables — they gate the contract freeze.

## 4. Constraints recap

- No provider integration implementation. Analysis and inventory only.
- The pinned SHA is the ONLY tree you audit. Note if the remote main has moved (git log origin/main -1) but audit the pinned SHA.
- Your sandbox is ~4GB RAM: avoid builds; you only read. `rg` over the tree is fine.
- If your session loses tools (no bash/web), STOP and say so in chat — do not fabricate.
