# Work Order — WFX-UX-SHELL-1 (Worker 1: media-first shell)

Parent order: `docs/plans/work-orders/WFX-DESKTOP-WEBFLIX-UX-1.md` (source of truth — read it first).
Frozen law: `docs/plans/contract-freeze.md` §9 + `webflix-contracts` v0.14.0 (`src/ui-actions.ts`, `src/media-views.ts` — read both before designing).
Web reference (visual/behavioral oracle): the WebFlix 2.0 web app source layout summarized in the parent order §2; observe the reference repo only for behavior/layout, never port its server code.

## Ownership (strict — no edits outside)

- **owns**: `packages/webflix-shell/**` (all source + tests).
- **explicitly granted additions**: NONE this lane. The desktop renderer host (`packages/desktop/src/renderer/src/webflix/boot.tsx`) is TL2's integration file — do not touch it. The agent panel CONTENT is Worker 3's; you provide only the SLOT (see deliverable 7).

## Deliverables

1. **Media-first shell chrome**: replace the current top-nav-only layout with a reference-patterned shell: a collapsible left sidebar (icon rail when collapsed) + top chrome (global search input, account/connection status, agent-panel toggle button, product mark) + scrollable main surface + the ADR-0003 independent-value footer retained. Sidebar navigation: Home, Shorts, Trending, Subscriptions, Library, History, Settings, Accounts + the existing Ad Center / MI Evaluation destinations reachable (a second group or overflow — do not delete capabilities).
2. **Route model**: extend the screen state to the frozen `MediaRoute` set (`webflix-contracts` ui-actions.ts) with route params (search query, watch itemId, channel channelId/handle+tab, trending category). Navigation must be keyboard-accessible (tab order, focus states, Enter activation) and every visible control works or shows its honest state.
3. **HomeScreen — media-first feed**: consume the frozen `HomeFeedView` (sections model): category chips row, responsive thumbnail grid cards (video-card component: thumbnail, title, channel, duration/views/published labels, badges), shorts shelves (vertical 9:16 tiles in a horizontal rail), continue-watching rail (progress overlay), per-section honest states (loading skeleton, requires-auth, rate-limited, unavailable with retry where the port allows), append-only growing grid (cursor pagination hook — `nextCursor`), no viewport jump on append. Support `compositionNote` display (subtle "how this feed was composed" line).
4. **SearchScreen upgrade**: results as card list (video cards + channel cards from `SearchPageData.channels`), the existing honest-phase vocabulary preserved (idle/loading/results/empty/requires-auth/…), cursor "load more" paging, the query echo + budget note when present. Keep the existing youtube-link direct-play behavior contract.
5. **New surfaces**: ChannelScreen (ChannelHeaderView band + tabs from `availableTabs` + videos grid + shorts rail), TrendingScreen (chips + region + grid), ShortsScreen (vertical full-bleed feed with per-short play action — honest states), SubscriptionsScreen (channel rail + videos grid + degradeNote display), HistoryScreen (grouped continue-watching), LibraryScreen (existing local entries + collections, visual upgrade to cards).
6. **WatchScreen upgrade**: theater/normal toggle layout, the IFrame embed host (existing `official-embed` plan contract unchanged), metadata band (title, channel, views/published labels from the item's card view facts), action row (honest placeholders where account ops are unsupported — no dead buttons: disabled with reason), related rail (video cards), queue strip (WebFlix-local — items + now-playing marker), and the typed controls strip (existing P7 PLAYER contract preserved). Player state must survive panel open/close and sidebar navigation (the watch view stays mounted while the user navigates non-watch routes — a docked/mini persistent layout is allowed per freeze §9.6 within the visible window).
7. **Agent panel SLOT**: a right-docked slot in the shell layout: resizable (drag handle), closable, persisted width + visibility (inject a `PanelPersistence` callback prop — the host provides storage; default in-memory), lazy content (`children`/render prop — content mounts only when open), never covers the player controls at any width ≥ 320px, and the toggle button in top chrome with a documented keyboard shortcut (suggest Ctrl/Cmd+J; record in a SHORTCUTS doc comment). Testids: `agent-panel`, `agent-panel-toggle`, `agent-panel-resize-handle`.
8. **Component tests** for every new surface + the slot behavior (resize/persist/lazy mount/no-overlap assertion at min width) in the existing `packages/webflix-shell/tests/*.test.tsx` conventions (jsdom + @testing-library/react).

## Binding laws

- Consume ONLY `webflix-contracts` + `webflix-application` public entrypoints (`@webflix/contracts` shapes via the shell's existing import conventions — follow current file imports). No direct connector imports, no network, no Electron imports in webflix-shell.
- The frozen view shapes are the data contract — the shell maps them to UI; it never invents rows (empty sections render honestly per `MediaViewPhase`).
- WebFlix theme stays its own (teal accent, dark surface — see `src/theme.ts`); NO ZCode UI imports, NO @zcode/ui styles in the shell.
- Visual parity target: the reference's proportions (3-up grid on wide, 16:9 thumbs, shelf heights) — NOT pixel-perfect cloning; responsive breakpoints for narrow windows (sidebar collapses to icon rail).

## Gates (run + record exact commands, exit codes, totals)

1. `pnpm --filter webflix-shell test:components` (all existing tests must stay green — breaking changes to props need justification in the report; prefer additive props).
2. Root `pnpm exec vitest run packages/webflix-shell` if configured differently — follow the package's own scripts.
3. `pnpm --filter webflix-shell exec tsc --noEmit` or the repo's established typecheck path for the package.
4. `pnpm lint` scoped to changed files (`pnpm exec oxlint packages/webflix-shell`).

## Report back (worklog + final message)

Base SHA, head SHA, files changed, test totals (before/after), the visual decisions (breakpoints, shortcut), limitations, and screenshots are NOT required from you (TL2 captures GUI evidence at integration) — instead provide a precise component inventory table: component → props → consumed frozen types → testids (TL2's e2e will target these testids).
