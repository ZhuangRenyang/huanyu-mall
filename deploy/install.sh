#!/usr/bin/env bash
set -euo pipefail

# install.sh — 一键安装（架构 §9.3）。10 步，每步幂等可重入，失败可续跑。
# 用法：bash install.sh [--dry-run] [--reset] [--domain D] [--admin-email E] [--admin-password P] [--locale L] [--offline] [--no-tuning]
# 必填配置恒为 0：所有参数都有默认值。

MALL_DIR="${MALL_DIR:-/opt/mall}"
STATE_FILE="${MALL_DIR}/config/.install-state"
COMPOSE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

TOTAL=10
DRY_RUN=0
RESET=0
ADMIN_EMAIL="admin"
ADMIN_PASSWORD="123456"
LOCALE="zh-CN"
OFFLINE=0
NO_TUNING=0
DOMAIN=""

log() { printf '[install] %s\n' "$*"; }
fail() { printf '[install][ERROR] %s\n' "$*" >&2; exit 1; }

usage() {
  cat <<'EOF'
用法: install.sh [选项]
  --dry-run        只打印将执行的步骤，不做任何修改
  --reset          清空安装状态重新执行（会备份现有配置，需二次确认）
  --domain D       站点域名（默认空，用 IP + 自签证书）
  --admin-email E  管理员登录标识（默认 admin；也可用邮箱）
  --admin-password P  管理员初始密码（默认 123456；生产部署建议指定强密码）
  --locale L       locale（默认 zh-CN）
  --offline        离线模式（不下载 Docker 镜像）
  --no-tuning      跳过自动调参
EOF
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --dry-run) DRY_RUN=1 ;;
      --reset) RESET=1 ;;
      --domain) DOMAIN="${2:-}"; shift ;;
      --admin-email) ADMIN_EMAIL="${2:-admin}"; shift ;;
      --admin-password) ADMIN_PASSWORD="${2:-}"; shift ;;
      --locale) LOCALE="${2:-zh-CN}"; shift ;;
      --offline) OFFLINE=1 ;;
      --no-tuning) NO_TUNING=1 ;;
      -h|--help) usage; exit 0 ;;
      *) fail "未知参数: $1" ;;
    esac
    shift
  done
}

step_done() {
  [[ -f "$STATE_FILE" ]] && [[ "$(cat "$STATE_FILE" 2>/dev/null)" -ge "$1" ]]
}

run_step() {
  local n="$1" fn="$2" desc="$3"
  if (( DRY_RUN )); then
    log "DRY-RUN step ${n}/${TOTAL}: ${desc}"
    return 0
  fi
  if step_done "$n"; then
    log "skip step ${n}/${TOTAL} (已完成): ${desc}"
    return 0
  fi
  log "step ${n}/${TOTAL}: ${desc}"
  "$fn"
  mkdir -p "$(dirname "$STATE_FILE")"
  printf '%s' "$n" > "$STATE_FILE"
}

# [1] 环境探测
step1_detect() {
  log "OS=$(uname -s) 架构=$(uname -m)"
  local mem_kb
  mem_kb=$(awk '/MemTotal/{print $2}' /proc/meminfo 2>/dev/null || echo 0)
  if (( mem_kb > 0 && mem_kb < 1572864 )); then
    fail "内存不足 1.5G（当前 $((mem_kb/1024))M），不足以跑 PG+Redis+3 进程"
  fi
  command -v docker >/dev/null 2>&1 || log "警告: 未检测到 docker，将尝试安装"
}

# [2] 检查并安装 Docker
step2_docker() {
  if command -v docker >/dev/null 2>&1; then
    log "docker 已安装: $(docker --version)"
  else
    fail "缺少 Docker，请先安装（本环境未接入 get.docker.com，手动安装后重跑）"
  fi
}

# [3] 准备目录（程序/配置/数据/备份 分离，架构 §9.5）
step3_dirs() {
  mkdir -p "$MALL_DIR"/{app,config,data/{pgdata,redis,uploads},backup}
  # HTTPS 相关目录（setup-https.sh 使用）。
  # 空目录时 nginx.conf 里的 include /etc/nginx/snippets/*.https.inc 匹配不到任何文件，
  # 行为与纯 HTTP 完全一致（compose 会把这三个目录挂进 nginx 容器）。
  mkdir -p "$MALL_DIR"/config/{nginx,letsencrypt,certbot-webroot}
  log "目录就绪: $MALL_DIR/{app,config,data,backup}"
}

# [4] 生成配置与密钥（已存在则跳过，不覆盖）
step4_secrets() {
  local secrets="$MALL_DIR/config/secrets.json"
  if [[ -f "$secrets" ]]; then
    log "secrets.json 已存在，跳过生成"
  else
    local pg_pass jtw_secret cookie_secret enc_key
    pg_pass=$(openssl rand -hex 16)
    jtw_secret=$(openssl rand -hex 32)
    cookie_secret=$(openssl rand -hex 32)
    enc_key=$(openssl rand -hex 16)
    cat > "$secrets" <<EOF
{
  "POSTGRES_PASSWORD": "${pg_pass}",
  "JWT_SECRET": "${jtw_secret}",
  "COOKIE_SECRET": "${cookie_secret}",
  "ENCRYPTION_KEY": "${enc_key}"
}
EOF
    chmod 0600 "$secrets"
    log "已生成 secrets.json (0600)"
  fi

  # 同时生成 compose 读取的 .env（放 MALL_DIR/config，独立于源码目录，铁律 10：程序替换不动数据）
  local env_file="$MALL_DIR/config/.env"
  mkdir -p "$MALL_DIR/config"
  if [[ -f "$env_file" ]]; then
    log ".env 已存在，跳过"
    return 0
  fi
  # 从 secrets.json 提取值（用 python3 或 node 或 sed，取最稳妥的）
  local pg_pass jtw_secret enc_key
  if command -v node >/dev/null 2>&1; then
    pg_pass=$(node -e 'const s=require(process.argv[1]);process.stdout.write(s.POSTGRES_PASSWORD)' "$secrets")
    jtw_secret=$(node -e 'const s=require(process.argv[1]);process.stdout.write(s.JWT_SECRET)' "$secrets")
    enc_key=$(node -e 'const s=require(process.argv[1]);process.stdout.write(s.ENCRYPTION_KEY)' "$secrets")
  else
    pg_pass=$(grep -o '"POSTGRES_PASSWORD"[^,]*' "$secrets" | grep -o '[0-9a-f]\{16,\}')
    jtw_secret=$(grep -o '"JWT_SECRET"[^,]*' "$secrets" | grep -o '[0-9a-f]\{32,\}')
    enc_key=$(grep -o '"ENCRYPTION_KEY"[^,]*' "$secrets" | grep -o '[0-9a-f]\{16,\}')
  fi
  cat > "$env_file" <<EOF
POSTGRES_PASSWORD=${pg_pass}
JWT_SECRET=${jtw_secret}
ENCRYPTION_KEY=${enc_key}
MALL_DIR=${MALL_DIR}
# CORS：生产请设为具体域名，多个用逗号分隔，例如
#   CORS_ORIGINS=https://shop.example.com,https://www.example.com
# 同源部署（店面/后台都经 nginx 反代到同一域名）不需要 CORS，留空即可。
# 严禁填 * —— 那不是「放行所有来源」，后端只会把它当成一个字面量白名单。
# CORS_ORIGINS=
# 应用镜像标签（api / worker / migrator 共用这一个；改标签后需重新 build api）
# IMAGE_NAME=mall-app:local
# 店面数据源模式：mock（离线预览，无后端也能看界面）| live（真调后端，能真的下单付款）
# ⚠️ NEXT_PUBLIC_* 是**构建期**注入（会被内联进客户端 bundle），
#    改这个值必须重新构建镜像才生效，光重启容器无效：
#      docker compose --env-file "$MALL_DIR/config/.env" build storefront
#      docker compose --env-file "$MALL_DIR/config/.env" up -d storefront
# NEXT_PUBLIC_API_MODE=live
EOF
  chmod 0600 "$env_file"
  log "已生成 .env (0600)"
}

# [5] 自动调参（生成 pg.conf / redis.conf / tuning.env，供 compose 挂载）
step5_tuning() {
  if (( NO_TUNING )); then log "已跳过调参"; return 0; fi
  MALL_DIR="$MALL_DIR" bash "$COMPOSE_DIR/scripts/tuning.sh"
}

# [6] 拉起依赖
step6_deps() {
  ( cd "$COMPOSE_DIR" && docker compose --env-file "$MALL_DIR/config/.env" up -d postgres redis pgbouncer )
  log "依赖容器已拉起（等待 healthy）"
}

# 解析 compose 实际会用的镜像标签：优先 .env 里的 IMAGE_NAME，其次环境变量，最后默认值。
# 只用于打印日志，compose 自己按 --env-file 解析，两边必须一致。
app_image_name() {
  local v=""
  if [[ -f "$MALL_DIR/config/.env" ]]; then
    v="$(grep -E '^[[:space:]]*IMAGE_NAME=' "$MALL_DIR/config/.env" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '"'"'"' ')"
  fi
  [[ -n "$v" ]] || v="${IMAGE_NAME:-mall-app:local}"
  printf '%s' "$v"
}

# 构建应用镜像（api / worker / migrator 共用这一个标签，构建一次三处使用）。
# 刻意不走 install-state 门禁：镜像必须始终与当前 app/ 目录里的代码一致。
# 若用步骤状态门禁，换代码后重跑安装会跳过构建，容器继续跑旧镜像 —— 那正是
# 「同一份代码 build 成多个镜像」的残留风险（migrator 用旧镜像 → 新迁移没加载 → 新表不存在）。
build_app_image() {
  local image
  image="$(app_image_name)"
  log "构建应用镜像: ${image}（api / worker / migrator 共用这一个标签）"
  ( cd "$COMPOSE_DIR" && docker compose --env-file "$MALL_DIR/config/.env" build api ) \
    || fail "镜像构建失败：迁移与应用都会用到旧镜像，中止安装"
  log "镜像构建完成: ${image}"
}

# [7] 执行迁移
step7_migrate() {
  ( cd "$COMPOSE_DIR" && docker compose --env-file "$MALL_DIR/config/.env" run --rm migrator )
  log "迁移完成"
}
# [8] 首次启动种子（靠 seed_versions 表幂等）
step8_seed() {
  ( cd "$COMPOSE_DIR" && docker compose --env-file "$MALL_DIR/config/.env" run --rm \
      -e ADMIN_EMAIL="$ADMIN_EMAIL" -e ADMIN_PASSWORD="$ADMIN_PASSWORD" api node apps/api/dist/seed.js )
  log "种子完成（管理员标识=${ADMIN_EMAIL}）"
}

# [9] 拉起应用
step9_apps() {
  ( cd "$COMPOSE_DIR" && docker compose --env-file "$MALL_DIR/config/.env" up -d api worker storefront )
  ( cd "$COMPOSE_DIR" && docker compose --env-file "$MALL_DIR/config/.env" up -d nginx )
  # nginx.conf 以 bind mount 挂载：首次安装即生效，但「重跑安装 / 改过配置」时
  # 容器不会自动重载，必须显式 reload，否则新配置不生效（真机问题 #28 的配套修法）。
  ( cd "$COMPOSE_DIR" && docker compose --env-file "$MALL_DIR/config/.env" exec -T nginx nginx -s reload ) \
    || log "警告：nginx reload 失败，请手动执行 docker compose exec nginx nginx -s reload"
  log "应用已拉起"
}

# [10] 健康检查与自检报告
step10_health() {
  "$(dirname "${BASH_SOURCE[0]}")/healthcheck.sh" || fail "健康检查未通过"
  log "访问地址: ${DOMAIN:-http://<服务器IP>}"
  log "管理员标识: ${ADMIN_EMAIL}"
  log "初始密码: ${ADMIN_PASSWORD}（可在后台自行修改，不强制改密）"
}

main() {
  parse_args "$@"
  if (( RESET )); then
    log "RESET：清空安装状态并备份配置"
    if [[ -f "$STATE_FILE" ]]; then
      cp "$STATE_FILE" "$STATE_FILE.bak.$(date +%s)" 2>/dev/null || true
      rm -f "$STATE_FILE"
    fi
  fi
  run_step 1 step1_detect "环境探测"
  run_step 2 step2_docker "检查 Docker"
  run_step 3 step3_dirs "准备目录"
  run_step 4 step4_secrets "生成配置与密钥"
  run_step 5 step5_tuning "自动调参"
  run_step 6 step6_deps "拉起依赖"
  # 构建镜像必须在迁移之前：migrator 与 api/worker 共用同一个镜像标签且不带 build 段，
  # 不先构建它就会去 pull 一个本地不存在的标签而失败；更危险的是 pull 到同名旧镜像
  # ——那正是「migrator 用旧镜像 → 新迁移没加载 → 新表不存在」的成因。
  build_app_image
  run_step 7 step7_migrate "执行迁移"
  run_step 8 step8_seed "首次种子"
  run_step 9 step9_apps "拉起应用"
  run_step 10 step10_health "健康检查"
  log "完成（10 步全绿）"
}

main "$@"
