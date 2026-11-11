#!/usr/bin/env bash
# e2e-promotion.sh — 二期促销真机端到端验收（订单促销 + 优惠券 + 礼品卡）
#
# 覆盖链路：
#   后台建「订单促销(满减)」并启用 → 建「优惠券」→ 店面加购 → 选运费
#   → 自动命中订单促销 → 输券 → 输礼品卡 → 合计恒等式
#   → 下单 → 后台订单详情核对折扣留痕(order_discount) → 券已核销 / 卡已扣减
#
# 设计要点：
#   1. 断言用「增量」而不是写死总额：d1-d0 必须等于券面额，d2-d1 必须等于卡抵扣额。
#      这样机器上存在其它促销时脚本也不会假失败（同维度后端取最大）。
#   2. 所有金额断言都取自后端返回，脚本自己不做折扣计算（只做恒等式校验）。
#   3. 出脚本即停用本次建的促销与券（trap EXIT），避免测试数据继续影响真实订单；
#      记录保留、可审计，不做物理删除。
#   4. 金额一律 minor unit（分）比较，不出现浮点。
#
# 用法：
#   bash deploy/scripts/e2e-promotion.sh
#   BASE=http://localhost/api/v1 ADMIN=admin ADMIN_PW='你的密码' bash deploy/scripts/e2e-promotion.sh
#   VAR_ID=var_xxx bash deploy/scripts/e2e-promotion.sh
#
# 退出码：0 全通过；1 有失败项。
set -uo pipefail

BASE="${BASE:-http://localhost/api/v1}"
ADMIN="${ADMIN:-admin}"
ADMIN_PW="${ADMIN_PW:-123456}"
VAR_ID="${VAR_ID:-}"
PRODUCT_HANDLE="${PRODUCT_HANDLE:-wireless-mouse}"
# 下单限流窗口等待（默认 0；刚跑过其它下单验收时设 61）
RATE_WAIT="${RATE_WAIT:-0}"

PASS=0
FAIL=0
SKIP=0
CODE=""
BODY=""
TOKEN=""
PROMO_ID=""
VOUCHER_ID=""
VOUCHER_CODE=""
CARD_ID=""
CARD_CODE=""
CART_ID=""
ORDER_ID=""
CLEANED=0
FEATURES_SAVED=0
F_PROMO="false"
F_VOUCHER="false"
F_GIFT="false"

ok()   { printf '  [通过] %s\n' "$*"; PASS=$((PASS + 1)); }
bad()  { printf '  [失败] %s\n' "$*"; FAIL=$((FAIL + 1)); }
skip() { printf '  [跳过] %s\n' "$*"; SKIP=$((SKIP + 1)); }
sec()  { printf '\n=== %s ===\n' "$*"; }
is_int() { [[ "${1-}" =~ ^-?[0-9]+$ ]]; }
jqr() { printf '%s' "$BODY" | jq -r "$1" 2>/dev/null; }

# call <method> <path> [json-body] [auth]
# 结果写入全局 CODE / BODY，不直接打印，便于逐项断言。
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

# 期望 2xx；失败时打响应前 200 字，避免只看到状态码无从排查。
expect_2xx() {
  local desc="$1"
  if [[ "$CODE" =~ ^2[0-9][0-9]$ ]]; then
    ok "$desc（HTTP $CODE）"
    return 0
  fi
  bad "$desc（HTTP $CODE）：$(printf '%s' "$BODY" | head -c 200)"
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

expect_jq_true() {
  local desc="$1" expr="$2"
  if printf '%s' "$BODY" | jq -e "$expr" >/dev/null 2>&1; then
    ok "$desc"
  else
    bad "$desc（jq 条件不成立：$expr）"
  fi
}

cleanup() {
  [[ "$CLEANED" -eq 1 ]] && return 0
  CLEANED=1
  # 恢复营销功能开关原值（默认全关，不能因为跑过验收就把功能留在开启状态）
  if [[ "$FEATURES_SAVED" -eq 1 ]]; then
    call PUT "/admin/promotions/features/promotion" "{\"enabled\":$F_PROMO}" auth >/dev/null 2>&1
    call PUT "/admin/promotions/features/voucher" "{\"enabled\":$F_VOUCHER}" auth >/dev/null 2>&1
    call PUT "/admin/promotions/features/gift_card" "{\"enabled\":$F_GIFT}" auth >/dev/null 2>&1
  fi
  # 停用（不是删除）：保留记录可审计，同时立即不再命中，防止污染真实订单。
  if [[ -n "$PROMO_ID" ]]; then
    call POST "/admin/promotions/$PROMO_ID/deactivate" "" auth >/dev/null 2>&1
  fi
  if [[ -n "$VOUCHER_ID" ]]; then
    call POST "/admin/promotions/vouchers/$VOUCHER_ID/disable" "" auth >/dev/null 2>&1
  fi
}
trap cleanup EXIT

# ------------------------------------------------------------------ #
# 0. 预检
# ------------------------------------------------------------------ #
sec "0. 预检：依赖 + API 可达"
for bin in curl jq; do
  if command -v "$bin" >/dev/null 2>&1; then ok "依赖 $bin 存在"; else bad "缺少依赖 $bin"; fi
done
if ((FAIL > 0)); then
  printf '\n缺少必要依赖，终止。Debian 安装：apt-get install -y curl jq\n'
  exit 1
fi
call GET "/health"
if expect_2xx "API 健康检查 $BASE/health"; then :; else
  printf '\nAPI 不可达，终止。先执行：bash deploy/healthcheck.sh\n'
  exit 1
fi

# ------------------------------------------------------------------ #
# 1. 后台登录
# ------------------------------------------------------------------ #
sec "1. 后台登录（需要 settings 权限）"
call POST "/admin/auth/login" "{\"email\":\"$ADMIN\",\"password\":\"$ADMIN_PW\"}"
TOKEN="$(jqr '.data.access_token')"
if [[ -n "$TOKEN" && "$TOKEN" != "null" ]]; then
  ok "管理员 $ADMIN 登录成功"
else
  bad "管理员登录失败：$(printf '%s' "$BODY" | head -c 200)"
  printf '\n终止：没有管理员令牌，后续后台步骤无法执行。\n'
  exit 1
fi
AUTH=1

# 营销功能默认全关（ADR-014）：跑促销验收前临时全开，退出时恢复原值。
call GET "/admin/promotions/features" "" "$AUTH"
if [[ "$CODE" =~ ^2[0-9][0-9]$ ]]; then
  F_PROMO="$(jqr '.data.promotion')"
  F_VOUCHER="$(jqr '.data.voucher')"
  F_GIFT="$(jqr '.data.gift_card')"
  FEATURES_SAVED=1
  for f in promotion voucher gift_card; do
    call PUT "/admin/promotions/features/$f" '{"enabled":true}' "$AUTH" >/dev/null
  done
  ok "已临时开启促销/优惠券/礼品卡（脚本退出时恢复原值）"
else
  skip "读不到功能开关，按已开启继续（老版本后端）"
fi

# 库存兜底：前面的验收可能把这款商品买空；补到至少 4 件，脚本可重复执行。
call GET "/admin/products?limit=100" "" "$AUTH"
PID="$(printf '%s' "$BODY" | jq -r --arg h "$PRODUCT_HANDLE" '.data.items[]? | select(.handle==$h) | .id' 2>/dev/null | tr -d '\r' | head -1)"
if [[ -n "$PID" && "$PID" != "null" ]]; then
  call GET "/admin/products/$PID" "" "$AUTH"
  SKU="$(jqr '.data.variants[0].sku')"
  call GET "/admin/inventory-levels?limit=100" "" "$AUTH"
  ROW="$(printf '%s' "$BODY" | jq -c --arg sku "$SKU" '.data.items[]? | select(.sku==$sku)' 2>/dev/null | tr -d '\r' | head -1)"
  if [[ -n "$ROW" ]]; then
    LVL_ID="$(printf '%s' "$ROW" | jq -r '.id')"
    AVAIL="$(printf '%s' "$ROW" | jq -r '.available_quantity')"
    if [[ "$AVAIL" =~ ^[0-9]+$ ]] && ((AVAIL < 4)); then
      DELTA=$((4 - AVAIL))
      call PUT "/admin/inventory-levels/$LVL_ID" "{\"delta\":$DELTA,\"reason\":\"e2e 备货\"}" "$AUTH" >/dev/null
      ok "库存补货 $DELTA 件（可重复执行）"
    fi
  fi
fi

# 清掉上次异常退出遗留的 e2e 促销（名字前缀 e2e-），避免同维度取最大时干扰断言。
call GET "/admin/promotions?limit=100&offset=0" "" "$AUTH"
STALE_IDS="$(jqr '.data.items[]? | select(.name | startswith("e2e-")) | .id')"
if [[ -n "$STALE_IDS" ]]; then
  for sid in $STALE_IDS; do
    call POST "/admin/promotions/$sid/deactivate" "" "$AUTH" >/dev/null 2>&1
  done
  ok "已停用遗留的 e2e 促销 $(printf '%s' "$STALE_IDS" | wc -w) 条"
else
  skip "无遗留 e2e 促销"
fi

# ------------------------------------------------------------------ #
# 2. 店面：取变体 + 建车 + 加购
# ------------------------------------------------------------------ #
sec "2. 店面：建车 + 加购 ×2"
if [[ -z "$VAR_ID" ]]; then
  call GET "/store/products/wireless-mouse"
  VAR_ID="$(jqr '.data.variants[0].id')"
fi
if [[ -z "$VAR_ID" || "$VAR_ID" == "null" ]]; then
  bad "取不到可售变体：请用 VAR_ID=var_xxx 指定，或确认 seed 已导入 wireless-mouse"
  exit 1
fi
ok "使用变体 $VAR_ID"

call POST "/store/carts" "{\"email\":\"promo-e2e@example.com\"}"
expect_2xx "创建购物车" || exit 1
CART_ID="$(jqr '.data.id')"
ok "购物车 $CART_ID"

call POST "/store/carts/$CART_ID/line-items" "{\"variant_id\":\"$VAR_ID\",\"quantity\":2}"
expect_2xx "加购 2 件" || exit 1
SUB="$(jqr '.data.totals.subtotal_minor')"
if is_int "$SUB" && ((SUB > 0)); then ok "小计 $SUB（minor unit）"; else bad "小计异常：$SUB"; exit 1; fi
CURRENCY="$(jqr '.data.currency_code')"
ok "购物车币种 $CURRENCY"

sec "3. 选运费（带 cart_id，按小计算价）"
call GET "/store/shipping-options?country=CN&cart_id=$CART_ID"
expect_2xx "查询运费方案" || exit 1
OPT_ID="$(jqr '.data.items[0].id')"
if [[ -z "$OPT_ID" || "$OPT_ID" == "null" ]]; then
  bad "没有可用运费方案（检查 fulfillment 种子）"
  exit 1
fi
call POST "/store/carts/$CART_ID/shipping-methods" "{\"shipping_option_id\":\"$OPT_ID\"}"
expect_2xx "选择运费方案 $OPT_ID" || exit 1
SHIP="$(jqr '.data.totals.shipping_minor')"
is_int "$SHIP" || { bad "运费金额异常：$SHIP"; exit 1; }
ok "运费 $SHIP"

# ------------------------------------------------------------------ #
# 4. 后台建「订单促销」并启用（自动命中，无需输码）
# ------------------------------------------------------------------ #
sec "4. 后台建订单促销：满最小值减 ¥10，并启用"
PROMO_MIN=$((SUB / 2))
PROMO_NAME="e2e-订单满减-$(date +%H%M%S)"
call POST "/admin/promotions" \
  "{\"name\":\"$PROMO_NAME\",\"type\":\"order\",\"is_automatic\":true,\"rules\":[{\"predicate\":{\"subtotalGte\":$PROMO_MIN},\"reward_type\":\"fixed\",\"reward_value\":1000}]}" \
  "$AUTH"
expect_2xx "创建订单促销" || exit 1
PROMO_ID="$(jqr '.data.id')"
ok "促销 $PROMO_ID（阈值 $PROMO_MIN，减 1000）"

call POST "/admin/promotions/$PROMO_ID/activate" "" "$AUTH"
expect_2xx "启用订单促销（即时生效）" || exit 1
PROMO_STATUS="$(jqr '.data.status')"
expect_num "促销状态" "$PROMO_STATUS" "active"

# 店面重新读车：订单促销应在这一次计算里命中
call GET "/store/carts/$CART_ID"
expect_2xx "刷新购物车" || exit 1
D0="$(jqr '.data.totals.discount_minor')"
is_int "$D0" || { bad "折扣金额异常：$D0"; exit 1; }
expect_jq_true "订单促销已自动命中（discount>=1000）" '.data.totals.discount_minor >= 1000'
expect_jq_true "折扣明细含本条促销（type=order）" \
  "[.data.discounts[]? | select(.type==\"order\" and .promotion_id==\"$PROMO_ID\")] | length == 1"

# ------------------------------------------------------------------ #
# 5. 后台建券 → 店面输码
# ------------------------------------------------------------------ #
sec "5. 后台建优惠券（减 ¥20）→ 店面输码"
VOUCHER_MIN=$((SUB / 2))
VOUCHER_NAME="e2e-满减券-$(date +%H%M%S)"
call POST "/admin/promotions/vouchers" \
  "{\"name\":\"$VOUCHER_NAME\",\"type\":\"entire_order\",\"discount_type\":\"fixed\",\"discount_value\":2000,\"min_spent\":$VOUCHER_MIN,\"usage_limit\":5}" \
  "$AUTH"
expect_2xx "创建优惠券" || exit 1
VOUCHER_ID="$(jqr '.data.id')"
VOUCHER_CODE="$(jqr '.data.codes[0].code')"
if [[ -z "$VOUCHER_CODE" || "$VOUCHER_CODE" == "null" ]]; then bad "券码为空"; exit 1; fi
ok "券 $VOUCHER_ID，码 $VOUCHER_CODE"

call PUT "/store/carts/$CART_ID/voucher-codes" "{\"codes\":[\"$VOUCHER_CODE\"]}"
expect_2xx "购物车应用券码" || exit 1
D1="$(jqr '.data.totals.discount_minor')"
is_int "$D1" || { bad "折扣金额异常：$D1"; exit 1; }
expect_num "券生效增量（d1-d0）" "$((D1 - D0))" "2000"
expect_jq_true "折扣明细含券码 $VOUCHER_CODE（type=voucher）" \
  "[.data.discounts[]? | select(.type==\"voucher\" and .code==\"$VOUCHER_CODE\")] | length == 1"

# ------------------------------------------------------------------ #
# 6. 后台建礼品卡 → 店面输卡码
# ------------------------------------------------------------------ #
sec "6. 后台建礼品卡（余额 ¥50，币种跟随购物车）→ 店面输卡码"
call POST "/admin/promotions/gift-cards" "{\"currency\":\"$CURRENCY\",\"initial_balance\":5000}" "$AUTH"
expect_2xx "创建礼品卡" || exit 1
CARD_ID="$(jqr '.data.id')"
CARD_CODE="$(jqr '.data.code')"
ok "礼品卡 $CARD_ID，码 $CARD_CODE"

call PUT "/store/carts/$CART_ID/gift-card-codes" "{\"codes\":[\"$CARD_CODE\"]}"
expect_2xx "购物车应用礼品卡" || exit 1
D2="$(jqr '.data.totals.discount_minor')"
TOTAL="$(jqr '.data.totals.total_minor')"
SUB2="$(jqr '.data.totals.subtotal_minor')"
SHIP2="$(jqr '.data.totals.shipping_minor')"
is_int "$D2" || { bad "折扣金额异常：$D2"; exit 1; }

# 礼品卡最多抵到「剩余应付为 0」，期望增量取 min(卡余额, 剩余应付)。
REMAIN=$((SUB2 + SHIP2 - D1))
((REMAIN < 0)) && REMAIN=0
EXPECT_GC=$((REMAIN < 5000 ? REMAIN : 5000))
expect_num "礼品卡抵扣增量（d2-d1）" "$((D2 - D1))" "$EXPECT_GC"
expect_jq_true "折扣明细含卡码 $CARD_CODE（type=gift_card）" \
  "[.data.discounts[]? | select(.type==\"gift_card\" and .code==\"$CARD_CODE\")] | length == 1"

sec "7. 资金安全：合计恒等式"
EXPECTED_TOTAL=$((SUB2 + SHIP2 - D2))
if is_int "$TOTAL" && ((TOTAL == EXPECTED_TOTAL)); then
  ok "total($TOTAL) = subtotal($SUB2) + shipping($SHIP2) - discount($D2)"
else
  bad "恒等式不成立：total=$TOTAL，期望 $EXPECTED_TOTAL（subtotal=$SUB2 shipping=$SHIP2 discount=$D2）"
fi
if is_int "$TOTAL" && ((TOTAL >= 0)); then
  ok "合计非负（$TOTAL）"
else
  bad "合计为负（$TOTAL），存在倒找钱风险"
fi

# ------------------------------------------------------------------ #
# 8. 下单
# ------------------------------------------------------------------ #
if ((RATE_WAIT > 0)); then
  printf '\n  等待 %s 秒让下单限流窗口重置…\n' "$RATE_WAIT"
  sleep "$RATE_WAIT"
fi

sec "8. 下单（幂等键）"
# 下单要求购物车已有收货国家（ADR-019：运费与税都按国家自动算）
curl -s -o /dev/null -X PUT "$BASE/store/carts/$CART_ID/address" \
  -H 'Content-Type: application/json' -d '{"country":"CN"}'

OUT="$(curlsec "8. 下单（幂等键）"
OUT="$(curl -s -S -w $'\n%{http_code}' -X POST "$BASE/store/carts/$CART_ID/complete" \
  -H 'Content-Type: application/json' -H "Idempotency-Key: promo-e2e-$(date +%s)" -d '{}' 2>&1)"
CODE="${OUT##*$'\n'}"
BODY="${OUT%$'\n'*}"
expect_2xx "结账下单" || exit 1
ORDER_ID="$(jqr '.data.id')"
ORD_DISC="$(jqr '.data.discount_minor')"
ok "订单 $ORDER_ID"
expect_num "订单折扣 = 购物车折扣" "$ORD_DISC" "$D2"

# ------------------------------------------------------------------ #
# 9. 后台订单详情：折扣留痕（order_discount）
# ------------------------------------------------------------------ #
sec "9. 后台订单详情：折扣留痕可追溯"
call GET "/admin/orders/$ORDER_ID" "" "$AUTH"
expect_2xx "查询后台订单详情" || exit 1
expect_jq_true "留痕含本次订单促销（promotion_id=$PROMO_ID）" \
  "[.data.discounts[]? | select(.type==\"order\" and .promotion_id==\"$PROMO_ID\")] | length == 1"
expect_jq_true "留痕含券码 $VOUCHER_CODE" \
  "[.data.discounts[]? | select(.type==\"voucher\" and .code==\"$VOUCHER_CODE\")] | length == 1"
expect_jq_true "留痕含卡码 $CARD_CODE" \
  "[.data.discounts[]? | select(.type==\"gift_card\" and .code==\"$CARD_CODE\")] | length == 1"
TRACE_SUM="$(printf '%s' "$BODY" | jq '[.data.discounts[]?.amount_minor] | add // 0' 2>/dev/null)"
expect_num "留痕金额合计 = 订单折扣" "$TRACE_SUM" "$D2"

# ------------------------------------------------------------------ #
# 10. 后台复核：券已核销 / 卡已扣减
# ------------------------------------------------------------------ #
sec "10. 后台复核：券 used +1 / 卡余额扣减"
call GET "/admin/promotions/vouchers/$VOUCHER_ID" "" "$AUTH"
expect_2xx "查询券详情" || exit 1
USED="$(printf '%s' "$BODY" | jq -r --arg c "$VOUCHER_CODE" '.data.codes[]? | select(.code==$c) | .used' 2>/dev/null)"
expect_num "券码 $VOUCHER_CODE 已用次数" "$USED" "1"

call GET "/admin/promotions/gift-cards/$CARD_ID" "" "$AUTH"
expect_2xx "查询礼品卡详情" || exit 1
BAL="$(jqr '.data.current_balance')"
expect_num "礼品卡余额" "$BAL" "$((5000 - EXPECT_GC))"

call GET "/admin/promotions/gift-cards/$CARD_ID/events" "" "$AUTH"
expect_2xx "查询礼品卡流水" || exit 1
expect_jq_true "流水含 used_in_order（金额 -$EXPECT_GC）" \
  "[.data.items[]? | select(.type==\"used_in_order\" and .amount==-$EXPECT_GC)] | length == 1"

# ------------------------------------------------------------------ #
# 汇总
# ------------------------------------------------------------------ #
printf '\n================= 促销端到端验收汇总 =================\n'
printf '通过 %d 项，失败 %d 项，跳过 %d 项\n' "$PASS" "$FAIL" "$SKIP"
printf '测试数据：促销 %s（已停用）、券 %s（已停用）、礼品卡 %s（余额已扣）\n' \
  "${PROMO_ID:-无}" "${VOUCHER_CODE:-无}" "${CARD_CODE:-无}"
printf '提示：订单 %s 与上述记录保留可审计，不做物理删除；促销/券已停用，不会再命中新订单。\n' "${ORDER_ID:-无}"

if ((FAIL > 0)); then exit 1; fi
exit 0
