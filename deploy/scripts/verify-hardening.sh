#!/usr/bin/env bash
# verify-hardening.sh — Phase 4 生产化加固真机验收（限流 / 审计 / 安全头 / 请求体限制）
#
# 全部用真实请求触发，不看配置不看日志，只看实际响应。
# 用法: bash deploy/scripts/verify-hardening.sh [--base http://localhost/api/v1]
set -uo pipefail

BASE="${2:-http://localhost/api/v1}"
PASS=0
FAIL=0

ok()   { printf '  [通过] %s\n' "$*"; PASS=$((PASS+1)); }
bad()  { printf '  [失败] %s\n' "$*"; FAIL=$((FAIL+1)); }
head2() { printf '\n=== %s ===\n' "$*"; }

# ---------- 1. 安全响应头 ----------
head2 "1. 安全响应头"
HEADERS=$(curl -s -D - -o /dev/null "$BASE/health")
for h in "x-content-type-options: nosniff" "x-frame-options: DENY" "referrer-policy:" "content-security-policy:" "x-permitted-cross-domain-policies: none"; do
  if echo "$HEADERS" | grep -qi "$h"; then ok "$h"; else bad "$h 缺失"; fi
done
# HSTS 默认不应下发（一期默认 HTTP）
if echo "$HEADERS" | grep -qi "strict-transport-security"; then
  bad "HTTP 响应不应带 HSTS（HTTPS_ENABLED 未开启时不得下发）"
else
  ok "HTTP 响应未带 HSTS（符合 HTTPS_ENABLED=false 预期）"
fi

# ---------- 2. 请求体超限返回 413 ----------
head2 "2. 请求体限制"
# payload 必须走文件传（1MB+ 走命令行参数会 Argument list too long）
# 端点用 store/carts（default 宽松档）：auth 档桶正被限流测试用，且 bodyLimit 在 onRequest 之后判定，
# 用登录类端点会先撞限流拿不到 413。
python3 -c "import sys; sys.stdout.write('{\"email\":\"a@b.com\",\"password\":\"Passw0rd!\",\"pad\":\"' + 'a'*1200000 + '\"}')" > /tmp/vh_big.json
CODE=$(curl -s -o /tmp/vh_body.json -w '%{http_code}' -X POST "$BASE/store/carts" \
  -H 'Content-Type: application/json' --data-binary @/tmp/vh_big.json)
if [[ "$CODE" == "413" ]]; then ok "超 1MB 请求体 → 413"; else bad "超限请求体返回 $CODE（期望 413）"; fi
if grep -q "requestId" /tmp/vh_body.json 2>/dev/null; then ok "413 响应含统一信封 requestId"; else bad "413 响应不是统一信封"; fi

# ---------- 3. 审计留痕（用真实下单触发） ----------
head2 "3. 审计日志"
VAR_ID=$(curl -s "$BASE/store/products?channel=cn" | jq -r '.data.items[0].id' 2>/dev/null)
if [[ -z "$VAR_ID" || "$VAR_ID" == "null" ]]; then
  bad "取不到商品（无法触发下单写操作）"
else
  PRODUCT=$(curl -s "$BASE/store/products?channel=cn" | jq -r '.data.items[0].handle' 2>/dev/null)
  VARIANT=$(curl -s "$BASE/store/products/$PRODUCT" | jq -r '.data.variants[0].id' 2>/dev/null)
  OPT=$(curl -s "$BASE/store/shipping-options?country=CN" | jq -r '(.data.items // .data // [])[0].id' 2>/dev/null)
  CART=$(curl -s -X POST "$BASE/store/carts" -H 'Content-Type: application/json' \
    -d '{"email":"audit-verify@example.com"}' | jq -r '.data.id' 2>/dev/null)
  curl -s -o /dev/null -X POST "$BASE/store/carts/$CART/line-items" -H 'Content-Type: application/json' \
    -d "{\"variant_id\":\"$VARIANT\",\"quantity\":1}"
  curl -s -o /dev/null -X POST "$BASE/store/carts/$CART/shipping-methods" -H 'Content-Type: application/json' \
    -d "{\"shipping_option_id\":\"$OPT\"}"
  ORDER=$(curl -s -X POST "$BASE/store/carts/$CART/complete" -H 'Content-Type: application/json' \
    -H "Idempotency-Key: audit-verify-$(date +%s)" -d '{}' | jq -r '.data.id' 2>/dev/null)
  if [[ -n "$ORDER" && "$ORDER" != "null" ]]; then ok "下单成功触发写操作：$ORDER"; else bad "下单失败，无法验证审计"; fi

  TOKEN=$(curl -s -X POST "$BASE/admin/auth/login" -H 'Content-Type: application/json' \
    -d '{"email":"admin","password":"123456"}' | jq -r '.data.access_token' 2>/dev/null)
  if [[ -z "$TOKEN" || "$TOKEN" == "null" ]]; then
    bad "后台登录失败（后续审计查询无法进行）"
  else
    ok "后台登录成功"
    AUD=$(curl -s -H "Authorization: Bearer $TOKEN" "$BASE/admin/audit-logs?action=order.create&limit=5")
    CNT=$(echo "$AUD" | jq -r '.data.items | length' 2>/dev/null)
    if [[ "$CNT" != "0" && "$CNT" != "null" ]]; then
      ok "审计查询按 action=order.create 命中 $CNT 条"
      echo "$AUD" | jq -c '.data.items[0] | {action, entity_type, entity_id, actor_type, ip, has_before: (.before != null), has_after: (.after != null)}' 2>/dev/null
    else
      bad "审计表查不到 order.create 记录（查询返回：$(echo "$AUD" | head -c 160)）"
    fi
    # 审计表必须不含密码类字段
    LEAK=$(echo "$AUD" | grep -ciE 'password|secret|token' || true)
    if [[ "$LEAK" == "0" ]]; then ok "审计内容未泄漏 password/secret/token"; else bad "审计内容疑似泄漏敏感字段（命中 $LEAK 处）"; fi
    # 匿名访问应被拒
    ANON=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/admin/audit-logs")
    if [[ "$ANON" == "401" ]]; then ok "匿名访问审计端点被拒 401"; else bad "匿名访问审计端点返回 $ANON（期望 401）"; fi
  fi
fi

# ---------- 4. 限流（最后做，避免污染前面的登录） ----------
head2 "4. 限流防刷（auth 档：5 次/分钟/IP）"
# 主动打满再验证：这样无论上一轮是否已触发限流，行为都确定（脚本可重复执行）
CODES=""
TRIGGERED_AT=0
for i in $(seq 1 12); do
  C=$(curl -s -o /tmp/vh_rl.json -w '%{http_code}' -X POST "$BASE/admin/auth/login" \
    -H 'Content-Type: application/json' -d '{"email":"admin","password":"wrong-pass"}')
  CODES="$CODES $C"
  if [[ "$C" == "429" && "$TRIGGERED_AT" == "0" ]]; then TRIGGERED_AT="$i"; fi
  if [[ "$TRIGGERED_AT" != "0" && "$i" -gt "$TRIGGERED_AT" ]]; then break; fi
done
echo "  登录尝试的 HTTP 状态：$CODES"
if [[ "$TRIGGERED_AT" != "0" ]]; then
  ok "第 $TRIGGERED_AT 次尝试触发限流 429（阈值 5 次/分钟/IP）"
  if grep -q "requestId" /tmp/vh_rl.json; then ok "429 响应含统一信封 requestId"; else bad "429 响应不是统一信封"; fi
  MSG=$(jq -r '.message' /tmp/vh_rl.json 2>/dev/null)
  CODE_NO=$(jq -r '.code' /tmp/vh_rl.json 2>/dev/null)
  if [[ "$CODE_NO" == "60001" ]]; then ok "错误码 60001（rateLimited）"; else bad "错误码为 $CODE_NO（期望 60001）"; fi
  if [[ -n "$MSG" && "$MSG" != "null" ]]; then ok "提示文案：$MSG"; else bad "429 缺少提示文案"; fi
else
  bad "12 次登录未触发限流（状态：$CODES）"
fi
# 健康检查应被豁免
HC=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/health")
if [[ "$HC" == "200" ]]; then ok "健康检查在限流状态下仍可用（已豁免）"; else bad "健康检查被限流误伤：$HC"; fi

# ---------- 汇总 ----------
printf '\n================= 加固验收汇总 =================\n'
printf '通过 %d 项，失败 %d 项\n' "$PASS" "$FAIL"
if (( FAIL > 0 )); then
  printf '结论: 存在未通过项\n'
  exit 1
fi
printf '结论: 全部通过\n'
exit 0
