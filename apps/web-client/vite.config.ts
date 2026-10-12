import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// P6-WEB-HOST-1: the web client host build. Deliberately MINIMAL — this is a
// NEW thin composition of webflix-shell + webflix-application (phase6-clients
// plan §3: no resurrection of the fork-era Next.js app; nothing is wrapped).
// The workspace packages resolve to their TypeScript source (main: src/index.ts)
// and are transformed in-place, exactly like the reuse claim promises.
// NO dev-server proxy, NO env injection, NO network of any kind in this config.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
    sourcemap: false,
  },
});
