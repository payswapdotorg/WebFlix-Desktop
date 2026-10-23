/**
 * media-labels — the WFX-PROVIDER-SLICE-1 deterministic label battery.
 *
 * The frozen media-views law: card labels are PRODUCER-FORMATTED strings so
 * the shell never guesses locales. This suite pins the documented rule set
 * (fixed en-US conventions, injected-clock relative labels, honest absence
 * for absent facts) — every assertion is a documented rule in the module
 * docblock of src/media/media-labels.ts.
 */
import { describe, expect, it } from "vitest";
import {
  clockLabel,
  compactCount,
  createdAtLabel,
  progressLabel,
  relativePublishedLabel,
  subscriberLabel,
  videoCountLabel,
  viewsLabel,
} from "../index";

const NOW = new Date("2026-10-23T12:00:00Z");

describe("compactCount (en-US compact, one fractional digit)", () => {
  it("compacts deterministically", () => {
    expect(compactCount(1234)).toBe("1.2K");
    expect(compactCount(1048576)).toBe("1M");
    expect(compactCount(2500000)).toBe("2.5M");
    expect(compactCount(999)).toBe("999");
    expect(compactCount(0)).toBe("0");
  });
  it("mantissa ≥ 10 rounds to whole units (12,345 → '12K'; 123,456 → '123K')", () => {
    expect(compactCount(12345)).toBe("12K");
    expect(compactCount(123456)).toBe("123K");
    expect(compactCount(12345678)).toBe("12M");
  });
});

describe("viewsLabel", () => {
  it("formats counts as '<compact> views'", () => {
    expect(viewsLabel(12345)).toBe("12K views");
    expect(viewsLabel(1048576)).toBe("1M views");
  });
  it("zero is 'No views' (never '0 views')", () => {
    expect(viewsLabel(0)).toBe("No views");
  });
  it("absent or invalid counts produce NO label (honest absence)", () => {
    expect(viewsLabel(undefined)).toBeUndefined();
    expect(viewsLabel(Number.NaN)).toBeUndefined();
    expect(viewsLabel(-1)).toBeUndefined();
  });
});

describe("relativePublishedLabel (against the injected now)", () => {
  it("sub-minute ages are 'just now'", () => {
    expect(relativePublishedLabel("2026-10-23T11:59:45Z", NOW)).toBe("just now");
  });
  it("minutes/hours/days/weeks/months/years follow the documented buckets", () => {
    expect(relativePublishedLabel("2026-10-23T11:58:00Z", NOW)).toBe("2 minutes ago");
    expect(relativePublishedLabel("2026-10-23T09:00:00Z", NOW)).toBe("3 hours ago");
    expect(relativePublishedLabel("2026-10-21T12:00:00Z", NOW)).toBe("2 days ago");
    expect(relativePublishedLabel("2026-10-13T12:00:00Z", NOW)).toBe("1 week ago");
    expect(relativePublishedLabel("2026-09-13T12:00:00Z", NOW)).toBe("1 month ago");
    expect(relativePublishedLabel("2025-09-01T12:00:00Z", NOW)).toBe("1 year ago");
  });
  it("singular units read '1 minute ago' / '1 hour ago' / '1 day ago'", () => {
    expect(relativePublishedLabel("2026-10-23T11:59:00Z", NOW)).toBe("1 minute ago");
    expect(relativePublishedLabel("2026-10-23T11:00:00Z", NOW)).toBe("1 hour ago");
    expect(relativePublishedLabel("2026-10-22T12:00:00Z", NOW)).toBe("1 day ago");
  });
  it("future-dated or unparsable instants produce NO label (honest absence)", () => {
    expect(relativePublishedLabel("2026-10-24T12:00:00Z", NOW)).toBeUndefined();
    expect(relativePublishedLabel("not-a-date", NOW)).toBeUndefined();
    expect(relativePublishedLabel(undefined, NOW)).toBeUndefined();
  });
});

describe("clockLabel (duration)", () => {
  it("whole-second M:SS under an hour", () => {
    expect(clockLabel(253_000)).toBe("4:13");
    expect(clockLabel(59_000)).toBe("0:59");
  });
  it("H:MM:SS at or above an hour", () => {
    expect(clockLabel(3_723_000)).toBe("1:02:03");
  });
  it("non-positive/non-finite durations produce NO label (live rows carry none)", () => {
    expect(clockLabel(0)).toBeUndefined();
    expect(clockLabel(-5)).toBeUndefined();
    expect(clockLabel(Number.POSITIVE_INFINITY)).toBeUndefined();
  });
});

describe("subscriberLabel / videoCountLabel", () => {
  it("subscriberLabel: '<compact> subscribers'", () => {
    expect(subscriberLabel(4200)).toBe("4.2K subscribers");
    expect(subscriberLabel(1048576)).toBe("1M subscribers");
    expect(subscriberLabel(undefined)).toBeUndefined();
  });
  it("videoCountLabel: plain count + ' videos'", () => {
    expect(videoCountLabel(87)).toBe("87 videos");
    expect(videoCountLabel(1)).toBe("1 videos");
    expect(videoCountLabel(undefined)).toBeUndefined();
  });
});

describe("progressLabel", () => {
  it("'<position> of <duration>'", () => {
    expect(progressLabel(754_000, 253_000)).toBe("12:34 of 4:13");
  });
  it("needs BOTH facts — absent duration means no label", () => {
    expect(progressLabel(754_000, undefined)).toBeUndefined();
    expect(progressLabel(0, 253_000)).toBeUndefined();
  });
});

describe("createdAtLabel (channel joined)", () => {
  it("'Joined <Month YYYY>' with fixed English months", () => {
    expect(createdAtLabel("2020-02-02T00:00:00Z")).toBe("Joined Feb 2020");
    expect(createdAtLabel("2019-12-31T23:59:59Z")).toBe("Joined Dec 2019");
  });
  it("unparsable instants produce no label", () => {
    expect(createdAtLabel("garbage")).toBeUndefined();
    expect(createdAtLabel(undefined)).toBeUndefined();
  });
});
