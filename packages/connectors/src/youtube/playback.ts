/**
 * YouTube IFrame Player embed-spec builder — PlaybackPlan (official-embed).
 *
 * ADR-0003: playback uses ONLY the official IFrame Player embed. No stream
 * extraction, no signature deciphering, no third-party players, no /get_video_info
 * style endpoints. Only official player parameters (developers.google.com/youtube/
 * player_parameters) are emitted, and enablejsapi is only enabled when a pinned
 * origin is supplied (the official recommendation for the JS API).
 */
import type { PlaybackPlan, ProvenanceCitation } from 'webflix-contracts';
import { YOUTUBE_PROVIDER_ID } from './manifest';

const OFFICIAL_IFRAME_API_REFERENCE: ProvenanceCitation = {
  label: 'YouTube IFrame Player API reference (official)',
  url: 'https://developers.google.com/youtube/iframe_api_reference',
};
const OFFICIAL_PLAYER_PARAMETERS: ProvenanceCitation = {
  label: 'YouTube embedded player and player parameters (official)',
  url: 'https://developers.google.com/youtube/player_parameters',
};
const OFFICIAL_PRIVACY_ENHANCED_MODE: ProvenanceCitation = {
  label: 'YouTube privacy-enhanced mode — youtube-nocookie.com (official help)',
  url: 'https://support.google.com/youtube/answer/171780',
};

/** Official video ids are exactly 11 characters of [A-Za-z0-9_-]. */
export const YOUTUBE_VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

export class InvalidVideoIdError extends Error {
  constructor(videoId: string) {
    super(
      `not a valid YouTube video id: "${videoId}" (official ids are 11 chars of [A-Za-z0-9_-]); refusing to build a playback plan`,
    );
    this.name = 'InvalidVideoIdError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export interface YouTubePlaybackOptions {
  videoId: string;
  title?: string;
  /** Pinned origin (e.g. 'https://app.webflix.local') — required to enable the IFrame JS API. */
  origin?: string;
  startSeconds?: number;
  autoplay?: boolean;
  controls?: boolean;
  /** Official `rel` player parameter (related videos in the embed end-screen). */
  relatedVideos?: boolean;
  playsInline?: boolean;
  /** Privacy-enhanced mode: youtube-nocookie.com (official embed domain variant). Default true. */
  privacyEnhanced?: boolean;
  captions?: boolean;
  captionsLanguage?: string;
  interfaceLanguage?: string;
  width?: number;
  height?: number;
}

export const DEFAULT_EMBED_WIDTH = 560;
export const DEFAULT_EMBED_HEIGHT = 315;
export const OFFICIAL_IFRAME_ALLOW =
  'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';

export function buildYouTubePlaybackPlan(options: YouTubePlaybackOptions): PlaybackPlan {
  const videoId = options.videoId;
  if (!YOUTUBE_VIDEO_ID_PATTERN.test(videoId)) {
    throw new InvalidVideoIdError(videoId);
  }

  const privacyEnhanced = options.privacyEnhanced ?? true;
  const origin = options.origin ?? null;

  const playerVars: Record<string, string | number> = {
    autoplay: options.autoplay ? 1 : 0,
    controls: options.controls === false ? 0 : 1,
    rel: options.relatedVideos ? 1 : 0,
    playsinline: options.playsInline === false ? 0 : 1,
  };
  if (options.startSeconds !== undefined && options.startSeconds > 0) {
    playerVars.start = Math.floor(options.startSeconds);
  }
  if (origin !== null) {
    playerVars.enablejsapi = 1;
    playerVars.origin = origin;
  }
  if (options.captions) {
    playerVars.cc_load_policy = 1;
  }
  if (options.captionsLanguage) {
    playerVars.cc_lang_pref = options.captionsLanguage;
  }
  if (options.interfaceLanguage) {
    playerVars.hl = options.interfaceLanguage;
  }

  const host = privacyEnhanced ? 'https://www.youtube-nocookie.com/embed/' : 'https://www.youtube.com/embed/';
  const url = new URL(host + videoId);
  for (const [key, value] of Object.entries(playerVars)) {
    url.searchParams.set(key, String(value));
  }

  const notes = [
    'Official IFrame embed only (ADR-0003); no stream extraction or signature deciphering.',
    origin
      ? `enablejsapi is paired with a pinned origin ("${origin}") per the official player parameters reference.`
      : 'No origin supplied: the IFrame JS API is not enabled (enablejsapi requires a pinned origin in this design).',
    privacyEnhanced
      ? 'Privacy-enhanced mode (youtube-nocookie.com) is the official embed domain variant.'
      : 'Standard youtube.com embed domain requested.',
  ];

  return {
    kind: 'official-embed',
    providerId: YOUTUBE_PROVIDER_ID,
    videoId,
    embedUrl: url.toString(),
    iframe: {
      width: options.width ?? DEFAULT_EMBED_WIDTH,
      height: options.height ?? DEFAULT_EMBED_HEIGHT,
      title: options.title ?? `YouTube player — ${videoId}`,
      allow: OFFICIAL_IFRAME_ALLOW,
      allowFullScreen: true,
      referrerPolicy: 'strict-origin-when-cross-origin',
      style: 'border: 0;',
    },
    playerVars,
    provenance: [OFFICIAL_IFRAME_API_REFERENCE, OFFICIAL_PLAYER_PARAMETERS, OFFICIAL_PRIVACY_ENHANCED_MODE],
    notes,
  };
}
