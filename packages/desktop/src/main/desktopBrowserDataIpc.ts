import { ipcMain } from "electron";
import { PlatformChannels, type ChromeBrowserDataImportOptions } from "@zcode/shared";
import { clearEmbeddedBrowserData, importChromeBrowserData } from "./browserDataManager.js";
import { resolveIsolationFlags } from "./webflix/isolation-flags.js";

export function registerBrowserDataIpcHandlers(logger: {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
}) {
  /*
   * AUDIT-DESKTOP finding (b) fix (desktop-fixes.patch.md §1.b, integration-time
   * application 2026-10-10): the Chrome cookie/localStorage/credential import
   * IPC used to be registered unconditionally — reachable from any renderer.
   * Now gated by the vendored isolation-flags surface: while
   * `chromeImportEnabled` is OFF (the default; fail-closed parsing — only
   * WEBFLIX_ENABLE_CHROME_IMPORT=1/true/yes/on enables) NO handler is
   * registered at all, so the surface is UNREACHABLE from the renderer, not
   * merely hidden behind a runtime check inside the handler.
   */
  const isolationFlags = resolveIsolationFlags(process.env);
  if (!isolationFlags.chromeImportEnabled) {
    logger.info(
      "[browser-data] chrome import IPC not registered: chromeImportEnabled flag is OFF (default, fail-closed)",
    );
  } else {
    ipcMain.handle(PlatformChannels.ImportChromeBrowserData, (_event, value: unknown) => {
      const requested = value as ChromeBrowserDataImportOptions | undefined;
      // renderer 只能为本次调用显式传 true；main 不接受或持久化其他授权形态。
      const allowElevatedChromeDecryption = requested?.allowElevatedChromeDecryption === true;
      return importChromeBrowserData({ allowElevatedChromeDecryption, logger });
    });
    logger.warn(
      "[browser-data] chrome import IPC registered: chromeImportEnabled flag is ON — elevated Chrome data import is reachable this boot",
    );
  }
  ipcMain.handle(PlatformChannels.ClearEmbeddedBrowserData, (_event, mode: unknown) => {
    if (mode !== "cache" && mode !== "all") {
      return { success: false, error: "invalid_clear_mode" };
    }
    return clearEmbeddedBrowserData({ logger, mode });
  });
}
