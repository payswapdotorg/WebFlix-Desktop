// WFX-NETFLIX-SOURCE-1 — the Netflix sub-brand's own palette, carried as
// LOCAL constants (the web app's arbitrary-value classes: #0a0a0c canvas,
// #e50914 red, the tile gradients, the rank-numeral stroke). The frozen
// shell theme stays untouched; the netflix surfaces import from here so the
// screens and the hand-off dialog never form an import cycle.
export const NETFLIX_COLORS = {
  canvas: "#0a0a0c",
  red: "#e50914",
  redHover: "#c4080f",
  tile: "#1b1b22",
  tileDeep: "#101014",
  rankFill: "#0b0b0f",
  rankStroke: "#5a5a66",
} as const;
