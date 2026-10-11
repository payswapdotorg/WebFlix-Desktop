/**
 * In-memory MI store defaults (P4-CONTRACTS; role narrowed at P4-ARTIFACTS
 * row 1 to the PURE-TEST defaults).
 *
 * Honest boundary, stated plainly: these implementations live in memory
 * ONLY — nothing survives a restart, and they are per-profile by
 * construction (the composition root instantiates one set per profile;
 * ADR-0003 — no cross-profile data ever). The DURABLE adapters for the
 * first three ports shipped with P4-ARTIFACTS on the local-library storage
 * seam (better-sqlite3, own `mi_*` tables, additive migration 0002, exported
 * there for the composition root); the DURABLE transcript payload store
 * ships with P4-SUMMARIZE (migration 0004, same rules). These in-memory
 * defaults remain for hermetic unit tests. The port interfaces in
 * ./ports.ts are the stable seam — swapping defaults for persistent
 * adapters changes nothing above the ports.
 */
import type { DerivedArtifact, FeedbackEvent, UserObjective } from "webflix-contracts";
import type {
  ArtifactRegistry,
  FeedbackAppendResult,
  FeedbackStore,
  ObjectiveStore,
  TranscriptPayloadStore,
} from "./ports";
import {
  assertValidTranscriptPayload,
  transcriptPayloadAbsent,
  type TranscriptPayload,
} from "./transcript-payload";

/** In-memory ObjectiveStore (NOT durable — see the module doc). */
export class InMemoryObjectiveStore implements ObjectiveStore {
  private objective: UserObjective | null = null;

  async get(): Promise<UserObjective | null> {
    return this.objective;
  }

  async put(objective: UserObjective): Promise<void> {
    this.objective = objective;
  }
}

/** In-memory FeedbackStore with idempotent-append-by-event-id semantics. */
export class InMemoryFeedbackStore implements FeedbackStore {
  private readonly events = new Map<string, FeedbackEvent>();

  async append(event: FeedbackEvent): Promise<FeedbackAppendResult> {
    const existing = this.events.get(event.id);
    if (existing !== undefined) {
      return { outcome: "duplicate", existing };
    }
    this.events.set(event.id, event);
    return { outcome: "appended", event };
  }

  async get(id: string): Promise<FeedbackEvent | null> {
    return this.events.get(id) ?? null;
  }

  async list(): Promise<readonly FeedbackEvent[]> {
    return [...this.events.values()];
  }
}

/** In-memory ArtifactRegistry for derived-artifact descriptors (NOT durable). */
export class InMemoryArtifactRegistry implements ArtifactRegistry {
  private readonly descriptors = new Map<string, DerivedArtifact>();

  async put(descriptor: DerivedArtifact): Promise<void> {
    this.descriptors.set(descriptor.id, descriptor);
  }

  async get(id: string): Promise<DerivedArtifact | null> {
    return this.descriptors.get(id) ?? null;
  }

  async list(): Promise<readonly DerivedArtifact[]> {
    return [...this.descriptors.values()];
  }
}

/**
 * In-memory TranscriptPayloadStore (NOT durable) — the same checksum
 * validation as the durable adapter (assertValidTranscriptPayload), and the
 * same TYPED absent error, so tests exercise the port's honest contract.
 */
export class InMemoryTranscriptPayloadStore implements TranscriptPayloadStore {
  private readonly payloads = new Map<string, TranscriptPayload>();

  async put(payload: TranscriptPayload): Promise<void> {
    assertValidTranscriptPayload(payload);
    this.payloads.set(payload.artifactId, payload);
  }

  async get(artifactId: string): Promise<TranscriptPayload> {
    const stored = this.payloads.get(artifactId);
    if (stored === undefined) {
      throw transcriptPayloadAbsent(artifactId);
    }
    return stored;
  }
}
