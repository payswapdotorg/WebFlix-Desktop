import { defineConfig } from "vitest/config";

// YOUTUBE-EXPAND substrate fix (same precedent as the MIRROR-RECON shell
// config): the package's tests live in tests/ (the root vitest.config.ts
// substrate picks them up for `pnpm test:unit`), but the package-local
// `pnpm --filter connectors test` previously included only __tests__/ — a
// directory this package has never had — so the script found no files and
// failed. Include both so the package-local run works alongside the root one.
export default defineConfig({
  test: {
    name: "connectors",
    environment: "node",
    include: ["tests/**/*.test.ts", "__tests__/**/*.test.ts"],
  },
});
