/**
 * ConnectorManifest registry — the single place the app discovers what each
 * provider can honestly do. Registration validates honesty invariants so a
 * dishonest manifest (e.g. an "unsupported" row that does not explain itself)
 * cannot be registered at all.
 *
 * §2.3 reconciliation (MIRROR-RECON, 2026-10-11): validation is re-expressed
 * against the FROZEN ConnectorManifest
 * ({providerId, operations: Record<OperationId, OperationCapability>, regions,
 * quotas, provenance, failureModes}). The mirror's structural checks that had
 * no frozen home (per-row mechanism/quotaCost/reasonUnsupported, the
 * policy.officialSurfacesOnly pin, displayName/manifestVersion) are retired
 * here — the data survives as connector-local package constants and the gaps
 * are filed as freeze-deviation proposals MR-FD2/MR-FD3 for TL2.
 *
 * Honesty rules enforced on the frozen shapes:
 *  - providerId must be a non-empty string.
 *  - operations must be a non-empty record (a connector that declares nothing
 *    is dishonest by construction).
 *  - every operation status must be a legal frozen CapabilityStatus.
 *  - every "unsupported" row MUST explain itself via OperationCapability.detail
 *    (a bare "unsupported" with no reason invites the UI to guess — the exact
 *    dishonesty this registry exists to prevent).
 */
import type { CapabilityStatus, ConnectorManifest, OperationCapability } from "webflix-contracts";
import { youtubeManifest } from "./youtube/manifest";
import { tiktokManifest } from "./tiktok/manifest";
import { twitchManifest } from "./twitch/manifest";
import { instagramManifest } from "./instagram/manifest";

export class RegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RegistryError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

const LEGAL_STATUSES: readonly CapabilityStatus[] = [
  "supported",
  "requires-auth",
  "unsupported",
  "unavailable",
  "rate-limited",
  "degraded",
  "unknown",
];

/** Structural honesty validation over the frozen §2.3 shapes. */
export function validateManifest(manifest: ConnectorManifest): void {
  const problems: string[] = [];
  if (!manifest || typeof manifest.providerId !== "string" || manifest.providerId.length === 0) {
    problems.push("providerId is required");
  }
  const operations =
    manifest?.operations !== null && typeof manifest?.operations === "object"
      ? manifest.operations
      : undefined;
  if (operations === undefined || Object.keys(operations).length === 0) {
    problems.push("operations must be a non-empty record of OperationId → OperationCapability");
  }
  for (const [operationId, capability] of Object.entries(operations ?? {})) {
    if (!LEGAL_STATUSES.includes(capability?.status)) {
      problems.push(
        `operation "${operationId}" has an unknown CapabilityStatus ("${String(capability?.status)}")`,
      );
    }
    if (capability?.status === "unsupported" && !capability.detail) {
      problems.push(
        `unsupported operation "${operationId}" must explain why it is unsupported (OperationCapability.detail)`,
      );
    }
  }
  if (problems.length > 0) {
    const subject = manifest?.providerId ? ` for "${manifest.providerId}"` : "";
    throw new RegistryError(`invalid connector manifest${subject}: ${problems.join("; ")}`);
  }
}

export class ConnectorRegistry {
  private readonly byProviderId = new Map<string, ConnectorManifest>();

  register(manifest: ConnectorManifest): this {
    validateManifest(manifest);
    if (this.byProviderId.has(manifest.providerId)) {
      throw new RegistryError(
        `connector already registered for providerId "${manifest.providerId}"`,
      );
    }
    this.byProviderId.set(manifest.providerId, manifest);
    return this;
  }

  get(providerId: string): ConnectorManifest | undefined {
    return this.byProviderId.get(providerId);
  }

  require(providerId: string): ConnectorManifest {
    const manifest = this.byProviderId.get(providerId);
    if (!manifest) {
      throw new RegistryError(`no connector registered for providerId "${providerId}"`);
    }
    return manifest;
  }

  has(providerId: string): boolean {
    return this.byProviderId.has(providerId);
  }

  /** Deterministic order (sorted by providerId) so callers can snapshot safely. */
  list(): ConnectorManifest[] {
    return [...this.byProviderId.values()].sort((a, b) =>
      a.providerId < b.providerId ? -1 : a.providerId > b.providerId ? 1 : 0,
    );
  }

  get size(): number {
    return this.byProviderId.size;
  }
}

export function findOperation(
  manifest: ConnectorManifest,
  operationId: string,
): OperationCapability | undefined {
  return Object.entries(manifest.operations).find(([id]) => id === operationId)?.[1];
}

export function requireOperation(
  manifest: ConnectorManifest,
  operationId: string,
): OperationCapability {
  const op = findOperation(manifest, operationId);
  if (!op) {
    throw new RegistryError(
      `manifest for "${manifest.providerId}" has no operation "${operationId}"`,
    );
  }
  return op;
}

export function operationsWithStatus(
  manifest: ConnectorManifest,
  status: CapabilityStatus,
): OperationCapability[] {
  return Object.values(manifest.operations).filter((op) => op.status === status);
}

/** Registry seeded with the official-surface manifests this package ships. */
export function createDefaultRegistry(): ConnectorRegistry {
  return (
    new ConnectorRegistry()
      .register(youtubeManifest)
      .register(tiktokManifest)
      // TWITCH-CONNECT: the third platform on the same frozen contracts.
      .register(twitchManifest)
      // INSTAGRAM-CONNECT: the fourth platform, honesty-forward by design
      // (professional-account reads + the honest-unsupported totality for
      // every discovery surface the platform does not offer officially).
      .register(instagramManifest)
  );
}
