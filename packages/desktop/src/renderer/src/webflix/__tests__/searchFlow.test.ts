import { describe, expect, it, vi } from "vitest";

/*
 * P9-UI-1 (order requirements 3+4 + requirement 6) — the search-flow pins:
 * official YouTube links resolve through the reviewed provider operation
 * (the official IFrame embed) and play immediately; keyword queries resolve
 * to the honest requires-auth state. No search results are EVER invented.
 */

import { resolveSearchQuery, YOUTUBE_PROVIDER_ID } from "../searchFlow.js";

describe("official YouTube links are direct navigation (requirement 4)", () => {
  it.each([
    ["dQw4w9WgXcQ", "bare 11-char id"],
    ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "watch url"],
    ["https://youtu.be/dQw4w9WgXcQ", "short share url"],
    ["https://www.youtube.com/embed/dQw4w9WgXcQ", "embed url"],
    ["https://www.youtube.com/shorts/dQw4w9WgXcQ", "shorts url"],
    ["https://m.youtube.com/watch?v=dQw4w9WgXcQ", "mobile watch url"],
    ["https://music.youtube.com/watch?v=dQw4w9WgXcQ", "youtube music url"],
  ])("%s (%s) resolves to the official-embed plan and plays", (query) => {
    const outcome = resolveSearchQuery(query);
    expect(outcome.kind).toBe("youtube-link");
    if (outcome.kind !== "youtube-link") return;
    expect(outcome.videoId).toBe("dQw4w9WgXcQ");
    // The REAL reviewed provider operation builds the plan (official
    // IFrame embed, privacy-enhanced domain, no stream extraction).
    expect(outcome.plan.kind).toBe("official-embed");
    const embedRef =
      outcome.plan.kind === "official-embed" && typeof outcome.plan.embedSpec.embedUrl === "string"
        ? outcome.plan.embedSpec.embedUrl
        : "";
    expect(embedRef).toContain("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ");
    // The honest catalog item: provider youtube, the real video id.
    expect(outcome.catalogItem.providerId).toBe(YOUTUBE_PROVIDER_ID);
    expect(outcome.catalogItem.metadata?.videoId).toBe("dQw4w9WgXcQ");
  });

  it("the embed asset reference is the official privacy-enhanced domain", () => {
    const outcome = resolveSearchQuery("https://youtu.be/dQw4w9WgXcQ");
    if (outcome.kind !== "youtube-link") throw new Error("expected a link outcome");
    expect(outcome.catalogItem.assets[0]?.kind).toBe("embed");
    expect(outcome.catalogItem.assets[0]?.reference).toBe(
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
    );
  });
});

describe("keyword queries resolve to the honest requires-auth state (requirement 3)", () => {
  it("a keyword query NEVER invents results — it requires auth with the query verbatim", () => {
    const outcome = resolveSearchQuery("lofi hip hop");
    expect(outcome.kind).toBe("state");
    if (outcome.kind !== "state") return;
    expect(outcome.state).toEqual({
      phase: "requires-auth",
      query: "lofi hip hop",
      providerId: "youtube",
    });
  });

  it("whitespace is trimmed; an empty query is idle, not an error", () => {
    expect(resolveSearchQuery("   ")).toEqual({ kind: "state", state: { phase: "idle" } });
    expect(resolveSearchQuery("")).toEqual({ kind: "state", state: { phase: "idle" } });
  });

  it("a non-official host is NOT a link — it falls to the honest requires-auth state", () => {
    const outcome = resolveSearchQuery("https://evil.example.com/watch?v=dQw4w9WgXcQ");
    expect(outcome.kind).toBe("state");
  });

  it("a malformed id (12 chars) is NOT a link", () => {
    const outcome = resolveSearchQuery("dQw4w9WgXcQQ");
    expect(outcome.kind).toBe("state");
  });
});

describe("the seam stays injectable (the battery can fake the provider operation)", () => {
  it("injected parseLinkId/buildPlan drive the flow (no hidden network)", () => {
    const parseLinkId = vi.fn(() => "injected-id");
    const buildPlan = vi.fn(() => ({ kind: "local-file", path: "injected" }) as never);
    const outcome = resolveSearchQuery("anything", { parseLinkId, buildPlan });
    expect(parseLinkId).toHaveBeenCalledWith("anything");
    expect(buildPlan).toHaveBeenCalledWith("injected-id");
    expect(outcome.kind).toBe("youtube-link");
  });
});
