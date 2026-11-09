#!/usr/bin/env bash
set -uo pipefail

# set-admin-password.sh — 管理员口令轮转（**应急通道**，日常请用后台改密端点）。
#
# 定位（重要）：
#   主路径 = 后台改密端点 POST /api/v1/admin/auth/change-password
#            （需要管理员 access_token；保留 admin_user.id 与角色绑定，改密后需重新登录）
#   本脚本 = 应急兜底，用于「忘记口令 / 账号被锁 / 无法登录后台」时把管理员救回来。
#   代价：DB 层轮转会软删旧 auth_identity + admin_user，再由 seed 新建 →
#         admin_user.id 会变化，角色绑定与审计里的 actor_id 会跟着漂。
#         所以能用改密端点就别用本脚本。
#
# 为什么用这种方式而不是直接算 argon2 哈希：
#   种子里的 createAdminUser 命中已有 identity 就直接返回（自然键幂等），
#   也就是说「重跑 seed 并带上新口令」并不会改口令。本脚本用
#   「软删旧 identity → 重跑 seed」绕开这一点，且全程只走产品自己的代码路径，
#   哈希算法与参数（argon2id，OWASP 基线）自动与产品端一致。
#
# 用法:
#   bash deploy/scripts/set-admin-password.sh --password '新口令'
#   bash deploy/scripts/set-admin-password.sh --generate
#   printf '%s' '新口令' | bash deploy/scripts/set-admin-password.sh --password-stdin
#
# 退出码: 0=成功 1=失败 2=用户取消 3=参数/环境错误（含口令不合规）

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
MALL_DIR="${MALL_DIR:-/opt/mall}"
ENV_FILE="${MALL_DIR}/config/.env"

ADMIN_EMAIL="admin"
NEW_PASSWORD=""
DRY_RUN=0
ASSUME_YES=0
RESTORE_DEFAULT=0
# 口令长度下限，必须与产品端 packages/policy/src/password.ts 的 MIN_PASSWORD_LENGTH 一致
# （回归脚本会校验两边不漂移）
MIN_PASSWORD_LENGTH=8
# 产品 seed 里的出厂默认口令（只用于显示；真正的权威来源是 seed 自己）
SEED_DEFAULT_PASSWORD=""

log()  { printf '[set-admin-password] %s\n' "$*"; }
warn() { printf '[set-admin-password][WARN] %s\n' "$*"; }
err()  { printf '[set-admin-password][ERROR] %s\n' "$*" >&2; }
die()  { local code="${2:-1}"; err "$1"; exit "$code"; }

usage() {
  cat <<'EOF'
用法: set-admin-password.sh [选项]
  --password PW    指定新口令（注意：会出现在进程列表里）
  --password-stdin 从标准输入读取新口令（推荐用于 CI）
  --generate       自动生成 32 位随机口令并打印
  --restore-default 恢复出厂默认口令（**降级操作，必须加 --yes**）
  --email E        管理员登录标识（默认 admin）
  --dry-run        只打印将要执行的 SQL 与命令，不改动数据
  --yes            跳过交互确认（--restore-default 时为必填）
  -h, --help       显示帮助

定位: 应急通道。日常改密请用后台改密端点
      POST /api/v1/admin/auth/change-password（保留 admin_user.id 与角色绑定）。
      本脚本走 DB 层轮转，会软删旧 identity + admin_user，导致 admin_user.id 变化。

口令强度（与产品端同一份规则）: 至少 8 位 + 含字母 + 含数字
  例外: --restore-default 恢复出厂默认口令时绕过强度校验 ——
        出厂默认值本身就不满足强度规则，没有这条路径就会「一改密就回不去」。

退出码: 0=成功 1=失败 2=用户取消 3=参数/环境错误（含口令不合规）
EOF
}

parse_args() {
  local from_stdin=0
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --password)      NEW_PASSWORD="${2:-}"; [[ -n "$NEW_PASSWORD" ]] || die "--password 缺少参数" 3; shift ;;
      --password-stdin) from_stdin=1 ;;
      --generate)      # 前缀 Ma9 保证「含字母 + 含数字」（否则极小概率生成不合规口令被自己拒了）
                       NEW_PASSWORD="Ma9$(openssl rand -hex 16)"; GENERATED=1 ;;
      --restore-default) RESTORE_DEFAULT=1 ;;
      --email)         ADMIN_EMAIL="${2:-}"; [[ -n "$ADMIN_EMAIL" ]] || die "--email 缺少参数" 3; shift ;;
      --dry-run)       DRY_RUN=1 ;;
      --yes|-y)        ASSUME_YES=1 ;;
      -h|--help)       usage; exit 0 ;;
      *)               err "未知参数: $1"; usage; exit 3 ;;
    esac
    shift
  done
  if (( from_stdin )); then
    NEW_PASSWORD="$(cat)"
    [[ -n "$NEW_PASSWORD" ]] || die "标准输入为空，没有读到新口令" 3
  fi
}

compose() {
  ( cd "$COMPOSE_DIR" && docker compose --env-file "$ENV_FILE" "$@" )
}

psql_cmd() {
  compose exec -T postgres psql -v ON_ERROR_STOP=1 -U mall -d mall -c "$1"
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

# 读取产品 seed 里的出厂默认口令（**仅用于显示**）。
# 恢复出厂默认时真正生效的是 seed 自己的 DEFAULT_ADMIN_PASSWORD（脚本刻意不传 ADMIN_PASSWORD），
# 这里只是把值读出来给你看，避免「恢复完不知道口令是多少」。
seed_default_password() {
  local f="${COMPOSE_DIR}/../apps/api/src/seed.ts"
  [[ -f "$f" ]] || return 0
  grep -oE 'DEFAULT_ADMIN_PASSWORD[[:space:]]*=[[:space:]]*"[^"]*"' "$f" 2>/dev/null \
    | head -1 | sed 's/.*"\(.*\)"/\1/'
}

# 口令强度校验：与产品端同一份规则、同一套措辞、同一判定顺序。
# 产品端规则本体在 packages/policy/src/password.ts（全项目唯一来源，
# @mall/auth 从那里转出、前端 @mall/admin 也直接引用 —— 产品侧已不存在两份规则漂移）。
# 规则顺序 = 判定顺序 = 失败原因优先级：长度 → 字母 → 数字。
#   1) 长度 < 8      → 「新口令过短（N 位，至少 8 位）」
#   2) 不含字母      → 「新口令必须包含字母」
#   3) 不含数字      → 「新口令必须包含数字」
# 两边必须一致：脚本能设出产品端会拒绝的口令，会造成「运维能设、产品不让用」的割裂
# （改完口令回后台却登不上）。
check_password_strength() {
  local pw="$1"
  if (( ${#pw} < MIN_PASSWORD_LENGTH )); then
    die "新口令过短（${#pw} 位，至少 ${MIN_PASSWORD_LENGTH} 位）" 3
  fi
  if ! printf '%s' "$pw" | grep -q '[A-Za-z]'; then
    die "新口令必须包含字母" 3
  fi
  if ! printf '%s' "$pw" | grep -q '[0-9]'; then
    die "新口令必须包含数字" 3
  fi
}

main() {
  parse_args "$@"

  if (( RESTORE_DEFAULT )) && [[ -n "$NEW_PASSWORD" ]]; then
    die "--restore-default 与 --password/--generate 不能同时使用（前者用产品出厂默认值，后者用你指定的口令）" 3
  fi
  if (( ! RESTORE_DEFAULT )) && [[ -z "$NEW_PASSWORD" ]]; then
    usage
    die "必须指定 --password / --password-stdin / --generate（恢复出厂默认口令请用 --restore-default）" 3
  fi
  # 恢复出厂默认口令是唯一的「不依赖强度规则」的路径：
  # 用户自选的新口令必须满足产品端的强度规则（8位+字母+数字），
  # 但出厂默认口令（123456）本身就不满足 —— 没有这条路径的话，
  # 用户一旦改密就再也回不到默认口令（规则死锁）。
  if (( RESTORE_DEFAULT )); then
    warn "已按 --restore-default 绕过口令强度校验（恢复出厂默认口令属降级操作）"
    SEED_DEFAULT_PASSWORD="$(seed_default_password)"
    NEW_PASSWORD=""
    # 恢复出厂默认口令属降级操作，强制 --yes（不提供交互确认，避免误触）。
    # 参数校验放在环境检查之前，缺参数时立刻给出可复制的完整命令。
    if (( ! ASSUME_YES )); then
      err "--restore-default 是降级操作，必须显式加 --yes 确认"
      die "请执行: bash ${SCRIPT_DIR}/set-admin-password.sh --restore-default --yes" 3
    fi
  else
    check_password_strength "$NEW_PASSWORD"
  fi

  if [[ ! -f "$ENV_FILE" ]]; then
    if (( DRY_RUN )); then
      warn "缺少 ${ENV_FILE}，dry-run 继续（真实执行需要该文件）"
    else
      die "缺少 ${ENV_FILE}，无法定位 compose 环境" 1
    fi
  fi
  if ! command -v docker >/dev/null 2>&1; then
    if (( DRY_RUN )); then
      warn "本机没有 Docker，dry-run 只能给出计划（真实执行需要 Docker）"
    else
      die "未检测到 Docker。处置: 安装 Docker 后重跑" 1
    fi
  fi

  if [[ -n "${GENERATED:-}" ]]; then
    echo ""
    echo "新口令: ${NEW_PASSWORD}"
    echo "（请立刻保存；本脚本不会再显示第二次）"
    echo ""
  fi

  # 当前状态
  local cur
  cur="$(compose exec -T postgres psql -U mall -d mall -tAc \
    "SELECT count(*) FROM auth_identity WHERE email='${ADMIN_EMAIL}' AND scope='admin' AND deleted_at IS NULL" 2>/dev/null | tr -d '\r ')"
  if [[ "${cur:-0}" == "0" ]]; then
    if (( DRY_RUN )); then
      warn "读不到活跃的管理员 identity（无 Docker 或库里没有该账号），dry-run 继续"
    else
      die "库里没有活跃的管理员 identity（email=${ADMIN_EMAIL}, scope=admin）。请先确认管理员账号是否已创建" 1
    fi
  fi

  echo ""
  echo "=============== 重置管理员口令（影响范围） ==============="
  echo "管理员: ${ADMIN_EMAIL}"
  echo "将执行:"
  echo "  1) 软删除旧的 auth_identity（email=${ADMIN_EMAIL}, scope=admin）并置 status=revoked"
  echo "  2) 软删除旧的 admin_user（email=${ADMIN_EMAIL}）"
  echo "  3) 撤销旧 identity 名下全部 refresh_token（旧会话立即失效）"
  if (( RESTORE_DEFAULT )); then
    echo "  4) 重跑 seed（不传 ADMIN_PASSWORD，由产品 seed 使用它自己的 DEFAULT_ADMIN_PASSWORD）"
    echo "     → 出厂默认口令: ${SEED_DEFAULT_PASSWORD:-见 seed 日志}"
  else
    echo "  4) 重跑 seed: docker compose run --rm -e ADMIN_PASSWORD=... api node apps/api/dist/seed.js"
  fi
  echo ""
  echo "不影响: 订单、商品、库存等业务数据；旧行保留（软删除），历史外键不断裂"
  echo "新管理员 id 会变化（seed 新建 admin_user），仅影响按 admin_user_id 的展示关联"
  if (( RESTORE_DEFAULT )); then
    echo ""
    echo "!! 降级操作警告：这是恢复出厂默认口令 !!"
    echo "   恢复后管理员口令是产品出厂默认值（弱口令），任何人拿到后台地址就能登录。"
    echo "   恢复完成后请立即用后台改密页改成强口令（至少 8 位且含字母与数字）。"
    echo "   日常改密主路径: POST /api/v1/admin/auth/change-password（保留 admin_user.id 与角色绑定）"
  fi
  echo "==========================================================="
  echo ""

  if (( RESTORE_DEFAULT )); then
    # 恢复出厂默认口令属降级操作（--yes 已在参数校验阶段强制要求）
    log "已确认 --yes，继续执行恢复出厂默认口令"
  else
    confirm "确认重置管理员口令？输入 yes 继续: "
  fi

  local sql
  sql="UPDATE auth_identity SET deleted_at=now(), updated_at=now(), status='revoked' WHERE email='${ADMIN_EMAIL}' AND scope='admin' AND deleted_at IS NULL;
UPDATE admin_user SET deleted_at=now(), updated_at=now() WHERE email='${ADMIN_EMAIL}' AND deleted_at IS NULL;
UPDATE refresh_token SET revoked_at=now() WHERE auth_identity_id IN (SELECT id FROM auth_identity WHERE email='${ADMIN_EMAIL}' AND scope='admin') AND revoked_at IS NULL;"

  if (( DRY_RUN )); then
    echo "[dry-run] 将执行以下 SQL:"
    printf '%s\n' "$sql" | sed 's/^/    /'
    if (( RESTORE_DEFAULT )); then
      echo "[dry-run] 将执行: docker compose run --rm -e ADMIN_EMAIL=${ADMIN_EMAIL} api node apps/api/dist/seed.js（不传 ADMIN_PASSWORD，用产品自己的出厂默认值）"
    else
      echo "[dry-run] 将执行: docker compose run --rm -e ADMIN_EMAIL=${ADMIN_EMAIL} -e ADMIN_PASSWORD=*** api node apps/api/dist/seed.js"
    fi
    log "dry-run 结束，未做任何改动"
    exit 0
  fi

  log "撤销旧 identity 与会话…"
  psql_cmd "$sql" >/dev/null || die "SQL 执行失败，未重跑 seed（口令未变）" 1

  if (( RESTORE_DEFAULT )); then
    log "用出厂默认口令重建管理员（不传 ADMIN_PASSWORD，由产品 seed 使用它自己的 DEFAULT_ADMIN_PASSWORD）…"
    # 刻意不传 ADMIN_PASSWORD：出厂默认值只有一个权威来源 —— 产品 seed 自己的常量。
    # 脚本里再写一份 123456 的话，产品改了默认值两边就会漂。
    compose run --rm -e ADMIN_EMAIL="$ADMIN_EMAIL" api node apps/api/dist/seed.js 2>&1 | sed 's/^/[seed] /' \
      || die "seed 失败（管理员可能处于「已软删除但未重建」状态）。处置: 检查 $(compose_cmd_psql "SELECT email,status,deleted_at FROM auth_identity WHERE email='${ADMIN_EMAIL}'")" 1
  else
    log "用新口令重建管理员…"
    compose run --rm -e ADMIN_EMAIL="$ADMIN_EMAIL" -e ADMIN_PASSWORD="$NEW_PASSWORD" \
      api node apps/api/dist/seed.js >/dev/null 2>&1 \
      || die "seed 失败（管理员可能处于「已软删除但未重建」状态）。处置: 检查 $(compose_cmd_psql "SELECT email,status,deleted_at FROM auth_identity WHERE email='${ADMIN_EMAIL}'")" 1
  fi

  # 校验
  local after
  after="$(compose exec -T postgres psql -U mall -d mall -tAc \
    "SELECT count(*) FROM auth_identity WHERE email='${ADMIN_EMAIL}' AND scope='admin' AND deleted_at IS NULL AND status='active'" 2>/dev/null | tr -d '\r ')"
  if [[ "${after:-0}" == "1" ]]; then
    log "重置完成：活跃管理员 identity 数量 = 1"
    if (( RESTORE_DEFAULT )); then
      log "请用出厂默认口令登录: POST /api/v1/admin/auth/login {\"email\":\"${ADMIN_EMAIL}\",\"password\":\"${SEED_DEFAULT_PASSWORD:-见上一步 seed 日志}\"}"
      warn "立刻用后台改密页改成强口令（至少 8 位且含字母与数字），别让默认口令留在生产上"
    else
      log "请用新口令登录: POST /api/v1/admin/auth/login {\"email\":\"${ADMIN_EMAIL}\",\"password\":\"<新口令>\"}"
    fi
  else
    warn "重置后活跃 identity 数量 = ${after:-0}（期望 1），请手工核对"
  fi
}

compose_cmd_psql() { printf 'cd %s && docker compose --env-file %s exec -T postgres psql -U mall -d mall -c "%s"' "$COMPOSE_DIR" "$ENV_FILE" "$1"; }

main "$@"
