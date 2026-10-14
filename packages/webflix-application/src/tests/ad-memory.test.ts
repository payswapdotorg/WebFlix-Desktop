/**
 * P7-AD-MEMORY-1 tests — WF-029 explicit opt-in ad personal memory.
 *
 * FIXTURE-ONLY / HERMETIC: every port is backed by the lane's own
 * in-memory doubles (in-memory-ad-memory-stores.ts) with an injected fake
 * clock and a deterministic id generator — no filesystem, no network, no
 * database, no wall clock, no timers, no provider calls, no Ad Center
 * store access anywhere. The tests prove the STATED CONTRACTS ONLY:
 *
 *   1. consent gating — every write refuses without the scope grant,
 *      with the typed reason (data, never thrown), and one scope's grant
 *      never implies another's;
 *   2. save/forget semantics — put-replaces per ad, honest-absent notes,
 *      forget removes exactly one save, honest `absent` when nothing was
 *      saved;
 *   3. revocation mid-flight — subsequent writes refuse with
 *      ads-memory/scope-revoked carrying the revoked record as evidence;
 *      re-grant re-opens the scope with the prior memory intact;
 *   4. observation provenance labeling — user-stated is pinned as the
 *      ONLY provenance value and is never conflated with source-backed
 *      evidence (no source/import fields exist on the shape at all);
 *   5. no cross-source linking — memory entries never auto-join across
 *      sources: the listing is flat, byte-equal to the stored records,
 *      with no linkage/grouping/enrichment fields;
 *   6. per-profile isolation (ADR-0003) — one store set per profile,
 *      nothing crosses.
 */
import { describe, expect, it } from "vitest";
import {
  AdMemoryConsentSchema,
  AdMemoryRefusalSchema,
  UserObservationSchema,
} from "webflix-contracts";
import type { UserObservation } from "webflix-contracts";
import type { ClockPort } from "../ports";
import type { IdGenerator } from "../ports";
import {
  ForgetAd,
  GrantAdMemoryConsent,
  ListMemory,
  RecordObservation,
  RevokeAdMemoryConsent,
  SaveAd,
} from "../ad-memory";
import {
  InMemoryAdMemoryConsentStore,
  InMemorySavedAdStore,
  InMemoryUserObservationStore,
  createInMemoryAdMemoryStores,
} from "../in-memory-ad-memory-stores";

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

  advanceMs(ms: number): void {
    this.instant = new Date(this.instant.getTime() + ms);
  }
}

/** Deterministic id generator: `save-1`, `save-2`, ... per prefix. */
function makeIdGenerator(prefix: string): IdGenerator {
  let counter = 0;
  return () => `${prefix}-${(counter += 1)}`;
}

function makeLane() {
  const stores = createInMemoryAdMemoryStores();
  const clock = new FakeClock();
  const grant = new GrantAdMemoryConsent({ consent: stores.consent, clock });
  const revoke = new RevokeAdMemoryConsent({ consent: stores.consent, clock });
  const save = new SaveAd({
    consent: stores.consent,
    savedAds: stores.savedAds,
    clock,
    generateId: makeIdGenerator("save"),
  });
  const forget = new ForgetAd({ consent: stores.consent, savedAds: stores.savedAds });
  const record = new RecordObservation({
    consent: stores.consent,
    observations: stores.observations,
    clock,
    generateId: makeIdGenerator("obs"),
  });
  const list = new ListMemory({
    consent: stores.consent,
    savedAds: stores.savedAds,
    observations: stores.observations,
  });
  return { stores, clock, grant, revoke, save, forget, record, list };
}

/**
 * Two ad-record ids representing the no-dedup reality: the SAME underlying
 * ad reported by two different sources (a Meta Ad Library import and the
 * user's own import) is TWO records with TWO ids — the memory lane never
 * merges them and never auto-joins what it holds about them.
 */
const AD_FROM_SOURCE_A = "ad-record-meta-001";
const AD_FROM_SOURCE_B = "ad-record-user-import-001";

// ---------------------------------------------------------------------------
// 1. Consent gating — every write refuses without the scope grant
// ---------------------------------------------------------------------------

describe("consent gating (no grant = typed refusal, nothing written)", () => {
  it("saveAd without the saved-ads grant refuses with ads-memory/consent-required and writes nothing", async () => {
    const lane = makeLane();
    const result = await lane.save.save({ adRecordId: AD_FROM_SOURCE_A, note: "check later" });
    expect(result).toEqual({
      outcome: "refused",
      refusal: { reason: "ads-memory/consent-required", scope: "saved-ads" },
    });
    await expect(lane.stores.savedAds.list()).resolves.toEqual([]);
  });

  it("recordObservation without the observations grant refuses with ads-memory/consent-required and writes nothing", async () => {
    const lane = makeLane();
    const result = await lane.record.record({ adRecordId: AD_FROM_SOURCE_A, note: "seen on TV" });
    expect(result).toEqual({
      outcome: "refused",
      refusal: { reason: "ads-memory/consent-required", scope: "observations" },
    });
    await expect(lane.stores.observations.list()).resolves.toEqual([]);
  });

  it("forgetAd without the saved-ads grant refuses with the typed reason (each operation is gated)", async () => {
    const lane = makeLane();
    const result = await lane.forget.forget({ adRecordId: AD_FROM_SOURCE_A });
    expect(result).toEqual({
      outcome: "refused",
      refusal: { reason: "ads-memory/consent-required", scope: "saved-ads" },
    });
  });

  it("listMemory with no consent at all lists nothing and carries BOTH typed refusals (never-hide)", async () => {
    const lane = makeLane();
    const result = await lane.list.list();
    expect(result.entries).toEqual([]);
    expect(result.refusals).toEqual([
      { reason: "ads-memory/consent-required", scope: "saved-ads" },
      { reason: "ads-memory/consent-required", scope: "observations" },
    ]);
  });

  it("a grant for saved-ads NEVER implies the observations grant (independent scopes)", async () => {
    const lane = makeLane();
    await lane.grant.grant({ scope: "saved-ads" });

    const saved = await lane.save.save({ adRecordId: AD_FROM_SOURCE_A });
    expect(saved.outcome).toBe("saved");

    const observed = await lane.record.record({ adRecordId: AD_FROM_SOURCE_A, note: "saw this" });
    expect(observed).toEqual({
      outcome: "refused",
      refusal: { reason: "ads-memory/consent-required", scope: "observations" },
    });

    const listing = await lane.list.list();
    expect(listing.entries).toHaveLength(1);
    expect(listing.refusals).toEqual([
      { reason: "ads-memory/consent-required", scope: "observations" },
    ]);
  });

  it("a grant for observations NEVER implies the saved-ads grant (symmetric)", async () => {
    const lane = makeLane();
    await lane.grant.grant({ scope: "observations" });

    const observed = await lane.record.record({ adRecordId: AD_FROM_SOURCE_A, note: "saw this" });
    expect(observed.outcome).toBe("recorded");

    const saved = await lane.save.save({ adRecordId: AD_FROM_SOURCE_A });
    expect(saved).toEqual({
      outcome: "refused",
      refusal: { reason: "ads-memory/consent-required", scope: "saved-ads" },
    });
  });

  it("the refusals are data, never thrown: every refusal answers resolve, not reject", async () => {
    const lane = makeLane();
    await expect(lane.save.save({ adRecordId: AD_FROM_SOURCE_A })).resolves.toMatchObject({
      outcome: "refused",
    });
    await expect(
      lane.record.record({ adRecordId: AD_FROM_SOURCE_A, note: "n" }),
    ).resolves.toMatchObject({ outcome: "refused" });
    await expect(lane.forget.forget({ adRecordId: AD_FROM_SOURCE_A })).resolves.toMatchObject({
      outcome: "refused",
    });
    await expect(lane.list.list()).resolves.toMatchObject({ entries: [], refusals: [{}, {}] });
  });

  it("grant stamps the injected clock's instant (never a wall clock, never inferred)", async () => {
    const lane = makeLane();
    lane.clock.advanceMs(90_000);
    const consent = await lane.grant.grant({ scope: "saved-ads" });
    expect(consent).toEqual({
      scope: "saved-ads",
      grantedAt: "2026-10-14T00:01:30.000Z",
    });
  });
});

// ---------------------------------------------------------------------------
// 2. Save / forget semantics
// ---------------------------------------------------------------------------

describe("save/forget semantics (put-replaces per ad, honest absent outcomes)", () => {
  it("saving with a note stores the entry with the minted id, the user's note verbatim, and the clock's instant", async () => {
    const lane = makeLane();
    await lane.grant.grant({ scope: "saved-ads" });
    lane.clock.advanceMs(1_000);

    const result = await lane.save.save({ adRecordId: AD_FROM_SOURCE_A, note: "my own note" });
    expect(result).toEqual({
      outcome: "saved",
      record: {
        kind: "saved-ad",
        id: "save-1",
        adRecordId: AD_FROM_SOURCE_A,
        note: "my own note",
        savedAt: "2026-10-14T00:00:01.000Z",
      },
    });
  });

  it("saving without a note stores an honest-absent note (the key is absent, never a placeholder)", async () => {
    const lane = makeLane();
    await lane.grant.grant({ scope: "saved-ads" });
    const result = await lane.save.save({ adRecordId: AD_FROM_SOURCE_A });
    expect(result.outcome).toBe("saved");
    if (result.outcome === "saved") {
      expect("note" in result.record).toBe(false);
      expect(result.record.note).toBeUndefined();
    }
  });

  it("re-saving the same ad replaces the save (fresh note + fresh instant, one entry, position kept)", async () => {
    const lane = makeLane();
    await lane.grant.grant({ scope: "saved-ads" });
    await lane.save.save({ adRecordId: AD_FROM_SOURCE_A, note: "first" });
    await lane.save.save({ adRecordId: AD_FROM_SOURCE_B, note: "other ad" });
    lane.clock.advanceMs(5_000);

    const again = await lane.save.save({ adRecordId: AD_FROM_SOURCE_A, note: "second" });
    expect(again.outcome).toBe("saved");
    if (again.outcome === "saved") {
      expect(again.record.note).toBe("second");
      expect(again.record.savedAt).toBe("2026-10-14T00:00:05.000Z");
    }
    const listing = await lane.list.list();
    expect(listing.entries).toEqual([
      again.outcome === "saved" ? again.record : undefined,
      expect.objectContaining({ kind: "saved-ad", adRecordId: AD_FROM_SOURCE_B, note: "other ad" }),
    ]);
  });

  it("forgetting a saved ad removes exactly that save and leaves every other memory byte-identical", async () => {
    const lane = makeLane();
    await lane.grant.grant({ scope: "saved-ads" });
    await lane.grant.grant({ scope: "observations" });
    await lane.save.save({ adRecordId: AD_FROM_SOURCE_A, note: "mine" });
    await lane.save.save({ adRecordId: AD_FROM_SOURCE_B });
    await lane.record.record({ adRecordId: AD_FROM_SOURCE_B, note: "saw twice" });

    const forgotten = await lane.forget.forget({ adRecordId: AD_FROM_SOURCE_A });
    expect(forgotten).toEqual({ outcome: "forgotten", adRecordId: AD_FROM_SOURCE_A });

    const listing = await lane.list.list();
    expect(listing.entries.map((entry) => entry.kind)).toEqual(["saved-ad", "user-observation"]);
    expect(listing.entries[0]).toEqual(
      expect.objectContaining({ kind: "saved-ad", adRecordId: AD_FROM_SOURCE_B }),
    );
    // The observation is untouched — a forget never cascades.
    expect(listing.entries[1]).toEqual(
      expect.objectContaining({ kind: "user-observation", adRecordId: AD_FROM_SOURCE_B }),
    );
  });

  it("forgetting an ad that was never saved answers the honest typed absent outcome (no error, no pretend-success)", async () => {
    const lane = makeLane();
    await lane.grant.grant({ scope: "saved-ads" });
    await expect(lane.forget.forget({ adRecordId: "ad-record-never-saved" })).resolves.toEqual({
      outcome: "absent",
    });
  });

  it("forgetting twice: the second forget answers absent (idempotent honest state)", async () => {
    const lane = makeLane();
    await lane.grant.grant({ scope: "saved-ads" });
    await lane.save.save({ adRecordId: AD_FROM_SOURCE_A });
    await expect(lane.forget.forget({ adRecordId: AD_FROM_SOURCE_A })).resolves.toEqual({
      outcome: "forgotten",
      adRecordId: AD_FROM_SOURCE_A,
    });
    await expect(lane.forget.forget({ adRecordId: AD_FROM_SOURCE_A })).resolves.toEqual({
      outcome: "absent",
    });
  });

  it("saving again after a forget mints a fresh entry (memory is re-creatable through explicit action)", async () => {
    const lane = makeLane();
    await lane.grant.grant({ scope: "saved-ads" });
    const first = await lane.save.save({ adRecordId: AD_FROM_SOURCE_A, note: "one" });
    await lane.forget.forget({ adRecordId: AD_FROM_SOURCE_A });
    const second = await lane.save.save({ adRecordId: AD_FROM_SOURCE_A, note: "two" });
    expect(second.outcome).toBe("saved");
    if (first.outcome === "saved" && second.outcome === "saved") {
      expect(second.record.id).not.toBe(first.record.id);
    }
    const listing = await lane.list.list();
    expect(listing.entries).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 3. Revocation mid-flight — subsequent writes refuse with the evidence
// ---------------------------------------------------------------------------

describe("revocation mid-flight (scope closed by data, evidence carried)", () => {
  it("revoking saved-ads refuses subsequent saves AND forgets with ads-memory/scope-revoked + the revoked record", async () => {
    const lane = makeLane();
    await lane.grant.grant({ scope: "saved-ads" });
    await lane.save.save({ adRecordId: AD_FROM_SOURCE_A, note: "saved before revocation" });
    lane.clock.advanceMs(60_000);
    const revoked = await lane.revoke.revoke({ scope: "saved-ads" });
    expect(revoked).toEqual({
      outcome: "revoked",
      consent: {
        scope: "saved-ads",
        grantedAt: "2026-10-14T00:00:00.000Z",
        revokedAt: "2026-10-14T00:01:00.000Z",
      },
    });

    const refusedSave = await lane.save.save({ adRecordId: AD_FROM_SOURCE_B });
    expect(refusedSave).toEqual({
      outcome: "refused",
      refusal: {
        reason: "ads-memory/scope-revoked",
        scope: "saved-ads",
        consent: {
          scope: "saved-ads",
          grantedAt: "2026-10-14T00:00:00.000Z",
          revokedAt: "2026-10-14T00:01:00.000Z",
        },
      },
    });
    const refusedForget = await lane.forget.forget({ adRecordId: AD_FROM_SOURCE_A });
    expect(refusedForget.outcome).toBe("refused");
    expect(refusedForget).toMatchObject({
      refusal: { reason: "ads-memory/scope-revoked", scope: "saved-ads" },
    });
  });

  it("revoking observations refuses subsequent recordObservation calls mid-flight", async () => {
    const lane = makeLane();
    await lane.grant.grant({ scope: "observations" });
    await lane.record.record({ adRecordId: AD_FROM_SOURCE_A, note: "before revocation" });
    lane.clock.advanceMs(30_000);
    await lane.revoke.revoke({ scope: "observations" });

    const refused = await lane.record.record({ adRecordId: AD_FROM_SOURCE_B, note: "after" });
    expect(refused).toEqual({
      outcome: "refused",
      refusal: {
        reason: "ads-memory/scope-revoked",
        scope: "observations",
        consent: {
          scope: "observations",
          grantedAt: "2026-10-14T00:00:00.000Z",
          revokedAt: "2026-10-14T00:00:30.000Z",
        },
      },
    });
    await expect(lane.stores.observations.list()).resolves.toHaveLength(1);
  });

  it("a revoked scope lists as a refusal row, never as silent emptiness (never-hide)", async () => {
    const lane = makeLane();
    await lane.grant.grant({ scope: "saved-ads" });
    await lane.grant.grant({ scope: "observations" });
    await lane.save.save({ adRecordId: AD_FROM_SOURCE_A });
    await lane.record.record({ adRecordId: AD_FROM_SOURCE_A, note: "observed" });
    await lane.revoke.revoke({ scope: "saved-ads" });

    const listing = await lane.list.list();
    expect(listing.entries.map((entry) => entry.kind)).toEqual(["user-observation"]);
    expect(listing.refusals).toEqual([
      {
        reason: "ads-memory/scope-revoked",
        scope: "saved-ads",
        consent: expect.objectContaining({ scope: "saved-ads", revokedAt: expect.any(String) }),
      },
    ]);
  });

  it("the memory saved BEFORE a revocation is still there after re-granting (deletion is forget's path, never a revocation side effect)", async () => {
    const lane = makeLane();
    await lane.grant.grant({ scope: "saved-ads" });
    await lane.save.save({ adRecordId: AD_FROM_SOURCE_A, note: "survives the closure" });
    await lane.revoke.revoke({ scope: "saved-ads" });
    lane.clock.advanceMs(120_000);

    const regranted = await lane.grant.grant({ scope: "saved-ads" });
    expect(regranted).toEqual({ scope: "saved-ads", grantedAt: "2026-10-14T00:02:00.000Z" });

    const listing = await lane.list.list();
    expect(listing.entries).toEqual([
      expect.objectContaining({ kind: "saved-ad", note: "survives the closure" }),
    ]);
    expect(listing.refusals).toEqual([
      { reason: "ads-memory/consent-required", scope: "observations" },
    ]);
  });

  it("revoking a never-granted scope answers the honest typed never-granted outcome and writes nothing", async () => {
    const lane = makeLane();
    const result = await lane.revoke.revoke({ scope: "saved-ads" });
    expect(result).toEqual({ outcome: "never-granted" });
    await expect(lane.stores.consent.get("saved-ads")).resolves.toBeNull();
  });

  it("re-revoking an already-revoked scope re-stamps the revocation instant (idempotent effect, refreshed time)", async () => {
    const lane = makeLane();
    await lane.grant.grant({ scope: "saved-ads" });
    lane.clock.advanceMs(60_000);
    await lane.revoke.revoke({ scope: "saved-ads" });
    lane.clock.advanceMs(60_000);
    const again = await lane.revoke.revoke({ scope: "saved-ads" });
    expect(again).toEqual({
      outcome: "revoked",
      consent: {
        scope: "saved-ads",
        grantedAt: "2026-10-14T00:00:00.000Z",
        revokedAt: "2026-10-14T00:02:00.000Z",
      },
    });
  });
});

// ---------------------------------------------------------------------------
// 4. Observation provenance labeling (user-stated, never source-backed)
// ---------------------------------------------------------------------------

describe("observation provenance labeling (user-stated is never conflated with source-backed evidence)", () => {
  it('every recorded observation carries provenance exactly "user-stated"', async () => {
    const lane = makeLane();
    await lane.grant.grant({ scope: "observations" });
    const result = await lane.record.record({ adRecordId: AD_FROM_SOURCE_A, note: "their words" });
    expect(result.outcome).toBe("recorded");
    if (result.outcome === "recorded") {
      expect(result.observation.provenance).toBe("user-stated");
    }
    const observations = await lane.stores.observations.list();
    expect(observations.map((observation) => observation.provenance)).toEqual(["user-stated"]);
  });

  it("the provenance literal is CLOSED: a source-reported provenance cannot parse as a UserObservation", () => {
    const attempt = {
      kind: "user-observation",
      id: "obs-x",
      adRecordId: AD_FROM_SOURCE_A,
      note: "the user stated this",
      provenance: "source-reported",
      recordedAt: "2026-10-14T00:00:00.000Z",
    };
    expect(UserObservationSchema.safeParse(attempt).success).toBe(false);
  });

  it("the observation shape carries NO source/import fields at all — there is nothing to conflate with", async () => {
    const lane = makeLane();
    await lane.grant.grant({ scope: "observations" });
    const result = await lane.record.record({
      adRecordId: AD_FROM_SOURCE_A,
      claimId: "claim-7",
      note: "attached explicitly",
    });
    expect(result.outcome).toBe("recorded");
    if (result.outcome === "recorded") {
      expect(Object.keys(result.observation).sort()).toEqual([
        "adRecordId",
        "claimId",
        "id",
        "kind",
        "note",
        "provenance",
        "recordedAt",
      ]);
    }
  });

  it("a claim attachment is the ONLY linkage an entry can carry — absent when the user did not choose one", async () => {
    const lane = makeLane();
    await lane.grant.grant({ scope: "observations" });
    const attached = await lane.record.record({
      adRecordId: AD_FROM_SOURCE_A,
      claimId: "claim-7",
      note: "about that claim",
    });
    const unattached = await lane.record.record({
      adRecordId: AD_FROM_SOURCE_A,
      note: "about the ad itself",
    });
    expect(attached.outcome).toBe("recorded");
    expect(unattached.outcome).toBe("recorded");
    if (attached.outcome === "recorded" && unattached.outcome === "recorded") {
      expect(attached.observation.claimId).toBe("claim-7");
      expect("claimId" in unattached.observation).toBe(false);
    }
  });

  it("two record actions are two distinct observations — the lane never deduplicates the user's own words", async () => {
    const lane = makeLane();
    await lane.grant.grant({ scope: "observations" });
    lane.clock.advanceMs(1_000);
    await lane.record.record({ adRecordId: AD_FROM_SOURCE_A, note: "seen once" });
    lane.clock.advanceMs(1_000);
    await lane.record.record({ adRecordId: AD_FROM_SOURCE_A, note: "seen twice" });
    const observations = await lane.stores.observations.list();
    expect(observations).toHaveLength(2);
    expect(observations.map((observation) => observation.recordedAt)).toEqual([
      "2026-10-14T00:00:01.000Z",
      "2026-10-14T00:00:02.000Z",
    ]);
    expect(new Set(observations.map((observation) => observation.id)).size).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 5. No cross-source linking (memory entries never auto-join)
// ---------------------------------------------------------------------------

describe("no cross-source linking (entries never auto-join across sources)", () => {
  it("the listing is FLAT and byte-equal to the stored records: no grouping, no enrichment, no linkage fields", async () => {
    const lane = makeLane();
    await lane.grant.grant({ scope: "saved-ads" });
    await lane.grant.grant({ scope: "observations" });
    const savedA = await lane.save.save({ adRecordId: AD_FROM_SOURCE_A, note: "from source A" });
    const savedB = await lane.save.save({ adRecordId: AD_FROM_SOURCE_B });
    const observedA = await lane.record.record({
      adRecordId: AD_FROM_SOURCE_A,
      note: "user says A",
    });
    const observedB = await lane.record.record({
      adRecordId: AD_FROM_SOURCE_B,
      claimId: "claim-9",
      note: "user says B",
    });

    const listing = await lane.list.list();
    expect(listing.refusals).toEqual([]);
    expect(listing.entries).toEqual([
      savedA.outcome === "saved" ? savedA.record : undefined,
      savedB.outcome === "saved" ? savedB.record : undefined,
      observedA.outcome === "recorded" ? observedA.observation : undefined,
      observedB.outcome === "recorded" ? observedB.observation : undefined,
    ]);
    // Saved ads first, then observations — deterministic, never interleaved
    // by any join the lane might have invented.
    expect(listing.entries.map((entry) => entry.kind)).toEqual([
      "saved-ad",
      "saved-ad",
      "user-observation",
      "user-observation",
    ]);
  });

  it("two records of the SAME underlying ad from two sources stay fully independent in memory (no merge by sourceAdId/advertiser)", async () => {
    const lane = makeLane();
    await lane.grant.grant({ scope: "saved-ads" });
    await lane.save.save({ adRecordId: AD_FROM_SOURCE_A, note: "the meta import" });
    await lane.save.save({ adRecordId: AD_FROM_SOURCE_B, note: "my own import of the same ad" });

    const listing = await lane.list.list();
    expect(listing.entries).toHaveLength(2);
    for (const entry of listing.entries) {
      expect(entry.kind).toBe("saved-ad");
      if (entry.kind === "saved-ad") {
        // Each save references exactly ONE record id — the user's explicit
        // choice — and nothing that ties the two saves together.
        expect([AD_FROM_SOURCE_A, AD_FROM_SOURCE_B]).toContain(entry.adRecordId);
        expect(Object.keys(entry).sort()).toEqual(["adRecordId", "id", "kind", "note", "savedAt"]);
      }
    }
  });

  it("nothing in the memory lane resolves or joins the ad-record references (dangling references stay stored)", async () => {
    const lane = makeLane();
    await lane.grant.grant({ scope: "saved-ads" });
    // No AdRecord store exists in this lane at all — a save of an id that
    // was never imported is honest data, stored as the user's memory.
    const result = await lane.save.save({ adRecordId: "ad-record-never-imported" });
    expect(result.outcome).toBe("saved");
    const listing = await lane.list.list();
    expect(listing.entries).toEqual([
      expect.objectContaining({ kind: "saved-ad", adRecordId: "ad-record-never-imported" }),
    ]);
  });
});

// ---------------------------------------------------------------------------
// 6. Per-profile isolation (ADR-0003)
// ---------------------------------------------------------------------------

describe("per-profile isolation (ADR-0003 — no cross-profile data ever)", () => {
  it("one profile's grants and memory are invisible to a fresh profile's stores", async () => {
    const profileA = makeLane();
    const profileB = makeLane();

    await profileA.grant.grant({ scope: "saved-ads" });
    await profileA.grant.grant({ scope: "observations" });
    await profileA.save.save({ adRecordId: AD_FROM_SOURCE_A, note: "profile A memory" });
    await profileA.record.record({ adRecordId: AD_FROM_SOURCE_A, note: "profile A observation" });

    // Profile B: fresh stores — no consent, no entries, both refusals.
    await expect(profileB.stores.consent.get("saved-ads")).resolves.toBeNull();
    await expect(profileB.stores.consent.get("observations")).resolves.toBeNull();
    const listingB = await profileB.list.list();
    expect(listingB.entries).toEqual([]);
    expect(listingB.refusals).toEqual([
      { reason: "ads-memory/consent-required", scope: "saved-ads" },
      { reason: "ads-memory/consent-required", scope: "observations" },
    ]);

    // Profile B writes refuse (its own consent is absent) and never land
    // anywhere in profile A.
    const refused = await profileB.save.save({ adRecordId: AD_FROM_SOURCE_A });
    expect(refused.outcome).toBe("refused");
    const listingA = await profileA.list.list();
    expect(listingA.entries).toHaveLength(2);
    expect(listingA.refusals).toEqual([]);
  });

  it("two profiles grant different scopes independently — a grant in one is not a grant in the other", async () => {
    const profileA = makeLane();
    const profileB = makeLane();
    await profileA.grant.grant({ scope: "observations" });

    const inA = await profileA.record.record({ adRecordId: AD_FROM_SOURCE_A, note: "mine" });
    expect(inA.outcome).toBe("recorded");
    const inB = await profileB.record.record({ adRecordId: AD_FROM_SOURCE_A, note: "theirs?" });
    expect(inB).toEqual({
      outcome: "refused",
      refusal: { reason: "ads-memory/consent-required", scope: "observations" },
    });
    await expect(profileA.stores.observations.list()).resolves.toHaveLength(1);
    await expect(profileB.stores.observations.list()).resolves.toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// In-memory double contracts (fixture discipline)
// ---------------------------------------------------------------------------

describe("in-memory ad-memory store contracts", () => {
  it("the consent store validates on put (typed AdMemoryRuleError, nothing stored)", async () => {
    const consent = new InMemoryAdMemoryConsentStore();
    const badScope = {
      scope: "telemetry",
      grantedAt: "2026-10-14T00:00:00.000Z",
    } as never;
    await expect(consent.put(badScope)).rejects.toMatchObject({
      name: "AdMemoryRuleError",
      code: "invalid-consent",
    });
    const revokedBeforeGrant = {
      scope: "saved-ads" as const,
      grantedAt: "2026-10-14T01:00:00.000Z",
      revokedAt: "2026-10-14T00:00:00.000Z",
    };
    await expect(consent.put(revokedBeforeGrant)).rejects.toMatchObject({
      code: "invalid-consent",
    });
    await expect(consent.list()).resolves.toEqual([]);
  });

  it("the consent store lists in the closed scope-union order, regardless of write order", async () => {
    const consent = new InMemoryAdMemoryConsentStore();
    await consent.put({ scope: "observations", grantedAt: "2026-10-14T00:00:00.000Z" });
    await consent.put({ scope: "saved-ads", grantedAt: "2026-10-14T00:00:01.000Z" });
    await expect(consent.list()).resolves.toEqual([
      { scope: "saved-ads", grantedAt: "2026-10-14T00:00:01.000Z" },
      { scope: "observations", grantedAt: "2026-10-14T00:00:00.000Z" },
    ]);
  });

  it("the saved-ad store validates on put and answers null for the never-saved state", async () => {
    const savedAds = new InMemorySavedAdStore();
    const bad = {
      kind: "saved-ad" as const,
      id: "",
      adRecordId: "ad-1",
      savedAt: "2026-10-14T00:00:00.000Z",
    };
    await expect(savedAds.put(bad)).rejects.toMatchObject({
      name: "AdMemoryRuleError",
      code: "invalid-saved-ad",
    });
    await expect(savedAds.get("ad-1")).resolves.toBeNull();
    await expect(savedAds.list()).resolves.toEqual([]);
  });

  it("the observation store validates on append and is idempotent by id (duplicate returns the STORED one)", async () => {
    const observations = new InMemoryUserObservationStore();
    const valid: UserObservation = {
      kind: "user-observation",
      id: "obs-1",
      adRecordId: "ad-1",
      note: "the user's words",
      provenance: "user-stated",
      recordedAt: "2026-10-14T00:00:00.000Z",
    };
    const appended = await observations.append(valid);
    expect(appended).toEqual({ outcome: "appended", observation: valid });
    const mutatedRetry = { ...valid, note: "a DIFFERENT note for the same id" };
    const duplicate = await observations.append(mutatedRetry);
    expect(duplicate).toEqual({ outcome: "duplicate", existing: valid });
    await expect(observations.list()).resolves.toEqual([valid]);

    const bad = { ...valid, id: "obs-2", note: "" };
    await expect(observations.append(bad)).rejects.toMatchObject({
      name: "AdMemoryRuleError",
      code: "invalid-observation",
    });
    await expect(observations.list()).resolves.toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Contract schema pins (the 0.13.0 shapes' own honesty rules)
// ---------------------------------------------------------------------------

describe("ads-memory contract schema pins (0.13.0)", () => {
  it("AdMemoryConsentSchema rejects a revocation that precedes its grant", () => {
    expect(
      AdMemoryConsentSchema.safeParse({
        scope: "saved-ads",
        grantedAt: "2026-10-14T01:00:00.000Z",
        revokedAt: "2026-10-14T00:00:00.000Z",
      }).success,
    ).toBe(false);
    expect(
      AdMemoryConsentSchema.safeParse({
        scope: "saved-ads",
        grantedAt: "2026-10-14T00:00:00.000Z",
        revokedAt: "2026-10-14T01:00:00.000Z",
      }).success,
    ).toBe(true);
    expect(
      AdMemoryConsentSchema.safeParse({ scope: "saved-ads", grantedAt: "2026-10-14T00:00:00.000Z" })
        .success,
    ).toBe(true);
  });

  it("a consent-required refusal parses; a scope-revoked refusal REQUIRES an actually-revoked consent for the SAME scope", () => {
    expect(
      AdMemoryRefusalSchema.safeParse({
        reason: "ads-memory/consent-required",
        scope: "observations",
      }).success,
    ).toBe(true);

    // Unrevoked consent as evidence: invalid.
    expect(
      AdMemoryRefusalSchema.safeParse({
        reason: "ads-memory/scope-revoked",
        scope: "observations",
        consent: { scope: "observations", grantedAt: "2026-10-14T00:00:00.000Z" },
      }).success,
    ).toBe(false);

    // Revoked consent for a DIFFERENT scope: invalid.
    expect(
      AdMemoryRefusalSchema.safeParse({
        reason: "ads-memory/scope-revoked",
        scope: "observations",
        consent: {
          scope: "saved-ads",
          grantedAt: "2026-10-14T00:00:00.000Z",
          revokedAt: "2026-10-14T01:00:00.000Z",
        },
      }).success,
    ).toBe(false);

    // Revoked consent for the same scope: valid.
    expect(
      AdMemoryRefusalSchema.safeParse({
        reason: "ads-memory/scope-revoked",
        scope: "observations",
        consent: {
          scope: "observations",
          grantedAt: "2026-10-14T00:00:00.000Z",
          revokedAt: "2026-10-14T01:00:00.000Z",
        },
      }).success,
    ).toBe(true);
  });

  it("an unknown scope smuggled past the types is a typed caller defect on the consent use cases", async () => {
    const lane = makeLane();
    await expect(lane.grant.grant({ scope: "telemetry" as never })).rejects.toMatchObject({
      name: "AdMemoryRuleError",
      code: "invalid-scope",
    });
    await expect(lane.revoke.revoke({ scope: "everything" as never })).rejects.toMatchObject({
      name: "AdMemoryRuleError",
      code: "invalid-scope",
    });
    await expect(lane.stores.consent.list()).resolves.toEqual([]);
  });
});
