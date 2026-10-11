/**
 * DeriveArtifactBookkeeping — create/list derived-artifact descriptors with
 * lineage checks (P4-CONTRACTS scope row 3; P4-ARTIFACTS row 0 collapse).
 *
 * Persistence, stated plainly: this order (P4-ARTIFACTS) ships the DURABLE
 * ArtifactRegistry adapter on the local-library storage seam — descriptors
 * written through it survive restarts; the in-memory default from
 * P4-CONTRACTS remains as the pure-test default. Originals are never
 * mutated — structural separation: `create` only READS the caller's catalog
 * snapshot (for the lineage check) and writes into the separate descriptor
 * registry; no API in this module can write into a catalog item.
 *
 * Lineage integrity: `create` validates the descriptor shape (closed kind
 * enum included — unknown kinds are typed IntelligenceArtifactInvalid) and
 * enforces webflix-domain's validateDerivedArtifactLineage (the domain
 * authority — the P4-FD1 inline mirror collapsed to this import when the
 * application->domain edge landed). Note the domain's canonical semantics:
 * `sourceItemId` must resolve through the snapshot's SCHEMA-VALID catalog
 * entries (an entry that fails CatalogItemSchema does not count as a known
 * source); a dangling source is rejected, never silently linked. `list`
 * returns descriptors sorted by (createdAt, id) — deterministic ordering;
 * an optional sourceItemId filter narrows to one original's derivations.
 */
import { DerivedArtifactSchema, WebFlixError } from "webflix-contracts";
import { ErrorCode } from "webflix-contracts";
import type {
  ArtifactLineage,
  CatalogItem,
  DerivedArtifact,
  DerivedArtifactKind,
} from "webflix-contracts";
import { parseOrThrow, validateDerivedArtifactLineage } from "webflix-domain";
import type { ArtifactRegistry, ClockPort, IdGenerator } from "./ports";

export interface CreateDerivedArtifactInput {
  /** The ORIGINAL the artifact was derived from — must exist in `catalog`. */
  readonly sourceItemId: string;
  /**
   * Optional caller-supplied artifact id (P4-SUMMARIZE transcribe
   * amendment): the mi.transcribe use case generates the id UPFRONT so the
   * transcript payload row can be persisted BEFORE the descriptor (a put
   * failure then leaves no artifact at all — the no-artifact-on-failure
   * contract stays airtight) while both share the id. Default: generated.
   */
  readonly id?: string;
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
    const descriptor: DerivedArtifact = parseOrThrow(
      DerivedArtifactSchema,
      {
        id: input.id ?? this.deps.generateId(),
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
    const violations = validateDerivedArtifactLineage(descriptor, input.catalog);
    if (violations.length > 0) {
      throw new WebFlixError({
        code: ErrorCode.IntelligenceArtifactInvalid,
        reason: violations.map((violation) => violation.message).join("; "),
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
