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


# 补齐版本身份与升级代理凭证（幂等：只补缺失的键，不覆盖已有值）。
# 必须在 **容器创建之前** 执行：compose 只在创建容器时读 .env，
# 晚于 step9 写进去的 UPDATER_TOKEN 不会被 API 读到，代理就一直 401。
ensure_updater_env() {
  local env_file="$MALL_DIR/config/.env"
  mkdir -p "$MALL_DIR/config"
  [[ -f "$env_file" ]] || touch "$env_file"

  # 「机器属性」只补不覆盖（换机器不该变的）
  ensure_env_key() {
    local key="$1" value="$2"
    grep -q "^${key}=" "$env_file" 2>/dev/null || printf '%s=%s\n' "$key" "$value" >>"$env_file"
  }
  # 「代码属性」每次安装都要刷新：APP_VERSION 描述的是当前装的这份程序，
  # 只写一次会让升级后后台仍显示旧版本号（真机演练抓到）。
  set_env_key() {
    local key="$1" value="$2"
    if grep -q "^${key}=" "$env_file" 2>/dev/null; then
      sed -i "s|^${key}=.*|${key}=${value}|" "$env_file"
    else
      printf '%s=%s\n' "$key" "$value" >>"$env_file"
    fi
  }

  local version commit built_at
  version="$(head -1 "$COMPOSE_DIR/../VERSION" 2>/dev/null | tr -d '[:space:]')"
  version="${version:-0.0.0}"
  # pack.sh 会在包里留一份提交号；没有 git 目录时靠它
  commit="$( (cd "$COMPOSE_DIR/.." && git rev-parse --short HEAD 2>/dev/null) \
    || head -1 "$COMPOSE_DIR/../.pack-commit" 2>/dev/null || echo unknown)"
  built_at="$(date '+%Y-%m-%dT%H:%M:%S%z')"

  set_env_key APP_VERSION "$version"
  set_env_key APP_COMMIT "$commit"
  # 这份程序装上的时间；每次安装刷新
  set_env_key APP_BUILT_AT "$built_at"
  ensure_env_key SRC_DIR "$(cd "$COMPOSE_DIR/.." && pwd)"
  if ! grep -q "^UPDATER_TOKEN=" "$env_file" 2>/dev/null; then
    ensure_env_key UPDATER_TOKEN "$(openssl rand -hex 24)"
    log "已生成 UPDATER_TOKEN"
  fi
}

# [4] 生成配置与密钥（已存在则跳过，不覆盖）
step4_secrets() {
  local secrets="$MALL_DIR/config/secrets.json"
  # 先把版本身份/代理凭证补进 .env：这一步必须早于容器创建（见 ensure_updater_env 注释）
  ensure_updater_env
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

# 源码指纹：对决定镜像内容的源码做哈希。
#
# 为什么不能用镜像 ID 做指纹：`docker compose build` 每次都产生**新的**镜像 ID
# （Dockerfile 里 `pnpm install --no-frozen-lockfile` 等步骤非确定性，代码完全没变、
# 连续 build 两次 ID 也不同）。用镜像 ID 判断「代码变了没」永远是「变了」。
#
# 所以改成对源码目录算内容哈希：代码没变 → 哈希相同 → 跳过迁移/重建；
# 代码变了 → 哈希不同 → 强制重跑。这是「镜像内容是否更新」的可靠代理。
SRC_FP_FILE="$MALL_DIR/config/.source-fingerprint"

source_fingerprint() {
  local src_dir="$COMPOSE_DIR/.."
  # 排除依赖与构建产物、非源码目录；只对真正进镜像的源文件算哈希。
  # 注意必须与 pack.sh 的排除列表保持同步的「思路」，但这里只做指纹，不必完全一致。
  ( cd "$src_dir" && find . \
      -type f \
      -not -path './node_modules/*' \
      -not -path './.git/*' \
      -not -path './.workbuddy/*' \
      -not -path './apps/*/dist/*' \
      -not -path './apps/*/.next/*' \
      -not -path './packages/*/dist/*' \
      -not -path './.turbo/*' \
      -not -name '*.log' \
      -print0 \
    | sort -z \
    | xargs -0 sha256sum \
    | sha256sum \
    | awk '{print $1}' )
}

# 源码变了 = 当前源码指纹 ≠ 上次成功记录的指纹（首次无记录也视为「变了」）。
source_changed() {
  local cur prev
  cur="$(source_fingerprint)"
  prev="$(cat "$SRC_FP_FILE" 2>/dev/null || echo '')"
  [[ -n "$cur" && "$cur" != "$prev" ]]
}

record_source_fp() {
  mkdir -p "$(dirname "$SRC_FP_FILE")"
  source_fingerprint > "$SRC_FP_FILE"
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
# $1 传 "force" 时用 --force-recreate：镜像变了必须重建容器，
# 否则 up -d 会复用旧容器继续跑旧镜像（重建镜像 ≠ 容器自动换新）。
step9_apps() {
  local recreate=""
  [[ "${1:-}" == "force" ]] && recreate="--force-recreate"
  ( cd "$COMPOSE_DIR" && docker compose --env-file "$MALL_DIR/config/.env" up -d $recreate api worker storefront )
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


# [11] 安装宿主升级代理（ADR-017）。
# 每次安装都刷新：代理脚本被升级本身替换过，必须保证宿主上跑的是最新一份。
# 不走 run_step 门禁——它便宜、幂等，而且漏装会让「一键升级」按钮变成摆设。
step11_updater() {
  ensure_updater_env
  local env_file="$MALL_DIR/config/.env"
  local agent_src="$COMPOSE_DIR/updater/mall-updater.sh"
  local agent_dst="$MALL_DIR/config/mall-updater.sh"
  local unit_dst="/etc/systemd/system/mall-updater.service"

  if [[ ! -f "$agent_src" ]]; then
    log "警告：找不到 $agent_src，跳过升级代理安装"
    return 0
  fi
  # 先写临时文件再 mv：代理可能正在运行，直接 cp 会把读到一半的脚本截断
  cp "$agent_src" "$agent_dst.tmp"
  chmod 0700 "$agent_dst.tmp"
  mv -f "$agent_dst.tmp" "$agent_dst"

  if ! command -v systemctl >/dev/null 2>&1; then
    log "警告：本机没有 systemd，升级代理未托管；可手工执行 bash $agent_dst"
    return 0
  fi

  # systemd 单元要 root。非 root 时提权；提不了就只告警——
  # 应用已经起来了，升级代理是增量能力，绝不因为它装不上就让整个安装失败。
  local unit_tmp run_as
  unit_tmp="$(mktemp /tmp/mall-updater.unit.XXXXXX)"
  cat > "$unit_tmp" <<UNIT
[Unit]
Description=Mall upgrade agent (one-click upgrade executor)
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=simple
ExecStart=/bin/bash $agent_dst
Restart=always
RestartSec=5
Environment=MALL_DIR=$MALL_DIR

[Install]
WantedBy=multi-user.target
UNIT

  run_as=""
  if [[ "$(id -u)" -eq 0 ]]; then
    run_as=""
  elif [[ -w /etc/systemd/system ]]; then
    run_as=""
  elif command -v sudo >/dev/null 2>&1 && sudo -n true >/dev/null 2>&1; then
    run_as="sudo"
  else
    rm -f "$unit_tmp"
    log "警告：没有权限写 /etc/systemd/system，升级代理未托管。"
    log "      手工安装：sudo cp $agent_dst 的单元到 /etc/systemd/system/mall-updater.service 并 enable；"
    log "      或临时运行：bash $agent_dst"
    return 0
  fi

  if ! $run_as mv -f "$unit_tmp" "$unit_dst" \
      || ! $run_as systemctl daemon-reload >/dev/null 2>&1 \
      || ! $run_as systemctl enable mall-updater >/dev/null 2>&1; then
    rm -f "$unit_tmp" 2>/dev/null || true
    log "警告：安装 mall-updater 单元失败，可手工执行 bash $agent_dst"
    return 0
  fi

  # 代理自升级时**不能** restart 自己：作业正跑到一半，杀掉就永远卡在 running。
  # 这种情况下只更新脚本，下次重启/下次普通安装时生效。
  if [[ "${MALL_UPDATER_SELF:-}" == "1" ]]; then
    log "升级代理自升级中，跳过重启（新脚本下次重启生效）"
    return 0
  fi

  # 必须 restart 而不是 enable --now：脚本被换掉后旧进程还在跑旧代码，
  # 不重启就永远用不上新逻辑（心跳那个 bug 就是这么拖了一轮）。
  if $run_as systemctl restart mall-updater >/dev/null 2>&1; then
    log "升级代理已安装并启动（systemd: mall-updater）"
  else
    rm -f "$unit_tmp" 2>/dev/null || true
    log "警告：安装/启动 mall-updater 失败，可手工执行 bash $agent_dst"
  fi
}

main() {
  parse_args "$@"
  if (( RESET )); then
    log "RESET：清空安装状态并备份配置"
    if [[ -f "$STATE_FILE" ]]; then
      cp "$STATE_FILE" "$STATE_FILE.bak.$(date +%s)" 2>/dev/null || true
      rm -f "$STATE_FILE"
    fi
    # 源码指纹一并清掉：否则 reset 后源码没变，source_changed 判 false，
    # 迁移/重建仍会被跳过，reset 语义就失效了。
    rm -f "$SRC_FP_FILE"
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

  # 关键判定：源码变了（换代码重跑）就必须重跑「迁移 + 重建容器 + 健康检查」，
  # 不能走 run_step 的「已完成」门禁 —— 门禁会跳过它们，让容器继续跑旧镜像。
  # 迁移本身幂等（migrator 按版本表跳过已应用项），重建容器也无副作用，重跑安全。
  if source_changed; then
    log "检测到源码更新，重跑迁移与容器重建（跳过 install-state 门禁）"
    step7_migrate
    # 种子靠 seed_versions 表幂等，重跑安全（源码变了可能带新种子数据）
    step8_seed
    step9_apps force
    step10_health
    step11_updater
    record_source_fp
    log "完成（源码已更新并重建）"
    return 0
  fi

  run_step 7 step7_migrate "执行迁移"
  run_step 8 step8_seed "首次种子"
  run_step 9 step9_apps "拉起应用"
  run_step 10 step10_health "健康检查"
  step11_updater
  log "完成（11 步全绿）"
}

main "$@"
