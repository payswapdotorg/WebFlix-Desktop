#!/usr/bin/env python3
"""P9-UI-1 — rasterize the WebFlix mark SVG into the product icon PNG set.

Runs headless Chromium via Playwright (repo-external sandbox tooling; see
README.md for the recorded invocation). Each size renders the SVG at exactly
N x N CSS px on a transparent page and screenshots a lossless PNG.
"""

from pathlib import Path

from playwright.sync_api import sync_playwright

HERE = Path(__file__).resolve().parent
SIZES = [16, 24, 32, 48, 64, 128, 256, 512, 1024]

MARK_SVG = (HERE / "icon.svg").read_text(encoding="utf-8")


def render_all() -> None:
    with sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            page = browser.new_page(viewport={"width": 128, "height": 128})
            for size in SIZES:
                page.set_viewport_size({"width": size, "height": size})
                # Transparent background; the SVG carries its own rounded tile.
                page.set_content(
                    "<!doctype html><html><head><style>"
                    "html,body{margin:0;padding:0;background:transparent;overflow:hidden}"
                    "</style></head><body>"
                    f'<div style="width:{size}px;height:{size}px">'
                    f"{MARK_SVG.replace('<svg ', '<svg width=\"100%\" height=\"100%\" preserveAspectRatio=\"xMidYMid meet\" ', 1)}"
                    "</div></body></html>"
                )
                target = HERE / "icons" / f"{size}x{size}.png"
                target.parent.mkdir(parents=True, exist_ok=True)
                page.screenshot(path=str(target), omit_background=True)
                print(f"wrote {target}")
        finally:
            browser.close()


if __name__ == "__main__":
    render_all()
