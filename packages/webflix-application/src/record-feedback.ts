/**
 * RecordFeedback — idempotent append with provenance validation
 * (P4-CONTRACTS scope row 3).
 *
 * The caller (a UI surface) mints ONE event id per user action and reuses
 * it on retries — that is what makes appends idempotent end-to-end. The
 * use-case validates the event against the locked schema (typed
 * IntelligenceFeedbackInvalid on any provenance/payload violation), then
 * appends through the store. When the store reports a duplicate id:
 * - identical payload (canonical-JSON equality) => idempotent no-op, the
 *   event exists exactly once — reported back as `duplicate`;
 * - different payload under the same id => typed IntelligenceFeedbackConflict
 *   (an integrity violation, never silently overwritten).
 */
import { FeedbackEventSchema, WebFlixError } from "webflix-contracts";
import { ErrorCode } from "webflix-contracts";
import type { FeedbackEvent } from "webflix-contracts";
import { parseOrThrow } from "webflix-domain";
import type { FeedbackStore } from "./ports";

export type RecordFeedbackResult =
  | { readonly outcome: "appended"; readonly event: FeedbackEvent }
  | { readonly outcome: "duplicate"; readonly event: FeedbackEvent };

export interface RecordFeedbackDeps {
  readonly store: FeedbackStore;
}

export class RecordFeedback {
  constructor(private readonly deps: RecordFeedbackDeps) {}

  async record(event: FeedbackEvent): Promise<RecordFeedbackResult> {
    const validated = parseOrThrow(
      FeedbackEventSchema,
      event,
      ErrorCode.IntelligenceFeedbackInvalid,
      "FeedbackEvent",
    );
    const result = await this.deps.store.append(validated);
    if (result.outcome === "appended") {
      return { outcome: "appended", event: result.event };
    }
    const stored = result.existing;
    if (canonicalJson(validated) !== canonicalJson(stored)) {
      throw new WebFlixError({
        code: ErrorCode.IntelligenceFeedbackConflict,
        reason: `feedback event id ${validated.id} is already stored with a different payload`,
        retryable: false,
        context: {
          eventId: validated.id,
          storedChannel: stored.channel,
          incomingChannel: validated.channel,
        },
      });
    }
    return { outcome: "duplicate", event: stored };
  }
}

/** Structural equality check via canonical JSON — both sides came out of the same zod schema, so key order is identical. */
function canonicalJson(event: FeedbackEvent): string {
  return JSON.stringify(event);
}
