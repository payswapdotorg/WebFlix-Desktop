import { promises as fs } from "node:fs";
import path from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

// P6-WEB-HOST-1: the web client host build. Deliberately MINIMAL — this is a
// NEW thin composition of webflix-shell + webflix-application (phase6-clients
// plan §3: no resurrection of the fork-era Next.js app; nothing is wrapped).
// The workspace packages resolve to their TypeScript source (main: src/index.ts)
// and are transformed in-place, exactly like the reuse claim promises.
// NO dev-server proxy, NO env injection, NO network of any kind in this config.
//
// P6-PWA-1: the PRECACHE-INJECT plugin — after the build writes dist/, the
// plugin walks the output inventory and injects it into dist/sw.js in place
// of the source's empty `self.__WF_PRECACHE_MANIFEST` slot. The service
// worker itself stays hand-written and precache-only (public/sw.js — no
// Workbox, no runtime caching, no codegen): the injected list IS the whole
// precache, exactly the vite build's dist inventory (sw.js itself excluded —
// the browser fetches the worker script by specification, not via the cache).
function webflixPrecacheInject(): Plugin {
  return {
    name: "webflix-precache-inject",
    apply: "build",
    enforce: "post",
    closeBundle() {
      const distDir = new URL("./dist/", import.meta.url).pathname;
      const swPath = path.join(distDir, "sw.js");
      return fs
        .access(swPath)
        .then(() => {
          const walk = (dir: string, base = ""): string[] => {
            const out: string[] = [];
            return fs.readdir(dir, { withFileTypes: true }).then((entries) => {
              const results: string[][] = [];
              for (const entry of entries) {
                const rel = base === "" ? entry.name : `${base}/${entry.name}`;
                if (entry.isDirectory()) {
                  results.push(walk(path.join(dir, entry.name), rel));
                } else {
                  out.push(`/${rel}`);
                }
              }
              return Promise.all(results).then((nested) => {
                for (const list of nested) out.push(...list);
                return out;
              });
            });
          };
          return walk(distDir).then((files) => {
            // "/" leads the precache: the root NAVIGATION request must hit
            // the cache offline (the app-shell entry; /index.html stays as
            // its own key too — both are the same precached document).
            const precache = ["/", ...files.filter((file) => file !== "/sw.js")].sort((a, b) =>
              a.localeCompare(b),
            );
            return fs.readFile(swPath, "utf8").then((source) => {
              const slot = "self.__WF_PRECACHE_MANIFEST = [];";
              const replacement = `self.__WF_PRECACHE_MANIFEST = ${JSON.stringify(
                precache,
                null,
                2,
              )};`;
              if (!source.includes(slot)) {
                throw new Error(
                  "webflix-precache-inject: the injection slot is missing from public/sw.js " +
                    "(expected `self.__WF_PRECACHE_MANIFEST = [];`)",
                );
              }
              return fs.writeFile(swPath, source.replace(slot, replacement));
            });
          });
        })
        .catch((error) => {
          throw error instanceof Error ? error : new Error(String(error));
        });
    },
  };
}

export default defineConfig({
  plugins: [react(), webflixPrecacheInject()],
  build: {
    outDir: "dist",
    sourcemap: false,
  },
});
