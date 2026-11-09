#!/usr/bin/env bash
set -euo pipefail

# healthcheck.sh — 自检：compose 服务状态 + /api/v1/health 端点。
# 用法：bash healthcheck.sh [--url http://localhost/api/v1/health]
# 退出码 0=健康，1=不健康。

URL="${1:-${HEALTH_URL:-http://localhost/api/v1/health}}"
COMPOSE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

log() { printf '[healthcheck] %s\n' "$*"; }
bad() { printf '[healthcheck][FAIL] %s\n' "$*"; }

rc=0

# 1) 依赖容器状态（用 compose 项目名查询，不硬编码容器名前缀）
if command -v docker >/dev/null 2>&1; then
  for svc in postgres redis pgbouncer; do
    state=$( (cd "$COMPOSE_DIR" && docker compose ps --format '{{.Health}}' "$svc" 2>/dev/null) | head -1 || true )
    if [[ "$state" != "healthy" ]]; then
      bad "容器 ${svc} 非 healthy（当前: ${state:-不存在}）"
      rc=1
    else
      log "容器 ${svc}: healthy"
    fi
  done
else
  log "未检测到 docker，跳过容器状态检查"
fi

# 2) 健康端点
if command -v curl >/dev/null 2>&1; then
  body=$(curl -fsS --max-time 5 "$URL" 2>/dev/null || true)
  if [[ -z "$body" ]]; then
    bad "健康端点无响应: $URL"
    rc=1
  else
    log "健康端点响应: $body"
    echo "$body" | grep -q '"code":0' || { bad "响应 code != 0"; rc=1; }
  fi
else
  log "未检测到 curl，跳过端点检查"
fi

if (( rc == 0 )); then log "健康检查通过"; else log "健康检查未通过"; fi
exit $rc
