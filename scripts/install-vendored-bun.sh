#!/usr/bin/env bash
# install-vendored-bun.sh - 下载 Bun >= 1.2.15 到 .tools/（bun audit 需要 1.2.15+）
#
# 用法: ./scripts/install-vendored-bun.sh [HOOKS_REPO] [BUN_VERSION]
#
# 镜像（GitHub 慢或不可达时）:
#   BUN_DOWNLOAD_MIRROR=https://gh-proxy.com/ ./scripts/install-vendored-bun.sh
#   BUN_DOWNLOAD_URL=https://.../bun-darwin-x64.zip ./scripts/install-vendored-bun.sh
# 未设置时依次尝试: gh-proxy.com → ghproxy.net → GitHub

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

GITHUB_URL="https://github.com/oven-sh/bun/releases/download/bun-v${BUN_VERSION}/bun-${ARCH}.zip"

download_bun_zip() {
	local dest="$1"
	local -a urls=()

	if [[ -n "${BUN_DOWNLOAD_URL:-}" ]]; then
		urls=("$BUN_DOWNLOAD_URL")
	elif [[ -n "${BUN_DOWNLOAD_MIRROR:-}" ]]; then
		urls=("${BUN_DOWNLOAD_MIRROR}${GITHUB_URL}")
	else
		urls=(
			"https://gh-proxy.com/${GITHUB_URL}"
			"https://ghproxy.net/${GITHUB_URL}"
			"$GITHUB_URL"
		)
	fi

	local url
	for url in "${urls[@]}"; do
		echo "[install-vendored-bun] Downloading ${url}"
		if curl -fsSL --connect-timeout 15 --max-time 600 "$url" -o "$dest"; then
			return 0
		fi
		echo "[install-vendored-bun] Download failed, trying next source..." >&2
		rm -f "$dest"
	done

	echo "error: all download sources failed for bun-v${BUN_VERSION} (${ARCH})" >&2
	echo "hint: BUN_DOWNLOAD_MIRROR=https://gh-proxy.com/ $0" >&2
	return 1
}

download_bun_zip "$TMP_ZIP"
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
