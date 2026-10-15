import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// P9-UI-1 package-local renderer test config — the webflix-shell
// package-local precedent (MIRROR-RECON substrate fix): the ROOT
// vitest.config.ts substrate only collects `*.test.ts` under its narrow
// pin globs and must stay untouched (editing it is outside this order's
// grant); the renderer battery lives beside the code it pins and runs via
// `vitest run --config packages/desktop/src/renderer/vitest.config.ts`.
//
// The defines bake the SAME runtime constants the packaged WebFlix renderer
// receives (vite.config.ts / tsup.config.ts `__ZCODE_PRODUCT_FLAVOR__` and
// `__ZCODE_VERSION__`), so the pins exercise the real baked paths.
//
// The jsdom environment is requested per-file via the
// `// @vitest-environment jsdom` docblock (jsdom + @testing-library/react
// are the hoisted devDependencies the shell component battery already
// rides — no package manifest changes).
export default defineConfig({
  // cwd-independent: the battery runs from the repo root via
  // `vitest run --config packages/desktop/src/renderer/vitest.config.ts`.
  root: fileURLToPath(new URL(".", import.meta.url)),
  define: {
    __ZCODE_PRODUCT_FLAVOR__: JSON.stringify("webflix"),
    __ZCODE_VERSION__: JSON.stringify("test"),
  },
  test: {
    globals: true,
    environment: "node",
    include: ["src/webflix/__tests__/**/*.{test,spec}.{ts,tsx}"],
  },
});
