/**
 * UI-action bridge contract shapes (WFX-DESKTOP-WEBFLIX-UX-1 — freeze §9).
 *
 * ADDITIVE module (semver minor 0.13.0 -> 0.14.0 per the §3 method): every
 * frozen §2.1–2.7 shape and every earlier additive sibling is untouched.
 *
 * What this module is: the TYPED AGENT<->UI BRIDGE — the only sanctioned
 * way an agent (ZCode runtime, tool, skill or MCP surface) operates the
 * visible WebFlix interface. Binding laws, encoded here:
 *
 * - SAME USE CASES AS THE BUTTONS: an agent action resolves through the
 *   exact application use cases the normal UI uses (searchCatalog -> the
 *   same search port; playCatalogItem -> the same playback planning). The
 *   bridge is a typed facade over the app's own actions, never a parallel
 *   implementation. No DOM-selector automation, no injected prompts, no
 *   renderer scraping: the agent discovers facts through
 *   getVisibleMediaContext, which the host answers from its OWN state.
 * - THE RESULT IS DATA, NOT A GUESS: every dispatch answers with a typed
 *   UiActionResult — ok (with a verifiable summary + evidence lines),
 *   failure (code + message + retryable), needs-user-choice (a typed
 *   prompt + labeled choices — the agent ASKS, it never picks for the
 *   user when the target is ambiguous), or unsupported (with the frozen
 *   capability vocabulary). A dispatched action is verified against the
 *   visible state it claimed to change (the ok context).
 * - NO ACCOUNT MUTATIONS RIDE THIS BRIDGE (freeze §9 consent law): the
 *   frozen action set is navigation/read/play only — searchCatalog,
 *   resolveChannel, openRoute, playCatalogItem, openAccountConnection,
 *   toggleAgentPanel, getVisibleMediaContext. Provider account mutations
 *   (like, subscribe, comment, playlist writes) require the user's
 *   express intent through their own consented surfaces and are
 *   DELIBERATELY ABSENT here. Additive extensions must re-review the
 *   consent rules before widening this set.
 * - IDS, NOT FABRICATED ITEMS: the agent references media by itemId it
 *   obtained from bridge results or visible context — it never submits a
 *   hand-built CatalogItem. The host resolves ids against its own state,
 *   so a hallucinated id fails typed, never plays something invented.
 */
import { z } from "zod";
import { IsoDateTimeSchema } from "./internal/primitives";
import { CapabilityStatusSchema } from "./capability";

// ---------------------------------------------------------------------------
// Routes — the frozen navigation model (mirror of the shell's route set)
// ---------------------------------------------------------------------------

/**
 * The navigable media surfaces. Kept in lockstep with the WebFlix shell's
 * route model; additive new routes bump this enum (never rename/renumber).
 * WFX-NETFLIX-SOURCE-1: `netflix` added additively (the web app's second
 * source hub — params.itemId selects the title detail, params.region the
 * country view; the hub itself renders when neither is set).
 */
export const MediaRouteSchema = z.enum([
  "home",
  "search",
  "watch",
  "channel",
  "shorts",
  "trending",
  "subscriptions",
  "library",
  "history",
  "settings",
  "accounts",
  "ads",
  "evaluation",
  "netflix",
]);
export type MediaRoute = z.infer<typeof MediaRouteSchema>;

/** Route parameters (all optional; a route reads only the keys it owns). */
export const RouteParamsSchema = z.object({
  /** search: the query to prefill. */
  query: z.string().optional(),
  /** watch: the catalog item id to open. netflix: the title id (as a string). */
  itemId: z.string().optional(),
  /** channel: the provider channel id (preferred) or handle (fallback). */
  channelId: z.string().optional(),
  handle: z.string().optional(),
  /** channel: the tab to select. */
  channelTab: z.string().optional(),
  /** trending: category chip + region. netflix: the country view ("Global"|"US"). */
  category: z.string().optional(),
  region: z.string().optional(),
});
export type RouteParams = z.infer<typeof RouteParamsSchema>;

// ---------------------------------------------------------------------------
// Connection + panel state (the context facts an agent may rely on)
// ---------------------------------------------------------------------------

/** Per-provider connection state as the agent sees it (renderer-safe). */
export const MediaConnectionStateSchema = z.enum([
  "connected",
  "not-connected",
  "reauth-required",
  "not-configured",
  "unknown",
]);
export type MediaConnectionState = z.infer<typeof MediaConnectionStateSchema>;

export const MediaConnectionViewSchema = z.object({
  providerId: z.string().min(1),
  state: MediaConnectionStateSchema,
});
export type MediaConnectionView = z.infer<typeof MediaConnectionViewSchema>;

export const AgentPanelViewSchema = z.object({
  visible: z.boolean(),
  /** The persisted panel width in px (null = default width). */
  widthPx: z.number().int().positive().nullable(),
});
export type AgentPanelView = z.infer<typeof AgentPanelViewSchema>;

// ---------------------------------------------------------------------------
// The visible media context — what the agent is allowed to "see"
// ---------------------------------------------------------------------------

/** A playing (or last-played) item summary — ids + display facts only. */
export const PlayingItemViewSchema = z.object({
  itemId: z.string().min(1),
  title: z.string(),
  providerId: z.string().min(1),
  mediaKind: z.string().min(1),
});
export type PlayingItemView = z.infer<typeof PlayingItemViewSchema>;

/**
 * The structured snapshot of the visible WebFlix interface. The host
 * answers getVisibleMediaContext from ITS OWN STATE — never a DOM scrape.
 * `visibleItemIds` is capped (25) so the payload stays prompt-sized.
 */
export const VISIBLE_CONTEXT_ITEM_CAP = 25;

export const VisibleMediaContextSchema = z.object({
  at: IsoDateTimeSchema,
  route: MediaRouteSchema,
  params: RouteParamsSchema,
  playingItem: PlayingItemViewSchema.nullable(),
  /** The playback plan kind currently mounted (null = nothing mounted). */
  watchPlanKind: z.string().nullable(),
  /** Item ids visible on the current surface, order = visual order. */
  visibleItemIds: z.array(z.string().min(1)).max(VISIBLE_CONTEXT_ITEM_CAP),
  connections: z.array(MediaConnectionViewSchema),
  agentPanel: AgentPanelViewSchema,
  /** Summary of an unresolved needs-user-choice (null = none pending). */
  pendingChoice: z.string().nullable(),
});
export type VisibleMediaContext = z.infer<typeof VisibleMediaContextSchema>;

// ---------------------------------------------------------------------------
// The action union — the frozen agent action set (freeze §9)
// ---------------------------------------------------------------------------

export const UiActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("searchCatalog"),
    query: z.string().trim().min(1),
    limit: z.number().int().positive().max(50).optional(),
  }),
  z.object({
    action: z.literal("resolveChannel"),
    /** A channel name, @handle, URL or channel id to resolve. */
    query: z.string().trim().min(1),
  }),
  z.object({
    action: z.literal("openRoute"),
    route: MediaRouteSchema,
    params: RouteParamsSchema.optional(),
  }),
  z.object({
    action: z.literal("playCatalogItem"),
    /** An itemId obtained from a bridge result or the visible context. */
    itemId: z.string().min(1),
    startAtSec: z.number().min(0).optional(),
  }),
  z.object({
    action: z.literal("openAccountConnection"),
    providerId: z.string().min(1),
  }),
  z.object({
    action: z.literal("toggleAgentPanel"),
    /** undefined = toggle; true/false = force. */
    visible: z.boolean().optional(),
  }),
  z.object({
    action: z.literal("getVisibleMediaContext"),
  }),
]);
export type UiAction = z.infer<typeof UiActionSchema>;

// ---------------------------------------------------------------------------
// Item summaries — how bridge results speak about media to the agent
// ---------------------------------------------------------------------------

/**
 * The agent-facing item summary: display facts + ids, never a full
 * CatalogItem (the agent cannot fabricate playable items from these).
 */
export const AgentItemSummarySchema = z.object({
  itemId: z.string().min(1),
  title: z.string(),
  providerId: z.string().min(1),
  mediaKind: z.string().min(1),
  channelTitle: z.string().optional(),
  publishedLabel: z.string().optional(),
  durationLabel: z.string().optional(),
});
export type AgentItemSummary = z.infer<typeof AgentItemSummarySchema>;

/** A channel as bridge results describe it (id + display facts only). */
export const AgentChannelSummarySchema = z.object({
  channelId: z.string().min(1),
  title: z.string(),
  handle: z.string().optional(),
  subscriberLabel: z.string().optional(),
  verified: z.boolean().optional(),
});
export type AgentChannelSummary = z.infer<typeof AgentChannelSummarySchema>;

// ---------------------------------------------------------------------------
// The result union — typed success / failure / choice / unsupported
// ---------------------------------------------------------------------------

/** Failure codes for bridge dispatches (caller-side or app-side truths). */
export const UiActionFailureCodeSchema = z.enum([
  "unknown-action",
  "invalid-action",
  "bridge-unavailable",
  "item-not-found",
  "route-unavailable",
  "provider-unreachable",
  "playback-unavailable",
  "action-refused",
]);
export type UiActionFailureCode = z.infer<typeof UiActionFailureCodeSchema>;

/** A labeled choice for the needs-user-choice result. */
export const AgentChoiceSchema = z.object({
  /** The value the agent re-submits (an itemId/channelId) when chosen. */
  id: z.string().min(1),
  label: z.string(),
  description: z.string().optional(),
});
export type AgentChoice = z.infer<typeof AgentChoiceSchema>;

export const UiActionResultSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("ok"),
    /** Human-readable statement of what the app did. */
    summary: z.string(),
    /** Item summaries relevant to the action (search results, uploads…). */
    items: z.array(AgentItemSummarySchema).default([]),
    /** Channel summaries relevant to the action. */
    channels: z.array(AgentChannelSummarySchema).default([]),
    /** Verbatim evidence lines (timestamps, ids, provenance). */
    evidence: z.array(z.string()).default([]),
    /** The post-action visible context (the verification snapshot). */
    context: VisibleMediaContextSchema.optional(),
  }),
  z.object({
    kind: z.literal("failure"),
    code: UiActionFailureCodeSchema,
    message: z.string(),
    retryable: z.boolean().default(false),
  }),
  z.object({
    kind: z.literal("needs-user-choice"),
    /** The question to put to the user, verbatim. */
    prompt: z.string(),
    choices: z.array(AgentChoiceSchema).min(1),
  }),
  z.object({
    kind: z.literal("unsupported"),
    /** The frozen capability status explaining why (requires-auth etc.). */
    capability: CapabilityStatusSchema,
    reason: z.string(),
    operationId: z.string().optional(),
  }),
]);
export type UiActionResult = z.infer<typeof UiActionResultSchema>;

// ---------------------------------------------------------------------------
// The dispatch port (interface only — implementations live app-side)
// ---------------------------------------------------------------------------

/**
 * The bridge dispatcher port. The agent-side adapter (tool/skill/MCP) calls
 * dispatch(); the WebFlix host implements it over the SAME use cases the
 * UI buttons use, then verifies the visible state changed as intended.
 */
export interface UiActionDispatcher {
  dispatch(action: UiAction): Promise<UiActionResult>;
  /** The current visible-media snapshot, from the host's own state. */
  getVisibleMediaContext(): VisibleMediaContext;
}

/** One executed action, for the action-trace evidence the acceptance run captures. */
export const AgentActionTraceEntrySchema = z.object({
  at: IsoDateTimeSchema,
  action: UiActionSchema,
  outcomeKind: z.literal("ok").or(z.literal("failure")).or(z.literal("needs-user-choice")).or(z.literal("unsupported")),
  summary: z.string(),
});
export type AgentActionTraceEntry = z.infer<typeof AgentActionTraceEntrySchema>;
