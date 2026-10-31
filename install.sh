#!/bin/sh
# WebFlix Desktop — Linux installer (WFX-DIST-1, the zcode-distribution parity:
# a one-liner that resolves the latest release, verifies its checksum, and
# installs it; no Node.js or other runtime prerequisites — the app is a
# self-contained Electron bundle).
#
# One-liner:
#   curl -fsSL https://raw.githubusercontent.com/payswapdotorg/webflix-desktop/main/install.sh | sh
#
# Modes:
#   auto (default) — .deb through apt when apt-get + sudo are available
#                     (system install, desktop entry + webflix:// handler),
#                     otherwise the AppImage into ~/.local/bin (no root).
#   --deb           force the .deb path (needs sudo).
#   --appimage      force the AppImage path (never needs root).
#
# Overrides (env or flags):
#   --version X | WEBFLIX_VERSION=X   install a specific release (default: latest)
#   WEBFLIX_REPO=owner/name           the GitHub repository (default
#                                     payswapdotorg/webflix-desktop)
#   WEBFLIX_BIN_DIR=path              AppImage destination (default ~/.local/bin)
#
# This script is stdin-safe (curl | sh) — it never relies on $0.
set -eu

REPO="${WEBFLIX_REPO:-payswapdotorg/webflix-desktop}"
VERSION="${WEBFLIX_VERSION:-}"
MODE="auto"
BIN_DIR="${WEBFLIX_BIN_DIR:-$HOME/.local/bin}"

usage() {
  sed -n '2,25p' "$0" 2>/dev/null || cat <<'USAGE'
Usage: sh install.sh [--deb | --appimage] [--version X]
  --deb        install the .deb through apt (needs sudo)
  --appimage   install the AppImage into ~/.local/bin (no root)
  --version X  install release vX instead of the latest
USAGE
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --deb) MODE="deb" ;;
    --appimage) MODE="appimage" ;;
    --version) [ "$#" -ge 2 ] || { echo "install.sh: --version needs a value" >&2; exit 1; }; VERSION="$2"; shift ;;
    --version=*) VERSION="${1#--version=}" ;;
    --help|-h) usage; exit 0 ;;
    *) echo "install.sh: unknown argument: $1 (try --help)" >&2; exit 1 ;;
  esac
  shift
done

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "WebFlix install requires '$1' on PATH" >&2
    exit 1
  fi
}
need_cmd curl

# sha256 tooling: GNU coreutils sha256sum, else BSD/macOS shasum.
sum_tool() {
  if command -v sha256sum >/dev/null 2>&1; then
    echo sha256sum
  elif command -v shasum >/dev/null 2>&1; then
    echo shasum
  else
    echo ""
  fi
}
SHA_TOOL="$(sum_tool)"
if [ -z "$SHA_TOOL" ]; then
  echo "WebFlix install requires 'sha256sum' (or 'shasum') to verify the download" >&2
  exit 1
fi

verify_sidecar() {
  # verify_sidecar <dir> <file> — checks <file> against <file>.sha256
  (cd "$1" && if [ "$SHA_TOOL" = shasum ]; then
    shasum -a 256 -c "$2.sha256"
  else
    sha256sum -c "$2.sha256"
  fi) || { echo "WebFlix install: checksum verification FAILED for $2" >&2; exit 1; }
}

# ---- resolve the release ---------------------------------------------------
if [ -n "$VERSION" ]; then
  case "$VERSION" in
    v*) TAG="$VERSION" ;;
    *) TAG="v$VERSION" ;;
  esac
else
  # releases/latest redirects to /tag/<tag>; following the redirect needs no
  # JSON parsing and no API rate limit.
  LATEST_URL="$(curl -fsSL -o /dev/null -w '%{url_effective}' "https://github.com/$REPO/releases/latest")" ||
    { echo "WebFlix install: unable to resolve the latest release (no releases published yet?)" >&2; exit 1; }
  TAG="${LATEST_URL##*/}"
fi
BASE="https://github.com/$REPO/releases/download/$TAG"
echo "WebFlix: installing release $TAG"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

# ---- latest.json is the install manifest (flat keys; sed-parsed) -----------
curl -fsSL -o "$TMP_DIR/latest.json" "$BASE/latest.json" || {
  echo "WebFlix install: release $TAG carries no latest.json manifest" >&2
  exit 1
}
json_str() {
  sed -n "s/.*\"$1\": *\"\([^\"]*\)\".*/\1/p" "$TMP_DIR/latest.json" | head -n 1
}
DEB_NAME="$(json_str debName)"
DEB_SHA="$(json_str debSha256)"
APPIMAGE_NAME="$(json_str appimageName)"
APPIMAGE_SHA="$(json_str appimageSha256)"
if [ -z "$DEB_NAME" ] || [ -z "$APPIMAGE_NAME" ]; then
  echo "WebFlix install: latest.json is missing the Linux artifacts" >&2
  exit 1
fi

download() {
  # download <name> <expected-sha>
  curl -fL --progress-bar -o "$TMP_DIR/$1" "$BASE/$1" ||
    { echo "WebFlix install: download failed: $1" >&2; exit 1; }
  printf '%s  %s\n' "$2" "$1" > "$TMP_DIR/$1.sha256"
  verify_sidecar "$TMP_DIR" "$1"
}

# ---- choose the mode --------------------------------------------------------
if [ "$MODE" = "auto" ]; then
  if command -v apt-get >/dev/null 2>&1 && command -v sudo >/dev/null 2>&1; then
    MODE="deb"
  else
    MODE="appimage"
  fi
fi

if [ "$MODE" = "deb" ]; then
  if ! command -v apt-get >/dev/null 2>&1; then
    echo "WebFlix install: --deb needs apt-get (try --appimage on non-Debian systems)" >&2
    exit 1
  fi
  download "$DEB_NAME" "$DEB_SHA"
  echo "Installing $DEB_NAME (sudo may ask for your password)…"
  sudo apt-get install -y "$TMP_DIR/$DEB_NAME"
  echo ""
  echo "WebFlix $TAG installed."
  echo "Launch it with: webflix  (or pick WebFlix from your application menu)"
else
  download "$APPIMAGE_NAME" "$APPIMAGE_SHA"
  mkdir -p "$BIN_DIR"
  mv "$TMP_DIR/$APPIMAGE_NAME" "$BIN_DIR/$APPIMAGE_NAME"
  chmod +x "$BIN_DIR/$APPIMAGE_NAME"
  ln -sf "$BIN_DIR/$APPIMAGE_NAME" "$BIN_DIR/webflix"
  echo ""
  echo "WebFlix $TAG installed (AppImage, no root used)."
  echo "Launch it with: webflix"
  case ":$PATH:" in
    *":$BIN_DIR:"*) ;;
    *) echo "Note: $BIN_DIR is not in your PATH — add it to launch 'webflix' by name." ;;
  esac
fi
