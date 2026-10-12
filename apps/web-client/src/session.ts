/**
 * P6-WEB-HOST-1 — the web client's composition root: the browser-safe
 * application layer, wired (phase6-clients-plan §2 + §8: a client is a
 * composition, not a product fork).
 *
 * Everything here is reused AS-IS from webflix-application — no parallel use
 * cases, no re-declared stores, no forked shapes (contracts stay 0.11.0):
 *  - the IN-MEMORY doubles (the ads stores + the intelligence stores + the
 *    ranker selection store) — session-only by construction, exactly what
 *    the sqlite law (§4) prescribes for the web runtime;
 *  - the DEFAULT ranker adapter registry (the built-in deterministic v1);
 *  - the real use cases the mounted surfaces serve: SetRankerAdapterSelection
 *    + ResolveSelectedRanker (the MI Evaluation selector), QualifyAdsRecords
 *    (the Ad Center read), ReadTransparencySourceManifests (the honest
 *    source-coverage declaration).
 *
 * NO durable store is constructed, NO connector is imported, NO network
 * token exists in this file (rg-provable). One session = one tab session;
 * createWebClientSession() is called once per App mount.
 */

import {
  DEFAULT_RANKER_ADAPTER_REGISTRY,
  DEFAULT_TRANSPARENCY_SOURCE_REGISTRY,
  InMemoryRankerSelectionStore,
  QualifyAdsRecords,
  ReadTransparencySourceManifests,
  ResolveSelectedRanker,
  SetRankerAdapterSelection,
  createInMemoryAdsStores,
} from "webflix-application";

import type {
  AdsQualificationItemOutcome,
  RankerAdapterDescriptor,
  RankerAdapterRegistry,
  RankerSelectionStore,
  ResolvedRanker,
} from "webflix-application";
import type { TransparencySourceManifest } from "webflix-shell";

/** A plain injectable clock — the application layer never reads the wall clock directly. */
const sessionClock = (): { now(): Date } => ({ now: () => new Date() });

/** Session-scoped opaque ids (a monotonic counter — no durability implied, none claimed). */
function createSessionIdGenerator(): () => string {
  let next = 0;
  return () => `web-client-session-${(next += 1)}`;
}

/** The wired web session: the in-memory stores + the live use cases. */
export interface WebClientSession {
  /** The ranker adapter registry (the real default — the built-in v1 entry). */
  readonly rankerRegistry: RankerAdapterRegistry;
  /** Descriptor-only entries for the selector (no adapter instances cross into the view). */
  readonly rankerDescriptors: readonly RankerAdapterDescriptor[];
  /** The session-only selection store (the honest session state, inspectable). */
  readonly rankerSelectionStore: RankerSelectionStore;
  /** set/clear/resolve — the live selection use cases. */
  readonly setRankerSelection: SetRankerAdapterSelection;
  readonly resolveSelectedRanker: ResolveSelectedRanker;
  /** ads.qualify — the live Ad Center read over the in-memory ads stores. */
  readonly qualifyAdsRecords: QualifyAdsRecords;
  /** ads.sourceManifests — the honest source-coverage declarations read. */
  readonly readSourceManifests: ReadTransparencySourceManifests;
  /** The stored ad-record ids (the qualification read's honest population). */
  readonly storedAdRecordIds: () => Promise<readonly string[]>;
}

/** Creates one browser-safe session: in-memory stores + wired use cases. */
export function createWebClientSession(): WebClientSession {
  const clock = sessionClock();
  const generateId = createSessionIdGenerator();

  // The in-memory doubles — session-only by construction (plan §4).
  const adsStores = createInMemoryAdsStores();

  // The real default registries (reused, never re-declared).
  const rankerRegistry = DEFAULT_RANKER_ADAPTER_REGISTRY;
  const sourceRegistry = DEFAULT_TRANSPARENCY_SOURCE_REGISTRY;

  // The live use cases the mounted surfaces serve.
  const rankerSelectionStore = new InMemoryRankerSelectionStore();
  const setRankerSelection = new SetRankerAdapterSelection({
    registry: rankerRegistry,
    store: rankerSelectionStore,
    clock,
  });
  const resolveSelectedRanker = new ResolveSelectedRanker({
    registry: rankerRegistry,
    store: rankerSelectionStore,
  });
  const qualifyAdsRecords = new QualifyAdsRecords({
    records: adsStores.records,
    claims: adsStores.claims,
    edges: adsStores.evidenceEdges,
    reviewSignals: adsStores.reviewSignals,
    verifications: adsStores.offerVerifications,
    clock,
    generateId,
  });
  const readSourceManifests = new ReadTransparencySourceManifests({
    registry: sourceRegistry,
    clock,
    generateId,
  });

  // Descriptor-only view of the registry (the adapter instances stay behind
  // the seam — the selector renders entries, never adapters).
  const rankerDescriptors: readonly RankerAdapterDescriptor[] = rankerRegistry
    .list()
    .map(({ id, label, description, capabilities }) => ({
      id,
      label,
      description,
      capabilities,
    }));

  const storedAdRecordIds = async (): Promise<readonly string[]> => {
    const records = await adsStores.records.list();
    return records.map((record) => record.id);
  };

  return {
    rankerRegistry,
    rankerDescriptors,
    rankerSelectionStore,
    setRankerSelection,
    resolveSelectedRanker,
    qualifyAdsRecords,
    readSourceManifests,
    storedAdRecordIds,
  };
}

// ---------------------------------------------------------------------------
// View-model helpers — the honest copy the host renders FROM REAL DATA
// (never invented). Plain functions over the use cases' outputs.
// ---------------------------------------------------------------------------

/** The selector status note after a real selection: resolution metadata, verbatim. */
export function rankerStatusNoteFor(resolved: ResolvedRanker): string {
  if (resolved.resolution.kind === "selected") {
    return `Selected ${resolved.adapter.label} — session only (this choice resets with the tab).`;
  }
  if (resolved.resolution.kind === "default") {
    return `${resolved.resolution.note} Session only — this resets with the tab.`;
  }
  // Fail-soft registry drift: the typed error's own reason, surfaced verbatim.
  return `${resolved.resolution.error.reason} Session only — this resets with the tab.`;
}

/** One line per source manifest — the coverage declaration, as data. */
export function sourceManifestLines(
  manifests: readonly TransparencySourceManifest[],
): readonly string[] {
  return manifests.map(
    (manifest) => `${manifest.displayName}: ${manifest.accessState} — ${manifest.coverageNote}`,
  );
}

/** Runs the Ad Center qualification read over the session's CURRENT stored ids. */
export async function qualificationItemOutcomes(
  session: WebClientSession,
): Promise<readonly AdsQualificationItemOutcome[]> {
  const adRecordIds = await session.storedAdRecordIds();
  const output = await session.qualifyAdsRecords.execute({ adRecordIds });
  if (output.report === null) {
    // Cancelled or failed: no outcomes to render — absence stated, never faked.
    return [];
  }
  return output.report.outcomes;
}
