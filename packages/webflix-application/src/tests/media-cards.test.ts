/**
 * media-cards — the WFX-PROVIDER-SLICE-1 card-builder battery.
 *
 * Pins the frozen card laws (src/media/media-cards.ts docblock):
 *   - THE CANONICAL ITEM RIDES VERBATIM (with the ONE documented
 *     adjustment: a shorts-classified row's card item carries mediaKind
 *     "short" — id/assets/metadata untouched);
 *   - THE DOCUMENTED SHORTS CLASSIFICATION RULE (not live AND positive
 *     duration ≤ 60s OR a #Shorts title marker);
 *   - LABELS ARE PRODUCER-FORMATTED + honest absence for absent facts;
 *   - BADGES ARE DATA (live / new ≤ 7 days / progress);
 *   - NEWEST-FIRST re-sort is the binding compose order (resolution,
 *     subscriptions), proven against out-of-order rows.
 */
import { describe, expect, it } from "vitest";
import type { CatalogItem, ContinueCardView, VideoCardView } from "webflix-contracts";
import {
  isShortRow,
  phaseFromCapability,
  sortRowsNewestFirst,
  videoCardFromRow,
  continueCardFromEntry,
  channelCardFromSummary,
  channelHeaderFromSummary,
  SHORTS_DURATION_CEILING_MS,
  NEW_BADGE_WINDOW_MS,
} from "../index";
import type { MediaWatchHistoryEntry, YouTubeVideoRow } from "../index";

const NOW = new Date("2026-10-23T12:00:00Z");

function item(videoId: string, title: string): CatalogItem {
  return {
    id: `youtube:video:${videoId}`,
    providerId: "youtube",
    title,
    mediaKind: "video",
    assets: [
      {
        assetId: `youtube:embed:${videoId}`,
        kind: "embed",
        reference: `https://www.youtube-nocookie.com/embed/${videoId}`,
      },
      {
        assetId: `youtube:thumb:${videoId}:medium`,
        kind: "thumbnail",
        reference: `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
      },
    ],
    matchEvidence: { confidence: 1, evidence: ["fixture row"] },
    metadata: { externalIds: { youtube: videoId } },
  };
}

function row(
  videoId: string,
  opts: Omit<Partial<YouTubeVideoRow>, "publishedAt"> & { title?: string; publishedAt?: string | null } = {},
): YouTubeVideoRow {
  const { publishedAt, ...rest } = opts;
  return {
    item: item(videoId, opts.title ?? `Fixture video ${videoId}`),
    channelId: "UCFIXCH0000000000000001",
    channelTitle: "Fixture Channel",
    ...(publishedAt !== null ? { publishedAt: publishedAt ?? "2026-10-21T12:00:00Z" } : {}),
    thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
    ...(rest.durationMs !== undefined ? { durationMs: rest.durationMs } : {}),
    ...(rest.viewCount !== undefined ? { viewCount: rest.viewCount } : {}),
    ...(rest.liveBroadcastContent !== undefined
      ? { liveBroadcastContent: rest.liveBroadcastContent }
      : {}),
    ...(rest.thumbnailUrl !== undefined ? { thumbnailUrl: rest.thumbnailUrl } : {}),
  };
}

describe("the documented shorts-classification rule", () => {
  it("positive duration ≤ 60s classifies as a short (60s inclusive)", () => {
    expect(isShortRow(row("FIXVID00001", { durationMs: 45_000 }))).toBe(true);
    expect(isShortRow(row("FIXVID00002", { durationMs: SHORTS_DURATION_CEILING_MS }))).toBe(true);
  });
  it("duration > 60s is long-form", () => {
    expect(isShortRow(row("FIXVID00003", { durationMs: 61_000 }))).toBe(false);
  });
  it("live rows are NEVER shorts", () => {
    expect(
      isShortRow(row("FIXVID00004", { durationMs: 45_000, liveBroadcastContent: "live" })),
    ).toBe(false);
  });
  it("a #Shorts title marker classifies rows without durations (case-insensitive, #short counts)", () => {
    expect(isShortRow(row("FIXVID00005", { title: "Neat trick #SHORTS" }))).toBe(true);
    expect(isShortRow(row("FIXVID00006", { title: "Neat trick #short" }))).toBe(true);
    expect(isShortRow(row("FIXVID00007", { title: "Neat trick #shortsword" }))).toBe(false);
  });
  it("no duration + no marker stays long-form (honest absence, never a guess)", () => {
    expect(isShortRow(row("FIXVID00008"))).toBe(false);
  });
});

describe("videoCardFromRow", () => {
  it("carries the canonical item VERBATIM for long-form rows", () => {
    const r = row("FIXVID00009", { durationMs: 253_000, viewCount: 12345 });
    const card: VideoCardView = videoCardFromRow(r, NOW);
    expect(card.item).toEqual(r.item);
    expect(card.item.mediaKind).toBe("video");
    expect(card.title).toBe(r.item.title);
    expect(card.channelId).toBe("UCFIXCH0000000000000001");
    expect(card.channelTitle).toBe("Fixture Channel");
    expect(card.thumbnailUrl).toBe("https://i.ytimg.com/vi/FIXVID00009/mqdefault.jpg");
    expect(card.durationLabel).toBe("4:13");
    expect(card.viewsLabel).toBe("12K views");
    expect(card.publishedLabel).toBe("2 days ago");
    // 2 days old sits inside the documented 7-day "new" window.
    expect(card.badges).toEqual(["new"]);
  });

  it("a shorts-classified row's card item carries mediaKind 'short' — id/assets/metadata untouched", () => {
    const r = row("FIXVID10003", { durationMs: 45_000, viewCount: 1048576 });
    const card = videoCardFromRow(r, NOW);
    expect(card.item.mediaKind).toBe("short");
    expect(card.item.id).toBe(r.item.id);
    expect(card.item.assets).toEqual(r.item.assets);
    expect(card.item.metadata).toEqual(r.item.metadata);
    expect(card.durationLabel).toBe("0:45");
    expect(card.viewsLabel).toBe("1M views");
  });

  it("absent facts produce absent labels, never fabricated ones", () => {
    const card = videoCardFromRow(row("FIXVID10004"), NOW);
    expect(card.durationLabel).toBeUndefined();
    expect(card.viewsLabel).toBeUndefined();
    expect(card.thumbnailUrl).toBe("https://i.ytimg.com/vi/FIXVID10004/mqdefault.jpg");
  });

  it("badges: live only when the provider says live; new within the 7-day window", () => {
    const live = videoCardFromRow(
      row("FIXVID10005", { liveBroadcastContent: "live", durationMs: 0 }),
      NOW,
    );
    expect(live.badges).toContain("live");
    expect(live.durationLabel).toBeUndefined(); // live rows carry no duration label
    const fresh = videoCardFromRow(
      row("FIXVID10006", { publishedAt: new Date(NOW.getTime() - 3 * 86_400_000).toISOString() }),
      NOW,
    );
    expect(fresh.badges).toContain("new");
    const older = videoCardFromRow(
      row("FIXVID10007", {
        publishedAt: new Date(NOW.getTime() - (NEW_BADGE_WINDOW_MS + 1_000)).toISOString(),
      }),
      NOW,
    );
    expect(older.badges).not.toContain("new");
  });
});

describe("continueCardFromEntry", () => {
  const entry: MediaWatchHistoryEntry = {
    itemId: "youtube:video:FIXVID10008",
    item: item("FIXVID10008", "Fixture half-watched"),
    positionMs: 754_000,
    durationMs: 1_508_000,
    watchedAt: "2026-10-23T10:00:00Z",
  };

  it("carries resume facts + the progress badge on the canonical item", () => {
    const card: ContinueCardView = continueCardFromEntry(entry, NOW);
    expect(card.item).toEqual(entry.item);
    expect(card.progressPercent).toBeCloseTo(0.5, 5);
    expect(card.progressLabel).toBe("12:34 of 25:08");
    expect(card.resumeAtSec).toBe(754);
    expect(card.badges).toContain("progress");
  });

  it("unknown duration means a null percent (honest), no progressLabel", () => {
    const card = continueCardFromEntry({ ...entry, durationMs: undefined }, NOW);
    expect(card.progressPercent).toBeNull();
    expect(card.progressLabel).toBeUndefined();
    expect(card.resumeAtSec).toBe(754);
  });
});

describe("channel cards + headers", () => {
  it("absent facts stay absent; verified stays false (no Data API verified field)", () => {
    const card = channelCardFromSummary({
      channelId: "UCFIXCH0000000000000002",
      title: "Fixture Shorts Lab",
    });
    expect(card.verified).toBe(false);
    expect(card.subscriberLabel).toBeUndefined();
    expect(card.videoCountLabel).toBeUndefined();
  });

  it("looked-up facts render as labels; the header adds banner + joined", () => {
    const header = channelHeaderFromSummary({
      channelId: "UCFIXCH0000000000000002",
      title: "Fixture Shorts Lab",
      handle: "@fixtureshortslab",
      subscriberCount: 1048576,
      videoCount: 312,
      description: "Fixture-only abridged description.",
      publishedAt: "2022-08-08T00:00:00Z",
      bannerUrl: "https://yt3.googleusercontent.com/fixture-banner",
    });
    expect(header.subscriberLabel).toBe("1M subscribers");
    expect(header.videoCountLabel).toBe("312 videos");
    expect(header.createdAtLabel).toBe("Joined Aug 2022");
    expect(header.bannerUrl).toContain("fixture-banner");
    expect(header.handle).toBe("@fixtureshortslab");
  });
});

describe("sortRowsNewestFirst (the binding compose order)", () => {
  it("re-sorts rows newest-first by publishedAt — API order is never trusted", () => {
    const oldest = row("FIXVID10001", { publishedAt: "2026-09-01T12:00:00Z" });
    const newest = row("FIXVID10003", { publishedAt: "2026-10-20T09:00:00Z" });
    const middle = row("FIXVID10002", { publishedAt: "2026-09-15T18:30:00Z" });
    expect(sortRowsNewestFirst([oldest, newest, middle]).map((r) => r.item.id)).toEqual([
      newest.item.id,
      middle.item.id,
      oldest.item.id,
    ]);
  });
  it("rows with an unknown publish instant sort LAST (stable)", () => {
    const unknown = row("FIXVID10009", { publishedAt: null });
    const known = row("FIXVID10010", { publishedAt: "2020-01-01T00:00:00Z" });
    expect(sortRowsNewestFirst([unknown, known]).map((r) => r.item.id)).toEqual([
      known.item.id,
      unknown.item.id,
    ]);
  });
});

describe("phaseFromCapability (frozen §2.3 → frozen view vocabulary)", () => {
  it("maps every capability status onto the honest view phase", () => {
    expect(phaseFromCapability({ status: "requires-auth" })).toBe("requires-auth");
    expect(phaseFromCapability({ status: "rate-limited" })).toBe("rate-limited");
    expect(phaseFromCapability({ status: "unsupported" })).toBe("unsupported");
    expect(phaseFromCapability({ status: "unavailable" })).toBe("unavailable");
    expect(phaseFromCapability({ status: "degraded" })).toBe("degraded");
    expect(phaseFromCapability({ status: "unknown" })).toBe("status-unknown");
  });
});
