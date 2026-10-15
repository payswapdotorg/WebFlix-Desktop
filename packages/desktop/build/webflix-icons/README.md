# WebFlix product icon set (P9-UI-1)

The product-only icon assets for the WebFlix desktop flavor. ZCode's
`build/icon.png`, `build/icon.ico`, `build/icon.icns` and `build/icons/**`
are untouched — this folder is the parallel WebFlix set, consumed by the
packaging identity lane (P9-LINUX-1 wires `electron-builder.config.js` to
these files; that config is outside the P9-UI-1 grant).

## Contents

- `icon.svg` — the single source mark: the "Fx" stream-forward monogram
  (an `F` as ascending signal strokes, an `x` ligature, and a play chevron)
  in the WebFlix brand accent `#2fd6b3` on the shell background `#0f1420`.
  The geometry is EXACTLY the renderer mark
  (`packages/desktop/src/renderer/src/webflix/brand.ts` →
  `WEBFLIX_MARK_SVG`); a pin test asserts the two stay in lockstep.
- `icons/16x16.png` … `icons/1024x1024.png` — the rasterized Linux size set
  (transparent corners; the rounded tile is part of the mark), matching the
  naming convention ZCode's `build/icons/` uses so the packaging lane can
  point at this folder directly.
- `generate.py` — the rasterizer (headless Chromium via Playwright, lossless
  PNG screenshots of the SVG at each size). Repo-external sandbox tooling:
  the Python environment that provides Playwright is NOT a repository
  dependency and the committed PNGs do not require it to exist. The
  recorded invocation used to produce the committed set:
  `/home/z/.venv/bin/python3 generate.py` (Playwright 1.57.0, Chromium,
  2026-10-14, sandbox pod).

## Brand rules (binding for this set)

- The mark is an original WebFlix design — NOT the ZCode "Z" glyph and NOT
  a YouTube play-button pastiche (ADR-0003 independent-value doctrine; the
  shell theme already bans YouTube red).
- No ZCode/Z.ai glyph, name, or identifier may appear in any file under
  this folder (pinned by the P9-UI-1 identity-leak battery test, which
  scans every asset in this folder).
- Re-runs of `generate.py` must start from `icon.svg` unchanged; changing
  the mark means changing `brand.ts` in the same order so the renderer
  splash and the packaged icon never diverge.
