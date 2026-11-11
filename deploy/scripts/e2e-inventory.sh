#!/usr/bin/env bash
# e2e-inventory.sh — 二期多仓真机端到端验收（ADR-013，单仓满足策略）
#
# 覆盖：
#   建第二个仓 → 主仓只留 1 件 → 下单 2 件（主仓不够）
#   → 整单从备用仓预留（**不拆单**）→ 自动单仓发货
#   → 两仓各只剩 1 件时下单 2 件必须被拒（没有单仓能整单满足）
#   → 调拨护栏（可用量不足被拒）
#   → 并发抢库存（10 单各要 3 件、库存 10，只能成功 3 单）
#
# 设计要点：
#   1. 断言用「库存差值」而不是写死数量：脚本可重复执行。
#   2. 单仓满足：任何时刻一单最多一条预留、一张发货单。
#   3. 退出时取消未完成调拨、把测试仓库存调回主仓、优先级置 0
#      （仓库无删除接口，故保留空仓）。
#   4. 需要 curl + jq；会真实下单，只在验收环境跑。
#
# 用法：
#   bash deploy/scripts/e2e-inventory.sh
#   BASE=... ADMIN=... ADMIN_PW=... PRODUCT_HANDLE=... bash deploy/scripts/e2e-inventory.sh
set -uo pipefail

BASE="${BASE:-http://localhost/api/v1}"
ADMIN="${ADMIN:-admin}"
ADMIN_PW="${ADMIN_PW:-123456}"
PRODUCT_HANDLE="${PRODUCT_HANDLE:-wireless-mouse}"
CONCURRENCY="${CONCURRENCY:-10}"
CONC_QTY="${CONC_QTY:-3}"
# 下单限流窗口等待秒数（默认 61）。改了 RATE_LIMIT_CHECKOUT_MAX 时可相应调整。
RATE_WAIT="${RATE_WAIT:-61}"

PASS=0
FAIL=0
SKIP=0
CODE=""
BODY=""
TOKEN=""
TMPDIR_RUN="$(mktemp -d)"
MAIN_LOC=""
BACKUP_LOC=""
BACKUP_NAME=""
ITEM_ID=""
LEVEL_MAIN_ID=""
LEVEL_BACKUP_ID=""
PENDING_TRANSFER=""
CLEANED=0

ok()   { printf '  [通过] %s\n' "$*"; PASS=$((PASS + 1)); }
bad()  { printf '  [失败] %s\n' "$*"; FAIL=$((FAIL + 1)); }
skip() { printf '  [跳过] %s\n' "$*"; SKIP=$((SKIP + 1)); }
sec()  { printf '\n=== %s ===\n' "$*"; }
is_int() { [[ "${1-}" =~ ^-?[0-9]+$ ]]; }
# 去掉 jq 在 Windows 下可能带的 CR（Linux 无影响），避免数值比较失败
jqr() { printf '%s' "$BODY" | jq -r "$1" 2>/dev/null | tr -d '\r'; }

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

expect_reject() {
  local desc="$1"
  if [[ "$CODE" =~ ^4[0-9][0-9]$ ]]; then
    ok "$desc（HTTP $CODE，符合预期）"
  else
    bad "$desc：期望 4xx，实际 HTTP $CODE $(printf '%s' "$BODY" | head -c 160)"
  fi
}

# 真实支付：订单必须先付款，发货才会推进状态（ADR-015 只处理 paid / partial）。
# 用 e2e-regression 同一条链路：支付商 → 会话 → 授权 → 扣款，再轮询订单变 paid。
pay_order() {
  local cart_id="$1" order_id="$2" provider sid pid status
  call GET "/store/payment-providers"
  provider="$(jqr '(.data.items // .data // [])[0].id')"
  if [[ -z "$provider" || "$provider" == "null" ]]; then
    bad "没有可用的支付方式，无法完成支付"
    return 1
  fi
  call POST "/store/payment-sessions" "{\"cart_id\":\"$cart_id\",\"provider_id\":\"$provider\"}"
  expect_2xx "创建支付会话" || return 1
  sid="$(jqr '.data.id')"
  call POST "/store/payment-sessions/$sid/authorize" "{}"
  expect_2xx "支付授权" || return 1
  pid="$(jqr '.data.id')"
  call POST "/store/payments/$pid/capture" "{\"idempotency_key\":\"e2e-cap-$(date +%s%N)\"}"
  expect_2xx "支付扣款" || return 1
  for _ in $(seq 1 30); do
    call GET "/admin/orders/$order_id" "" "$AUTH"
    status="$(jqr '.data.status')"
    if [[ "$status" == "paid" || "$status" == "partially_fulfilled" ]]; then
      ok "订单已支付（$status）"
      return 0
    fi
    sleep 0.3
  done
  bad "订单未在预期时间内变为已支付（当前 $status）"
  return 1
}

# 读某仓某物料的 level 字段：level_field <location_id> <field>
level_field() {
  local loc="$1" field="$2"
  call GET "/admin/inventory-levels?location_id=$loc&limit=100" "" auth
  printf '%s' "$BODY" | jq -r --arg item "$ITEM_ID" --arg f "$field" \
    '.data.items[]? | select(.inventory_item_id==$item) | .[$f]' 2>/dev/null | tr -d '\r' | head -1
}

# 把某仓可用量调到指定值（按当前预留反推 delta）：set_available <loc> <level_id> <target>
set_available() {
  local loc="$1" level_id="$2" target="$3"
  local stocked reserved delta
  stocked="$(level_field "$loc" stocked_quantity)"
  reserved="$(level_field "$loc" reserved_quantity)"
  delta=$(( (reserved + target) - stocked ))
  if ((delta != 0)); then
    call PUT "/admin/inventory-levels/$level_id" "{\"delta\":$delta,\"reason\":\"e2e 备货\"}" "$AUTH" >/dev/null
  fi
  level_field "$loc" available_quantity
}

cleanup() {
  [[ "$CLEANED" -eq 1 ]] && return 0
  CLEANED=1
  if [[ -n "$PENDING_TRANSFER" ]]; then
    call POST "/admin/inventory-transfers/$PENDING_TRANSFER/cancel" "" auth >/dev/null 2>&1
  fi
  # 把测试仓剩余库存调回主仓，不留悬空库存；仓库无删除接口，保留并置优先级 0
  if [[ -n "$BACKUP_LOC" && -n "$MAIN_LOC" && -n "$ITEM_ID" ]]; then
    local left
    left="$(level_field "$BACKUP_LOC" stocked_quantity)"
    if is_int "${left:-}" && ((left > 0)); then
      call POST "/admin/inventory-transfers" \
        "{\"inventory_item_id\":\"$ITEM_ID\",\"from_location_id\":\"$BACKUP_LOC\",\"to_location_id\":\"$MAIN_LOC\",\"quantity\":$left,\"note\":\"e2e 清理\"}" \
        "$AUTH" >/dev/null 2>&1
      local tid
      tid="$(jqr '.data.id')"
      [[ -n "$tid" && "$tid" != "null" ]] && call POST "/admin/inventory-transfers/$tid/complete" "" "$AUTH" >/dev/null 2>&1
    fi
    call PATCH "/admin/stock-locations/$BACKUP_LOC" '{"priority":0}' "$AUTH" >/dev/null 2>&1
  fi
  rm -rf "$TMPDIR_RUN" 2>/dev/null || true
}
trap cleanup EXIT

# ------------------------------------------------------------------ #
sec "0. 预检"
for bin in curl jq; do
  if command -v "$bin" >/dev/null 2>&1; then ok "依赖 $bin 存在"; else bad "缺少依赖 $bin"; fi
done
((FAIL > 0)) && { printf '\n缺少依赖，终止：apt-get install -y curl jq\n'; exit 1; }
call GET "/health"
expect_2xx "API 健康检查" || { printf '\nAPI 不可达，先跑 deploy/healthcheck.sh\n'; exit 1; }

sec "1. 后台登录"
call POST "/admin/auth/login" "{\"email\":\"$ADMIN\",\"password\":\"$ADMIN_PW\"}"
TOKEN="$(jqr '.data.access_token')"
[[ -n "$TOKEN" && "$TOKEN" != "null" ]] || { bad "登录失败"; exit 1; }
ok "管理员 $ADMIN 登录成功"
AUTH=1

# ------------------------------------------------------------------ #
sec "2. 取可售变体与现有仓库/库存"
call GET "/admin/products?limit=100" "" "$AUTH"
PRODUCT_ID="$(printf '%s' "$BODY" | jq -r --arg h "$PRODUCT_HANDLE" '.data.items[]? | select(.handle==$h) | .id' 2>/dev/null | tr -d '\r' | head -1)"
if [[ -z "$PRODUCT_ID" || "$PRODUCT_ID" == "null" ]]; then
  bad "找不到 handle=$PRODUCT_HANDLE 的商品（可用 PRODUCT_HANDLE= 覆盖）"
  exit 1
fi
call GET "/admin/products/$PRODUCT_ID" "" "$AUTH"
VAR_ID="$(jqr '.data.variants[0].id')"
ITEM_SKU="$(jqr '.data.variants[0].sku')"
[[ -n "$VAR_ID" && "$VAR_ID" != "null" ]] || { bad "商品没有变体"; exit 1; }
ok "变体 $VAR_ID（sku=$ITEM_SKU）"

call GET "/admin/stock-locations" "" "$AUTH"
MAIN_LOC="$(printf '%s' "$BODY" | jq -r '.data.items | sort_by(-.priority) | .[0].id' 2>/dev/null | tr -d '\r')"
MAIN_PRIORITY="$(printf '%s' "$BODY" | jq -r '.data.items | sort_by(-.priority) | .[0].priority' 2>/dev/null | tr -d '\r')"
[[ -n "$MAIN_LOC" && "$MAIN_LOC" != "null" ]] || { bad "没有可用仓库"; exit 1; }
ok "主仓 $MAIN_LOC（priority=$MAIN_PRIORITY）"

call GET "/admin/inventory-levels?location_id=$MAIN_LOC&limit=100" "" "$AUTH"
ROW="$(printf '%s' "$BODY" | jq -c --arg sku "$ITEM_SKU" '.data.items[]? | select(.sku==$sku)' 2>/dev/null | tr -d '\r' | head -1)"
if [[ -z "$ROW" ]]; then
  bad "主仓没有 sku=$ITEM_SKU 的库存行（确认 seed 已导入）"
  exit 1
fi
ITEM_ID="$(printf '%s' "$ROW" | jq -r '.inventory_item_id')"
LEVEL_MAIN_ID="$(printf '%s' "$ROW" | jq -r '.id')"
MAIN_AVAIL_BEFORE="$(printf '%s' "$ROW" | jq -r '.available_quantity')"
ok "物料 $ITEM_ID，主仓可用 $MAIN_AVAIL_BEFORE"

if ! is_int "$MAIN_AVAIL_BEFORE"; then
  bad "可用量读取失败：$MAIN_AVAIL_BEFORE"
  exit 1
fi
# 至少留 3 件：转 2 件到备用仓后，主仓 1 件、备用仓 2 件，才能验证「整单从备用仓发」
if ((MAIN_AVAIL_BEFORE < 3)); then
  MAIN_AVAIL_BEFORE="$(set_available "$MAIN_LOC" "$LEVEL_MAIN_ID" 3)"
  expect_num "补货后主仓可用" "$MAIN_AVAIL_BEFORE" "3"
fi

# ------------------------------------------------------------------ #
sec "3. 建第二个仓，把库存搬过去（主仓只留 1 件）"
BACKUP_NAME="e2e-备用仓-$(date +%H%M%S)"
call POST "/admin/stock-locations" "{\"name\":\"$BACKUP_NAME\",\"priority\":$MAIN_PRIORITY}" "$AUTH"
expect_2xx "创建测试仓" || exit 1
BACKUP_LOC="$(jqr '.data.id')"
ok "测试仓 $BACKUP_LOC"

MOVE_QTY=$((MAIN_AVAIL_BEFORE - 1))
call POST "/admin/inventory-transfers" \
  "{\"inventory_item_id\":\"$ITEM_ID\",\"from_location_id\":\"$MAIN_LOC\",\"to_location_id\":\"$BACKUP_LOC\",\"quantity\":$MOVE_QTY,\"note\":\"e2e 拆分库存\"}" \
  "$AUTH"
expect_2xx "创建调拨 $MOVE_QTY 件" || exit 1
TRANSFER_ID="$(jqr '.data.id')"
call POST "/admin/inventory-transfers/$TRANSFER_ID/complete" "" "$AUTH"
expect_2xx "完成调拨" || exit 1
expect_num "调拨单状态" "$(jqr '.data.status')" "completed"

MAIN_AVAIL_AFTER_XFER="$(level_field "$MAIN_LOC" available_quantity)"
BACKUP_AVAIL="$(level_field "$BACKUP_LOC" available_quantity)"
expect_num "主仓剩余可用" "$MAIN_AVAIL_AFTER_XFER" "1"
expect_num "测试仓可用" "$BACKUP_AVAIL" "$MOVE_QTY"

sec "4. 调拨护栏：可用量不足必须拒绝"
call POST "/admin/inventory-transfers" \
  "{\"inventory_item_id\":\"$ITEM_ID\",\"from_location_id\":\"$MAIN_LOC\",\"to_location_id\":\"$BACKUP_LOC\",\"quantity\":$((MAIN_AVAIL_AFTER_XFER + 5)),\"note\":\"e2e 故意超调\"}" \
  "$AUTH"
expect_2xx "创建超量调拨（pending 只登记）" || exit 1
PENDING_TRANSFER="$(jqr '.data.id')"
call POST "/admin/inventory-transfers/$PENDING_TRANSFER/complete" "" "$AUTH"
expect_reject "完成超量调拨被拒绝"
call POST "/admin/inventory-transfers/$PENDING_TRANSFER/cancel" "" "$AUTH"
expect_2xx "取消该调拨"
PENDING_TRANSFER=""

# ------------------------------------------------------------------ #
sec "5. 单仓满足：主仓 1 件不够，整单 2 件应从备用仓发（不拆单）"
call POST "/store/carts" "{\"email\":\"inv-e2e@example.com\"}"
expect_2xx "创建购物车" || exit 1
CART_ID="$(jqr '.data.id')"
call POST "/store/carts/$CART_ID/line-items" "{\"variant_id\":\"$VAR_ID\",\"quantity\":2}"
expect_2xx "加购 2 件" || exit 1

call GET "/store/shipping-options?country=CN&cart_id=$CART_ID"
OPT_ID="$(jqr '.data.items[0].id')"
if [[ -n "$OPT_ID" && "$OPT_ID" != "null" ]]; then
  call POST "/store/carts/$CART_ID/shipping-methods" "{\"shipping_option_id\":\"$OPT_ID\"}" >/dev/null
  ok "已选运费方案"
else
  skip "无运费方案，按 0 运费继续"
fi

# 下单前后要对比主仓预留是否被占用：先记下来
MAIN_RESERVED_PRE_ORDER="$(level_field "$MAIN_LOC" reserved_quantity)"

# 下单要求购物车已有收货国家（ADR-019：运费与税都按国家自动算）
curl -s -o /dev/null -X PUT "$BASE/store/carts/$CART_ID/address" \
  -H 'Content-Type: application/json' -d '{"country":"CN"}'

OUT="$(curl -s -S -w $'\n%{http_code}' -X POST "$BASE/store/carts/$CART_ID/complete" \
  -H 'Content-Type: application/json' -H "Idempotency-Key: inv-e2e-$(date +%s)" -d '{}' 2>&1)"
CODE="${OUT##*$'\n'}"
BODY="${OUT%$'\n'*}"
expect_2xx "结账下单" || exit 1
ORDER_ID="$(jqr '.data.id')"
ok "订单 $ORDER_ID"
pay_order "$CART_ID" "$ORDER_ID" || exit 1

call GET "/admin/orders/$ORDER_ID/reservations" "" "$AUTH"
expect_2xx "查订单预留" || exit 1
expect_num "预留条数（单仓 → 1 条）" "$(jqr '.data.count')" "1"
expect_num "预留所在仓（应是备用仓）" "$(jqr '.data.items[0].stock_location_id')" "$BACKUP_LOC"
expect_num "预留数量" "$(jqr '.data.items[0].quantity')" "2"
expect_num "主仓预留（未被动用）" "$(level_field "$MAIN_LOC" reserved_quantity)" "$MAIN_RESERVED_PRE_ORDER"

# ------------------------------------------------------------------ #
sec "6. 自动单仓发货：不指定仓库也能发（后端只有一个候选仓）"
call GET "/admin/orders/$ORDER_ID" "" "$AUTH"
LINE_ID="$(jqr '.data.line_items[0].id')"
LINE_QTY="$(jqr '.data.line_items[0].quantity')"
expect_num "订单行数量" "$LINE_QTY" "2"

BACKUP_STOCK_BEFORE_SHIP="$(level_field "$BACKUP_LOC" stocked_quantity)"
MAIN_STOCK_PRE_SHIP="$(level_field "$MAIN_LOC" stocked_quantity)"
call POST "/admin/orders/$ORDER_ID/fulfillments" \
  "{\"items\":[{\"order_line_item_id\":\"$LINE_ID\",\"quantity\":$LINE_QTY}]}" \
  "$AUTH"
expect_2xx "创建发货单（不传 stock_location_id）" || exit 1
FULF_ID="$(jqr '.data.id')"
expect_num "发货单所属仓" "$(jqr '.data.stock_location_id')" "$BACKUP_LOC"

call POST "/admin/fulfillments/$FULF_ID/shipments" \
  "{\"carrier_name\":\"顺丰速运\",\"tracking_number\":\"SF-INV-$(date +%s)\"}" \
  "$AUTH"
expect_2xx "填运单发货" || exit 1

expect_num "备用仓在库（发货后 -2）" "$(level_field "$BACKUP_LOC" stocked_quantity)" "$((BACKUP_STOCK_BEFORE_SHIP - 2))"
expect_num "备用仓预留（发货后清零）" "$(level_field "$BACKUP_LOC" reserved_quantity)" "0"
expect_num "主仓在库（完全没动）" "$(level_field "$MAIN_LOC" stocked_quantity)" "$MAIN_STOCK_PRE_SHIP"

call GET "/admin/orders/$ORDER_ID/fulfillments" "" "$AUTH"
expect_num "发货单数" "$(jqr '.data.count')" "1"
expect_num "发货单带运单" "$(printf '%s' "$BODY" | jq '[.data.items[]? | select((.tracking_links // []) | length > 0)] | length')" "1"

call GET "/admin/orders/$ORDER_ID" "" "$AUTH"
expect_num "单仓发完后订单状态" "$(jqr '.data.status')" "fulfilled"

# ------------------------------------------------------------------ #
sec "7. 拆分兜底：没有单仓够、但合计够 → 从两仓凑（2+1）"
LEVEL_BACKUP_ID="$(level_field "$BACKUP_LOC" id)"
set_available "$MAIN_LOC" "$LEVEL_MAIN_ID" 2 >/dev/null
set_available "$BACKUP_LOC" "$LEVEL_BACKUP_ID" 2 >/dev/null

call POST "/store/carts" "{\"email\":\"inv-split@example.com\"}"
CART2_ID="$(jqr '.data.id')"
call POST "/store/carts/$CART2_ID/line-items" "{\"variant_id\":\"$VAR_ID\",\"quantity\":3}" >/dev/null
curl -s -o /dev/null -X PUT "$BASE/store/carts/$CART2_ID/address" \
  -H 'Content-Type: application/json' -d '{"country":"CN"}'
OUT="$(curl -s -S -w $'\n%{http_code}' -X POST "$BASE/store/carts/$CART2_ID/complete" \
  -H 'Content-Type: application/json' -H "Idempotency-Key: inv-split-$(date +%s)" -d '{}' 2>&1)"
CODE="${OUT##*$'\n'}"
BODY="${OUT%$'\n'*}"
expect_2xx "拆分兜底下单" || exit 1
SPLIT_ORDER_ID="$(jqr '.data.id')"
pay_order "$CART2_ID" "$SPLIT_ORDER_ID" || exit 1

call GET "/admin/orders/$SPLIT_ORDER_ID/reservations" "" "$AUTH"
expect_2xx "查拆分订单预留" || exit 1
expect_num "预留条数（拆分 → 2 条）" "$(jqr '.data.count')" "2"
expect_num "涉及仓数" "$(printf '%s' "$BODY" | jq '[.data.items[]?.stock_location_id] | unique | length')" "2"
expect_num "预留总量" "$(printf '%s' "$BODY" | jq '[.data.items[]?.quantity] | add // 0')" "3"

sec "7.1 发货计划自动化：每仓发什么由后端算，操作员只填运单号"
call GET "/admin/orders/$SPLIT_ORDER_ID/fulfillment-plan" "" "$AUTH"
expect_2xx "取发货计划" || exit 1
expect_num "计划里的仓数" "$(jqr '.data.count')" "2"
expect_num "计划总量" "$(printf '%s' "$BODY" | jq '[.data.plans[]?.total_quantity] | add // 0')" "3"
expect_num "未匹配数量（应为 0）" "$(jqr '.data.unmatched_quantity')" "0"

SHIPPED=0
while read -r loc qty; do
  [[ -z "${loc:-}" ]] && continue
  call GET "/admin/orders/$SPLIT_ORDER_ID/fulfillment-plan" "" "$AUTH"
  ITEMS_JSON="$(printf '%s' "$BODY" | jq -c --arg loc "$loc" '.data.plans[] | select(.stock_location_id==$loc) | .items')"
  call POST "/admin/orders/$SPLIT_ORDER_ID/fulfillments" \
    "{\"items\":$ITEMS_JSON,\"stock_location_id\":\"$loc\"}" \
    "$AUTH"
  if expect_2xx "从仓 $loc 建发货单（计划 $qty 件）"; then
    f_id="$(jqr '.data.id')"
    call POST "/admin/fulfillments/$f_id/shipments" \
      "{\"carrier_name\":\"顺丰速运\",\"tracking_number\":\"SF-SPLIT-$(date +%s)-$SHIPPED\"}" \
      "$AUTH"
    expect_2xx "仓 $loc 填运单发货"
    SHIPPED=$((SHIPPED + 1))
    if ((SHIPPED < 2)); then
      call GET "/admin/orders/$SPLIT_ORDER_ID" "" "$AUTH"
      expect_num "发完第一个仓后订单状态" "$(jqr '.data.status')" "partially_fulfilled"
    fi
  fi
done < <(printf '%s' "$BODY" >/dev/null; call GET "/admin/orders/$SPLIT_ORDER_ID/fulfillment-plan" "" "$AUTH"; printf '%s' "$BODY" | jq -r '.data.plans[] | "\(.stock_location_id) \(.total_quantity)"' | tr -d '\r')

expect_num "拆分订单发货单数" "$SHIPPED" "2"
call GET "/admin/orders/$SPLIT_ORDER_ID/fulfillments" "" "$AUTH"
expect_num "拆分订单已发仓数" "$(printf '%s' "$BODY" | jq '[.data.items[]?.stock_location_id] | unique | length')" "2"

call GET "/admin/orders/$SPLIT_ORDER_ID" "" "$AUTH"
expect_num "两仓都发完后订单状态" "$(jqr '.data.status')" "fulfilled"

sec "7.2 合计仍不足 → 必须拒单"
set_available "$MAIN_LOC" "$LEVEL_MAIN_ID" 2 >/dev/null
set_available "$BACKUP_LOC" "$LEVEL_BACKUP_ID" 2 >/dev/null
MAIN_AVAIL_PRE_REJECT="$(level_field "$MAIN_LOC" available_quantity)"
BACKUP_AVAIL_PRE_REJECT="$(level_field "$BACKUP_LOC" available_quantity)"

call POST "/store/carts" "{\"email\":\"inv-reject@example.com\"}"
CART3_ID="$(jqr '.data.id')"
call POST "/store/carts/$CART3_ID/line-items" "{\"variant_id\":\"$VAR_ID\",\"quantity\":5}" >/dev/null
curl -s -o /dev/null -X PUT "$BASE/store/carts/$CART3_ID/address" \
  -H 'Content-Type: application/json' -d '{"country":"CN"}'
OUT="$(curl -s -S -w $'\n%{http_code}' -X POST "$BASE/store/carts/$CART3_ID/complete" \
  -H 'Content-Type: application/json' -H "Idempotency-Key: inv-reject-$(date +%s)" -d '{}' 2>&1)"
CODE="${OUT##*$'\n'}"
BODY="${OUT%$'\n'*}"
expect_reject "两仓合计不足 → 拒单"
expect_num "主仓可用（未被动用）" "$(level_field "$MAIN_LOC" available_quantity)" "$MAIN_AVAIL_PRE_REJECT"
expect_num "备用仓可用（未被动用）" "$(level_field "$BACKUP_LOC" available_quantity)" "$BACKUP_AVAIL_PRE_REJECT"

# ------------------------------------------------------------------ #
if ((RATE_WAIT > 0)); then
  printf '\n  等待 %s 秒让下单限流窗口重置（默认 10 次/分钟）…\n' "$RATE_WAIT"
  sleep "$RATE_WAIT"
fi

sec "8. 并发抢库存：库存 10，$CONCURRENCY 单各要 $CONC_QTY 件"
# 全部库存集中到主仓（备用仓清零），避免分配走到备用仓
LEVEL_BACKUP_STOCK="$(level_field "$BACKUP_LOC" stocked_quantity)"
if is_int "${LEVEL_BACKUP_STOCK:-}" && ((LEVEL_BACKUP_STOCK > 0)); then
  call PUT "/admin/inventory-levels/$LEVEL_BACKUP_ID" "{\"delta\":-$LEVEL_BACKUP_STOCK,\"reason\":\"e2e 清零\"}" "$AUTH" >/dev/null
fi
MAIN_AVAIL_SET="$(set_available "$MAIN_LOC" "$LEVEL_MAIN_ID" 10)"
expect_num "主仓可用" "$MAIN_AVAIL_SET" "10"
MAIN_RESERVED_BEFORE="$(level_field "$MAIN_LOC" reserved_quantity)"

CART_IDS=()
for i in $(seq 1 "$CONCURRENCY"); do
  call POST "/store/carts" "{\"email\":\"conc$i@example.com\"}"
  cid="$(jqr '.data.id')"
  call POST "/store/carts/$cid/line-items" "{\"variant_id\":\"$VAR_ID\",\"quantity\":$CONC_QTY}" >/dev/null
  CART_IDS+=("$cid")
done
ok "已准备 $CONCURRENCY 个购物车（各 $CONC_QTY 件）"

for i in "${!CART_IDS[@]}"; do
  cid="${CART_IDS[$i]}"
  (
    curl -s -o /dev/null -X PUT "$BASE/store/carts/$cid/address" \
      -H 'Content-Type: application/json' -d '{"country":"CN"}'
    curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/store/carts/$cid/complete" \
      -H 'Content-Type: application/json' -H "Idempotency-Key: conc-$i-$(date +%s)" -d '{}' \
      > "$TMPDIR_RUN/$i.status" 2>/dev/null
  ) &
done
wait
SUCCESS=$(grep -l '^201$' "$TMPDIR_RUN"/*.status 2>/dev/null | wc -l | tr -d ' ')
LIMITED=$(grep -l '^429$' "$TMPDIR_RUN"/*.status 2>/dev/null | wc -l | tr -d ' ')
if [[ "${LIMITED:-0}" != "0" ]]; then
  bad "有 $LIMITED 个请求被限流（429）：请调大 RATE_LIMIT_CHECKOUT_MAX 或调小 CONCURRENCY"
fi
EXPECT_SUCCESS=$((10 / CONC_QTY))
expect_num "并发成功单数" "$SUCCESS" "$EXPECT_SUCCESS"
expect_num "主仓预留增量（成功单 × 件数）" \
  "$(( $(level_field "$MAIN_LOC" reserved_quantity) - MAIN_RESERVED_BEFORE ))" \
  "$((EXPECT_SUCCESS * CONC_QTY))"
expect_num "主仓可用（10 - 预留增量）" \
  "$(level_field "$MAIN_LOC" available_quantity)" "$((10 - EXPECT_SUCCESS * CONC_QTY))"

# ------------------------------------------------------------------ #
sec "汇总"
printf '通过 %d 项，失败 %d 项，跳过 %d 项\n' "$PASS" "$FAIL" "$SKIP"
printf '测试数据：仓 %s（已清零/优先级 0，无删除接口故保留）、订单 %s\n' "${BACKUP_NAME:-无}" "${ORDER_ID:-无}"
printf '并发测试产生的 %d 笔订单为未付款状态，验收环境可忽略。\n' "$SUCCESS"

if ((FAIL > 0)); then exit 1; fi
exit 0
