/**
 * WebFlix product identity — FROZEN VALUES (freeze §6.1, BINDING).
 *
 * This module is the webflix-shell-side mirror of the centralized desktop
 * identity switch point `packages/desktop/scripts/desktop-product-identity.mjs`
 * (AUDIT-DESKTOP: that script is the single switch point for every desktop
 * identity surface). Every value below cites its source (freeze §6.1); a value
 * may only change via a re-freeze of §6.1, applied together with
 * `docs/plans/patches/desktop-product-identity.patch.md` to the desktop script.
 *
 * Coexistence (freeze §6.1): WebFlix and ZCode must never share a Windows
 * AUMID, a data/userData root, or a Linux package name. The legacy ZCode dev
 * AUMID `cn.aminer.zcode` (a production-AUMID reuse bug, AUDIT-DESKTOP) must
 * never appear on any WebFlix surface — enforced by `assertWebFlixIdentity`.
 */

/** The one and only WebFlix flavor. */
export const FLAVOR = 'webflix' as const;
export type Flavor = typeof FLAVOR;

/** Selects between the frozen production and development identity values. */
export type DataRootMode = 'prod' | 'dev';

export interface WebFlixIdentity {
  readonly appId: string;
  readonly productName: string;
  readonly scheme: string;
  readonly dataRoot: string;
  readonly devDataRoot: string;
  readonly devAumid: string;
  readonly linuxPackageGlob: string;
  readonly linuxPackageNames: readonly string[];
  readonly legacyEnvPrefix: string;
}

/**
 * The frozen WebFlix identity. Every field cites its source (freeze §6.1).
 * Runtime-frozen: mutating it throws in strict mode, and the test suite pins
 * every value exactly.
 */
export const WEBFLIX_IDENTITY: Readonly<WebFlixIdentity> = Object.freeze({
  /** freeze §6.1 — production Windows AUMID and Electron appId. */
  appId: 'org.webflix.desktop',
  /** freeze §6.1 — user-facing product name (installers, menus, userData label). */
  productName: 'WebFlix',
  /** freeze §6.1 — deep-link scheme, registered and matched as `webflix://`. */
  scheme: 'webflix://',
  /** freeze §6.1 — production data root (Electron userData base). */
  dataRoot: '~/.webflix',
  /** freeze §6.1 — development data root; keeps dev state out of production. */
  devDataRoot: '~/.webflix-dev',
  /** freeze §6.1 — development Windows AUMID. Never the legacy ZCode AUMID
   *  `cn.aminer.zcode` and never the production appId (AUDIT-DESKTOP). */
  devAumid: 'org.webflix.desktop.dev',
  /** freeze §6.1 — Linux package names, glob form as frozen. */
  linuxPackageGlob: 'webflix-desktop*',
  /** freeze §6.1 — concrete Linux package names covered by the glob. */
  linuxPackageNames: ['webflix-desktop', 'webflix-desktop-dev'] as const,
  /** freeze §6.1 — legacy `ZCODE_*` env aliases remain honored during migration. */
  legacyEnvPrefix: 'ZCODE_',
});

export interface LegacyZCodeIdentity {
  readonly appId: string;
  readonly scheme: string;
  readonly dataRoot: string;
  readonly envPrefix: string;
  /** AUDIT-DESKTOP: ZCode dev builds reused this production AUMID as the dev AUMID. */
  readonly buggyDevAumid: string;
}

/**
 * Legacy ZCode identity — kept ONLY as a coexistence reference. WebFlix must
 * never emit any of these values on a WebFlix surface (`assertWebFlixIdentity`
 * rejects them; `identity.test.ts` pins the rejections).
 */
export const LEGACY_ZCODE_IDENTITY: Readonly<LegacyZCodeIdentity> = Object.freeze({
  appId: 'cn.aminer.zcode',
  scheme: 'zcode://',
  dataRoot: '~/.zcode',
  envPrefix: 'ZCODE_',
  buggyDevAumid: 'cn.aminer.zcode',
});

/**
 * Canonical prefix for NEW WebFlix env vars. Derived, NOT frozen: freeze §6.1
 * only mandates that the legacy `ZCODE_*` aliases stay honored during
 * migration — see `readEnv`.
 */
export const CANONICAL_ENV_PREFIX = 'WEBFLIX_';

/** Production uses the frozen appId as its Windows AUMID; dev uses `.dev`. */
export function aumidFor(mode: DataRootMode): string {
  return mode === 'dev' ? WEBFLIX_IDENTITY.devAumid : WEBFLIX_IDENTITY.appId;
}

/** Frozen data root for the requested mode (freeze §6.1). */
export function dataRootFor(mode: DataRootMode): string {
  return mode === 'dev' ? WEBFLIX_IDENTITY.devDataRoot : WEBFLIX_IDENTITY.dataRoot;
}

/** Expand a leading `~/` data root against a home directory. */
export function resolveDataRoot(root: string, home: string): string {
  if (root === '~') return home;
  if (root.startsWith('~/')) return `${home}${root.slice(1)}`;
  return root;
}

/** True for `webflix://...` URLs only (case-insensitive); rejects legacy schemes. */
export function isWebflixSchemeUrl(url: string): boolean {
  return url.toLowerCase().startsWith(WEBFLIX_IDENTITY.scheme);
}

/** Thrown by `assertWebFlixIdentity` when a surface collides with legacy ZCode identity. */
export class LegacyIdentityCollisionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LegacyIdentityCollisionError';
  }
}

/** One desktop identity surface as it will be registered with the OS/Electron. */
export interface IdentitySurface {
  readonly appId: string;
  readonly aumid?: string;
  readonly dataRoot?: string;
  readonly scheme?: string;
}

/**
 * Coexistence guard (freeze §6.1, AUDIT-DESKTOP): throws
 * `LegacyIdentityCollisionError` if a WebFlix identity surface
 * - reuses the legacy ZCode appId `cn.aminer.zcode`,
 * - carries a Windows AUMID that is not one of the two frozen WebFlix AUMIDs
 *   (which forbids the legacy/buggy dev AUMID `cn.aminer.zcode`),
 * - carries a data root outside the two frozen WebFlix roots (which forbids
 *   the legacy `~/.zcode`), or
 * - carries a scheme other than the frozen `webflix://`.
 */
export function assertWebFlixIdentity(surface: IdentitySurface): void {
  const legacy = LEGACY_ZCODE_IDENTITY;

  if (surface.appId === legacy.appId) {
    throw new LegacyIdentityCollisionError(
      `appId "${surface.appId}" is the legacy ZCode appId; WebFlix must use "${WEBFLIX_IDENTITY.appId}" (freeze §6.1)`,
    );
  }

  if (surface.aumid !== undefined) {
    const allowedAumids: readonly string[] = [WEBFLIX_IDENTITY.appId, WEBFLIX_IDENTITY.devAumid];
    if (!allowedAumids.includes(surface.aumid)) {
      throw new LegacyIdentityCollisionError(
        `AUMID "${surface.aumid}" is not a WebFlix AUMID (allowed: ${allowedAumids.join(', ')}); ` +
          `the legacy ZCode AUMID "${legacy.appId}" is forbidden on WebFlix surfaces (AUDIT-DESKTOP)`,
      );
    }
  }

  if (surface.dataRoot !== undefined) {
    const allowedRoots: readonly string[] = [WEBFLIX_IDENTITY.dataRoot, WEBFLIX_IDENTITY.devDataRoot];
    if (!allowedRoots.includes(surface.dataRoot)) {
      throw new LegacyIdentityCollisionError(
        `data root "${surface.dataRoot}" is not a WebFlix data root (allowed: ${allowedRoots.join(', ')}); ` +
          `the legacy ZCode root "${legacy.dataRoot}" is forbidden on WebFlix surfaces (freeze §6.1)`,
      );
    }
  }

  if (surface.scheme !== undefined && surface.scheme !== WEBFLIX_IDENTITY.scheme) {
    throw new LegacyIdentityCollisionError(
      `scheme "${surface.scheme}" is not the frozen WebFlix scheme "${WEBFLIX_IDENTITY.scheme}"; ` +
        `the legacy scheme "${legacy.scheme}" is forbidden on WebFlix surfaces (freeze §6.1)`,
    );
  }
}

/**
 * Resolve `name` from `env` honoring the frozen migration aliases (freeze §6.1):
 * canonical `WEBFLIX_<name>` wins, legacy `ZCODE_<name>` is the fallback.
 * Empty strings are treated as unset. Returns `undefined` when neither is set.
 */
export function readEnv(env: Record<string, string | undefined>, name: string): string | undefined {
  const canonical = env[`${CANONICAL_ENV_PREFIX}${name}`];
  if (canonical !== undefined && canonical !== '') return canonical;
  const legacy = env[`${WEBFLIX_IDENTITY.legacyEnvPrefix}${name}`];
  if (legacy !== undefined && legacy !== '') return legacy;
  return undefined;
}
