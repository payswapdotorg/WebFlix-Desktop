/**
 * THE GUEST-LANE FIXTURE SET (P7-GUEST-1) — ALL LABELED TEST DOUBLES,
 * ZERO NETWORK (rg-provable: this module imports NOTHING but contract
 * shapes/types and the guest lane's own ports/modules, and performs NO
 * I/O of any kind — no fetch, no http/https, no sockets, no child
 * processes). Per the binding order these live in the TESTS TREE (not
 * src/, not the package public entry): the in-memory guest stores and
 * the fixture adapters, plus the public-capability connector manifest
 * fixture.
 *
 * The manifest fixture speaks the FROZEN §2.3 ConnectorManifest shape
 * (typed against webflix-contracts — NO contract edit) and follows the
 * work order's own spec exactly:
 *
 *   - public browse  (`browse.list`)   — supported (available without
 *     account auth; the WF-003 public path);
 *   - public search  (`search.query`)  — supported;
 *   - public watch   (`playback.embed`)— supported (the official-embed
 *     watch path the Reddit manifest's own vocabulary established);
 *   - the connect flow (`oauth.connect`) — supported: the recovery
 *     action EXISTS as a real capability row, so an auth-required
 *     refusal's pointer never lands on a dead action;
 *   - account actions (`identity.me`, `subscriptions.list`) —
 *     requires-auth: the account-gated surface the honest gates refuse
 *     with the typed auth-required state;
 *   - one honest-unsupported row (`notifications.list`) — the
 *     declared-unavailable path: the manifest's own state surfaced
 *     verbatim, NEVER re-labeled auth-required.
 *
 * The in-memory account double is READ-ONLY (the port has no write
 * method — structurally no guest code can create account state, WF-010's
 * lane); its optional seed exists ONLY for the pure-derivation tests of
 * the account-bearing input domain (connected/expired/revoked reads —
 * records WF-010's lane would have written; never the guest path, never
 * a session).
 */
import type { ConnectorManifest, ProviderAccountRecord } from "webflix-contracts";
import type { ConnectorManifestSource, GuestProviderAccountStore } from "../guest-session";
import { GUEST_CONNECT_OPERATION_ID } from "../guest-capabilities";

// ---------------------------------------------------------------------------
// The public-capability connector manifest fixture (frozen §2.3 shape)
// ---------------------------------------------------------------------------

/** The fixture provider's id (the registry id space of the tests). */
export const FIXTURE_GUEST_PROVIDER_ID = "fixture-guest-public";

/** The fixture manifest's own version (a fixture constant, honestly labeled). */
export const FIXTURE_GUEST_MANIFEST_VERSION = "1.0.0";

/** The fixture manifest's generated-at constant (a fixture seed artifact, never a live probe). */
export const FIXTURE_GUEST_MANIFEST_GENERATED_AT = "2026-10-14T00:00:00Z";

/** The public browse operation the fixture declares supported. */
export const FIXTURE_GUEST_BROWSE_OPERATION = "browse.list";
/** The public search operation the fixture declares supported. */
export const FIXTURE_GUEST_SEARCH_OPERATION = "search.query";
/** The public watch operation the fixture declares supported. */
export const FIXTURE_GUEST_WATCH_OPERATION = "playback.embed";
/** The account-gated identity operation the fixture declares requires-auth. */
export const FIXTURE_GUEST_IDENTITY_OPERATION = "identity.me";
/** The account-gated subscriptions operation the fixture declares requires-auth. */
export const FIXTURE_GUEST_SUBSCRIPTIONS_OPERATION = "subscriptions.list";
/** The honest-unsupported operation the fixture declares unsupported. */
export const FIXTURE_GUEST_UNSUPPORTED_OPERATION = "notifications.list";

/**
 * The public-capability connector manifest fixture — the work order's own
 * spec: public browse + search + watch marked available; the connect flow
 * available (the never-dead recovery); account actions marked
 * requires-auth; one honest-unsupported row for the declared-unavailable
 * path. A FACTORY, not a shared constant: every call mints a FRESH
 * manifest object so no test can mutate a shared one (the
 * createDefaultFixtureSearchRegistry pattern).
 */
export function createFixtureGuestManifest(): ConnectorManifest {
  return {
    providerId: FIXTURE_GUEST_PROVIDER_ID,
    operations: {
      [FIXTURE_GUEST_BROWSE_OPERATION]: {
        status: "supported",
        detail:
          "fixture: public browse over the fixture provider's listing surface — declared " +
          "available without account auth (the WF-003 public path)",
      },
      [FIXTURE_GUEST_SEARCH_OPERATION]: {
        status: "supported",
        detail:
          "fixture: public keyword search over the fixture provider's search surface — " +
          "declared available without account auth (the WF-003 public path)",
      },
      [FIXTURE_GUEST_WATCH_OPERATION]: {
        status: "supported",
        detail:
          "fixture: public watch via the fixture provider's official-embed surface — " +
          "declared available without account auth (the WF-003 public path)",
      },
      [GUEST_CONNECT_OPERATION_ID]: {
        status: "supported",
        detail:
          "fixture: the connect flow on the shared CredentialPort / OAuthAccountStore " +
          "seams — the recovery action an auth-required refusal points at (a real " +
          "capability row, never a dead action)",
      },
      [FIXTURE_GUEST_IDENTITY_OPERATION]: {
        status: "requires-auth",
        detail:
          "fixture: the authorized account's own identity — declared requires-auth (a " +
          "per-user grant; the guest state refuses it with the typed auth-required state)",
      },
      [FIXTURE_GUEST_SUBSCRIPTIONS_OPERATION]: {
        status: "requires-auth",
        detail:
          "fixture: the authorized account's subscriptions — declared requires-auth (a " +
          "per-user grant; the guest state refuses it with the typed auth-required state)",
      },
      [FIXTURE_GUEST_UNSUPPORTED_OPERATION]: {
        status: "unsupported",
        detail:
          "fixture: this discovery surface has no official read surface at all — the " +
          "honest-unsupported state, surfaced verbatim (never re-labeled auth-required)",
      },
    },
    // Fixture-only build: no region set is claimed (an honest empty list).
    regions: [],
    // Fixture envelope: a generous request window, honestly a fixture value.
    quotas: {
      requestsPerWindow: 100,
      windowMs: 86_400_000,
    },
    provenance: {
      connectorId: FIXTURE_GUEST_PROVIDER_ID,
      connectorVersion: FIXTURE_GUEST_MANIFEST_VERSION,
      // Constant seed artifact: the fixture manifest was authored at this
      // instant (fixture-only; NO capability has been live-probed — an
      // honest fixture stamp, never a fabricated probe timestamp).
      generatedAt: FIXTURE_GUEST_MANIFEST_GENERATED_AT,
    },
    failureModes: ["network", "timeout", "auth"],
  };
}

// ---------------------------------------------------------------------------
// In-memory guest stores — read-only doubles (NOT durable, NOT product)
// ---------------------------------------------------------------------------

/**
 * In-memory GuestProviderAccountStore (NOT durable — a TEST DOUBLE). The
 * port is READ-ONLY and so is the double: `list()` answers the records it
 * was seeded with (none by default — the fresh-profile state), and there
 * is NO write method anywhere on it — structurally, no guest code path
 * can create provider account state through this seam (WF-010's lane owns
 * writes; the tests pin the store stays empty through the guest lifecycle).
 *
 * The optional seed records exist ONLY for the pure-derivation tests over
 * the account-bearing input domain (connected/expired/revoked reads —
 * records WF-010's lane would have written, handed straight to the pure
 * functions, never to a session: the factory would refuse them as the
 * fresh-profile law violation they are).
 */
export class InMemoryGuestAccountStore implements GuestProviderAccountStore {
  private readonly records: readonly ProviderAccountRecord[];

  constructor(seed: readonly ProviderAccountRecord[] = []) {
    this.records = [...seed];
  }

  async list(): Promise<readonly ProviderAccountRecord[]> {
    return this.records.map((record) => ({ ...record }));
  }
}

/**
 * In-memory ConnectorManifestSource (NOT durable — a TEST DOUBLE): serves
 * the manifests it was constructed with (default: ONE fresh
 * public-capability fixture manifest), stable declaration order, `get` by
 * providerId. The composition root wires the real connector registry
 * behind the same seam in a later order.
 */
export class FixtureGuestManifestSource implements ConnectorManifestSource {
  private readonly manifests: readonly ConnectorManifest[];

  constructor(manifests?: readonly ConnectorManifest[]) {
    this.manifests = manifests ?? [createFixtureGuestManifest()];
  }

  list(): readonly ConnectorManifest[] {
    return this.manifests.map((manifest) => ({
      ...manifest,
      operations: { ...manifest.operations },
    }));
  }

  get(providerId: string): ConnectorManifest | null {
    const found = this.manifests.find((manifest) => manifest.providerId === providerId);
    return found === undefined ? null : { ...found, operations: { ...found.operations } };
  }
}

/**
 * The full in-memory guest fixture set (one fresh account store + one
 * fresh manifest source serving the public-capability fixture manifest).
 * A FACTORY, never a shared constant: every call mints FRESH doubles so
 * each test's state stays isolated.
 */
export interface InMemoryGuestFixtureSet {
  readonly accounts: InMemoryGuestAccountStore;
  readonly manifests: FixtureGuestManifestSource;
}

/** Creates a fresh in-memory guest fixture set (hermetic tests). */
export function createInMemoryGuestFixtureSet(): InMemoryGuestFixtureSet {
  return {
    accounts: new InMemoryGuestAccountStore(),
    manifests: new FixtureGuestManifestSource(),
  };
}

// ---------------------------------------------------------------------------
// Account-record fixtures for the pure-derivation tests (input-domain
// honesty: connected / expired / revoked — records WF-010's lane would
// have written; handed ONLY to the pure functions, never to a session)
// ---------------------------------------------------------------------------

/** A connected-status account record for the fixture provider. */
export function connectedFixtureGuestAccount(): ProviderAccountRecord {
  return {
    providerId: FIXTURE_GUEST_PROVIDER_ID,
    internalAccountId: "fixture-account-connected-1",
    displayName: "Fixture Connected Account",
    grantedScopes: ["fixture.read"],
    status: "connected",
    connectedAt: "2026-10-14T00:00:00Z",
    expiresAt: "2027-10-14T00:00:00Z",
  };
}

/** An expired-status account record for the fixture provider. */
export function expiredFixtureGuestAccount(): ProviderAccountRecord {
  return {
    providerId: FIXTURE_GUEST_PROVIDER_ID,
    internalAccountId: "fixture-account-expired-1",
    displayName: "Fixture Expired Account",
    grantedScopes: ["fixture.read"],
    status: "expired",
    connectedAt: "2026-01-14T00:00:00Z",
    expiresAt: "2026-10-01T00:00:00Z",
  };
}

/** A revoked-status account record for the fixture provider. */
export function revokedFixtureGuestAccount(): ProviderAccountRecord {
  return {
    providerId: FIXTURE_GUEST_PROVIDER_ID,
    internalAccountId: "fixture-account-revoked-1",
    displayName: "Fixture Revoked Account",
    grantedScopes: ["fixture.read"],
    status: "revoked",
    connectedAt: "2026-01-14T00:00:00Z",
  };
}
