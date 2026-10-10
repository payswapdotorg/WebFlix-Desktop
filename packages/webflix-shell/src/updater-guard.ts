/**
 * Lazy, guarded auto-updater initialization — PURE module (no Electron, no
 * Node built-ins, no imports at all).
 *
 * Root-cause fix pattern for AUDIT-DESKTOP finding 7 (desktop
 * `src/main/autoUpdater.ts:23`): the platform updater was constructed eagerly
 * at module import time. Dev builds report `0.0` as the app version — not
 * valid semver — so eager construction threw during boot and took the main
 * process down. The pattern implemented here, which the desktop patch spec
 * `docs/plans/patches/desktop-fixes.patch.md` applies to the desktop side:
 *
 *   1. LAZY    — the updater is constructed by an explicit
 *                `initializeAutoUpdater(getVersion, constructUpdater)` call
 *                from the app ready path, never at module import time.
 *   2. GUARDED — construction is SKIPPED when the app version is missing or
 *                invalid semver (e.g. the dev placeholder `0.0`), so a dev
 *                boot never reaches platform updater construction.
 *   3. ONCE    — initialization is memoized per process: repeated calls
 *                (duplicate boot paths, re-imports) construct the updater at
 *                most once. The outcome of the first init — constructed OR
 *                skipped — is final for the process; later calls return the
 *                memoized result without re-consulting `getVersion`.
 *
 * `constructUpdater` errors are NOT memoized: a genuine construction failure
 * propagates to the caller and initialization may be retried.
 *
 * Semver validation is deliberately strict (MAJOR.MINOR.PATCH, no leading
 * zeros, optional prerelease/build). `0.0.0` IS valid semver and constructs;
 * only missing or malformed versions such as `0.0` are rejected.
 */

export type InvalidVersionReason = 'missing' | 'not-semver';

export interface ValidVersionCheck {
  readonly valid: true;
  readonly version: string;
}

export interface InvalidVersionCheck {
  readonly valid: false;
  readonly reason: InvalidVersionReason;
  /** The raw version as observed; null when the version was absent entirely. */
  readonly version: string | null;
}

export type VersionCheck = ValidVersionCheck | InvalidVersionCheck;

/** Strict semver: MAJOR.MINOR.PATCH with optional -prerelease and +build. */
const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

/**
 * Validate an app version for updater construction.
 * Missing/empty → reason 'missing'; anything not strict semver
 * (including the dev placeholder `0.0`) → reason 'not-semver'.
 */
export function validateAppVersion(version: string | undefined | null): VersionCheck {
  if (version === undefined || version === null) {
    return { valid: false, reason: 'missing', version: null };
  }
  const trimmed = version.trim();
  if (trimmed === '') {
    return { valid: false, reason: 'missing', version };
  }
  if (!SEMVER_PATTERN.test(trimmed)) {
    return { valid: false, reason: 'not-semver', version: trimmed };
  }
  return { valid: true, version: trimmed };
}

export type AutoUpdaterStatus = 'constructed' | 'skipped';

export interface AutoUpdaterInitResult<T = unknown> {
  readonly status: AutoUpdaterStatus;
  /** The constructed updater; undefined when status is 'skipped'. */
  readonly updater: T | undefined;
  /** Set only when status is 'skipped'. */
  readonly skipReason: InvalidVersionReason | undefined;
  /** The version observed at init time; null when absent. */
  readonly appVersion: string | null;
}

interface AutoUpdaterState {
  initialized: boolean;
  result: AutoUpdaterInitResult | undefined;
}

const state: AutoUpdaterState = { initialized: false, result: undefined };

/**
 * The guarded, once-per-process updater initializer.
 *
 * - Calls `getVersion()` exactly once (the first time this runs).
 * - If the version is invalid/missing, `constructUpdater` is never invoked
 *   and the skip is memoized (sticky for the process).
 * - Otherwise constructs the updater exactly once and memoizes the result.
 */
export function initializeAutoUpdater<T = unknown>(
  getVersion: () => string | undefined | null,
  constructUpdater: () => T,
): AutoUpdaterInitResult<T> {
  if (state.initialized && state.result !== undefined) {
    return state.result as AutoUpdaterInitResult<T>;
  }

  const check = validateAppVersion(getVersion());

  const result: AutoUpdaterInitResult<T> = check.valid
    ? {
        status: 'constructed',
        updater: constructUpdater(),
        skipReason: undefined,
        appVersion: check.version,
      }
    : {
        status: 'skipped',
        updater: undefined,
        skipReason: check.reason,
        appVersion: check.version,
      };

  state.initialized = true;
  state.result = result as AutoUpdaterInitResult;
  return result;
}

/** True once `initializeAutoUpdater` has completed (constructed or skipped). */
export function isAutoUpdaterInitialized(): boolean {
  return state.initialized;
}

/** Test isolation only: clears the per-process memo. */
export function resetAutoUpdaterForTests(): void {
  state.initialized = false;
  state.result = undefined;
}

/** Structural type for an updater we know how to poke at safely. */
export interface CheckableUpdater {
  checkForUpdates: () => unknown;
}

export function hasCheckForUpdates(updater: unknown): updater is CheckableUpdater {
  return (
    typeof updater === 'object' &&
    updater !== null &&
    typeof (updater as { checkForUpdates?: unknown }).checkForUpdates === 'function'
  );
}

export type UpdateCheckOutcome =
  | { readonly kind: 'checked'; readonly value: unknown }
  | { readonly kind: 'no-updater' }
  | { readonly kind: 'error'; readonly error: unknown };

/**
 * Fire `updater.checkForUpdates()` only when a constructed updater exposes
 * it; never throws — async rejections and sync throws are captured as
 * `{ kind: 'error' }`. Safe to call unconditionally on every boot path.
 */
export async function safeCheckForUpdates(updater: unknown): Promise<UpdateCheckOutcome> {
  if (!hasCheckForUpdates(updater)) {
    return { kind: 'no-updater' };
  }
  try {
    const value = await updater.checkForUpdates();
    return { kind: 'checked', value };
  } catch (error) {
    return { kind: 'error', error };
  }
}
