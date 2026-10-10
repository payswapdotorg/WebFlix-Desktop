/**
 * Type declarations for scripts/desktop-product-identity.mjs
 * (repo convention: .d.mts beside the script — see powershell-command.d.mts).
 * Added at integration (2026-10-10) when the WebFlix data-root wiring made
 * desktopRuntimeEnv.ts the second typed importer; previously only main/index.ts
 * imported the script and its TS7016 sat in the 216-error desktop baseline.
 */

export interface DesktopProductIdentity {
  readonly flavor: "production" | "preview" | "webflix";
  readonly appId: string;
  readonly productName: string;
  readonly linuxExecutableName: string;
  readonly linuxPackageName: string;
  readonly cuaHelperInstallVariant: string | null;
  /** WebFlix flavor only (frozen §6.1). */
  readonly linuxPackageGlob?: string;
  readonly scheme?: string;
  readonly dataRoot?: string;
  readonly devDataRoot?: string;
  readonly devAumid?: string;
}

export const ZCODE_PREVIEW_IDENTITY_ENV: string;
export const WEBFLIX_IDENTITY_ENV: string;

export const desktopProductIdentities: Readonly<
  Record<"production" | "preview" | "webflix", DesktopProductIdentity>
>;

export function isPreviewIdentityRequested(env?: NodeJS.ProcessEnv): boolean;
export function isWebFlixIdentityRequested(env?: NodeJS.ProcessEnv): boolean;
export function resolveDesktopProductFlavor(
  env?: NodeJS.ProcessEnv,
): "production" | "preview" | "webflix";
export function resolveDesktopProductIdentity(env?: NodeJS.ProcessEnv): DesktopProductIdentity;
export function resolveDesktopArtifactSuffix(env?: NodeJS.ProcessEnv): string;
export function resolveWindowsAppUserModelIdForFlavor(
  flavor: "production" | "preview" | "webflix",
  runtime?: { isPackaged: boolean },
): string;
export function resolveWindowsAppUserModelId(
  env?: NodeJS.ProcessEnv,
  runtime?: { isPackaged: boolean },
): string;
export function resolveWebFlixDataRootName(
  env?: NodeJS.ProcessEnv,
  runtime?: { isPackaged: boolean },
): string | undefined;
export function assertWebFlixIdentityNeverLeaksZCode(identity: object): true;
