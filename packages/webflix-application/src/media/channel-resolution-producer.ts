/**
 * ChannelResolutionPort producer (WFX-PROVIDER-SLICE-1) — THE MRBEAST
 * JOURNEY DATA PATH behind the agent's resolveChannel action.
 *
 * The resolution algorithm (documented, binding):
 *
 *  1. PARSE the query: a bare channel id (UC… 22 chars) → channels.list
 *     by id; a @handle or a youtube.com/@handle|/c/|/user/ URL →
 *     channels.list forHandle; anything else (a name, or a URL that
 *     yielded no handle) → the search path.
 *  2. HANDLE/ID LOOKUP: the provider's own no-such-channel answer
 *     (`{ channel: null }`) falls through to the search path (a mistyped
 *     handle can still find candidates honestly); an honest state (quota/
 *     network/auth) answers `{ kind: "unavailable", phase, detail }`.
 *  3. SEARCH PATH: search.list type=channel (100 units) → candidates.
 *     AMBIGUITY RULE (frozen in the work order): an EXACT handle match
 *     (case-insensitive, leading-@ insensitive) or an EXACT name match
 *     (case-insensitive trim) resolves directly — two or more exact
 *     matches stay ambiguous; otherwise exactly ONE candidate is the
 *     strong match and resolves; multiple plausible candidates answer
 *     `{ kind: "ambiguous", candidates }` (capped at 5 — the agent ASKS,
 *     it never picks for the user); zero candidates answer
 *     `{ kind: "not-found" }`.
 *  4. RESOLUTION: the channel header (a channels.list lookup — 1 unit —
 *     fills statistics when the candidate came from search, whose
 *     snippets carry no subscriber counts) plus the uploads shelf
 *     (channelUploadsCatalog: channels.list contentDetails +
 *     playlistItems.list + the documented enrichment read), RE-SORTED
 *     newest-first by publishedAt DESC client-side — the binding law: API
 *     row order is never trusted. Each upload card carries its
 *     publishedLabel (the deterministic en-US label) — the recency
 *     evidence the journey cites.
 *
 * Honest phases: a failing uploads read after a successful resolution
 * answers `{ kind: "unavailable", phase, detail }` naming the resolved
 * channel (documented shape decision: the frozen resolved variant has no
 * partial-detail slot, and an empty uploads list would dishonestly read
 * as "the channel has no videos").
 */
import type { ChannelCardView, ChannelHeaderView, ChannelResolutionPort, VideoCardView } from "webflix-contracts";
import {
  channelCardFromSummary,
  channelHeaderFromSummary,
  detailFromCapability,
  phaseFromCapability,
  sortRowsNewestFirst,
  videoCardFromRow,
} from "./media-cards";
import type { ClockPort } from "../ports";
import type {
  YouTubeCatalogSource,
  YouTubeCatalogSourceHandle,
  YouTubeChannelSummary,
} from "./youtube-source-port";

export interface ChannelResolutionProducerDeps {
  readonly clock: ClockPort;
  readonly source: YouTubeCatalogSourceHandle;
  /** Uploads surfaced in a resolved outcome (1..50; default 12). */
  readonly defaultUploadsLimit?: number;
}

const DEFAULT_UPLOADS_LIMIT = 12;
const MAX_AMBIGUOUS_CANDIDATES = 5;

const CHANNEL_ID_PATTERN = /^UC[A-Za-z0-9_-]{22}$/;
const HANDLE_PATTERN = /^@[\w.-]+$/;

/** The channel-resolution producer (the agent journey's data path). */
export class YouTubeChannelResolutionProducer implements ChannelResolutionPort {
  private readonly deps: ChannelResolutionProducerDeps;

  constructor(deps: ChannelResolutionProducerDeps) {
    this.deps = deps;
  }

  async resolveChannel(
    query: string,
    options?: { uploadsLimit?: number },
  ): Promise<
    | { kind: "resolved"; channel: ChannelHeaderView; uploads: VideoCardView[] }
    | { kind: "ambiguous"; candidates: ChannelCardView[] }
    | { kind: "not-found" }
    | { kind: "unavailable"; phase: ReturnType<typeof phaseFromCapability>; detail?: string }
  > {
    const trimmed = typeof query === "string" ? query.trim() : "";
    if (trimmed === "") return { kind: "not-found" };

    if (this.deps.source.kind !== "source") {
      return {
        kind: "unavailable",
        phase: "requires-auth",
        detail: this.deps.source.detail,
      };
    }

    const engine = this.deps.source.source;
    const parsed = parseChannelQuery(trimmed);

    // 1. The direct lookup paths (id / handle).
    if (parsed.channelId !== undefined || parsed.handle !== undefined) {
      const lookup =
        parsed.channelId !== undefined
          ? await engine.channelById(parsed.channelId)
          : await engine.channelByHandle(parsed.handle ?? "");
      if (lookup.kind === "honest-state") {
        return {
          kind: "unavailable",
          phase: phaseFromCapability(lookup.capability),
          detail: detailFromCapability(lookup.capability),
        };
      }
      if (lookup.value.channel !== null) {
        return this.resolvedOutcome(engine, lookup.value.channel, options?.uploadsLimit);
      }
      // The provider's no-such-id/handle answer falls through to search —
      // a mistyped handle can still find candidates honestly.
    }

    // 2. The search path.
    const searchOutcome = await engine.searchChannels({
      q: parsed.searchQuery,
      maxResults: MAX_AMBIGUOUS_CANDIDATES + 3,
    });
    if (searchOutcome.kind === "honest-state") {
      return {
        kind: "unavailable",
        phase: phaseFromCapability(searchOutcome.capability),
        detail: detailFromCapability(searchOutcome.capability),
      };
    }
    const candidates = searchOutcome.value.channels;
    if (candidates.length === 0) return { kind: "not-found" };

    // 3. The ambiguity rule (module docblock): exact handle or exact name
    //    resolves; else one candidate = the strong match; else ambiguous.
    const exactMatches = candidates.filter((candidate) => isExactMatch(candidate, parsed));
    const [soleExact] = exactMatches;
    if (exactMatches.length === 1 && soleExact !== undefined) {
      return this.resolvedOutcome(engine, soleExact, options?.uploadsLimit);
    }
    if (exactMatches.length > 1) {
      return { kind: "ambiguous", candidates: exactMatches.slice(0, MAX_AMBIGUOUS_CANDIDATES).map(channelCardFromSummary) };
    }
    const [soleCandidate] = candidates;
    if (candidates.length === 1 && soleCandidate !== undefined) {
      return this.resolvedOutcome(engine, soleCandidate, options?.uploadsLimit);
    }
    return {
      kind: "ambiguous",
      candidates: candidates.slice(0, MAX_AMBIGUOUS_CANDIDATES).map(channelCardFromSummary),
    };
  }

  // ---- internals -------------------------------------------------------------

  private async resolvedOutcome(
    engine: YouTubeCatalogSource,
    candidate: YouTubeChannelSummary,
    uploadsLimit: number | undefined,
  ): Promise<
    | { kind: "resolved"; channel: ChannelHeaderView; uploads: VideoCardView[] }
    | { kind: "unavailable"; phase: ReturnType<typeof phaseFromCapability>; detail?: string }
  > {
    // Search-derived candidates carry no statistics — fill the header with
    // ONE channels.list lookup (1 unit). A failing lookup degrades to the
    // search summary's own facts (honest absence of subscriberLabel).
    let summary = candidate;
    if (candidate.subscriberCount === undefined) {
      const detail = await engine.channelById(candidate.channelId);
      if (detail.kind === "ok" && detail.value.channel !== null) summary = detail.value.channel;
    }

    const uploads = await engine.channelUploads({
      channelId: summary.channelId,
      maxResults: clampUploadsLimit(uploadsLimit ?? this.deps.defaultUploadsLimit ?? DEFAULT_UPLOADS_LIMIT),
    });
    if (uploads.kind === "honest-state") {
      return {
        kind: "unavailable",
        phase: phaseFromCapability(uploads.capability),
        detail: `channel "${summary.title}" resolved, but its uploads shelf answered ${
          phaseFromCapability(uploads.capability)
        }: ${detailFromCapability(uploads.capability)}`,
      };
    }

    // The binding newest-first law: re-sort client-side by publishedAt
    // DESC — API row order is never trusted. Cards carry publishedLabel
    // (the recency evidence the journey cites).
    const now = this.deps.clock.now();
    const cards = sortRowsNewestFirst(uploads.value.rows).map((row) => videoCardFromRow(row, now));
    return { kind: "resolved", channel: channelHeaderFromSummary(summary), uploads: cards };
  }
}

// ---------------------------------------------------------------------------
// Query parsing + the ambiguity rule helpers
// ---------------------------------------------------------------------------

interface ParsedChannelQuery {
  readonly channelId?: string;
  readonly handle?: string;
  readonly searchQuery: string;
}

/**
 * Parses a channel query: bare UC id; @handle; youtube.com/channel/UC…,
 * /@handle, /c/…, /user/… URLs; anything else is a name search. URL
 * prefixes are stripped for the search fallback (best-effort, honest —
 * unparsable input searches verbatim).
 */
export function parseChannelQuery(query: string): ParsedChannelQuery {
  const trimmed = query.trim();
  if (CHANNEL_ID_PATTERN.test(trimmed)) {
    return { channelId: trimmed, searchQuery: trimmed };
  }
  if (HANDLE_PATTERN.test(trimmed)) {
    return { handle: trimmed, searchQuery: trimmed.slice(1) };
  }
  const channelFromUrl = /youtube\.com\/channel\/(UC[A-Za-z0-9_-]{22})/i.exec(trimmed);
  if (channelFromUrl !== null) {
    const channelId = channelFromUrl[1];
    return channelId !== undefined ? { channelId, searchQuery: channelId } : { searchQuery: trimmed };
  }
  const handleFromUrl = /youtube\.com\/(?:@([\w.-]+)|c\/([\w.-]+)|user\/([\w.-]+))/i.exec(trimmed);
  if (handleFromUrl !== null) {
    const handle = handleFromUrl[1] ?? handleFromUrl[2] ?? handleFromUrl[3];
    if (handle !== undefined) return { handle: `@${handle}`, searchQuery: handle };
  }
  return { searchQuery: trimmed };
}

/** Exact-match key for handles: leading-@ insensitive, case-insensitive. */
function handleKey(handle: string): string {
  return handle.trim().replace(/^@/, "").toLowerCase();
}

/** The ambiguity rule's exact test: exact handle OR exact name (case-insensitive). */
function isExactMatch(candidate: YouTubeChannelSummary, parsed: ParsedChannelQuery): boolean {
  if (parsed.handle !== undefined && candidate.handle !== undefined) {
    if (handleKey(candidate.handle) === handleKey(parsed.handle)) return true;
  }
  const queryName = parsed.handle !== undefined ? parsed.handle.replace(/^@/, "") : parsed.searchQuery;
  return candidate.title.trim().toLowerCase() === queryName.trim().toLowerCase();
}

function clampUploadsLimit(limit: number): number {
  return Math.min(50, Math.max(1, Math.floor(limit)));
}
