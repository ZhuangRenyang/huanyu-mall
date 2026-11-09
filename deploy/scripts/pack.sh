#!/usr/bin/env bash
set -euo pipefail

# pack.sh — 打源码交付包（跨 Windows → Linux 部署用）。
#
# 为什么要专门一个脚本：
#   Windows 上编辑工具会把文件写成 CRLF，bash 解析 `deploy/install.sh` 时直接语法错误
#   （真机问题 #29）。所以打包时统一归一化行尾，而不是靠人肉注意。
#
# 用法：
#   bash deploy/scripts/pack.sh                # → ../mall-src.tar.gz
#   bash deploy/scripts/pack.sh /tmp/out.tar.gz # 指定输出路径

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT="${1:-$(dirname "$REPO_ROOT")/mall-src.tar.gz}"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

log() { printf '[pack] %s\n' "$*"; }

log "准备暂存目录: $STAGE"
# 复制源码（排除依赖与构建产物）
tar -cf - \
  --exclude=node_modules --exclude=dist --exclude=.turbo --exclude=.next \
  --exclude=.git --exclude=.workbuddy --exclude=coverage \
  -C "$REPO_ROOT" . | (cd "$STAGE" && tar -xf -)

# 归一化行尾：文本文件统一 LF
log "归一化行尾（CRLF → LF）"
count=0
while IFS= read -r -d '' f; do
  if tr -cd '\r' < "$f" | grep -q .; then
    sed -i 's/\r$//' "$f"
    count=$((count + 1))
  fi
done < <(find "$STAGE" -type f \
  \( -name "*.sh" -o -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.mjs" \
     -o -name "*.cjs" -o -name "*.md" -o -name "*.yaml" -o -name "*.yml" -o -name "*.json" \
     -o -name "*.conf" -o -name "*.css" -o -name "*.html" -o -name "*.sql" -o -name "*.txt" \) \
  -print0)
log "已修正 $count 个文件的行尾"

# 自检：shell 脚本必须无 CR（否则目标机 bash 会语法错误）
log "自检：shell 脚本行尾"
for s in $(find "$STAGE" -name "*.sh" -type f); do
  if tr -cd '\r' < "$s" | grep -q .; then
    echo "[pack][ERROR] 脚本仍含 CR: ${s#$STAGE/}" >&2
    exit 1
  fi
done
log "自检通过"

log "打包 → $OUT"
tar -czf "$OUT" -C "$STAGE" .
log "完成：$(du -h "$OUT" | cut -f1)  $(cd "$STAGE" && find . -type f | wc -l) 个文件"
