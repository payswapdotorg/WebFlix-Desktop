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
    // WFX-DURABLE-LIB-1 re-pin: the "later order" phrasing is gone (the
    // bridge HAS arrived); a path-less or bridge-less import states the
    // honest session-only reason instead.
    expect(String(entry?.catalogItem.metadata?.durability)).toContain("session-only");
    expect(String(entry?.catalogItem.metadata?.durability)).toContain("unavailable in this runtime");
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

describe("WFX-DURABLE-LIB-1 — the durable seam (persist, restore, authorize)", () => {
  /** A durable seam double with injectable list/authorize results. */
  function durableDouble(overrides?: {
    entries?: readonly {
      id: string;
      title: string;
      path: string;
      kind: "video" | "audio";
      sizeBytes: number;
      addedAt: number;
      present: boolean;
    }[];
    authorizeUrl?: string | null;
    authorizeOutcome?: { id: string; url: string | null; reason?: string }[];
  }) {
    const calls = {
      added: [] as { path: string; title: string; kind: string; sizeBytes: number; mtimeMs: number }[],
      authorized: [] as string[],
    };
    const seam = {
      calls,
      async addEntries(
        entries: readonly { path: string; title: string; kind: "video" | "audio"; sizeBytes: number; mtimeMs: number }[],
      ) {
        calls.added.push(...entries);
        return {
          ok: true as const,
          added: entries.map((entry) => ({
            id: `durable-${entry.path}`,
            path: entry.path,
            existed: false,
          })),
        };
      },
      async listEntries() {
        return { ok: true as const, entries: overrides?.entries ?? [] };
      },
      async authorizeEntries(ids: readonly string[]) {
        calls.authorized.push(...ids);
        return {
          ok: true as const,
          authorized:
            overrides?.authorizeOutcome ??
            ids.map((id) => ({
              id,
              url: overrides?.authorizeUrl ?? `zcode-media://local/preview?path=/canon/${id}`,
            })),
        };
      },
    };
    return seam;
  }

  it("a pathed import persists through the seam with the exact entry-add shape (fire-and-forget)", async () => {
    const durable = durableDouble();
    const session = createLocalLibrarySession({
      createObjectUrl: (file) => `blob:webflix-test/${file.name}`,
      resolveOsPath: (file) => `/home/tester/Videos/${file.name}`,
      mintId: () => "minted-1",
      durable,
    });
    session.importFiles([{ file: makeVideoFile(), osPath: "/home/tester/Videos/clip.mp4" }]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(durable.calls.added).toEqual([
      {
        path: "/home/tester/Videos/clip.mp4",
        title: "clip.mp4",
        kind: "video",
        sizeBytes: 3,
        mtimeMs: 1_700_000_000_000,
      },
    ]);
    const [entry] = [...session.entries()];
    expect(entry?.catalogItem.metadata?.durability).toContain("durable (device-local");
  });

  it("importFilesDurable adopts the STABLE durable id as the catalog id (the id-correlation law — restart resume)", async () => {
    const durable = durableDouble();
    const session = createLocalLibrarySession({
      createObjectUrl: (file) => `blob:webflix-test/${file.name}`,
      resolveOsPath: (file) => `/home/tester/Videos/${file.name}`,
      mintId: () => "session-minted",
      durable,
    });
    const added = await session.importFilesDurable([
      { file: makeVideoFile("clip.mp4"), osPath: "/home/tester/Videos/clip.mp4" },
    ]);
    // The durable seam's id (stable across restarts) IS the catalog id.
    expect(added[0]?.catalogItem.id).toBe("durable-/home/tester/Videos/clip.mp4");
    // The watch-history rows key by this id — the restart's restored entry
    // correlates with its own history for resume.
    expect(added[0]?.catalogItem.metadata?.durability).toContain("durable (device-local");
    // A resolver-less session's path-less pick keeps the session id (the
    // honest degrade — no path, no durable row).
    const webOnly = createLocalLibrarySession({
      createObjectUrl: (file) => `blob:webflix-web/${file.name}`,
      mintId: () => "session-minted",
      durable,
    });
    const webAdded = await webOnly.importFilesDurable([{ file: makeVideoFile("web.mp4"), osPath: null }]);
    expect(webAdded[0]?.catalogItem.id).toBe("session-minted");
  });

  it("importFilesDurable degrades to session-minted ids when the seam add fails (never a blocked import)", async () => {
    const durable = durableDouble();
    durable.addEntries = () => Promise.reject(new Error("bridge write failed"));
    const errors: unknown[] = [];
    const session = createLocalLibrarySession({
      createObjectUrl: (file) => `blob:webflix-test/${file.name}`,
      resolveOsPath: (file) => `/home/tester/Videos/${file.name}`,
      mintId: () => "session-minted",
      durable,
      onDurableWriteError: (error) => errors.push(error),
    });
    const added = await session.importFilesDurable([
      { file: makeVideoFile(), osPath: "/home/tester/Videos/clip.mp4" },
    ]);
    expect(added[0]?.catalogItem.id).toBe("session-minted");
    expect(errors).toHaveLength(1);
    // The entry still lists and plays (session-only, honestly labeled).
    expect(added[0]?.catalogItem.metadata?.durability).toContain("session-only");
  });

  it("a path-less import never persists (the honest session-only web case)", async () => {
    const durable = durableDouble();
    const session = createLocalLibrarySession({
      createObjectUrl: (file) => `blob:webflix-web/${file.name}`,
      mintId: () => "web-1",
      durable,
    });
    session.importFiles([{ file: makeVideoFile(), osPath: null }]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(durable.calls.added).toHaveLength(0);
    const [entry] = [...session.entries()];
    expect(String(entry?.catalogItem.metadata?.durability)).toContain("no OS path resolved");
  });

  it("restoreDurableEntries re-lists durable entries with the durable id as the catalog id", async () => {
    const durable = durableDouble({
      entries: [
        {
          id: "durable-entry-7",
          title: "holiday.mkv",
          path: "/home/tester/Videos/holiday.mkv",
          kind: "video",
          sizeBytes: 42,
          addedAt: 1_700_000_000_000,
          present: true,
        },
        {
          id: "durable-entry-8",
          title: "gone.mkv",
          path: "/mnt/gone/gone.mkv",
          kind: "video",
          sizeBytes: 10,
          addedAt: 1_700_000_000_000,
          present: false,
        },
      ],
    });
    const session = createLocalLibrarySession({
      createObjectUrl: (file) => `blob:webflix-test/${file.name}`,
      mintId: () => "minted-1",
      durable,
    });
    const restored = await session.restoreDurableEntries();
    expect(restored.map((item) => item.id)).toEqual(["durable-entry-7", "durable-entry-8"]);
    expect(restored.map((item) => item.title)).toEqual(["holiday.mkv", "gone.mkv"]);
    // The present entry carries the play-time placeholder plan + durable metadata.
    const present = session.findEntry("durable-entry-7");
    expect(present?.plan.kind).toBe("local-file");
    expect(present?.catalogItem.metadata?.durability).toContain("durable (device-local");
    // The missing entry carries the honest typed missing-file refusal.
    const missing = session.findEntry("durable-entry-8");
    expect(missing?.plan.kind).toBe("unavailable");
    if (missing?.plan.kind === "unavailable") {
      expect(missing.plan.reason).toBe("missing-file");
    }
    expect(missing?.catalogItem.metadata?.missing).toBe(true);
  });

  it("restore skips a path re-imported this session (the live object URL wins) and never throws", async () => {
    const durable = durableDouble({
      entries: [
        {
          id: "durable-entry-7",
          title: "clip.mp4",
          path: "/home/tester/Videos/clip.mp4",
          kind: "video",
          sizeBytes: 3,
          addedAt: 1,
          present: true,
        },
      ],
    });
    const session = createLocalLibrarySession({
      createObjectUrl: (file) => `blob:webflix-test/${file.name}`,
      resolveOsPath: (file) => `/home/tester/Videos/${file.name}`,
      mintId: () => "minted-1",
      durable,
    });
    session.importFiles([{ file: makeVideoFile(), osPath: "/home/tester/Videos/clip.mp4" }]);
    const restored = await session.restoreDurableEntries();
    expect(restored).toHaveLength(0);
    expect(session.entries()).toHaveLength(1);
    // A failing seam read restores NOTHING (session-only, stated, no throw).
    const broken = {
      ...durable,
      listEntries: async () => Promise.reject(new Error("bridge read failed")),
    };
    const brokenSession = createLocalLibrarySession({ durable: broken });
    await expect(brokenSession.restoreDurableEntries()).resolves.toEqual([]);
  });

  it("authorizeAtPlay refreshes a durable entry's plan through the grant (non-durable ids answer null)", async () => {
    const durable = durableDouble({
      entries: [
        {
          id: "durable-entry-7",
          title: "holiday.mkv",
          path: "/home/tester/Videos/holiday.mkv",
          kind: "video",
          sizeBytes: 42,
          addedAt: 1,
          present: true,
        },
      ],
    });
    const session = createLocalLibrarySession({
      createObjectUrl: (file) => `blob:webflix-test/${file.name}`,
      mintId: () => "minted-1",
      durable,
    });
    await session.restoreDurableEntries();
    const plan = await session.authorizeAtPlay("durable-entry-7");
    expect(plan?.kind).toBe("local-file");
    if (plan?.kind === "local-file") {
      expect(plan.path).toBe("zcode-media://local/preview?path=/canon/durable-entry-7");
    }
    expect(durable.calls.authorized).toEqual(["durable-entry-7"]);
    // A fresh-import id (no durable row) keeps its stored object-URL plan.
    expect(await session.authorizeAtPlay("minted-1")).toBeNull();
    expect(await session.authorizeAtPlay("never-heard-of")).toBeNull();
  });

  it("authorizeAtPlay answers the honest typed refusal when the grant is denied or the seam fails", async () => {
    // The grant is denied (url null + reason) — the honest typed refusal.
    const seam = durableDouble({
      entries: [
        {
          id: "durable-1",
          title: "a.mp4",
          path: "/v/a.mp4",
          kind: "video",
          sizeBytes: 1,
          addedAt: 1,
          present: true,
        },
      ],
      authorizeOutcome: [{ id: "durable-1", url: null, reason: "the file is missing on this device" }],
    });
    const session = createLocalLibrarySession({
      createObjectUrl: (file) => `blob:x/${file.name}`,
      mintId: () => "m",
      durable: seam,
    });
    await session.restoreDurableEntries();
    const plan = await session.authorizeAtPlay("durable-1");
    expect(plan?.kind).toBe("unavailable");
    if (plan?.kind === "unavailable") {
      expect(plan.reason).toBe("file-not-playable");
      expect(plan.recovery?.message).toContain("missing on this device");
    }
    // A seam that THROWS answers the honest unavailable too (never a throw to the caller).
    const throwing = {
      ...seam,
      authorizeEntries: () => Promise.reject(new Error("bridge failed")),
    };
    const throwingSession = createLocalLibrarySession({
      createObjectUrl: (file) => `blob:x/${file.name}`,
      mintId: () => "m",
      durable: throwing,
    });
    await throwingSession.restoreDurableEntries();
    const refused = await throwingSession.authorizeAtPlay("durable-1");
    expect(refused?.kind).toBe("unavailable");
    if (refused?.kind === "unavailable") {
      expect(refused.recovery?.message).toContain("unavailable in this runtime");
    }
  });
});
