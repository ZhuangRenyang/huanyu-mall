#!/usr/bin/env bash
set -euo pipefail

# backup.sh — 升级前备份（架构 §9.5 + SPEC 铁律 10）。
# 备份数据库（pg_dump）与上传文件（uploads 打包），写入 data/backup/<时间戳>/。
# 程序/数据隔离：只碰 data 卷，绝不碰程序目录。
#
# 用法: bash backup.sh [--label 标签] [标签]
#
# 容器/网络一律由 compose 解析，不硬编码容器名与网络名：
#   compose 项目名默认取目录名，真机上是 deploy-postgres-1 / deploy_default，
#   硬编码 mall-postgres-1 / mall_default 必然在真机失效（真机假闭环事故）。
#
# MANIFEST 的每个状态都基于「内容真实有效」判定，不基于「文件存在」判定：
#   ok      = 产物存在、非空、且格式/内容校验通过
#   failed  = 本该备份但失败了（不留 0 字节占位文件，只留 .failed 标记）
#   skipped = 本来就不该备份（例如没有 uploads 目录）
# 备份不成功时退出码非 0，调用方（升级流程 / CI / doctor）必须能感知。

MALL_DIR="${MALL_DIR:-/opt/mall}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
ENV_FILE="${MALL_DIR}/config/.env"
BACKUP_ROOT="${MALL_DIR}/data/backup"

DB_STATUS="skipped"
UPLOADS_STATUS="skipped"
CONFIG_STATUS="skipped"
CHECKSUM_STATUS="missing"

log() { printf '[backup] %s\n' "$*"; }
fail() { printf '[backup][ERROR] %s\n' "$*" >&2; exit 1; }

usage() {
  cat <<'EOF'
用法: backup.sh [选项]
  --label 标签   备份目录名（默认用时间戳 YYYYmmdd-HHMMSS）
  -h, --help     显示帮助

产物写入 ${MALL_DIR}/data/backup/<标签>/，含 MANIFEST / mall.dump / uploads.tar.gz / config.tar.gz / SHA256SUMS
退出码: 0=全部成功  1=有环节备份失败
EOF
}

# 参数解析（兼容 --label 标签 与单个位置参数）
LABEL=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --label) LABEL="${2:-}"; [[ -n "$LABEL" ]] || fail "--label 缺少参数"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) [[ -z "$LABEL" ]] && LABEL="$1" || fail "多余参数: $1" ;;
  esac
  shift
done
[[ -n "$LABEL" ]] || LABEL="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR="${BACKUP_ROOT}/${LABEL}"

# compose 解析（在 deploy 目录执行，与项目名 = 目录名一致）
compose() {
  ( cd "$COMPOSE_DIR" && docker compose --env-file "$ENV_FILE" "$@" )
}

# 判断 dump 是否是有效的 pg_dump 自定义格式（PGDMP 魔数）
is_valid_dump() {
  local f="$1"
  [[ -s "$f" ]] || return 1
  [[ "$(head -c 5 "$f" 2>/dev/null)" == "PGDMP" ]]
}

mkdir -p "$BACKUP_DIR"

# 1) 数据库
backup_database() {
  log "备份数据库…"
  local dump="${BACKUP_DIR}/mall.dump"
  local errf="${BACKUP_DIR}/.pg_dump.err"
  rm -f "$dump" "$errf"

  if ! command -v docker >/dev/null 2>&1; then
    # 没有 Docker 就不可能备份出数据库，这不是「本来就不该备份」，是失败
    log "没有 docker 命令，数据库备份无法执行"
    DB_STATUS="failed"
    : > "${BACKUP_DIR}/mall.dump.failed"
    return 0
  fi

  # 主路径：compose 解析服务名（不硬编码容器名/网络名）
  if ! compose exec -T postgres pg_dump -Fc -U mall -d mall >"$dump" 2>"$errf"; then
    # 兜底路径：按 compose service label 找容器（不依赖项目名，也不依赖目录名）
    local ids count one
    ids="$(docker ps --filter "label=com.docker.compose.service=postgres" --format '{{.ID}}' 2>/dev/null | grep . || true)"
    count="$(printf '%s\n' "$ids" | grep -c . || true)"
    one="$(printf '%s\n' "$ids" | head -1)"
    if [[ "$count" == "1" ]]; then
      log "compose exec 失败，改用 service label 定位容器 ${one}"
      docker exec "$one" pg_dump -Fc -U mall -d mall >"$dump" 2>>"$errf" || true
    elif [[ "$count" -gt 1 ]]; then
      log "找到 ${count} 个 postgres 容器，拒绝猜测（同一台机器上可能有多套部署）: $(printf '%s' "$ids" | tr '\n' ' ')"
      : > "${BACKUP_DIR}/mall.dump.failed"
      DB_STATUS="failed"
      rm -f "$dump"
      rm -f "$errf"
      return 0
    else
      log "找不到运行中的 postgres 容器"
    fi
  fi

  if is_valid_dump "$dump"; then
    DB_STATUS="ok"
    log "数据库 → ${dump}（$(wc -c <"$dump" | tr -d ' ') 字节，PGDMP 自定义格式）"
  else
    DB_STATUS="failed"
    log "数据库备份失败（Docker 未运行 / 容器名或网络名不对 / 连接被拒）"
    [[ -s "$errf" ]] && sed 's/^/[backup]   /' "$errf" >&2
    rm -f "$dump"          # 不留 0 字节占位文件：那会让「存在」被误判成「成功」
    : > "${BACKUP_DIR}/mall.dump.failed"
  fi
  rm -f "$errf"
}

# 2) 上传文件（uploads 卷）
backup_uploads() {
  log "备份上传文件…"
  if [[ ! -d "${MALL_DIR}/data/uploads" ]]; then
    log "无 uploads 目录，跳过"
    UPLOADS_STATUS="skipped"
    return 0
  fi
  local tarf="${BACKUP_DIR}/uploads.tar.gz"
  rm -f "$tarf"
  if tar -czf "$tarf" -C "${MALL_DIR}/data" uploads 2>/dev/null && [[ -s "$tarf" ]]; then
    UPLOADS_STATUS="ok"
    log "上传文件 → ${tarf}（$(wc -c <"$tarf" | tr -d ' ') 字节）"
  else
    UPLOADS_STATUS="failed"
    log "uploads 打包失败"
    rm -f "$tarf"
    : > "${BACKUP_DIR}/uploads.tar.gz.failed"
  fi
}

# 3) 配置快照（secrets 不含，避免泄漏；只备份非敏感配置）
# .env 内含与 secrets.json 同源的密钥，也一并排除，避免备份介质成为密钥泄露面。
# 恢复时 restore.sh 默认同样跳过 .env（可用 --restore-env 显式覆盖）。
backup_config() {
  log "备份配置快照…"
  if [[ ! -d "${MALL_DIR}/config" ]]; then
    log "无 config 目录，跳过"
    CONFIG_STATUS="skipped"
    return 0
  fi
  local tarf="${BACKUP_DIR}/config.tar.gz"
  rm -f "$tarf"
  if tar -czf "$tarf" -C "${MALL_DIR}/config" \
      --exclude='secrets.json' --exclude='.env' --exclude='*.key' . 2>/dev/null && [[ -s "$tarf" ]]; then
    CONFIG_STATUS="ok"
    log "配置（排除 secrets/.env） → ${tarf}"
  else
    CONFIG_STATUS="failed"
    log "配置快照打包失败"
    rm -f "$tarf"
    : > "${BACKUP_DIR}/config.tar.gz.failed"
  fi
}

# 4) 校验和（restore.sh 用它验证备份完整性，损坏的备份必须在恢复前拦住）
# 只覆盖「确实成功」的产物；覆盖到的文件若缺失或为空 → checksums 判 failed。
compute_checksums() {
  local -a files=()
  [[ "$DB_STATUS" == "ok" ]] && files+=("mall.dump")
  [[ "$UPLOADS_STATUS" == "ok" ]] && files+=("uploads.tar.gz")
  [[ "$CONFIG_STATUS" == "ok" ]] && files+=("config.tar.gz")

  rm -f "${BACKUP_DIR}/SHA256SUMS"
  if (( ${#files[@]} == 0 )); then
    CHECKSUM_STATUS="missing"
    return 0
  fi

  local sum_tool=""
  if command -v sha256sum >/dev/null 2>&1; then
    sum_tool="sha256sum"
  elif command -v shasum >/dev/null 2>&1; then
    sum_tool="shasum -a 256"
  fi
  if [[ -z "$sum_tool" ]]; then
    log "系统没有 sha256sum / shasum，无法生成校验和"
    CHECKSUM_STATUS="missing"
    return 0
  fi

  if ! ( cd "$BACKUP_DIR" && $sum_tool "${files[@]}" >SHA256SUMS 2>/dev/null ); then
    log "生成校验和失败"
    rm -f "${BACKUP_DIR}/SHA256SUMS"
    CHECKSUM_STATUS="failed"
    return 0
  fi

  # 校验和必须真的覆盖到非空文件，否则「校验通过」同样是假闭环
  # 注意：sha256sum 的输出有两种形态 —— 「<hash>  <file>」与二进制模式下的「<hash> *<file>」
  local f
  while read -r _ f; do
    [[ -n "$f" ]] || continue
    f="${f#\*}"
    if [[ ! -s "${BACKUP_DIR}/${f}" ]]; then
      log "校验和覆盖的文件缺失或为空: ${f}"
      CHECKSUM_STATUS="failed"
      return 0
    fi
  done < "${BACKUP_DIR}/SHA256SUMS"

  CHECKSUM_STATUS="ok"
  log "校验和 → ${BACKUP_DIR}/SHA256SUMS（覆盖 ${#files[@]} 个产物）"
}

# 5) 备份清单（状态全部来自上面的真实判定）
write_manifest() {
  cat > "${BACKUP_DIR}/MANIFEST" <<EOF
label: ${LABEL}
time: $(date -Iseconds)
db: ${DB_STATUS}
uploads: ${UPLOADS_STATUS}
config: ${CONFIG_STATUS}
checksums: ${CHECKSUM_STATUS}
EOF
}

backup_database
backup_uploads
backup_config
compute_checksums
write_manifest

log "备份目录: ${BACKUP_DIR}"
log "MANIFEST:"
cat "${BACKUP_DIR}/MANIFEST"

# 退出码：有环节失败就不算备份成功，调用方必须能感知（静默继续 = 数据风险）
failed=0
for st in "$DB_STATUS" "$UPLOADS_STATUS" "$CONFIG_STATUS" "$CHECKSUM_STATUS"; do
  [[ "$st" == "failed" ]] && failed=1
done
if (( failed )); then
  fail "备份未完全成功（db=${DB_STATUS} uploads=${UPLOADS_STATUS} config=${CONFIG_STATUS} checksums=${CHECKSUM_STATUS}），请勿用于升级"
fi
log "备份完成: ${BACKUP_DIR}"
exit 0
