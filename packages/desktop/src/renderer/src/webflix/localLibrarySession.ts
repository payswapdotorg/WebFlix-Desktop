/**
 * P9-UI-1 (requirement 4) — the local-media session for the WebFlix
 * renderer host.
 *
 * WFX-DURABLE-LIB-1 (the durable local-library bridge): when the durable
 * seam is provided (the desktop runtime's preload bridge —
 * localLibraryBridge.ts), every import WITH a resolved OS path ALSO
 * persists as a durable device-local library entry (path + fingerprint +
 * metadata; idempotent by path — one stable entry id per file), and
 * restoreDurableEntries() re-lists them after a restart: present files
 * play again through the authorized preview URL (the main-process grant —
 * authorizeAtPlay refreshes it), missing files surface their honest
 * missing state, nothing is silently dropped.
 *
 * Local-first (lock §2.3): the local-media path works with NO network and
 * NO credentials. Entries are ONLY files the user actually picked (or
 * durable entries restored from a previous session's picks); recents are
 * ONLY items actually played. Nothing is seeded, nothing is invented.
 * Web imports (no OS path) and a bridge-less runtime stay session-only —
 * the metadata durability field states which is which, never implied.
 */
import type { CatalogItem, PlaybackPlan } from "../../../../../webflix-contracts/src/index.js";
import type { WebFlixLocalLibraryBridge, WebFlixLibraryEntry } from "./localLibraryBridge.js";

export interface ImportedLocalFile {
  readonly file: File;
  /** The OS path when the desktop bridge can recover it (null on the web). */
  readonly osPath: string | null;
}

export interface LocalLibraryEntry {
  readonly catalogItem: CatalogItem;
  readonly plan: PlaybackPlan;
  readonly osPath: string | null;
  readonly objectUrl: string;
  /** True when this entry was restored from (or persisted to) the durable store. */
  readonly durable: boolean;
}

/**
 * The durable seam (structural — satisfied by the preload bridge; tests
 * inject fakes). Null-payload results degrade to session-only honestly.
 */
export type LocalLibraryDurableSeam = Pick<
  WebFlixLocalLibraryBridge,
  "addEntries" | "listEntries" | "authorizeEntries"
>;

export interface LocalLibrarySessionDeps {
  /** Object-URL factory (injectable for tests; default URL.createObjectURL). */
  readonly createObjectUrl?: (file: File) => string;
  /** OS-path recovery (injectable; default null — the host wires the bridge). */
  readonly resolveOsPath?: (file: File) => string | null;
  /** Id mint (injectable for tests); default: crypto.randomUUID. */
  readonly mintId?: () => string;
  /** The durable seam (WFX-DURABLE-LIB-1); absent = the honest session-only build. */
  readonly durable?: LocalLibraryDurableSeam | null;
  /** Error sink for fire-and-forget durable writes (tests observe failures). */
  readonly onDurableWriteError?: (error: unknown) => void;
}

const DEFAULT_MINT_ID = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `local-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;

/** An honest mimeType guess from the file extension for restored entries (unknown → omitted). */
function mimeTypeForPath(path: string): string | undefined {
  const lower = path.toLowerCase();
  const map: readonly [suffix: string, mime: string][] = [
    [".mp4", "video/mp4"],
    [".m4v", "video/mp4"],
    [".webm", "video/webm"],
    [".mkv", "video/x-matroska"],
    [".mov", "video/quicktime"],
    [".avi", "video/x-msvideo"],
    [".ogv", "video/ogg"],
    [".mp3", "audio/mpeg"],
    [".m4a", "audio/mp4"],
    [".ogg", "audio/ogg"],
    [".opus", "audio/ogg"],
    [".wav", "audio/wav"],
    [".flac", "audio/flac"],
  ];
  for (const [suffix, mime] of map) {
    if (lower.endsWith(suffix)) return mime;
  }
  return undefined;
}

export function createLocalLibrarySession(deps: LocalLibrarySessionDeps = {}) {
  const createObjectUrl = deps.createObjectUrl ?? ((file: File) => URL.createObjectURL(file));
  const resolveOsPath = deps.resolveOsPath ?? (() => null);
  const mintId = deps.mintId ?? DEFAULT_MINT_ID;
  const durable = deps.durable ?? null;

  /** Imported entries, newest first. Only real user picks (or durable restores) land here. */
  const entries: LocalLibraryEntry[] = [];
  /** Play-ordered recents (only items actually played land here). */
  const recents: CatalogItem[] = [];
  const playedIds = new Set<string>();
  /** Durable entry ids known restored (authorization targets at play time). */
  const durableEntryIds = new Set<string>();

  /** Fire-and-forget durable persist for one imported file (never blocks the import). */
  const persistImported = (
    file: File,
    osPath: string,
  ): void => {
    if (durable === null) return;
    const isAudioOnly = file.type.startsWith("audio/") && !file.type.startsWith("audio/webm");
    void durable
      .addEntries([
        {
          path: osPath,
          title: file.name,
          kind: isAudioOnly ? "audio" : "video",
          sizeBytes: file.size,
          mtimeMs: file.lastModified,
        },
      ])
      .then((result) => {
        if (result.ok) {
          for (const added of result.added ?? []) {
            durableEntryIds.add(added.id);
          }
        }
      })
      .catch((error: unknown) => {
        deps.onDurableWriteError?.(error);
      });
  };

  /** Builds one session entry (shared by the sync + durable import flows). */
  const buildEntry = (
    file: File,
    osPath: string | null,
    id: string,
    objectUrl: string,
    durableRow: boolean,
  ): LocalLibraryEntry => {
    const isAudioOnly = file.type.startsWith("audio/") && !file.type.startsWith("audio/webm");
    const durability =
      osPath !== null && durableRow
        ? "durable (device-local — survives restart on this device)"
        : osPath !== null
          ? "session-only (the durable library bridge is unavailable in this runtime)"
          : "session-only (no OS path resolved — the web runtime cannot persist a file reference)";
    const catalogItem: CatalogItem = {
      id,
      providerId: "local",
      title: file.name,
      mediaKind: "local-file",
      assets: [],
      metadata: {
        importKind: isAudioOnly ? "audio" : "video",
        mimeType: file.type || (isAudioOnly ? "audio/*" : "video/*"),
        sizeBytes: file.size,
        lastModifiedAt: new Date(file.lastModified).toISOString(),
        ...(osPath !== null ? { osPath } : {}),
        durability,
      },
    };
    const plan: PlaybackPlan = {
      kind: "local-file",
      path: objectUrl,
      mimeType: file.type || undefined,
    };
    return {
      catalogItem,
      plan,
      osPath,
      objectUrl,
      durable: osPath !== null && durableRow,
    };
  };

  function importFiles(files: readonly ImportedLocalFile[]): readonly LocalLibraryEntry[] {
    const added: LocalLibraryEntry[] = [];
    for (const { file, osPath: entryOsPath } of files) {
      const objectUrl = createObjectUrl(file);
      // The caller-supplied OS path wins (the host resolves it through the
      // desktop webUtils bridge); the session-level resolver is the fallback
      // for callers that only hand over File objects.
      const osPath = entryOsPath ?? resolveOsPath(file);
      const id = mintId();
      const entry = buildEntry(file, osPath, id, objectUrl, durable !== null);
      entries.unshift(entry);
      added.push(entry);
      if (osPath !== null && durable !== null) {
        persistImported(file, osPath);
      }
    }
    return added;
  }

  /**
   * WFX-DURABLE-LIB-1 (the id-correlation law): the DURABLE-aware import
   * flow — pathed files with a live seam persist FIRST and the returned
   * STABLE durable id becomes the catalog id (the watch-history rows key
   * by it, so a restart's restored entry correlates with its own history
   * for resume — the live verification caught the pre-fix gap: a
   * session-minted id survived only until the restart minted the durable
   * one). Path-less files / a failed seam persist honestly degrade to the
   * sync flow (session-minted ids, fire-and-forget persists).
   */
  async function importFilesDurable(files: readonly ImportedLocalFile[]): Promise<readonly LocalLibraryEntry[]> {
    if (durable === null) {
      return importFiles(files);
    }
    // Phase 1: persist every pathed file (one batched add; per-file durable ids).
    const pending: { file: File; osPath: string }[] = [];
    for (const { file, osPath: entryOsPath } of files) {
      const osPath = entryOsPath ?? resolveOsPath(file);
      if (osPath !== null) pending.push({ file, osPath });
    }
    let durableIds = new Map<string, string>();
    if (pending.length > 0) {
      try {
        const result = await durable.addEntries(
          pending.map(({ file, osPath }) => ({
            path: osPath,
            title: file.name,
            kind:
              file.type.startsWith("audio/") && !file.type.startsWith("audio/webm")
                ? ("audio" as const)
                : ("video" as const),
            sizeBytes: file.size,
            mtimeMs: file.lastModified,
          })),
        );
        if (result.ok) {
          durableIds = new Map(
            (result.added ?? []).map((added) => [added.path, added.id]),
          );
          for (const added of result.added ?? []) {
            durableEntryIds.add(added.id);
          }
        }
      } catch (error) {
        deps.onDurableWriteError?.(error);
      }
    }
    // Phase 2: build the entries — the durable id wins for its file; the
    // rest fall back to the sync flow's session-minted behavior. The
    // durability label reflects the ACTUAL id adoption (a failed add never
    // claims durability — the honest session-only label applies).
    const added: LocalLibraryEntry[] = [];
    for (const { file, osPath: entryOsPath } of files) {
      const objectUrl = createObjectUrl(file);
      const osPath = entryOsPath ?? resolveOsPath(file);
      const durableId = osPath !== null ? durableIds.get(osPath) : undefined;
      const id = durableId ?? mintId();
      const entry = buildEntry(file, osPath, id, objectUrl, durableId !== undefined);
      entries.unshift(entry);
      added.push(entry);
    }
    return added;
  }

  /**
   * WFX-DURABLE-LIB-1: restores the durable device-local entries after a
   * restart. Returns the restored catalog items (the caller refreshes the
   * shell state); present entries carry a placeholder plan resolved at
   * PLAY time through authorizeAtPlay (the main-side grant), missing
   * entries carry their honest missing state in metadata. Never throws —
   * a failed durable read restores nothing (session-only, stated).
   */
  async function restoreDurableEntries(): Promise<readonly CatalogItem[]> {
    if (durable === null) return [];
    let list: readonly WebFlixLibraryEntry[];
    try {
      const result = await durable.listEntries();
      if (!result.ok) return [];
      list = result.entries;
    } catch {
      return [];
    }
    const restored: LocalLibraryEntry[] = [];
    for (const durableEntry of list) {
      // Idempotency by path: an entry re-imported THIS session already rides
      // its live object URL — the durable row stays authoritative on disk.
      if (entries.some((entry) => entry.osPath === durableEntry.path)) continue;
      const id = durableEntry.id;
      durableEntryIds.add(id);
      const catalogItem: CatalogItem = {
        id,
        providerId: "local",
        title: durableEntry.title,
        mediaKind: "local-file",
        assets: [],
        metadata: {
          importKind: durableEntry.kind === "audio" ? "audio" : "video",
          ...(mimeTypeForPath(durableEntry.path) !== undefined
            ? { mimeType: mimeTypeForPath(durableEntry.path) }
            : {}),
          sizeBytes: durableEntry.sizeBytes,
          osPath: durableEntry.path,
          durability: "durable (device-local — survives restart on this device)",
          ...(durableEntry.present ? {} : { missing: true }),
          addedAt: new Date(durableEntry.addedAt).toISOString(),
        },
      };
      // The placeholder plan resolves at play time (authorizeAtPlay); a
      // MISSING file keeps the honest placeholder — play refuses typed.
      const plan: PlaybackPlan = durableEntry.present
        ? {
            kind: "local-file",
            path: `webflix-durable://${id}`,
            ...(mimeTypeForPath(durableEntry.path) !== undefined
              ? { mimeType: mimeTypeForPath(durableEntry.path) }
              : {}),
          }
        : {
            kind: "unavailable",
            reason: "missing-file",
            recovery: {
              action: "retry-later",
              message:
                "This file is missing on this device — reconnect the drive or re-import it (the library entry stays until you clear app data).",
            },
          };
      restored.push({
        catalogItem,
        plan,
        osPath: durableEntry.path,
        objectUrl: `webflix-durable://${id}`,
        durable: true,
      });
    }
    if (restored.length > 0) {
      // The entries list keeps its newest-first convention; a COPY is
      // reversed so the returned restore order stays the durable list order.
      entries.push(...[...restored].reverse());
    }
    return restored.map((entry) => entry.catalogItem);
  }

  /**
   * Refreshes a durable entry's plan through the main-side authorization
   * grant (play time) and returns it — or the honest typed refusal when the
   * grant/file is unavailable. Non-durable entries answer null (the caller
   * keeps the entry's stored plan — the fresh-import object-URL path).
   */
  async function authorizeAtPlay(catalogItemId: string): Promise<PlaybackPlan | null> {
    if (durable === null) return null;
    if (!durableEntryIds.has(catalogItemId)) return null;
    const entry = entries.find((candidate) => candidate.catalogItem.id === catalogItemId);
    if (entry === undefined) return null;
    if (entry.plan.kind === "unavailable") {
      // A missing file's plan is only refreshed by the file coming back —
      // authorize cannot help; the stored honest refusal stands.
      return entry.plan;
    }
    try {
      const result = await durable.authorizeEntries([catalogItemId]);
      const outcome = result.ok ? (result.authorized ?? [])[0] : undefined;
      if (outcome !== undefined && outcome.url !== null) {
        const mimeType = entry.catalogItem.metadata?.mimeType;
        const plan: PlaybackPlan = {
          kind: "local-file",
          path: outcome.url,
          ...(typeof mimeType === "string" ? { mimeType } : {}),
        };
        // Refresh the stored plan in place (subsequent plays reuse it).
        const index = entries.indexOf(entry);
        if (index >= 0) {
          entries[index] = { ...entry, plan };
        }
        return plan;
      }
      return {
        kind: "unavailable",
        reason: "file-not-playable",
        recovery: {
          action: "retry-later",
          message:
            outcome?.reason ??
            "The durable entry could not be authorized for playback in this runtime.",
        },
      } as PlaybackPlan;
    } catch {
      return {
        kind: "unavailable",
        reason: "file-not-playable",
        recovery: {
          action: "retry-later",
          message: "The durable library bridge is unavailable in this runtime.",
        },
      } as PlaybackPlan;
    }
  }

  function markPlayed(catalogItem: CatalogItem): void {
    if (playedIds.has(catalogItem.id)) {
      return;
    }
    playedIds.add(catalogItem.id);
    recents.unshift(catalogItem);
  }

  return {
    importFiles,
    importFilesDurable,
    restoreDurableEntries,
    authorizeAtPlay,
    markPlayed,
    entries: (): readonly LocalLibraryEntry[] => [...entries],
    entryCatalogItems: (): readonly CatalogItem[] => entries.map((entry) => entry.catalogItem),
    recents: (): readonly CatalogItem[] => [...recents],
    findEntry(catalogItemId: string): LocalLibraryEntry | undefined {
      return entries.find((entry) => entry.catalogItem.id === catalogItemId);
    },
  };
}

export type LocalLibrarySession = ReturnType<typeof createLocalLibrarySession>;
