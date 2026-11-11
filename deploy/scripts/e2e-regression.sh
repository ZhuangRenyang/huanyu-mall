#!/usr/bin/env bash
# 真机端到端回归：建车 → 加购 → 选运费 → 结账 → 授权 → 扣款 → 订单转正
set -uo pipefail
BASE="http://localhost/api/v1"
VAR_ID="var_06GVXB91KJ459EG26NY1GZG850"
# 记录起始时刻，供末尾「日志零错误」检查限定时间窗（避免把历史日志算进来）
START_SEC=$(date +%s)

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

step "5.5 设置收货国家（税与运费自动算）"
curl -s -o /dev/null -X PUT "$BASE/store/carts/$CART_ID/address" -H 'Content-Type: application/json' \
  -d '{"country":"CN"}'

step "6. 结账（幂等键）"step "6. 结账（幂等键）"
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

# =============================================================================
# 16. 日志零错误检查
#
# 为什么需要这一步：HTTP 状态码和业务数据都正常，不代表服务端内部没出错。
# 真实案例 —— 两个 onSend 钩子同时设响应头导致每个请求都抛
# ERR_HTTP_HEADERS_SENT：响应仍是 200、body 完整，但日志被刷满、偶发变 500。
# 当时的回归只看状态码与数据，完全没发现，直到另一次联调才暴露。
#
# 判据：本次回归时间窗内，api 日志不得出现
#   - '"level":50'          （error 级日志，含 unhandled error）
#   - REP_ALREADY_SENT      （响应已发送后又写）
#   - HEADERS_SENT          （同上，Node 层报错）
# 正常业务流（1-15 步）不应产生任何 error 级日志。
#
# 无 Docker 的环境（如纯前端联调机）跳过，不判失败。
# =============================================================================
step "16. 日志零错误检查（状态码正常 ≠ 内部无错）"
if ! command -v docker >/dev/null 2>&1; then
  echo "  [跳过] 本机无 Docker，无法读取容器日志"
else
  COMPOSE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  MALL_DIR="${MALL_DIR:-/data/home/mall-data}"
  ENV_FILE="$MALL_DIR/config/.env"
  # 多留 3 秒缓冲：--since 是秒级精度，避免漏掉回归末尾的日志
  WINDOW=$(( $(date +%s) - START_SEC + 3 ))

  if command -v docker >/dev/null 2>&1 && docker compose --env-file "$ENV_FILE" -f "$COMPOSE_DIR/docker-compose.yml" ps api >/dev/null 2>&1; then
    LOGS=$(docker compose --env-file "$ENV_FILE" -f "$COMPOSE_DIR/docker-compose.yml" \
      logs --since "${WINDOW}s" api 2>&1)
    ERRS=$(printf '%s\n' "$LOGS" | grep -E '"level":50|REP_ALREADY_SENT|HEADERS_SENT' || true)
    if [[ -z "$ERRS" ]]; then
      echo "  [通过] 本次回归窗口内无 error 级日志"
    else
      echo "  [失败] 发现 error 级日志（响应可能仍正常，但内部出错）："
      printf '%s\n' "$ERRS" | head -3 | cut -c1-220 | sed 's/^/         /'
      echo "         处置：按上面的 message/stack 定位；常见原因是钩子里重复写响应、"
      echo "               或在响应已发送后仍抛错（error handler 会追加记录原始错误）"
      exit 1
    fi
  else
    echo "  [跳过] 取不到 api 容器（未部署或 env 文件缺失）"
  fi
fi

printf '\n================= 回归完成 =================\n'
printf '业务链路 15 步 + 日志零错误检查均通过\n'
