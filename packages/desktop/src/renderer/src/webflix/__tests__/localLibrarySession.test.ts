import { describe, expect, it } from "vitest";

/*
 * P9-UI-1 (order requirement 4 + requirement 6) — the local-media session
 * pins: the local path works with NO network and NO credentials; only real
 * user picks become entries; only really played items become recents; every
 * CatalogItem is honest about its session-only durability.
 */

import { createLocalLibrarySession } from "../localLibrarySession.js";

function makeVideoFile(name = "clip.mp4", type = "video/mp4"): File {
  return new File([new Uint8Array([1, 2, 3])], name, { type, lastModified: 1_700_000_000_000 });
}

function makeSession() {
  let counter = 0;
  return createLocalLibrarySession({
    createObjectUrl: (file) => `blob:webflix-test/${file.name}`,
    resolveOsPath: (file) => `/home/tester/Videos/${file.name}`,
    mintId: () => `minted-${++counter}`,
  });
}

describe("importFiles — real picks become honest entries (requirement 4)", () => {
  it("each picked file becomes a playable object-URL plan + an honest CatalogItem", () => {
    const session = makeSession();
    const added = session.importFiles([
      { file: makeVideoFile(), osPath: "/home/tester/Videos/clip.mp4" },
    ]);

    expect(added).toHaveLength(1);
    const entry = added[0]!;
    expect(entry.catalogItem.id).toBe("minted-1");
    expect(entry.catalogItem.providerId).toBe("local");
    expect(entry.catalogItem.title).toBe("clip.mp4");
    expect(entry.catalogItem.mediaKind).toBe("local-file");
    expect(entry.plan.kind).toBe("local-file");
    if (entry.plan.kind === "local-file") {
      expect(entry.plan.path).toBe("blob:webflix-test/clip.mp4");
      expect(entry.plan.mimeType).toBe("video/mp4");
    }
  });

  it("the metadata states the session-only durability honestly (never implies a durable store)", () => {
    const session = makeSession();
    const [entry] = [...session.importFiles([{ file: makeVideoFile(), osPath: null }])];
    expect(entry?.catalogItem.metadata?.importKind).toBe("video");
    // The caller supplied NO os path (the null-entry case: the web picker
    // without the desktop bridge) — the session-level resolver is the
    // FALLBACK, and makeSession's resolver knows the test Videos dir.
    expect(entry?.catalogItem.metadata?.osPath).toBe("/home/tester/Videos/clip.mp4");
    expect(String(entry?.catalogItem.metadata?.durability)).toContain("session-only");
    expect(String(entry?.catalogItem.metadata?.durability)).toContain("later order");
  });

  it("a caller-supplied null osPath falls back to the session resolver; a web entry stays path-less", () => {
    const webSession = createLocalLibrarySession({
      createObjectUrl: (file) => `blob:webflix-web/${file.name}`,
      mintId: () => "web-1",
    });
    const [entry] = [...webSession.importFiles([{ file: makeVideoFile(), osPath: null }])];
    expect(entry?.catalogItem.metadata?.osPath).toBeUndefined();
  });

  it("audio-only files are marked as audio imports", () => {
    const session = makeSession();
    const [entry] = [
      ...session.importFiles([{ file: makeVideoFile("song.mp3", "audio/mpeg"), osPath: null }]),
    ];
    expect(entry?.catalogItem.metadata?.importKind).toBe("audio");
  });

  it("entries list newest-first", () => {
    const session = makeSession();
    session.importFiles([{ file: makeVideoFile("first.mp4"), osPath: null }]);
    session.importFiles([{ file: makeVideoFile("second.mp4"), osPath: null }]);
    expect(session.entryCatalogItems().map((item) => item.title)).toEqual([
      "second.mp4",
      "first.mp4",
    ]);
  });
});

describe("recents — only items actually played (requirement 3: nothing invented)", () => {
  it("starts empty and only fills on markPlayed, once per item, most-recently-played first", () => {
    const session = makeSession();
    expect(session.recents()).toEqual([]);

    const [first] = [...session.importFiles([{ file: makeVideoFile("a.mp4"), osPath: null }])];
    const [second] = [...session.importFiles([{ file: makeVideoFile("b.mp4"), osPath: null }])];
    session.markPlayed(first!.catalogItem);
    session.markPlayed(second!.catalogItem);
    session.markPlayed(second!.catalogItem); // idempotent — no duplicate recents

    // "second" was played LAST, so it leads the recents list.
    expect(session.recents().map((item) => item.title)).toEqual(["b.mp4", "a.mp4"]);
  });

  it("findEntry resolves by catalog id (the play path)", () => {
    const session = makeSession();
    const [entry] = [...session.importFiles([{ file: makeVideoFile(), osPath: null }])];
    expect(session.findEntry(entry!.catalogItem.id)?.catalogItem.id).toBe(entry!.catalogItem.id);
    expect(session.findEntry("never-imported")).toBeUndefined();
  });
});
