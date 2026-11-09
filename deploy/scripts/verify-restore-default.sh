#!/usr/bin/env bash
# verify-restore-default.sh — 恢复出厂默认口令路径的真机验收
#
# 闭环：改密成强口令 → 应急通道恢复出厂默认 → 确认 123456 可登录
#       → 确认改密端点仍拒绝弱口令（强度规则没被放松）→ 确认体检能感知默认口令生效
set -uo pipefail

BASE="${BASE:-http://localhost/api/v1}"
MALL_DIR="${MALL_DIR:-/data/home/mall-data}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "${SCRIPT_DIR}/../.." && pwd)"
OLD_PW="123456"
STRONG_PW="Mall@2026"
PASS=0
FAIL=0

ok()  { printf '  [通过] %s\n' "$*"; PASS=$((PASS+1)); }
bad() { printf '  [失败] %s\n' "$*"; FAIL=$((FAIL+1)); }
sec() { printf '\n=== %s ===\n' "$*"; }

login() {
  curl -s -X POST "$BASE/admin/auth/login" -H 'Content-Type: application/json' \
    -d "{\"email\":\"admin\",\"password\":\"$1\"}"
}

sec "1. 前置：改密成强口令（模拟用户自己改了密码）"
TOKEN=$(login "$OLD_PW" | jq -r '.data.access_token')
if [[ -z "$TOKEN" || "$TOKEN" == "null" ]]; then
  bad "初始登录失败（admin/$OLD_PW 不通）"; exit 1
fi
ok "用出厂默认口令登录成功"

RES=$(curl -s -X POST "$BASE/admin/auth/change-password" -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d "{\"current_password\":\"$OLD_PW\",\"new_password\":\"$STRONG_PW\"}")
CHANGED=$(echo "$RES" | jq -r '.data.changed')
if [[ "$CHANGED" == "true" ]]; then ok "改密成功（口令已变为强口令）"; else bad "改密失败：$RES"; exit 1; fi

CODE=$(login "$OLD_PW" | jq -r '.code')
if [[ "$CODE" != "0" ]]; then ok "旧口令已失效（登录被拒）"; else bad "旧口令仍可用"; fi

sec "2. 应急通道：恢复出厂默认口令"
OUT=$(cd "$REPO" && MALL_DIR="$MALL_DIR" bash deploy/scripts/set-admin-password.sh --restore-default --yes 2>&1)
RC=$?
echo "$OUT" | sed -n '1,12p'
if [[ "$RC" == "0" ]]; then ok "set-admin-password.sh --restore-default --yes 退出码 0"; else bad "退出码 $RC（期望 0）"; fi
if echo "$OUT" | grep -qiE "降级|改密页|强口令"; then ok "输出了降级警告与「恢复后请改密」的提示"; else bad "缺少降级警告提示"; fi

sec "3. 验证恢复结果"
CODE=$(login "$OLD_PW" | jq -r '.code')
if [[ "$CODE" == "0" ]]; then ok "出厂默认口令 $OLD_PW 可登录（恢复成功）"; else bad "$OLD_PW 无法登录（code $CODE）"; fi

TOKEN=$(login "$OLD_PW" | jq -r '.data.access_token')
CN=$(curl -s -X POST "$BASE/admin/auth/change-password" -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d "{\"current_password\":\"$OLD_PW\",\"new_password\":\"weak\"}" | jq -r '.code')
if [[ "$CN" == "20001" ]]; then ok "改密端点仍拒绝弱口令（code 20001，强度规则未被放松）"; else bad "弱口令返回 code $CN（期望 20001）"; fi

sec "4. 应急脚本的常规路径仍强制强度规则"
cd "$REPO"
OUT2=$(MALL_DIR="$MALL_DIR" bash deploy/scripts/set-admin-password.sh --password 'weak' --yes 2>&1)
RC2=$?
if [[ "$RC2" != "0" ]]; then ok "--password 'weak' 被拒（退出码 $RC2），常规路径未放松"; else bad "--password 'weak' 竟被接受"; fi

sec "5. 体检能感知默认口令生效"
DOCT=$(cd "$REPO" && MALL_DIR="$MALL_DIR" bash deploy/scripts/doctor.sh 2>&1)
echo "$DOCT" | grep -E "管理端默认口令|image\.|OK=|结论" | head -8
if echo "$DOCT" | grep -q "管理端默认口令"; then ok "doctor.sh 检出了「管理端默认口令」项"; else bad "doctor.sh 未检出默认口令项"; fi
if echo "$DOCT" | grep -qE "image\.declared.*\[OK\]|镜像声明"; then ok "镜像声明一致性检查项存在"; fi

printf '\n================= 恢复出厂默认验收汇总 =================\n'
printf '通过 %d 项，失败 %d 项\n' "$PASS" "$FAIL"
printf '当前管理员口令: %s（出厂默认）\n' "$OLD_PW"
if (( FAIL > 0 )); then exit 1; fi
exit 0
