/**
 * Guest session lane (P7-GUEST-1 — WF-003 guest viewing) — the
 * GuestSessionFactory that mints a guest profile with NO provider accounts
 * connected, and the GuestSession that exposes the honest,
 * capability-derived gates (the view model itself is guest-capabilities.ts;
 * this file owns the session state and the ports).
 *
 * Semantics, stated honestly (each rule is pinned by a hermetic test):
 *
 * - A GUEST PROFILE IS FRESH AND ACCOUNT-LESS BY CONSTRUCTION: the factory
 *   mints a new installation-local profile id (the injected id generator)
 *   at the injected clock's instant, carries the CLOSED `guest` kind
 *   literal (a guest profile can never present as an account-bearing
 *   profile shape), and observes the per-profile account store at mint
 *   time — a fresh profile MUST observe the empty account state; a store
 *   that answers anything else is a wiring defect and is refused with the
 *   typed GuestRuleError (the assertValidSearchSources construction-guard
 *   precedent), never silently ignored.
 * - NO PROVIDER ACCOUNT STATE IS EVER CREATED FOR A GUEST — STRUCTURALLY:
 *   the account-state port this lane owns is READ-ONLY (`list()` and
 *   nothing else). There is no put, no append, no connect method anywhere
 *   in the guest lane, so no guest code path can write account state even
 *   by accident; writing connected accounts is WF-010's lane (the connect
 *   flow), pointed AT here, never implemented here. The tests pin that
 *   the store stays empty through the full guest lifecycle (mint, gate,
 *   view, handoff).
 * - THE GATES ARE DERIVED, NEVER HARDCODED: `gate()` answers one
 *   operation's honest row (permitted / auth-required /
 *   declared-unavailable) and `capabilities()` answers the full view —
 *   both derived live from the manifest source plus the account state the
 *   session OBSERVES at call time (a re-read, never a cached assumption:
 *   the answer states what IS). The `auth-required` row IS the guest →
 *   connect handoff state: it points at the settings/accounts surface and
 *   the manifest's own connect operation — the actionable recovery, never
 *   a dead action.
 * - CALLER DEFECTS ARE TYPED WITH THE HONEST RECOVERY HINT: gating a
 *   provider the manifest source does not know, or an operation the
 *   provider's manifest does not declare, rejects with the typed
 *   GuestRuleError naming the KNOWN provider ids / the provider's own
 *   declared operation ids (the federated-search unknown-source
 *   precedent) — the caller can recover, never guess.
 * - PER-PROFILE ISOLATION (ADR-0003): the account store and manifest
 *   source are per-profile seams handed to the factory; no port crosses
 *   profiles, and two fresh factories mint two isolated sessions (pinned
 *   by an isolation test over two fresh store sets).
 *
 * Ports owned by this lane (the history-retention.ts pattern: ports in
 * the lane file, doubles in the tests tree per this order): the READ-ONLY
 * account-state seam and the manifest-source seam. The in-memory doubles
 * + the public-capability connector manifest fixture live in
 * src/tests/guest-fixtures.ts — TEST FIXTURES, not product defaults; the
 * durable account adapters and the real registry wiring are later orders
 * (the composition root's job). NO network, NO credentials, NO provider
 * calls, NO shell/UI, NO telemetry anywhere in this path.
 */
import type { ConnectorManifest, ProviderAccountRecord } from "webflix-contracts";
import type { ClockPort, IdGenerator } from "./ports";
import type { IsoTimestamp } from "./types";
import type { GuestCapabilitiesView, GuestOperationGate } from "./guest-capabilities";
import {
  assertValidConnectorManifest,
  deriveGuestCapabilities,
  deriveGuestOperationGate,
  GuestRuleError,
} from "./guest-capabilities";

// ---------------------------------------------------------------------------
// Ports — the guest lane's seams (read-only by design)
// ---------------------------------------------------------------------------

/**
 * Per-profile provider-account state seam — READ-ONLY BY DESIGN. `list`
 * answers the connected-account records the profile currently holds; for
 * a freshly minted guest profile that is always the empty list (the
 * factory guards it). There is deliberately NO write method on this
 * port: creating provider account state is WF-010's lane (the connect
 * flow), so the guest lane CANNOT write account state, structurally —
 * the honest boundary stated as a type, not a convention.
 */
export interface GuestProviderAccountStore {
  /** The profile's connected provider accounts; empty for a fresh guest profile. */
  list(): Promise<readonly ProviderAccountRecord[]>;
}

/**
 * The provider-capability manifest source (interface only, the
 * SearchSourceRegistry pattern): `list` returns the frozen §2.3
 * ConnectorManifests in a stable, source-declared order; `get` is the
 * known-provider check the session's gate validates against. The
 * composition root wires the real connector registry behind this seam in
 * a later order; this order's only implementation is the tests-tree
 * fixture (src/tests/guest-fixtures.ts).
 */
export interface ConnectorManifestSource {
  /** Every provider manifest, stable source-declared order. */
  list(): readonly ConnectorManifest[];
  /** The manifest for `providerId`, or null when the source does not know it. */
  get(providerId: string): ConnectorManifest | null;
}

// ---------------------------------------------------------------------------
// The guest profile
// ---------------------------------------------------------------------------

/**
 * A guest profile: a FRESH, installation-local identity with NO provider
 * accounts connected (WF-003). The `kind` literal is closed — a guest
 * profile is structurally distinct from any account-bearing profile
 * shape, so it can never silently present as one.
 */
export interface GuestProfile {
  /** Freshly minted installation-local profile id (the injected id generator). */
  readonly profileId: string;
  /** The closed profile kind: guest (never an account-bearing profile). */
  readonly kind: "guest";
  /** When the profile was minted (injected clock, ISO-8601 UTC). */
  readonly createdAt: IsoTimestamp;
}

// ---------------------------------------------------------------------------
// The session + factory
// ---------------------------------------------------------------------------

/** The deps of the GuestSessionFactory (all seams injected, never ambient). */
export interface GuestSessionFactoryDeps {
  /** The per-profile account-state seam (read-only; see the port). */
  readonly accounts: GuestProviderAccountStore;
  /** The provider-capability manifest source (the capability truth). */
  readonly manifests: ConnectorManifestSource;
  /** Injectable time — the profile is stamped on it, never a wall clock. */
  readonly clock: ClockPort;
  /** Injectable id factory — the profile id is minted from it. */
  readonly generateId: IdGenerator;
}

/**
 * Mints guest sessions — the WF-003 entry point. Every `createSession()`
 * call mints a FRESH guest profile (a new id at the injected clock's
 * instant) and guards the fresh-profile law honestly: the per-profile
 * account store must observe the EMPTY account state for a fresh profile
 * (a store answering anything else is a wiring defect — typed
 * GuestRuleError, never a silent ignore). The minted session exposes the
 * honest, capability-derived gates; it never writes anything.
 */
export class GuestSessionFactory {
  constructor(private readonly deps: GuestSessionFactoryDeps) {}

  async createSession(): Promise<GuestSession> {
    const profile: GuestProfile = {
      profileId: this.deps.generateId(),
      kind: "guest",
      createdAt: this.deps.clock.now().toISOString(),
    };
    const connectedAccounts = await this.deps.accounts.list();
    if (connectedAccounts.length > 0) {
      throw new GuestRuleError(
        "invalid-account-state",
        `a fresh guest profile must observe NO connected provider accounts, but the store answered ${connectedAccounts.length} record(s) (${connectedAccounts
          .map((record) => record.providerId)
          .join(
            ", ",
          )}) — the per-profile account store is wired to the wrong profile (ADR-0003 per-profile isolation)`,
      );
    }
    return new GuestSession(profile, this.deps.accounts, this.deps.manifests);
  }
}

/**
 * One minted guest session: the profile identity plus the honest gates,
 * derived LIVE at every call (the answer states what IS, never a cached
 * assumption). Read-only surface: connectedAccounts(), gate(),
 * capabilities() — nothing in the session writes anything, and the
 * account seam it reads has no write path at all.
 */
export class GuestSession {
  constructor(
    readonly profile: GuestProfile,
    private readonly accounts: GuestProviderAccountStore,
    private readonly manifests: ConnectorManifestSource,
  ) {}

  /**
   * The connected provider accounts the session OBSERVES — for a guest
   * session: always the empty list (the factory's law; nothing in this
   * lane can write account state). A live read, never a cached value.
   */
  async connectedAccounts(): Promise<readonly ProviderAccountRecord[]> {
    return this.accounts.list();
  }

  /**
   * One operation's honest guest gate row — permitted, the typed
   * auth-required refusal (the guest → connect handoff state, carrying
   * the connect-flow pointer), or the manifest's own declared-unavailable
   * state. Caller defects (unknown provider / undeclared operation)
   * reject with the typed GuestRuleError naming the KNOWN ids — the
   * honest recovery hint, never a guess.
   */
  async gate(providerId: string, operationId: string): Promise<GuestOperationGate> {
    const knownProviders = this.manifests.list().map((manifest) => manifest.providerId);
    const manifest = this.manifests.get(providerId);
    if (manifest === null) {
      throw new GuestRuleError(
        "invalid-gate-target",
        `unknown provider id "${providerId}" — the manifest source knows: ${knownProviders.join(", ")}`,
      );
    }
    assertValidConnectorManifest(manifest);
    const capability = manifest.operations[operationId];
    if (capability === undefined) {
      const declared = Object.keys(manifest.operations);
      throw new GuestRuleError(
        "invalid-gate-target",
        `provider "${providerId}" declares no operation "${operationId}" — it declares: ${declared.join(", ")}`,
      );
    }
    const connectedAccounts = await this.accounts.list();
    return deriveGuestOperationGate(manifest, operationId, capability, connectedAccounts);
  }

  /**
   * The full guest capabilities view over every manifest the source
   * declares: one row per operation (deterministic order), the state
   * counts, and the observed account basis echoed verbatim (for a guest:
   * the empty list). A live read — nothing is mutated, nothing is cached.
   */
  async capabilities(): Promise<GuestCapabilitiesView> {
    const connectedAccounts = await this.accounts.list();
    return deriveGuestCapabilities(
      this.manifests.list(),
      connectedAccounts,
      this.profile.profileId,
    );
  }
}
