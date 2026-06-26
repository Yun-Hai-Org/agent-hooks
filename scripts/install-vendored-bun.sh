#!/usr/bin/env bash
# install-vendored-bun.sh - 下载 Bun >= 1.2.15 到 .tools/（bun audit 需要 1.2.15+）
#
# 用法: ./scripts/install-vendored-bun.sh [HOOKS_REPO] [BUN_VERSION]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOKS_REPO="${1:-$(cd "$SCRIPT_DIR/.." && pwd)}"
BUN_VERSION="${2:-1.2.15}"

case "$(uname -m)" in
x86_64) ARCH=darwin-x64 ;;
arm64 | aarch64) ARCH=darwin-aarch64 ;;
*)
	echo "error: unsupported arch $(uname -m)" >&2
	exit 1
	;;
esac

DEST_DIR="$HOOKS_REPO/.tools/bun-darwin-x64"
mkdir -p "$DEST_DIR"

TMP_ZIP="$(mktemp -t bun-vendored.XXXXXX.zip)"
TMP_EXTRACT="$(mktemp -d -t bun-extract.XXXXXX)"

cleanup() {
	rm -rf "$TMP_ZIP" "$TMP_EXTRACT"
}
trap cleanup EXIT

URL="https://github.com/oven-sh/bun/releases/download/bun-v${BUN_VERSION}/bun-${ARCH}.zip"
echo "[install-vendored-bun] Downloading ${URL}"
curl -fsSL "$URL" -o "$TMP_ZIP"
unzip -q -o "$TMP_ZIP" -d "$TMP_EXTRACT"

BUN_BIN="$TMP_EXTRACT/bun-${ARCH}/bun"
if [[ ! -x "$BUN_BIN" ]]; then
	echo "error: bun binary not found in archive" >&2
	exit 1
fi

INSTALLED_VERSION="$("$BUN_BIN" --version)"
echo "[install-vendored-bun] Extracted bun ${INSTALLED_VERSION}"

cp "$BUN_BIN" "$DEST_DIR/bun"
chmod +x "$DEST_DIR/bun"

if "$DEST_DIR/bun" audit --help >/dev/null 2>&1; then
	echo "[install-vendored-bun] bun audit available"
else
	echo "error: installed bun ${INSTALLED_VERSION} does not support audit" >&2
	exit 1
fi

mkdir -p "${HOME}/.cursor"
ln -sf "$DEST_DIR/bun" "${HOME}/.cursor/bun"
ln -sf "${HOME}/.cursor/bun" "${HOME}/.cursor/bunx"

echo "[install-vendored-bun] Installed to $DEST_DIR/bun"
echo "[install-vendored-bun] Linked ~/.cursor/bun -> $DEST_DIR/bun"
ls -la "$DEST_DIR/bun" "${HOME}/.cursor/bun"
