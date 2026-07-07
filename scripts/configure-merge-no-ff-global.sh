#!/usr/bin/env bash
# configure-merge-no-ff-global.sh - main/master 上 merge 强制 --no-ff（触发 pre-merge-commit）
#
# 用法: ./scripts/configure-merge-no-ff-global.sh

set -euo pipefail

for branch in main master; do
	git config --global "branch.${branch}.mergeoptions" "--no-ff"
done

echo "[configure-merge-no-ff-global] branch.main.mergeoptions=$(git config --global --get branch.main.mergeoptions || echo '(unset)')"
echo "[configure-merge-no-ff-global] branch.master.mergeoptions=$(git config --global --get branch.master.mergeoptions || echo '(unset)')"
echo "[configure-merge-no-ff-global] Tip: git config --global alias.merge-safe '!f(){ git merge --no-ff \"\$@\"; }; f'"
