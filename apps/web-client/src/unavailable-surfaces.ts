/**
 * P6-WEB-HOST-1 — unavailable-surface honesty, TYPED (phase6-clients-plan §5:
 * network/key honesty; §4: the runtime-seam law).
 *
 * Connector and engine surfaces that need user authorization, API keys, or
 * the Node runtime are NOT wired in this web host — no key smuggling, no
 * network from the host. Each such surface is declared here as TYPED data
 * (a named surface, a named reason, a named desktop path) and rendered in
 * the host chrome, so an unavailable capability is stated — never implied
 * away, never faked as working.
 */

/** The typed unavailable-surface declaration (the state IS the data). */
export interface UnavailableSurface {
  /** The named surface that is unavailable on the web runtime. */
  readonly surfaceId: string;
  /** The honest state — this registry only ever declares "unavailable". */
  readonly state: "unavailable";
  /** Why, plainly: what the surface needs that the web host does not have. */
  readonly reason: string;
  /** Where the capability actually lives (the desktop path, named). */
  readonly desktopPath: string;
}

/** Every web-unavailable surface, named with its desktop path. */
export const UNAVAILABLE_SURFACES: readonly UnavailableSurface[] = [
  {
    surfaceId: "provider-connectors",
    state: "unavailable",
    reason:
      "Connecting a provider account needs OAuth authorization and network access; " +
      "this web host wires no connectors and makes no network calls.",
    desktopPath: "packages/connectors — provider accounts connect on the desktop host",
  },
  {
    surfaceId: "durable-local-library",
    state: "unavailable",
    reason:
      "The durable local library runs on better-sqlite3, a Node-only native binding; " +
      "the web host never imports the local-library package.",
    desktopPath: "packages/local-library — the durable library is a desktop capability",
  },
  {
    surfaceId: "real-mi-engines",
    state: "unavailable",
    reason:
      "Real media-intelligence engines (local whisper.cpp transcription, TTS) need the " +
      "Node runtime and machine-bound binaries; only the labeled deterministic " +
      "fixture-replay doubles are browser-safe.",
    desktopPath:
      "packages/local-library adapters seam — machine-bound engines run on the desktop host",
  },
  {
    surfaceId: "ad-transparency-transport",
    state: "unavailable",
    reason:
      "Querying ad-transparency sources needs an authorized transport and network access; " +
      "the sources' own manifests declare their access states (blocked or " +
      "pending-authorization) and those states are shown as data, never faked as available.",
    desktopPath:
      "the transparency-source adapters' authorized transport lands on the desktop host first",
  },
] as const;
