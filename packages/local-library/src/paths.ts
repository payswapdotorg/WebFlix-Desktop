import { realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, isAbsolute, join, resolve, sep } from 'node:path';
import { PathSafetyError, ValidationError } from './errors';

/** Production WebFlix data root (~/.webflix). NEVER open this in tests — inject a temp dir instead. */
export function defaultDataRoot(): string {
  return join(homedir(), '.webflix');
}

/**
 * Under a test runner, refuse the default data root so suites can never touch a
 * real user library. Tests must inject a temp dir via OpenStoreOptions.baseDir.
 */
export function assertNotDefaultDataRootInTests(baseDir: string): void {
  const underTest =
    process.env['VITEST'] === 'true' ||
    process.env['VITEST_WORKER_ID'] !== undefined ||
    process.env['NODE_ENV'] === 'test';
  if (!underTest) {
    return;
  }
  const forbidden = resolve(defaultDataRoot());
  const candidate = resolve(baseDir);
  if (candidate === forbidden || candidate.startsWith(forbidden + sep)) {
    throw new PathSafetyError(
      `refusing to open the default WebFlix data root (${forbidden}) during a test run — pass a temp dir as baseDir`,
    );
  }
}

export function assertSafeAbsolutePath(candidate: string, label = 'path'): string {
  if (typeof candidate !== 'string' || candidate.trim().length === 0) {
    throw new ValidationError(`${label} must be a non-empty string`);
  }
  if (candidate.includes('\0')) {
    throw new PathSafetyError(`${label} contains a NUL byte: ${JSON.stringify(candidate)}`);
  }
  const resolved = resolve(candidate);
  if (!isAbsolute(resolved)) {
    throw new PathSafetyError(`${label} must resolve to an absolute path: ${candidate}`);
  }
  return resolved;
}

export function isInside(child: string, parent: string): boolean {
  const c = resolve(child);
  const p = resolve(parent);
  return c === p || c.startsWith(p + sep);
}

export function realPathOrNull(path: string): string | null {
  try {
    return realpathSync(path);
  } catch {
    return null;
  }
}

/** Real path when the target exists (symlinks resolved), otherwise the normalized absolute path. */
export function statableRealOrResolve(path: string): string {
  return realPathOrNull(path) ?? resolve(path);
}

export function titleFromPath(path: string): string {
  const base = basename(path);
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(0, dot) : base;
}
