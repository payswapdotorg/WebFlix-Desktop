/**
 * SetObjectives / GetObjectives — validation + storage port
 * (P4-CONTRACTS scope row 3; P4-ARTIFACTS row 0 collapse).
 *
 * `set` validates the objective with the contract schema FIRST (typed
 * IntelligenceObjectiveInvalid on any shape violation — negative or zero
 * time budgets are rejected there), then applies the list rules through
 * webflix-domain's validateObjectiveInvariants (the domain authority — the
 * P4-FD1 inline mirror collapsed to this import when the application->domain
 * edge landed), then stores. Objectives are the user's CURRENT goals: put
 * replaces wholesale; `declaredAt` is stamped from the injected clock (a
 * user action, never inferred — phase4-mi-plan §8).
 */
import { UserObjectiveSchema, WebFlixError } from "webflix-contracts";
import { ErrorCode } from "webflix-contracts";
import type { TimeBudgets, UserObjective } from "webflix-contracts";
import { validateObjectiveInvariants } from "webflix-domain";
import type { ClockPort, ObjectiveStore } from "./ports";
import { parseOrThrow } from "webflix-domain";

export interface SetObjectivesInput {
  readonly topicFocuses?: readonly string[];
  readonly exclusions?: readonly string[];
  readonly timeBudgets?: TimeBudgets;
}

export interface SetObjectivesDeps {
  readonly store: ObjectiveStore;
  readonly clock: ClockPort;
}

export class SetObjectives {
  constructor(private readonly deps: SetObjectivesDeps) {}

  async set(input: SetObjectivesInput): Promise<UserObjective> {
    const objective = parseOrThrow(
      UserObjectiveSchema,
      {
        topicFocuses: input.topicFocuses ?? [],
        exclusions: input.exclusions ?? [],
        timeBudgets: input.timeBudgets ?? {},
        declaredAt: this.deps.clock.now().toISOString(),
      },
      ErrorCode.IntelligenceObjectiveInvalid,
      "UserObjective",
    );
    const violations = validateObjectiveInvariants(objective);
    if (violations.length > 0) {
      throw new WebFlixError({
        code: ErrorCode.IntelligenceObjectiveInvalid,
        reason: violations.map((violation) => violation.message).join("; "),
        retryable: false,
        context: { count: violations.length },
      });
    }
    await this.deps.store.put(objective);
    return objective;
  }
}

export interface GetObjectivesDeps {
  readonly store: ObjectiveStore;
}

/** Reads the current objective; null = never set (distinct from the empty objective). */
export class GetObjectives {
  constructor(private readonly deps: GetObjectivesDeps) {}

  async get(): Promise<UserObjective | null> {
    return this.deps.store.get();
  }
}
