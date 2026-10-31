# ZCode Protected Page Visual References

> **Import record (WFX-DIST-1 takeover, 2026-10-31):** these images were
> carried only inside the operator's TL handoff package upload
> (`webflix-desk-tl-handoff.zip`) until this import; uploads are ephemeral,
> so the set now lives in-tree as the durable copy of record. All four
> SHA-256 values below were re-verified against the imported files at
> import time (byte-exact). The handoff's critical design rule stands:
> these screenshots — never the HTML concept prototype — are the visual
> authority for the four protected pages (New Task, Automations, Plugin
> Marketplace, Settings).

These images are copied from the available user-provided reference assets. Preserve originals; do not crop/recompress them in-place. Use new derived files for annotated comparisons.

| File | Page/state | Viewport pixels | Provenance | SHA-256 |
|---|---|---:|---|---|
| `new-task-default.png` | New Task default, Browser closed | 1626 × 1007 | User-provided ZCode screenshot | `2a1ddf31bec05dbabc7964e162a4728332d9f7ad323abd3bd6b66df484513e32` |
| `new-task-browser-open.png` | New Task with Browser dock open | 1206 × 798 | User-provided ZCode screenshot | `3eb0d2161c32df90486938c141006fdff6789a5000bfb286496b505e313e76af` |
| `zcode-sidebar.png` | Sidebar/navigation | 242 × 437 | User-provided ZCode screenshot | `a9d84a9e964cff2527de803dd1c0010a6efec7432ba472168bf65a5f0deba858` |
| `settings-general.png` | Settings / General | 1195 × 806 | User-provided ZCode screenshot | `4920647a04f10f2d0c2a101762a338ce5046d13b25b6ae5dd9fa10fd160b0820` |

The duplicate uploads `new task(1).png` / `new task(2).png` and `image.png` / `settings.png` were hash-checked; duplicates were not copied into this reference set.

## References still to recover or capture

- `automations.png` — no separate Automations screenshot was present in the accessible screenshot set.
- `plugin-marketplace.png` — no separate Plugin Marketplace screenshot was present in the accessible screenshot set.

Look for the original user screenshots in the TL workspace, previous reference attachments and repo design folders. If they cannot be recovered, launch the pristine ZCode baseline and capture these pages before changing code. Mark them as baseline-generated, record app version/commit, theme, viewport, OS and capture date, and obtain product-owner confirmation. Do not use the WebFlix HTML concept as a substitute.

For all screenshots, preserve the original source image and record any generated baseline screenshots separately with their provenance. The test suite must compare equivalent viewports, themes, window states and data conditions.
