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
