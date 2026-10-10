/**
 * ConnectorManifest registry — the single place the app discovers what each
 * provider can honestly do. Registration validates honesty invariants so a
 * dishonest manifest (e.g. an "unsupported" row with a quota cost, or a
 * "supported" row with no official mechanism) cannot be registered at all.
 */
import type {
  CapabilityStatus,
  ConnectorManifest,
  OperationCapability,
} from 'webflix-contracts';
import { youtubeManifest } from './youtube/manifest';

export class RegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RegistryError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Structural honesty validation. Rules:
 *  - ADR-0003 policy must be pinned (officialSurfacesOnly === true).
 *  - Every row needs operationId, a legal CapabilityStatus, and ≥1 provenance url.
 *  - quotaCost must be a non-negative integer.
 *  - unsupported rows: mechanism === null, quotaCost === 0, reason present.
 *  - supported-official rows: mechanism present, quotaCost > 0.
 */
export function validateManifest(manifest: ConnectorManifest): void {
  const problems: string[] = [];
  if (!manifest || typeof manifest.providerId !== 'string' || manifest.providerId.length === 0) {
    problems.push('providerId is required');
  }
  if (!manifest?.displayName) problems.push('displayName is required');
  if (!manifest?.manifestVersion) problems.push('manifestVersion is required');
  if (manifest?.policy?.officialSurfacesOnly !== true) {
    problems.push('policy.officialSurfacesOnly must be true (ADR-0003)');
  }
  if (!Array.isArray(manifest?.operations) || manifest.operations.length === 0) {
    problems.push('operations must be a non-empty array');
  }
  for (const op of manifest?.operations ?? []) {
    if (!op.operationId) problems.push('operation is missing operationId');
    if (!Array.isArray(op.provenance) || op.provenance.length === 0 || op.provenance.some((c) => !c || !c.url)) {
      problems.push(`operation "${op.operationId}" must cite at least one provenance source with a url`);
    }
    if (typeof op.quotaCost !== 'number' || !Number.isInteger(op.quotaCost) || op.quotaCost < 0) {
      problems.push(`operation "${op.operationId}" quotaCost must be a non-negative integer`);
    }
    if (op.status === 'unsupported') {
      if (op.mechanism) problems.push(`unsupported operation "${op.operationId}" must not declare a mechanism`);
      if (op.quotaCost !== 0) problems.push(`unsupported operation "${op.operationId}" must have quotaCost 0`);
      if (!op.reasonUnsupported) {
        problems.push(`unsupported operation "${op.operationId}" must explain why it is unsupported`);
      }
    } else if (op.status === 'supported-official') {
      if (!op.mechanism) {
        problems.push(`supported-official operation "${op.operationId}" must name its official mechanism`);
      }
      if (op.quotaCost <= 0) {
        problems.push(`supported-official operation "${op.operationId}" must declare a positive quotaCost`);
      }
    } else {
      problems.push(`operation "${op.operationId}" has an unknown CapabilityStatus`);
    }
  }
  if (problems.length > 0) {
    const subject = manifest?.providerId ? ` for "${manifest.providerId}"` : '';
    throw new RegistryError(`invalid connector manifest${subject}: ${problems.join('; ')}`);
  }
}

export class ConnectorRegistry {
  private readonly byProviderId = new Map<string, ConnectorManifest>();

  register(manifest: ConnectorManifest): this {
    validateManifest(manifest);
    if (this.byProviderId.has(manifest.providerId)) {
      throw new RegistryError(`connector already registered for providerId "${manifest.providerId}"`);
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

export function findOperation(manifest: ConnectorManifest, operationId: string): OperationCapability | undefined {
  return manifest.operations.find((op) => op.operationId === operationId);
}

export function requireOperation(manifest: ConnectorManifest, operationId: string): OperationCapability {
  const op = findOperation(manifest, operationId);
  if (!op) {
    throw new RegistryError(`manifest for "${manifest.providerId}" has no operation "${operationId}"`);
  }
  return op;
}

export function operationsWithStatus(manifest: ConnectorManifest, status: CapabilityStatus): OperationCapability[] {
  return manifest.operations.filter((op) => op.status === status);
}

/** Registry seeded with the official-surface manifests this package ships. */
export function createDefaultRegistry(): ConnectorRegistry {
  return new ConnectorRegistry().register(youtubeManifest);
}
