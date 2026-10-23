// @vitest-environment jsdom
//
// P9-UI-1 (order requirements 1/2/3/5 + requirement 6) — the WebFlix
// renderer-host component pins. The REAL webflix-shell (AppShell + every
// screen) is mounted by the desktop host over the real session modules;
// every state below is the honest one (empty/requires-auth/never-run), and
// NO ZCode/Z.ai identity string may appear anywhere in the rendered
// product surface.
//
// The host module's self-boot (bootWebFlixRenderer) no-ops here: the test
// document has no #root element, so createRoot is never called by the
// module-scope statement — only the exported host component renders, into
// the testing-library container.
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { WebFlixHost } from "../boot.js";
import { createLocalLibrarySession } from "../localLibrarySession.js";
import type { WebFlixAccountsBridge, WebFlixAccountsStatus } from "../accountsBridge.js";

afterEach(cleanup);

/** A library factory that never touches URL.createObjectURL (jsdom lacks it). */
function fakeLocalLibrary() {
  let counter = 0;
  return createLocalLibrarySession({
    createObjectUrl: (file) => `blob:webflix-test/${file.name}`,
    resolveOsPath: () => null,
    mintId: () => `host-test-${++counter}`,
  });
}

function availableBridge(): WebFlixAccountsBridge {
  return {
    getStatus: async (): Promise<WebFlixAccountsStatus> => ({
      vault: { available: true, reason: null },
      accounts: [],
    }),
    connect: async () => ({
      ok: false,
      code: "connect-unavailable" as const,
      reason: "Connect is not available in this build — nothing was authorized.",
    }),
    disconnect: async () => ({ ok: true, vaultRemoved: true, partitionCleared: true, errors: [] }),
  };
}

function renderHost(overrides: { accountsBridge?: WebFlixAccountsBridge | null } = {}) {
  return render(
    <WebFlixHost
      accountsBridge={overrides.accountsBridge === undefined ? null : overrides.accountsBridge}
      createLocalLibrary={fakeLocalLibrary}
      resolveOsPath={() => null}
      appVersion="9.9.9-host-test"
    />,
  );
}

describe("the product surface is WebFlix, end to end (requirement 2)", () => {
  it("renders the WebFlix product mark and the honest About line with the version", () => {
    const { container } = renderHost();
    expect(screen.getByTestId("webflix-product-mark")).toBeTruthy();
    const about = screen.getByTestId("webflix-about-line");
    expect(about.textContent).toContain("WebFlix 9.9.9-host-test");
    expect(about.textContent).toContain("independent desktop app");
    // The shell header brand is the shell theme name — WebFlix.
    expect(container.textContent).toContain("WebFlix");
  });

  it("no ZCode/Z.ai identity string leaks anywhere into the rendered product", () => {
    const { container } = renderHost();
    expect(container.innerHTML).not.toMatch(/ZCode|Z\.ai|zcode/i);
  });
});

describe("primary navigation — every functional-minimum screen mounts (requirement 3)", () => {
  it("renders all seven nav destinations (Home/Search/Library/Accounts/Ad Center/MI Evaluation/Settings)", () => {
    renderHost();
    for (const id of ["home", "search", "library", "accounts", "ads", "evaluation", "settings"]) {
      expect(screen.getByTestId(`nav-${id}`), `nav-${id}`).toBeTruthy();
    }
  });

  it("navigates between the functional-minimum screens", () => {
    renderHost();
    fireEvent.click(screen.getByTestId("nav-search"));
    expect(screen.getByTestId("search-input")).toBeTruthy();
    fireEvent.click(screen.getByTestId("nav-library"));
    expect(screen.getByTestId("library-local-empty")).toBeTruthy();
    fireEvent.click(screen.getByTestId("nav-accounts"));
    expect(screen.getByRole("region", { name: "Accounts" })).toBeTruthy();
    fireEvent.click(screen.getByTestId("nav-settings"));
    expect(screen.getByTestId("settings-root")).toBeTruthy();
    fireEvent.click(screen.getByTestId("nav-home"));
    expect(screen.getByTestId("home-library-empty")).toBeTruthy();
  });
});

describe("the local import path works with no network and no credentials (requirement 4)", () => {
  it("the real hidden file picker exists and the Library shows the real import affordance + honest empty state", () => {
    renderHost();
    expect(screen.getByTestId("webflix-local-file-input")).toBeTruthy();
    fireEvent.click(screen.getByTestId("nav-library"));
    const importButton = screen.getByTestId("library-import-local-files");
    expect(importButton.textContent).toContain("Import local files");
    const empty = screen.getByTestId("library-local-empty");
    expect(empty.textContent).toContain("session-only");
  });

  it("a picked file becomes a library entry (the REAL input → session → screen wiring)", () => {
    renderHost();
    const input = screen.getByTestId("webflix-local-file-input") as HTMLInputElement;
    const file = new File([new Uint8Array([1, 2, 3])], "holiday.mp4", { type: "video/mp4" });
    Object.defineProperty(input, "files", { value: [file] });
    fireEvent.change(input);

    fireEvent.click(screen.getByTestId("nav-library"));
    const entry = screen.getByText("holiday.mp4");
    expect(entry).toBeTruthy();
  });
});

describe("search is honest — no invented results (requirement 3/4)", () => {
  it("a keyword query lands on the truthful requires-auth state, verbatim", () => {
    renderHost();
    fireEvent.click(screen.getByTestId("nav-search"));
    fireEvent.change(screen.getByTestId("search-input"), { target: { value: "lofi beats" } });
    fireEvent.submit(screen.getByTestId("search-input").closest("form")!);

    const state = screen.getByTestId("search-requires-auth");
    // The frozen §2.3 honest copy — results are withheld, never faked.
    expect(state.textContent).toContain("Sign-in required");
    expect(state.textContent).toContain("connected account");
    // Re-submitting the same query goes through the SAME real flow —
    // the state stays the honest requires-auth one (no cache, no invention).
    fireEvent.submit(screen.getByTestId("search-input").closest("form")!);
    expect(screen.getByTestId("search-requires-auth")).toBeTruthy();
  });

  it("an official YouTube link navigates straight to the real official-embed watch view", () => {
    renderHost();
    fireEvent.click(screen.getByTestId("nav-search"));
    fireEvent.change(screen.getByTestId("search-input"), {
      target: { value: "https://youtu.be/dQw4w9WgXcQ" },
    });
    fireEvent.submit(screen.getByTestId("search-input").closest("form")!);

    // The WFX integration: the persistent watch dock hosts the player (the
    // old host-level webflix-watch-view wrapper is gone — the shell's dock
    // IS the watch view now; route "watch" renders it in the main area).
    const dock = screen.getByTestId("watch-dock");
    expect(dock).toBeTruthy();
    const embed = screen.getByTestId("watch-embed");
    expect(embed.getAttribute("src")).toContain(
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
    );
  });
});

describe("accounts — the real bridge boundary, fail-closed and typed (requirement 5)", () => {
  it("with NO bridge the fail-closed vault banner renders (nothing invented)", async () => {
    renderHost({ accountsBridge: null });
    const banner = await screen.findByTestId("webflix-vault-unavailable");
    expect(banner.textContent).toContain("Account storage is unavailable");
    expect(banner.textContent).toContain("account-bridge-unavailable");
    expect(banner.textContent).toContain("fail-closed");
    expect(banner.textContent).toContain("No credentials are stored insecurely");
  });

  it("with an available vault the banner stays hidden and the accounts screen stays honest", async () => {
    renderHost({ accountsBridge: availableBridge() });
    await waitFor(() => {
      expect(screen.queryByTestId("webflix-vault-unavailable")).toBeNull();
    });
    fireEvent.click(screen.getByTestId("nav-accounts"));
    expect(screen.getByRole("region", { name: "Accounts" })).toBeTruthy();
  });

  it("connect reports the typed honest outcome — never a fake flow", async () => {
    renderHost({ accountsBridge: availableBridge() });
    fireEvent.click(screen.getByTestId("nav-accounts"));
    const connectButton = screen.getByText("Connect", { selector: "button" });
    fireEvent.click(connectButton);
    const outcome = await screen.findByTestId("connect-outcome-youtube");
    expect(outcome.textContent).toContain("nothing was authorized");
  });
});

describe("Ad Center / MI Evaluation mount their engines' truthful never-run states (requirement 3)", () => {
  it("Ad Center shows its honest no-results state", () => {
    renderHost();
    fireEvent.click(screen.getByTestId("nav-ads"));
    // The Ad Center panel's own truthful never-run state (adCenterResults null).
    expect(screen.getByTestId("ad-center-panel-root")).toBeTruthy();
    expect(screen.getByTestId("ad-center-panel-empty")).toBeTruthy();
  });

  it("MI Evaluation states no ranking adapter is wired (the honest status note)", () => {
    renderHost();
    fireEvent.click(screen.getByTestId("nav-evaluation"));
    const note = screen.getByText(/No ranking adapter is wired/, { exact: false });
    expect(note).toBeTruthy();
  });
});
