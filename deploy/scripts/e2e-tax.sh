#!/usr/bin/env bash
# e2e-tax.sh — 税务真机端到端验收（按收货国家计税 + 后台可切换）
#
# 覆盖链路：
#   读默认配置（默认关闭）→ 配默认税率 + 中国覆盖税率
#   → 同一辆车分别按 CN / JP 读合计（税额不同，证明按国家解析）
#   → 下单带收货地址 → 订单税额与购物车一致、地址真的落库、行级税率留痕
#   → 关闭总开关 → 不再计税
#   → 切含税口径 → 合计不再额外加税（防重复收税）
#
# 设计要点：
#   1. 断言用「后端返回的 subtotal/discount」推期望税额，脚本自己算只用整数除法，
#      不出现浮点；期望值由 rate_bps 明确给出，不依赖商品价格。
#   2. 退出时恢复原设置（总开关 / 默认税率 / 删掉本次建的国家税率），
#      不把验收环境的税率留在开启状态。
#   3. 库存不足自动补到 4 件，可重复执行。
#
# 用法：
#   bash deploy/scripts/e2e-tax.sh
#   BASE=http://localhost/api/v1 ADMIN=admin ADMIN_PW='密码' bash deploy/scripts/e2e-tax.sh
#   RATE_WAIT=61 bash deploy/scripts/e2e-tax.sh   # 刚跑过其它下单验收时避开限流
#
# 退出码：0 全通过；1 有失败项。
set -uo pipefail

BASE="${BASE:-http://localhost/api/v1}"
ADMIN="${ADMIN:-admin}"
ADMIN_PW="${ADMIN_PW:-123456}"
PRODUCT_HANDLE="${PRODUCT_HANDLE:-wireless-mouse}"
# 下单限流窗口等待（默认 0；刚跑过其它下单验收时设 61）
RATE_WAIT="${RATE_WAIT:-0}"

PASS=0
FAIL=0
SKIP=0
CODE=""
BODY=""
TOKEN=""
VAR_ID=""
LEVEL_ID=""
CART_ID=""
CART2_ID=""
CART3_ID=""
ORDER_ID=""
CLEANED=0
RESTORED=0
ORIG_ENABLED="false"

ok()   { printf '  [通过] %s\n' "$*"; PASS=$((PASS + 1)); }
bad()  { printf '  [失败] %s\n' "$*"; FAIL=$((FAIL + 1)); }
skip() { printf '  [跳过] %s\n' "$*"; SKIP=$((SKIP + 1)); }
sec()  { printf '\n=== %s ===\n' "$*"; }
is_int() { [[ "${1-}" =~ ^-?[0-9]+$ ]]; }
# jq 在 Windows 下可能带 CR，Linux 无影响；统一去掉避免数值比较失败
jqr() { printf '%s' "$BODY" | jq -r "$1" 2>/dev/null | tr -d '\r'; }

# call <method> <path> [json-body] [auth]
call() {
  local method="$1" path="$2" data="${3-}" auth="${4-}"
  local args=(-s -S -w $'\n%{http_code}' -X "$method" "$BASE$path")
  [[ -n "$auth" ]] && args+=(-H "Authorization: Bearer $TOKEN")
  if [[ -n "$data" ]]; then
    args+=(-H 'Content-Type: application/json' --data-binary "$data")
  fi
  local out
  out="$(curl "${args[@]}" 2>&1)"
  CODE="${out##*$'\n'}"
  BODY="${out%$'\n'*}"
}

expect_2xx() {
  local desc="$1"
  if [[ "$CODE" =~ ^2[0-9][0-9]$ ]]; then
    ok "$desc（HTTP $CODE）"
    return 0
  fi
  bad "$desc（HTTP $CODE）：$(printf '%s' "$BODY" | head -c 220)"
  return 1
}

expect_num() {
  local desc="$1" actual="$2" expected="$3"
  if [[ "$actual" == "$expected" ]]; then
    ok "$desc：$actual"
  else
    bad "$desc：实际 $actual，期望 $expected"
  fi
}

# 金额四舍五入到分：round(amount * bps / 10000)
tax_of() {
  local amount="$1" bps="$2"
  printf '%s' $(( (amount * bps + 5000) / 10000 ))
}

cleanup() {
  [[ "$CLEANED" -eq 1 ]] && return 0
  CLEANED=1
  if [[ "$RESTORED" -eq 1 ]]; then
    # 恢复总开关
    call PUT "/admin/tax/settings" "{\"enabled\":$ORIG_ENABLED}" auth >/dev/null 2>&1
    # 删掉本次建的国家税率（删完即回落默认）
    call DELETE "/admin/tax/country-rates/CN" "" auth >/dev/null 2>&1
    # 默认税率归零，避免影响后续真实下单
    call PUT "/admin/tax/default-rate" '{"name":"标准税率","rate_bps":0}' auth >/dev/null 2>&1
  fi
}

# 库存兜底：可用不足 need 件就补差额（只补差额，不动预留）
ensure_stock() {
  local level_id="$1" sku="$2" need="$3"
  call GET "/admin/inventory-levels?limit=100" "" auth
  local row avail delta
  row="$(printf '%s' "$BODY" | jq -c --arg sku "$sku" '.data.items[]? | select(.sku==$sku)' 2>/dev/null | tr -d '\r' | head -1)"
  if [[ -z "$row" ]]; then
    bad "找不到 SKU $sku 的库存行"
    return 1
  fi
  LEVEL_ID="$(printf '%s' "$row" | jq -r '.id')"
  avail="$(printf '%s' "$row" | jq -r '.available_quantity')"
  if ! is_int "$avail"; then
    bad "可用量读取失败：$avail"
    return 1
  fi
  if (( avail < need )); then
    delta=$(( need - avail ))
    call PUT "/admin/inventory-levels/$LEVEL_ID" "{\"delta\":$delta,\"reason\":\"e2e 税务验收备货\"}" auth
    expect_2xx "补货 $delta 件（可重复执行）" || return 1
  fi
  return 0
}

echo "—— 税务端到端验收（ADR-018）——"
printf '目标：%s\n' "$BASE"

# ---------------------------------------------------------------- #
sec "1. 管理员登录"
call POST "/admin/auth/login" "{\"email\":\"$ADMIN\",\"password\":\"$ADMIN_PW\"}"
TOKEN="$(jqr '.data.access_token')"
if [[ -z "$TOKEN" || "$TOKEN" == "null" ]]; then
  bad "登录失败：$(printf '%s' "$BODY" | head -c 200)"
  printf '\n终止：没有管理员令牌。\n'
  exit 1
fi
ok "管理员 $ADMIN 登录成功"

# ---------------------------------------------------------------- #
sec "2. 默认配置：税务默认关闭"
call GET "/admin/tax" "" auth
expect_2xx "读税务配置" || exit 1
ORIG_ENABLED="$(jqr '.data.settings.enabled')"
expect_num "默认关闭（enabled）" "$ORIG_ENABLED" "false"
printf '  当前默认税率：%s bps；地区税率 %s 条\n' \
  "$(jqr '.data.default_rate.rate_bps // 0')" "$(jqr '.data.country_rates | length')"
RESTORED=1
trap cleanup EXIT

# ---------------------------------------------------------------- #
sec "3. 配置税率：默认 10%，中国 13%（价外税）"
call PUT "/admin/tax/settings" '{"enabled":true,"tax_name":"增值税","prices_include_tax":false}' auth
expect_2xx "开启计税（价外税）" || exit 1
call PUT "/admin/tax/default-rate" '{"name":"标准税率","rate_bps":1000}' auth
expect_2xx "设默认税率 10%" || exit 1
call PUT "/admin/tax/country-rates/CN" '{"name":"中国增值税","rate_bps":1300}' auth
expect_2xx "设中国税率 13%" || exit 1

call GET "/admin/tax" "" auth
expect_num "中国税率（bps）" "$(printf '%s' "$BODY" | jq -r '.data.country_rates[] | select(.country_code=="CN") | .rate_bps' | tr -d '\r' | head -1)" "1300"
expect_num "默认税率（bps）" "$(jqr '.data.default_rate.rate_bps')" "1000"

# ---------------------------------------------------------------- #
sec "3.1 店面可选国家：顾客真的能选（不只中国一条）"
call GET "/store/checkout/countries"
expect_2xx "读可选国家" || exit 1
COUNTRY_COUNT="$(jqr '.data.count')"
if is_int "$COUNTRY_COUNT" && (( COUNTRY_COUNT > 10 )); then
  ok "可选国家数量：$COUNTRY_COUNT（> 10）"
else
  bad "可选国家数量异常：$COUNTRY_COUNT"
fi
expect_num "默认国家" "$(jqr '.data.default_country')" "CN"
expect_num "中国税率（应为已配的 1300）" \
  "$(printf '%s' "$BODY" | jq -r '.data.items[] | select(.code=="CN") | .tax_rate_bps' | tr -d '\r' | head -1)" "1300"
expect_num "中国税率来源（country）" \
  "$(printf '%s' "$BODY" | jq -r '.data.items[] | select(.code=="CN") | .rate_source' | tr -d '\r' | head -1)" "country"
expect_num "日本走默认税率来源（default）" \
  "$(printf '%s' "$BODY" | jq -r '.data.items[] | select(.code=="JP") | .rate_source' | tr -d '\r' | head -1)" "default"

# ---------------------------------------------------------------- #
sec "4. 准备商品与库存"
call GET "/admin/products?limit=100" "" auth
expect_2xx "读商品列表" || exit 1
PID="$(printf '%s' "$BODY" | jq -r --arg h "$PRODUCT_HANDLE" '.data.items[]? | select(.handle==$h) | .id' 2>/dev/null | tr -d '\r' | head -1)"
if [[ -z "$PID" || "$PID" == "null" ]]; then
  bad "找不到商品 handle=$PRODUCT_HANDLE"
  exit 1
fi
call GET "/admin/products/$PID" "" auth
expect_2xx "读商品详情" || exit 1
SKU="$(jqr '.data.variants[0].sku')"
VAR_ID="${VAR_ID:-$(jqr '.data.variants[0].id')}"
ok "商品 $PRODUCT_HANDLE（SKU $SKU）"
ensure_stock "$LEVEL_ID" "$SKU" 6 || exit 1

# ---------------------------------------------------------------- #
sec "5. 同一辆车按不同国家读合计（税率按国家解析）"
call POST "/store/carts" '{"email":"e2e-tax@example.com"}'
expect_2xx "建购物车" || exit 1
CART_ID="$(jqr '.data.id')"
call POST "/store/carts/$CART_ID/line-items" "{\"variant_id\":\"$VAR_ID\",\"quantity\":2}"
expect_2xx "加购 2 件" || exit 1

call PUT "/store/carts/$CART_ID/address" '{"country":"CN"}' auth
expect_2xx "设置收货国家 CN（服务端据此算运费与税）" || exit 1
call GET "/store/carts/$CART_ID" "" auth
expect_2xx "按 CN 读购物车" || exit 1
SUBTOTAL_CN="$(jqr '.data.totals.subtotal_minor')"
DISCOUNT_CN="$(jqr '.data.totals.discount_minor // 0')"
SHIP_CN="$(jqr '.data.totals.shipping_minor')"
TAX_CN="$(jqr '.data.totals.tax_minor')"
TOTAL_CN="$(jqr '.data.totals.total_minor')"
BASE_CN=$(( SUBTOTAL_CN - DISCOUNT_CN ))
# 税 = 商品行税 + 运费税（运费由系统按国家自动选，也要计税）
expect_num "中国税率 13% 的税额（含运费税）" "$TAX_CN" "$(( $(tax_of "$BASE_CN" 1300) + $(tax_of "$SHIP_CN" 1300) ))"
expect_num "价外税合计 = 商品 + 运费 + 税 - 折扣" "$TOTAL_CN" "$(( BASE_CN + SHIP_CN + TAX_CN ))"
expect_num "税口径标记（价外 = false）" "$(jqr '.data.tax_included_in_price')" "false"

call PUT "/store/carts/$CART_ID/address" '{"country":"JP"}' auth
expect_2xx "切到日本" || exit 1
call GET "/store/carts/$CART_ID" "" auth
expect_2xx "按 JP 读购物车" || exit 1
TAX_JP="$(jqr '.data.totals.tax_minor')"
SHIP_JP="$(jqr '.data.totals.shipping_minor')"
expect_num "日本走默认税率 10% 的税额" "$TAX_JP" "$(( $(tax_of "$BASE_CN" 1000) + $(tax_of "$SHIP_JP" 1000) ))"
if (( TAX_CN > TAX_JP )); then
  ok "两国税额不同（CN $TAX_CN > JP $TAX_JP），证明按国家解析"
else
  bad "两国税额没有差异（CN $TAX_CN / JP $TAX_JP）"
fi

# ---------------------------------------------------------------- #
sec "6. 下单：收货地址落库、税额与购物车一致"
if (( RATE_WAIT > 0 )); then
  printf '  等待 %s 秒让下单限流窗口重置…\n' "$RATE_WAIT"
  sleep "$RATE_WAIT"
fi
call PUT "/store/carts/$CART_ID/address" '{"country":"CN"}' auth >/dev/null
call POST "/store/carts/$CART_ID/complete" \
  '{"shipping_address":{"name":"张三","phone":"13800000000","country":"CN","province":"广东","city":"深圳","address_1":"科技园 1 号"}}' auth
expect_2xx "下单（带收货地址）" || exit 1
ORDER_ID="$(jqr '.data.id')"
expect_num "订单税额 = 购物车 CN 税额" "$(jqr '.data.tax_minor')" "$TAX_CN"
expect_num "订单合计 = 购物车 CN 合计" "$(jqr '.data.total_minor')" "$TOTAL_CN"
expect_num "订单收货国家" "$(jqr '.data.shipping_address.country')" "CN"
expect_num "订单收货城市" "$(jqr '.data.shipping_address.city')" "深圳"
expect_num "订单行税率留痕" "$(jqr '.data.line_items[0].tax_rate_bps')" "1300"
expect_num "订单行税额" "$(jqr '.data.line_items[0].tax_amount_minor')" "$TAX_CN"

call GET "/admin/orders/$ORDER_ID" "" auth
expect_num "后台订单税额一致" "$(jqr '.data.tax_minor')" "$TAX_CN"
expect_num "后台订单地址一致" "$(jqr '.data.shipping_address.country')" "CN"

# ---------------------------------------------------------------- #
sec "7. 关闭总开关后不再计税"
call PUT "/admin/tax/settings" '{"enabled":false}' auth
expect_2xx "关闭计税" || exit 1

call POST "/store/carts" '{"email":"e2e-tax-off@example.com"}'
CART2_ID="$(jqr '.data.id')"
call POST "/store/carts/$CART2_ID/line-items" "{\"variant_id\":\"$VAR_ID\",\"quantity\":1}" >/dev/null
call PUT "/store/carts/$CART2_ID/address" '{"country":"CN"}' auth >/dev/null
call GET "/store/carts/$CART2_ID" "" auth
expect_2xx "读关闭后的购物车" || exit 1
expect_num "关闭后税额为 0" "$(jqr '.data.totals.tax_minor')" "0"
SUBTOTAL_OFF="$(jqr '.data.totals.subtotal_minor')"
SHIP_OFF="$(jqr '.data.totals.shipping_minor')"
DISCOUNT_OFF="$(jqr '.data.totals.discount_minor // 0')"
expect_num "关闭后合计不加税" "$(jqr '.data.totals.total_minor')" "$(( SUBTOTAL_OFF + SHIP_OFF - DISCOUNT_OFF ))"

# ---------------------------------------------------------------- #
sec "8. 含税口径：合计不再额外加税（防重复收税）"
call PUT "/admin/tax/settings" '{"enabled":true,"prices_include_tax":true}' auth
expect_2xx "切到含税价口径" || exit 1

call POST "/store/carts" '{"email":"e2e-tax-incl@example.com"}'
CART3_ID="$(jqr '.data.id')"
call POST "/store/carts/$CART3_ID/line-items" "{\"variant_id\":\"$VAR_ID\",\"quantity\":1}" >/dev/null
call PUT "/store/carts/$CART3_ID/address" '{"country":"CN"}' auth >/dev/null
call GET "/store/carts/$CART3_ID" "" auth
expect_2xx "读含税价购物车" || exit 1
TAX_INCL="$(jqr '.data.totals.tax_minor')"
SUBTOTAL_INCL="$(jqr '.data.totals.subtotal_minor')"
SHIP_INCL="$(jqr '.data.totals.shipping_minor')"
DISCOUNT_INCL="$(jqr '.data.totals.discount_minor // 0')"
BASE_INCL=$(( SUBTOTAL_INCL - DISCOUNT_INCL ))
expect_num "含税口径标记（true）" "$(jqr '.data.tax_included_in_price')" "true"
# 含税价：商品与运费各自价内拆税
expect_num "含税价里拆出的税额（含运费税）" "$TAX_INCL" \
  "$(( (BASE_INCL * 1300 + 11300 / 2) / 11300 + (SHIP_INCL * 1300 + 11300 / 2) / 11300 ))"
expect_num "含税价合计不再加税" "$(jqr '.data.totals.total_minor')" "$(( BASE_INCL + SHIP_INCL ))"

# ---------------------------------------------------------------- #
sec "9. 恢复原设置"
call PUT "/admin/tax/settings" "{\"enabled\":$ORIG_ENABLED,\"prices_include_tax\":true}" auth >/dev/null
call DELETE "/admin/tax/country-rates/CN" "" auth
expect_2xx "删除中国税率（回落默认）" || exit 1
call PUT "/admin/tax/default-rate" '{"name":"标准税率","rate_bps":0}' auth >/dev/null
RESTORED=0

call GET "/admin/tax" "" auth
expect_num "总开关已恢复" "$(jqr '.data.settings.enabled')" "$ORIG_ENABLED"
expect_num "本次建的中国税率已删除" \
  "$(printf '%s' "$BODY" | jq -r '[.data.country_rates[]? | select(.country_code=="CN")] | length')" "0"

printf '\n—— 结果：通过 %s · 失败 %s · 跳过 %s ——\n' "$PASS" "$FAIL" "$SKIP"
[[ "$FAIL" -eq 0 ]] || exit 1
