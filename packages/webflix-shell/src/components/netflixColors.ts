// WFX-NETFLIX-SOURCE-1 — the Netflix sub-brand's own palette, carried as
// LOCAL constants (the web app's arbitrary-value classes: #0a0a0c canvas,
// #e50914 red, the tile gradients, the rank-numeral stroke). The frozen
// shell theme stays untouched; the netflix surfaces import from here so the
// screens and the hand-off dialog never form an import cycle.
//
// WFX-NETFLIX-P45-LOOK-1 — the P45 deltas: the rank-numeral stroke re-frozen
// to the web app's current #575760 (3px), the Top-10 meta green (#46d369),
// and the mid surface for the live-band/dialog family (#141418).
export const NETFLIX_COLORS = {
  canvas: "#0a0a0c",
  red: "#e50914",
  redHover: "#c4080f",
  green: "#46d369",
  tile: "#1b1b22",
  tileDeep: "#101014",
  mid: "#141418",
  rankFill: "#0b0b0f",
  rankStroke: "#575760",
} as const;
