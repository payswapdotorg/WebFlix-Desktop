/**
 * Twitch official embed player playback-plan builder — canonical PlaybackPlan
 * (official-embed), the same frozen §2.2 discipline as YouTube's IFrame and
 * TikTok's embed builders.
 *
 * OFFICIAL MECHANISM (Embedding Video and Clips doc, dev.twitch.tv):
 *   <iframe
 *     src="https://player.twitch.tv/?channel=<login>&parent=<parent-host>"
 *     height="720" width="1280" allowfullscreen>
 *   </iframe>
 * The same player surface plays VODs (?video=<id>&parent=…) and clips
 * (?clip=<slug>&parent=…).
 *
 * PARENT-PARAMETER INVESTIGATION (the work order's explicit ask; live-verified
 * 2026-10-11 from this work order's sandbox — every claim below was probed):
 *   - parent is REQUIRED. Without it the player answers
 *       HTTP 302 → /embed-error.html?errorCode=NoParent&content=<self>
 *     (no error page guessing — the connector refuses to build a plan whose
 *     player would land on an embed-error page).
 *   - parent is the HOSTNAME of the embedding page's origin (no scheme, no
 *     path, no port — the docs' parent=example.com shape).
 *   - With parent, the player response carries a matching restrictive CSP:
 *       parent=app.webflix.local → Content-Security-Policy: frame-ancestors https://app.webflix.local
 *       parent=localhost         → Content-Security-Policy: frame-ancestors http://localhost:* https://localhost:*
 *     i.e. the player pins frame-ancestors to EXACTLY the parent the caller
 *     declared — the parent parameter is the embed's framing allow-list.
 *   - Desktop-webview meaning (integration note, parity matrix §parent): the
 *     desktop app renders the player inside an embedded webview whose content
 *     loads from the app's own origin. DEV TIME: the documented localhost/dev
 *     origin (parent=localhost — live-verified above). PRODUCTION: the origin
 *     the shipping webview loads content from must be pinned at integration
 *     time (a fixed app hostname or the custom-scheme origin host); that
 *     decision belongs to the operator/integration step and is recorded in
 *     the parity matrix, NOT guessed in code.
 *
 * The builder therefore takes `parent` as an EXPLICIT, validated, required
 * input and never defaults it — an omitted or malformed parent throws
 * MissingTwitchParentError instead of silently guessing an origin the caller
 * did not declare. The mechanism maps CLEANLY onto the frozen official-embed
 * plan {kind, providerId, embedSpec: SecretFreeRecord}: videoId (the watch
 * target), embedUrl, domain, iframe attributes, mechanism, notes and
 * provenance citations all fold into embedSpec. No shapes are forced; no
 * freeze deviation is needed for the embed path.
 *
 * ADR-0003: playback uses ONLY the official player.twitch.tv embed. No
 * stream extraction, no .m3u8 fetching, no third-party players, no
 * undocumented endpoints.
 */
import type { PlaybackPlan } from "webflix-contracts";
import { TWITCH_PLAYER_URL, TWITCH_PROVIDER_ID } from "./manifest";

/**
 * Official-documentation citation (connector-local; not a contract shape —
 * Twitch-suffixed so it does not collide with the YouTube/TikTok playback
 * modules' identically-shaped citation notes in the package surface).
 */
export interface TwitchCitationNote {
  label: string;
  url: string;
}

const OFFICIAL_EMBED_DOC: TwitchCitationNote = {
  label:
    "Embedding Video and Clips — player.twitch.tv iframe with the required parent parameter (official)",
  url: "https://dev.twitch.tv/docs/embed/video-and-clips/",
};
const OFFICIAL_EMBED_OVERVIEW: TwitchCitationNote = {
  label: "Embedding Everything — Twitch embeds overview (official)",
  url: "https://dev.twitch.tv/docs/embed/everything/",
};

/** A hostname-shaped parent value: alphanumerics, dots, hyphens (no scheme/path/port). */
const PARENT_HOSTNAME_PATTERN =
  /^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)*$/;

/** The documented dev-time origin for the parent parameter (live-verified 2026-10-11). */
export const TWITCH_DEV_PARENT = "localhost";

export class MissingTwitchParentError extends Error {
  constructor(detail: string) {
    super(
      `refusing to build a Twitch player plan: ${detail} The parent parameter is REQUIRED (live-verified: without it player.twitch.tv answers 302 /embed-error.html?errorCode=NoParent). Pass the embedding page's origin hostname explicitly — dev time uses "${TWITCH_DEV_PARENT}"; the production origin is an integration decision recorded in the parity matrix.`,
    );
    this.name = "MissingTwitchParentError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class InvalidTwitchWatchTargetError extends Error {
  constructor(detail: string) {
    super(`not a valid Twitch watch target: ${detail}`);
    this.name = "InvalidTwitchWatchTargetError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** The watch target the official player accepts. */
export type TwitchPlayerTarget =
  | { kind: "channel"; login: string }
  | { kind: "video"; videoId: string }
  | { kind: "clip"; clipId: string };

export interface TwitchPlaybackOptions {
  target: TwitchPlayerTarget;
  /**
   * REQUIRED: the hostname of the embedding page's origin (e.g.
   * "localhost" at dev time). Validated, never defaulted — see the module
   * header for the live-verified mechanism and the integration note.
   */
  parent: string;
  title?: string;
  /** Official documented player params; omitted from the URL unless set. */
  autoplay?: boolean;
  muted?: boolean;
  width?: number;
  height?: number;
}

export const DEFAULT_TWITCH_EMBED_WIDTH = 1280;
export const DEFAULT_TWITCH_EMBED_HEIGHT = 720;
export const OFFICIAL_TWITCH_EMBED_ALLOW = "autoplay; fullscreen; picture-in-picture";

const LOGIN_PATTERN = /^[A-Za-z0-9_]{3,25}$/;
const VIDEO_ID_PATTERN = /^\d{5,20}$/;
const CLIP_ID_PATTERN = /^[A-Za-z0-9_-]{3,120}$/;

function validateTarget(target: TwitchPlayerTarget): void {
  if (!target || typeof target !== "object") {
    throw new InvalidTwitchWatchTargetError("no target object given");
  }
  if (target.kind === "channel") {
    if (!LOGIN_PATTERN.test(target.login ?? "")) {
      throw new InvalidTwitchWatchTargetError(
        `channel login "${String(target.login)}" is not a Twitch login (3–25 chars of [A-Za-z0-9_])`,
      );
    }
    return;
  }
  if (target.kind === "video") {
    if (!VIDEO_ID_PATTERN.test(target.videoId ?? "")) {
      throw new InvalidTwitchWatchTargetError(
        `video id "${String(target.videoId)}" is not a numeric Twitch video id`,
      );
    }
    return;
  }
  if (target.kind === "clip") {
    if (!CLIP_ID_PATTERN.test(target.clipId ?? "")) {
      throw new InvalidTwitchWatchTargetError(
        `clip id "${String(target.clipId)}" is not a Twitch clip slug`,
      );
    }
    return;
  }
  throw new InvalidTwitchWatchTargetError(
    `unknown target kind "${String((target as { kind?: string }).kind)}"`,
  );
}

function requireParent(parent: string | undefined): string {
  if (typeof parent !== "string" || parent === "") {
    throw new MissingTwitchParentError("no parent parameter was supplied.");
  }
  if (!PARENT_HOSTNAME_PATTERN.test(parent)) {
    throw new MissingTwitchParentError(
      `parent "${parent}" is not a bare hostname (expected e.g. "localhost" or "app.webflix.local" — no scheme, path or port).`,
    );
  }
  return parent;
}

/**
 * Builds the canonical PlaybackPlan for Twitch playback (official embed
 * player). Total and honest:
 *   - malformed watch target      → InvalidTwitchWatchTargetError
 *   - missing/malformed parent    → MissingTwitchParentError (never guessed)
 *   - otherwise                   → official-embed plan whose
 *     embedSpec.embedUrl is the official player URL with the parent pinned.
 */
export function buildTwitchPlaybackPlan(options: TwitchPlaybackOptions): PlaybackPlan {
  validateTarget(options?.target);
  const parent = requireParent(options?.parent);

  const params = new URLSearchParams({ parent });
  let targetKey: string;
  let targetValue: string;
  let watchId: string;
  switch (options.target.kind) {
    case "channel":
      targetKey = "channel";
      targetValue = options.target.login;
      watchId = options.target.login;
      break;
    case "video":
      targetKey = "video";
      targetValue = options.target.videoId;
      watchId = options.target.videoId;
      break;
    default:
      targetKey = "clip";
      targetValue = options.target.clipId;
      watchId = options.target.clipId;
      break;
  }
  params.set(targetKey, targetValue);
  if (options.autoplay !== undefined) params.set("autoplay", options.autoplay ? "true" : "false");
  if (options.muted !== undefined) params.set("muted", options.muted ? "true" : "false");
  const embedUrl = `${TWITCH_PLAYER_URL}/?${params.toString()}`;

  const notes = [
    "Official player.twitch.tv embed only (ADR-0003); no stream extraction, no .m3u8 fetching, no third-party players.",
    `parent="${parent}" pins the player's frame-ancestors to this origin (live-verified 2026-10-11: the player serves Content-Security-Policy: frame-ancestors matching the declared parent, and answers 302 /embed-error.html?errorCode=NoParent without one).`,
    "Dev-time parent is the documented localhost origin; the production webview origin is an integration decision recorded in the parity matrix — this builder never guesses it.",
    "autoplay/muted are the documented optional player parameters and are only emitted when explicitly set.",
  ];

  return {
    kind: "official-embed",
    providerId: TWITCH_PROVIDER_ID,
    embedSpec: {
      videoId: watchId,
      embedUrl,
      domain: "player.twitch.tv",
      iframe: {
        width: options.width ?? DEFAULT_TWITCH_EMBED_WIDTH,
        height: options.height ?? DEFAULT_TWITCH_EMBED_HEIGHT,
        title: options.title ?? `Twitch player — ${targetKey} ${watchId}`,
        allow: OFFICIAL_TWITCH_EMBED_ALLOW,
        allowFullScreen: true,
        referrerPolicy: "strict-origin-when-cross-origin",
        style: "border: 0; max-width: 100%;",
      },
      mechanism: {
        kind: "official-embed-player",
        playerUrl: embedUrl,
        parentParameter: parent,
        documentedAlternative: `<iframe src="${embedUrl}" allowfullscreen> (the doc's own embed markup shape)`,
      },
      notes,
      provenance: [OFFICIAL_EMBED_DOC, OFFICIAL_EMBED_OVERVIEW],
    },
  };
}
