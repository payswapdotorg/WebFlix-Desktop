import { defineConfig } from "vitest/config";

// Package-local test config, following the webflix-shell component-test
// pattern verbatim (the MIRROR-RECON substrate precedent): the ROOT
// vitest.config.ts substrate only includes `*.test.ts` under packages/, so
// this app's `.tsx` component tests run through its own config via
// `pnpm --filter web-client test`. The jsdom environment is requested
// per-file via the `// @vitest-environment jsdom` docblock in the test files.
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.{test,spec}.{ts,tsx}"],
  },
});
