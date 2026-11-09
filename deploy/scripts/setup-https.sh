#!/usr/bin/env bash
set -uo pipefail

# setup-https.sh — 为商城站点启用 Let's Encrypt HTTPS（签发 + 自动续期 + 可回滚）。
#
# 设计约束：
#   - 一期默认 HTTP 场景行为完全不变：未启用 HTTPS 时，nginx.conf 里多出来的
#     include 匹配不到任何文件，nginx 启动与请求路径与改造前一致
#   - 不回归真机问题 #28 的两个修复：动态 DNS 解析（resolver 127.0.0.11 + 变量 proxy_pass）
#     与 /admin/ 前缀剥离（rewrite）——443 块的上游与 location 由 nginx.conf 原样抽取，
#     不做二次手写，避免两处漂移
#   - HSTS 只在 443 块下发，HTTP 响应绝不携带
#   - 80 → 443 跳转做成开关（--force-https），默认不跳转，避免打断现有 HTTP 访问
#   - 签发失败 / 配置校验失败必须能干净回滚，且不影响现有 HTTP 服务
#
# 用法:
#   bash deploy/scripts/setup-https.sh --domain shop.example.com --email ops@example.com
#   bash deploy/scripts/setup-https.sh --domain shop.example.com --email ops@example.com --dry-run
#   bash deploy/scripts/setup-https.sh --domain shop.example.com --email ops@example.com --force-https
#   bash deploy/scripts/setup-https.sh --renew
#   bash deploy/scripts/setup-https.sh --disable
#
# 退出码: 0=成功 1=失败 2=用户取消 3=参数/环境错误

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
MALL_DIR="${MALL_DIR:-/opt/mall}"
ENV_FILE="${MALL_DIR}/config/.env"

NGINX_CONF="${COMPOSE_DIR}/docker/nginx.conf"
SNIPPET_DIR="${MALL_DIR}/config/nginx"
SNIPPET="${SNIPPET_DIR}/https.inc"
LE_DIR="${MALL_DIR}/config/letsencrypt"
WEBROOT="${MALL_DIR}/config/certbot-webroot"
CERTBOT_IMAGE="certbot/certbot:latest"
RENEW_MARK="# mall-https-renew (managed by setup-https.sh)"
RENEW_LOG="/var/log/mall-https-renew.log"

DOMAINS=""
PRIMARY_DOMAIN=""
EMAIL=""
FORCE_HTTPS=0
STAGING=0
DRY_RUN=0
ASSUME_YES=0
SKIP_DNS=0
INSTALL_CRON=0
MODE="issue"

log()  { printf '[setup-https] %s\n' "$*"; }
warn() { printf '[setup-https][WARN] %s\n' "$*"; }
err()  { printf '[setup-https][ERROR] %s\n' "$*" >&2; }
die()  { local code="${2:-1}"; err "$1"; exit "$code"; }

usage() {
  cat <<'EOF'
用法: setup-https.sh [选项]
  --domain D        要签发的域名（可重复，多个域名写进同一张证书）
  --email E         Let's Encrypt 注册邮箱（强烈建议填，用于到期/吊销通知）
  --force-https     启用 80 → 443 强制跳转（默认不跳转，保持现有 HTTP 访问）
  --staging         用 Let's Encrypt 演练环境测试签发流程（不产出正式证书）
  --install-cron    安装自动续期定时任务（每天 03:00）
  --skip-dns-check  跳过域名解析校验（域名尚未生效时用）
  --renew           只执行续期（不重新签发）
  --disable         关闭 HTTPS（删除 https.inc 并 reload，回到纯 HTTP）
  --rollback        回滚到上一份可用的 HTTPS 片段（备份 https.inc.bak）并 reload
  --dry-run         只打印将要执行的动作，不改动任何东西
  --yes             跳过交互确认
  -h, --help        显示帮助

退出码: 0=成功 1=失败 2=用户取消 3=参数/环境错误
EOF
}

compose() {
  ( cd "$COMPOSE_DIR" && docker compose --env-file "$ENV_FILE" "$@" )
}

# ---------- 参数 ----------

validate_domain() {
  local d="$1"
  [[ -n "$d" ]] || return 1
  # 只接受域名，不接受 IP / 端口 / 路径
  [[ "$d" =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,}$ ]] || return 1
  # 标签长度限制
  local label
  while IFS= read -r label; do
    (( ${#label} <= 63 )) || return 1
  done < <(printf '%s' "$d" | tr '.' '\n')
  return 0
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --domain) DOMAINS="${DOMAINS} ${2:-}"; shift ;;
      --email)  EMAIL="${2:-}"; shift ;;
      --force-https) FORCE_HTTPS=1 ;;
      --staging) STAGING=1 ;;
      --install-cron) INSTALL_CRON=1 ;;
      --skip-dns-check) SKIP_DNS=1 ;;
      --renew)  MODE="renew" ;;
      --disable) MODE="disable" ;;
      --rollback) MODE="rollback" ;;
      --dry-run) DRY_RUN=1 ;;
      --yes|-y) ASSUME_YES=1 ;;
      -h|--help) usage; exit 0 ;;
      *) err "未知参数: $1"; usage; exit 3 ;;
    esac
    shift
  done
  # 归一化：转小写、压缩多余空白、去首尾空格
  DOMAINS="$(printf '%s' "$DOMAINS" | tr 'A-Z' 'a-z' | tr -s '[:space:]' ' ' | sed 's/^ //; s/ $//')"
  PRIMARY_DOMAIN="${DOMAINS%% *}"
}

confirm() {
  local prompt="$1" ans=""
  if (( ASSUME_YES )); then
    log "已通过 --yes 跳过确认"
    return 0
  fi
  if (( DRY_RUN )); then
    log "dry-run 模式：只打印计划，未做任何改动"
    return 0
  fi
  if ! { printf '%s' "$prompt" >/dev/tty 2>/dev/null && read -r ans </dev/tty 2>/dev/null; }; then
    if ! { printf '%s' "$prompt" && read -r ans; }; then
      err "无法读取交互确认（非交互环境）"
      die "请显式加 --yes 确认执行" 3
    fi
  fi
  if [[ "$ans" != "yes" ]]; then
    log "已取消（未做任何修改）"
    exit 2
  fi
}

# ---------- 前置检查 ----------

check_prereq() {
  [[ -f "$NGINX_CONF" ]] || die "找不到 nginx 配置: ${NGINX_CONF}" 3

  # 域名校验（纯输入检查，不需要 Docker）
  local d
  for d in $DOMAINS; do
    validate_domain "$d" || die "域名不合法: ${d}（要求形如 shop.example.com，不接受 IP / 端口 / 路径）" 3
  done

  # nginx.conf 必须含动态解析与 /admin/ 剥离（真机问题 #28 的修复不能丢）
  if ! grep -q 'resolver 127.0.0.11' "$NGINX_CONF"; then
    die "nginx.conf 里没有动态 DNS 解析（resolver 127.0.0.11），拒绝生成 HTTPS 配置（否则会退回静态 upstream，容器换 IP 即全站 502）" 1
  fi
  if ! grep -q 'rewrite \^/admin/' "$NGINX_CONF"; then
    die "nginx.conf 里没有 /admin/ 前缀剥离（rewrite），拒绝生成 HTTPS 配置" 1
  fi

  # 环境检查
  if ! command -v docker >/dev/null 2>&1; then
    if (( DRY_RUN )); then
      warn "本机没有 Docker，dry-run 只能给出计划"
    else
      die "未检测到 Docker。处置: 安装 Docker 后重跑" 1
    fi
  fi
  if [[ ! -f "$ENV_FILE" ]]; then
    if (( DRY_RUN )); then
      warn "缺少 ${ENV_FILE}，dry-run 继续"
    else
      die "缺少 ${ENV_FILE}，无法定位 compose 环境" 1
    fi
  fi
}

check_dns() {
  [[ -n "$PRIMARY_DOMAIN" ]] || return 0
  (( SKIP_DNS )) && { warn "按 --skip-dns-check 跳过域名解析校验"; return 0; }
  local resolved
  resolved="$(getent hosts "$PRIMARY_DOMAIN" 2>/dev/null | awk '{print $1}' | head -1)"
  if [[ -z "$resolved" ]]; then
    warn "域名 ${PRIMARY_DOMAIN} 当前解析不出 IP（DNS 可能还没生效）"
    warn "处置: 确认域名的 A 记录已指向本机后重跑；确实要继续请加 --skip-dns-check"
    return 0
  fi
  local pub
  pub="$(curl -fsS --max-time 6 https://api.ipify.org 2>/dev/null || true)"
  if [[ -z "$pub" ]]; then
    warn "拿不到本机公网 IP，跳过解析比对（${PRIMARY_DOMAIN} → ${resolved}）"
    return 0
  fi
  if [[ "$resolved" != "$pub" ]]; then
    warn "域名 ${PRIMARY_DOMAIN} 解析到 ${resolved}，本机公网 IP 是 ${pub}（二者不同：可能是 NAT / CDN / 多机部署）"
    warn "处置: 确认流量确实会到达本机，否则签发会因 HTTP-01 校验失败"
    return 0
  fi
  log "域名解析正常: ${PRIMARY_DOMAIN} → ${resolved}"
}

ensure_dirs() {
  if (( DRY_RUN )); then
    echo "    [dry-run] mkdir -p ${SNIPPET_DIR} ${LE_DIR} ${WEBROOT}"
    return 0
  fi
  mkdir -p "$SNIPPET_DIR" "$LE_DIR" "$WEBROOT"
  chmod 755 "$SNIPPET_DIR" "$LE_DIR" "$WEBROOT"
}

# 确保 nginx 容器挂载了 HTTPS 相关目录（老容器是用旧 compose 建的，需要重建）
ensure_nginx_mounts() {
  if compose exec -T nginx test -d /etc/nginx/snippets >/dev/null 2>&1; then
    return 0
  fi
  log "nginx 容器缺少 /etc/nginx/snippets 挂载，重建容器以应用新的 compose 配置（会有几秒 HTTP 中断）…"
  if (( DRY_RUN )); then
    echo "    [dry-run] docker compose up -d nginx"
    return 0
  fi
  compose up -d nginx >/dev/null 2>&1 || warn "重建 nginx 容器失败，稍后重试"
  if compose exec -T nginx test -d /etc/nginx/snippets >/dev/null 2>&1; then
    return 0
  fi
  die "重建后仍没有 /etc/nginx/snippets 挂载：目标机上的 deploy/docker-compose.yml 版本过旧。请先部署新版程序代码，再重跑本脚本" 1
}

# ---------- 证书 ----------

certbot_issue() {
  local args=(--webroot -w /var/www/certbot)
  local d
  for d in $DOMAINS; do
    args+=(-d "$d")
  done
  args+=(--cert-name "$PRIMARY_DOMAIN")
  if [[ -n "$EMAIL" ]]; then
    args+=(--email "$EMAIL" --agree-tos)
  else
    args+=(--register-unsafely-without-email --agree-tos)
  fi
  args+=(--no-eff-email)
  (( STAGING )) && args+=(--dry-run)

  log "运行 certbot 签发: certonly ${args[*]}"
  if (( DRY_RUN )); then
    echo "    [dry-run] docker run --rm -v ${LE_DIR}:/etc/letsencrypt -v ${WEBROOT}:/var/www/certbot ${CERTBOT_IMAGE} certonly ${args[*]}"
    return 0
  fi
  docker run --rm \
    -v "${LE_DIR}:/etc/letsencrypt" \
    -v "${WEBROOT}:/var/www/certbot" \
    "$CERTBOT_IMAGE" certonly "${args[@]}" \
    || die "certbot 签发失败（HTTP-01 校验没通过）。常见原因: 80 端口未对本机开放、DNS 未生效、反向代理拦截了 /.well-known/acme-challenge/。现有 HTTP 服务未受影响" 1
}

certbot_renew() {
  log "运行 certbot renew"
  if (( DRY_RUN )); then
    echo "    [dry-run] docker run --rm -v ${LE_DIR}:/etc/letsencrypt -v ${WEBROOT}:/var/www/certbot ${CERTBOT_IMAGE} renew --webroot -w /var/www/certbot --quiet"
    return 0
  fi
  docker run --rm \
    -v "${LE_DIR}:/etc/letsencrypt" \
    -v "${WEBROOT}:/var/www/certbot" \
    "$CERTBOT_IMAGE" renew --webroot -w /var/www/certbot --quiet \
    --deploy-hook "cd ${COMPOSE_DIR} && docker compose --env-file ${ENV_FILE} exec -T nginx nginx -s reload" \
    || warn "certbot renew 返回非零（若证书尚未到期可忽略）"
}

# ---------- nginx 配置生成 ----------

# 从 nginx.conf 原样抽取 server 块内部（保证 443 与 80 的上游/location 完全一致）
extract_server_body() {
  sed -n '/^server[[:space:]]*{/,/^}/p' "$1" \
    | sed '1d;$d' \
    | grep -v -E '^[[:space:]]*listen[[:space:]]+80[[:space:]]*;' \
    | grep -v -E '^[[:space:]]*server_name[[:space:]]+_[[:space:]]*;'
}

build_snippet() {
  local body="$1"
  local domain_list="$DOMAINS"

  cat <<EOF
# 由 setup-https.sh 生成，请勿手工编辑（改完会被下次签发覆盖）。
# 站点: ${domain_list}
# 生成时间: $(date -Iseconds)
#
# 本文件里的上游解析（resolver 127.0.0.11 + 变量 proxy_pass）与 /admin/ 前缀剥离
# 是从 deploy/docker/nginx.conf 原样抽取的，与 80 端口的 server 块保持一致，
# 避免 HTTPS / HTTP 两套配置漂移（真机问题 #28 的修复不能只在一边生效）。

server {
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name ${domain_list};

    ssl_certificate     /etc/letsencrypt/live/${PRIMARY_DOMAIN}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${PRIMARY_DOMAIN}/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers off;
    ssl_session_cache shared:MALL_SSL:10m;
    ssl_session_timeout 1d;
    ssl_session_tickets off;

    # HSTS 只在 HTTPS 生效时下发；HTTP 响应不经过本块，绝不携带该头。
    # proxy_hide_header 保证即使后端也下发了 HSTS，响应里也只有一个。
    proxy_hide_header Strict-Transport-Security;
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

$(printf '%s\n' "$body")
}
EOF

  if (( FORCE_HTTPS )); then
    cat <<EOF

# 80 → 443 强制跳转（--force-https 开启）。
# 只对上面列出的域名生效；其它 Host（例如用 IP 直连）仍由 nginx.conf 的默认 server 处理。
server {
    listen 80;
    server_name ${domain_list};

    # ACME 校验目录不能被跳转打断，否则证书无法续期
    location /.well-known/acme-challenge/ { root /var/www/certbot; }

    location / { return 301 https://\$host\$request_uri; }
}
EOF
  fi
}

apply_snippet() {
  local body snippet
  body="$(extract_server_body "$NGINX_CONF")"
  if [[ -z "$body" ]]; then
    die "从 ${NGINX_CONF} 抽取 server 块内容失败，拒绝生成 HTTPS 配置" 1
  fi
  # 自检：抽取出来的内容必须仍然带动态解析与 /admin/ 剥离
  if ! printf '%s' "$body" | grep -q 'resolver 127.0.0.11'; then
    die "抽取出的 server 块缺少动态 DNS 解析，拒绝生成 HTTPS 配置" 1
  fi
  if ! printf '%s' "$body" | grep -q 'rewrite \^/admin/'; then
    die "抽取出的 server 块缺少 /admin/ 前缀剥离，拒绝生成 HTTPS 配置" 1
  fi

  snippet="$(build_snippet "$body")"

  if (( DRY_RUN )); then
    echo "---------------- 将写入 ${SNIPPET} ----------------"
    printf '%s\n' "$snippet"
    echo "----------------------------------------------------"
    return 0
  fi

  # 备份旧片段，便于回滚。
  # 用**固定名** https.inc.bak（不是带时间戳的），这样重复执行不会堆积备份文件，
  # 且回滚目标永远是「上一次已知可用」的那份 —— 脚本可安全重复执行。
  if [[ -f "$SNIPPET" ]]; then
    cp "$SNIPPET" "${SNIPPET}.bak" || warn "备份旧片段失败：${SNIPPET}.bak"
  else
    # 之前没有片段（首次启用），记录一个空标记，回滚时据此「删除片段回到纯 HTTP」
    : > "${SNIPPET}.bak.empty"
    rm -f "${SNIPPET}.bak"
  fi
  # 快照：生成这份片段时所用的 nginx.conf（脚本本身不改 nginx.conf，只读它做抽取），
  # 留档便于日后排查「片段与 nginx.conf 是否已漂移」。
  cp "$NGINX_CONF" "${SNIPPET_DIR}/nginx.conf.snapshot" 2>/dev/null || true
  printf '%s\n' "$snippet" >"$SNIPPET" || die "写入 ${SNIPPET} 失败" 1
  log "已写入 ${SNIPPET}（上一份已备份到 ${SNIPPET}.bak）"
}

# 回滚：把片段恢复到上一次已知可用的状态并 reload。
# 供两处使用：①nginx -t 失败时的自动回滚；②--rollback 显式回滚。
restore_snippet_backup() {
  if [[ -f "${SNIPPET}.bak" ]]; then
    cp "${SNIPPET}.bak" "$SNIPPET" || true
    log "已恢复上一份片段: ${SNIPPET}.bak"
  elif [[ -f "${SNIPPET}.bak.empty" ]]; then
    # 首次启用前没有片段 → 回滚就是删掉它，回到纯 HTTP
    rm -f "$SNIPPET"
    log "已移除片段，回到纯 HTTP（启用前就是纯 HTTP）"
  else
    rm -f "$SNIPPET"
    log "没有可用备份，已移除片段，回到纯 HTTP"
  fi
  compose exec -T nginx nginx -s reload >/dev/null 2>&1 \
    || warn "回滚后的 reload 失败，请手工执行: cd ${COMPOSE_DIR} && docker compose --env-file ${ENV_FILE} exec -T nginx nginx -s reload"
}

# 配置校验 + reload；失败则回滚，保证 HTTP 服务不受影响
reload_nginx() {
  if (( DRY_RUN )); then
    echo "    [dry-run] docker compose exec -T nginx nginx -t"
    echo "    [dry-run] docker compose exec -T nginx nginx -s reload"
    return 0
  fi
  local testout
  testout="$(mktemp)"
  if ! compose exec -T nginx nginx -t >"$testout" 2>&1; then
    err "nginx 配置校验失败，回滚中（HTTP 服务保持原状）:"
    sed 's/^/    /' "$testout" >&2
    rm -f "$testout" 2>/dev/null || true
    # 回滚：恢复旧片段；没有旧片段就删掉新写的
    restore_snippet_backup
    die "HTTPS 未启用（已回滚，HTTP 访问不受影响）" 1
  fi
  rm -f "$testout" 2>/dev/null || true
  log "nginx 配置校验通过"
  compose exec -T nginx nginx -s reload || die "nginx reload 失败，请手工执行: cd ${COMPOSE_DIR} && docker compose --env-file ${ENV_FILE} exec -T nginx nginx -s reload" 1
  log "nginx 已 reload，HTTPS 生效"
}

install_cron() {
  if (( DRY_RUN )); then
    echo "    [dry-run] 写入 root crontab: 0 3 * * * certbot renew + nginx reload"
    return 0
  fi
  if ! command -v crontab >/dev/null 2>&1; then
    warn "没有 crontab 命令，跳过自动续期安装。处置: 手工配置定时任务: 0 3 * * * docker run --rm -v ${LE_DIR}:/etc/letsencrypt -v ${WEBROOT}:/var/www/certbot ${CERTBOT_IMAGE} renew --webroot -w /var/www/certbot --quiet"
    return 0
  fi
  local entry="0 3 * * * cd ${COMPOSE_DIR} && docker run --rm -v ${LE_DIR}:/etc/letsencrypt -v ${WEBROOT}:/var/www/certbot ${CERTBOT_IMAGE} renew --webroot -w /var/www/certbot --quiet --deploy-hook 'cd ${COMPOSE_DIR} && docker compose --env-file ${ENV_FILE} exec -T nginx nginx -s reload' >> ${RENEW_LOG} 2>&1 ${RENEW_MARK}"
  ( crontab -l 2>/dev/null | grep -vF "$RENEW_MARK" || true; printf '%s\n' "$entry" ) | crontab - \
    && log "已安装自动续期定时任务（每天 03:00，日志: ${RENEW_LOG}）" \
    || warn "写入 crontab 失败，请手工配置"
}

disable_https() {
  log "关闭 HTTPS"
  if (( DRY_RUN )); then
    echo "    [dry-run] 删除 ${SNIPPET} 并 reload nginx"
    return 0
  fi
  if [[ -f "$SNIPPET" ]]; then
    cp "$SNIPPET" "${SNIPPET}.bak" || true
    rm -f "$SNIPPET" || true
    log "已移除 ${SNIPPET}（旧片段备份在 ${SNIPPET}.bak）"
  else
    log "本来就没有 HTTPS 片段"
  fi
  compose exec -T nginx nginx -t >/dev/null 2>&1 || warn "nginx 配置校验失败，请手工检查"
  compose exec -T nginx nginx -s reload || warn "reload 失败，请手工执行: cd ${COMPOSE_DIR} && docker compose --env-file ${ENV_FILE} exec -T nginx nginx -s reload"
  log "已回到纯 HTTP"
}

# 显式回滚：把片段恢复到上一次已知可用的状态（与 nginx -t 失败时的自动回滚同一套逻辑）
rollback_https() {
  log "回滚 HTTPS 配置到上一份可用状态"
  if (( DRY_RUN )); then
    echo "    [dry-run] 从 ${SNIPPET}.bak 恢复 ${SNIPPET} 并 reload nginx"
    return 0
  fi
  if [[ ! -f "${SNIPPET}.bak" && ! -f "${SNIPPET}.bak.empty" ]]; then
    die "没有可回滚的备份（${SNIPPET}.bak 不存在）。当前片段保持不变" 1
  fi
  restore_snippet_backup
  if compose exec -T nginx nginx -t >/dev/null 2>&1; then
    log "回滚后 nginx 配置校验通过，HTTP 服务正常"
  else
    warn "回滚后 nginx 配置校验仍失败，请手工检查: cd ${COMPOSE_DIR} && docker compose --env-file ${ENV_FILE} exec -T nginx nginx -t"
  fi
}

# ---------- 主流程 ----------

print_plan() {
  echo ""
  echo "================ HTTPS 启用计划 ================"
  echo "域名:        ${DOMAINS}"
  echo "主域名:      ${PRIMARY_DOMAIN}"
  echo "证书路径:    /etc/letsencrypt/live/${PRIMARY_DOMAIN}/"
  echo "nginx 片段:  ${SNIPPET}"
  echo "80 → 443:    $( (( FORCE_HTTPS )) && echo '开启（--force-https）' || echo '不开启（保持现有 HTTP 访问）' )"
  echo "HSTS:        仅在 443 响应下发，HTTP 响应不携带"
  echo "自动续期:    $( (( INSTALL_CRON )) && echo '安装（每天 03:00）' || echo '未安装（可加 --install-cron）' )"
  echo ""
  echo "将执行的变更:"
  echo "  1) 创建目录 ${SNIPPET_DIR} / ${LE_DIR} / ${WEBROOT}"
  echo "  2) 必要时重建 nginx 容器（应用新的挂载）"
  echo "  3) certbot 签发/续期证书"
  echo "  4) 写入 https.inc（上游与 location 从 nginx.conf 原样抽取）"
  echo "  5) nginx -t 校验 → 通过才 reload；不通过则自动回滚，HTTP 不受影响"
  echo "=============================================="
  echo ""
}

main() {
  parse_args "$@"

  case "$MODE" in
    renew)
      check_prereq
      ensure_dirs
      certbot_renew
      log "续期流程完成"
      exit 0
      ;;
    disable)
      check_prereq
      disable_https
      exit 0
      ;;
    rollback)
      check_prereq
      rollback_https
      exit 0
      ;;
  esac

  if [[ -z "$DOMAINS" ]]; then
    usage
    die "必须指定 --domain <域名>" 3
  fi

  check_prereq
  check_dns
  ensure_dirs

  print_plan
  confirm "确认执行？输入 yes 继续: "

  ensure_nginx_mounts
  certbot_issue

  if (( STAGING )); then
    log "staging 演练完成（未产出正式证书）。演练通过后去掉 --staging 再跑一次即可正式签发"
    exit 0
  fi

  apply_snippet
  reload_nginx

  if (( INSTALL_CRON )); then
    install_cron
  fi

  echo ""
  log "HTTPS 已启用"
  log "访问地址: https://${PRIMARY_DOMAIN}/"
  log "后台地址: https://${PRIMARY_DOMAIN}/admin/"
  if (( ! FORCE_HTTPS )); then
    log "80 端口仍提供 HTTP 访问（未强制跳转）；确认 HTTPS 正常后再加 --force-https 收紧"
  fi
  log "验证: curl -sI https://${PRIMARY_DOMAIN}/api/v1/health | head -5"
  log "关闭: bash ${SCRIPT_DIR}/setup-https.sh --disable"
}

main "$@"
