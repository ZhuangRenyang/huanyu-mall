#!/usr/bin/env bash
# 真机端到端回归：建车 → 加购 → 选运费 → 结账 → 授权 → 扣款 → 订单转正
set -uo pipefail
BASE="http://localhost/api/v1"
VAR_ID="var_06GVXB91KJ459EG26NY1GZG850"

step() { printf '\n=== %s ===\n' "$*"; }
jqf() { jq -r "$1" 2>/dev/null; }

step "1. 运费方案"
SO=$(curl -s "$BASE/store/shipping-options?country=CN")
echo "$SO" | head -c 300
OPT_ID=$(echo "$SO" | jqf '(.data.items // .data // [])[0].id')
echo "OPT_ID=$OPT_ID"

step "2. 支付商"
PP=$(curl -s "$BASE/store/payment-providers")
echo "$PP" | head -c 300
PROVIDER=$(echo "$PP" | jqf '(.data.items // .data // [])[0].id')
echo "PROVIDER=$PROVIDER"

step "3. 建购物车"
CART=$(curl -s -X POST "$BASE/store/carts" -H 'Content-Type: application/json' \
  -d '{"email":"regress@example.com"}')
echo "$CART" | head -c 300
CART_ID=$(echo "$CART" | jqf '.data.id')
echo "CART_ID=$CART_ID"

step "4. 加购 x2（单价 9900）"
LI=$(curl -s -X POST "$BASE/store/carts/$CART_ID/line-items" -H 'Content-Type: application/json' \
  -d "{\"variant_id\":\"$VAR_ID\",\"quantity\":2}")
echo "$LI" | head -c 400

step "5. 选运费"
SM=$(curl -s -X POST "$BASE/store/carts/$CART_ID/shipping-methods" -H 'Content-Type: application/json' \
  -d "{\"shipping_option_id\":\"$OPT_ID\"}")
echo "$SM" | head -c 400

step "6. 结账（幂等键）"
CO=$(curl -s -X POST "$BASE/store/carts/$CART_ID/complete" -H 'Content-Type: application/json' \
  -H "Idempotency-Key: regress-$(date +%s)" -d '{}')
echo "$CO" | head -c 500
ORDER_ID=$(echo "$CO" | jqf '.data.id')
echo "ORDER_ID=$ORDER_ID"

step "7. 创建支付会话"
PS=$(curl -s -X POST "$BASE/store/payment-sessions" -H 'Content-Type: application/json' \
  -d "{\"cart_id\":\"$CART_ID\",\"provider_id\":\"$PROVIDER\"}")
echo "$PS" | head -c 400
SESSION_ID=$(echo "$PS" | jqf '.data.id')
echo "SESSION_ID=$SESSION_ID"

step "8. 授权"
AU=$(curl -s -X POST "$BASE/store/payment-sessions/$SESSION_ID/authorize" -H 'Content-Type: application/json' -d '{}')
echo "$AU" | head -c 400
PAYMENT_ID=$(echo "$AU" | jqf '.data.id')
echo "PAYMENT_ID=$PAYMENT_ID"

step "9. 扣款"
CAP=$(curl -s -X POST "$BASE/store/payments/$PAYMENT_ID/capture" -H 'Content-Type: application/json' \
  -d "{\"idempotency_key\":\"cap-$(date +%s)\"}")
echo "$CAP" | head -c 400

step "10. 订单状态（应为 paid / captured）"
curl -s "$BASE/store/orders/$ORDER_ID" | head -c 600
echo

step "11. 库存（预留 2，现货 98）"
curl -s "$BASE/store/products/wireless-mouse" | jq '.data.variants[0] | {available_quantity, inventory_status}'

step "12. 后台登录（默认账号 admin / 123456）"
TOKEN=$(curl -s -X POST "$BASE/admin/auth/login" -H 'Content-Type: application/json' \
  -d '{"email":"admin","password":"123456"}' | jq -r '.data.access_token')
if [[ -z "$TOKEN" || "$TOKEN" == "null" ]]; then
  echo "!! 后台登录失败" >&2
  exit 1
fi
echo "TOKEN=${TOKEN:0:20}..."

step "13. 建发货单（自动关联预留）"
LI_ID=$(curl -s -H "Authorization: Bearer $TOKEN" "$BASE/admin/orders/$ORDER_ID" \
  | jq -r '.data.line_items[0].id')
FU=$(curl -s -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"items\":[{\"order_line_item_id\":\"$LI_ID\",\"quantity\":2}]}" \
  "$BASE/admin/orders/$ORDER_ID/fulfillments")
echo "$FU" | jq '{id: .data.id, status: .data.status, reservation_ids: .data.reservation_ids}'
FULF_ID=$(echo "$FU" | jq -r '.data.id')

step "14. 发货（承运商 + 单号）"
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"carrier_name":"顺丰速运","tracking_number":"SF1234567890"}' \
  "$BASE/admin/fulfillments/$FULF_ID/shipments" | jq '{id: .data.id, carrier: .data.carrier_name, tracking: .data.tracking_number}'

step "15. 订单终态"
curl -s "$BASE/store/orders/$ORDER_ID" | jq '.data | {id, status, payment_status, total_minor}'
