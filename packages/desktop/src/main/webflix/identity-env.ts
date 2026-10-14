/**
 * Earliest-possible WebFlix data-root env application.
 *
 * Why this module exists (integration 2026-10-10): services/paths.ts resolves
 * the data-root segment fail-closed — under WEBFLIX_IDENTITY=1 a missing
 * WEBFLIX_DATA_ROOT throws instead of silently falling back to a ZCode root.
 * That guard is correct, but main-process modules like logger.ts resolve the
 * config dir at MODULE SCOPE, potentially before desktopRuntimeEnv.ts (the
 * module that computes and exports the WebFlix root) gets evaluated. This
 * module applies the same idempotent env write as a pure import side effect,
 * so any importer of it (logger.ts imports it first) guarantees the env is set
 * before the first services path resolution.
 *
 * P8-RELEASE-DRIFT-1 (R2, audit §1.5): the runtime identity now also follows
 * the BAKED flavor — `ZCODE_PRODUCT_FLAVOR === "webflix"` + packaged boot ⇒
 * WebFlix identity ON by default (nothing in the packaged boot chain sets
 * WEBFLIX_IDENTITY). Because the services layer reads `WEBFLIX_IDENTITY`
 * directly (packages/services/src/paths.ts — outside this order's allowed
 * paths), the resolved identity is exported BACK as the env contract:
 * `WEBFLIX_IDENTITY=1` + `WEBFLIX_DATA_ROOT=<root>` are written whenever the
 * runtime identity resolves ON, so services and forked host/scheduler
 * processes (env inheritance) follow the same root. Explicit env values
 * always win (test isolation); invalid spellings still throw (fail-closed).
 */
import { ZCODE_PRODUCT_FLAVOR } from "@zcode/shared";
import {
  resolveWebFlixDataRootName,
  type DesktopProductFlavor,
} from "../../../scripts/desktop-product-identity.mjs";
import { isElectronAppPackaged } from "../desktopElectronApp.js";

/** Runtime inputs for the WebFlix identity resolution (injectable for tests). */
export interface WebFlixRuntimeIdentityInputs {
  readonly isPackaged?: boolean;
  readonly flavor?: DesktopProductFlavor;
}

/**
 * Pure resolution: the WebFlix data-root name for this env + runtime, or
 * undefined when the identity is not active (ZCode behavior unchanged).
 */
export function resolveWebFlixRuntimeIdentity(
  env: NodeJS.ProcessEnv = process.env,
  runtime: WebFlixRuntimeIdentityInputs = {},
): string | undefined {
  return resolveWebFlixDataRootName(env, {
    isPackaged: runtime.isPackaged ?? isElectronAppPackaged(),
    flavor: runtime.flavor ?? ZCODE_PRODUCT_FLAVOR,
  });
}

/**
 * Compute + write the runtime identity env contract (`WEBFLIX_IDENTITY=1` and
 * `WEBFLIX_DATA_ROOT`) when the WebFlix identity is active. Pure with respect
 * to `env` (defaults to process.env); safe to call repeatedly — explicit env
 * values are never overwritten.
 */
export function writeWebFlixRuntimeIdentityEnv(
  env: NodeJS.ProcessEnv = process.env,
  runtime: WebFlixRuntimeIdentityInputs = {},
): string | undefined {
  const rootName = resolveWebFlixRuntimeIdentity(env, runtime);
  if (rootName) {
    // Runtime identity contract (freeze §6.1): services/paths.ts keys the
    // data-root segment off WEBFLIX_IDENTITY directly; the packaged
    // default-on case (R2) resolves the identity with the env var UNSET, so
    // it must be exported here for the services layer to follow.
    if (!env.WEBFLIX_IDENTITY?.trim()) {
      env.WEBFLIX_IDENTITY = "1";
    }
    if (!env.WEBFLIX_DATA_ROOT?.trim()) {
      env.WEBFLIX_DATA_ROOT = rootName;
    }
  }
  return rootName;
}

let applied = false;

/** Idempotent: computes the frozen WebFlix root (if any) and exports it. */
export function applyWebFlixDataRootEnv(
  env: NodeJS.ProcessEnv = process.env,
  runtime: WebFlixRuntimeIdentityInputs = {},
): string | undefined {
  if (applied) {
    return undefined; // already applied by an earlier import
  }
  applied = true;
  return writeWebFlixRuntimeIdentityEnv(env, runtime);
}

applyWebFlixDataRootEnv();
