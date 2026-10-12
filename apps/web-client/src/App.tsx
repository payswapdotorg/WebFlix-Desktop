import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AppShell } from "webflix-shell";

import { InMemoryRankerSelectionStore } from "webflix-application";
import type { AdsQualificationItemOutcome } from "webflix-application";
import type { TransparencySourceManifest } from "webflix-shell";

import {
  ModeRoutingRankerSelectionStore,
  PERSISTENCE_MODES,
  composePersistenceNotice,
} from "./persistence";
import type {
  PersistenceBootstrap,
  PersistenceMode,
  PersistenceSettingStatus,
} from "./persistence";
import { UNAVAILABLE_SURFACES } from "./unavailable-surfaces";
import { InstallAffordance } from "./install-affordance";
import {
  createWebClientSession,
  qualificationItemOutcomes,
  rankerStatusNoteFor,
  sourceManifestLines,
} from "./session";

/**
 * P6-DURABLE-WEB-1 — the web client App: the host wrapper that COMPOSES the
 * frozen webflix-shell (AppShell, all six post-COMPOSITION screens) over a
 * browser-safe application layer (the in-memory doubles + the real use
 * cases — see ./session.ts), now with the explicitly-designed DURABLE
 * persistence seam (see ./persistence/).
 *
 * Honesty rules this host pins:
 * - PERSISTENCE MODE, TYPED + LABELED (plan §4 + WF-029): the mode is the
 *   typed union ("session-only" | "durable"); the notice states the ACTUAL
 *   active mode and its lines are COMPOSED FROM TYPED DATA
 *   (composePersistenceNotice) — no "saved" wording when session-only, no
 *   durable claim when degraded;
 * - EXPLICIT USER CONTROL: the mode is a discoverable host SETTING (the
 *   select below — default session-only unless opted in), persisted in
 *   IndexedDB itself; the bootstrap read ran BEFORE mount (main.tsx), so
 *   the first render already states the stored choice;
 * - GRACEFUL DEGRADATION: when IndexedDB is unavailable the bootstrap
 *   resolves typed-degraded, the notice surfaces the reason, and the
 *   control disables — the session-only fallback is stated, never implied;
 * - FORGET (WF-029): Clear durable data wipes every persisted record and
 *   resets to the first-run default;
 * - UNAVAILABLE SURFACES ARE DATA (plan §5): connector/engine surfaces
 *   render their typed unavailable declarations — named, with the desktop
 *   path named (./unavailable-surfaces);
 * - the Ad Center / MI Evaluation surfaces stay live through the REAL use
 *   cases; the ranker selection rides the mode-routing store (the host's
 *   EXISTING RankerSelectionStore seam — durable when opted in, in-memory
 *   otherwise; zero application-layer changes);
 * - NO network calls, NO keys, NO analytics; NO localStorage /
 *   sessionStorage anywhere (rg-provable: IndexedDB is the only durable
 *   mechanism, written only through the typed stores).
 */

/** The App's one injected dependency: the pre-mount bootstrap read's typed outcome. */
export interface AppProps {
  readonly persistence: PersistenceBootstrap;
}

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
  settingRow: { display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-start" },
  settingLabel: { margin: 0, fontSize: 13, fontWeight: 600, color: "#9aa8c0" },
  select: {
    background: "#0f1420",
    color: "#c8d4ea",
    border: "1px solid #2c3a58",
    borderRadius: 4,
    padding: "6px 12px",
    fontSize: 13,
    maxWidth: "100%",
    // P6-MOBILE-AUDIT-1: the touch-target bar (>= 44px) for the host's own
    // persistence control — a host-level style fix (this file is the host).
    minHeight: 44,
  },
  runButton: {
    alignSelf: "flex-start",
    background: "transparent",
    color: "#9aa8c0",
    border: "1px solid #2c3a58",
    borderRadius: 4,
    padding: "6px 12px",
    cursor: "pointer",
    fontSize: 13,
    // P6-MOBILE-AUDIT-1: the touch-target bar (>= 44px) for the host's own
    // run/forget buttons — host-level style fixes (this file is the host).
    minHeight: 44,
  },
};

export function App({ persistence }: AppProps) {
  // The ACTIVE persistence mode — the bootstrap's honest initial state
  // (the stored choice, the first-run default, or the degraded fallback).
  const [activeMode, setActiveMode] = useState<PersistenceMode>(
    persistence.status === "ok" ? persistence.initialMode : "session-only",
  );
  // The routing store reads the mode at CALL time — a ref keeps it live.
  const modeRef = useRef<PersistenceMode>(activeMode);
  const [settingStatus, setSettingStatus] = useState<PersistenceSettingStatus>(
    persistence.status === "ok" ? persistence.settingStatus : "first-run",
  );
  const [durableSelectionPresent, setDurableSelectionPresent] = useState(
    persistence.status === "ok" ? persistence.durableSelectionPresent : false,
  );

  // The mode-routing selection seam: ONE RankerSelectionStore interface,
  // routed by the active mode (in-memory double / IndexedDB-backed durable
  // adapter) — the application layer's use cases never know the mode.
  const routingStore = useMemo(
    () =>
      new ModeRoutingRankerSelectionStore({
        memory: new InMemoryRankerSelectionStore(),
        durable: persistence.status === "ok" ? persistence.durable.selectionStore : null,
        getMode: () => modeRef.current,
      }),
    [persistence],
  );

  // One session per mount — the tab session's whole honest lifetime.
  const session = useMemo(
    () => createWebClientSession({ rankerSelectionStore: routingStore }),
    [routingStore],
  );

  // The Ad Center / MI Evaluation live state — never-run defaults first.
  const [adCenterResults, setAdCenterResults] = useState<
    readonly AdsQualificationItemOutcome[] | null
  >(null);
  const [selectedAdapterId, setSelectedAdapterId] = useState<string | null>(null);
  const [rankerStatusNote, setRankerStatusNote] = useState<string | null>(null);
  const [sourceManifests, setSourceManifests] = useState<
    readonly TransparencySourceManifest[] | null
  >(null);

  // The restore read: when the active mode is durable, the persisted
  // selection (if any) re-enters the session's UI through the REAL resolve
  // use case — the durable mode's visible benefit, honestly worded.
  useEffect(() => {
    let active = true;
    session.rankerSelectionStore
      .get()
      .then((stored) => {
        if (!active || stored === null) {
          return;
        }
        return session.resolveSelectedRanker.resolve().then((resolved) => {
          if (!active) {
            return;
          }
          setSelectedAdapterId(stored.adapterId);
          setRankerStatusNote(
            modeRef.current === "durable"
              ? `Restored from durable storage — ${rankerStatusNoteFor(resolved, modeRef.current)}`
              : rankerStatusNoteFor(resolved, modeRef.current),
          );
        });
      })
      .catch(() => {
        // An unreadable record stays ABSENT here — absence stated, never
        // invented (the leftover note + clear control cover the record).
      });
    return () => {
      active = false;
    };
  }, [session]);

  // The transparency sources' coverage declarations (a pure in-registry
  // listing — no transport exists yet anywhere, by design; the states ARE
  // the data).
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
  // the routing store, then a REAL resolve — the status note carries the
  // resolution metadata verbatim, worded by the ACTIVE mode.
  const handleRankerSelection = useCallback(
    async (adapterId: string) => {
      await session.setRankerSelection.set(adapterId);
      const resolved = await session.resolveSelectedRanker.resolve();
      setSelectedAdapterId(adapterId);
      setRankerStatusNote(rankerStatusNoteFor(resolved, modeRef.current));
    },
    [session],
  );

  // The persistence setting's live wiring — the deliberate opt-in control.
  const handleModeChange = useCallback(
    async (next: PersistenceMode) => {
      if (persistence.status !== "ok" || next === modeRef.current) {
        return; // degraded: nothing to persist (the control disables anyway)
      }
      if (next === "durable") {
        // Opt-in migration: carry the CURRENT live selection (if any) into
        // durable storage so the user's explicit choice survives — stated,
        // never implied. (The routing store still reads memory at this
        // point, which is exactly the current live choice.)
        const current = await routingStore.get();
        if (current !== null) {
          await persistence.durable.selectionStore.put(current);
          setDurableSelectionPresent(true);
        }
      }
      // The choice is persisted in IndexedDB ITSELF — this is the write
      // that makes the opt-in stick across visits.
      await persistence.durable.modeStore.put(next);
      modeRef.current = next;
      setActiveMode(next);
      setSettingStatus("stored");
      if (selectedAdapterId !== null) {
        const resolved = await session.resolveSelectedRanker.resolve();
        setRankerStatusNote(rankerStatusNoteFor(resolved, next));
      }
    },
    [persistence, routingStore, session, selectedAdapterId],
  );

  // FORGET (WF-029): wipe every persisted record + reset the live session
  // to the first-run default — the retention control, honestly worded.
  const handleClearDurable = useCallback(async () => {
    if (persistence.status !== "ok") {
      return;
    }
    await persistence.durable.clearAll();
    modeRef.current = "session-only";
    setActiveMode("session-only");
    setSettingStatus("first-run");
    setDurableSelectionPresent(false);
    await routingStore.clear();
    setSelectedAdapterId(null);
    setRankerStatusNote(
      "Durable data cleared — the setting and the saved selection are forgotten; " +
        "the session-only default applies.",
    );
  }, [persistence, routingStore]);

  // The Ad Center's live read: ads.qualify over the session's CURRENT stored
  // records (a fresh session stores none — the honest empty outcome).
  const runQualification = useCallback(async () => {
    const outcomes = await qualificationItemOutcomes(session);
    setAdCenterResults(outcomes);
  }, [session]);

  const manifestLines = sourceManifests === null ? [] : sourceManifestLines(sourceManifests);

  // Every persistence claim the UI makes, composed from typed data.
  const noticeLines = composePersistenceNotice({
    activeMode,
    degraded: persistence.status === "degraded" ? { reason: persistence.reason } : null,
    settingStatus,
    durableSelectionPresent,
  });

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
        <div style={hostStyles.settingRow}>
          <label
            htmlFor="persistence-mode-control"
            style={hostStyles.settingLabel}
            data-testid="persistence-setting-label"
          >
            Persistence setting
          </label>
          <select
            id="persistence-mode-control"
            style={hostStyles.select}
            data-testid="persistence-mode-control"
            value={activeMode}
            disabled={persistence.status === "degraded"}
            onChange={(event) => {
              const next = event.target.value;
              if (next === "session-only" || next === "durable") {
                void handleModeChange(next);
              }
            }}
          >
            {PERSISTENCE_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {mode === "session-only"
                  ? "Session-only (default — nothing saved)"
                  : "Durable (save the setting + ranker selection in this browser)"}
              </option>
            ))}
          </select>
          {persistence.status === "ok" ? (
            <button
              type="button"
              style={hostStyles.runButton}
              data-testid="clear-durable-data"
              onClick={() => {
                void handleClearDurable();
              }}
            >
              Clear durable data (forget)
            </button>
          ) : null}
        </div>

        <p style={hostStyles.notice} data-testid="persistence-mode-notice">
          {noticeLines.join(" ")} (persistence mode: {activeMode})
        </p>

        <h3 style={hostStyles.chromeHeading}>Not available in this web client</h3>
        <ul style={hostStyles.list}>
          {UNAVAILABLE_SURFACES.map((surface) => (
            <li key={surface.surfaceId} data-testid={`unavailable-${surface.surfaceId}`}>
              {surface.reason} Desktop path: {surface.desktopPath}.
            </li>
          ))}
        </ul>

        {/* P6-PWA-1: the install affordance — the pinned honest claim. */}
        <h3 style={hostStyles.chromeHeading}>Install</h3>
        <InstallAffordance />

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
