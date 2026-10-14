/**
 * Type declarations for scripts/desktop-product-identity.mjs
 * (repo convention: .d.mts beside the script — see powershell-command.d.mts).
 * Added at integration (2026-10-10) when the WebFlix data-root wiring made
 * desktopRuntimeEnv.ts the second typed importer; previously only main/index.ts
 * imported the script and its TS7016 sat in the 216-error desktop baseline.
 *
 * P8-RELEASE-DRIFT-1 (2026-10-14): R2 threads the baked runtime flavor into
 * isWebFlixIdentityRequested/resolveWebFlixDataRootName as an option (packaged
 * webflix-flavor boots default ON); R3/R4 centralize scheme + artifact-metadata
 * values on the identity objects themselves.
 */

export type DesktopProductFlavor = "production" | "preview" | "webflix";

/** Runtime identity options (R2): baked ZCODE_PRODUCT_FLAVOR + app.isPackaged. */
export interface WebFlixRuntimeIdentityOptions {
  readonly flavor?: DesktopProductFlavor;
  readonly isPackaged?: boolean;
}

export interface DesktopProductIdentity {
  readonly flavor: DesktopProductFlavor;
  readonly appId: string;
  readonly productName: string;
  readonly linuxExecutableName: string;
  readonly linuxPackageName: string;
  readonly cuaHelperInstallVariant: string | null;
  /** Deep-link protocol scheme (P8 R3; frozen `webflix` for the WebFlix flavor). */
  readonly scheme: string;
  /** Artifact homepage (extraMetadata; PROPOSED value for WebFlix — flagged for TL2). */
  readonly homepage: string;
  /** Artifact author name (extraMetadata/deb maintainer; PROPOSED for WebFlix). */
  readonly authorName: string;
  /** Artifact author email (extraMetadata/deb maintainer; PROPOSED for WebFlix). */
  readonly authorEmail: string;
  /** Windows install-manifest filename written into the artifact (R4). */
  readonly installManifestName: string;
  /** Dev updater-experiment cache dir name (dev-app-update.yml; R4). */
  readonly updaterCacheDirName: string;
  /** WebFlix flavor only (frozen §6.1). */
  readonly linuxPackageGlob?: string;
  readonly dataRoot?: string;
  readonly devDataRoot?: string;
  readonly devAumid?: string;
}

export const ZCODE_PREVIEW_IDENTITY_ENV: string;
export const WEBFLIX_IDENTITY_ENV: string;

export const desktopProductIdentities: Readonly<
  Record<DesktopProductFlavor, DesktopProductIdentity>
>;

export function isPreviewIdentityRequested(env?: NodeJS.ProcessEnv): boolean;
export function isWebFlixIdentityRequested(
  env?: NodeJS.ProcessEnv,
  options?: WebFlixRuntimeIdentityOptions,
): boolean;
export function resolveDesktopProductFlavor(env?: NodeJS.ProcessEnv): DesktopProductFlavor;
export function resolveDesktopProductIdentity(env?: NodeJS.ProcessEnv): DesktopProductIdentity;
export function resolveDesktopArtifactSuffix(env?: NodeJS.ProcessEnv): string;
export function resolveWindowsAppUserModelIdForFlavor(
  flavor: DesktopProductFlavor,
  runtime?: { isPackaged: boolean },
): string;
export function resolveWindowsAppUserModelId(
  env?: NodeJS.ProcessEnv,
  runtime?: { isPackaged: boolean },
): string;
export function resolveWebFlixDataRootName(
  env?: NodeJS.ProcessEnv,
  runtime?: WebFlixRuntimeIdentityOptions & { isPackaged?: boolean },
): string | undefined;
export function assertWebFlixIdentityNeverLeaksZCode(identity: object): true;
