#!/usr/bin/env bash
# doctor.sh — 生产环境诊断：一次跑出所有关键指标，并给出可直接执行的修复命令。
#
# 设计原则：
#   - 不用 set -e：单项检查失败不能中断整体诊断，全部跑完再汇总
#   - 每项输出 [OK] / [WARN] / [FAIL]；FAIL 必带「处置」命令（可直接复制粘贴执行）
#   - 退出码：全部 OK 或仅 WARN → 0；存在 FAIL → 1
#   - --json 输出机器可读结果，便于接入外部监控
#
# 用法:
#   bash deploy/scripts/doctor.sh
#   bash deploy/scripts/doctor.sh --json
#   bash deploy/scripts/doctor.sh --url http://127.0.0.1:8080
#
# 退出码: 0=无 FAIL  1=存在 FAIL  2=参数错误

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${COMPOSE_DIR}/.." && pwd)"
MALL_DIR="${MALL_DIR:-/opt/mall}"
ENV_FILE="${MALL_DIR}/config/.env"
SECRETS_FILE="${MALL_DIR}/config/secrets.json"
BACKUP_ROOT="${MALL_DIR}/data/backup"
STATE_FILE="${MALL_DIR}/config/.install-state"

JSON_MODE=0
HEALTH_BASE=""
SKIP_HTTP=0
SKIP_ADMIN_PROBE=0
# 数据库 dump 的有效下限（与 restore.sh 的 DUMP_MIN_BYTES 保持一致）：
# 真实商城库 dump 至少几十 KB，低于 1KB 一律视为无效备份
DUMP_MIN_BYTES=1024

CHECKS_OK=0
CHECKS_WARN=0
CHECKS_FAIL=0
CHECKS_SKIP=0
JSON_ROWS=()

# compose 里的 9 个常驻服务（migrator 是一次性任务，不在期望列表内）
EXPECT_SERVICES="postgres redis pgbouncer api worker storefront admin nginx"
# 带 healthcheck 的服务：状态不是 healthy 视为 FAIL
HEALTH_SERVICES="postgres redis pgbouncer api"

log()  { printf '[doctor] %s\n' "$*"; }
warn() { printf '[doctor][WARN] %s\n' "$*" >&2; }

usage() {
  cat <<'EOF'
用法: doctor.sh [选项]
  --json            输出机器可读 JSON（用于外部监控采集）
  --url BASE        站点根地址（默认从 .env 的 HTTP_PORT 推导 http://127.0.0.1:<port>）
  --skip-http       跳过 HTTP 层检查（健康端点 / 默认口令探测）
  --skip-admin-probe  只跳过「管理端默认口令」这一项探测（记 SKIP，不是 OK）
  -h, --help        显示帮助

退出码: 0=无 FAIL  1=存在 FAIL  2=参数错误
EOF
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --json)       JSON_MODE=1 ;;
      --url)        HEALTH_BASE="${2:-}"; [[ -n "$HEALTH_BASE" ]] || { echo "--url 缺少参数" >&2; exit 2; }; shift ;;
      --skip-http)  SKIP_HTTP=1 ;;
      --skip-admin-probe) SKIP_ADMIN_PROBE=1 ;;
      -h|--help)    usage; exit 0 ;;
      *)            echo "未知参数: $1" >&2; usage; exit 2 ;;
    esac
    shift
  done
}

# ---------- 结果记录 ----------

json_escape() {
  local s="$1"
  s="${s//\\/\\\\}"
  s="${s//\"/\\\"}"
  s="${s//$'\n'/\\n}"
  s="${s//$'\r'/\\r}"
  s="${s//$'\t'/\\t}"
  printf '%s' "$s"
}

record() {
  local status="$1" id="$2" title="$3" detail="$4" fix="${5:-}"
  case "$status" in
    ok)   CHECKS_OK=$((CHECKS_OK + 1)) ;;
    warn) CHECKS_WARN=$((CHECKS_WARN + 1)) ;;
    fail) CHECKS_FAIL=$((CHECKS_FAIL + 1)) ;;
    skip) CHECKS_SKIP=$((CHECKS_SKIP + 1)) ;;
  esac
  local fix_json=""
  [[ -n "$fix" ]] && fix_json=",\"fix\":\"$(json_escape "$fix")\""
  JSON_ROWS+=("{\"id\":\"$(json_escape "$id")\",\"status\":\"${status}\",\"title\":\"$(json_escape "$title")\",\"detail\":\"$(json_escape "$detail")\"${fix_json}}")
  if (( JSON_MODE )); then
    return 0
  fi
  printf '[%s] %s — %s\n' "$(printf '%s' "$status" | tr '[:lower:]' '[:upper:]')" "$title" "$detail"
  if [[ -n "$fix" ]]; then
    printf '      处置: %s\n' "$fix"
  fi
}

# ---------- 工具 ----------

compose() {
  ( cd "$COMPOSE_DIR" && docker compose --env-file "$ENV_FILE" "$@" )
}

have_docker() { command -v docker >/dev/null 2>&1; }

docker_ok() {
  have_docker && docker info >/dev/null 2>&1
}

# 读取 .env 的某个键（不 source，避免执行任意内容）
env_get() {
  local key="$1" line val
  [[ -f "$ENV_FILE" ]] || return 1
  line="$(grep -E "^[[:space:]]*${key}=" "$ENV_FILE" 2>/dev/null | tail -1)"
  [[ -n "$line" ]] || return 1
  val="${line#*=}"
  val="${val#"${val%%[![:space:]]*}"}"
  val="${val%"${val##*[![:space:]]}"}"
  # 去掉成对引号
  if [[ "${val:0:1}" == '"' && "${val: -1}" == '"' && ${#val} -ge 2 ]]; then
    val="${val:1:${#val}-2}"
  elif [[ "${val:0:1}" == "'" && "${val: -1}" == "'" && ${#val} -ge 2 ]]; then
    val="${val:1:${#val}-2}"
  fi
  printf '%s' "$val"
}

compose_cmd() { printf 'cd %s && docker compose --env-file %s %s' "$COMPOSE_DIR" "$ENV_FILE" "$*"; }

# dev 默认值黑名单：compose 里的 fallback 值 + 常见弱口令
is_dev_default() {
  local v="$1"
  case "$v" in
    ""|mall|dev-jwt-secret|dev-encryption-key|dev|dev-secret|changeme|change-me|change_me|\
    password|secret|123456|12345678|1234567890|admin|root|test|testing|local|localhost|\
    mall_secret|mall-secret|mallpassword|your-secret|xxx|xxxxx)
      return 0 ;;
  esac
  return 1
}

# 密钥强度：长度 + 非重复字符 + 不是弱口令
secret_weakness() {
  local v="$1" min="$2"
  if [[ -z "$v" ]]; then echo "未设置"; return 0; fi
  if is_dev_default "$v"; then echo "仍是 dev 默认值"; return 0; fi
  if (( ${#v} < min )); then echo "长度不足 ${#v} < ${min}"; return 0; fi
  local uniq
  uniq="$(printf '%s' "$v" | fold -w1 | sort -u | tr -d '\n')"
  if (( ${#uniq} <= 2 )); then echo "字符重复度过高（有效字符 ${#uniq} 种）"; return 0; fi
  if printf '%s' "$v" | grep -qiE '^(secret|password|test|demo|example|sample|default)'; then
    echo "内容形似示例口令"; return 0
  fi
  return 1
}

human_size() {
  local b="${1:-0}"
  awk -v b="$b" 'BEGIN{ if (b>=1073741824) printf "%.1fG", b/1073741824; else if (b>=1048576) printf "%.1fM", b/1048576; else if (b>=1024) printf "%.1fK", b/1024; else printf "%dB", b }'
}

# ---------- 1. 环境 ----------

# 运维脚本指纹：让「服务器上的 deploy/ 是不是我这版」一眼可核对。
# 背景：本项目出现过多次「本地改了、真机那台还是旧版」的误判（看的是服务器上的旧文件）。
# 指纹是脚本内容哈希，两边各跑一次 doctor.sh 对比这行即可确认版本一致。
fingerprint() {
  local f="$1" out=""
  [[ -f "$f" ]] || { printf '缺失'; return; }
  if command -v sha256sum >/dev/null 2>&1; then
    out="$(sha256sum "$f" 2>/dev/null | cut -c1-12)"
  elif command -v shasum >/dev/null 2>&1; then
    out="$(shasum -a 256 "$f" 2>/dev/null | cut -c1-12)"
  else
    out="$(cksum "$f" 2>/dev/null | awk '{print $1}')"
  fi
  printf '%s' "${out:-?}"
}

check_environment() {
  # 运维脚本指纹（用来核对服务器上的 deploy/ 与仓库是不是同一版）
  local fp_doctor fp_restore fp_backup fp_setup fp_setadmin
  fp_doctor="$(fingerprint "${SCRIPT_DIR}/doctor.sh")"
  fp_restore="$(fingerprint "${SCRIPT_DIR}/restore.sh")"
  fp_backup="$(fingerprint "${SCRIPT_DIR}/backup.sh")"
  fp_setup="$(fingerprint "${SCRIPT_DIR}/setup-https.sh")"
  fp_setadmin="$(fingerprint "${SCRIPT_DIR}/set-admin-password.sh")"
  record ok "deploy.fingerprint" "运维脚本指纹" \
    "doctor=${fp_doctor} restore=${fp_restore} backup=${fp_backup} https=${fp_setup} set-admin=${fp_setadmin}"
  record ok "deploy.fingerprint.hint" "指纹核对方法" \
    "在服务器与仓库各跑一次 doctor.sh，比对 deploy.fingerprint 那一行；不一致说明服务器上的 deploy/ 是旧版，需重新部署程序目录"

  if ! have_docker; then
    record fail "docker.cli" "Docker 命令" "本机没有 docker 命令" \
      "安装 Docker: curl -fsSL https://get.docker.com | sh && sudo systemctl enable --now docker"
    SKIP_REASON="Docker 不可用"
    return
  fi
  record ok "docker.cli" "Docker 命令" "$(docker --version 2>/dev/null | head -1)"

  if ! docker info >/dev/null 2>&1; then
    record fail "docker.daemon" "Docker 守护进程" "docker info 连不上，守护进程未运行" \
      "启动守护进程: sudo systemctl start docker && sudo systemctl status docker"
    SKIP_REASON="Docker 守护进程未运行"
    return
  fi
  record ok "docker.daemon" "Docker 守护进程" "可连接"

  local cver
  cver="$(docker compose version --short 2>/dev/null | head -1)"
  if [[ -z "$cver" ]]; then
    record fail "docker.compose" "Docker Compose" "compose 插件不可用" \
      "安装 compose 插件: sudo apt-get install -y docker-compose-plugin"
  else
    record ok "docker.compose" "Docker Compose" "v${cver}"
  fi

  # 磁盘
  local avail_kb total_kb pct
  avail_kb="$(df -Pk "$MALL_DIR" 2>/dev/null | awk 'NR==2{print $4}')"
  total_kb="$(df -Pk "$MALL_DIR" 2>/dev/null | awk 'NR==2{print $2}')"
  if [[ -n "${avail_kb:-}" && -n "${total_kb:-}" ]] && (( total_kb > 0 )); then
    pct=$(( avail_kb * 100 / total_kb ))
    if (( pct < 10 )); then
      record fail "disk.space" "磁盘剩余空间" "${MALL_DIR} 所在分区剩余 $(human_size $((avail_kb*1024)))（${pct}%）" \
        "清理磁盘: docker system prune -af --volumes=false && journalctl --vacuum-size=200M"
    elif (( pct < 20 )); then
      record warn "disk.space" "磁盘剩余空间" "${MALL_DIR} 所在分区剩余 $(human_size $((avail_kb*1024)))（${pct}%）" \
        "建议清理: docker system prune -af --volumes=false"
    else
      record ok "disk.space" "磁盘剩余空间" "剩余 $(human_size $((avail_kb*1024)))（${pct}%）"
    fi
  else
    record warn "disk.space" "磁盘剩余空间" "无法读取 ${MALL_DIR} 的磁盘信息"
  fi

  # 内存
  local mem_total avail_mem swap_total swap_free
  mem_total="$(awk '/MemTotal/{print $2}' /proc/meminfo 2>/dev/null)"
  avail_mem="$(awk '/MemAvailable/{print $2}' /proc/meminfo 2>/dev/null)"
  swap_total="$(awk '/SwapTotal/{print $2}' /proc/meminfo 2>/dev/null)"
  swap_free="$(awk '/SwapFree/{print $2}' /proc/meminfo 2>/dev/null)"
  if [[ -n "${mem_total:-}" ]]; then
    local detail="总量 $((mem_total/1024))M，可用 $((avail_mem/1024))M"
    if (( ${avail_mem:-0} < 262144 )); then
      record warn "mem.available" "可用内存" "${detail}（低于 256M，可能触发 OOM）" \
        "排查: docker stats --no-stream && dmesg -T | grep -i 'killed process'"
    else
      record ok "mem.available" "可用内存" "${detail}"
    fi
    if (( ${swap_total:-0} == 0 )); then
      record warn "mem.swap" "交换分区" "未配置 swap（内存耗尽时进程会被直接杀掉）" \
        "创建 2G swap: sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile"
    else
      record ok "mem.swap" "交换分区" "总量 $((swap_total/1024))M，已用 $(( (swap_total-swap_free)/1024 ))M"
    fi
  else
    record warn "mem.available" "可用内存" "无法读取 /proc/meminfo"
  fi

  # Docker 占用
  local dusage
  dusage="$(docker system df --format '{{.Type}} {{.Size}}' 2>/dev/null | grep -i 'images' | awk '{print $2}' | head -1)"
  if [[ -n "$dusage" ]]; then
    record ok "docker.disk" "Docker 镜像占用" "${dusage}"
  fi
}

# ---------- 2. 容器 ----------

check_containers() {
  [[ -n "${SKIP_REASON:-}" ]] && return
  local ps_out svc line state status
  ps_out="$(compose ps --format '{{.Service}}|{{.State}}|{{.Status}}' 2>/dev/null)"
  if [[ -z "$ps_out" ]]; then
    record fail "compose.ps" "Compose 服务列表" "取不到服务列表（compose 执行失败）" \
      "$(compose_cmd "ps")"
    return
  fi

  for svc in $EXPECT_SERVICES; do
    line="$(printf '%s\n' "$ps_out" | grep -E "^${svc}\|" | head -1)"
    if [[ -z "$line" ]]; then
      record fail "container.${svc}" "容器 ${svc}" "服务未创建（compose 中没有该服务实例）" \
        "$(compose_cmd "up -d ${svc}")"
      continue
    fi
    state="$(printf '%s' "$line" | cut -d'|' -f2)"
    status="$(printf '%s' "$line" | cut -d'|' -f3)"
    if [[ "$state" != "running" ]]; then
      record fail "container.${svc}" "容器 ${svc}" "状态 ${state}（${status}）" \
        "$(compose_cmd "logs --tail 50 ${svc}") && $(compose_cmd "up -d ${svc}")"
      continue
    fi
    if [[ " $HEALTH_SERVICES " == *" ${svc} "* ]]; then
      if [[ "$status" != *"(healthy)"* ]]; then
        record fail "container.${svc}" "容器 ${svc}" "运行中但不是 healthy（${status}）" \
          "$(compose_cmd "logs --tail 50 ${svc}") && $(compose_cmd "restart ${svc}")"
        continue
      fi
    fi
    record ok "container.${svc}" "容器 ${svc}" "running${status:+ / $status}"
  done

  # 重启次数：反复重启是最常见的隐性故障
  local svc2 cid rc
  for svc2 in $EXPECT_SERVICES; do
    cid="$(compose ps -q "$svc2" 2>/dev/null | head -1)"
    [[ -n "$cid" ]] || continue
    rc="$(docker inspect -f '{{.RestartCount}}' "$cid" 2>/dev/null)"
    if [[ "${rc:-0}" =~ ^[0-9]+$ ]] && (( rc > 3 )); then
      record warn "container.restart.${svc2}" "容器 ${svc2} 重启次数" "已重启 ${rc} 次（可能崩溃循环）" \
        "$(compose_cmd "logs --tail 100 ${svc2}")"
    fi
  done

  # 镜像统一性：api / worker / migrator 必须跑同一份镜像（防版本漂移）
  # 注：静态判定（compose 声明）不依赖 Docker，所以放在 check_containers 之外单独跑。

  # nginx 配置语法（改过 nginx.conf 必须验证）
  if compose exec -T nginx nginx -t >/dev/null 2>&1; then
    record ok "nginx.config" "nginx 配置语法" "nginx -t 通过"
  else
    record fail "nginx.config" "nginx 配置语法" "nginx -t 失败，配置有语法错误" \
      "$(compose_cmd "exec -T nginx nginx -t")"
  fi
}

# ---------- 3. 数据库 ----------

# 从 compose 文件里取某个服务声明的 image（取到的是未插值的原文，如 ${IMAGE_NAME:-mall-app:local}）
service_image() {
  local svc="$1" f="${COMPOSE_DIR}/docker-compose.yml"
  [[ -f "$f" ]] || return 0
  sed -n "/^  ${svc}:/,/^  [a-z]/p" "$f" \
    | grep -E '^[[:space:]]+image:' | head -1 | sed 's/.*image:[[:space:]]*//'
}

# 镜像统一性检查（防版本漂移）。
#
# 背景：api / worker / migrator 曾经各写一份 build:，compose 会生成 deploy-api /
# deploy-worker / deploy-migrator 三个独立镜像标签。只 build 其中一两个，其余就是旧版，
# 而且没有任何机制会提醒你 —— 真实后果是 migrator 用旧镜像 → 新迁移文件没被加载 →
# 新表根本没建出来，而迁移日志还显示「成功」。
# 现在三者共用同一个 image 标签，这里做两道校验：compose 声明一致 + 运行中的容器真的是同一份。
check_image_unification() {
  local compose_file="${COMPOSE_DIR}/docker-compose.yml"
  if [[ ! -f "$compose_file" ]]; then
    record warn "image.unified" "三服务镜像标签统一" "找不到 ${compose_file}"
    return
  fi
  local svc img_a img_w img_m
  img_a="$(service_image api)"
  img_w="$(service_image worker)"
  img_m="$(service_image migrator)"
  if [[ -n "$img_a" && "$img_a" == "$img_w" && "$img_a" == "$img_m" ]]; then
    record ok "image.declared" "三服务镜像标签统一" "api / worker / migrator 均声明为 ${img_a}"
  else
    record fail "image.declared" "三服务镜像标签统一" \
      "api=${img_a:-无} worker=${img_w:-无} migrator=${img_m:-无} —— 标签不一致会导致构建漂移（只 build 其余服务就是旧版，且无任何提示）" \
      "统一为同一个标签: 在 ${compose_file} 里给 api/worker/migrator 都写 image: \${IMAGE_NAME:-mall-app:local}，并只保留 api 的 build 段"
  fi

  # 运行中的 api / worker 容器必须真的是同一份镜像
  local cid_a cid_w id_a id_w
  cid_a="$(compose ps -q api 2>/dev/null | head -1)"
  cid_w="$(compose ps -q worker 2>/dev/null | head -1)"
  if [[ -z "$cid_a" || -z "$cid_w" ]]; then
    if [[ -n "${SKIP_REASON:-}" ]]; then
      record skip "image.running" "运行中容器的镜像一致性" "${SKIP_REASON}，无法比对镜像 ID"
    else
      record warn "image.running" "运行中容器的镜像一致性" "api 或 worker 容器不存在，无法比对镜像 ID"
    fi
    return
  fi
  id_a="$(docker inspect -f '{{.Image}}' "$cid_a" 2>/dev/null)"
  id_w="$(docker inspect -f '{{.Image}}' "$cid_w" 2>/dev/null)"
  if [[ -n "$id_a" && "$id_a" == "$id_w" ]]; then
    record ok "image.running" "运行中容器的镜像一致性" "api 与 worker 的 image ID 相同（${id_a:0:19}…）"
  else
    record fail "image.running" "运行中容器的镜像一致性" \
      "api=${id_a:-未知} worker=${id_w:-未知} —— 两者不是同一份镜像" \
      "重新构建并重建容器: $(compose_cmd "build api") && $(compose_cmd "up -d --force-recreate api worker")"
  fi
}

check_database() {
  [[ -n "${SKIP_REASON:-}" ]] && return
  local out
  out="$(compose exec -T postgres psql -U mall -d mall -tAc 'SELECT version()' 2>/dev/null | head -1 | tr -d '\r')"
  if [[ -z "$out" ]]; then
    record fail "db.connect" "数据库连通性" "连不上 postgres（容器内 psql 无输出）" \
      "$(compose_cmd "logs --tail 50 postgres") && $(compose_cmd "restart postgres")"
    return
  fi
  record ok "db.connect" "数据库连通性" "$(printf '%s' "$out" | cut -c1-60)"

  # .env 的密码能否真正用于 TCP 认证（捕捉 .env 丢失后密码不一致的经典故障）
  local pgpass
  pgpass="$(env_get POSTGRES_PASSWORD)"
  if [[ -z "$pgpass" ]]; then
    record fail "db.password.match" "数据库口令一致性" ".env 里没有 POSTGRES_PASSWORD" \
      "补齐并重建容器: echo 'POSTGRES_PASSWORD=<真实口令>' >> ${ENV_FILE} && $(compose_cmd "up -d --force-recreate api worker pgbouncer")"
  else
    if compose exec -T -e PGPASSWORD="$pgpass" postgres psql -h 127.0.0.1 -U mall -d mall -tAc 'SELECT 1' >/dev/null 2>&1; then
      record ok "db.password.match" "数据库口令一致性" ".env 中的 POSTGRES_PASSWORD 可正常认证"
    else
      record fail "db.password.match" "数据库口令一致性" ".env 中的 POSTGRES_PASSWORD 与数据库实际口令不一致（典型场景：.env 丢失后重新生成）" \
        "从 secrets.json 恢复: grep POSTGRES_PASSWORD ${SECRETS_FILE} && 把该值写回 ${ENV_FILE} 后执行 $(compose_cmd "up -d --force-recreate pgbouncer api worker")"
    fi
  fi

  # 迁移是否最新
  check_migrations

  # 连接数
  local used maxc
  used="$(compose exec -T postgres psql -U mall -d mall -tAc "SELECT count(*) FROM pg_stat_activity" 2>/dev/null | tr -d '\r ')"
  maxc="$(compose exec -T postgres psql -U mall -d mall -tAc 'SHOW max_connections' 2>/dev/null | tr -d '\r ')"
  if [[ "${used:-0}" =~ ^[0-9]+$ && "${maxc:-0}" =~ ^[0-9]+$ ]] && (( maxc > 0 )); then
    if (( used * 100 / maxc >= 80 )); then
      record warn "db.connections" "数据库连接数" "${used}/${maxc}（占比 ≥80%，接近连接上限）" \
        "查看连接: $(compose_cmd "exec -T postgres psql -U mall -d mall -c \"SELECT state,count(*) FROM pg_stat_activity GROUP BY state\"")"
    else
      record ok "db.connections" "数据库连接数" "${used}/${maxc}"
    fi
  else
    # 查不到 ≠ 连接数正常：别让这一项凭空消失
    record warn "db.connections" "数据库连接数" "读不到连接数与 max_connections，**无法判定**" \
      "$(compose_cmd "exec -T postgres psql -U mall -d mall -tAc 'SELECT count(*) FROM pg_stat_activity'")"
  fi
}

# 迁移一致性：比对磁盘上的迁移文件与 schema_migrations 表
check_migrations() {
  local applied latest
  applied="$(compose exec -T postgres psql -U mall -d mall -tAc 'SELECT count(*) FROM schema_migrations' 2>/dev/null | tr -d '\r ')"
  latest="$(compose exec -T postgres psql -U mall -d mall -tAc 'SELECT name FROM schema_migrations ORDER BY name DESC LIMIT 1' 2>/dev/null | tr -d '\r')"
  if [[ -z "${applied:-}" ]]; then
    record fail "db.migrations.table" "迁移记录表" "读不到 schema_migrations 表（迁移未执行或表不存在）" \
      "$(compose_cmd "run --rm migrator")"
    return
  fi
  record ok "db.migrations.table" "迁移记录表" "已应用 ${applied} 个迁移，最新 ${latest:-无}"

  local disk_count disk_latest
  disk_count="$(count_disk_migrations)"
  disk_latest="$(latest_disk_migration)"
  if [[ -z "$disk_count" ]]; then
    record warn "db.migrations.freshness" "迁移是否最新" "找不到迁移源文件目录（${REPO_ROOT}/packages/*/migrations），无法比对" \
      "确认程序目录完整: ls ${REPO_ROOT}/packages/core/migrations"
    return
  fi
  if (( disk_count > applied )); then
    record fail "db.migrations.freshness" "迁移是否最新" "磁盘上有 ${disk_count} 个迁移，数据库只应用了 ${applied} 个，缺少 $((disk_count-applied)) 个" \
      "$(compose_cmd "run --rm migrator")"
  elif (( disk_count < applied )); then
    record warn "db.migrations.freshness" "迁移是否最新" "数据库有 ${applied} 个迁移记录，磁盘上只有 ${disk_count} 个（程序版本比数据库旧）" \
      "确认程序版本: ls ${MALL_DIR}/app/packages/modules"
  elif [[ -n "$disk_latest" && -n "$latest" && "$disk_latest" != "$latest" ]]; then
    record warn "db.migrations.freshness" "迁移是否最新" "数量一致（${applied}）但最新迁移名不同：库=${latest} 磁盘=${disk_latest}" \
      "$(compose_cmd "run --rm migrator")"
  else
    record ok "db.migrations.freshness" "迁移是否最新" "磁盘 ${disk_count} 个迁移全部已应用（最新 ${latest}）"
  fi
}

# 统计磁盘上的迁移文件数量（core + links + 各业务模块）
count_disk_migrations() {
  local dir n=0 total=0
  local dirs=()
  for dir in "${REPO_ROOT}/packages/core/migrations" "${REPO_ROOT}/packages/links/migrations"; do
    [[ -d "$dir" ]] && dirs+=("$dir")
  done
  for dir in "${REPO_ROOT}"/packages/modules/*/migrations; do
    [[ -d "$dir" ]] && dirs+=("$dir")
  done
  (( ${#dirs[@]} == 0 )) && return 1
  for dir in "${dirs[@]}"; do
    n="$(find "$dir" -maxdepth 1 -name '*.sql' -type f 2>/dev/null | wc -l | tr -d ' ')"
    total=$((total + n))
  done
  printf '%s' "$total"
}

# 磁盘上按 name 排序最大的迁移名（与 schema_migrations 的 ORDER BY name DESC 对齐）
latest_disk_migration() {
  local dir f ns name best=""
  local dirs=()
  for dir in "${REPO_ROOT}/packages/core/migrations" "${REPO_ROOT}/packages/links/migrations"; do
    [[ -d "$dir" ]] && dirs+=("$dir")
  done
  for dir in "${REPO_ROOT}"/packages/modules/*/migrations; do
    [[ -d "$dir" ]] && dirs+=("$dir")
  done
  (( ${#dirs[@]} == 0 )) && return 1
  local tmp
  tmp="$(mktemp)"
  for dir in "${dirs[@]}"; do
    ns="$(basename "$(dirname "$dir")")"
    for f in "$dir"/*.sql; do
      [[ -f "$f" ]] || continue
      name="${ns}/$(basename "$f")"
      printf '%s\n' "$name" >>"$tmp"
    done
  done
  best="$(LC_ALL=C sort -r "$tmp" 2>/dev/null | head -1)"
  rm -f "$tmp" 2>/dev/null
  [[ -n "$best" ]] && printf '%s' "$best"
}

# ---------- 4. Redis 与队列 ----------

redis_cmd() {
  compose exec -T redis redis-cli "$@" 2>/dev/null | tr -d '\r'
}

check_redis() {
  [[ -n "${SKIP_REASON:-}" ]] && return
  local pong
  pong="$(redis_cmd PING)"
  if [[ "$pong" != "PONG" ]]; then
    record fail "redis.connect" "Redis 连通性" "PING 未返回 PONG（当前: ${pong:-无响应}）" \
      "$(compose_cmd "logs --tail 50 redis") && $(compose_cmd "restart redis")"
    return
  fi
  local rver
  rver="$(redis_cmd INFO server | grep -E '^redis_version:' | cut -d: -f2)"
  record ok "redis.connect" "Redis 连通性" "PING 正常，版本 ${rver:-未知}"

  # 内存水位
  local used maxmem policy
  used="$(redis_cmd INFO memory | grep -E '^used_memory:' | cut -d: -f2)"
  maxmem="$(redis_cmd INFO memory | grep -E '^maxmemory:' | cut -d: -f2)"
  policy="$(redis_cmd INFO memory | grep -E '^maxmemory_policy:' | cut -d: -f2)"
  if [[ "${maxmem:-0}" =~ ^[0-9]+$ ]] && (( maxmem > 0 )) && [[ "${used:-0}" =~ ^[0-9]+$ ]]; then
    local pct=$(( used * 100 / maxmem ))
    if (( pct >= 90 )); then
      record fail "redis.memory" "Redis 内存水位" "已用 $(human_size "$used") / 上限 $(human_size "$maxmem")（${pct}%）" \
        "定位大键: $(compose_cmd "exec -T redis redis-cli --bigkeys")"
    elif (( pct >= 75 )); then
      record warn "redis.memory" "Redis 内存水位" "已用 $(human_size "$used") / 上限 $(human_size "$maxmem")（${pct}%）" \
        "观察增长: $(compose_cmd "exec -T redis redis-cli INFO memory")"
    else
      record ok "redis.memory" "Redis 内存水位" "已用 $(human_size "$used") / 上限 $(human_size "$maxmem")（${pct}%），策略 ${policy:-未知}"
    fi
  fi

  # 持久化
  local aof rdb
  aof="$(redis_cmd CONFIG GET appendonly | tail -1)"
  rdb="$(redis_cmd CONFIG GET save | tail -1)"
  if [[ "$aof" == "yes" ]]; then
    record ok "redis.persist" "Redis 持久化" "AOF 已开启，save=${rdb:-未知}"
  else
    record warn "redis.persist" "Redis 持久化" "AOF 未开启（appendonly=${aof:-未知}），Redis 重启后队列任务会丢" \
      "开启 AOF: $(compose_cmd "exec -T redis redis-cli CONFIG SET appendonly yes")"
  fi

  # 认证
  local reqpass
  reqpass="$(redis_cmd CONFIG GET requirepass | tail -1)"
  if [[ -z "$reqpass" ]]; then
    record warn "redis.auth" "Redis 认证" "未设置 requirepass（当前仅靠 Docker 内网隔离）" \
      "设置口令: $(compose_cmd "exec -T redis redis-cli CONFIG SET requirepass '<强口令>'")（同时同步到 .env 的 REDIS_URL）"
  else
    record ok "redis.auth" "Redis 认证" "已设置 requirepass"
  fi

  check_queue
}


check_queue() {
  [[ -n "${SKIP_REASON:-}" ]] && return
  # bullmq 的键形如 bull:<queue>:wait / :active / :delayed / :failed
  local keys
  keys="$(redis_cmd --scan --pattern 'bull:*' | sort -u)"
  if [[ -z "$keys" ]]; then
    record warn "queue.backlog" "队列积压" "Redis 里没有 bull:* 键（队列还没被使用，或队列名不是 bullmq 默认前缀）" \
      "手工确认队列名: $(compose_cmd "exec -T redis redis-cli --scan --pattern '*'")"
    return
  fi
  local q wait active delayed failed total_q backlog=0 failed_total=0
  local queues unreadable=0
  queues="$(printf '%s\n' "$keys" | sed -n 's/^bull:\([^:]*\):.*/\1/p' | sort -u)"
  local detail=""
  for q in $queues; do
    wait="$(redis_cmd LLEN "bull:${q}:wait" | tr -d ' \r')"
    active="$(redis_cmd LLEN "bull:${q}:active" | tr -d ' \r')"
    delayed="$(redis_cmd LLEN "bull:${q}:delayed" | tr -d ' \r')"
    failed="$(redis_cmd LLEN "bull:${q}:failed" | tr -d ' \r')"
    # 读不到长度 ≠ 长度为 0：Redis 不可达时 redis-cli 返回空，
    # 当成 0 会把「查不到」谎报成「没有积压/没有失败任务」（假绿灯）。
    if ! [[ "${wait:-}" =~ ^[0-9]+$ ]] || ! [[ "${failed:-}" =~ ^[0-9]+$ ]]; then
      unreadable=1
      break
    fi
    [[ "${active:-}" =~ ^[0-9]+$ ]] || active=0
    [[ "${delayed:-}" =~ ^[0-9]+$ ]] || delayed=0
    backlog=$((backlog + wait + delayed))
    failed_total=$((failed_total + failed))
    detail="${detail}${q}: 待处理=${wait} 执行中=${active} 延时=${delayed} 失败=${failed}; "
  done
  if (( unreadable )); then
    record warn "queue.backlog" "队列积压" "读取队列长度失败（Redis 可能不可达），**无法判定积压与失败任务数**" \
      "先确认 Redis: $(compose_cmd "exec -T redis redis-cli PING")"
    return
  fi
  if (( backlog > 1000 )); then
    record fail "queue.backlog" "队列积压" "积压 ${backlog} 条（超过 1000 阈值）— ${detail}" \
      "确认 worker 是否在跑: $(compose_cmd "ps worker") && $(compose_cmd "logs --tail 50 worker")"
  elif (( backlog > 100 )); then
    record warn "queue.backlog" "队列积压" "积压 ${backlog} 条 — ${detail}" \
      "观察 worker: $(compose_cmd "logs --tail 50 worker")"
  else
    record ok "queue.backlog" "队列积压" "积压 ${backlog} 条 — ${detail}"
  fi
  if (( failed_total > 0 )); then
    record warn "queue.failed" "失败任务" "有 ${failed_total} 条任务处于 failed 状态" \
      "查看失败原因: $(compose_cmd "exec -T redis redis-cli LRANGE bull:payment-webhook:failed 0 -1")"
  else
    record ok "queue.failed" "失败任务" "0 条"
  fi
}

# ---------- 5. 配置与密钥 ----------

check_config() {
  # .env 存在性
  if [[ ! -f "$ENV_FILE" ]]; then
    record fail "config.env" ".env 存在性" "${ENV_FILE} 不存在（容器会 fallback 到 compose 里的 dev 默认值）" \
      "重新生成: bash ${COMPOSE_DIR}/install.sh"
    return
  fi
  record ok "config.env" ".env 存在性" "${ENV_FILE}"

  # 权限
  local perm
  perm="$(stat -c '%a' "$ENV_FILE" 2>/dev/null || stat -f '%Lp' "$ENV_FILE" 2>/dev/null)"
  if [[ "$perm" == "600" ]]; then
    record ok "config.env.perm" ".env 文件权限" "0600"
  elif [[ -n "$perm" ]]; then
    record warn "config.env.perm" ".env 文件权限" "当前 ${perm}（应为 600，同机器其他用户可读密钥）" \
      "chmod 600 ${ENV_FILE}"
  fi

  # secrets.json
  if [[ -f "$SECRETS_FILE" ]]; then
    local sperm
    sperm="$(stat -c '%a' "$SECRETS_FILE" 2>/dev/null || stat -f '%Lp' "$SECRETS_FILE" 2>/dev/null)"
    if [[ "$sperm" == "600" ]]; then
      record ok "config.secrets" "secrets.json" "存在，权限 0600"
    else
      record warn "config.secrets" "secrets.json" "存在但权限 ${sperm}（应为 600）" \
        "chmod 600 ${SECRETS_FILE}"
    fi
  else
    record warn "config.secrets" "secrets.json" "${SECRETS_FILE} 不存在（密钥只落在 .env，无备份副本）" \
      "备份密钥: cp ${ENV_FILE} ${SECRETS_FILE} && chmod 600 ${SECRETS_FILE}"
  fi

  # 密钥强度
  check_secret "JWT_SECRET" 32
  check_secret "ENCRYPTION_KEY" 32
  check_secret "POSTGRES_PASSWORD" 16

  # 容器内实际生效的密钥（捕捉 .env 改了但容器没重建的情况）
  check_runtime_secret "JWT_SECRET" "JWT_SECRET"
  check_runtime_secret "ENCRYPTION_KEY" "ENCRYPTION_KEY"

  # CORS
  local cors
  cors="$(env_get CORS_ORIGINS)"
  if [[ "$cors" == "*" || -z "$cors" ]]; then
    record warn "config.cors" "CORS 白名单" "CORS_ORIGINS=${cors:-未设置}（等于放行所有来源）" \
      "改为具体域名: sed -i 's|^CORS_ORIGINS=.*|CORS_ORIGINS=https://你的域名|' ${ENV_FILE} && $(compose_cmd "up -d --force-recreate api worker")"
  else
    record ok "config.cors" "CORS 白名单" "${cors}"
  fi

  # 其它关键项
  # NODE_ENV 由 compose 固定为 production（不从 .env 读），所以查容器实际生效值
  local node_env
  node_env="$(compose exec -T api printenv NODE_ENV 2>/dev/null | tr -d '\r\n')"
  if [[ -z "$node_env" ]]; then
    record warn "config.NODE_ENV" "NODE_ENV" "读不到容器里的 NODE_ENV（api 容器可能没在跑）" \
      "$(compose_cmd "ps api")"
  elif [[ "$node_env" == "production" ]]; then
    record ok "config.NODE_ENV" "NODE_ENV" "production（容器实际生效值）"
  else
    record warn "config.NODE_ENV" "NODE_ENV" "当前是 ${node_env}（生产应为 production）" \
      "改 compose: sed -i 's|NODE_ENV: .*|NODE_ENV: production|' ${COMPOSE_DIR}/docker-compose.yml && $(compose_cmd "up -d --force-recreate api worker")"
  fi

  local log_level
  log_level="$(env_get LOG_LEVEL)"
  if [[ -n "$log_level" ]]; then
    record ok "config.LOG_LEVEL" ".env LOG_LEVEL" "$log_level"
  else
    record warn "config.LOG_LEVEL" ".env LOG_LEVEL" "未设置（将使用 compose 默认 info）" \
      "建议显式声明: echo 'LOG_LEVEL=info' >> ${ENV_FILE}"
  fi
}

check_secret() {
  local key="$1" min="$2" val reason
  val="$(env_get "$key")"
  if [[ -z "$val" ]]; then
    record fail "secret.${key}" "密钥 ${key}" "未设置（容器会 fallback 到 compose 的 dev 默认值）" \
      "生成并写入: echo '${key}=$(openssl rand -hex 32)' >> ${ENV_FILE} && $(compose_cmd "up -d --force-recreate api worker pgbouncer")"
    return
  fi
  reason="$(secret_weakness "$val" "$min")"
  if [[ -n "$reason" ]]; then
    record fail "secret.${key}" "密钥 ${key}" "${reason}（值长度 ${#val}）" \
      "换成强随机值: sed -i 's|^${key}=.*|${key}=$(openssl rand -hex 32)|' ${ENV_FILE} && $(compose_cmd "up -d --force-recreate api worker pgbouncer")"
    return
  fi
  record ok "secret.${key}" "密钥 ${key}" "已设置，长度 ${#val}，非 dev 默认值"
}

check_runtime_secret() {
  local key="$1" env_key="$2"
  local cval ev
  cval="$(compose exec -T api printenv "$env_key" 2>/dev/null | tr -d '\r\n')"
  ev="$(env_get "$key")"
  if [[ -z "$cval" ]]; then
    # 读不到容器里的值 ≠ 值一致：明确记 WARN，别让这一项凭空消失
    record warn "runtime.${key}" "容器内生效的 ${key}" "读不到 api 容器里的 ${env_key}（容器可能没在跑），**无法判定是否与 .env 一致**" \
      "$(compose_cmd "exec -T api printenv ${env_key}")"
    return
  fi
  if [[ "$cval" == "$ev" ]]; then
    record ok "runtime.${key}" "容器内生效的 ${key}" "与 .env 一致"
    return
  fi
  if is_dev_default "$cval"; then
    record fail "runtime.${key}" "容器内生效的 ${key}" "容器里跑的是 dev 默认值，而 .env 里是另一个值（容器没有按当前 .env 重建）" \
      "重建容器: $(compose_cmd "up -d --force-recreate api worker")"
    return
  fi
  record fail "runtime.${key}" "容器内生效的 ${key}" "与 .env 不一致（容器未按当前 .env 重建）" \
    "重建容器: $(compose_cmd "up -d --force-recreate api worker")"
}

# ---------- 6. HTTP 层 ----------

check_http() {
  [[ -n "${SKIP_REASON:-}" ]] && return
  if (( SKIP_HTTP )); then
    record skip "http.layer" "HTTP 层检查" "按 --skip-http 跳过"
    return
  fi
  local base="${HEALTH_BASE}"
  if [[ -z "$base" ]]; then
    local port
    port="$(env_get HTTP_PORT)"
    [[ -n "$port" ]] || port=80
    base="http://127.0.0.1:${port}"
  fi
  base="${base%/}"

  if ! command -v curl >/dev/null 2>&1; then
    record warn "http.curl" "HTTP 探测工具" "没有 curl，跳过 HTTP 层检查" \
      "安装: sudo apt-get install -y curl"
    return
  fi

  # nginx 可达
  local code
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "${base}/healthz" 2>/dev/null)"
  if [[ "$code" == "200" ]]; then
    record ok "http.nginx" "nginx 可达性" "${base}/healthz 返回 200"
  else
    record fail "http.nginx" "nginx 可达性" "${base}/healthz 返回 ${code:-无响应}" \
      "$(compose_cmd "logs --tail 50 nginx") && $(compose_cmd "restart nginx")"
  fi

  # API 健康端点
  local body
  body="$(curl -s --max-time 8 "${base}/api/v1/health" 2>/dev/null)"
  if [[ -z "$body" ]]; then
    record fail "http.health" "API 健康端点" "${base}/api/v1/health 无响应" \
      "$(compose_cmd "logs --tail 50 api")"
    return
  fi
  if [[ "$body" == *'"status":"ok"'* ]]; then
    record ok "http.health" "API 健康端点" "status=ok"
  else
    local degraded=""
    printf '%s' "$body" | grep -o '"[a-z]*":"degraded"' | tr '\n' ' ' | sed 's/ $//' >/dev/null
    degraded="$(printf '%s' "$body" | grep -oE '"(db|redis|queue)":"degraded"' | sed 's/.*:"//;s/"//' | tr '\n' ',' | sed 's/,$//')"
    record fail "http.health" "API 健康端点" "status 非 ok，降级项: ${degraded:-未知}（响应: $(printf '%s' "$body" | cut -c1-120)）" \
      "$(compose_cmd "logs --tail 50 api")"
  fi

  # 管理端默认口令探测（独立函数，便于单独测试）
  check_admin_default_password "$base"
}

# 管理端默认口令探测
#
# 核心原则：「探测失败」与「口令已改」是两件事，绝不能混为一谈。
# 曾经这里只要响应里带 "code" 字段就判 OK —— 结果限流响应（code 60001）被当成
# 「口令已改」，真实风险（默认口令仍在生产上生效）被判成 OK、体检退出码 0，
# 给运维虚假的安全感。现在按响应码严格分类：
#   code 0 / 响应含 access_token → 登录成功 → 口令仍生效 → FAIL
#   code 10005（凭证错误）        → 口令确实已改            → OK
#   code 60001 / HTTP 429（限流） → 无法判定                → WARN
#   其余（网络错误/5xx/非信封）   → 无法判定                → WARN（绝不判 OK）
check_admin_default_password() {
  local base="$1"
  if (( SKIP_ADMIN_PROBE )); then
    record skip "http.admin.default" "管理端默认口令" \
      "按 --skip-admin-probe 跳过探测（未判定，不代表口令已改）"
    return
  fi
  local probe_body probe_http probe_code probe_resp
  probe_body="$(mktemp)"
  probe_http="$(curl -s -o "$probe_body" -w '%{http_code}' --max-time 8 \
      -X POST "${base}/api/v1/admin/auth/login" \
      -H 'Content-Type: application/json' \
      -d '{"email":"admin","password":"123456"}' 2>/dev/null || echo "000")"
  probe_resp="$(cat "$probe_body" 2>/dev/null || echo "")"
  rm -f "$probe_body" 2>/dev/null || true
  probe_code="$(printf '%s' "$probe_resp" \
    | grep -oE '"code"[[:space:]]*:[[:space:]]*[0-9]+' | head -1 | grep -oE '[0-9]+' || true)"

  if [[ "$probe_resp" == *'"access_token"'* ]] || [[ "$probe_code" == "0" ]]; then
    record fail "http.admin.default" "管理端默认口令" \
      "admin/123456 仍可登录（种子默认口令未被修改，HTTP ${probe_http}）" \
      "首选：后台改密页；或调改密端点 POST /api/v1/admin/auth/change-password（需管理员 access_token，保留 admin_user.id 与角色绑定）；应急兜底: bash ${SCRIPT_DIR}/set-admin-password.sh --password '<至少8位且含字母与数字>'"
  elif [[ "$probe_code" == "10005" ]]; then
    record ok "http.admin.default" "管理端默认口令" "admin/123456 已无法登录（凭证错误 10005）"
  elif [[ "$probe_code" == "60001" || "$probe_http" == "429" ]]; then
    record warn "http.admin.default" "管理端默认口令" \
      "默认口令探测被限流（code ${probe_code:-未知} / HTTP ${probe_http}），**无法判定口令是否已改**；请在登录未被限流时重跑" \
      "等 60 秒后重跑: bash ${SCRIPT_DIR}/doctor.sh；或明确跳过本项: bash ${SCRIPT_DIR}/doctor.sh --skip-admin-probe"
  else
    local resp_show="${probe_resp:0:80}"
    [[ -n "$resp_show" ]] || resp_show="（空响应）"
    record warn "http.admin.default" "管理端默认口令" \
      "默认口令探测无法判定（HTTP ${probe_http:-无响应}，响应: ${resp_show}）—— **这不代表口令已改**" \
      "确认接口可达: curl -s -o /dev/null -w '%{http_code}\\n' -X POST ${base}/api/v1/admin/auth/login -H 'Content-Type: application/json' -d '{\"email\":\"admin\",\"password\":\"123456\"}'"
  fi
}

# ---------- 7. 备份 ----------

check_backup() {
  if [[ ! -d "$BACKUP_ROOT" ]]; then
    record fail "backup.dir" "备份目录" "${BACKUP_ROOT} 不存在（没有任何备份）" \
      "立即备份: bash ${SCRIPT_DIR}/backup.sh"
    return
  fi
  local newest="" d
  for d in "$BACKUP_ROOT"/*; do
    [[ -d "$d" ]] || continue
    if [[ -z "$newest" ]]; then
      newest="$d"
    else
      local tn nn
      tn="$(stat -c '%Y' "$d" 2>/dev/null || echo 0)"
      nn="$(stat -c '%Y' "$newest" 2>/dev/null || echo 0)"
      if (( tn > nn )); then newest="$d"; fi
    fi
  done
  if [[ -z "$newest" ]]; then
    record fail "backup.latest" "最近备份" "备份目录里没有任何备份" \
      "立即备份: bash ${SCRIPT_DIR}/backup.sh"
    return
  fi
  local label age_h size dump_size
  label="$(basename "$newest")"
  age_h=$(( ( $(date +%s) - $(stat -c '%Y' "$newest" 2>/dev/null || echo 0) ) / 3600 ))
  # 大小看数据库 dump 本体，而不是目录总大小：0 字节 dump 也会让目录「非空」
  dump_size="$(wc -c <"${newest}/mall.dump" 2>/dev/null | tr -d ' ' || echo 0)"
  [[ -n "$dump_size" ]] || dump_size=0
  size="$(du -sb "$newest" 2>/dev/null | awk '{print $1}')"
  if (( age_h > 168 )); then
    record fail "backup.latest" "最近备份" "最新备份 ${label} 距今 ${age_h} 小时（超过 7 天）" \
      "立即备份: bash ${SCRIPT_DIR}/backup.sh"
  elif (( age_h > 24 )); then
    record warn "backup.latest" "最近备份" "最新备份 ${label} 距今 ${age_h} 小时（超过 24 小时），dump $(human_size "$dump_size")" \
      "补一次备份: bash ${SCRIPT_DIR}/backup.sh"
  else
    record ok "backup.latest" "最近备份" "最新备份 ${label}（${age_h} 小时前，dump $(human_size "$dump_size")，目录 $(human_size "${size:-0}")）"
  fi

  # 数据库 dump 是否真的可用（与 SHA256 校验相互独立：空文件也能通过 SHA256 校验）
  # 这是「备份失败却报 ok」这类假闭环的核心防线。
  # 判定规则与 restore.sh 的 assert_dump_usable 保持一致，避免出现
  # 「doctor 说备份可用、restore 却拒绝恢复」的自相矛盾。
  local dump="${newest}/mall.dump"
  local m_db=""
  if [[ -f "${newest}/MANIFEST" ]]; then
    m_db="$(awk -F': *' '$1=="db"{print $2; exit}' "${newest}/MANIFEST")"
  fi
  if [[ ! -f "$dump" ]]; then
    if [[ "$m_db" == "skipped" || -z "$m_db" ]]; then
      record warn "backup.db.valid" "备份的数据库 dump" "该备份没有数据库 dump（MANIFEST: db: ${m_db:-无}）" \
        "补一次含数据库的备份: bash ${SCRIPT_DIR}/backup.sh"
    else
      record fail "backup.db.valid" "备份的数据库 dump" "MANIFEST 说 db: ${m_db}，但 mall.dump 不存在" \
        "重新备份: bash ${SCRIPT_DIR}/backup.sh"
    fi
  elif [[ ! -s "$dump" ]]; then
    record fail "backup.db.valid" "备份的数据库 dump" "mall.dump 是 0 字节（数据库备份实际失败，MANIFEST: db: ${m_db:-未知}）——空 dump 通过 SHA256 校验也说明不了问题" \
      "重新备份: bash ${SCRIPT_DIR}/backup.sh"
  elif (( dump_size < DUMP_MIN_BYTES )); then
    record fail "backup.db.valid" "备份的数据库 dump" "mall.dump 只有 ${dump_size} 字节（低于有效下限 ${DUMP_MIN_BYTES} 字节），恢复时会被判定为无效备份而拒绝执行" \
      "重新备份: bash ${SCRIPT_DIR}/backup.sh"
  elif [[ "$(head -c 5 "$dump" 2>/dev/null)" != "PGDMP" ]]; then
    record fail "backup.db.valid" "备份的数据库 dump" "mall.dump 头部不是 PGDMP（$(head -c 8 "$dump" 2>/dev/null | tr -d '\0')），不是有效的 pg_dump 产物" \
      "重新备份: bash ${SCRIPT_DIR}/backup.sh"
  else
    record ok "backup.db.valid" "备份的数据库 dump" "非空（$(human_size "$dump_size")）且头部为 PGDMP，MANIFEST: db: ${m_db:-未记录}"
  fi

  # 最近备份的完整性
  if [[ -f "${newest}/SHA256SUMS" ]]; then
    local sum_tool=""
    if command -v sha256sum >/dev/null 2>&1; then
      sum_tool="sha256sum -c"
    elif command -v shasum >/dev/null 2>&1; then
      sum_tool="shasum -a 256 -c"
    fi
    if [[ -z "$sum_tool" ]]; then
      # 没有校验工具 ≠ 校验失败：这是环境问题，报 WARN 而不是误导性的 FAIL
      record warn "backup.integrity" "最近备份完整性" "系统没有 sha256sum / shasum，**无法校验备份完整性**（不等于备份损坏）" \
        "安装: sudo apt-get install -y coreutils；或手工校验: cd ${newest} && sha256sum -c SHA256SUMS"
    else
      local out rc=0
      out="$( (cd "$newest" && $sum_tool SHA256SUMS) 2>&1 )" || rc=$?
      if (( rc == 0 )); then
        record ok "backup.integrity" "最近备份完整性" "SHA256 校验通过"
      else
        record fail "backup.integrity" "最近备份完整性" "校验失败：$(printf '%s' "$out" | tr '\n' ' ' | cut -c1-160)" \
          "重新备份并换用新备份: bash ${SCRIPT_DIR}/backup.sh"
      fi
    fi
  else
    record warn "backup.integrity" "最近备份完整性" "该备份没有 SHA256SUMS（无法验证完整性）" \
      "重新生成带校验和的备份: bash ${SCRIPT_DIR}/backup.sh"
  fi

  # 恢复脚本可用性
  if [[ -f "${SCRIPT_DIR}/restore.sh" ]]; then
    record ok "backup.restore" "恢复脚本" "${SCRIPT_DIR}/restore.sh 存在（演练: bash ${SCRIPT_DIR}/restore.sh --list）"
  else
    record fail "backup.restore" "恢复脚本" "找不到 restore.sh（备份没有闭环，等于没有备份）" \
      "确认文件: ls -l ${SCRIPT_DIR}/restore.sh"
  fi
}

# ---------- 汇总 ----------

print_summary() {
  if (( JSON_MODE )); then
    local status="ok"
    (( CHECKS_FAIL > 0 )) && status="fail"
    if (( CHECKS_FAIL == 0 && CHECKS_WARN > 0 )); then status="warn"; fi
    printf '{\n'
    printf '  "tool": "doctor.sh",\n'
    printf '  "timestamp": "%s",\n' "$(date -Iseconds)"
    printf '  "host": "%s",\n' "$(hostname 2>/dev/null || echo unknown)"
    printf '  "mall_dir": "%s",\n' "$MALL_DIR"
    printf '  "status": "%s",\n' "$status"
    printf '  "summary": {"ok": %d, "warn": %d, "fail": %d, "skip": %d},\n' "$CHECKS_OK" "$CHECKS_WARN" "$CHECKS_FAIL" "$CHECKS_SKIP"
    printf '  "checks": [\n'
    local i
    for i in "${!JSON_ROWS[@]}"; do
      printf '    %s%s\n' "${JSON_ROWS[$i]}" "$( (( i < ${#JSON_ROWS[@]} - 1 )) && printf ',' )"
    done
    printf '  ]\n}\n'
    return
  fi

  echo ""
  echo "================= 诊断汇总 ================="
  printf 'OK=%d  WARN=%d  FAIL=%d  SKIP=%d\n' "$CHECKS_OK" "$CHECKS_WARN" "$CHECKS_FAIL" "$CHECKS_SKIP"
  if [[ -n "${SKIP_REASON:-}" ]]; then
    echo "注意: 因「${SKIP_REASON}」，容器 / 数据库 / Redis / HTTP 层的检查未执行（需在目标机上重跑）"
  fi
  if (( CHECKS_FAIL > 0 )); then
    echo "结论: 存在必须处理的问题（退出码 1）"
    echo ""
    echo "先处理 FAIL 项里的「处置」命令，再重跑: bash ${SCRIPT_DIR}/doctor.sh"
  elif (( CHECKS_WARN > 0 )); then
    echo "结论: 无致命问题，但有告警需要关注（退出码 0）"
  else
    echo "结论: 全部检查通过（退出码 0）"
  fi
  echo "============================================"
}

main() {
  parse_args "$@"
  SKIP_REASON=""

  if ! (( JSON_MODE )); then
    log "开始诊断: MALL_DIR=${MALL_DIR}"
    log "compose 目录: ${COMPOSE_DIR}"
    echo ""
  fi

  check_environment
  check_image_unification
  check_containers
  check_database
  check_redis
  check_config
  check_http
  check_backup

  print_summary
  (( CHECKS_FAIL > 0 )) && exit 1
  exit 0
}

# 直接执行时才跑 main；被 source 时只暴露函数（便于回归套件单独测某一项）
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  main "$@"
fi
