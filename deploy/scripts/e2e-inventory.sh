#!/usr/bin/env bash
# e2e-inventory.sh — 二期多仓深化真机端到端验收（ADR-013）
#
# 覆盖：
#   建第二个仓 → 把库存拆到两仓 → 跨仓下单（一单两仓预留）
#   → 不指定仓发货被拒绝 → 按仓分别发货 → 两仓各自出库
#   → 调拨（正常搬迁 / 可用量不足被拒）
#   → 并发抢库存（10 单各要 3 件、库存 10，只能成功 3 单）
#
# 设计要点：
#   1. 断言用「库存差值」而不是写死数量：跑之前先读 level，跑完对比。
#   2. 并发是核心：直接证明不会超卖（成功后 reserved 恰好等于被抢走的量）。
#   3. 退出时取消未完成的调拨单；测试仓保留（后端无删除仓库接口），
#      但把剩余库存调回主仓、优先级置 0，不影响后续真实订单。
#   4. 需要 curl + jq；本脚本会真实下单，只在验收环境跑。
#
# 用法：
#   bash deploy/scripts/e2e-inventory.sh
#   BASE=... ADMIN=... ADMIN_PW=... bash deploy/scripts/e2e-inventory.sh
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

# 读某仓某物料的 level 字段：level_field <location_id> <field>
level_field() {
  local loc="$1" field="$2"
  call GET "/admin/inventory-levels?location_id=$loc&limit=100" "" auth
  printf '%s' "$BODY" | jq -r --arg item "$ITEM_ID" --arg f "$field" \
    '.data.items[]? | select(.inventory_item_id==$item) | .[$f]' 2>/dev/null | tr -d '\r' | head -1
}

cleanup() {
  [[ "$CLEANED" -eq 1 ]] && return 0
  CLEANED=1
  # 取消未完成的调拨单（避免留下 pending 噪音）
  if [[ -n "$PENDING_TRANSFER" ]]; then
    call POST "/admin/inventory-transfers/$PENDING_TRANSFER/cancel" "" auth >/dev/null 2>&1
  fi
  # 把测试仓剩余库存调回主仓（不留悬空库存）；仓本身无删除接口，保留并置优先级 0
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
  rm -rf "$TMPDIR_RUN"
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
PRODUCT_ID="$(printf '%s' "$BODY" | jq -r --arg h "$PRODUCT_HANDLE" '.data.items[]? | select(.handle==$h) | .id' 2>/dev/null | head -1)"
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
MAIN_LOC="$(printf '%s' "$BODY" | jq -r '.data.items | sort_by(-.priority) | .[0].id' 2>/dev/null)"
MAIN_PRIORITY="$(printf '%s' "$BODY" | jq -r '.data.items | sort_by(-.priority) | .[0].priority' 2>/dev/null)"
[[ -n "$MAIN_LOC" && "$MAIN_LOC" != "null" ]] || { bad "没有可用仓库"; exit 1; }
ok "主仓 $MAIN_LOC（priority=$MAIN_PRIORITY）"

call GET "/admin/inventory-levels?location_id=$MAIN_LOC&limit=100" "" "$AUTH"
ROW="$(printf '%s' "$BODY" | jq -c --arg sku "$ITEM_SKU" '.data.items[]? | select(.sku==$sku)' 2>/dev/null | head -1)"
if [[ -z "$ROW" ]]; then
  bad "主仓没有 sku=$ITEM_SKU 的库存行（确认 seed 已导入）"
  exit 1
fi
ITEM_ID="$(printf '%s' "$ROW" | jq -r '.inventory_item_id')"
LEVEL_MAIN_ID="$(printf '%s' "$ROW" | jq -r '.id')"
MAIN_STOCKED_BEFORE="$(printf '%s' "$ROW" | jq -r '.stocked_quantity')"
MAIN_AVAIL_BEFORE="$(printf '%s' "$ROW" | jq -r '.available_quantity')"
ok "物料 $ITEM_ID，主仓在库 $MAIN_STOCKED_BEFORE / 可用 $MAIN_AVAIL_BEFORE"
if ! is_int "$MAIN_AVAIL_BEFORE"; then
  bad "可用量读取失败：$MAIN_AVAIL_BEFORE"
  exit 1
fi
if ((MAIN_AVAIL_BEFORE < 2)); then
  # 可重复执行：把主仓补到「已预留 + 2」，只加 2 件，不动预留
  RESERVED_NOW="$(level_field "$MAIN_LOC" reserved_quantity)"
  NEED_DELTA=$(( (RESERVED_NOW + 2) - MAIN_STOCKED_BEFORE ))
  call PUT "/admin/inventory-levels/$LEVEL_MAIN_ID" "{\"delta\":$NEED_DELTA,\"reason\":\"e2e 补货到 2 件\"}" "$AUTH"
  expect_2xx "主仓补货 $NEED_DELTA 件（可重复执行）" || exit 1
  MAIN_AVAIL_BEFORE="$(level_field "$MAIN_LOC" available_quantity)"
  MAIN_STOCKED_BEFORE="$(level_field "$MAIN_LOC" stocked_quantity)"
  expect_num "补货后主仓可用" "$MAIN_AVAIL_BEFORE" "2"
fi

# ------------------------------------------------------------------ #
sec "3. 建第二个仓，把库存拆过去（主仓只留 1 件）"
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
MAIN_STOCKED_XFER="$(level_field "$MAIN_LOC" stocked_quantity)"
BACKUP_STOCKED_XFER="$(level_field "$BACKUP_LOC" stocked_quantity)"
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
sec "5. 跨仓下单：2 件，主仓只有 1 件"
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

OUT="$(curl -s -S -w $'\n%{http_code}' -X POST "$BASE/store/carts/$CART_ID/complete" \
  -H 'Content-Type: application/json' -H "Idempotency-Key: inv-e2e-$(date +%s)" -d '{}' 2>&1)"
CODE="${OUT##*$'\n'}"
BODY="${OUT%$'\n'*}"
expect_2xx "结账下单" || exit 1
ORDER_ID="$(jqr '.data.id')"
ok "订单 $ORDER_ID"

sec "6. 一单两仓：预留必须落在两个仓"
call GET "/admin/orders/$ORDER_ID/reservations" "" "$AUTH"
expect_2xx "查订单预留" || exit 1
RES_COUNT="$(jqr '.data.count')"
RES_SUM="$(printf '%s' "$BODY" | jq '[.data.items[]?.quantity] | add // 0')"
LOC_COUNT="$(printf '%s' "$BODY" | jq '[.data.items[]?.stock_location_id] | unique | length')"
expect_num "预留条数" "$RES_COUNT" "2"
expect_num "跨仓数" "$LOC_COUNT" "2"
expect_num "预留总量" "$RES_SUM" "2"

sec "7. 不指定仓发货 → 必须拒绝（一张发货单只发一个仓）"
call GET "/admin/orders/$ORDER_ID" "" "$AUTH"
LINE_ID="$(jqr '.data.line_items[0].id')"
LINE_QTY="$(jqr '.data.line_items[0].quantity')"
LINE_COUNT="$(printf '%s' "$BODY" | jq '.data.line_items | length')"
if [[ "$LINE_COUNT" != "1" ]]; then
  bad "本脚本假定订单只有 1 个商品行（实际 $LINE_COUNT），请换 PRODUCT_HANDLE 或手工验证"
  exit 1
fi
call POST "/admin/orders/$ORDER_ID/fulfillments" "{\"items\":[{\"order_line_item_id\":\"$LINE_ID\",\"quantity\":$LINE_QTY}]}" "$AUTH"
expect_reject "不指定仓库、跨仓发货被拒绝"

MAIN_RESERVED_BEFORE_SHIP="$(level_field "$MAIN_LOC" reserved_quantity)"

sec "8. 按仓分别发货（每仓一张发货单 + 运单号）"
printf '%s' "$BODY" >/dev/null
mapfile -t RES_LOCS < <(call GET "/admin/orders/$ORDER_ID/reservations" "" "$AUTH"; printf '%s' "$BODY" | jq -r '.data.items[] | "\(.stock_location_id) \(.quantity)"')
FULFILLED=0
for row in "${RES_LOCS[@]}"; do
  row="${row%$'\r'}"
  [[ -z "$row" ]] && continue
  loc="${row%% *}"
  qty="${row##* }"
  call POST "/admin/orders/$ORDER_ID/fulfillments" \
    "{\"items\":[{\"order_line_item_id\":\"$LINE_ID\",\"quantity\":$qty}],\"stock_location_id\":\"$loc\"}" \
    "$AUTH"
  if expect_2xx "从仓 $loc 建发货单（$qty 件）"; then
    fulf_id="$(jqr '.data.id')"
    call POST "/admin/fulfillments/$fulf_id/shipments" \
      "{\"carrier_name\":\"顺丰速运\",\"tracking_number\":\"SF-INV-$(date +%s)-$FULFILLED\"}" \
      "$AUTH"
    expect_2xx "仓 $loc 填运单发货"
    FULFILLED=$((FULFILLED + 1))
  fi
done
expect_num "发货单张数" "$FULFILLED" "2"

call GET "/admin/orders/$ORDER_ID/fulfillments" "" "$AUTH"
expect_2xx "查已发仓" || exit 1
expect_num "发货单数" "$(jqr '.data.count')" "2"
expect_num "已发仓数" "$(printf '%s' "$BODY" | jq '[.data.items[]?.stock_location_id] | unique | length')" "2"
expect_num "带运单的发货单" "$(printf '%s' "$BODY" | jq '[.data.items[]? | select((.tracking_links // []) | length > 0)] | length')" "2"

sec "9. 出库核对：两仓各减 1，预留清零"
expect_num "主仓在库（发货前 -1）" "$(level_field "$MAIN_LOC" stocked_quantity)" "$((MAIN_STOCKED_XFER - 1))"
expect_num "测试仓在库（发货前 -1）" "$(level_field "$BACKUP_LOC" stocked_quantity)" "$((BACKUP_STOCKED_XFER - 1))"
expect_num "主仓预留（发货后 -1）" \
  "$(level_field "$MAIN_LOC" reserved_quantity)" "$((MAIN_RESERVED_BEFORE_SHIP - 1))"

# ------------------------------------------------------------------ #
sec "10. 并发抢库存：库存 10，$CONCURRENCY 单各要 $CONC_QTY 件"
# 先把测试仓清零（预留为 0，允许调减），再把主仓补到 10，确保全部库存集中在一个仓。
BACKUP_STOCK="$(level_field "$BACKUP_LOC" stocked_quantity)"
if is_int "${BACKUP_STOCK:-}" && ((BACKUP_STOCK > 0)); then
  call PUT "/admin/inventory-levels/$(level_field "$BACKUP_LOC" id)" "{\"delta\":-$BACKUP_STOCK,\"reason\":\"e2e 清零\"}" "$AUTH" >/dev/null
fi
MAIN_STOCK_NOW="$(level_field "$MAIN_LOC" stocked_quantity)"
MAIN_RESERVED_BEFORE="$(level_field "$MAIN_LOC" reserved_quantity)"
# 目标可用量固定为 10（可重复执行：按当前预留反推在库量）
DELTA_TO_10=$(( (MAIN_RESERVED_BEFORE + 10) - MAIN_STOCK_NOW ))
call PUT "/admin/inventory-levels/$LEVEL_MAIN_ID" "{\"delta\":$DELTA_TO_10,\"reason\":\"e2e 并发测试备货\"}" "$AUTH"
expect_2xx "主仓可用量调到 10" || exit 1
expect_num "主仓可用" "$(level_field "$MAIN_LOC" available_quantity)" "10"

CART_IDS=()
for i in $(seq 1 "$CONCURRENCY"); do
  call POST "/store/carts" "{\"email\":\"conc$i@example.com\"}"
  cid="$(jqr '.data.id')"
  call POST "/store/carts/$cid/line-items" "{\"variant_id\":\"$VAR_ID\",\"quantity\":$CONC_QTY}"
  CART_IDS+=("$cid")
done
ok "已准备 $CONCURRENCY 个购物车（各 $CONC_QTY 件）"

# 下单接口默认限流 10 次/分钟（RATE_LIMIT_CHECKOUT_MAX）。前面已下过 1 单，
# 不等窗口会让并发批次里本该成功的请求被 429 挡掉，造成假失败。
if ((RATE_WAIT > 0)); then
  printf '  等待 %s 秒让下单限流窗口重置（默认 10 次/分钟）…\n' "$RATE_WAIT"
  sleep "$RATE_WAIT"
fi

for i in "${!CART_IDS[@]}"; do
  cid="${CART_IDS[$i]}"
  (
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
expect_num "主仓可用（10 - 预留）" "$(level_field "$MAIN_LOC" available_quantity)" "$((10 - EXPECT_SUCCESS * CONC_QTY))"

# ------------------------------------------------------------------ #
sec "汇总"
printf '通过 %d 项，失败 %d 项，跳过 %d 项\n' "$PASS" "$FAIL" "$SKIP"
printf '测试数据：仓 %s（已清零/优先级 0，无删除接口故保留）、订单 %s\n' "${BACKUP_NAME:-无}" "${ORDER_ID:-无}"
printf '并发测试产生的 %d 笔订单为未付款状态，验收环境可忽略。\n' "$SUCCESS"

if ((FAIL > 0)); then exit 1; fi
exit 0
