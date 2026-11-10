#!/usr/bin/env bash
# verify-paypal-real.sh — PayPal 真实联调验证（在部署机上跑）
#
# 做三件事：
#   1. 走完整下单流程（建车 → 加购 → 运费 → 结账）
#   2. 用 pp_paypal 建支付会话 —— 这一步会**真实调用 PayPal 沙箱 API**
#   3. 打印拿到的 PayPal 跳转链接，并给出「人工完成付款」的后续指令
#
# 前置：pp_paypal 的 clientId / clientSecret / webhookId / mode 已通过
#       管理后台「支付方式」写入（存在数据库，加密落库），不是 env。
#
# 用法：bash deploy/scripts/verify-paypal-real.sh [BASE_URL]
set -uo pipefail

BASE="${1:-http://localhost/api/v1}"
# 要联调的支付商：pp_paypal（默认）/ pp_alipay 等
PROVIDER="${PROVIDER:-pp_paypal}"
PASS=0
FAIL=0
ok()  { printf '  [通过] %s\n' "$*"; PASS=$((PASS+1)); }
bad() { printf '  [失败] %s\n' "$*"; FAIL=$((FAIL+1)); }

printf '\n=== 1. 确认 pp_paypal 已启用 ===\n'
PROVIDERS=$(curl -s "$BASE/store/payment-providers")
ENABLED=$(printf '%s' "$PROVIDERS" | jq -r --arg p "$PROVIDER" '[.data.items[]? | select(.provider_id==$p)] | length')
if [[ "$ENABLED" == "1" ]]; then
  ok "$PROVIDER 在当前 channel 可用"
else
  bad "$PROVIDER 未启用（当前可用: $(printf '%s' "$PROVIDERS" | jq -c '[.data.items[]?.provider_id]')）"
  printf '  说明：Provider 只对 enabled_channels 里的渠道生效，请先在后台「支付方式」勾选渠道\n'
  exit 1
fi

printf '\n=== 2. 走完整下单流程 ===\n'
HANDLE=$(curl -s "$BASE/store/products?channel=cn" | jq -r '.data.items[0].handle // empty')
if [[ -z "$HANDLE" ]]; then bad "取不到商品"; exit 1; fi
VARIANT=$(curl -s "$BASE/store/products/$HANDLE" | jq -r '.data.variants[0].id')
CART=$(curl -s -X POST "$BASE/store/carts" -H 'Content-Type: application/json' \
  -d '{"email":"paypal-verify@example.com"}' | jq -r '.data.id')
ok "购物车 $CART"

curl -s -o /dev/null -X POST "$BASE/store/carts/$CART/line-items" -H 'Content-Type: application/json' \
  -d "{\"variant_id\":\"$VARIANT\",\"quantity\":1}"

OPTION=$(curl -s "$BASE/store/shipping-options?country=CN" | jq -r '(.data.items // .data)[0].id')
curl -s -o /dev/null -X POST "$BASE/store/carts/$CART/shipping-methods" -H 'Content-Type: application/json' \
  -d "{\"shipping_option_id\":\"$OPTION\"}"

ORDER_JSON=$(curl -s -X POST "$BASE/store/carts/$CART/complete" -H 'Content-Type: application/json' \
  -H "Idempotency-Key: ppv-$(date +%s)" -d '{}')
ORDER_ID=$(printf '%s' "$ORDER_JSON" | jq -r '.data.id // empty')
TOTAL=$(printf '%s' "$ORDER_JSON" | jq -r '.data.total_minor // empty')
CURRENCY=$(printf '%s' "$ORDER_JSON" | jq -r '.data.currency_code // empty')
if [[ -n "$ORDER_ID" ]]; then
  ok "订单 $ORDER_ID  金额 ${TOTAL}（最小单位）$CURRENCY"
else
  bad "结账失败: $(printf '%s' "$ORDER_JSON" | head -c 200)"; exit 1
fi

printf '\n=== 3. 用 pp_paypal 建支付会话（真实调用 PayPal API）===\n'
PS_JSON=$(curl -s -X POST "$BASE/store/payment-sessions" -H 'Content-Type: application/json' \
  -d "{\"cart_id\":\"$CART\",\"provider_id\":\"$PROVIDER\"}")
printf '%s' "$PS_JSON" | jq -c '.data | {id, provider_id, status, amount_minor, currency_code, kind: .context.kind, redirectUrl: .context.redirectUrl}'

CODE=$(printf '%s' "$PS_JSON" | jq -r '.code // -1')
SESSION_ID=$(printf '%s' "$PS_JSON" | jq -r '.data.id // empty')
REDIRECT=$(printf '%s' "$PS_JSON" | jq -r '.data.context.redirectUrl // empty')

if [[ "$CODE" != "0" ]]; then
  bad "建会话失败（code=$CODE）：$(printf '%s' "$PS_JSON" | jq -r '.message // ""')"
  printf '  常见原因：PayPal 账户不支持该币种（本单 %s）；或 clientId/Secret/mode 不匹配\n' "$CURRENCY"
  exit 1
fi

ok "支付会话 $SESSION_ID"
if [[ "$REDIRECT" == https://*.paypal.com/* || "$REDIRECT" == https://*.alipaydev.com/* || "$REDIRECT" == https://*.alipay.com/* ]]; then
  ok "拿到真实 $PROVIDER 跳转链接（说明调用成功，不是仿真）"
  printf '      %s\n' "$REDIRECT"
else
  bad "跳转链接异常：$REDIRECT"
fi

printf '\n=== 下一步：人工完成付款 ===\n'
case "$PROVIDER" in
  pp_alipay)
    cat <<EOF
1. 用**支付宝沙箱买家账号**登录上面那个收银台链接完成付款
   （沙箱买家账号在 https://open.alipay.com/develop/sandbox 里「沙箱账号」页查看，
     是平台自动生成的测试账号，不是你的真实支付宝账号）
2. 付款后支付宝会往 notify_url 发异步通知（form 表单，RSA2 签名）
3. 回到本机查订单状态：
   curl -s "$BASE/store/orders/$ORDER_ID" | jq '.data | {status, payment_status}'
   期望：paid / captured
4. 若订单未自动变 paid，检查：
   - 隧道是否还活着（免费隧道会断，断了要重建并更新 notifyUrl）
   - api 日志：docker compose logs --tail=50 api | grep -i alipay
EOF
    ;;
  *)
    cat <<EOF
1. 用**沙箱买家账号**登录上面那个跳转链接完成付款
   （买家账号在 https://developer.paypal.com/dashboard/accounts 查看，是自动生成的测试账号）
2. 付款后支付商会往已配置的 webhook 发支付成功事件
3. 回到本机查订单状态：
   curl -s "$BASE/store/orders/$ORDER_ID" | jq '.data | {status, payment_status}'
   期望：paid / captured
4. 若订单未自动变 paid，检查：
   - webhook URL 是否公网可达（HTTPS）
   - api 日志：docker compose logs --tail=50 api | grep -i paypal
EOF
    ;;
esac

cat <<EOF

当前订单号：$ORDER_ID
当前会话号：$SESSION_ID
EOF

printf '\n通过 %d 项，失败 %d 项\n' "$PASS" "$FAIL"
(( FAIL > 0 )) && exit 1
exit 0
