# Work Order — WFX-DESKTOP-WEBFLIX-UX-1

Status: READY FOR TL2 DISPATCH  
Owner: TL2 (architecture, contracts, integration and final acceptance)  
Priority: Product-critical next desktop vertical slice  
Primary repo: https://github.com/payswapdotorg/WebFlix-Desktop  
Web behavior/UX reference: https://webflix-2-0-one.vercel.app/  
Reference source repo: https://github.com/payswapdotorg/WebFlix-2.0

## 1. Product outcome

Recompose WebFlix Desktop so that **the application opens into the WebFlix media experience, not a ZCode coding-workspace experience**. It should look, navigate and behave like the current WebFlix 2.0 web product, while keeping ZCode's mature agent runtime and productivity capabilities available as a first-class, user-toggleable layer.

A user should be able to browse, search, open channels and videos, watch long-form or short-form content, manage queues/library and access their own supported YouTube account in the desktop app. They must also be able to open the ZCode agent panel, select their model/provider, run or resume long tasks, and ask the agent to navigate or operate the visible WebFlix interface through typed, testable product actions.

Representative acceptance journey:

> User opens WebFlix Desktop → toggles the Agent panel → asks “Find and play the latest video from the MrBeast channel” → the agent resolves the intended channel using source-backed identity, finds its most recent available upload, opens the Watch surface, and starts it using the approved playback path. The selected video, route and player state are visibly reflected in the normal UI. The agent can be collapsed and ordinary playback/navigation remains usable.

This is an implementation work order, not permission to claim all web features are supported by desktop yet. Maintain a per-feature gap/evidence matrix.

## 2. Source review: start from the actual code

Pin and record the exact commits used for implementation. Repository heads observed when this order was prepared:

- Desktop: `f48405b3a1ac3f79ff0bb711d997374dc69a395f`
- Web reference: `e3dbf13b128b1d0a914b04b100342faacd580470`

Refresh both before starting; do not assume either remains HEAD or that the reference repo HEAD is identical to the deployed Vercel build.

Read the current repo's `AGENTS.md`, `docs/plans/tl2-handoff.md`, `docs/architecture/architecture-lock.md`, `docs/architecture/provider-policy-matrix.md`, `docs/architecture/youtube-parity-matrix.md`, `docs/adr/0003-youtube-first-per-user-identity.md`, `docs/product/requirements-matrix.md`, `docs/plans/desktop-roadmap.md`, `docs/plans/work-claims.md`, `docs/plans/worker-protocol.md`, and `docs/testing/desktop-acceptance.md`. Confirm the current phase/claim ledger and avoid colliding with active workers.

### Desktop UI/runtime landmarks already verified

- `packages/webflix-shell/src/components/AppShell.tsx`: current product navigation/composition root; screens include Home, Search, Library, Accounts, Ad Center, MI Evaluation and Settings.
- `packages/webflix-shell/src/components/HomeScreen.tsx`: current Home is a basic account/recent-items screen, not yet the reference web app's media-first home feed.
- `packages/webflix-shell/src/components/SearchScreen.tsx` and `WatchScreen.tsx`: existing typed search/playback shell; preserve their useful contract and honest unavailable states while improving UX and real wiring.
- `packages/ui/src/App.tsx`: inherited ZCode renderer/app orchestration and current workspace/task/navigation wiring. Study its state lifecycle before changing composition.
- `packages/ui/src/app-shell/WorkspaceShellLayout.tsx`: existing workspace shell composes sidebar, chat, terminal and other panes.
- `packages/ui/src/v4/V4ChatPane.tsx`: existing ZCode agent chat UI. Reuse it or a supported existing chat surface; do not create a second, disconnected agent runtime.
- `packages/ui/src/hooks/useModelProviders.ts` and `packages/ui/src/settings/ModelProviderSection.tsx`: provider/model-selection behavior that must remain reachable.
- The repo already has provider-neutral contracts and application/playback boundaries in `packages/webflix-contracts`, `packages/webflix-domain`, `packages/webflix-application`, `packages/connectors`, `packages/catalog`, and `packages/playback`. Consume public entrypoints; do not bypass these boundaries from React components.

### Web reference landmarks already verified

- `src/app/layout.tsx` mounts `src/components/app/app-shell.tsx`, which supplies the topbar, sidebar, scrolling main surface and global persistent player/queue/hover-preview/keyboard layers.
- `src/components/home/home-feed.tsx`: media-first, client-fetched feed from `/api/home`; category chips, interleaved long-form grids and Shorts shelves, continue-watching and infinite scrolling. Port observed behavior and layouts, not hard-coded fixtures.
- `src/components/watch/watch-page.tsx`: full Watch orchestrator, including persistent player host/miniplayer, queue, autoplay-next, transcript, comments, Ask panel, AI summary, channel/subscription actions and player context features.
- `src/components/watch/youtube-player.tsx`: inspect the player lifecycle and current policy/capability boundaries before implementing the desktop equivalent.
- `src/hooks/use-youtube-connection.ts`, `src/lib/watch/connection-client.ts`, `src/app/api/connection/youtube/route.ts`, and `src/app/api/connection/youtube/oauth/{start,callback}/route.ts`: the web app's current per-WebFlix-user connection state and OAuth lifecycle. This is a behavioral/security reference, **not proof that the same server routes or cookies can be reused from a native desktop profile**.
- The reference source may change quickly. Inspect current routes, page components, stores, server adapters and tests rather than relying on these names alone.

## 3. Binding architecture and implementation decisions

1. **Do not wrap or remotely host the deployed Next.js site as the desktop product.** Do not make the Vercel deployment a runtime dependency. Build a proper desktop UI with local routing/state and the desktop's own host integration. The web app is the behavioral/visual oracle.
2. **Do not delete or downgrade ZCode.** Preserve working agent chat/runtime, history, selectable model/provider configuration, tools/MCP, skills/subagents, background/long-running task lifecycle, progress/output/resume/cancel and notifications, plus existing native capabilities where product-identity/security flags permit them.
3. **Build a shared, explicit UI-action bridge.** The agent must not depend on brittle CSS selectors, arbitrary DOM injection, or hidden prompt tricks. Define typed, validated actions/use cases and observable outcomes (for example `searchCatalog`, `resolveChannel`, `openRoute`, `playCatalogItem`, `openAccountConnection`, `toggleAgentPanel`, `getVisibleMediaContext`). The normal buttons and agent use the same application use cases. Return typed success/failure/needs-user-choice/unsupported results, then verify visible state changed as intended.
4. **Bind model and provider choice to the existing ZCode configuration/runtime.** The agent panel is a presentation/composition change, not a replacement LLM agent. It must support switching providers/models in the normal settings/chat flow and accurately report unavailable credentials/models.
5. **Make agent panel visibility a first-class shell state.** Provide a clear, discoverable toggle in top-level chrome and a documented keyboard shortcut; panel is closable, resizable, scrollable and remembers its width/visibility safely. Use a docked right pane or overlay that does not crop/cover core player controls. When closed, all media features remain available. When open, the user can still see/control the current media context.
6. **YouTube identity and playback must be per-user and capability-truthful.** Never share an operator's cookies, OAuth tokens, browser session or broker writes among users. Keep secrets out of renderer/logs; use OS credential vault and profile isolation for native credentials. Show connected / not connected / re-auth required / not configured states honestly.
7. **Native OAuth is not the same as web OAuth.** The web routes are tied to a signed-in WebFlix web session, server-side client secret and server token store. For a desktop-native flow, use the appropriate registered desktop OAuth client, open Google consent in the system browser (not Electron's embedded webview), and handle a valid loopback/deep-link redirect with state/PKCE and secure token storage—or document and implement a separately reviewed account-bridge design. Never ship `GOOGLE_CLIENT_SECRET` or a web app secret in the binary. Google reference: https://developers.google.com/identity/protocols/oauth2/native-app
8. **Do not blindly port unofficial web backends.** Current web code can contain server-only, deployment-session-dependent, scraping/InnerTube/broker or token-specific behavior. Audit each source and operation against the desktop's provider policy matrix and current YouTube policies. Prefer official Data API for supported metadata/actions and the official YouTube IFrame player for playback; preserve required player and advertising behavior. No private endpoint, cookie replay, downloader, or undocumented fallback is approved just because the web app currently uses it. Mark gaps honestly until a compliant, authorized path is verified.
9. **Respect explicit-consent rules for account actions.** The agent may navigate/search/open/play in response to the user's clear request. It must not infer consent to Like, Subscribe, comment, upload, download or mutate account/library data from a vague instruction. Ask for confirmation when the intent or target is ambiguous or an account mutation needs express approval. Any YouTube action initiated from a user-facing surface must be clearly identified as a YouTube action.
10. **Preserve WebFlix identity and independent value.** Keep WebFlix branding clear; do not make users believe this is YouTube itself. Agent-assisted interface operation, explainable personal organization/recommendation, local media/library and cross-provider potential are part of the independent value. The current YouTube developer policy requires sufficient independent value when mimicking YouTube and prohibits disabling required player behavior: https://developers.google.com/youtube/terms/developer-policies-guide
11. **No dead controls and no fixture-as-production claims.** Every visible control works, is disabled with the reason, or shows a useful unsupported/unconfigured state. A UI mock, fixture, typecheck or successful deployment does not prove live data, OAuth, or playback.

## 4. Desired desktop UX composition

The exact details should follow an inspected current reference, not a screenshot-only guess. At minimum:

- WebFlix-native top chrome: identity, global video search, account/connection status, agent toggle, and conventional desktop window controls where applicable.
- Media-first navigation reflecting the currently supported web app: Home, Shorts, Trending, Subscriptions, Library/You, and relevant channel/playlist/watch/settings routes. Keep current Accounts, Ad Center, MI Evaluation and retention/settings capabilities reachable without overwhelming the primary media navigation.
- Home feed visually patterned after the current web feed: responsive but readable thumbnails, clear titles/channel/source, category controls, Shorts shelves, continue-watching, useful skeleton/empty/error/retry states, and append-only infinite scroll that does not jump the viewport.
- Search/autocomplete and filters; actual results with provenance/capability status and keyboard accessibility.
- Channel, playlist, Shorts, Trending and Subscriptions pages as supported by the reference. Do not fake parity for a route that lacks a supported backend.
- Watch surface with official-player integration where supported, responsive theater/normal layout, loading/error/unavailable states, metadata/action row, related content, queue, transcript/captions and supported comments/AI panels. Persistent mini-player and queue survive route transitions without duplicating or restarting the same player unnecessarily.
- Library, Watch Later/queues, progress/resume, and connected account/settings surfaces using the desktop's own persistence/account contracts.
- App layout handles small/restored/resized windows, page scrolling, independent side-pane scrolling, focus order, shortcuts, OS zoom and non-default font scaling. No cropped pages, uncloseable dialogs, dead ends or controls hidden behind the agent pane.
- Retain the current shell's truthful capability banners and accessible state semantics while updating its visual hierarchy, typography, spacing, colors, thumbnails, responsive grid and navigation to match the WebFlix reference.
- The agent should see current route, selected/playing item, visible catalog/channel IDs, connection/capabilities and pending user choice as structured context. It should never need to scrape the renderer to discover facts already available in the app state.

## 5. TL2 workflow and worker lanes

Before dispatching, TL2 updates `docs/plans/work-claims.md`, verifies all active claims and pins one base SHA. Freeze the small action/context/navigation contracts first. Run TL2 + three parallel workers with strictly separated ownership:

- **Worker 1 — WebFlix media UX and shell:** `packages/webflix-shell/**` plus explicitly granted shell-facing UI files only. Implement media-first navigation/layout, Home/Search/Watch visual and state parity, accessible/resizable agent-panel slot and component tests. No provider credential stores, auth adapters or changes to ZCode task semantics.
- **Worker 2 — Web parity and provider vertical slice:** inspect and wire catalog/search/channel resolution, playback planning, account capability state and supported YouTube operations through the provider-neutral packages. Own only the explicitly assigned connector/application/playback paths and associated tests. No Home/shell composition or chat rendering. Deliver a capability-by-capability source matrix and clearly mark unsupported web behaviors.
- **Worker 3 — ZCode agent/action bridge:** integrate the existing V4/ZCode agent runtime, model switching and long-task lifecycle into the WebFlix shell using the frozen action/context contracts. Own the specified `packages/ui` composition/runtime bridge files and agent/action tests; do not edit Worker 1 shell components or Worker 2 provider implementation.
- **TL2 — contracts, composition and proof:** audit security/architecture, resolve ownership conflicts, own any shared contracts/config/roadmap changes, integrate lanes serially, run actual desktop GUI and packaged acceptance, and publish a gap/evidence report.

All workers read the repository and work orders first; do not rely on this issue or chat as the only specification. Each reports base/head SHA, exact paths, commands, counts, limitations, screenshots and test artifacts. No overlapping edits; use the work-claims ledger and the existing worker protocol. Rebase or retry only after confirming the resulting SHA and claim owner.

## 6. Definition of done — evidence, not narrative

### A. Reference/parity inventory

Check in a route/component/behavior matrix with one row per surface: web reference path and live route; current desktop path/state; chosen desktop implementation; backing data/adapter; unsupported/policy note; automated test; actual GUI evidence. Compare the live deployed reference against the current web source and call out any deployment/source mismatch. Use screenshots of web and packaged desktop at comparable viewport sizes for Home, Search results, Watch, Shorts, Accounts/YouTube connection, and Agent closed/open. A screenshot is evidence, not the sole acceptance gate.

### B. GUI acceptance scenario

From a clean, isolated WebFlix profile on the actual Electron desktop:

1. Launch to the media-first WebFlix home, with no ZCode coding-workspace-only landing surface or ZCode product identity leak.
2. Navigate Home → Search → channel → Watch → Library/queue → Settings/Accounts via real clicks and keyboard navigation.
3. Demonstrate real search/catalog results and source-specific playback using the approved source path. Check loading, empty, offline, no-account, quota/error and unsupported states.
4. Toggle the Agent panel open, resize it, close it and reopen it without losing the player/navigation state. Scroll and resize the app; no content is cropped.
5. Ask “Find and play the latest video from the MrBeast channel.” With a real permitted data path, the agent resolves the intended channel, selects the newest published video with source timestamps/identity where available, issues the same `playCatalogItem` use case as the UI, and the real desktop player visibly starts the selected video. If disambiguation is needed, the agent asks before playing. Capture action trace and screenshot. Fixture-only runs are separately labelled.
6. Switch the configured model/provider through the existing ZCode settings/runtime; send a follow-up through the same agent chat and show selected provider/model truthfully.
7. Start a real long-running agent task; verify live status/output, minimize/collapse the panel, return, and resume/cancel/inspect the task without losing its execution identity.
8. Run a dedicated-account YouTube connect/disconnect round trip using system-browser OAuth on an authorized test account. Verify the intended account is shown, tokens stay out of renderer/URL/logs, no account leaks across profiles, and configured/not-configured/reauth states are truthful. If credentials/consent configuration are unavailable, mark the live OAuth gate BLOCKED—not passed.
9. Verify playback controls and any Like/Subscribe/playlist operations independently against the same authorized YouTube account. Do not use mocked success to close a live gate, and do not execute side-effecting account operations in the MrBeast scenario.
10. Verify local-media import/playback/library persistence and current packaged-desktop smoke remain intact.
11. Run the existing applicable gates documented in `docs/testing/desktop-acceptance.md`, plus new unit/component/integration/GUI E2E tests. Report exact commands, exit codes, totals, pinned SHA, OS/display, and evidence paths. No claimed green check without an actual run.

### C. Merge and status update

- Merge through the established review/integration flow, not by force-pushing main.
- Update the requirements matrix, YouTube parity/policy matrix, roadmap, work-claims ledger, acceptance evidence and TL handoff with actual status and remaining gaps.
- Keep feature rows BLOCKED or PARTIAL where auth, permissions, policy review, live source access or desktop GUI proof is missing.
- Do not call this “complete WebFlix desktop parity” until every required surface is evidence-backed or explicitly scoped out.

## 7. External policy references to verify during implementation

- Google native desktop OAuth: https://developers.google.com/identity/protocols/oauth2/native-app
- Google OAuth policy / embedded user agents: https://developers.google.com/identity/protocols/oauth2/policies
- YouTube API developer policies: https://developers.google.com/youtube/terms/developer-policies-guide

The linked policies may change; re-check them during implementation and record the date and findings in the provider policy matrix.