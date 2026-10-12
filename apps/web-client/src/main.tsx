import React from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import { bootstrapPersistence } from "./persistence";

// P6-DURABLE-WEB-1: the web client entrypoint. A NEW thin host — no fork-era
// app code is wrapped or resurrected (phase6-clients-plan §3).
//
// The BOOTSTRAP READ runs BEFORE mount: the persistence-mode setting is
// read from IndexedDB itself (first-run default session-only; a typed
// degraded fallback when IndexedDB is unavailable), so the very first
// render already states the ACTUAL active mode — never a mode the host has
// not actually established. The bootstrap is total (it never rejects), so
// mount has no untyped crash path.
const container = document.getElementById("root");
if (container === null) {
  throw new Error("the #root element is missing from index.html");
}
void bootstrapPersistence().then((persistence) => {
  createRoot(container).render(
    <React.StrictMode>
      <App persistence={persistence} />
    </React.StrictMode>,
  );
});

// P6-PWA-1: register the PRECACHE-ONLY service worker (public/sw.js; the
// build injects the dist inventory — see vite.config.ts). Production build
// only: the dev server serves no meaningful precache. A registration
// failure is an honest no-op (the app stays fully session-functional —
// the worker is an install/offline affordance, never a dependency).
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Honest no-op: the shell keeps running without the worker.
    });
  });
}
