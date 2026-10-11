/**
 * SetObjectives / GetObjectives — validation + storage port
 * (P4-CONTRACTS scope row 3).
 *
 * `set` validates the objective with the contract schema FIRST (typed
 * IntelligenceObjectiveInvalid on any shape violation — negative or zero
 * time budgets are rejected there), then applies the list rules (duplicate
 * focuses/exclusions, focus-excluded overlap — same rules as webflix-domain's
 * validateObjectiveInvariants; inlined here because application cannot
 * import webflix-domain this order, see the P4-FD1 proposal), then stores.
 * Objectives are the user's CURRENT goals: put replaces wholesale;
 * `declaredAt` is stamped from the injected clock (a user action, never
 * inferred — phase4-mi-plan §8).
 */
import { UserObjectiveSchema, WebFlixError } from "webflix-contracts";
import { ErrorCode } from "webflix-contracts";
import type { TimeBudgets, UserObjective } from "webflix-contracts";
import type { ClockPort, ObjectiveStore } from "./ports";
import { parseContractOrThrow } from "./contract-parse";

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
    const objective = parseContractOrThrow(
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
    const violations = listRuleViolations(objective);
    if (violations.length > 0) {
      throw new WebFlixError({
        code: ErrorCode.IntelligenceObjectiveInvalid,
        reason: violations.join("; "),
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

/**
 * The objective list rules (mirrors webflix-domain's
 * validateObjectiveInvariants; kept in sync by mirrored tests):
 * - topicFocuses/exclusions contain no duplicates (case-insensitive);
 * - a term can never be both a focus and an exclusion.
 */
function listRuleViolations(objective: UserObjective): string[] {
  const violations: string[] = [];
  const focuses = objective.topicFocuses.map((term) => term.trim().toLowerCase());
  const exclusions = objective.exclusions.map((term) => term.trim().toLowerCase());
  const focusDups = findDuplicates(focuses);
  if (focusDups.length > 0) {
    violations.push(`topicFocuses contains duplicate entries: ${focusDups.join(", ")}`);
  }
  const exclusionDups = findDuplicates(exclusions);
  if (exclusionDups.length > 0) {
    violations.push(`exclusions contains duplicate entries: ${exclusionDups.join(", ")}`);
  }
  const overlap = [...new Set(focuses.filter((term) => exclusions.includes(term)))].sort();
  if (overlap.length > 0) {
    violations.push(`a topic cannot be both a focus and an exclusion: ${overlap.join(", ")}`);
  }
  return violations;
}

function findDuplicates(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const duplicated = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicated.add(value);
    else seen.add(value);
  }
  return [...duplicated].sort();
}
