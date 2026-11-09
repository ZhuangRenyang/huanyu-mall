#!/usr/bin/env bash
set -euo pipefail

# restore.sh — 从备份目录恢复数据库、上传文件与配置快照（补齐 backup.sh 只写不读的缺口）。
#
# 与既有脚本的约定（deploy/install.sh / deploy/scripts/backup.sh）：
#   - 程序与数据分离：只写 MALL_DIR/data/ 与 MALL_DIR/config/，绝不改 MALL_DIR/app/
#   - .env 从 MALL_DIR/config/.env 读取，compose 一律带 --env-file
#   - 破坏性操作先打印将被覆盖的内容 → 显式确认 → 支持 --dry-run
#   - 幂等：pg_restore 对同一备份重复执行结果一致，重复执行不产生额外副作用
#
# 用法:
#   bash deploy/scripts/restore.sh --list
#   bash deploy/scripts/restore.sh --backup 20251109-120000 --dry-run
#   bash deploy/scripts/restore.sh --backup 20251109-120000
#   bash deploy/scripts/restore.sh --backup 20251109-120000 --yes
#   bash deploy/scripts/restore.sh --backup 20251109-120000 --force
#
# 退出码: 0=恢复成功  1=执行失败  2=用户取消  3=参数/环境错误

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${COMPOSE_DIR}/.." && pwd)"
MALL_DIR="${MALL_DIR:-/opt/mall}"
ENV_FILE="${MALL_DIR}/config/.env"
BACKUP_ROOT="${MALL_DIR}/data/backup"
STATE_DIR="${MALL_DIR}/data/runtime/restore"
# healthcheck.sh 与 docker-compose.yml 同级（deploy/ 下），不是仓库根目录
HEALTHCHECK="${COMPOSE_DIR}/healthcheck.sh"

BACKUP_LABEL=""
BACKUP_DIR=""
DRY_RUN=0
ASSUME_YES=0
FORCE=0
MERGE=0
SKIP_MIGRATE=0
SKIP_HEALTH=0
RESTORE_ENV=0
PURGE_UPLOADS=0
LIST_ONLY=0

log()  { printf '[restore] %s\n' "$*"; }
warn() { printf '[restore][WARN] %s\n' "$*"; }
err()  { printf '[restore][ERROR] %s\n' "$*" >&2; }
die()  { local code="${2:-1}"; err "$1"; exit "$code"; }

usage() {
  cat <<'EOF'
用法: restore.sh [选项]
  --list              列出可用的备份（标签 / 时间 / 大小 / MANIFEST 状态）后退出
  --backup LABEL      要恢复的备份标签（对应 data/backup/<LABEL>/）
  --backup-dir PATH   直接指定备份目录（优先于 --backup）
  --dry-run           只打印将要执行的动作与影响范围，不改动任何数据
  --yes               跳过交互确认（供自动化/CI 使用）
  --force             强制重新执行（默认：同一备份已恢复过则跳过恢复、仅复检健康）
  --merge             合并式恢复（pg_restore --clean --if-exists，不重建 public schema）
  --skip-migrate      恢复后不执行 migrator（仅在回滚到旧版程序时使用）
  --skip-healthcheck  恢复后不跑 healthcheck.sh
  --restore-env       允许用备份里的 .env 覆盖当前 .env（默认不覆盖，保护密钥）
  --purge-uploads     恢复前清空 uploads 目录（默认保留：归档覆盖写，备份之后新增的文件会残留）
  -h, --help          显示本帮助

退出码: 0=成功 1=失败 2=用户取消 3=参数/环境错误
EOF
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --list)           LIST_ONLY=1 ;;
      --backup)         BACKUP_LABEL="${2:-}"; [[ -n "$BACKUP_LABEL" ]] || die "--backup 缺少标签参数" 3; shift ;;
      --backup-dir)     BACKUP_DIR="${2:-}"; [[ -n "$BACKUP_DIR" ]] || die "--backup-dir 缺少路径参数" 3; shift ;;
      --dry-run)        DRY_RUN=1 ;;
      --yes|-y)         ASSUME_YES=1 ;;
      --force)          FORCE=1 ;;
      --merge)          MERGE=1 ;;
      --skip-migrate)   SKIP_MIGRATE=1 ;;
      --skip-healthcheck) SKIP_HEALTH=1 ;;
      --restore-env)    RESTORE_ENV=1 ;;
      --purge-uploads)  PURGE_UPLOADS=1 ;;
      -h|--help)        usage; exit 0 ;;
      -*)               err "未知参数: $1"; usage; exit 3 ;;
      *)                [[ -z "$BACKUP_LABEL" ]] && BACKUP_LABEL="$1" || die "多余的位置参数: $1" 3 ;;
    esac
    shift
  done
}

compose() {
  ( cd "$COMPOSE_DIR" && docker compose --env-file "$ENV_FILE" "$@" )
}

have_docker() { command -v docker >/dev/null 2>&1; }

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  else
    echo ""
  fi
}

human_size() {
  local b="${1:-0}"
  if [[ "$b" =~ ^[0-9]+$ ]]; then
    awk -v b="$b" 'BEGIN{ if (b>=1048576) printf "%.1fM", b/1048576; else if (b>=1024) printf "%.1fK", b/1024; else printf "%dB", b }'
  else
    echo "?"
  fi
}

# ---------- 只读工具 ----------

# dump 有效性下限：真实商城库 dump 至少几十 KB，低于 1KB 一律视为无效。
# 空文件 / 被截断的 dump 恢复后会把库清成空，这是比不恢复更糟的结果。
DUMP_MIN_BYTES=1024

# 基于文件真实内容做白名单判定（绝不依据 MANIFEST 字段 —— MANIFEST 自己也可能撒谎）：
#   custom  = 头部 PGDMP（pg_dump 自定义格式）→ pg_restore
#   plain   = 可识别的纯 SQL 文本（pg_dump 默认格式）→ psql
#   invalid = 其余一切（空文件、截断、损坏、内容不对）→ 拒绝恢复
detect_dump_format() {
  local f="$1"
  [[ -f "$f" ]] || { echo "invalid"; return 0; }

  local size
  size="$(wc -c <"$f" 2>/dev/null | tr -d ' ')"
  [[ "$size" =~ ^[0-9]+$ ]] || size=0
  if (( size < DUMP_MIN_BYTES )); then
    echo "invalid"
    return 0
  fi

  if [[ "$(head -c 5 "$f" 2>/dev/null)" == "PGDMP" ]]; then
    echo "custom"
    return 0
  fi

  # 纯 SQL 文本的真实内容特征（pg_dump 默认输出的头部）
  if head -c 4096 "$f" 2>/dev/null \
      | grep -qE '^(SET |SELECT pg_catalog|\\connect|COPY |CREATE TABLE|-- PostgreSQL database dump|-- Dumped from)'; then
    echo "plain"
    return 0
  fi

  echo "invalid"
}

# 人类可读的判定说明（用于报错信息）
describe_dump() {
  local f="$1" fmt="$2" size
  size="$(wc -c <"$f" 2>/dev/null | tr -d ' ')"
  [[ "$size" =~ ^[0-9]+$ ]] || size=0
  case "$fmt" in
    custom) printf 'custom 格式（PGDMP，%s 字节）' "$size" ;;
    plain)  printf '纯 SQL 文本（%s 字节）' "$size" ;;
    *)      printf '无效（%s 字节，低于下限 %s 或内容不是 pg_dump 产物）' "$size" "$DUMP_MIN_BYTES" ;;
  esac
}

# 执行前的最后防线：备份不可用时直接退出，一行数据库命令都不执行。
# 由 verify_integrity（早期拦截）与 restore_database（执行前拦截）双重调用，
# 保证「dry-run 通过」不等于「真实路径不校验」。
assert_dump_usable() {
  local dump="${BACKUP_DIR}/mall.dump"
  if [[ ! -f "$dump" ]]; then
    local m_db
    m_db="$(manifest_get db)"
    if [[ "$m_db" == "skipped" || -z "$m_db" ]]; then
      return 0   # 本来就不含数据库，不是「坏备份」
    fi
    err "备份文件 ${dump} 不存在，但 MANIFEST 声明 db: ${m_db} —— 备份不可信"
    die "拒绝执行：一行数据库命令都不会执行" 1
  fi
  local fmt
  fmt="$(detect_dump_format "$dump")"
  case "$fmt" in
    custom|plain) return 0 ;;
    *)
      err "备份文件既不是 custom 格式也不是可识别的纯 SQL 文本，疑似空文件或损坏"
      err "  文件: ${dump}  判定: $(describe_dump "$dump" "$fmt")"
      die "拒绝执行：一行数据库命令都不会执行。请改用完好的备份目录" 1 ;;
  esac
}

list_backups() {
  if [[ ! -d "$BACKUP_ROOT" ]]; then
    log "没有备份目录: ${BACKUP_ROOT}"
    return 0
  fi
  printf '%-22s %-26s %-10s %-12s %s\n' "标签" "时间" "dump大小" "数据库" "完整性"
  local d
  for d in "$BACKUP_ROOT"/*; do
    [[ -d "$d" ]] || continue
    local label time dsize db chk fmt
    label="$(basename "$d")"
    time="-"; dsize="0B"; db="缺失"; chk="-"
    [[ -f "$d/MANIFEST" ]] && time="$(awk -F': *' '/^time:/{print $2; exit}' "$d/MANIFEST")"
    [[ -f "$d/SHA256SUMS" ]] && chk="有校验和" || chk="无校验和"
    # 数据库列基于文件真实内容判定，不抄 MANIFEST（MANIFEST 可能谎报 db: ok）
    if [[ -f "$d/mall.dump" ]]; then
      fmt="$(detect_dump_format "$d/mall.dump")"
      dsize="$(human_size "$(wc -c <"$d/mall.dump" 2>/dev/null | tr -d ' ')")"
      case "$fmt" in
        custom) db="ok" ;;
        plain)  db="ok(纯SQL)" ;;
        *)      db="无效" ;;
      esac
    fi
    printf '%-22s %-26s %-10s %-12s %s\n' "$label" "${time:--}" "$dsize" "$db" "$chk"
  done
}

resolve_backup_dir() {
  if [[ -n "$BACKUP_DIR" ]]; then
    [[ -d "$BACKUP_DIR" ]] || die "备份目录不存在: ${BACKUP_DIR}" 3
    BACKUP_DIR="$(cd "$BACKUP_DIR" && pwd)"
    [[ -n "$BACKUP_LABEL" ]] || BACKUP_LABEL="$(basename "$BACKUP_DIR")"
    return 0
  fi
  [[ -n "$BACKUP_LABEL" ]] || die "必须指定 --backup <标签> 或 --backup-dir <路径>（--list 可查看可用备份）" 3
  local cand="${BACKUP_ROOT}/${BACKUP_LABEL}"
  [[ -d "$cand" ]] || die "备份不存在: ${cand}（用 --list 查看可用备份）" 3
  BACKUP_DIR="$(cd "$cand" && pwd)"
}

manifest_get() {
  local key="$1"
  [[ -f "${BACKUP_DIR}/MANIFEST" ]] || return 0
  awk -F': *' -v k="$key" '$1==k {print $2; exit}' "${BACKUP_DIR}/MANIFEST"
}

# ---------- 完整性校验 ----------

verify_integrity() {
  log "校验备份完整性…"

  # 0) MANIFEST 声明的状态必须先看：failed = 该备份的某个环节失败，产物不可信
  local m_db
  m_db="$(manifest_get db)"
  if [[ "$m_db" == "failed" ]]; then
    err "该备份的数据库备份是失败的（MANIFEST: db: failed），拒绝用它恢复"
    die "请改用备份状态正常的目录，或先重新执行 bash deploy/scripts/backup.sh" 1
  fi

  # 1) dump 本体必须真实有效 —— 这道校验独立于 SHA256SUMS：
  #    SHA256 对 0 字节文件同样能「校验通过」，所以摘要匹配说明不了内容有效。
  #    判定标准：存在 + 不低于下限 + 白名单格式（PGDMP 或可识别的纯 SQL 文本）。
  local dump="${BACKUP_DIR}/mall.dump"
  if [[ -f "$dump" ]]; then
    local fmt size
    fmt="$(detect_dump_format "$dump")"
    size="$(wc -c <"$dump" 2>/dev/null | tr -d ' ')"
    [[ "$size" =~ ^[0-9]+$ ]] || size=0
    case "$fmt" in
      custom) : ;;
      plain)
        warn "mall.dump 是纯 SQL 文本格式，将改用 psql 恢复（不是 pg_restore）" ;;
      *)
        err "备份文件既不是 custom 格式也不是可识别的纯 SQL 文本，疑似空文件或损坏"
        err "  文件: ${dump}  大小: ${size} 字节（有效下限 ${DUMP_MIN_BYTES} 字节）"
        err "  后果: 继续执行会 DROP SCHEMA public CASCADE 后用这个文件重建，等于清空当前数据库"
        die "拒绝恢复：一行数据库命令都不会执行。请改用完好的备份目录，或重新执行 bash deploy/scripts/backup.sh" 1 ;;
    esac
  elif [[ "$m_db" == "ok" ]]; then
    err "MANIFEST 说 db: ok，但 mall.dump 不存在，备份不可信"
    die "拒绝恢复，请改用完好的备份目录" 1
  else
    warn "该备份不含数据库（MANIFEST: db: ${m_db:-无}），恢复时将跳过数据库，只恢复 uploads 与配置"
  fi

  # 2) 归档必须真的能解开：损坏的 tar.gz 会「解出空目录」，让 uploads 静默丢失
  local arc
  for arc in uploads.tar.gz config.tar.gz; do
    [[ -f "${BACKUP_DIR}/${arc}" ]] || continue
    if ! tar -tzf "${BACKUP_DIR}/${arc}" >/dev/null 2>&1; then
      err "归档 ${arc} 损坏或不是有效的 tar.gz（解开会是空目录，uploads/配置会静默丢失）"
      die "拒绝恢复，请改用完好的备份目录" 1
    fi
  done

  # 3) 校验和
  if [[ ! -f "${BACKUP_DIR}/SHA256SUMS" ]]; then
    warn "该备份没有 SHA256SUMS（旧的 backup.sh 产物），无法校验完整性"
    warn "处置：升级后重新执行一次 bash deploy/scripts/backup.sh 即可获得带校验和的备份"
    return 0
  fi
  local tmp_out rc=0
  tmp_out="$(mktemp)"
  if command -v sha256sum >/dev/null 2>&1; then
    ( cd "$BACKUP_DIR" && sha256sum -c SHA256SUMS ) >"$tmp_out" 2>&1 || rc=$?
  elif command -v shasum >/dev/null 2>&1; then
    ( cd "$BACKUP_DIR" && shasum -a 256 -c SHA256SUMS ) >"$tmp_out" 2>&1 || rc=$?
  else
    warn "系统没有 sha256sum / shasum，跳过校验和验证"
    rm -f "$tmp_out"
    return 0
  fi
  if (( rc == 0 )); then
    # 注意：grep -c 在 0 匹配时会「打印 0 并返回 1」，若再 || echo 0 会打印两次
    local okn
    okn="$(awk '/: OK$/{n++} END{print n+0}' "$tmp_out" 2>/dev/null)"
    log "校验通过: ${okn:-0} 个文件摘要匹配"
    rm -f "$tmp_out" || true
    return 0
  fi
  err "备份完整性校验失败，中止恢复（未改动任何数据）"
  sed 's/^/[restore]   /' "$tmp_out" >&2
  rm -f "$tmp_out" || true
  die "请改用一个完好的备份目录重试" 1
}

# ---------- 计划打印 ----------
#
# 注意：dump 格式判定只有一个实现，位于文件上方的 detect_dump_format()（白名单 + 尺寸下限）。
# 这里不要再定义同名函数 —— bash 以后定义的同名函数会覆盖先前的，
# 曾经因此让「1KB 下限」静默失效（旧实现只看头部，空文件/短文件会被误判为纯 SQL）。

print_plan() {
  local dump="${BACKUP_DIR}/mall.dump"
  local uptar="${BACKUP_DIR}/uploads.tar.gz"
  local cfgtar="${BACKUP_DIR}/config.tar.gz"

  echo ""
  echo "================ 恢复影响范围（执行前必读） ================"
  echo "备份目录: ${BACKUP_DIR}"
  echo "备份标签: ${BACKUP_LABEL}"
  echo "备份时间: $(manifest_get time)"
  echo ""

  echo "[1] 数据库（覆盖）"
  if [[ -f "$dump" ]]; then
    local fmt size
    fmt="$(detect_dump_format "$dump")"
    size="$(wc -c <"$dump" | tr -d ' ')"
    case "$fmt" in
      custom) echo "    备份文件: mall.dump  大小 $(human_size "$size")  格式 自定义(pg_restore)" ;;
      plain)  echo "    备份文件: mall.dump  大小 $(human_size "$size")  格式 纯SQL(psql)" ;;
      *)      echo "    备份文件: mall.dump  大小 $(human_size "$size")  格式 异常(${fmt})" ;;
    esac
    if have_docker; then
      local cur
      cur="$(compose exec -T postgres psql -U mall -d mall -tAc \
        "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'" 2>/dev/null || echo "")"
      [[ -n "$cur" ]] && echo "    当前 public schema 表数量: ${cur}（将被备份内容整体替换）"
    else
      echo "    当前表数量: 未知（本机无 Docker，未连接数据库）"
    fi
    if (( MERGE )); then
      echo "    恢复方式: 合并式（pg_restore --clean --if-exists，逐对象替换，不动 schema）"
      echo "    注意: 合并式只支持自定义格式备份；纯 SQL 备份会自动退回整体替换"
    else
      echo "    恢复方式: 整体替换（先 DROP SCHEMA public CASCADE，再按备份重建）"
      echo "    注意: 备份之后新增的表/列会一并消失（这是恢复的定义）"
    fi
    echo "    影响: 目标库 mall 的全部业务数据被备份时点覆盖"
  else
    echo "    跳过: MANIFEST 中 db=skipped，备份不含数据库"
  fi
  echo ""

  echo "[2] 上传文件"
  if [[ -f "$uptar" ]]; then
    local cnt size
    # 注意：grep -c 在 0 匹配时会「打印 0 并返回 1」，用 || echo 0 会导致 0 被打印两次、
    # 输出被拆成两行。改用 awk 计数，恒定返回单个数字。
    cnt="$(tar -tzf "$uptar" 2>/dev/null | awk '!/\/$/{n++} END{print n+0}')"
    size="$(wc -c <"$uptar" | tr -d ' ')"
    echo "    归档文件数: ${cnt}  大小 $(human_size "$size")"
    echo "    目标目录: ${MALL_DIR}/data/uploads"
    if (( PURGE_UPLOADS )); then
      echo "    恢复方式: 先清空 uploads 目录再解包（严格还原备份时点）"
    else
      echo "    恢复方式: 覆盖写（同名文件被覆盖，备份之后新增的文件会保留）"
    fi
    echo "    影响: 同名上传文件被备份版本覆盖"
  else
    echo "    跳过: MANIFEST 中 uploads=skipped，备份不含上传文件"
  fi
  echo ""

  echo "[3] 配置"
  if [[ -f "$cfgtar" ]]; then
    echo "    归档内文件:"
    tar -tzf "$cfgtar" 2>/dev/null | sed 's/^/      /' | head -40 || true
    echo "    始终跳过: secrets.json（密钥，永不从备份写回）"
    if (( RESTORE_ENV )); then
      echo "    本次将写回: .env（含密钥，按 --restore-env 显式开启）"
    else
      echo "    本次将写回: .env 被跳过（含密钥，默认保护）"
    fi
    echo "    始终跳过: *.key"
    echo "    影响: 上述非密钥配置文件被备份版本覆盖"
  else
    echo "    跳过: MANIFEST 中 config=skipped，备份不含配置快照"
  fi
  echo ""

  echo "[4] 服务状态"
  echo "    将停止（保留数据库与缓存）: api worker storefront admin nginx"
  echo "    将保持运行: postgres redis pgbouncer"
  echo "    恢复后: 执行 migrator（可用 --skip-migrate 关闭）→ 拉起应用 → healthcheck.sh"
  echo "=============================================================="
  echo ""
}

confirm() {
  local prompt="$1"
  local ans=""
  if (( ASSUME_YES )); then
    log "已通过 --yes 跳过确认"
    return 0
  fi
  if (( DRY_RUN )); then
    log "dry-run 模式：只打印计划，未做任何改动，无需确认"
    return 0
  fi
  # 优先从终端读；没有控制终端时退回 stdin；两者都读不到说明是非交互环境
  if ! { printf '%s' "$prompt" >/dev/tty 2>/dev/null && read -r ans </dev/tty 2>/dev/null; }; then
    if ! { printf '%s' "$prompt" && read -r ans; }; then
      err "无法读取交互确认（非交互环境）"
      die "执行破坏性恢复必须显式加 --yes 确认" 3
    fi
  fi
  if [[ "$ans" != "yes" ]]; then
    log "已取消（未做任何修改）"
    exit 2
  fi
}

# ---------- 执行步骤 ----------

stop_app_services() {
  log "[1/6] 停止应用容器（保留 postgres / redis / pgbouncer）"
  if (( DRY_RUN )); then
    echo "    [dry-run] docker compose stop api worker storefront admin nginx"
    return 0
  fi
  compose stop api worker storefront admin nginx
}

restore_database() {
  local dump="${BACKUP_DIR}/mall.dump"
  log "[2/6] 恢复数据库"

  # ===== 执行前的最后防线（对应要求 C）=====
  # 这一步必须发生在任何数据库命令之前：DROP SCHEMA public CASCADE 一旦执行，
  # 再发现备份不可用就晚了（库已经被清空）。dry-run 通过不代表真实路径也校验过，
  # 所以这里不依赖 verify_integrity 的结果，重新独立判定一次。
  assert_dump_usable

  if [[ ! -f "$dump" ]]; then
    local m_db
    m_db="$(manifest_get db)"
    if [[ "$m_db" == "failed" ]]; then
      die "备份的数据库部分是 failed 状态，拒绝恢复数据库" 1
    fi
    warn "备份不含数据库文件（MANIFEST: db: ${m_db:-无}），跳过数据库恢复（当前数据库保持原样）"
    return 0
  fi
  local fmt
  fmt="$(detect_dump_format "$dump")"
  case "$fmt" in
    custom|plain) : ;;
    *) die "mall.dump 内容无效（${fmt}），拒绝恢复数据库" 1 ;;
  esac

  # 恢复参数：
  #   默认（整体替换）—— schema 已被重建，库是空的，不需要 --clean
  #   合并式 —— 不动 schema，靠 pg_restore 的 --clean --if-exists 逐对象替换
  #   纯 SQL 备份不支持逐对象替换，只能整体替换
  local restore_flags=(--no-owner --no-privileges --single-transaction)
  local drop_schema=1
  if (( MERGE )) && [[ "$fmt" == "custom" ]]; then
    restore_flags=(--clean --if-exists --no-owner --no-privileges --single-transaction)
    drop_schema=0
  elif (( MERGE )); then
    warn "合并式恢复只支持自定义格式（pg_restore）的备份；当前是纯 SQL 格式，改为整体替换"
  fi

  if (( DRY_RUN )); then
    if (( drop_schema )); then
      echo "    [dry-run] DROP SCHEMA public CASCADE → pg_restore ${restore_flags[*]}"
    else
      echo "    [dry-run] pg_restore ${restore_flags[*]}（逐对象替换，不动 schema）"
    fi
    return 0
  fi

  if (( drop_schema )); then
    log "    重建 public schema（备份之后的表/列会消失）"
    compose exec -T postgres psql -v ON_ERROR_STOP=1 -U mall -d mall \
      -c 'DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;' >/dev/null
    # 还原 PG15+ 的默认属主；失败不影响恢复结果
    compose exec -T postgres psql -U mall -d mall \
      -c 'ALTER SCHEMA public OWNER TO pg_database_owner;' >/dev/null 2>&1 || true
  else
    log "    合并式恢复：不重建 schema，逐对象替换"
  fi

  if [[ "$fmt" == "custom" ]]; then
    local cid
    cid="$(compose ps -q postgres 2>/dev/null | head -1)"
    if [[ -n "$cid" ]]; then
      local tmp_in="/tmp/mall-restore-$$.dump"
      docker cp "$dump" "${cid}:${tmp_in}"
      compose exec -T postgres pg_restore -U mall -d mall "${restore_flags[@]}" "$tmp_in" \
        || { compose exec -T postgres rm -f "$tmp_in" >/dev/null 2>&1 || true; die "pg_restore 失败，数据库未被改动（--single-transaction 保证原子性）" 1; }
      compose exec -T postgres rm -f "$tmp_in" >/dev/null 2>&1 || true
    else
      log "    找不到 postgres 容器，改用标准输入管道恢复"
      pg_restore_stdin custom "${restore_flags[@]}"
    fi
  else
    log "    备份为纯 SQL 格式，改用 psql 恢复"
    pg_restore_stdin plain "${restore_flags[@]}"
  fi
  log "    数据库恢复完成"
}

pg_restore_stdin() {
  local fmt="$1"
  shift
  if [[ "$fmt" == "custom" ]]; then
    compose exec -T postgres pg_restore -U mall -d mall "$@" <"${BACKUP_DIR}/mall.dump" \
      || die "pg_restore 失败，数据库未被改动" 1
  else
    compose exec -T postgres psql -v ON_ERROR_STOP=1 -U mall -d mall <"${BACKUP_DIR}/mall.dump" \
      || die "psql 恢复失败，数据库处于已重建 schema 的状态，请用 --merge 重试或换备份" 1
  fi
}

restore_uploads() {
  local uptar="${BACKUP_DIR}/uploads.tar.gz"
  log "[3/6] 恢复上传文件"
  if [[ ! -f "$uptar" ]]; then
    warn "备份不含上传文件，跳过"
    return 0
  fi
  if (( DRY_RUN )); then
    echo "    [dry-run] tar -xzf uploads.tar.gz -C ${MALL_DIR}/data"
    return 0
  fi
  mkdir -p "${MALL_DIR}/data"
  if (( PURGE_UPLOADS )); then
    rm -rf "${MALL_DIR:?}/data/uploads"
    log "    已清空 uploads 目录（--purge-uploads）"
  fi
  tar -xzf "$uptar" -C "${MALL_DIR}/data" || die "上传文件解包失败" 1
  log "    上传文件恢复完成"
}

restore_config() {
  local cfgtar="${BACKUP_DIR}/config.tar.gz"
  log "[4/6] 恢复配置快照"
  if [[ ! -f "$cfgtar" ]]; then
    warn "备份不含配置快照，跳过"
    return 0
  fi
  if (( DRY_RUN )); then
    echo "    [dry-run] 解包到临时目录后逐文件写回 ${MALL_DIR}/config（跳过 secrets.json / .env / *.key）"
    return 0
  fi
  local tmp
  tmp="$(mktemp -d)"
  # 解包到临时目录再逐个拷贝：可以精确控制跳过密钥文件，避免归档里混入密钥时被动写回
  tar -xzf "$cfgtar" -C "$tmp" || { rm -rf "$tmp" || true; die "配置快照解包失败" 1; }
  mkdir -p "${MALL_DIR}/config"
  local restored=0 skipped=0 f rel base
  while IFS= read -r -d '' f; do
    rel="${f#"${tmp}/"}"
    base="$(basename "$f")"
    case "$base" in
      secrets.json) skipped=$((skipped+1)); continue ;;
      .env)
        if (( RESTORE_ENV )); then
          cp -p "$f" "${MALL_DIR}/config/${rel}"
          restored=$((restored+1))
          log "    已写回 .env（--restore-env）"
        else
          skipped=$((skipped+1))
          log "    跳过 .env（含密钥，默认不覆盖；需要时加 --restore-env）"
        fi
        continue ;;
      *.key) skipped=$((skipped+1)); continue ;;
    esac
    mkdir -p "$(dirname "${MALL_DIR}/config/${rel}")"
    cp -p "$f" "${MALL_DIR}/config/${rel}"
    restored=$((restored+1))
  done < <(find "$tmp" -type f -print0)
  rm -rf "$tmp" || true
  chmod 0600 "${MALL_DIR}/config/.env" 2>/dev/null || true
  log "    配置恢复完成（写回 ${restored} 个文件，跳过 ${skipped} 个密钥类文件）"
}

run_migrations() {
  log "[5/6] 执行数据库迁移"
  if (( SKIP_MIGRATE )); then
    warn "按 --skip-migrate 跳过迁移（仅在回滚到旧版程序时使用）"
    return 0
  fi
  if (( DRY_RUN )); then
    echo "    [dry-run] docker compose run --rm migrator"
    return 0
  fi
  compose run --rm migrator || die "迁移失败：恢复后的库与当前程序不匹配，请检查后重跑" 1
  log "    迁移完成（schema_migrations 已与当前程序对齐）"
}

start_app_services() {
  log "[6/6] 拉起应用并做健康检查"
  if (( DRY_RUN )); then
    echo "    [dry-run] docker compose up -d api worker storefront admin nginx"
    echo "    [dry-run] docker compose exec -T nginx nginx -s reload"
    echo "    [dry-run] bash deploy/healthcheck.sh"
    return 0
  fi
  compose up -d api worker storefront admin nginx
  # nginx.conf 是 bind mount，改过配置必须显式 reload（真机问题 #28 的配套修法）
  compose exec -T nginx nginx -s reload >/dev/null 2>&1 \
    || warn "nginx reload 失败，请手动执行: (cd ${COMPOSE_DIR} && docker compose --env-file ${ENV_FILE} exec -T nginx nginx -s reload)"
  if (( SKIP_HEALTH )); then
    warn "按 --skip-healthcheck 跳过健康检查"
    return 0
  fi
  if [[ -x "$HEALTHCHECK" ]]; then
    bash "$HEALTHCHECK" || die "健康检查未通过：恢复完成但服务不正常，请检查日志" 1
  else
    warn "找不到 healthcheck.sh（${HEALTHCHECK}），跳过健康检查"
  fi
}

mark_done() {
  local marker="${STATE_DIR}/${BACKUP_LABEL}.done"
  if (( DRY_RUN )); then
    echo "    [dry-run] 写入恢复标记 ${marker}"
    return 0
  fi
  mkdir -p "$STATE_DIR"
  printf 'label=%s\ntime=%s\nresult=ok\n' "$BACKUP_LABEL" "$(date -Iseconds)" >"$marker"
}

# ---------- 主流程 ----------

main() {
  parse_args "$@"

  if (( LIST_ONLY )); then
    list_backups
    exit 0
  fi

  resolve_backup_dir

  log "备份标签: ${BACKUP_LABEL}"
  log "备份目录: ${BACKUP_DIR}"

  if [[ ! -f "${BACKUP_DIR}/MANIFEST" ]]; then
    die "备份目录缺少 MANIFEST，不是有效的备份目录: ${BACKUP_DIR}" 3
  fi

  verify_integrity

  # 环境前置检查
  if ! have_docker; then
    if (( DRY_RUN )); then
      warn "本机没有 Docker，dry-run 将只打印计划（真实执行需要 Docker）"
    else
      die "未检测到 Docker，无法恢复。处置: 安装 Docker 后重跑，或先加 --dry-run 查看计划" 1
    fi
  elif [[ ! -f "$ENV_FILE" ]]; then
    if (( DRY_RUN )); then
      warn "缺少 ${ENV_FILE}，dry-run 继续（真实执行需要该文件）"
    else
      die "缺少环境变量文件 ${ENV_FILE}。处置: 重新执行 bash deploy/install.sh 生成，或手工恢复该文件" 1
    fi
  fi

  # 幂等：同一备份已恢复过则默认跳过恢复动作，只复检健康
  local marker="${STATE_DIR}/${BACKUP_LABEL}.done"
  local already_done=0
  if [[ -f "$marker" ]] && (( ! FORCE )); then
    already_done=1
    if (( DRY_RUN )); then
      warn "该备份已于之前恢复过（标记: ${marker}）——真实执行时本次会跳过恢复动作、仅复检健康；如需重跑请加 --force"
    else
      log "该备份已于之前恢复过（标记: ${marker}）"
      log "为保证幂等，本次不重复执行恢复动作；如需重跑请加 --force"
      start_app_services
      exit $?
    fi
  fi

  print_plan
  confirm "确认执行恢复？该操作会覆盖上面的数据。输入 yes 继续: "

  # 停服务之前再验一次备份（对应要求 C/E）：
  # 校验必须在「动数据」之前完成；这里再拦一道，避免校验与执行之间文件被改动
  # （TOCTOU）时已经把站点停了却没恢复。
  assert_dump_usable

  stop_app_services
  restore_database
  restore_uploads
  restore_config
  run_migrations
  start_app_services
  if (( already_done )); then
    log "dry-run 结束（真实执行时本步会因幂等标记被跳过）"
    exit 0
  fi
  mark_done

  log "恢复完成：${BACKUP_LABEL}"
  log "回滚本次恢复：重新执行 bash deploy/scripts/restore.sh --backup <其它标签> --yes"
}

main "$@"
