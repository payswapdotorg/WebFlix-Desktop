import { createHash } from 'node:crypto';

export function sha256Hex(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

/**
 * Content-independent library fingerprint: sha-256 over (path, size, mtime).
 * Media bytes are never read or stored by this package.
 */
export function fingerprintFor(path: string, sizeBytes: number, mtimeMs: number): string {
  return sha256Hex(`v1|${path}|${Math.max(0, Math.floor(sizeBytes))}|${Math.max(0, Math.floor(mtimeMs))}`);
}
