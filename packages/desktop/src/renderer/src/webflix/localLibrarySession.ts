/**
 * P9-UI-1 (requirement 4) — the local-media session for the WebFlix
 * renderer host.
 *
 * Local-first (lock §2.3): the local-media path works with NO network and
 * NO credentials. The user imports files through the Web file picker; each
 * imported File becomes a renderer object URL (playable by the <video>
 * element from every origin this renderer is served from — the vite dev
 * server http://localhost:5174 and the packaged file:// build alike), and
 * an honest CatalogItem (providerId "local", the D2-owned local provider
 * id from the shell's AccountsScreen provider table).
 *
 * Honest scope (stated in the UI, never implied): this is the SESSION
 * library — the durable local-library seam (packages/local-library, the
 * migration-backed store) is node-bound and has no renderer bridge yet;
 * wiring it is a later mount order. Entries below are ONLY files the user
 * actually picked this session; recents are ONLY items actually played.
 * Nothing is seeded, nothing is invented.
 */
import type { CatalogItem } from "../../../../../webflix-contracts/src/index.js";
import type { PlaybackPlan } from "../../../../../webflix-contracts/src/index.js";

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
}

export interface LocalLibrarySessionDeps {
  /** Object-URL factory (injectable for tests; default URL.createObjectURL). */
  readonly createObjectUrl?: (file: File) => string;
  /** OS-path recovery (injectable; default null — the host wires the bridge). */
  readonly resolveOsPath?: (file: File) => string | null;
  /** Id mint (injectable for tests); default: crypto.randomUUID. */
  readonly mintId?: () => string;
}

const DEFAULT_MINT_ID = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `local-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;

export function createLocalLibrarySession(deps: LocalLibrarySessionDeps = {}) {
  const createObjectUrl = deps.createObjectUrl ?? ((file: File) => URL.createObjectURL(file));
  const resolveOsPath = deps.resolveOsPath ?? (() => null);
  const mintId = deps.mintId ?? DEFAULT_MINT_ID;

  /** Imported entries, newest first. Only real user picks land here. */
  const entries: LocalLibraryEntry[] = [];
  /** Play-ordered recents (only items actually played land here). */
  const recents: CatalogItem[] = [];
  const playedIds = new Set<string>();

  function importFiles(files: readonly ImportedLocalFile[]): readonly LocalLibraryEntry[] {
    const added: LocalLibraryEntry[] = [];
    for (const { file, osPath: entryOsPath } of files) {
      const objectUrl = createObjectUrl(file);
      // The caller-supplied OS path wins (the host resolves it through the
      // desktop webUtils bridge); the session-level resolver is the fallback
      // for callers that only hand over File objects.
      const osPath = entryOsPath ?? resolveOsPath(file);
      const id = mintId();
      const isAudioOnly = file.type.startsWith("audio/") && !file.type.startsWith("audio/webm");
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
          durability: "session-only (the durable local-library bridge is a later order)",
        },
      };
      const plan: PlaybackPlan = {
        kind: "local-file",
        path: objectUrl,
        mimeType: file.type || undefined,
      };
      const entry: LocalLibraryEntry = { catalogItem, plan, osPath, objectUrl };
      entries.unshift(entry);
      added.push(entry);
    }
    return added;
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
