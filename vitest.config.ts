import { defineConfig } from "vitest/config";

// D2 test substrate (contract freeze 5549208): unit tests across the
// webflix packages; integration tests are separated by config file so
// `pnpm test:unit` stays fast and hermetic.
//
// P8-RELEASE-DRIFT-1 (audit §4.2 T-map, 2026-10-14): the release-safety
// pins target @zcode/shared + desktop modules, so the include list grows
// the EXACT pin locations (narrow globs — electron-app-dependent desktop
// suites stay out of this hermetic battery; only these paths join), and
// the define bakes the WebFlix product flavor exactly as the packaged
// runtime receives it (tsup.config.ts:104 `__ZCODE_PRODUCT_FLAVOR__`),
// so the runtime-constant pins exercise the real baked path. This is
// battery-scope plumbing required by the ordered acceptance
// ("pnpm test:unit — ALL existing tests pass + the new T-map pins");
// flagged for TL2 review — no battery package gains a dependency on
// @zcode/shared or the desktop package (imports are per-test-file).
export default defineConfig({
  define: {
    __ZCODE_PRODUCT_FLAVOR__: JSON.stringify("webflix"),
  },
  test: {
    globals: true,
    environment: "node",
    include: [
      "packages/{webflix-*,local-library,catalog,connectors,playback}/**/*.{test,spec}.ts",
      "packages/shared/src/*.test.ts",
      "packages/desktop/scripts/*.test.ts",
      "packages/desktop/src/main/*.test.ts",
      "packages/desktop/src/main/webflix/*.test.ts",
    ],
    exclude: ["**/*.int.test.ts", "**/*.int.spec.ts", "**/node_modules/**"],
  },
});
