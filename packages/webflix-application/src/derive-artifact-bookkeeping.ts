/**
 * DeriveArtifactBookkeeping — create/list derived-artifact descriptors with
 * lineage checks (P4-CONTRACTS scope row 3).
 *
 * Persistence, stated plainly: this order ships bookkeeping against the
 * ArtifactRegistry port with an in-memory default — descriptors do NOT
 * survive a restart; persistent storage is deferred to P4-ARTIFACTS (the
 * port boundary is the stable seam). Originals are never mutated —
 * structural separation: `create` only READS the caller's catalog snapshot
 * (for the lineage check) and writes into the separate descriptor registry;
 * no API in this module can write into a catalog item.
 *
 * Lineage integrity: `create` validates the descriptor shape (closed kind
 * enum included — unknown kinds are typed IntelligenceArtifactInvalid) and
 * requires `sourceItemId` to resolve to an item in the catalog snapshot; a
 * dangling source is rejected, never silently linked (the same rule as
 * webflix-domain's validateDerivedArtifactLineage — inlined here because
 * application cannot import webflix-domain this order, see the P4-FD1
 * proposal). `list` returns descriptors sorted by (createdAt, id) —
 * deterministic ordering; an optional sourceItemId filter narrows to one
 * original's derivations.
 */
import { DerivedArtifactSchema, WebFlixError } from "webflix-contracts";
import { ErrorCode } from "webflix-contracts";
import type {
  ArtifactLineage,
  CatalogItem,
  DerivedArtifact,
  DerivedArtifactKind,
} from "webflix-contracts";
import type { ArtifactRegistry, ClockPort, IdGenerator } from "./ports";
import { parseContractOrThrow } from "./contract-parse";

export interface CreateDerivedArtifactInput {
  /** The ORIGINAL the artifact was derived from — must exist in `catalog`. */
  readonly sourceItemId: string;
  readonly kind: DerivedArtifactKind;
  readonly lineage: Omit<ArtifactLineage, "generatedAt"> & { generatedAt?: string };
  /** License note for the derived output; null/undefined = none applies. */
  readonly licenseNote?: string | null;
  /** The current catalog snapshot the lineage check runs against. */
  readonly catalog: readonly CatalogItem[];
}

export interface DeriveArtifactBookkeepingDeps {
  readonly registry: ArtifactRegistry;
  readonly clock: ClockPort;
  readonly generateId: IdGenerator;
}

export class DeriveArtifactBookkeeping {
  constructor(private readonly deps: DeriveArtifactBookkeepingDeps) {}

  async create(input: CreateDerivedArtifactInput): Promise<DerivedArtifact> {
    const descriptor: DerivedArtifact = parseContractOrThrow(
      DerivedArtifactSchema,
      {
        id: this.deps.generateId(),
        sourceItemId: input.sourceItemId,
        kind: input.kind,
        lineage: {
          modelId: input.lineage.modelId,
          modelVersion: input.lineage.modelVersion,
          producedBy: input.lineage.producedBy,
          generatedAt: input.lineage.generatedAt ?? this.deps.clock.now().toISOString(),
          inputsHash: input.lineage.inputsHash,
        },
        licenseNote: input.licenseNote ?? null,
        createdAt: this.deps.clock.now().toISOString(),
      },
      ErrorCode.IntelligenceArtifactInvalid,
      "DerivedArtifact",
    );
    if (!knownSourceIds(input.catalog).has(descriptor.sourceItemId)) {
      throw new WebFlixError({
        code: ErrorCode.IntelligenceArtifactInvalid,
        reason: `derived artifact ${descriptor.id} references source item ${descriptor.sourceItemId}, which is not present in the catalog snapshot`,
        retryable: false,
        context: { artifactId: descriptor.id, sourceItemId: descriptor.sourceItemId },
      });
    }
    await this.deps.registry.put(descriptor);
    return descriptor;
  }

  /** All descriptors (or one original's), sorted by (createdAt, id) — deterministic. */
  async list(sourceItemId?: string): Promise<readonly DerivedArtifact[]> {
    const all = await this.deps.registry.list();
    return all
      .filter(
        (descriptor) => sourceItemId === undefined || descriptor.sourceItemId === sourceItemId,
      )
      .sort((a, b) => {
        if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
        return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
      });
  }
}

/** Valid §2.1 ids of the snapshot — the lineage key set. */
function knownSourceIds(catalog: readonly CatalogItem[]): Set<string> {
  const ids = new Set<string>();
  for (const item of catalog) {
    ids.add(item.id);
  }
  return ids;
}
