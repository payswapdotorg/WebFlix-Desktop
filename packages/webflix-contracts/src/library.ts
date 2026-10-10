import { z } from "zod";
import { IsoDateTimeSchema } from "./internal/primitives";
import { MediaKindSchema } from "./catalog";

/** Descriptive metadata extracted from a local media file. */
export const LocalMediaMetadataSchema = z.object({
  title: z.string().min(1),
  durationMs: z.number().int().min(0).optional(),
  mimeType: z.string().min(1).optional(),
  sizeBytes: z.number().int().min(0).optional(),
  tags: z.array(z.string().min(1)).default([]),
});
export type LocalMediaMetadata = z.infer<typeof LocalMediaMetadataSchema>;

/** Content fingerprint: `<algorithm>:<hex digest>`, e.g. `sha256:9f86d081…`. */
export const FingerprintSchema = z
  .string()
  .regex(
    /^[a-z0-9]{3,16}:[0-9a-f]{32,128}$/,
    "must be `<algorithm>:<hex digest>` such as sha256:9f86d081…",
  );
export type Fingerprint = z.infer<typeof FingerprintSchema>;

/** One file in the local library, deduplicated by fingerprint. */
export const LocalLibraryEntrySchema = z.object({
  id: z.string().min(1),
  /** Absolute filesystem path of the file. */
  path: z.string().min(1),
  fingerprint: FingerprintSchema,
  metadata: LocalMediaMetadataSchema,
  addedAt: IsoDateTimeSchema,
});
export type LocalLibraryEntry = z.infer<typeof LocalLibraryEntrySchema>;

/** Rule definition behind a smart collection. */
export const SmartQuerySchema = z.object({
  text: z.string().min(1).optional(),
  mediaKind: MediaKindSchema.optional(),
  tags: z.array(z.string().min(1)).default([]),
});
export type SmartQuery = z.infer<typeof SmartQuerySchema>;

/** A user-facing grouping of library entries: manual or rule-based. */
export const CollectionSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    kind: z.enum(["manual", "smart"]),
    /** Manual member list (manual collections). */
    entryIds: z.array(z.string().min(1)).default([]),
    /** Rule definition (smart collections). */
    smartQuery: SmartQuerySchema.optional(),
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema,
  })
  .refine(
    (collection) =>
      collection.kind !== "smart" || collection.smartQuery !== undefined,
    { message: "smart collections must define smartQuery" },
  );
export type Collection = z.infer<typeof CollectionSchema>;

/** Ordered playback list of item ids. */
export const LocalPlaylistSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  /** Ordered item ids; playback follows this order unless shuffled. */
  itemIds: z.array(z.string().min(1)).default([]),
  loop: z.boolean().default(false),
  shuffle: z.boolean().default(false),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type LocalPlaylist = z.infer<typeof LocalPlaylistSchema>;

/** Per-item watched state, derived from PlaybackProgress. */
export const WatchedStateSchema = z.object({
  itemId: z.string().min(1),
  status: z.enum(["unwatched", "in-progress", "watched"]),
  /** 0..1 fraction consumed. */
  watchedFraction: z.number().min(0).max(1).default(0),
  lastPositionMs: z.number().int().min(0).default(0),
  updatedAt: IsoDateTimeSchema,
  completedAt: IsoDateTimeSchema.optional(),
});
export type WatchedState = z.infer<typeof WatchedStateSchema>;
