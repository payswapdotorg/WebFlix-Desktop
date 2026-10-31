# WFX-DIST-1 — the v1.0.0 distribution verification (2026-10-31, on-station)

Release: https://github.com/payswapdotorg/WebFlix-Desktop/releases/tag/v1.0.0
(stable, published 2026-10-31T19:14:48Z by the tag-triggered pipeline
run 41232423713 @ d9a0844 — build-linux ✓ + build-windows ✓ + release ✓).

## The install one-liner (the operator path, end-to-end)

    curl -fsSL https://raw.githubusercontent.com/payswapdotorg/webflix-desktop/main/install.sh | sh -s -- --appimage

Verified live on the station (a FUSE-less, keyring-less Linux box — the
harshest honest environment):

1. Resolve: the releases/latest redirect answered v1.0.0 (no API, no JSON parser).
2. Download + verify: WebFlix-1.0.0-linux-x86_64.AppImage (192,196,842 bytes)
   — sha256sum -c against the release sidecar: **OK**.
3. Install: ~/.local/bin/WebFlix-1.0.0-linux-x86_64.AppImage + the `webflix`
   launcher shim + the PATH note (the zcode-distribution pattern).
4. Launch (appimage-boot.png / appimage-settled.png): boots over
   --appimage-extract-and-run (the station has no libfuse2 — see the shim
   finding below), settles with **title=WebFlix, product-mark=1,
   zero ZCode/Z.ai strings on the visible surface**, and the honest
   fail-closed vault banner (no secret service on the station).
5. The `webflix` command itself (appimage-shim-launch.png): the shim
   auto-detects the missing libfuse2 and rides --appimage-extract-and-run —
   same settled result. Clean SIGTERM exit in every run.

## The other artifacts (downloaded from the release, checksum-verified)

- WebFlix-1.0.0-linux-amd64.deb — sha256 OK; dpkg-deb: Package=webflix-desktop,
  Version=1.0.0, Description="WebFlix Desktop App", Homepage=https://webflix.org,
  Maintainer=WebFlix <dev@webflix.org>; hicolor webflix.png icons installed.
- WebFlix-1.0.0-win-x64.exe (NSIS) — sha256 OK; the CI lane's PE assertions
  passed at build time (ProductName=WebFlix, FileDescription=WebFlix Desktop App
  after the identity fix, no ZCode in the version resource). On-station Windows
  runtime QA is NOT possible (Linux-only station) — recorded honestly.
- latest.json — the install-script manifest (see the copy in this dir).

## Findings on the way (all closed or recorded)

- **F1 (station)**: the runner image windows-2025 carries no usable Visual
  Studio → node-gyp builds (better-sqlite3, cpu-features) fail at pnpm install.
  Fixed: the lane rides windows-2022 (run 41227162474's finding).
- **F2 (product, CLOSED)**: the NSIS installer's PE FileDescription carried the
  inherited "ZCode Desktop App" (electron-builder NsisTarget stamps it from the
  desktop package.json description) — caught by the lane's fail-closed leak
  assertion (run 41228318598). Fixed at the source + pinned (commit e5b648d).
- **F3 (product, CLOSED)**: Help→About opened a fully ZCode-branded About
  window on Linux/Windows — the same run's sibling finding. Fixed flavor-wise
  + pinned (commit e5b648d).
- **F4 (install.sh, CLOSED)**: the AppImage launcher is now a FUSE-aware shim
  (direct exec, --appimage-extract-and-run fallback when libfuse2 is absent).
- **F5 (install.sh, CLOSED)**: the upgrade path — `cat >` through a leftover
  `webflix` SYMLINK truncated the installed AppImage (caught live on-station);
  the shim write now removes the old link first.
- **F6 (recorded follow-up)**: the renderer's static index.html <title> is the
  inherited "ZCode" — replaced at runtime within ~2s of boot (the settled
  surface is verified clean); a pre-boot transient, follow-up lane material
  (flavor-stamp the static title in the vite build).
- **F7 (recorded follow-up)**: the Linux deep-link ownership marker string
  ("Comment=ZCode Desktop App" in desktopLinuxDeepLinkRegistration.ts) —
  ownership-comparison logic with migration semantics, deliberately unchanged;
  dedicated-lane material.
