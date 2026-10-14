/**
 * Guest capabilities view model (P7-GUEST-1 — WF-003 guest viewing) — the
 * PURE derivation that answers, per provider operation, whether the GUEST
 * state permits it, the federated-search/history-retention honest-state
 * discipline carried into the guest lane: every answer is DATA, derived
 * from the capability manifests the registry declares, never hardcoded,
 * never guessed, never hidden.
 *
 * Semantics, stated honestly (each rule is pinned by a hermetic test):
 *
 * - THE MANIFEST IS THE ONLY SOURCE OF CAPABILITY TRUTH. Every row is
 *   derived from the frozen §2.3 ConnectorManifest shape (typed against
 *   the existing contracts — NO contract edit this order): an operation
 *   the manifest declares `supported` is PUBLIC (available without
 *   account auth) and the guest state PERMITS it — browse, search and
 *   watch rows ride exactly this declaration, the WF-003 "where source
 *   permits" clause made structural. An operation the manifest declares
 *   with any other status is never re-labeled by this lane: the row
 *   surfaces the manifest's own status and its own detail verbatim.
 * - AUTH REQUIRED IS A TYPED REFUSAL, NOT AN ERROR: an operation the
 *   manifest declares `requires-auth` refuses for the guest state with
 *   the typed `auth-required` row — a STATE returned as data, never
 *   thrown, never a silent no-op, never a pretend-empty result. The
 *   refusal carries the connect-flow pointer (the recovery), and the
 *   honest reason is DERIVED from the observed account state — for a
 *   guest session that state is always the empty list (the factory's
 *   law), so the reason says so plainly.
 * - THE CONNECT FLOW IS NEVER A DEAD ACTION: the refusal points at the
 *   settings/accounts surface AND at the provider's own connect
 *   operation when the manifest declares one (the `oauth.connect` id
 *   the Reddit/Twitch/Instagram manifests established), carrying that
 *   operation's own manifest status — an honest pointer onto a real,
 *   status-bearing capability row, resolvable against the same manifest.
 *   A manifest that declares no connect operation is reported as such
 *   (connectOperationId null — surfaced, never guessed); the guest gate
 *   on a declared connect operation itself derives as permitted, so the
 *   recovery action is actionable for a guest, not a dead end.
 * - THE ACCOUNT-BEARING INPUT IS READ HONESTLY, NEVER WRITTEN: the
 *   derivation accepts the connected-account records (the frozen
 *   ProviderAccountRecord shape) because the input domain carries them,
 *   and refuses to lie about what it is handed: a `requires-auth`
 *   operation whose provider holds an account in the `connected` state
 *   derives as permitted with `auth: "connected-account"` (the
 *   post-connect vocabulary — WF-010's lane owns writing those records;
 *   THIS lane has no account-write path at all), while accounts in the
 *   `expired`/`revoked` states do NOT satisfy the requirement and the
 *   refusal's reason names the observed statuses. A guest session can
 *   never produce these inputs: its account state is pinned empty by
 *   the factory (guest-session.ts) and pinned by test.
 * - DETERMINISTIC ORDER, NOTHING MUTATED: the full view walks providers
 *   in the source's own declaration order and operations in each
 *   manifest's own declaration order (Object.entries string-key order);
 *   the derivation is a pure read — manifests and account records are
 *   never touched, and the caller's arrays are never mutated.
 *
 * NO network, NO credentials, NO provider calls, NO shell/UI, NO
 * telemetry anywhere in this path. The in-memory doubles and the
 * public-capability connector manifest fixture are TESTS-TREE fixtures
 * (src/tests/guest-fixtures.ts) per the order.
 */
import { ConnectorManifestSchema } from "webflix-contracts";
import type {
  CapabilityStatus,
  ConnectorManifest,
  OperationCapability,
  ProviderAccountRecord,
} from "webflix-contracts";

// ---------------------------------------------------------------------------
// Typed rule codes — application-local (the RetentionRuleError /
// AdMemoryRuleError precedent: this lane adds NO shared ErrorCode and its
// refusals are DATA, never thrown)
// ---------------------------------------------------------------------------

/** The caller-defect / shape-violation codes of the guest lane. */
export type GuestRuleCode = "invalid-manifest" | "invalid-gate-target" | "invalid-account-state";

/** Raised when a guest-lane operation violates a shape/rule (typed, local). */
export class GuestRuleError extends Error {
  readonly code: GuestRuleCode;

  constructor(code: GuestRuleCode, message: string) {
    super(message);
    this.name = "GuestRuleError";
    this.code = code;
  }
}

/**
 * Defensive shape validation over the frozen §2.3 ConnectorManifest — the
 * same structural check the connectors registry runs at registration,
 * re-run at this lane's derivation boundary so a malformed manifest
 * crossing an untyped boundary is a typed defect, never a silently
 * mis-derived gate (a wrong gate would be the one dishonesty this lane
 * cannot afford).
 */
export function assertValidConnectorManifest(manifest: ConnectorManifest): void {
  const parsed = ConnectorManifestSchema.safeParse(manifest);
  if (!parsed.success) {
    throw new GuestRuleError(
      "invalid-manifest",
      `not a valid ConnectorManifest (frozen §2.3 shape: providerId, operations Record<OperationId, OperationCapability>, regions, quotas, provenance, failureModes required — got ${JSON.stringify(manifest)}): ${parsed.error.issues
        .map((issue) => issue.message)
        .join("; ")}`,
    );
  }
}

// ---------------------------------------------------------------------------
// The view model shapes — typed, i18n-ready
// ---------------------------------------------------------------------------

/**
 * The connect-flow pointer carried by every `auth-required` refusal: the
 * settings surface that hosts provider connections, the provider to
 * connect, and — when the provider's manifest declares one — the connect
 * operation row itself with its own status. NEVER a dead action: the
 * pointer either lands on a real, status-bearing manifest row or honestly
 * reports that the manifest declares no connect operation.
 */
export interface GuestConnectFlow {
  /** The settings surface hosting provider connections (the shell's mount point). */
  readonly surface: "settings/accounts";
  /** The provider whose account the guest would connect. */
  readonly providerId: string;
  /**
   * The connect operation the provider's manifest declares (the
   * `oauth.connect` id the Reddit/Twitch/Instagram manifests established),
   * or null when the manifest declares none — surfaced, never guessed.
   */
  readonly connectOperationId: string | null;
  /**
   * That connect operation's own manifest status, when it declares one —
   * the recovery's honest availability, carried verbatim from the manifest
   * (never summarized as a boolean; the surface renders what IS).
   */
  readonly connectOperationStatus: CapabilityStatus | null;
}

/**
 * Why a permitted row is permitted — self-describing honesty:
 * - `public`            — the manifest declares the operation supported
 *                         (available without account auth; the guest path);
 * - `connected-account` — a `requires-auth` operation whose provider holds
 *                         an account in the `connected` state (the
 *                         post-connect vocabulary; never producible by a
 *                         guest session, whose account state is empty).
 */
export type GuestPermittedAuth = "public" | "connected-account";

/** One provider operation's honest guest gate row — DATA, never thrown. */
export type GuestOperationGate =
  | {
      /** The manifest declares the operation supported — the guest state permits it. */
      readonly state: "permitted";
      readonly providerId: string;
      readonly operationId: string;
      /** Why the row is permitted (public vs a connected account satisfying the auth). */
      readonly auth: GuestPermittedAuth;
      /** The manifest's own operation detail, surfaced verbatim — never invented. */
      readonly detail: string | undefined;
    }
  | {
      /**
       * The manifest declares the operation requires-auth and the observed
       * account state does not satisfy it — the typed refusal, a state
       * returned as data. The connect-flow pointer is the recovery; the
       * reason is derived from the observed account state, never assumed.
       */
      readonly state: "auth-required";
      readonly providerId: string;
      readonly operationId: string;
      /** The human-readable refusal reason, derived from the observed account state. */
      readonly reason: string;
      /** The manifest's own requires-auth detail, surfaced verbatim. */
      readonly detail: string | undefined;
      /** The connect-flow pointer — the actionable recovery, never a dead action. */
      readonly connectFlow: GuestConnectFlow;
    }
  | {
      /**
       * The manifest declares a non-auth, non-supported status
       * (unsupported / unavailable / rate-limited / degraded / unknown) —
       * surfaced VERBATIM with the manifest's own status and detail. NEVER
       * re-labeled auth-required: telling a guest to connect for an
       * operation that is unavailable even with an account would be the
       * dishonest gate this lane exists to prevent.
       */
      readonly state: "declared-unavailable";
      readonly providerId: string;
      readonly operationId: string;
      /** The manifest's own status, carried verbatim. */
      readonly manifestStatus: Exclude<CapabilityStatus, "supported" | "requires-auth">;
      /** The manifest's own operation detail, surfaced verbatim. */
      readonly detail: string | undefined;
    };

/** Row tallies of the full view (counts, never completeness claims). */
export interface GuestCapabilityCounts {
  readonly permitted: number;
  readonly authRequired: number;
  readonly declaredUnavailable: number;
}

/** The full guest capabilities view — one row per provider operation, deterministic order. */
export interface GuestCapabilitiesView {
  /** The profile the view was derived for (a guest profile id). */
  readonly profileId: string;
  /**
   * One row per provider operation — providers in the source's own
   * declaration order, operations in each manifest's own declaration
   * order. Every declared operation appears exactly once: a gate view
   * never hides a row, whatever its state.
   */
  readonly operations: readonly GuestOperationGate[];
  /** Row tallies by state (counts only, never a completeness claim). */
  readonly counts: GuestCapabilityCounts;
  /**
   * The connected-account records the view was derived from, echoed
   * verbatim — for a guest session: always the empty list (the honest
   * derivation basis, stated not implied).
   */
  readonly connectedAccounts: readonly ProviderAccountRecord[];
}

// ---------------------------------------------------------------------------
// The derivation — pure functions over the frozen shapes
// ---------------------------------------------------------------------------

/**
 * The connect operation id the established manifests declare (Reddit,
 * Twitch, Instagram): `oauth.connect`. The lookup key for the connect-flow
 * pointer — the repo's own vocabulary, never an invention of this lane.
 */
export const GUEST_CONNECT_OPERATION_ID = "oauth.connect";

/** The settings surface that hosts provider connections. */
export const GUEST_CONNECT_SURFACE = "settings/accounts" as const;

/**
 * Derives the connect-flow pointer for one provider: the manifest's own
 * connect operation row (when it declares one) with its own status — an
 * honest pointer onto a real capability row, never a guessed id, never a
 * dead action.
 */
export function deriveGuestConnectFlow(manifest: ConnectorManifest): GuestConnectFlow {
  const connectOperation = manifest.operations[GUEST_CONNECT_OPERATION_ID];
  return {
    surface: GUEST_CONNECT_SURFACE,
    providerId: manifest.providerId,
    connectOperationId: connectOperation === undefined ? null : GUEST_CONNECT_OPERATION_ID,
    connectOperationStatus: connectOperation === undefined ? null : connectOperation.status,
  };
}

/**
 * Derives one operation's guest gate row. Pure: reads the manifest row and
 * the observed account records, touches nothing, invents nothing.
 *
 * The derivation rules (the binding honesty of this lane):
 * - `supported` → permitted, `auth: "public"` (the WF-003 public path);
 * - `requires-auth` + a `connected`-status account for the provider →
 *   permitted, `auth: "connected-account"` (read honestly, never written
 *   by this lane; a guest session can never produce this input);
 * - `requires-auth` otherwise → the typed `auth-required` refusal with the
 *   connect-flow pointer and the reason derived from the observed state;
 * - every other status → `declared-unavailable`, the manifest's own status
 *   and detail surfaced verbatim — never re-labeled auth-required.
 */
export function deriveGuestOperationGate(
  manifest: ConnectorManifest,
  operationId: string,
  capability: OperationCapability,
  connectedAccounts: readonly ProviderAccountRecord[],
): GuestOperationGate {
  const providerId = manifest.providerId;
  const providerAccounts = connectedAccounts.filter((record) => record.providerId === providerId);
  const connected = providerAccounts.find((record) => record.status === "connected");

  if (capability.status === "supported") {
    return {
      state: "permitted",
      providerId,
      operationId,
      auth: "public",
      detail: capability.detail,
    };
  }
  if (capability.status === "requires-auth") {
    if (connected !== undefined) {
      return {
        state: "permitted",
        providerId,
        operationId,
        auth: "connected-account",
        detail: capability.detail,
      };
    }
    const observed =
      providerAccounts.length === 0
        ? "no provider account is connected for this provider (the guest state)"
        : `the observed account grants for this provider are ${providerAccounts
            .map((record) => record.status)
            .join(", ")} — none in the connected state`;
    return {
      state: "auth-required",
      providerId,
      operationId,
      reason:
        `the operation "${operationId}" on "${providerId}" requires a connected account — ` +
        `${observed}; the connect flow is the recovery`,
      detail: capability.detail,
      connectFlow: deriveGuestConnectFlow(manifest),
    };
  }
  return {
    state: "declared-unavailable",
    providerId,
    operationId,
    manifestStatus: capability.status,
    detail: capability.detail,
  };
}

/**
 * Derives the full guest capabilities view over every manifest the source
 * declares: one row per operation, deterministic order (the source's
 * provider order, each manifest's own operation declaration order), the
 * state counts, and the observed account basis echoed verbatim. Each
 * manifest is shape-validated at the boundary (typed GuestRuleError on a
 * malformed manifest — a wrong gate would be the one dishonesty this lane
 * cannot afford). Pure read: nothing is mutated, nothing is invented.
 */
export function deriveGuestCapabilities(
  manifests: readonly ConnectorManifest[],
  connectedAccounts: readonly ProviderAccountRecord[],
  profileId: string,
): GuestCapabilitiesView {
  const operations: GuestOperationGate[] = [];
  for (const manifest of manifests) {
    assertValidConnectorManifest(manifest);
    for (const [operationId, capability] of Object.entries(manifest.operations)) {
      operations.push(
        deriveGuestOperationGate(manifest, operationId, capability, connectedAccounts),
      );
    }
  }
  return {
    profileId,
    operations,
    counts: {
      permitted: operations.filter((row) => row.state === "permitted").length,
      authRequired: operations.filter((row) => row.state === "auth-required").length,
      declaredUnavailable: operations.filter((row) => row.state === "declared-unavailable").length,
    },
    connectedAccounts: [...connectedAccounts],
  };
}
