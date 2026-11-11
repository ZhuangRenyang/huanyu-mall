#!/usr/bin/env bash
# e2e-notification.sh — 订单邮件通知真机端到端验收（ADR-016）
#
# 覆盖：
#   读设置（默认关闭、密码不回显）→ 配好本地 SMTP 夹具 → 测试发送
#   → 下单并支付 → 收到「下单确认」邮件（状态 sent）
#   → 发货 → 收到「发货通知」邮件（承运商 + 运单号）
#   → 把 SMTP 指向死端口后手动重发 → 状态 failed 且记录可读错误
#   → 退出时恢复原设置、关掉夹具
#
# 设计要点：
#   1. 不依赖外部邮箱：在 api 容器内起一个最小 SMTP 收信端（deploy/scripts/smtp-sink.mjs），
#      断言的是「真的发出了」而不是「接口返回 200」。
#   2. 不覆盖 SMTP 密码：脚本从不发送 smtp_password 字段，只改主机/端口/发件人。
#   3. 退出必恢复：设置改回原值，夹具进程杀掉。可重复执行。
#   4. 需要 curl + jq + docker；只在验收环境跑（会真实下单、真实发信到你自己的夹具）。
#
# 用法：
#   bash deploy/scripts/e2e-notification.sh
#   BASE=... ADMIN=... ADMIN_PW=... PRODUCT_HANDLE=... SMTP_PORT=2525 bash deploy/scripts/e2e-notification.sh
set -uo pipefail

BASE="${BASE:-http://localhost/api/v1}"
ADMIN="${ADMIN:-admin}"
ADMIN_PW="${ADMIN_PW:-123456}"
PRODUCT_HANDLE="${PRODUCT_HANDLE:-wireless-mouse}"
API_CONTAINER="${API_CONTAINER:-deploy-api-1}"
SMTP_PORT="${SMTP_PORT:-2525}"
SMTP_LOG="${SMTP_LOG:-/tmp/smtp-inbox.log}"
# 派发器 5 秒一轮，SMTP 几秒；留足余量
WAIT_SECONDS="${WAIT_SECONDS:-40}"

PASS=0
FAIL=0
SKIP=0
CODE=""
BODY=""
TOKEN=""
CLEANED=0
SINK_STARTED=0
SETTINGS_SAVED=0
O_ENABLED="false"
O_FROM_NAME=""
O_FROM_EMAIL=""
O_HOST=""
O_PORT="587"
O_SECURE="false"
O_USER=""
O_ORDER_CONF="true"
O_SHIPMENT="true"
O_STOREFRONT=""
ORDER_ID=""
CART_ID=""

ok()   { printf '  [通过] %s\n' "$*"; PASS=$((PASS + 1)); }
bad()  { printf '  [失败] %s\n' "$*"; FAIL=$((FAIL + 1)); }
skip() { printf '  [跳过] %s\n' "$*"; SKIP=$((SKIP + 1)); }
sec()  { printf '\n=== %s ===\n' "$*"; }
jqr()  { printf '%s' "$BODY" | jq -r "$1" 2>/dev/null | tr -d '\r'; }
expect_num() {
  local desc="$1" actual="$2" expected="$3"
  if [[ "$actual" == "$expected" ]]; then ok "$desc：$actual"; else bad "$desc：实际 $actual，期望 $expected"; fi
}
expect_2xx() {
  local desc="$1"
  if [[ "$CODE" =~ ^2[0-9][0-9]$ ]]; then ok "$desc（HTTP $CODE）"; return 0; fi
  bad "$desc（HTTP $CODE）：$(printf '%s' "$BODY" | head -c 200)"; return 1
}

call() {
  local method="$1" path="$2" data="${3-}" auth="${4-}"
  local args=(-s -S -w $'\n%{http_code}' -X "$method" "$BASE$path")
  [[ -n "$auth" ]] && args+=(-H "Authorization: Bearer $TOKEN")
  if [[ -n "$data" ]]; then args+=(-H 'Content-Type: application/json' --data-binary "$data"); fi
  local out; out="$(curl "${args[@]}" 2>&1)"
  CODE="${out##*$'\n'}"; BODY="${out%$'\n'*}"
}

cleanup() {
  [[ "$CLEANED" -eq 1 ]] && return 0
  CLEANED=1
  printf '\n=== 收尾 ===\n'
  if [[ "$SINK_STARTED" -eq 1 ]]; then
    docker exec "$API_CONTAINER" sh -lc "pkill -f smtp-sink.mjs" >/dev/null 2>&1 && ok "已停止 SMTP 夹具"
  fi
  if [[ "$SETTINGS_SAVED" -eq 1 ]]; then
    # 只恢复可读字段；密码脚本从未修改，保持原样
    call PUT "/admin/notifications/settings" "{\"enabled\":$O_ENABLED,\"from_name\":\"$O_FROM_NAME\",\"from_email\":\"$O_FROM_EMAIL\",\"smtp_host\":\"$O_HOST\",\"smtp_port\":$O_PORT,\"smtp_secure\":$O_SECURE,\"smtp_user\":\"$O_USER\",\"order_confirmation_enabled\":$O_ORDER_CONF,\"shipment_enabled\":$O_SHIPMENT,\"storefront_url\":\"$O_STOREFRONT\"}" auth >/dev/null 2>&1
    if [[ "$CODE" =~ ^2[0-9][0-9]$ ]]; then ok "设置已恢复原值（enabled=$O_ENABLED）"; else bad "设置恢复失败（HTTP $CODE），请到后台手动检查"; fi
  fi
  printf '\n—— 结果：通过 %s · 失败 %s · 跳过 %s ——\n' "$PASS" "$FAIL" "$SKIP"
  [[ "$FAIL" -eq 0 ]] || exit 1
}
trap cleanup EXIT

sec "0. 登录"
call POST /admin/auth/login "{\"email\":\"$ADMIN\",\"password\":\"$ADMIN_PW\"}"
expect_2xx "管理员登录" || exit 1
TOKEN="$(jqr '.data.access_token')"
AUTH=1

sec "1. 读设置（默认关闭、密码不回显）"
call GET /admin/notifications/settings "" "$AUTH"
expect_2xx "读通知设置" || exit 1
SETTINGS_SAVED=1
O_ENABLED="$(jqr '.data.enabled')"
O_FROM_NAME="$(jqr '.data.from_name')"
O_FROM_EMAIL="$(jqr '.data.from_email')"
O_HOST="$(jqr '.data.smtp_host')"
O_PORT="$(jqr '.data.smtp_port')"
O_SECURE="$(jqr '.data.smtp_secure')"
O_USER="$(jqr '.data.smtp_user')"
O_ORDER_CONF="$(jqr '.data.order_confirmation_enabled')"
O_SHIPMENT="$(jqr '.data.shipment_enabled')"
O_STOREFRONT="$(jqr '.data.storefront_url')"
if [[ "$(printf '%s' "$BODY" | jq 'has("smtp_password")')" == "false" ]]; then
  ok "响应里没有密码字段（只有 smtp_password_set）"
else
  bad "响应泄露了 smtp_password"
fi
if [[ "$O_ENABLED" == "false" ]]; then ok "默认关闭（enabled=false）"; else skip "当前已是开启状态（enabled=$O_ENABLED），非首次安装"; fi

sec "2. 在 api 容器内起 SMTP 夹具"
if ! docker cp deploy/scripts/smtp-sink.mjs "$API_CONTAINER":/tmp/smtp-sink.mjs >/dev/null 2>&1; then
  bad "无法把 smtp-sink.mjs 拷进容器 $API_CONTAINER（容器名不对？用 API_CONTAINER=... 指定）"
  exit 1
fi
docker exec "$API_CONTAINER" sh -lc "pkill -f smtp-sink.mjs; rm -f $SMTP_LOG" >/dev/null 2>&1
docker exec -d "$API_CONTAINER" node /tmp/smtp-sink.mjs "$SMTP_PORT" "$SMTP_LOG"
SINK_STARTED=1
sleep 1
ok "夹具已启动：$API_CONTAINER 内 127.0.0.1:$SMTP_PORT"

sec "3. 配置 SMTP 并测试发送"
call PUT /admin/notifications/settings "{\"enabled\":true,\"from_name\":\"商城验收\",\"from_email\":\"noreply@example.com\",\"smtp_host\":\"127.0.0.1\",\"smtp_port\":$SMTP_PORT,\"smtp_secure\":false,\"smtp_user\":\"\",\"order_confirmation_enabled\":true,\"shipment_enabled\":true,\"storefront_url\":\"\"}" "$AUTH"
expect_2xx "保存 SMTP 配置" || exit 1
call POST /admin/notifications/test '{"to":"e2e-notify@example.com"}' "$AUTH"
expect_2xx "测试发送" || exit 1
sleep 1
RECEIVED="$(docker exec "$API_CONTAINER" sh -lc "wc -l < $SMTP_LOG 2>/dev/null || echo 0" | tr -d '\r ')"
expect_num "夹具收到测试邮件" "$RECEIVED" "1"

sec "4. 下单并支付 → 应收到下单确认邮件"
call GET "/admin/products?limit=100" "" "$AUTH"
PID="$(printf '%s' "$BODY" | jq -r --arg h "$PRODUCT_HANDLE" '.data.items[]? | select(.handle==$h) | .id' 2>/dev/null | tr -d '\r' | head -1)"
[[ -z "$PID" || "$PID" == "null" ]] && { bad "找不到商品 $PRODUCT_HANDLE"; exit 1; }
call GET "/admin/products/$PID" "" "$AUTH"
VAR_ID="$(jqr '.data.variants[0].id')"

# 库存兜底：买 1 件，可用不足则补
SKU="$(jqr '.data.variants[0].sku')"
call GET "/admin/inventory-levels?limit=100" "" "$AUTH"
ROW="$(printf '%s' "$BODY" | jq -c --arg sku "$SKU" '.data.items[]? | select(.sku==$sku)' 2>/dev/null | tr -d '\r' | head -1)"
if [[ -n "$ROW" ]]; then
  LVL_ID="$(printf '%s' "$ROW" | jq -r '.id')"
  AVAIL="$(printf '%s' "$ROW" | jq -r '.available_quantity')"
  if [[ "$AVAIL" =~ ^[0-9]+$ ]] && ((AVAIL < 1)); then
    call PUT "/admin/inventory-levels/$LVL_ID" '{"delta":2,"reason":"e2e 通知验收备货"}' "$AUTH" >/dev/null
    ok "库存补 2 件（可重复执行）"
  fi
fi

call POST /store/carts '{"email":"e2e-notify@example.com"}'
expect_2xx "创建购物车" || exit 1
CART_ID="$(jqr '.data.id')"
call POST "/store/carts/$CART_ID/line-items" "{\"variant_id\":\"$VAR_ID\",\"quantity\":1}"
expect_2xx "加购 1 件" || exit 1

OUT="$(curl -s -S -w $'\n%{http_code}' -X POST "$BASE/store/carts/$CART_ID/complete" \
  -H 'Content-Type: application/json' -H "Idempotency-Key: e2e-notify-$(date +%s)" -d '{}' 2>&1)"
CODE="${OUT##*$'\n'}"; BODY="${OUT%$'\n'*}"
expect_2xx "下单" || exit 1
ORDER_ID="$(jqr '.data.id')"
ok "订单 $ORDER_ID"

# 支付：会话 → 授权 → 扣款
call GET /store/payment-providers
PROVIDER="$(jqr '(.data.items // .data // [])[0].id')"
call POST /store/payment-sessions "{\"cart_id\":\"$CART_ID\",\"provider_id\":\"$PROVIDER\"}"
expect_2xx "创建支付会话" || exit 1
SID="$(jqr '.data.id')"
call POST "/store/payment-sessions/$SID/authorize" '{}'
expect_2xx "支付授权" || exit 1
PAY_ID="$(jqr '.data.id')"
call POST "/store/payments/$PAY_ID/capture" "{\"idempotency_key\":\"e2e-notify-cap-$(date +%s)\"}"
expect_2xx "支付扣款" || exit 1

CONF_STATUS=""
for _ in $(seq 1 "$WAIT_SECONDS"); do
  call GET "/admin/notifications?limit=50" "" "$AUTH"
  CONF_STATUS="$(printf '%s' "$BODY" | jq -r --arg oid "$ORDER_ID" '.data.items[]? | select(.order_id==$oid and .template=="order_confirmation") | .status' 2>/dev/null | tr -d '\r' | head -1)"
  [[ "$CONF_STATUS" == "sent" ]] && break
  sleep 1
done
expect_num "下单确认邮件状态" "${CONF_STATUS:-none}" "sent"
CONF_TO="$(printf '%s' "$BODY" | jq -r --arg oid "$ORDER_ID" '.data.items[]? | select(.order_id==$oid and .template=="order_confirmation") | .to_email' 2>/dev/null | tr -d '\r' | head -1)"
expect_num "收件人" "$CONF_TO" "e2e-notify@example.com"
CONF_SUBJECT="$(printf '%s' "$BODY" | jq -r --arg oid "$ORDER_ID" '.data.items[]? | select(.order_id==$oid and .template=="order_confirmation") | .subject' 2>/dev/null | tr -d '\r' | head -1)"
[[ -n "$CONF_SUBJECT" ]] && ok "主题非空：$CONF_SUBJECT" || bad "主题为空"

sec "5. 发货 → 应收到发货通知"
call GET "/admin/orders/$ORDER_ID/fulfillment-plan" "" "$AUTH"
expect_2xx "取发货计划" || exit 1
PLAN_LOC="$(jqr '.data.plans[0].stock_location_id')"
ITEMS_JSON="$(printf '%s' "$BODY" | jq -c '.data.plans[0].items')"
[[ -z "$PLAN_LOC" || "$PLAN_LOC" == "null" ]] && { bad "发货计划为空"; exit 1; }
call POST "/admin/orders/$ORDER_ID/fulfillments" "{\"items\":$ITEMS_JSON,\"stock_location_id\":\"$PLAN_LOC\"}" "$AUTH"
expect_2xx "建发货单" || exit 1
FUL_ID="$(jqr '.data.id')"
call POST "/admin/fulfillments/$FUL_ID/shipments" "{\"carrier_name\":\"顺丰速运\",\"tracking_number\":\"SF-NOTIFY-$(date +%s)\"}" "$AUTH"
expect_2xx "填运单发货" || exit 1

SHIP_STATUS=""
for _ in $(seq 1 "$WAIT_SECONDS"); do
  call GET "/admin/notifications?limit=50" "" "$AUTH"
  SHIP_STATUS="$(printf '%s' "$BODY" | jq -r --arg oid "$ORDER_ID" '.data.items[]? | select(.order_id==$oid and .template=="shipment_notification") | .status' 2>/dev/null | tr -d '\r' | head -1)"
  [[ "$SHIP_STATUS" == "sent" ]] && break
  sleep 1
done
expect_num "发货通知邮件状态" "${SHIP_STATUS:-none}" "sent"

sec "6. SMTP 不可用时：失败要可见、可读"
call PUT /admin/notifications/settings '{"smtp_host":"127.0.0.1","smtp_port":1}' "$AUTH"
expect_2xx "把 SMTP 指向死端口" || exit 1
call POST "/admin/notifications/test" '{"to":"e2e-notify@example.com"}' "$AUTH"
if [[ "$CODE" =~ ^4[0-9][0-9]$ ]]; then ok "测试发送失败返回 4xx（HTTP $CODE）"; else bad "期望 4xx，实际 HTTP $CODE"; fi
[[ "$(jqr '.message')" != "null" && -n "$(jqr '.message')" ]] && ok "错误信息可读：$(jqr '.message' | head -c 80)" || bad "没有可读错误信息"

call GET "/admin/notifications?limit=50" "" "$AUTH"
CONF_ID="$(printf '%s' "$BODY" | jq -r --arg oid "$ORDER_ID" '.data.items[]? | select(.order_id==$oid and .template=="order_confirmation") | .id' 2>/dev/null | tr -d '\r' | head -1)"
[[ -z "$CONF_ID" || "$CONF_ID" == "null" ]] && { bad "找不到下单确认记录"; exit 1; }
call POST "/admin/notifications/$CONF_ID/resend" '' "$AUTH"
expect_2xx "手动重发" || exit 1
RESEND_STATUS="$(jqr '.data.status')"
expect_num "重发失败后状态" "$RESEND_STATUS" "failed"
[[ -n "$(jqr '.data.error')" && "$(jqr '.data.error')" != "null" ]] && ok "失败原因已记录" || bad "失败原因为空"

sec "7. 鉴权边界"
SAVED_TOKEN="$TOKEN"; TOKEN=""
call GET /admin/notifications "" "" 
[[ "$CODE" == "401" ]] && ok "匿名访问通知列表 → 401" || bad "匿名访问应为 401，实际 $CODE"
TOKEN="$SAVED_TOKEN"

printf '\n—— 结果：通过 %s · 失败 %s · 跳过 %s ——\n' "$PASS" "$FAIL" "$SKIP"
