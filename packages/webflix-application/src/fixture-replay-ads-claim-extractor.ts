/**
 * FixtureReplayAdsClaimExtractor — a DETERMINISTIC TEST DOUBLE implementing
 * the AdsClaimExtractor seam (P5-CLAIMS scope row 4).
 *
 * *** THIS IS A TEST DOUBLE — IT DOES NO REAL EXTRACTION. ***
 *
 * It replays CANNED claims supplied by the test (keyed by record id) and
 * records every call, which is exactly what the use-case tests need to pin
 * their honest-state contract without bundling the real engine:
 * - DETERMINISM: the same fixture => byte-for-byte the same claims, every
 *   run, forever (no randomness, no wall clock, no filesystem reads);
 * - THE CONTRACT: the double exposes a configurable id/version (defaults
 *   to the fixture identity) so the version rule is testable — a v1
 *   fixture and a v2 fixture mint different provenance for the same
 *   script, and the use case's store effects differ accordingly;
 * - CALL RECORDING: every extract call is recorded (record + aborted-at-
 *   entry never applies — the extractor is synchronous and pure); a
 *   mid-run cancellation test asserts exactly WHICH records were reached;
 * - FAILURE INJECTION: `failOnRecordIds` makes the double THROW for the
 *   named records — the use case's extractor-failure path (job FAILED,
 *   cause rethrown typed), the fixture-replay-engine precedent;
 * - HONEST EMPTY: a record id with no scripted claims replays an empty
 *   list — never an invented claim.
 *
 * No network, no model, no lexicon: the real pattern engine lives in
 * ./ads-claim-extractor.ts; this double exists for cancellation/contract
 * tests where the real engine's behavior is irrelevant.
 */
import type { AdRecord, Claim } from "webflix-contracts";
import type { AdsClaimExtractor } from "./ports";

/** The test double's identity (OUR code's — always known). */
export const FIXTURE_ADS_CLAIM_EXTRACTOR_ID = "webflix.fixture-ads-claim-extractor";
export const FIXTURE_ADS_CLAIM_EXTRACTOR_VERSION = "0.1.0";

/** What the double replays, supplied entirely by the test. */
export interface FixtureAdsClaimExtractorScript {
  /** Canned claims keyed by the record id they are "extracted" from. */
  readonly claimsByRecordId?: Readonly<Record<string, readonly Claim[]>>;
  /**
   * Identity overrides — the version rule's test surface: a fixture
   * reporting a DIFFERENT version is a different extraction provenance.
   */
  readonly id?: string;
  readonly version?: string;
  /** Throw for these record ids (the extractor-failure injection). */
  readonly failOnRecordIds?: readonly string[];
}

/** One recorded extraction call (assertion evidence, arrival order). */
export interface FixtureAdsClaimExtractionCall {
  readonly recordId: string;
  /** The claims the double replayed for this call. */
  readonly claims: readonly Claim[];
}

export class FixtureReplayAdsClaimExtractor implements AdsClaimExtractor {
  readonly id: string;
  readonly version: string;
  /** Read-only snapshot of every recorded call (assertion evidence). */
  get calls(): readonly FixtureAdsClaimExtractionCall[] {
    return this.recording.map((call) => ({
      recordId: call.recordId,
      claims: [...call.claims],
    }));
  }

  private readonly recording: {
    recordId: string;
    claims: readonly Claim[];
  }[] = [];

  constructor(private readonly script: FixtureAdsClaimExtractorScript = {}) {
    this.id = script.id ?? FIXTURE_ADS_CLAIM_EXTRACTOR_ID;
    this.version = script.version ?? FIXTURE_ADS_CLAIM_EXTRACTOR_VERSION;
  }

  extract(record: AdRecord): readonly Claim[] {
    if (this.script.failOnRecordIds?.includes(record.id) === true) {
      // The "engine itself reported failure" path: a plain Error, NOT a
      // typed ads error — the use case must wrap it typed (job FAILED).
      throw new Error(
        `fixture ads claim extractor reported its own failure on record "${record.id}" (injected)`,
      );
    }
    const claims = this.script.claimsByRecordId?.[record.id] ?? [];
    // Defensive copy in + out: the double never aliases the script's arrays
    // and the caller can never mutate the replayed claims through the result.
    const replayed = claims.map((claim) => ({ ...claim }));
    this.recording.push({ recordId: record.id, claims: replayed });
    return replayed;
  }
}
