/**
 * Path-safety helpers (pure string handling — no filesystem access).
 *
 * The application layer NEVER opens files: it validates and normalises path
 * strings, then hands them to the `IndexingPort` adapter, which owns all disk
 * access. These checks are the first line of defence against odd inputs
 * (empty strings, NUL injection, relative paths) reaching the adapter.
 */

/** A path the use-case refused to forward to the indexer. */
export interface RejectedPath {
  readonly path: string;
  readonly reason: string;
}

const WINDOWS_DRIVE = /^[A-Za-z]:[\\/]/;
const UNC_PATH = /^\\\\[^\s]/;

export function isAbsolutePath(path: string): boolean {
  return path.startsWith("/") || WINDOWS_DRIVE.test(path) || UNC_PATH.test(path);
}

export interface SanitizedPaths {
  /** Unique, validated, absolute paths — safe to hand to `IndexingPort.start`. */
  readonly valid: readonly string[];
  /** Inputs refused locally, with reasons, in input order. */
  readonly rejected: readonly RejectedPath[];
}

/**
 * Validate, trim and de-duplicate raw user paths. Duplicated valid paths are
 * collapsed silently; invalid ones are reported in `rejected`.
 */
export function sanitizePaths(paths: readonly string[]): SanitizedPaths {
  const valid: string[] = [];
  const rejected: RejectedPath[] = [];
  const seen = new Set<string>();

  for (const raw of paths) {
    const path = raw.trim();
    if (path.length === 0) {
      rejected.push({ path: raw, reason: "empty path" });
      continue;
    }
    if (path.includes("\0")) {
      rejected.push({ path, reason: "path contains a NUL byte" });
      continue;
    }
    if (!isAbsolutePath(path)) {
      rejected.push({ path, reason: "only absolute paths are accepted" });
      continue;
    }
    if (seen.has(path)) continue;
    seen.add(path);
    valid.push(path);
  }

  return { valid, rejected };
}
