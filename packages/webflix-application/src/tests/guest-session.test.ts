/**
 * P7-GUEST-1 tests — WF-003 guest viewing with honest, capability-aware
 * auth gates.
 *
 * FIXTURE-ONLY / HERMETIC: every port is backed by the lane's own
 * tests-tree doubles (guest-fixtures.ts) with an injected fake clock and
 * a deterministic id generator — no filesystem, no network, no database,
 * no wall clock, no timers, no provider calls, no credentials anywhere.
 * The tests prove the STATED CONTRACTS ONLY:
 *
 *   1. fresh-profile guest session creation — a minted guest profile is
 *      a FRESH account-less identity (closed kind literal, injected id +
 *      clock), the fresh-profile law is guarded, and the account state
 *      observed is the honest empty list;
 *   2. public-capability operations resolve — the manifest-declared
 *      public rows (browse / search / watch, and the connect flow itself)
 *      gate as permitted with the manifest's own detail verbatim;
 *   3. account-gated operations refuse with typed reasons — the
 *      requires-auth rows answer the typed auth-required state as DATA
 *      (resolved, never thrown), the reason derived from the observed
 *      account state;
 *   4. no provider account state is ever created for a guest — the
 *      account store stays empty through the full guest lifecycle, and
 *      the account seam is read-only BY STRUCTURE (no write method
 *      exists anywhere on the port or the double);
 *   5. the guest → connect handoff produces the auth-required state
 *      honestly — the refusal's connect-flow pointer lands on a REAL,
 *      status-bearing manifest row (never a dead action), the manifest's
 *      own requires-auth detail is surfaced verbatim, and a manifest
 *      declaring no connect operation reports that honestly;
 *   6. declared-unavailable rows surface the manifest's own state —
 *      never re-labeled auth-required;
 *   7. the account-bearing input domain is read honestly (connected →
 *      permitted-with-account; expired/revoked → refusal naming the
 *      observed statuses) — read-only derivations over records WF-010's
 *      lane would have written, never a session, never a write;
 *   8. caller defects are typed with the honest recovery hint (known
 *      provider ids / the provider's declared operations);
 *   9. per-profile isolation (ADR-0003) over two fresh fixture sets;
 *  10. the fixture contracts: the manifest fixture parses against the
 *      frozen §2.3 schema and follows the order's own spec (public
 *      browse + search + watch available; account actions auth-required).
 */
import { describe, expect, it } from "vitest";
import { ConnectorManifestSchema } from "webflix-contracts";
import type { CapabilityStatus, ConnectorManifest, OperationCapability } from "webflix-contracts";
import type { ClockPort, IdGenerator } from "../ports";
import {
  deriveGuestCapabilities,
  deriveGuestOperationGate,
  GuestRuleError,
} from "../guest-capabilities";
import { GuestSessionFactory } from "../guest-session";
import {
  connectedFixtureGuestAccount,
  createFixtureGuestManifest,
  createInMemoryGuestFixtureSet,
  expiredFixtureGuestAccount,
  FixtureGuestManifestSource,
  FIXTURE_GUEST_BROWSE_OPERATION,
  FIXTURE_GUEST_IDENTITY_OPERATION,
  FIXTURE_GUEST_PROVIDER_ID,
  FIXTURE_GUEST_SEARCH_OPERATION,
  FIXTURE_GUEST_SUBSCRIPTIONS_OPERATION,
  FIXTURE_GUEST_UNSUPPORTED_OPERATION,
  FIXTURE_GUEST_WATCH_OPERATION,
  InMemoryGuestAccountStore,
  revokedFixtureGuestAccount,
} from "./guest-fixtures";
import { GUEST_CONNECT_OPERATION_ID } from "../guest-capabilities";

// ---------------------------------------------------------------------------
// Fixtures (fixture-only)
// ---------------------------------------------------------------------------

class FakeClock implements ClockPort {
  private instant: Date;

  constructor(iso = "2026-10-14T00:00:00.000Z") {
    this.instant = new Date(iso);
  }

  now(): Date {
    return new Date(this.instant);
  }
}

/** Deterministic id generator: `guest-1`, `guest-2`, ... */
function makeIdGenerator(prefix: string): IdGenerator {
  let counter = 0;
  return () => `${prefix}-${(counter += 1)}`;
}

/** The manifest row for one operation (fails loudly when the fixture lacks it). */
function operationOf(manifest: ConnectorManifest, operationId: string): OperationCapability {
  const capability = manifest.operations[operationId];
  if (capability === undefined) {
    throw new Error(`the fixture manifest declares no operation "${operationId}"`);
  }
  return capability;
}

function makeFactory(
  accounts: InMemoryGuestAccountStore = new InMemoryGuestAccountStore(),
  generateId: IdGenerator = makeIdGenerator("guest"),
) {
  const clock = new FakeClock();
  const factory = new GuestSessionFactory({
    accounts,
    manifests: new FixtureGuestManifestSource(),
    clock,
    generateId,
  });
  return { clock, factory };
}

async function makeGuestSession() {
  const set = createInMemoryGuestFixtureSet();
  const clock = new FakeClock();
  const factory = new GuestSessionFactory({
    accounts: set.accounts,
    manifests: set.manifests,
    clock,
    generateId: makeIdGenerator("guest"),
  });
  const session = await factory.createSession();
  return { set, clock, factory, session };
}

// ---------------------------------------------------------------------------
// 1. Fresh-profile guest session creation
// ---------------------------------------------------------------------------

describe("fresh-profile guest session creation", () => {
  it("mints a fresh guest profile: the closed kind literal, the injected id, the injected clock stamp", async () => {
    const { session } = await makeGuestSession();
    expect(session.profile).toEqual({
      profileId: "guest-1",
      kind: "guest",
      createdAt: "2026-10-14T00:00:00.000Z",
    });
  });

  it("the fresh session observes NO connected accounts (the honest empty state)", async () => {
    const { session, set } = await makeGuestSession();
    await expect(session.connectedAccounts()).resolves.toEqual([]);
    await expect(set.accounts.list()).resolves.toEqual([]);
  });

  it("two mints produce two distinct fresh profile ids (a fresh identity per session)", async () => {
    const { factory } = makeFactory();
    const first = await factory.createSession();
    const second = await factory.createSession();
    expect(first.profile.profileId).toBe("guest-1");
    expect(second.profile.profileId).toBe("guest-2");
    expect(first.profile.profileId).not.toBe(second.profile.profileId);
  });

  it("a store answering pre-existing accounts is refused with the typed invalid-account-state error (the fresh-profile law)", async () => {
    const seeded = new InMemoryGuestAccountStore([connectedFixtureGuestAccount()]);
    const { factory } = makeFactory(seeded);
    let caught: unknown;
    try {
      await factory.createSession();
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(GuestRuleError);
    expect((caught as GuestRuleError).code).toBe("invalid-account-state");
    expect((caught as GuestRuleError).message).toContain(
      "a fresh guest profile must observe NO connected provider accounts",
    );
  });
});

// ---------------------------------------------------------------------------
// 2. Public-capability operations resolve (honest gates by capability)
// ---------------------------------------------------------------------------

describe("public-capability operations resolve (permitted, honest gates by capability)", () => {
  it("browse.list gates as permitted (public) with the manifest's own detail verbatim", async () => {
    const { session } = await makeGuestSession();
    const manifest = createFixtureGuestManifest();
    const gate = await session.gate(FIXTURE_GUEST_PROVIDER_ID, FIXTURE_GUEST_BROWSE_OPERATION);
    expect(gate).toEqual({
      state: "permitted",
      providerId: FIXTURE_GUEST_PROVIDER_ID,
      operationId: FIXTURE_GUEST_BROWSE_OPERATION,
      auth: "public",
      detail: manifest.operations[FIXTURE_GUEST_BROWSE_OPERATION]?.detail,
    });
  });

  it("search.query gates as permitted (public)", async () => {
    const { session } = await makeGuestSession();
    const gate = await session.gate(FIXTURE_GUEST_PROVIDER_ID, FIXTURE_GUEST_SEARCH_OPERATION);
    expect(gate.state).toBe("permitted");
    expect(gate).toMatchObject({ auth: "public", operationId: FIXTURE_GUEST_SEARCH_OPERATION });
  });

  it("playback.embed gates as permitted (public watch)", async () => {
    const { session } = await makeGuestSession();
    const gate = await session.gate(FIXTURE_GUEST_PROVIDER_ID, FIXTURE_GUEST_WATCH_OPERATION);
    expect(gate.state).toBe("permitted");
    expect(gate).toMatchObject({ auth: "public", operationId: FIXTURE_GUEST_WATCH_OPERATION });
  });

  it("the full view lists every declared operation exactly once, in manifest declaration order, with the counts", async () => {
    const { session } = await makeGuestSession();
    const view = await session.capabilities();
    expect(view.operations.map((row) => row.operationId)).toEqual([
      FIXTURE_GUEST_BROWSE_OPERATION,
      FIXTURE_GUEST_SEARCH_OPERATION,
      FIXTURE_GUEST_WATCH_OPERATION,
      GUEST_CONNECT_OPERATION_ID,
      FIXTURE_GUEST_IDENTITY_OPERATION,
      FIXTURE_GUEST_SUBSCRIPTIONS_OPERATION,
      FIXTURE_GUEST_UNSUPPORTED_OPERATION,
    ]);
    expect(view.operations.map((row) => row.state)).toEqual([
      "permitted",
      "permitted",
      "permitted",
      "permitted",
      "auth-required",
      "auth-required",
      "declared-unavailable",
    ]);
    expect(view.counts).toEqual({ permitted: 4, authRequired: 2, declaredUnavailable: 1 });
    expect(view.profileId).toBe("guest-1");
    expect(view.connectedAccounts).toEqual([]);
  });

  it("the connect flow itself (oauth.connect) gates as permitted — the recovery is an actionable public action", async () => {
    const { session } = await makeGuestSession();
    const gate = await session.gate(FIXTURE_GUEST_PROVIDER_ID, GUEST_CONNECT_OPERATION_ID);
    expect(gate.state).toBe("permitted");
    expect(gate).toMatchObject({ auth: "public", operationId: GUEST_CONNECT_OPERATION_ID });
  });
});

// ---------------------------------------------------------------------------
// 3. Account-gated operations refuse with typed reasons (data, never thrown)
// ---------------------------------------------------------------------------

describe("account-gated operations refuse with typed reasons", () => {
  it("identity.me gates as the typed auth-required refusal — a state, resolved not thrown", async () => {
    const { session } = await makeGuestSession();
    const gate = await session.gate(FIXTURE_GUEST_PROVIDER_ID, FIXTURE_GUEST_IDENTITY_OPERATION);
    expect(gate.state).toBe("auth-required");
  });

  it("subscriptions.list gates as the typed auth-required refusal", async () => {
    const { session } = await makeGuestSession();
    const gate = await session.gate(
      FIXTURE_GUEST_PROVIDER_ID,
      FIXTURE_GUEST_SUBSCRIPTIONS_OPERATION,
    );
    expect(gate.state).toBe("auth-required");
  });

  it("the refusal reason names the guest state and the connect recovery, derived from the observed account state", async () => {
    const { session } = await makeGuestSession();
    const gate = await session.gate(FIXTURE_GUEST_PROVIDER_ID, FIXTURE_GUEST_IDENTITY_OPERATION);
    expect(gate.state).toBe("auth-required");
    if (gate.state !== "auth-required") throw new Error("unreachable");
    expect(gate.reason).toContain("requires a connected account");
    expect(gate.reason).toContain("no provider account is connected for this provider");
    expect(gate.reason).toContain("the guest state");
    expect(gate.reason).toContain("the connect flow is the recovery");
  });

  it("the full view counts the two auth-required rows", async () => {
    const { session } = await makeGuestSession();
    const view = await session.capabilities();
    expect(view.counts.authRequired).toBe(2);
    expect(
      view.operations.filter((row) => row.state === "auth-required").map((row) => row.operationId),
    ).toEqual([FIXTURE_GUEST_IDENTITY_OPERATION, FIXTURE_GUEST_SUBSCRIPTIONS_OPERATION]);
  });
});

// ---------------------------------------------------------------------------
// 4. No provider account state is ever created for a guest
// ---------------------------------------------------------------------------

describe("no provider account state is ever created for a guest", () => {
  it("the account store stays empty through the full guest lifecycle (mint + gates + full view)", async () => {
    const { session, set } = await makeGuestSession();
    await session.gate(FIXTURE_GUEST_PROVIDER_ID, FIXTURE_GUEST_BROWSE_OPERATION);
    await session.gate(FIXTURE_GUEST_PROVIDER_ID, FIXTURE_GUEST_IDENTITY_OPERATION);
    await session.gate(FIXTURE_GUEST_PROVIDER_ID, GUEST_CONNECT_OPERATION_ID);
    await session.capabilities();
    await expect(set.accounts.list()).resolves.toEqual([]);
    await expect(session.connectedAccounts()).resolves.toEqual([]);
  });

  it("the account seam is read-only BY STRUCTURE: no account-writing method exists on the double", () => {
    const store = new InMemoryGuestAccountStore();
    const surface = [
      ...Object.getOwnPropertyNames(store),
      ...Object.getOwnPropertyNames(Object.getPrototypeOf(store)),
    ];
    const writeLike = surface.filter((name) =>
      /^(put|append|create|connect|add|write|insert|save|upsert|remove|delete|clear|grant|revoke)/i.test(
        name,
      ),
    );
    expect(writeLike).toEqual([]);
    expect(typeof store.list).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// 5. Guest → connect handoff produces the auth-required state honestly
// ---------------------------------------------------------------------------

describe("guest → connect handoff produces the auth-required state honestly", () => {
  it("the handoff refusal carries the connect-flow pointer: the settings/accounts surface + the fixture provider", async () => {
    const { session } = await makeGuestSession();
    const gate = await session.gate(FIXTURE_GUEST_PROVIDER_ID, FIXTURE_GUEST_IDENTITY_OPERATION);
    if (gate.state !== "auth-required") throw new Error("expected the typed refusal");
    expect(gate.connectFlow).toEqual({
      surface: "settings/accounts",
      providerId: FIXTURE_GUEST_PROVIDER_ID,
      connectOperationId: GUEST_CONNECT_OPERATION_ID,
      connectOperationStatus: "supported",
    });
  });

  it("the pointed-at connect operation resolves against the manifest to a real supported row (never a dead pointer)", async () => {
    const { session } = await makeGuestSession();
    const gate = await session.gate(FIXTURE_GUEST_PROVIDER_ID, FIXTURE_GUEST_IDENTITY_OPERATION);
    if (gate.state !== "auth-required") throw new Error("expected the typed refusal");
    const { connectOperationId, connectOperationStatus } = gate.connectFlow;
    expect(connectOperationId).not.toBeNull();
    const manifest = createFixtureGuestManifest();
    const pointedAt =
      connectOperationId === null ? undefined : manifest.operations[connectOperationId];
    expect(pointedAt).toBeDefined();
    expect(pointedAt?.status).toBe("supported");
    expect(connectOperationStatus).toBe(pointedAt?.status);
  });

  it("the refusal surfaces the manifest's own requires-auth detail verbatim (never an invented reason)", async () => {
    const { session } = await makeGuestSession();
    const gate = await session.gate(FIXTURE_GUEST_PROVIDER_ID, FIXTURE_GUEST_IDENTITY_OPERATION);
    if (gate.state !== "auth-required") throw new Error("expected the typed refusal");
    const manifest = createFixtureGuestManifest();
    expect(gate.detail).toBe(manifest.operations[FIXTURE_GUEST_IDENTITY_OPERATION]?.detail);
  });

  it("gating the connect operation itself as a guest is permitted — the recovery action exists for the guest", async () => {
    const { session } = await makeGuestSession();
    const gate = await session.gate(FIXTURE_GUEST_PROVIDER_ID, GUEST_CONNECT_OPERATION_ID);
    expect(gate.state).toBe("permitted");
  });

  it("a manifest declaring no connect operation reports connectOperationId null honestly (never a guessed pointer)", () => {
    const manifest: ConnectorManifest = {
      providerId: "fixture-no-connect",
      operations: {
        "identity.me": {
          status: "requires-auth",
          detail:
            "fixture: a per-user identity read on a manifest that declares no connect operation",
        },
      },
      regions: [],
      quotas: { requestsPerWindow: 10, windowMs: 86_400_000 },
      provenance: {
        connectorId: "fixture-no-connect",
        connectorVersion: "1.0.0",
        generatedAt: "2026-10-14T00:00:00Z",
      },
      failureModes: ["network"],
    };
    const gate = deriveGuestOperationGate(
      manifest,
      "identity.me",
      operationOf(manifest, "identity.me"),
      [],
    );
    if (gate.state !== "auth-required") throw new Error("expected the typed refusal");
    expect(gate.connectFlow.connectOperationId).toBeNull();
    expect(gate.connectFlow.connectOperationStatus).toBeNull();
    expect(gate.connectFlow.surface).toBe("settings/accounts");
  });
});

// ---------------------------------------------------------------------------
// 6. Declared-unavailable rows surface the manifest's own state
// ---------------------------------------------------------------------------

describe("declared-unavailable operations surface the manifest's own state", () => {
  it("notifications.list gates as declared-unavailable with the manifest's own unsupported status + detail (never mislabeled auth-required)", async () => {
    const { session } = await makeGuestSession();
    const gate = await session.gate(FIXTURE_GUEST_PROVIDER_ID, FIXTURE_GUEST_UNSUPPORTED_OPERATION);
    const manifest = createFixtureGuestManifest();
    expect(gate).toEqual({
      state: "declared-unavailable",
      providerId: FIXTURE_GUEST_PROVIDER_ID,
      operationId: FIXTURE_GUEST_UNSUPPORTED_OPERATION,
      manifestStatus: "unsupported" satisfies CapabilityStatus,
      detail: manifest.operations[FIXTURE_GUEST_UNSUPPORTED_OPERATION]?.detail,
    });
  });
});

// ---------------------------------------------------------------------------
// 7. Honest derivation over the account-bearing input (read-only)
// ---------------------------------------------------------------------------

describe("honest derivation over the account-bearing input (read-only; WF-010's post-connect vocabulary)", () => {
  it("a connected-status account permits the requires-auth operation (auth: connected-account)", () => {
    const manifest = createFixtureGuestManifest();
    const gate = deriveGuestOperationGate(
      manifest,
      FIXTURE_GUEST_IDENTITY_OPERATION,
      operationOf(manifest, FIXTURE_GUEST_IDENTITY_OPERATION),
      [connectedFixtureGuestAccount()],
    );
    expect(gate).toEqual({
      state: "permitted",
      providerId: FIXTURE_GUEST_PROVIDER_ID,
      operationId: FIXTURE_GUEST_IDENTITY_OPERATION,
      auth: "connected-account",
      detail: manifest.operations[FIXTURE_GUEST_IDENTITY_OPERATION]?.detail,
    });
  });

  it("an expired account does NOT satisfy the requirement — the refusal names the observed status", () => {
    const manifest = createFixtureGuestManifest();
    const gate = deriveGuestOperationGate(
      manifest,
      FIXTURE_GUEST_IDENTITY_OPERATION,
      operationOf(manifest, FIXTURE_GUEST_IDENTITY_OPERATION),
      [expiredFixtureGuestAccount()],
    );
    if (gate.state !== "auth-required") throw new Error("expected the typed refusal");
    expect(gate.reason).toContain("the observed account grants for this provider are expired");
    expect(gate.reason).toContain("none in the connected state");
  });

  it("a revoked account does NOT satisfy the requirement — the refusal names the observed status", () => {
    const manifest = createFixtureGuestManifest();
    const gate = deriveGuestOperationGate(
      manifest,
      FIXTURE_GUEST_IDENTITY_OPERATION,
      operationOf(manifest, FIXTURE_GUEST_IDENTITY_OPERATION),
      [revokedFixtureGuestAccount()],
    );
    if (gate.state !== "auth-required") throw new Error("expected the typed refusal");
    expect(gate.reason).toContain("the observed account grants for this provider are revoked");
  });

  it("the public rows stay permitted whatever the account state (capability truth is the manifest)", () => {
    const manifest = createFixtureGuestManifest();
    const gate = deriveGuestOperationGate(
      manifest,
      FIXTURE_GUEST_BROWSE_OPERATION,
      operationOf(manifest, FIXTURE_GUEST_BROWSE_OPERATION),
      [connectedFixtureGuestAccount(), expiredFixtureGuestAccount()],
    );
    expect(gate).toMatchObject({ state: "permitted", auth: "public" });
  });

  it("the full view echoes the observed account basis verbatim", () => {
    const manifest = createFixtureGuestManifest();
    const accounts = [connectedFixtureGuestAccount()];
    const view = deriveGuestCapabilities([manifest], accounts, "profile-x");
    expect(view.connectedAccounts).toEqual(accounts);
    // the ONE connected account satisfies BOTH requires-auth rows of the
    // provider (a provider-level grant): 4 public + 2 account-satisfied.
    expect(view.counts).toEqual({ permitted: 6, authRequired: 0, declaredUnavailable: 1 });
  });
});

// ---------------------------------------------------------------------------
// 8. Caller defects are typed with the honest recovery hint
// ---------------------------------------------------------------------------

describe("caller defects are typed with the honest recovery hint", () => {
  it("an unknown provider id rejects with invalid-gate-target naming the known provider ids", async () => {
    const { session } = await makeGuestSession();
    let caught: unknown;
    try {
      await session.gate("no-such-provider", FIXTURE_GUEST_BROWSE_OPERATION);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(GuestRuleError);
    expect((caught as GuestRuleError).code).toBe("invalid-gate-target");
    expect((caught as GuestRuleError).message).toContain('unknown provider id "no-such-provider"');
    expect((caught as GuestRuleError).message).toContain(FIXTURE_GUEST_PROVIDER_ID);
  });

  it("an undeclared operation rejects with invalid-gate-target naming the provider's declared operations", async () => {
    const { session } = await makeGuestSession();
    let caught: unknown;
    try {
      await session.gate(FIXTURE_GUEST_PROVIDER_ID, "no.such-operation");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(GuestRuleError);
    expect((caught as GuestRuleError).code).toBe("invalid-gate-target");
    expect((caught as GuestRuleError).message).toContain(
      'declares no operation "no.such-operation"',
    );
    for (const operationId of [
      FIXTURE_GUEST_BROWSE_OPERATION,
      FIXTURE_GUEST_SEARCH_OPERATION,
      FIXTURE_GUEST_IDENTITY_OPERATION,
    ]) {
      expect((caught as GuestRuleError).message).toContain(operationId);
    }
  });

  it("a malformed manifest rejects with invalid-manifest at the derivation boundary", () => {
    const malformed = {
      providerId: "fixture-malformed",
      // operations missing — not a valid frozen §2.3 manifest
      regions: [],
      quotas: { requestsPerWindow: 10, windowMs: 86_400_000 },
      provenance: {
        connectorId: "fixture-malformed",
        connectorVersion: "1.0.0",
        generatedAt: "2026-10-14T00:00:00Z",
      },
      failureModes: [],
    } as unknown as ConnectorManifest;
    let caught: unknown;
    try {
      deriveGuestCapabilities([malformed], [], "profile-x");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(GuestRuleError);
    expect((caught as GuestRuleError).code).toBe("invalid-manifest");
  });
});

// ---------------------------------------------------------------------------
// 9. Per-profile isolation (ADR-0003)
// ---------------------------------------------------------------------------

describe("per-profile isolation (ADR-0003)", () => {
  it("two fresh fixture sets mint two isolated sessions (distinct ids, no shared state)", async () => {
    const setA = createInMemoryGuestFixtureSet();
    const setB = createInMemoryGuestFixtureSet();
    const generateId = makeIdGenerator("guest");
    const factoryA = new GuestSessionFactory({
      accounts: setA.accounts,
      manifests: setA.manifests,
      clock: new FakeClock(),
      generateId,
    });
    const factoryB = new GuestSessionFactory({
      accounts: setB.accounts,
      manifests: setB.manifests,
      clock: new FakeClock(),
      generateId,
    });
    const sessionA = await factoryA.createSession();
    const sessionB = await factoryB.createSession();
    expect(sessionA.profile.profileId).not.toBe(sessionB.profile.profileId);
    await expect(sessionA.connectedAccounts()).resolves.toEqual([]);
    await expect(sessionB.connectedAccounts()).resolves.toEqual([]);
    const viewA = await sessionA.capabilities();
    const viewB = await sessionB.capabilities();
    expect(viewA.connectedAccounts).toEqual([]);
    expect(viewB.connectedAccounts).toEqual([]);
    expect(viewA.operations).toEqual(viewB.operations);
  });
});

// ---------------------------------------------------------------------------
// 10. Fixture contracts (the frozen §2.3 shape + the order's own spec)
// ---------------------------------------------------------------------------

describe("fixture contracts", () => {
  it("the manifest fixture parses against the frozen §2.3 ConnectorManifestSchema", () => {
    const manifest = createFixtureGuestManifest();
    expect(ConnectorManifestSchema.safeParse(manifest).success).toBe(true);
  });

  it("the fixture declares public browse + search + watch available and account actions auth-required (the order's spec)", () => {
    const manifest = createFixtureGuestManifest();
    const statusOf = (operationId: string): CapabilityStatus => {
      const capability = manifest.operations[operationId];
      if (capability === undefined) throw new Error(`missing fixture row ${operationId}`);
      return capability.status;
    };
    expect(statusOf(FIXTURE_GUEST_BROWSE_OPERATION)).toBe("supported");
    expect(statusOf(FIXTURE_GUEST_SEARCH_OPERATION)).toBe("supported");
    expect(statusOf(FIXTURE_GUEST_WATCH_OPERATION)).toBe("supported");
    expect(statusOf(GUEST_CONNECT_OPERATION_ID)).toBe("supported");
    expect(statusOf(FIXTURE_GUEST_IDENTITY_OPERATION)).toBe("requires-auth");
    expect(statusOf(FIXTURE_GUEST_SUBSCRIPTIONS_OPERATION)).toBe("requires-auth");
    expect(statusOf(FIXTURE_GUEST_UNSUPPORTED_OPERATION)).toBe("unsupported");
  });
});
