/**
 * Isolation flag surface — PURE module (no Electron imports; depends only on
 * `./identity` for the freeze §6.1 env-alias migration rule).
 *
 * WebFlix keeps two fail-closed isolation flags (AUDIT-DESKTOP):
 *
 *  - `chromeImportEnabled`   — gates the Chrome cookie / localStorage /
 *    credential import IPC surface. Default OFF: the import IPC handlers are
 *    NOT registered at all, so the surface is UNREACHABLE from the renderer
 *    (invokes fail with "No handler registered"), never merely hidden UI.
 *
 *  - `webflixProductSurface` — gates the WebFlix product surface: Coding
 *    Plan / PayPal, CUA, Lark, SSH/Docker/WSL remotes, and force-update.
 *    Default OFF: none of the gated IPC channels, menu entries, deep links,
 *    or renderer routes are registered.
 *
 * Both flags resolve from the environment and fail closed: only an explicit
 * opt-in value (`1` / `true` / `yes` / `on`, case-insensitive) turns a flag
 * on; unset, empty, and unrecognized values all resolve to false. Canonical
 * `WEBFLIX_*` variables win over the legacy `ZCODE_*` aliases (freeze §6.1 —
 * aliases kept during migration), via `readEnv` from identity.ts.
 *
 * `ISOLATION_FLAG_POLICY` documents, per flag, exactly what is gated and the
 * unreachable-IPC guarantee that must hold while the flag is OFF; the
 * desktop patch spec `docs/plans/patches/desktop-fixes.patch.md` (edits B
 * and C) enforces it in the desktop main process. `requireFlagEnabled` is
 * the defense-in-depth guard used inside IPC handler bodies.
 */

import { readEnv } from './identity';

export type IsolationFlagName = 'chromeImportEnabled' | 'webflixProductSurface';

export interface IsolationFlags {
  readonly chromeImportEnabled: boolean;
  readonly webflixProductSurface: boolean;
}

export const CHROME_IMPORT_ENV = 'WEBFLIX_ENABLE_CHROME_IMPORT';
export const PRODUCT_SURFACE_ENV = 'WEBFLIX_ENABLE_PRODUCT_SURFACE';

/** Both flags default OFF — fail-closed (AUDIT-DESKTOP). */
export const DEFAULT_ISOLATION_FLAGS: Readonly<IsolationFlags> = Object.freeze({
  chromeImportEnabled: false,
  webflixProductSurface: false,
});

const TRUTHY = new Set(['1', 'true', 'yes', 'on']);

/** Fail-closed: only explicit opt-in values are true; everything else is false. */
export function parseIsolationFlagValue(raw: string | undefined): boolean {
  if (raw === undefined) {
    return false;
  }
  return TRUTHY.has(raw.trim().toLowerCase());
}

/**
 * Resolve both flags from `env`. Canonical `WEBFLIX_*` wins over the legacy
 * `ZCODE_*` alias; both default OFF. The result is frozen.
 */
export function resolveIsolationFlags(
  env: Record<string, string | undefined>,
): Readonly<IsolationFlags> {
  return Object.freeze({
    chromeImportEnabled: parseIsolationFlagValue(readEnv(env, 'ENABLE_CHROME_IMPORT')),
    webflixProductSurface: parseIsolationFlagValue(readEnv(env, 'ENABLE_PRODUCT_SURFACE')),
  });
}

export interface IsolationFlagPolicy {
  readonly name: IsolationFlagName;
  readonly env: string;
  readonly default: false;
  /** What the flag gates, enumerated. */
  readonly gates: readonly string[];
  /** The guarantee that holds while the flag is OFF (fail-closed). */
  readonly offGuarantee: string;
  /** Desktop files where the guarantee is enforced (see the patch spec). */
  readonly enforcedIn: readonly string[];
}

export const ISOLATION_FLAG_POLICY: readonly IsolationFlagPolicy[] = Object.freeze([
  Object.freeze({
    name: 'chromeImportEnabled',
    env: CHROME_IMPORT_ENV,
    default: false,
    gates: Object.freeze([
      'chrome cookie import',
      'chrome localStorage import',
      'chrome credential (password) import',
    ]),
    offGuarantee:
      'While chromeImportEnabled is OFF, the Chrome import IPC surface is UNREACHABLE: no ipcMain ' +
      'handler is registered for the chrome-import:* channels, so every renderer invoke fails ' +
      "with Electron's \"No handler registered\" error before any import code runs. Reachability " +
      'is enforced in the main process, never by hiding renderer UI.',
    enforcedIn: Object.freeze(['packages/desktop/src/main/chrome-import.ts']),
  }),
  Object.freeze({
    name: 'webflixProductSurface',
    env: PRODUCT_SURFACE_ENV,
    default: false,
    gates: Object.freeze([
      'Coding Plan / PayPal surface',
      'CUA (computer-use agent) surface',
      'Lark surface',
      'SSH remote surface',
      'Docker remote surface',
      'WSL remote surface',
      'force-update flow',
    ]),
    offGuarantee:
      'While webflixProductSurface is OFF, the product surface is UNREACHABLE: none of the gated ' +
      'IPC channels, menu entries, deep links, or renderer routes are registered, and any message ' +
      'arriving on a gated channel is rejected in the main process before a gated handler body ' +
      'can execute.',
    enforcedIn: Object.freeze([
      'packages/desktop/src/main/ipc-router.ts',
      'packages/desktop/src/main/app-menu.ts',
      'packages/desktop/src/main/deep-links.ts',
    ]),
  }),
]);

const FLAG_ENV: Record<IsolationFlagName, string> = {
  chromeImportEnabled: CHROME_IMPORT_ENV,
  webflixProductSurface: PRODUCT_SURFACE_ENV,
};

/** Thrown by `requireFlagEnabled` when a gated surface is reached while OFF. */
export class FlagDisabledError extends Error {
  readonly flag: IsolationFlagName;

  constructor(flag: IsolationFlagName) {
    super(
      `isolation flag "${flag}" is OFF (fail-closed default): the gated surface must remain ` +
        `unreachable from the renderer (see ISOLATION_FLAG_POLICY). Set ${FLAG_ENV[flag]} ` +
        `explicitly to enable.`,
    );
    this.name = 'FlagDisabledError';
    this.flag = flag;
  }
}

/**
 * Defense in depth for gated IPC handler bodies: throws `FlagDisabledError`
 * when the flag is OFF. Registration-level gating (not registering handlers
 * at all) remains the primary enforcement — this guard only protects against
 * later registration changes.
 */
export function requireFlagEnabled(flags: IsolationFlags, name: IsolationFlagName): void {
  if (!flags[name]) {
    throw new FlagDisabledError(name);
  }
}
