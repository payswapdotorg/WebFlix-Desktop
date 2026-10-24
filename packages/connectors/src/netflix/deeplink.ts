/**
 * WFX-NETFLIX-SOURCE-1 — ADR 0002 §1 (ported verbatim from the web app's
 * src/lib/netflix/deeplink.ts): the ONLY place in this package allowed to
 * construct a netflix.com URL. WebFlix never fetches these (robots + playback
 * policy); they are outbound deep links handed to the USER's system browser,
 * handing the viewer TO Netflix (the same pattern Apple TV / Google TV use).
 *
 * `netflix.com/watch/<id>` is Netflix's own per-title deep link (their app
 * intents and partner TV UIs use the same shape). `netflix.com/title/<id>`
 * is the public title page.
 */

export function netflixWatchUrl(netflixId: number): string {
  return `https://www.netflix.com/watch/${netflixId}`;
}

export function netflixTitleUrl(netflixId: number): string {
  return `https://www.netflix.com/title/${netflixId}`;
}
