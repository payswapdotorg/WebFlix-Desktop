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
 * The write is idempotent: desktopRuntimeEnv.ts performs the same guarded
 * write when it evaluates; an explicit WEBFLIX_DATA_ROOT from the environment
 * always wins (test isolation).
 */
import { resolveWebFlixDataRootName } from "../../../scripts/desktop-product-identity.mjs";
import { isElectronAppPackaged } from "../desktopElectronApp.js";

let applied = false;

/** Idempotent: computes the frozen WebFlix root (if any) and exports it. */
export function applyWebFlixDataRootEnv(): string | undefined {
  if (applied) {
    return undefined; // already applied by an earlier import
  }
  applied = true;
  const rootName = resolveWebFlixDataRootName(process.env, {
    isPackaged: isElectronAppPackaged(),
  });
  if (rootName && !process.env.WEBFLIX_DATA_ROOT?.trim()) {
    process.env.WEBFLIX_DATA_ROOT = rootName;
  }
  return rootName;
}

applyWebFlixDataRootEnv();
