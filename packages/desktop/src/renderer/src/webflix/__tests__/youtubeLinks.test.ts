import { describe, expect, it } from "vitest";

/*
 * P9-UI-1 (order requirement 4 + requirement 6) — official YouTube link
 * recognition pins: ONLY official YouTube surfaces are recognized; anything
 * else is not a link (the caller then applies the honest search-gate state).
 */

import { parseYouTubeLinkId } from "../youtubeLinks.js";

const OFFICIAL_ID = "dQw4w9WgXcQ";

describe("official YouTube link forms are recognized", () => {
  it.each([
    ["bare id", OFFICIAL_ID],
    ["watch", `https://www.youtube.com/watch?v=${OFFICIAL_ID}`],
    ["watch with extra params", `https://www.youtube.com/watch?v=${OFFICIAL_ID}&t=30s`],
    ["short share", `https://youtu.be/${OFFICIAL_ID}`],
    ["www short share", `https://www.youtu.be/${OFFICIAL_ID}`],
    ["embed", `https://www.youtube.com/embed/${OFFICIAL_ID}`],
    ["shorts", `https://www.youtube.com/shorts/${OFFICIAL_ID}`],
    ["live", `https://www.youtube.com/live/${OFFICIAL_ID}`],
    ["mobile", `https://m.youtube.com/watch?v=${OFFICIAL_ID}`],
    ["music", `https://music.youtube.com/watch?v=${OFFICIAL_ID}`],
    ["nocookie", `https://www.youtube-nocookie.com/embed/${OFFICIAL_ID}`],
    ["uppercase host", `https://WWW.YOUTUBE.COM/watch?v=${OFFICIAL_ID}`],
    ["http scheme", `http://www.youtube.com/watch?v=${OFFICIAL_ID}`],
    ["trailing whitespace", `  https://youtu.be/${OFFICIAL_ID}  `],
  ])("%s → the official id", (_label, input) => {
    expect(parseYouTubeLinkId(input)).toBe(OFFICIAL_ID);
  });
});

describe("anything else is NOT a link (no invented recognition)", () => {
  it.each([
    ["empty", ""],
    ["whitespace", "   "],
    ["keyword query", "lofi hip hop"],
    ["non-official host", `https://evil.example.com/watch?v=${OFFICIAL_ID}`],
    ["lookalike host", `https://youtube.com.evil.example/watch?v=${OFFICIAL_ID}`],
    ["youtube without id", "https://www.youtube.com/"],
    ["watch without v param", "https://www.youtube.com/watch"],
    ["watch with malformed id", "https://www.youtube.com/watch?v=short"],
    ["id too long", "dQw4w9WgXcQQ"],
    ["id too short", "dQw4w9WgXc"],
    ["id with illegal char", "dQw4w9WgXc!"],
    ["deep path", `https://www.youtube.com/channel/UC${OFFICIAL_ID}`],
    ["non-http scheme", `webflix://watch/${OFFICIAL_ID}`],
    ["javascript url", `javascript:alert("${OFFICIAL_ID}")`],
  ])("%s → null", (_label, input) => {
    expect(parseYouTubeLinkId(input)).toBeNull();
  });
});
