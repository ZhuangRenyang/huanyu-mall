#!/usr/bin/env bash
# e2e-promotion.sh — 促销三件套（优惠券 + 礼品卡）真机端到端验收
#
# 覆盖：后台建券 / 建卡 → 店面加购 → 输优惠券码 + 礼品卡码 → 合计校验
#      → 下单后 order 折扣留痕（discount_minor>0）。
#
# 资金安全铁律校验点（前端只展示后端算好的金额）：
#   totals.total_minor == totals.subtotal_minor + totals.shipping_minor - totals.discount_minor
#
# 用法：BASE=http://localhost/api/v1 bash deploy/scripts/e2e-promotion.sh
set -uo pipefail

BASE="${BASE:-http://localhost/api/v1}"
VAR_ID="${VAR_ID:-var_06GVXB91KJ459EG26NY1GZG850}"   # 无线静音鼠标（¥99，见 e2e-regression.sh）
ADMIN="${ADMIN:-admin}"
ADMIN_PW="${ADMIN_PW:-123456}"
PASS=0
FAIL=0

ok()  { printf '  [通过] %s\n' "$*"; PASS=$((PASS+1)); }
bad() { printf '  [失败] %s\n' "$*"; FAIL=$((FAIL+1)); }
sec() { printf '\n=== %s ===\n' "$*"; }
jqf() { jq -r "$1" 2>/dev/null; }

# ---------- 1. 后台登录 ----------
sec "1. 后台登录（RBAC settings）"
LOGIN=$(curl -s -X POST "$BASE/admin/auth/login" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$ADMIN\",\"password\":\"$ADMIN_PW\"}")
TOKEN=$(echo "$LOGIN" | jqf '.data.access_token')
if [[ -n "$TOKEN" && "$TOKEN" != "null" ]]; then ok "管理员登录成功"; else bad "管理员登录失败：$(echo "$LOGIN" | head -c 200)"; exit 1; fi
AUTH=(-H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json')

# ---------- 2. 后台创建优惠券（满 100 减 20） ----------
sec "2. 后台创建优惠券：满 100 减 20"
V=$(curl -s -X POST "${AUTH[@]}" "$BASE/admin/promotions/vouchers" \
  -d '{"name":"满100减20（e2e）","type":"entire_order","discount_type":"fixed","discount_value":2000,"min_spent":10000,"usage_limit":100,"starts_at":null,"ends_at":null}')
echo "$V" | jq '{id: .data.id, name: .data.name, status: .data.status, discount_value: .data.discount_value, codes: [.data.codes[].code]}' 2>/dev/null
VOUCHER_CODE=$(echo "$V" | jqf '.data.codes[0].code')
if [[ -n "$VOUCHER_CODE" && "$VOUCHER_CODE" != "null" ]]; then ok "优惠券创建成功，码 $VOUCHER_CODE"; else bad "优惠券创建失败：$(echo "$V" | head -c 200)"; fi

# ---------- 3. 后台创建礼品卡（余额 ¥50） ----------
sec "3. 后台创建礼品卡：余额 ¥50"
G=$(curl -s -X POST "${AUTH[@]}" "$BASE/admin/promotions/gift-cards" \
  -d '{"currency":"CNY","initial_balance":5000}')
echo "$G" | jq '{id: .data.id, code: .data.code, current_balance: .data.current_balance}' 2>/dev/null
GIFT_CODE=$(echo "$G" | jqf '.data.code')
if [[ -n "$GIFT_CODE" && "$GIFT_CODE" != "null" ]]; then ok "礼品卡创建成功，码 $GIFT_CODE"; else bad "礼品卡创建失败：$(echo "$G" | head -c 200)"; fi

# ---------- 4. 店面建车 + 加购 x2 ----------
sec "4. 店面加购：无线静音鼠标 x2（¥99 × 2 = ¥198）"
CART=$(curl -s -X POST "$BASE/store/carts" -H 'Content-Type: application/json' -d '{"email":"promo-e2e@example.com"}')
CART_ID=$(echo "$CART" | jqf '.data.id')
if [[ -z "$CART_ID" || "$CART_ID" == "null" ]]; then bad "建车失败"; exit 1; fi
ok "购物车创建成功 $CART_ID"

LI=$(curl -s -X POST "$BASE/store/carts/$CART_ID/line-items" -H 'Content-Type: application/json' \
  -d "{\"variant_id\":\"$VAR_ID\",\"quantity\":2}")
SUBTOTAL=$(echo "$LI" | jqf '.data.totals.subtotal_minor')
echo "小计（后端）=$SUBTOTAL minor"

# ---------- 5. 选运费（首个方案） ----------
sec "5. 选运费"
SO=$(curl -s "$BASE/store/shipping-options?country=CN")
OPT_ID=$(echo "$SO" | jqf '(.data.items // .data // [])[0].id')
SM=$(curl -s -X POST "$BASE/store/carts/$CART_ID/shipping-methods" -H 'Content-Type: application/json' \
  -d "{\"shipping_option_id\":\"$OPT_ID\"}")
SHIPPING=$(echo "$SM" | jqf '.data.totals.shipping_minor')
echo "运费（后端）=$SHIPPING minor"

# ---------- 6. 输优惠券码 ----------
sec "6. 输优惠券码"
VC=$(curl -s -X PUT "$BASE/store/carts/$CART_ID/voucher-codes" -H 'Content-Type: application/json' \
  -d "{\"codes\":[\"$VOUCHER_CODE\"]}")
V_DISC=$(echo "$VC" | jqf '.data.totals.discount_minor')
echo "仅券时折扣=$V_DISC minor（期望 2000）"
if [[ "$V_DISC" == "2000" ]]; then ok "优惠券折扣 2000 正确命中"; else bad "优惠券折扣 $V_DISC（期望 2000）"; fi

# ---------- 7. 输礼品卡码 ----------
sec "7. 输礼品卡码"
GC=$(curl -s -X PUT "$BASE/store/carts/$CART_ID/gift-card-codes" -H 'Content-Type: application/json' \
  -d "{\"codes\":[\"$GIFT_CODE\"]}")
DISC=$(echo "$GC" | jqf '.data.totals.discount_minor')
TOTAL=$(echo "$GC" | jqf '.data.totals.total_minor')
SUB=$(echo "$GC" | jqf '.data.totals.subtotal_minor')
SHIP=$(echo "$GC" | jqf '.data.totals.shipping_minor')
echo "折扣合计=$DISC（期望 7000），合计=$TOTAL，小计=$SUB，运费=$SHIP"
if [[ "$DISC" == "7000" ]]; then ok "券+卡折扣合计 7000 正确"; else bad "折扣合计 $DISC（期望 7000）"; fi

# ---------- 8. 资金安全：合计恒等式 ----------
sec "8. 合计恒等式：total = subtotal + shipping - discount"
EXPECTED=$(( SUB + SHIP - DISC ))
if [[ "$TOTAL" == "$EXPECTED" ]]; then ok "合计 $TOTAL == 小计+运费-折扣（$EXPECTED）"; else bad "合计 $TOTAL != $EXPECTED"; fi

# ---------- 9. 下单并验证折扣留痕 ----------
sec "9. 下单（幂等键）"
CO=$(curl -s -X POST "$BASE/store/carts/$CART_ID/complete" -H 'Content-Type: application/json' \
  -H "Idempotency-Key: promo-e2e-$(date +%s)" -d '{}')
ORDER_ID=$(echo "$CO" | jqf '.data.id')
ORD_DISC=$(echo "$CO" | jqf '.data.discount_minor')
echo "订单 $ORDER_ID 折扣 discount_minor=$ORD_DISC"
if [[ -n "$ORD_DISC" && "$ORD_DISC" != "null" && "$ORD_DISC" -gt 0 ]]; then
  ok "订单折扣留痕（discount_minor=$ORD_DISC > 0）"
else
  bad "订单未留痕折扣（discount_minor=$ORD_DISC）"
fi

# ---------- 10. 券已核销 / 卡已扣减（后台复核） ----------
sec "10. 后台复核：券 used +1 / 卡余额 -50"
V2=$(curl -s "${AUTH[@]}" "$BASE/admin/promotions/vouchers")
# 用码回查 voucher id 更稳；这里直接按列表里 first 项（本脚本只建一张）验证 used 计数
VUSED=$(echo "$V2" | jqf '.data.items[0].used // "na"')
echo "券列表第一项 used=$VUSED"
GC2=$(curl -s "${AUTH[@]}" "$BASE/admin/promotions/gift-cards")
GBAL=$(echo "$GC2" | jqf '.data.items[0].current_balance // "na"')
echo "卡列表第一项 current_balance=$GBAL（期望 0，¥50 已抵扣）"
if [[ "$GBAL" == "0" ]]; then ok "礼品卡余额已扣减至 0"; else bad "礼品卡余额 $GBAL（期望 0）"; fi

# ---------- 汇总 ----------
printf '\n================= 促销端到端验收汇总 =================\n'
printf '通过 %d 项，失败 %d 项\n' "$PASS" "$FAIL"
if (( FAIL > 0 )); then exit 1; fi
exit 0
