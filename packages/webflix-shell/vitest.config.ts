import { defineConfig } from "vitest/config";

// Package-local test config (MIRROR-RECON substrate fix, mirroring the
// f7d324f precedent for playback): the ROOT vitest.config.ts substrate only
// includes `*.test.ts` — the shell's component tests are `.tsx` and had never
// run (they also lacked their @testing-library/react dependency). This config
// keeps the root substrate untouched while letting
// `pnpm --filter webflix-shell test` execute the component suite. The jsdom
// environment is requested per-file via the `// @vitest-environment jsdom`
// docblock in tests/shell.test.tsx.
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.{test,spec}.{ts,tsx}"],
  },
});
