#!/usr/bin/env bash
# verify-change-password.sh — 管理员改密端点真机验收
#
# 覆盖：错误路径（不改变口令）→ 成功路径 → 会话失效 → 新旧口令互斥 → 审计留痕 → 自动恢复出厂默认
#
# 限流预算（重要）：改密端点与登录共用 auth 限流档（5 次/分钟/IP），无 token 的调用同样计数。
# 本脚本所有 auth 档请求按「每组 ≤4 次」拆分，组间等一个完整窗口 —— 超过额度会拿到 429/60001，
# 那是测试预算超了，不是产品缺陷。
set -uo pipefail

BASE="${BASE:-http://localhost/api/v1}"
MALL_DIR="${MALL_DIR:-/data/home/mall-data}"
REPO="${REPO:-/data/home/mall}"
ADMIN="${ADMIN:-admin}"
OLD_PW="${OLD_PW:-123456}"
NEW_PW="${NEW_PW:-Mall@2026}"
PASS=0
FAIL=0

ok()  { printf '  [通过] %s\n' "$*"; PASS=$((PASS+1)); }
bad() { printf '  [失败] %s\n' "$*"; FAIL=$((FAIL+1)); }
sec() { printf '\n=== %s ===\n' "$*"; }
wait_window() { printf '  等待限流窗口（61s）…\n'; sleep 61; }

login() {
  curl -s -X POST "$BASE/admin/auth/login" -H 'Content-Type: application/json' \
    -d "{\"email\":\"$ADMIN\",\"password\":\"$1\"}"
}

change() {
  curl -s -X POST "$BASE/admin/auth/change-password" -H "Authorization: Bearer $1" \
    -H 'Content-Type: application/json' -d "{\"current_password\":\"$2\",\"new_password\":\"$3\"}"
}

# ---------- 段 1a：错误路径（第一组，4 次 auth 档请求） ----------
sec "段 1a · 错误路径"
LOGIN=$(login "$OLD_PW")
TOKEN=$(echo "$LOGIN" | jq -r '.data.access_token')
REFRESH=$(echo "$LOGIN" | jq -r '.data.refresh_token')
if [[ -n "$TOKEN" && "$TOKEN" != "null" ]]; then ok "管理员登录成功"; else bad "管理员登录失败"; exit 1; fi

CN=$(change "$TOKEN" "wrong-password" "$NEW_PW" | jq -r '.code')
if [[ "$CN" == "10005" ]]; then ok "当前口令错误 → code 10005（凭证错误）"; else bad "当前口令错误返回 code $CN（期望 10005）"; fi

for pw in "abc" "abcdefgh"; do
  RES=$(change "$TOKEN" "$OLD_PW" "$pw")
  CN=$(echo "$RES" | jq -r '.code')
  MSG=$(echo "$RES" | jq -r '.message')
  if [[ "$CN" == "20001" ]]; then ok "弱口令「$pw」被拒（$MSG）"; else bad "弱口令「$pw」返回 code $CN（期望 20001）"; fi
done

wait_window

# ---------- 段 1b：错误路径（第二组） ----------
sec "段 1b · 错误路径（续）"
for pw in "12345678" "abcdefg!@#\$%^&*"; do
  RES=$(change "$TOKEN" "$OLD_PW" "$pw")
  CN=$(echo "$RES" | jq -r '.code')
  MSG=$(echo "$RES" | jq -r '.message')
  if [[ "$CN" == "20001" ]]; then ok "弱口令「$pw」被拒（$MSG）"; else bad "弱口令「$pw」返回 code $CN（期望 20001）"; fi
done

RES=$(change "$TOKEN" "$OLD_PW" "$OLD_PW")
CN=$(echo "$RES" | jq -r '.code')
if [[ "$CN" == "20001" ]]; then ok "新旧口令相同被拒（code 20001）"; else bad "新旧相同返回 code $CN（期望 20001）"; fi

CODE=$(curl -s -o /tmp/cp_1.json -w '%{http_code}' -X POST "$BASE/admin/auth/change-password" \
  -H 'Content-Type: application/json' -d "{\"current_password\":\"$OLD_PW\",\"new_password\":\"$NEW_PW\"}")
if [[ "$CODE" == "401" ]]; then ok "无 token 调用 → 401"; else bad "无 token 调用返回 $CODE（期望 401）"; fi

wait_window

# ---------- 段 2：成功路径与会话失效 ----------
sec "段 2 · 成功路径"
RES=$(change "$TOKEN" "$OLD_PW" "$NEW_PW")
CHANGED=$(echo "$RES" | jq -r '.data.changed')
REAUTH=$(echo "$RES" | jq -r '.data.reauth_required')
REVOKED=$(echo "$RES" | jq -r '.data.revoked_refresh_tokens')
if [[ "$CHANGED" == "true" ]]; then ok "改密成功（changed=true，撤销 refresh_token $REVOKED 个）"; else bad "改密失败：$(echo "$RES" | head -c 160)"; fi
if [[ "$REAUTH" == "true" ]]; then ok "响应声明需重新登录（reauth_required=true）"; else bad "响应未声明 reauth_required"; fi

CODE=$(curl -s -o /tmp/cp_rt.json -w '%{http_code}' -X POST "$BASE/admin/auth/refresh" \
  -H 'Content-Type: application/json' -d "{\"refresh_token\":\"$REFRESH\"}")
if [[ "$CODE" != "200" ]]; then ok "旧 refresh_token 已失效（返回 $CODE）"; else bad "旧 refresh_token 仍可用 —— 会话未撤销"; fi

CODE=$(login "$OLD_PW" | jq -r '.code')
if [[ "$CODE" != "0" ]]; then ok "旧口令已失效（登录返回 code $CODE）"; else bad "旧口令仍可登录 —— 口令未真正覆盖"; fi

LOGIN2=$(login "$NEW_PW")
T2=$(echo "$LOGIN2" | jq -r '.data.access_token')
if [[ -n "$T2" && "$T2" != "null" ]]; then ok "新口令可登录"; else bad "新口令无法登录"; fi

wait_window

# ---------- 段 3：审计留痕 ----------
sec "段 3 · 审计留痕"
AUD=$(curl -s -H "Authorization: Bearer $T2" "$BASE/admin/audit-logs?action=admin.change_password&limit=5")
CNT=$(echo "$AUD" | jq -r '.data.items | length' 2>/dev/null)
if [[ "$CNT" != "0" && "$CNT" != "null" ]]; then
  ok "审计记录 admin.change_password 命中 $CNT 条"
  echo "$AUD" | jq -c '.data.items[0] | {action, entity_type, actor_type, revoked: .after.revoked_refresh_tokens}' 2>/dev/null
else
  bad "审计表查不到 admin.change_password"
fi
LEAK=$(echo "$AUD" | grep -ciE 'password_hash|\$argon2|Mall@2026|123456' || true)
if [[ "$LEAK" == "0" ]]; then ok "审计未泄漏口令明文/哈希"; else bad "审计疑似泄漏口令（命中 $LEAK 处）"; fi

# ---------- 段 4：自动恢复出厂默认（自包含，不留残留状态） ----------
sec "段 4 · 自动恢复出厂默认口令"
OUT=$(cd "$REPO" && MALL_DIR="$MALL_DIR" bash deploy/scripts/set-admin-password.sh --restore-default --yes 2>&1)
if [[ $? -eq 0 ]]; then ok "set-admin-password.sh --restore-default --yes 执行成功"; else bad "恢复出厂默认失败：$(echo "$OUT" | tail -3)"; fi
CODE=$(login "$OLD_PW" | jq -r '.code')
if [[ "$CODE" == "0" ]]; then ok "出厂默认口令 $OLD_PW 已恢复，可登录"; else bad "$OLD_PW 仍无法登录（code $CODE）"; fi

# ---------- 汇总 ----------
printf '\n================= 改密端点验收汇总 =================\n'
printf '通过 %d 项，失败 %d 项\n' "$PASS" "$FAIL"
printf '当前管理员口令: %s（出厂默认，已自动恢复）\n' "$OLD_PW"
if (( FAIL > 0 )); then exit 1; fi
exit 0
