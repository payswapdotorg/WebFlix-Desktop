/**
 * Transparency-source registry (P5-SOURCES scope row 3) — the static
 * registry of the source adapters, the ranker-adapter-registry pattern
 * verbatim in shape: a registry is NEVER empty (constructor guard), ids
 * are unique, every entry carries a CONTRACT-VALID manifest that agrees
 * with its adapter's descriptor, and `get` is the registry-known-id
 * check the ads.querySources use case validates against. No network, no
 * randomness, no telemetry — a registry is static data plus pure
 * lookups.
 *
 * Shape rules (enforced at construction, tested):
 * - the seed list is never empty;
 * - the manifest is schema-VALID (TransparencySourceManifestSchema) —
 *   the manifests the Ad Center displays are contract-valid by
 *   construction, never eyeballed into shape;
 * - the manifest's source id EQUALS the adapter's descriptor.source (an
 *   adapter answering for a source its manifest does not declare is a
 *   wiring lie);
 * - source ids are unique (a duplicate would make `get` ambiguous);
 * - the adapter really implements the port (query is a function, the
 *   descriptor + manifest are present).
 * Violations throw the typed ads/source-invalid error at construction
 * (the ads lane's typed vocabulary exists, so the seed guard uses it —
 * the ranker registry's plain-Error guard is the same pattern one lane
 * over, where no ranker-specific code existed to throw).
 */
import { ErrorCode, TransparencySourceManifestSchema, WebFlixError } from "webflix-contracts";
import type { TransparencySourceManifest, TransparencySourcePort } from "webflix-contracts";
import {
  GOOGLE_ADS_TRANSPARENCY_MANIFEST,
  GoogleAdsTransparencyAdapter,
  META_AD_LIBRARY_MANIFEST,
  MetaAdLibraryAdapter,
  TIKTOK_COMMERCIAL_CONTENT_MANIFEST,
  TikTokCommercialContentAdapter,
} from "./transparency-source-adapters";

/** A registry entry: the source's manifest plus the adapter behind it. */
export interface TransparencySourceEntry {
  /** The source's coverage + access declaration. */
  readonly manifest: TransparencySourceManifest;
  /** The adapter implementation behind this entry (satisfies the port). */
  readonly adapter: TransparencySourcePort;
}

/**
 * The registry port (interface only, like the other ports): `list`
 * returns entries in a stable, registry-declared order; `get` is the
 * registry-known-id check the use cases rely on.
 */
export interface TransparencySourceRegistry {
  /** Every registered entry, stable order. Never empty (constructor guard). */
  list(): readonly TransparencySourceEntry[];
  /** The entry for `sourceId`, or null when the registry does not know it. */
  get(sourceId: string): TransparencySourceEntry | null;
}

/** Guards the shape rules above; throws typed ads/source-invalid on any violation. */
function assertValidEntries(entries: readonly TransparencySourceEntry[]): void {
  if (entries.length === 0) {
    throw new WebFlixError({
      code: ErrorCode.AdsSourceInvalid,
      reason: "a transparency-source registry must seed at least one entry",
      retryable: false,
      context: { subject: "TransparencySourceRegistry" },
    });
  }
  const seen = new Set<string>();
  for (const entry of entries) {
    const id = entry.manifest?.source;
    if (typeof id !== "string" || id.trim().length === 0) {
      throw new WebFlixError({
        code: ErrorCode.AdsSourceInvalid,
        reason: "a transparency-source entry must carry a manifest with a non-blank source id",
        retryable: false,
        context: { subject: "TransparencySourceEntry.manifest.source" },
      });
    }
    if (seen.has(id)) {
      throw new WebFlixError({
        code: ErrorCode.AdsSourceInvalid,
        reason: `duplicate transparency-source id in registry seed: ${id}`,
        retryable: false,
        context: { subject: "TransparencySourceRegistry", source: id },
      });
    }
    seen.add(id);
    const manifest = TransparencySourceManifestSchema.safeParse(entry.manifest);
    if (!manifest.success) {
      throw new WebFlixError({
        code: ErrorCode.AdsSourceInvalid,
        reason:
          `transparency-source entry ${id} carries a manifest that fails the contract ` +
          `shape: ${manifest.error.issues.map((issue) => issue.message).join("; ")}`,
        retryable: false,
        context: { subject: "TransparencySourceEntry.manifest", source: id },
      });
    }
    if (entry.adapter === null || typeof entry.adapter !== "object") {
      throw new WebFlixError({
        code: ErrorCode.AdsSourceInvalid,
        reason: `transparency-source entry ${id} must carry a TransparencySourcePort implementation`,
        retryable: false,
        context: { subject: "TransparencySourceEntry.adapter", source: id },
      });
    }
    if (entry.adapter.descriptor?.source !== id) {
      throw new WebFlixError({
        code: ErrorCode.AdsSourceInvalid,
        reason:
          `transparency-source entry ${id}'s adapter serves source ` +
          `"${entry.adapter.descriptor?.source}" — the manifest and the descriptor must ` +
          "name the SAME source (an adapter answering for another source's manifest is a " +
          "wiring lie)",
        retryable: false,
        context: {
          subject: "TransparencySourceEntry.adapter.descriptor.source",
          source: id,
          adapterSource: entry.adapter.descriptor?.source,
        },
      });
    }
    if (typeof entry.adapter.query !== "function") {
      throw new WebFlixError({
        code: ErrorCode.AdsSourceInvalid,
        reason: `transparency-source entry ${id}'s adapter must implement query()`,
        retryable: false,
        context: { subject: "TransparencySourceEntry.adapter.query", source: id },
      });
    }
  }
}

/**
 * Builds a static registry from a seed list (validated once at
 * construction). The default registry below is a module literal over
 * this factory; a LATER order extends the SEED when an authorization
 * clears — never the shape rules.
 */
export function createStaticTransparencySourceRegistry(
  entries: readonly TransparencySourceEntry[],
): TransparencySourceRegistry {
  assertValidEntries(entries);
  const byId = new Map<string, TransparencySourceEntry>(
    entries.map((entry) => [entry.manifest.source, entry] as const),
  );
  const frozen: readonly TransparencySourceEntry[] = Object.freeze([...entries]);
  return {
    list: () => frozen,
    get: (sourceId: string) => byId.get(sourceId) ?? null,
  };
}

/**
 * The static default registry, seeded with EXACTLY the three honest-state
 * adapters in the audit's row order (Google, Meta, TikTok — AUDIT-SOURCES
 * §6's own ordering): GATC blocked, Meta + TikTok pending-authorization.
 * No fake available rows, no placeholder entries implying authorized
 * capability, no hidden defaults — the registry says exactly what the
 * access truths say.
 */
export const DEFAULT_TRANSPARENCY_SOURCE_REGISTRY: TransparencySourceRegistry =
  createStaticTransparencySourceRegistry([
    // Each seed manifest is the adapter's OWN declaration (the adapter IS the
    // source's seam — one declaration site, read from the adapter module).
    {
      manifest: GOOGLE_ADS_TRANSPARENCY_MANIFEST,
      adapter: new GoogleAdsTransparencyAdapter(),
    },
    { manifest: META_AD_LIBRARY_MANIFEST, adapter: new MetaAdLibraryAdapter() },
    {
      manifest: TIKTOK_COMMERCIAL_CONTENT_MANIFEST,
      adapter: new TikTokCommercialContentAdapter(),
    },
  ]);
