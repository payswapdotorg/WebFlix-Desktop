import React, { useCallback, useEffect, useMemo, useState } from "react";

import { AppShell } from "webflix-shell";

import type { AdsQualificationItemOutcome } from "webflix-application";
import type { TransparencySourceManifest } from "webflix-shell";

import { PERSISTENCE_MODE, SESSION_ONLY_NOTICE } from "./persistence";
import { UNAVAILABLE_SURFACES } from "./unavailable-surfaces";
import {
  createWebClientSession,
  qualificationItemOutcomes,
  rankerStatusNoteFor,
  sourceManifestLines,
} from "./session";

/**
 * P6-WEB-HOST-1 — the web client App: the host wrapper that COMPOSES the
 * frozen webflix-shell (AppShell, all six post-COMPOSITION screens) over a
 * session-only application layer (the in-memory doubles + the real use
 * cases — see ./session.ts).
 *
 * Honesty rules this host pins:
 * - SESSION-ONLY, TYPED + LABELED (plan §4): PERSISTENCE_MODE is a typed
 *   literal and the notice renders permanently in the host chrome — nothing
 *   claims "saved", nothing is durable, no web-storage token exists in this
 *   app (rg-provable);
 * - UNAVAILABLE SURFACES ARE DATA (plan §5): connector/engine surfaces that
 *   need authorization, keys, or Node render their typed unavailable
 *   declarations — named, with the desktop path named (./unavailable-surfaces);
 * - the Ad Center / MI Evaluation surfaces mount with their honest
 *   never-run empty states and go live ONLY through real use-case runs
 *   (the selector selection persists in the SESSION store; the
 *   qualification read runs over the session's CURRENT stored records —
 *   an empty session yields the honest empty outcome, never fake data);
 * - the transparency sources' coverage declarations render from the
 *   application layer's own manifests (ads.sourceManifests) — the blocked /
 *   pending-authorization states shown as data, never as failure;
 * - NO network calls, NO keys, NO analytics (rg-provable: zero network
 *   tokens in this app's source).
 */

const hostStyles: Record<string, React.CSSProperties> = {
  root: { minHeight: "100vh", background: "#0f1420" },
  chrome: {
    borderTop: "1px solid #2c3a58",
    marginTop: 16,
    padding: "12px 16px",
    color: "#9aa8c0",
    fontSize: 13,
    lineHeight: 1.6,
    display: "flex",
    flexDirection: "column",
    gap: 12,
  },
  chromeHeading: { margin: 0, fontSize: 13, fontWeight: 600, color: "#9aa8c0" },
  notice: { margin: 0 },
  list: { margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 6 },
  runButton: {
    alignSelf: "flex-start",
    background: "transparent",
    color: "#9aa8c0",
    border: "1px solid #2c3a58",
    borderRadius: 4,
    padding: "6px 12px",
    cursor: "pointer",
    fontSize: 13,
  },
};

export function App() {
  // One session per mount — the tab session's whole honest lifetime.
  const session = useMemo(() => createWebClientSession(), []);

  // The Ad Center / MI Evaluation live state — never-run defaults first.
  const [adCenterResults, setAdCenterResults] = useState<
    readonly AdsQualificationItemOutcome[] | null
  >(null);
  const [selectedAdapterId, setSelectedAdapterId] = useState<string | null>(null);
  const [rankerStatusNote, setRankerStatusNote] = useState<string | null>(null);
  const [sourceManifests, setSourceManifests] = useState<
    readonly TransparencySourceManifest[] | null
  >(null);

  // The one mount effect: read the transparency sources' coverage
  // declarations (a pure in-registry listing — no transport exists yet
  // anywhere, by design; the states ARE the data).
  useEffect(() => {
    let active = true;
    session.readSourceManifests
      .execute({})
      .then((output) => {
        if (active && output.report !== null) setSourceManifests(output.report.manifests);
      })
      .catch(() => {
        // Unexpected programming defect: leave the declarations absent —
        // nothing is invented to fill the gap (absence stays honest).
      });
    return () => {
      active = false;
    };
  }, [session]);

  // The selector's live wiring: a REAL SetRankerAdapterSelection run through
  // the session store, then a REAL resolve — the status note carries the
  // resolution metadata verbatim (default / selected / fail-soft).
  const handleRankerSelection = useCallback(
    async (adapterId: string) => {
      await session.setRankerSelection.set(adapterId);
      const resolved = await session.resolveSelectedRanker.resolve();
      setSelectedAdapterId(adapterId);
      setRankerStatusNote(rankerStatusNoteFor(resolved));
    },
    [session],
  );

  // The Ad Center's live read: ads.qualify over the session's CURRENT stored
  // records (a fresh session stores none — the honest empty outcome).
  const runQualification = useCallback(async () => {
    const outcomes = await qualificationItemOutcomes(session);
    setAdCenterResults(outcomes);
  }, [session]);

  const manifestLines = sourceManifests === null ? [] : sourceManifestLines(sourceManifests);

  return (
    <div style={hostStyles.root}>
      <AppShell
        accounts={[]}
        recentItems={[]}
        collections={[]}
        localEntries={[]}
        searchState={{ phase: "idle" }}
        adCenterResults={adCenterResults}
        evaluationResult={null}
        rankerAdapterEntries={session.rankerDescriptors}
        rankerSelectedAdapterId={selectedAdapterId}
        onRankerAdapterSelectionChange={(adapterId) => {
          void handleRankerSelection(adapterId);
        }}
        rankerStatusNote={rankerStatusNote}
      />

      {/* Host chrome — the honesty block (ADR-0003 notice pattern: plain, permanent). */}
      <section
        style={hostStyles.chrome}
        aria-label="Web client runtime honesty"
        data-testid="host-honesty-chrome"
      >
        <p style={hostStyles.notice} data-testid="session-only-notice">
          {SESSION_ONLY_NOTICE} (persistence mode: {PERSISTENCE_MODE})
        </p>

        <h3 style={hostStyles.chromeHeading}>Not available in this web client</h3>
        <ul style={hostStyles.list}>
          {UNAVAILABLE_SURFACES.map((surface) => (
            <li key={surface.surfaceId} data-testid={`unavailable-${surface.surfaceId}`}>
              {surface.reason} Desktop path: {surface.desktopPath}.
            </li>
          ))}
        </ul>

        <h3 style={hostStyles.chromeHeading}>
          Ad transparency sources (as their manifests declare)
        </h3>
        {manifestLines.length === 0 ? (
          <p style={hostStyles.notice} data-testid="source-manifests-absent">
            Source coverage declarations not read — nothing is shown rather than invented.
          </p>
        ) : (
          <ul style={hostStyles.list}>
            {manifestLines.map((line) => (
              <li key={line} data-testid="source-manifest-line">
                {line}
              </li>
            ))}
          </ul>
        )}

        <button
          type="button"
          style={hostStyles.runButton}
          data-testid="run-qualification"
          onClick={() => {
            void runQualification();
          }}
        >
          Run ads.qualify over the session's stored ad records
        </button>
      </section>
    </div>
  );
}
