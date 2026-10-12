import React from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";

// P6-WEB-HOST-1: the web client entrypoint. A NEW thin host — no fork-era
// app code is wrapped or resurrected (phase6-clients-plan §3).
const container = document.getElementById("root");
if (container === null) {
  throw new Error("the #root element is missing from index.html");
}
createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
