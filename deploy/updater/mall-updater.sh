#!/usr/bin/env bash
# mall-updater.sh — 宿主升级代理（ADR-017）。
#
# 为什么要单独一个代理：API 跑在 Docker 容器里，既不能替换宿主上的源码目录，
# 也不能调 docker compose 重建自己。真正「换程序」的动作必须发生在宿主机上。
# 于是拆成两半：
#   API    负责：排队作业、拉更新源清单、展示进度（不碰宿主）
#   本代理负责：备份 / 下载 / 校验 / 替换源码 / 跑 install.sh / 健康检查 / 失败回滚
#
# 安全边界：
#   * 本脚本被 install.sh 复制到 $MALL_DIR/config/ 下运行（配置目录，升级不覆盖），
#     绝不放在源码目录里——否则升级时把自己 mv 走，bash 读到一半就断。
#   * 只调 /api/v1/system-update/agent/*，用 UPDATER_TOKEN 鉴权，拿不到业务数据。
#   * 不碰数据：备份与回滚只动源码目录和 backup/，data/ 卷永远不动（铁律 10）。
#
# 依赖：bash、curl、jq、sha256sum、docker（后两者由 install.sh / backup.sh 使用）。
# 用法：systemd 托管常驻；调试时可 `bash mall-updater.sh --once` 跑一轮就退。
set -uo pipefail

STATE_DIR="${MALL_DIR:-/opt/mall}/config"
ENV_FILE="${STATE_DIR}/.env"
LOG_FILE="${STATE_DIR}/updater.log"
TOKEN=""
API_BASE="http://127.0.0.1"
SRC_DIR=""
MALL_DIR_RESOLVED="${MALL_DIR:-/opt/mall}"
POLL_SECONDS="${UPDATER_POLL_SECONDS:-5}"
AGENT_VERSION="mall-updater/1.0.0"
ONCE=0
JOB_ID=""

[[ "${1:-}" == "--once" ]] && ONCE=1

log() { printf '%s [updater] %s\n' "$(date '+%Y-%m-%dT%H:%M:%S%z')" "$*" >>"$LOG_FILE"; }
die() { log "ERROR: $*"; printf '[updater][ERROR] %s\n' "$*" >&2; exit 1; }

require_tools() {
  local tool
  for tool in curl jq sha256sum tar; do
    command -v "$tool" >/dev/null 2>&1 || die "缺少依赖：$tool"
  done
}

# ------------------------------------------------------------------ #
# 配置
# ------------------------------------------------------------------ #
load_config() {
  [[ -f "$ENV_FILE" ]] || die "找不到 $ENV_FILE（install.sh 会生成）"
  local line key value
  while IFS= read -r line; do
    [[ "$line" =~ ^[[:space:]]*# ]] && continue
    [[ "$line" != *"="* ]] && continue
    key="${line%%=*}"
    value="${line#*=}"
    value="${value%\"}"
    value="${value#\"}"
    case "$key" in
      MALL_DIR) MALL_DIR_RESOLVED="$value" ;;
      SRC_DIR) SRC_DIR="$value" ;;
      UPDATER_TOKEN) TOKEN="$value" ;;
      UPDATER_API_BASE) API_BASE="$value" ;;
    esac
  done < "$ENV_FILE"

  [[ -n "$TOKEN" ]] || die ".env 里没有 UPDATER_TOKEN"
  STATE_DIR="${MALL_DIR_RESOLVED}/config"
  LOG_FILE="${STATE_DIR}/updater.log"
  if [[ -z "$SRC_DIR" ]]; then
    SRC_DIR="$(cd "$STATE_DIR/../.." 2>/dev/null && pwd || echo "")"
    [[ -n "$SRC_DIR" ]] || die "推断不出 SRC_DIR，请在 $ENV_FILE 里显式写"
    log "未找到 SRC_DIR，推断为 $SRC_DIR"
  fi
  [[ -d "$SRC_DIR" ]] || die "源码目录不存在：$SRC_DIR"
}

# ------------------------------------------------------------------ #
# 与 API 通信
# 升级过程中 API 会被重启，所以每次调用都重试；进度丢了顶多界面停一会儿，
# 作业结果（complete）多试几次，不会让作业卡在 running。
# ------------------------------------------------------------------ #
api() {
  local method="$1" path="$2" body="${3:-}"
  local attempt out
  for attempt in 1 2 3 4 5 6; do
    if [[ -n "$body" ]]; then
      out="$(curl -sS -m 20 -X "$method" "$API_BASE$path" \
        -H "Authorization: Bearer $TOKEN" \
        -H 'Content-Type: application/json' \
        --data-binary "$body" 2>/dev/null)"
    else
      out="$(curl -sS -m 20 -X "$method" "$API_BASE$path" \
        -H "Authorization: Bearer $TOKEN" 2>/dev/null)"
    fi
    if [[ -n "$out" ]]; then
      printf '%s' "$out"
      return 0
    fi
    sleep $((attempt * 2))
  done
  log "API 调用失败：$method $path"
  return 1
}

heartbeat() {
  api POST "/api/v1/system-update/agent/heartbeat" \
    "{\"version\":\"$(json_str "$AGENT_VERSION")\"}" >/dev/null
}

set_step() {
  local progress="$1" step="$2" logline="${3:-}"
  api POST "/api/v1/system-update/agent/jobs/$JOB_ID/progress" \
    "$(jq -nc --argjson p "$progress" --arg s "$step" --arg l "$logline" \
        '{progress:$p, step:$s, log:$l}')" >/dev/null || true
  log "[$progress%] $step ${logline}"
}

finish() {
  local status="$1" error="${2:-}"
  api POST "/api/v1/system-update/agent/jobs/$JOB_ID/complete" \
    "$(jq -nc --arg s "$status" --arg e "$error" '{status:$s, error:$e}')" >/dev/null || true
  log "作业 $JOB_ID 结束：$status ${error}"
}

json_str() { jq -n --arg v "$1" '$v'; }

# ------------------------------------------------------------------ #
# 动作：备份
# ------------------------------------------------------------------ #
do_backup() {
  local label="${1:-manual}"
  set_step 10 "准备备份" "标签 $label"
  cd "$SRC_DIR" || { finish failed "找不到源码目录 $SRC_DIR"; return 1; }
  if ! bash deploy/scripts/backup.sh --label "$label" >>"$LOG_FILE" 2>&1; then
    finish failed "备份失败，详见 $LOG_FILE"
    return 1
  fi
  set_step 100 "备份完成" ""
  finish succeeded "{\"label\":\"$(json_str "$label")\"}"
}

# ------------------------------------------------------------------ #
# 动作：升级
# 失败必须自动回滚——「升级炸了但没人知道」是这类功能最不能犯的错。
# ------------------------------------------------------------------ #
do_upgrade() {
  local tarball_url="$1" sha256="$2" want_version="$3"
  local workdir snapshot actual

  set_step 5 "备份数据" "升级前快照"
  cd "$SRC_DIR" || { finish failed "找不到源码目录 $SRC_DIR"; return 1; }
  if ! bash deploy/scripts/backup.sh --label "pre-upgrade" >>"$LOG_FILE" 2>&1; then
    finish failed "升级前备份失败，已中止（程序与数据都未改动）"
    return 1
  fi

  workdir="$(mktemp -d "${TMPDIR:-/tmp}/mall-upgrade.XXXXXX")"
  set_step 20 "下载新版本" "$want_version"
  if ! curl -fsSL -m 600 -o "$workdir/src.tar.gz" "$tarball_url" >>"$LOG_FILE" 2>&1; then
    rm -rf "$workdir"
    finish failed "下载失败：$tarball_url"
    return 1
  fi

  set_step 35 "校验完整性" ""
  if [[ -n "$sha256" ]]; then
    actual="$(sha256sum "$workdir/src.tar.gz" | cut -d' ' -f1)"
    if [[ "$actual" != "$sha256" ]]; then
      rm -rf "$workdir"
      finish failed "校验失败：期望 ${sha256} 实际 ${actual}（已中止，未替换程序）"
      return 1
    fi
  fi

  set_step 45 "解压新版本" ""
  mkdir -p "$workdir/unpack"
  if ! tar xzf "$workdir/src.tar.gz" -C "$workdir/unpack" >>"$LOG_FILE" 2>&1; then
    rm -rf "$workdir"
    finish failed "解压失败（已中止，未替换程序）"
    return 1
  fi
  if [[ ! -f "$workdir/unpack/deploy/install.sh" ]]; then
    rm -rf "$workdir"
    finish failed "包里没有 deploy/install.sh，结构不对（已中止，未替换程序）"
    return 1
  fi

  snapshot="${SRC_DIR}.prev-$(date '+%Y%m%d-%H%M%S')"
  set_step 55 "切换程序" "旧版留档 $(basename "$snapshot")"
  if ! mv "$SRC_DIR" "$snapshot"; then
    rm -rf "$workdir"
    finish failed "无法移动旧源码目录，升级中止"
    return 1
  fi
  if ! mv "$workdir/unpack" "$SRC_DIR"; then
    mv "$snapshot" "$SRC_DIR" 2>/dev/null
    rm -rf "$workdir"
    finish failed "无法放置新源码，已还原旧版"
    return 1
  fi
  prune_snapshots

  set_step 70 "重建应用" "install.sh（镜像 + 迁移 + 重启）"
  if ! ( cd "$SRC_DIR" && MALL_DIR="$MALL_DIR_RESOLVED" bash deploy/install.sh ) \
      >"$STATE_DIR/last-upgrade-install.log" 2>&1; then
    log "install.sh 失败，开始回滚"
    set_step 80 "升级失败，自动回滚" "还原旧版并重建"
    rollback_to "$snapshot"
    finish failed "升级失败，已自动回滚到旧版（原因见升级日志）"
    return 1
  fi

  set_step 90 "健康检查" ""
  if ! curl -fsS -m 15 "$API_BASE/api/v1/health" >/dev/null 2>&1; then
    log "升级后健康检查失败，开始回滚"
    rollback_to "$snapshot"
    finish failed "升级后健康检查失败，已自动回滚到旧版"
    return 1
  fi

  rm -rf "$workdir"
  set_step 100 "升级完成" "当前版本 $want_version"
  finish succeeded "{\"version\":\"$(json_str "$want_version")\"}"
}

rollback_to() {
  local snapshot="$1"
  [[ -d "$snapshot" ]] || { log "找不到快照 $snapshot，无法回滚"; return 1; }
  rm -rf "$SRC_DIR"
  mv "$snapshot" "$SRC_DIR" || { log "还原源码失败"; return 1; }
  log "已还原源码到 $(basename "$snapshot")，重建应用"
  ( cd "$SRC_DIR" && MALL_DIR="$MALL_DIR_RESOLVED" bash deploy/install.sh ) \
    >>"$STATE_DIR/last-rollback-install.log" 2>&1 || log "回滚后的 install.sh 失败，需要人工介入"
}

prune_snapshots() {
  ls -1dt "${SRC_DIR}".prev-* 2>/dev/null | tail -n +3 | while read -r old; do
    rm -rf "$old"
    log "清理旧快照 $old"
  done
}

# ------------------------------------------------------------------ #
# 主循环
# ------------------------------------------------------------------ #
main() {
  require_tools
  load_config
  log "启动 $AGENT_VERSION  API=$API_BASE  SRC_DIR=$SRC_DIR  MALL_DIR=$MALL_DIR_RESOLVED"

  while true; do
    heartbeat || true

    local resp action
    resp="$(api GET "/api/v1/system-update/agent/next")" || { sleep "$POLL_SECONDS"; continue; }
    JOB_ID="$(printf '%s' "$resp" | jq -r '.data.job.id // empty')"
    if [[ -z "$JOB_ID" ]]; then
      [[ "$ONCE" -eq 1 ]] && break
      sleep "$POLL_SECONDS"
      continue
    fi

    action="$(printf '%s' "$resp" | jq -r '.data.job.action // empty')"
    log "领到作业 $JOB_ID action=$action"

    case "$action" in
      backup)
        do_backup "$(printf '%s' "$resp" | jq -r '.data.job.payload.label // "manual"')"
        ;;
      upgrade)
        do_upgrade \
          "$(printf '%s' "$resp" | jq -r '.data.job.payload.tarball_url // empty')" \
          "$(printf '%s' "$resp" | jq -r '.data.job.payload.sha256 // empty')" \
          "$(printf '%s' "$resp" | jq -r '.data.job.payload.version // empty')"
        ;;
      rollback)
        rollback_to "$(printf '%s' "$resp" | jq -r '.data.job.payload.snapshot // empty')"
        finish succeeded ""
        ;;
      *)
        finish failed "未知动作：$action"
        ;;
    esac

    JOB_ID=""
    [[ "$ONCE" -eq 1 ]] && break
  done
}

main "$@"
