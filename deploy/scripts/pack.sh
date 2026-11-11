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
#
# ⚠️ 排除列表是**独立于 .gitignore** 的（tar 不读 .gitignore）。
#    两边必须同步维护：只在 .gitignore 里加规则，这个脚本完全不受影响 ——
#    真实踩过：.gitignore 加了 .tmp-*/，但打包时 .tmp-ali/ 里的私钥照样进了包。
#    所以这里除了排除，还会在打包后再做一次「敏感文件扫描」兜底（见文件末尾）。
tar -cf - \
  --exclude=node_modules --exclude=dist --exclude=.turbo --exclude=.next \
  --exclude=.git --exclude=.workbuddy --exclude=coverage \
  --exclude='.tmp-*' --exclude='*.tmp' \
  --exclude='*.pem' --exclude='*.key' --exclude='*.p12' --exclude='*.pfx' \
  --exclude='.env' --exclude='.env.local' --exclude='.env.production' \
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

# 留一份构建提交号：目标机没有 .git，install.sh 靠它显示「当前装的是哪一版」
# 从仓库根取提交号（pack.sh 在仓库根执行）
if command -v git >/dev/null 2>&1; then
  git rev-parse --short HEAD > "$STAGE/.pack-commit" 2>/dev/null || echo "unknown" > "$STAGE/.pack-commit"
else
  echo "unknown" > "$STAGE/.pack-commit"
fi

log "打包 → $OUT"
tar -czf "$OUT" -C "$STAGE" .

# 兜底：扫描产物里有没有敏感文件。
# 排除列表永远可能漏项（新增目录、新增密钥类型、.gitignore 与本脚本不同步…），
# 所以最后再扫一遍产物内容，命中就直接失败并删掉产物 —— 宁可打包失败，也不能把密钥发出去。
log "自检：产物中是否含敏感文件"
SENSITIVE=$(tar -tzf "$OUT" \
  | grep -iE '(^|/)(\.env$|\.env\.(local|production)$|[^/]*\.(pem|key|p12|pfx)$|secrets?\.json$|id_rsa)' \
  || true)
if [[ -n "$SENSITIVE" ]]; then
  echo "[pack][ERROR] 产物包含敏感文件，已中止并删除产物：" >&2
  printf '%s\n' "$SENSITIVE" | sed 's/^/  - /' >&2
  rm -f "$OUT"
  exit 1
fi
log "自检通过"

log "完成：$(du -h "$OUT" | cut -f1)  $(cd "$STAGE" && find . -type f | wc -l) 个文件"
