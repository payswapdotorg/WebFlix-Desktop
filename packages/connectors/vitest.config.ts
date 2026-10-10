import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "connectors",
    environment: "node",
    include: ["__tests__/**/*.test.ts"],
  },
});
