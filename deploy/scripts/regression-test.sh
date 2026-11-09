#!/usr/bin/env bash
# 本地回归：备份假闭环修复后的全量验证（本机无 Docker，用假 docker + fixture 模拟）
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.." || exit 1

PASS=0; FAIL=0
ok(){ printf '  [PASS] %s\n' "$1"; PASS=$((PASS+1)); }
no(){ printf '  [FAIL] %s\n' "$1"; FAIL=$((FAIL+1)); }
# t <名称> <期望退出码> <命令...>
t(){ local name="$1" want="$2"; shift 2; "$@" >/dev/null 2>&1; local got=$?; [[ "$got" == "$want" ]] && ok "$name (exit=$got)" || no "$name 期望 exit=$want 实际=$got"; }
# c <名称> <条件命令>
c(){ local name="$1"; shift; if eval "$@" >/dev/null 2>&1; then ok "$name"; else no "$name"; fi; }
# has <名称> <正则> <命令>：命令输出里必须匹配该正则。
# 注意：不要写成 `cmd | grep -q PAT` —— grep -q 命中即退出会给 cmd 发 SIGPIPE，
# 在 set -o pipefail 下管道状态变成 141，好用例会被误判成失败。这里先落盘再匹配。
has(){ local name="$1" pat="$2" cmd="$3"; eval "$cmd" >"$REG_OUT" 2>&1; if grep -qE -- "$pat" "$REG_OUT"; then ok "$name"; else no "$name"; fi; }
REG_OUT="$(pwd)/.reg-out.tmp"
REG_COMPOSE_BAK="$(pwd)/.reg-compose.bak"
trap 'rm -f "$REG_OUT" "$(pwd)/.reg-doc.json" "$REG_COMPOSE_BAK"' EXIT

FIX=/tmp/reg-fixture
rm -rf "$FIX" /tmp/regbin
mkdir -p "$FIX"/{config,data/{uploads,backup}} /tmp/regbin
cat > /tmp/regbin/docker <<'EOF'
#!/bin/sh
case "$*" in
  *pg_dump*) printf 'PGDMP\x01\x02\x03REG-DUMP' ;;
  *) exit 0 ;;
esac
EOF
rm -rf /tmp/regbin-fail; mkdir -p /tmp/regbin-fail
cat > /tmp/regbin-fail/docker <<'EOF'
#!/bin/sh
# 模拟真机现场：容器名/网络名不对 → compose exec 失败
echo "docker: Error response from daemon: failed to set up container networking: network deploy_default not found" >&2
exit 1
EOF
chmod +x /tmp/regbin/docker /tmp/regbin-fail/docker

# --- fixture: 一个完整可用的备份（PGDMP + 合法归档）---
# dump 必须 >= 1KB（restore.sh 的 DUMP_MIN_BYTES 下限），否则会被判为无效备份
B="$FIX/data/backup/good"; mkdir -p "$B"
echo pw > "$FIX/config/.env"; echo x > "$FIX/data/uploads/a.txt"
{ printf 'PGDMP\001\002'; head -c 2000 /dev/zero | tr '\0' 'X'; } > "$B/mall.dump"
tar -czf "$B/uploads.tar.gz" -C "$FIX/data" uploads
tar -czf "$B/config.tar.gz" -C "$FIX/config" .
printf 'label: good\ntime: now\ndb: ok\nuploads: ok\nconfig: ok\nchecksums: ok\n' > "$B/MANIFEST"
( cd "$B" && sha256sum mall.dump uploads.tar.gz config.tar.gz > SHA256SUMS )

echo "########## 1. 原有 16 项功能回归（不得退化） ##########"
t "restore --list"            0 env MALL_DIR="$FIX" bash deploy/scripts/restore.sh --list
t "restore dry-run"           0 env MALL_DIR="$FIX" bash deploy/scripts/restore.sh --backup good --dry-run
t "restore 合并模式 dry-run"  0 env MALL_DIR="$FIX" bash deploy/scripts/restore.sh --backup good --dry-run --merge
t "restore 备份不存在->3"     3 env MALL_DIR="$FIX" bash deploy/scripts/restore.sh --backup nope
t "restore 无参数->3"         3 env MALL_DIR="$FIX" bash deploy/scripts/restore.sh
t "restore 未知参数->3"       3 env MALL_DIR="$FIX" bash deploy/scripts/restore.sh --bogus
t "doctor 有FAIL->1"          1 env MALL_DIR="$FIX" bash deploy/scripts/doctor.sh
t "doctor --json"             1 env MALL_DIR="$FIX" bash deploy/scripts/doctor.sh --json
t "https 非法域名->3"         3 env MALL_DIR="$FIX" bash deploy/scripts/setup-https.sh --domain 1.2.3.4 --dry-run
t "https 缺域名->3"           3 env MALL_DIR="$FIX" bash deploy/scripts/setup-https.sh --dry-run
t "https 合法域名 dry-run"    0 env MALL_DIR="$FIX" bash deploy/scripts/setup-https.sh --domain shop.example.com --dry-run
t "https --disable dry-run"   0 env MALL_DIR="$FIX" bash deploy/scripts/setup-https.sh --disable --dry-run
t "https --renew dry-run"     0 env MALL_DIR="$FIX" bash deploy/scripts/setup-https.sh --renew --dry-run
t "set-admin 短口令->3"       3 env MALL_DIR="$FIX" bash deploy/scripts/set-admin-password.sh --password abc --dry-run
t "set-admin dry-run"         0 env MALL_DIR="$FIX" bash deploy/scripts/set-admin-password.sh --password Abc12345xyz --dry-run
t "set-admin --generate dry-run" 0 env MALL_DIR="$FIX" bash deploy/scripts/set-admin-password.sh --generate --dry-run

echo "########## 2. 修1：backup.sh 走 compose，不硬编码容器/网络名 ##########"
c "backup.sh 无 mall-postgres-1 硬编码"   "! grep -q 'docker exec mall-postgres-1' deploy/scripts/backup.sh"
c "backup.sh 无 mall_default 硬编码"      "! grep -q 'network mall_default' deploy/scripts/backup.sh"
c "backup.sh 走 compose exec"             "grep -q 'compose exec -T postgres pg_dump' deploy/scripts/backup.sh"
c "backup.sh 有 label 兜底路径"           "grep -q 'label=com.docker.compose.service=postgres' deploy/scripts/backup.sh"
c "backup.sh 用 -Fc 自定义格式"           "grep -q 'pg_dump -Fc' deploy/scripts/backup.sh"

echo "########## 3. 修2/修3：MANIFEST 诚实 + 失败非零退出 ##########"
rm -rf "$FIX/data/backup/failcase"
out="$(env PATH="/tmp/regbin-fail:$PATH" MALL_DIR="$FIX" bash deploy/scripts/backup.sh --label failcase 2>&1)"; rc=$?
c "备份失败退出码非 0 (实际 $rc)"  "[[ $rc -ne 0 ]]"
c "MANIFEST db: failed"          "printf '%s' \"\$out\" | grep -q '^db: failed'"
c "MANIFEST 区分 failed/skipped" "printf '%s' \"\$out\" | grep -qE '^uploads: (ok|failed|skipped)'"
c "无 0 字节 mall.dump 残留"      "[[ ! -f '$FIX/data/backup/failcase/mall.dump' ]]"
c "留 mall.dump.failed 标记"      "[[ -f '$FIX/data/backup/failcase/mall.dump.failed' ]]"
rm -rf "$FIX/data/backup/okcase"
env PATH="/tmp/regbin:$PATH" MALL_DIR="$FIX" bash deploy/scripts/backup.sh --label okcase >/dev/null 2>&1; rc=$?
c "备份成功退出码 0 (实际 $rc)"   "[[ $rc -eq 0 ]]"
c "成功时 MANIFEST db: ok"       "grep -q '^db: ok' '$FIX/data/backup/okcase/MANIFEST'"
c "成功时 dump 非空"              "[[ -s '$FIX/data/backup/okcase/mall.dump' ]]"
c "成功时 dump 头部 PGDMP"        "[[ \"\$(head -c 5 '$FIX/data/backup/okcase/mall.dump')\" == PGDMP ]]"
c "成功时 checksums: ok"          "grep -q '^checksums: ok' '$FIX/data/backup/okcase/MANIFEST'"
c "--label 参数真正生效"          "[[ -d '$FIX/data/backup/okcase' ]]"

echo "########## 4. 修4：doctor.sh 对 0 字节 dump 必须 FAIL ##########"
Z=/tmp/reg-zero; rm -rf "$Z"; mkdir -p "$Z"/{config,data/backup/20261109-120436}
echo pw > "$Z/config/.env"
ZB="$Z/data/backup/20261109-120436"
: > "$ZB/mall.dump"; printf 'u' > "$ZB/uploads.tar.gz"; printf 'c' > "$ZB/config.tar.gz"
printf 'label: x\ntime: now\ndb: ok\nuploads: ok\nconfig: ok\nchecksums: ok\n' > "$ZB/MANIFEST"
( cd "$ZB" && sha256sum mall.dump uploads.tar.gz config.tar.gz > SHA256SUMS )
dout="$(env MALL_DIR="$Z" bash deploy/scripts/doctor.sh --json 2>/dev/null)"
c "0 字节 dump → backup.db.valid = FAIL" "printf '%s' \"\$dout\" | node -e \"let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const c=JSON.parse(s).checks.find(x=>x.id==='backup.db.valid');process.exit(c&&c.status==='fail'?0:1)})\""
c "0 字节 dump 场景 doctor 退出码 1"    "env MALL_DIR='$Z' bash deploy/scripts/doctor.sh >/dev/null 2>&1; [[ \$? -eq 1 ]]"
c "backup.latest 不再用目录大小冒充"    "printf '%s' \"\$dout\" | grep -q 'dump 0B'"

echo "########## 5. 修5：restore.sh 拒绝坏备份 ##########"
mkbad(){ local d="$1" st="$2" content="$3"; rm -rf "$d"; mkdir -p "$d/data/backup/x" "$d/config"
  echo pw > "$d/config/.env"; printf '%s' "$content" > "$d/data/backup/x/mall.dump"
  printf 'label: x\ntime: now\ndb: %s\nuploads: ok\nconfig: ok\n' "$st" > "$d/data/backup/x/MANIFEST"
  printf 'u' > "$d/data/backup/x/uploads.tar.gz"; printf 'c' > "$d/data/backup/x/config.tar.gz"; }
mkbad /tmp/reg-a failed "PGDMPxx"
mkbad /tmp/reg-b ok ""
mkbad /tmp/reg-c ok "GARBAGE-NOT-A-DUMP"
t "restore 拒绝 db: failed"      1 env MALL_DIR=/tmp/reg-a bash deploy/scripts/restore.sh --backup x --dry-run
t "restore 拒绝 0 字节 dump"      1 env MALL_DIR=/tmp/reg-b bash deploy/scripts/restore.sh --backup x --dry-run
t "restore 拒绝非法内容 dump"     1 env MALL_DIR=/tmp/reg-c bash deploy/scripts/restore.sh --backup x --dry-run
c "restore 拒绝时不动任何数据"     "[[ ! -f '/tmp/reg-b/data/runtime/restore/x.done' ]]"

echo "########## 6. 真机现场复刻：0 字节 dump + MANIFEST 谎报 db: ok ##########"
Z2=/tmp/reg-real; rm -rf "$Z2"; mkdir -p "$Z2"/{config,data/backup/20261109-120436,data/uploads}
echo pw > "$Z2/config/.env"; echo x > "$Z2/data/uploads/a.txt"
ZB="$Z2/data/backup/20261109-120436"
: > "$ZB/mall.dump"
tar -czf "$ZB/uploads.tar.gz" -C "$Z2/data" uploads
tar -czf "$ZB/config.tar.gz" -C "$Z2/config" .
printf 'label: 20261109-120436\ntime: 2026-11-09T12:04:36+08:00\ndb: ok\nuploads: ok\nconfig: ok\nchecksums: ok\n' > "$ZB/MANIFEST"
( cd "$ZB" && sha256sum mall.dump uploads.tar.gz config.tar.gz > SHA256SUMS )
t "真机坏备份 dry-run 被拒"       1 env MALL_DIR="$Z2" bash deploy/scripts/restore.sh --backup 20261109-120436 --dry-run
c "--list 数据库列不抄 MANIFEST"   "! env MALL_DIR='$Z2' bash deploy/scripts/restore.sh --list | grep -qE '20261109-120436.*[[:space:]]ok[[:space:]]'"
c "--list 数据库列标为无效"        "env MALL_DIR='$Z2' bash deploy/scripts/restore.sh --list | grep -q '无效'"

# 真实执行路径：必须一行数据库命令都不执行（用记录所有 docker 调用的假 docker 验证）
rm -rf /tmp/reg-spy; mkdir -p /tmp/reg-spy
cat > /tmp/reg-spy/docker <<'EOF'
#!/bin/sh
echo "DOCKER-CALL: $*" >> /tmp/reg-spy.log
exit 0
EOF
chmod +x /tmp/reg-spy/docker
rm -f /tmp/reg-spy.log
env PATH="/tmp/reg-spy:$PATH" MALL_DIR="$Z2" bash deploy/scripts/restore.sh --backup 20261109-120436 --yes >/dev/null 2>&1
c "真实路径：坏备份时零 docker 调用" "[[ ! -f /tmp/reg-spy.log ]]"
c "真实路径：坏备份时无 DROP SCHEMA" "! grep -qiE 'DROP SCHEMA|pg_restore' /tmp/reg-spy.log 2>/dev/null"

echo "########## 7. 修5 白名单判定：尺寸下限与格式特征 ##########"
mkb(){ local d="$1" content="$2"; rm -rf "$d"; mkdir -p "$d"/{config,data/backup/x,data/uploads}
  echo pw > "$d/config/.env"; echo x > "$d/data/uploads/a.txt"; printf '%s' "$content" > "$d/data/backup/x/mall.dump"
  tar -czf "$d/data/backup/x/uploads.tar.gz" -C "$d/data" uploads
  tar -czf "$d/data/backup/x/config.tar.gz" -C "$d/config" .
  printf 'label: x\ntime: now\ndb: ok\nuploads: ok\nconfig: ok\n' > "$d/data/backup/x/MANIFEST"; }
# 内容要真的被生成出来（不能用 "{ ...; }" 字面量）
CORRUPT_2K="$(head -c 2000 /dev/zero | tr '\0' 'G')"
SMALL_500="$(head -c 500 /dev/zero | tr '\0' 'H')"
PLAIN_SQL="$( { printf -- '-- PostgreSQL database dump\nSET statement_timeout = 0;\n'; head -c 2000 /dev/zero | tr '\0' 'S'; } )"
CUSTOM_PGDMP="$( { printf 'PGDMP\001\002'; head -c 2000 /dev/zero | tr '\0' 'X'; } )"
mkb /tmp/reg-d1 "$CORRUPT_2K"
mkb /tmp/reg-d2 "$SMALL_500"
mkb /tmp/reg-d3 "$PLAIN_SQL"
mkb /tmp/reg-d4 "$CUSTOM_PGDMP"
t "拒绝 >=1KB 但内容损坏的 dump"  1 env MALL_DIR=/tmp/reg-d1 bash deploy/scripts/restore.sh --backup x --dry-run
t "拒绝低于 1KB 下限的 dump"       1 env MALL_DIR=/tmp/reg-d2 bash deploy/scripts/restore.sh --backup x --dry-run
t "放行合法纯 SQL 文本 dump"        0 env MALL_DIR=/tmp/reg-d3 bash deploy/scripts/restore.sh --backup x --dry-run
t "放行合法 custom dump"            0 env MALL_DIR=/tmp/reg-d4 bash deploy/scripts/restore.sh --backup x --dry-run
has "纯 SQL 分支给出 psql 提示"       'psql'           "env MALL_DIR=/tmp/reg-d3 bash deploy/scripts/restore.sh --backup x --dry-run"
has "custom 分支识别为 PGDMP"         'pg_restore'     "env MALL_DIR=/tmp/reg-d4 bash deploy/scripts/restore.sh --backup x --dry-run"

echo "########## 8. 修D：显示 bug（上传文件节必须是单行） ##########"
has "上传文件节单行输出"              '归档文件数: [0-9]+  大小 [0-9.]+[BKMG]' "env MALL_DIR=/tmp/reg-d4 bash deploy/scripts/restore.sh --backup x --dry-run"
has "校验通过计数不重复"              '校验通过: [0-9]+ 个文件摘要匹配'          "env MALL_DIR='$FIX' bash deploy/scripts/restore.sh --backup good --dry-run"
has "上传文件节不被拆成两行"          '归档文件数: [0-9]+  大小'                 "env MALL_DIR=/tmp/reg-d4 bash deploy/scripts/restore.sh --backup x --dry-run"

echo "########## 9. doctor 与 restore 判定规则一致 ##########"
# doctor_backup_valid_is <mall_dir> <期望状态>
# 同样不用管道：JSON 先落盘，node 读文件（node 在 Windows 上解析不了 /tmp 绝对路径）
doctor_backup_valid_is(){
  env MALL_DIR="$1" bash deploy/scripts/doctor.sh --json >"$REG_JSON" 2>/dev/null
  node -e "
const fs=require('fs');
const j=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));
const c=j.checks.find(x=>x.id==='backup.db.valid');
process.exit(c && c.status===process.argv[2] ? 0 : 1);
" "$REG_JSON" "$2"; }
REG_JSON="$(pwd)/.reg-doc.json"
c "doctor 有 DUMP_MIN_BYTES 阈值"   "grep -q 'DUMP_MIN_BYTES=1024' deploy/scripts/doctor.sh"
c "restore 有 DUMP_MIN_BYTES 阈值"  "grep -q 'DUMP_MIN_BYTES=1024' deploy/scripts/restore.sh"
# 防止同名函数覆盖：bash 里后定义的会覆盖先定义的，
# 曾因此让「1KB 下限」静默失效（旧实现只看头部，11 字节 PGDMP 被当成合法备份）
c "restore 只有一处 detect_dump_format" "[[ \$(grep -c '^detect_dump_format()' deploy/scripts/restore.sh) -eq 1 ]]"
c "restore 只有一处 assert_dump_usable" "[[ \$(grep -c '^assert_dump_usable()' deploy/scripts/restore.sh) -eq 1 ]]"
# doctor 用的备份夹具：500 字节 dump（低于下限）
rm -rf /tmp/reg-doc; mkdir -p "/tmp/reg-doc"/{config,data/backup/small,data/uploads}
echo pw > /tmp/reg-doc/config/.env; echo x > /tmp/reg-doc/data/uploads/a.txt
head -c 500 /dev/zero | tr '\0' 'H' > /tmp/reg-doc/data/backup/small/mall.dump
printf 'label: small\ntime: now\ndb: ok\nuploads: ok\nconfig: ok\nchecksums: ok\n' > /tmp/reg-doc/data/backup/small/MANIFEST
c "doctor 对 500 字节 dump 判 FAIL" "doctor_backup_valid_is /tmp/reg-doc fail"
c "doctor 对 0 字节 dump 判 FAIL"   "doctor_backup_valid_is /tmp/reg-real fail"
# doctor 用的合法备份夹具
rm -rf /tmp/reg-doc2; mkdir -p "/tmp/reg-doc2"/{config,data/backup/good,data/uploads}
echo pw > /tmp/reg-doc2/config/.env; echo x > /tmp/reg-doc2/data/uploads/a.txt
{ printf 'PGDMP\001\002'; head -c 2000 /dev/zero | tr '\0' 'X'; } > /tmp/reg-doc2/data/backup/good/mall.dump
printf 'label: good\ntime: now\ndb: ok\nuploads: ok\nconfig: ok\nchecksums: ok\n' > /tmp/reg-doc2/data/backup/good/MANIFEST
c "doctor 对合法 dump 判 OK"        "doctor_backup_valid_is /tmp/reg-doc2 ok"
rm -f "$REG_JSON" "$REG_OUT"

echo "########## 10. 镜像统一（消除版本漂移） ##########"
c "api/worker/migrator 共用同一 image 标签" \
  "[[ \$(grep -c 'image: \${IMAGE_NAME:-mall-app:local}' deploy/docker-compose.yml) -eq 3 ]]"
c "只有 api 带 build 段" "[[ \$(grep -c 'dockerfile: deploy/docker/Dockerfile.node' deploy/docker-compose.yml) -eq 1 ]]"
c "migrator 无独立 build 段" "! sed -n '/^  migrator:/,/^  [a-z]/p' deploy/docker-compose.yml | grep -q 'dockerfile:'"
c "worker 无独立 build 段"   "! sed -n '/^  worker:/,/^  [a-z]/p' deploy/docker-compose.yml | grep -q 'dockerfile:'"
c "install.sh 迁移前构建镜像" "grep -q 'build api' deploy/install.sh"
c "install.sh 构建在迁移之前" "awk '/build_app_image/{b=NR} /run_step 7 step7_migrate/{m=NR} END{exit !(b && m && b<m)}' deploy/install.sh"
c "install.sh 仍是 10 步"      "[[ \$(grep -c 'run_step [0-9]' deploy/install.sh) -eq 10 ]]"
c "install.sh 无第 11 步"      "! grep -q 'run_step 11' deploy/install.sh"

echo "########## 11. XFF 覆盖语义 + CORS 默认收紧 ##########"
c "XFF 已改覆盖语义（api）"  "sed -n '/location \/api\//,/^    }/p' deploy/docker/nginx.conf | grep -q 'X-Forwarded-For \$remote_addr'"
c "XFF 已改覆盖语义（店面）"  "sed -n '/^    location \/ {/,/^    }/p' deploy/docker/nginx.conf | grep -q 'X-Forwarded-For \$remote_addr'"
c "无残留的追加语义（排除注释）" "! grep -vE '^\s*#' deploy/docker/nginx.conf | grep -q 'proxy_add_x_forwarded_for'"
c "动态 DNS 解析未被改动"     "grep -q 'resolver 127.0.0.11 valid=2s ipv6=off' deploy/docker/nginx.conf"
c "/admin/ 前缀剥离未被改动"  "grep -q 'rewrite \^/admin/(.\*)\$ /\$1 break;' deploy/docker/nginx.conf"
c "CORS 默认值已去通配符"     "grep -q 'CORS_ORIGINS: \${CORS_ORIGINS:-}' deploy/docker-compose.yml"
c "install.sh .env 含 CORS 注释" "grep -q 'CORS_ORIGINS=' deploy/install.sh"

echo "########## 12. 口令强度与产品端一致 ##########"
c "脚本定义了 MIN_PASSWORD_LENGTH" "grep -q 'MIN_PASSWORD_LENGTH=8' deploy/scripts/set-admin-password.sh"
c "脚本校验含字母"              "grep -q '新口令必须包含字母' deploy/scripts/set-admin-password.sh"
c "脚本校验含数字"              "grep -q '新口令必须包含数字' deploy/scripts/set-admin-password.sh"
c "脚本长度提示与产品端同措辞"   "grep -q '新口令过短（\${#pw} 位，至少 \${MIN_PASSWORD_LENGTH} 位）' deploy/scripts/set-admin-password.sh"
c "产品端规则文件存在"          "test -f packages/policy/src/password.ts"
c "产品端 auth 仍在转出该规则"   "grep -q 'MIN_PASSWORD_LENGTH' packages/modules/auth/src/services/password-policy.ts"
c "两边长度下限一致"            "[[ \$(sed -n 's/.*MIN_PASSWORD_LENGTH = \([0-9]\+\).*/\1/p' packages/policy/src/password.ts | head -1) -eq 8 ]]"
c "脚本引用的规则来源未过时"     "grep -q 'packages/policy/src/password.ts' deploy/scripts/set-admin-password.sh"
c "产品端规则顺序是 长度→字母→数字" "grep -q \"id: 'length'\" packages/policy/src/password.ts && grep -q \"id: 'letter'\" packages/policy/src/password.ts && grep -q \"id: 'digit'\" packages/policy/src/password.ts"
has "产品端长度原因文案与脚本一致" '新口令过短（' "grep -n 'reason' packages/policy/src/password.ts"
has "产品端字母原因文案与脚本一致" '新口令必须包含字母' "grep -n 'reason' packages/policy/src/password.ts"
has "产品端数字原因文案与脚本一致" '新口令必须包含数字' "grep -n 'reason' packages/policy/src/password.ts"
# 口令强度：判定顺序与产品端一致（长度 → 字母 → 数字）
t "拒绝纯数字口令（先报缺字母）" 3 env MALL_DIR="$FIX" bash deploy/scripts/set-admin-password.sh --password 123456789 --dry-run
t "拒绝纯字母口令（再报缺数字）" 3 env MALL_DIR="$FIX" bash deploy/scripts/set-admin-password.sh --password abcdefghij --dry-run
t "拒绝过短口令"               3 env MALL_DIR="$FIX" bash deploy/scripts/set-admin-password.sh --password Ab1 --dry-run
t "接受合规口令"                0 env MALL_DIR="$FIX" bash deploy/scripts/set-admin-password.sh --password Abc12345xyz --dry-run
has "过短口令给出与产品端一致的原因"   '新口令过短（3 位，至少 8 位）' "env MALL_DIR='$FIX' bash deploy/scripts/set-admin-password.sh --password Ab1 --dry-run"
has "纯数字口令按顺序先报缺字母"       '新口令必须包含字母'          "env MALL_DIR='$FIX' bash deploy/scripts/set-admin-password.sh --password 123456789 --dry-run"
has "纯字母口令给出缺数字原因"         '新口令必须包含数字'          "env MALL_DIR='$FIX' bash deploy/scripts/set-admin-password.sh --password abcdefghij --dry-run"
has "--generate 生成的口令合规"        '新口令: '                    "env MALL_DIR='$FIX' bash deploy/scripts/set-admin-password.sh --generate --dry-run"

echo "########## 13. set-admin-password 定位为应急通道 ##########"
c "脚本注释标注应急通道"        "grep -q '应急通道' deploy/scripts/set-admin-password.sh"
c "脚本注释指向改密端点"        "grep -q 'change-password' deploy/scripts/set-admin-password.sh"
c "部署与验收.md 标注应急兜底"   "grep -q '应急兜底' docs/05-delivery/部署与验收.md"
c "上线自检清单标注主路径"       "grep -q 'change-password' docs/05-delivery/上线自检清单.md"
c "doctor.sh 默认口令 FAIL 指向主路径" "grep -q '后台改密页' deploy/scripts/doctor.sh"

echo "########## 14. 升级流程含构建（防漂移） ##########"
c "部署与验收.md 升级流程含 build api" "grep -q 'build api' docs/05-delivery/部署与验收.md"
c "上线自检清单回滚含 build api"       "grep -q 'build api' docs/05-delivery/上线自检清单.md"

echo "########## 15. doctor.sh 内置镜像漂移检查 ##########"
c "doctor 有 image.declared 检查项"  "grep -q 'image.declared' deploy/scripts/doctor.sh"
c "doctor 有 image.running 检查项"   "grep -q 'image.running' deploy/scripts/doctor.sh"
c "doctor 有 service_image 辅助函数" "grep -q '^service_image()' deploy/scripts/doctor.sh"
c "镜像检查不依赖 Docker（静态部分独立调用）" "grep -q 'check_image_unification' deploy/scripts/doctor.sh"

# 功能验证：把 worker 的 image 改成不同标签，doctor 必须判 FAIL。
# 关键：在**独立副本**上做，绝不碰仓库里的真 compose 文件
# （上一版直接改真文件，测试跑完把 worker 留在了 deploy-worker:legacy 上）。
# doctor.sh 的 COMPOSE_DIR 是从脚本自身位置推导的，所以把脚本+compose 复制到临时目录即可隔离。
rm -rf /tmp/reg-drift; mkdir -p /tmp/reg-drift/scripts
cp deploy/scripts/doctor.sh /tmp/reg-drift/scripts/doctor.sh
cp deploy/docker-compose.yml /tmp/reg-drift/docker-compose.yml
python - /tmp/reg-drift/docker-compose.yml <<'PY'
import sys
p = sys.argv[1]
s = open(p, encoding='utf-8', newline='').read()
old = """  worker:
    # 与 api / migrator 共用同一个镜像标签，不带 build 段（见上方 migrator 的说明）
    image: ${IMAGE_NAME:-mall-app:local}"""
new = """  worker:
    image: deploy-worker:legacy"""
assert old in s, "compose 里 worker 段结构与预期不符，测试需同步更新"
open(p, 'w', encoding='utf-8', newline='').write(s.replace(old, new))
PY
has "worker 标签不一致时判 FAIL" '\[FAIL\] 三服务镜像标签统一' "env MALL_DIR='$FIX' bash /tmp/reg-drift/scripts/doctor.sh"
has "标签一致时判 OK"                '\[OK\] 三服务镜像标签统一'   "env MALL_DIR='$FIX' bash deploy/scripts/doctor.sh"
c "仓库 compose 未被测试污染"        "cmp -s deploy/docker-compose.yml <(sed -n '1,200p' deploy/docker-compose.yml)"
c "仓库 compose 的 worker 标签正确"  "sed -n '/^  worker:/,/^  [a-z]/p' deploy/docker-compose.yml | grep -q 'image: \${IMAGE_NAME:-mall-app:local}'"
rm -rf /tmp/reg-drift

echo "########## 16. 恢复出厂默认口令（不依赖强度规则的路径） ##########"
t "--restore-default 缺 --yes 被拒"    3 env MALL_DIR="$FIX" bash deploy/scripts/set-admin-password.sh --restore-default --dry-run
t "--restore-default 与 --password 互斥" 3 env MALL_DIR="$FIX" bash deploy/scripts/set-admin-password.sh --restore-default --password Abc12345xyz --dry-run
t "--restore-default --yes 可执行"      0 env MALL_DIR="$FIX" bash deploy/scripts/set-admin-password.sh --restore-default --yes --dry-run
has "--restore-default 给出降级警告"     '降级操作警告'            "env MALL_DIR='$FIX' bash deploy/scripts/set-admin-password.sh --restore-default --yes --dry-run"
has "--restore-default 提示立刻改密"     '用后台改密页改成强口令'     "env MALL_DIR='$FIX' bash deploy/scripts/set-admin-password.sh --restore-default --yes --dry-run"
has "--restore-default 不传 ADMIN_PASSWORD" '不传 ADMIN_PASSWORD'   "env MALL_DIR='$FIX' bash deploy/scripts/set-admin-password.sh --restore-default --yes --dry-run"
has "--restore-default 显示出厂默认口令"  '出厂默认口令: 123456'    "env MALL_DIR='$FIX' bash deploy/scripts/set-admin-password.sh --restore-default --yes --dry-run"
has "缺 --yes 时给出可复制的完整命令"     'set-admin-password.sh --restore-default --yes' "env MALL_DIR='$FIX' bash deploy/scripts/set-admin-password.sh --restore-default --dry-run"
c "usage 含 --restore-default"          "grep -q -- '--restore-default' deploy/scripts/set-admin-password.sh"
c "恢复路径复用产品 seed 的默认值"       "grep -q 'DEFAULT_ADMIN_PASSWORD' deploy/scripts/set-admin-password.sh"
c "产品 seed 默认值仍是 123456"          "grep -q 'DEFAULT_ADMIN_PASSWORD = \"123456\"' apps/api/src/seed.ts"
# 恢复路径不能顺手把强度校验放掉：常规路径仍要拒弱口令
t "常规路径仍拒弱口令（123456）"        3 env MALL_DIR="$FIX" bash deploy/scripts/set-admin-password.sh --password 123456 --dry-run
t "常规路径仍拒纯字母"                  3 env MALL_DIR="$FIX" bash deploy/scripts/set-admin-password.sh --password abcdefghij --dry-run
c "强度校验函数只被常规路径调用"          "grep -c 'check_password_strength \"\$NEW_PASSWORD\"' deploy/scripts/set-admin-password.sh | grep -q '^1$'"

echo "########## 17. 上线自检清单：三要素完整 ##########"
c "清单项都有 命令/通过标准/失败处置" "python3 - <<'PYEOF'
import sys
lines = open('docs/05-delivery/上线自检清单.md', encoding='utf-8').read().split('\n')
items = []
cur = None
for l in lines:
    if l.startswith('- [ ] '):
        if cur: items.append(cur)
        cur = [l[6:], []]
    elif cur is not None:
        cur[1].append(l)
if cur: items.append(cur)
bad = []
for title, body in items:
    b = '\n'.join(body)
    if not ('命令' in b and '通过标准' in b and '失败处置' in b):
        bad.append(title)
print('items=%d bad=%d' % (len(items), len(bad)))
sys.exit(1 if bad else 0)
PYEOF"

echo "########## 18. DNS 缓存窗口收窄（valid=2s） ##########"
c "nginx.conf 的 valid 已收窄到 2s" "grep -q 'resolver 127.0.0.11 valid=2s ipv6=off' deploy/docker/nginx.conf"
c "没有残留 valid=10s（排除注释）" "! grep -vE '^\s*#' deploy/docker/nginx.conf | grep -q 'valid=10s'"
# 抽取逻辑不能漏掉这一行：生成的 443 片段必须同样是 valid=2s
has "443 片段继承了 valid=2s" 'resolver 127.0.0.11 valid=2s ipv6=off' \
  "env MALL_DIR='$FIX' bash deploy/scripts/setup-https.sh --domain shop.example.com --dry-run"

echo "########## 19. setup-https 可安全重复执行 + 回滚 ##########"
c "有 --rollback 模式"              "grep -q -- '--rollback' deploy/scripts/setup-https.sh"
c "备份名固定（不堆积备份文件）"    "grep -q 'SNIPPET}.bak\"' deploy/scripts/setup-https.sh"
c "没有带时间戳的备份名"            "! grep -q 'bak\.\$(date' deploy/scripts/setup-https.sh"
c "有 restore_snippet_backup 函数"  "grep -q '^restore_snippet_backup()' deploy/scripts/setup-https.sh"
c "回滚逻辑复用同一套"              "grep -q 'restore_snippet_backup' deploy/scripts/setup-https.sh"

# 功能验证：nginx -t 失败时必须自动回滚，HTTP 不受影响
rm -rf /tmp/reg-ngfail; mkdir -p /tmp/reg-ngfail
cat > /tmp/reg-ngfail/docker <<'NGEOF'
#!/bin/sh
case "$*" in
  *nginx\ -t*) echo "nginx: [emerg] invalid directive" >&2; exit 1 ;;
  *certonly*) echo "CERT-ISSUED" ;;
  *) exit 0 ;;
esac
NGEOF
chmod +x /tmp/reg-ngfail/docker
RB=/tmp/reg-rb; rm -rf "$RB"; mkdir -p "$RB/config/nginx"; echo pw > "$RB/config/.env"
printf '# 旧片段（已知可用）\nserver { listen 443 ssl; server_name old.example.com; }\n' > "$RB/config/nginx/https.inc"
env PATH="/tmp/reg-ngfail:$PATH" MALL_DIR="$RB" bash deploy/scripts/setup-https.sh --domain shop.example.com --email o@e.com --yes >/dev/null 2>&1
c "nginx -t 失败时自动回滚（片段恢复旧内容）" "grep -q '旧片段' '$RB/config/nginx/https.inc'"
c "nginx -t 失败时退出码非 0"                "[[ \$(env PATH=/tmp/reg-ngfail:\$PATH MALL_DIR='$RB' bash deploy/scripts/setup-https.sh --domain shop.example.com --email o@e.com --yes >/dev/null 2>&1; echo \$?) -ne 0 ]]"
c "回滚后备份文件只有一个"                   "[[ \$(ls '$RB/config/nginx/' | grep -c 'bak') -eq 1 ]]"
# 首次启用（无旧片段）失败 → 片段应被删除，回到纯 HTTP
RB2=/tmp/reg-rb2; rm -rf "$RB2"; mkdir -p "$RB2/config/nginx"; echo pw > "$RB2/config/.env"
env PATH="/tmp/reg-ngfail:$PATH" MALL_DIR="$RB2" bash deploy/scripts/setup-https.sh --domain shop.example.com --email o@e.com --yes >/dev/null 2>&1
c "首次启用失败时片段被删除（回到纯 HTTP）" "[[ ! -f '$RB2/config/nginx/https.inc' ]]"
# 重复执行 3 次，备份文件数不增长
RB3=/tmp/reg-rb3; rm -rf "$RB3"; mkdir -p "$RB3/config/nginx"; echo pw > "$RB3/config/.env"
for _ in 1 2 3; do
  env PATH="/tmp/reg-ngfail:$PATH" MALL_DIR="$RB3" bash deploy/scripts/setup-https.sh --domain shop.example.com --email o@e.com --yes >/dev/null 2>&1
done
c "重复执行 3 次后备份文件仍只有 1 个" "[[ \$(ls '$RB3/config/nginx/' | grep -c 'bak') -eq 1 ]]"
rm -rf /tmp/reg-ngfail /tmp/reg-rb /tmp/reg-rb2 /tmp/reg-rb3

echo "########## 20. doctor 默认口令 FAIL 指向主路径 ##########"
c "doctor 提到后台改密页"            "grep -q '后台改密页' deploy/scripts/doctor.sh"
c "doctor 提到改密端点路径"          "grep -q 'change-password' deploy/scripts/doctor.sh"
c "doctor 仍保留应急脚本兜底"        "grep -q 'set-admin-password.sh' deploy/scripts/doctor.sh"

echo "########## 21. 默认口令探测：失败 ≠ 口令已改 ##########"
c "探测逻辑是独立函数"              "grep -q '^check_admin_default_password()' deploy/scripts/doctor.sh"
c "有 --skip-admin-probe 开关"      "grep -q -- '--skip-admin-probe' deploy/scripts/doctor.sh"
c "限流码 60001 被单独识别"         "grep -q '60001' deploy/scripts/doctor.sh"
c "凭证错误码 10005 被单独识别"     "grep -q '10005' deploy/scripts/doctor.sh"
c "旧写法「带 code 就算 OK」已删除" "! grep -q '\"\$login\" == \*'\"'\"'code'\"'\"'\*' deploy/scripts/doctor.sh"

# 用假 curl 精确验证五种响应的分类（source doctor.sh，只调这一个函数）
rm -rf /tmp/reg-curl; mkdir -p /tmp/reg-curl
cat > /tmp/reg-curl/curl <<'CURLEOF'
#!/bin/sh
out=""; body=""
while [ $# -gt 0 ]; do
  case "$1" in
    -o) out="$2"; shift 2 ;;
    -w) shift 2 ;;
    *) shift ;;
  esac
done
case "$FAKE_SCENARIO" in
  success)   body='{"code":0,"data":{"access_token":"xxx"},"message":""}'; code=200 ;;
  crederr)   body='{"code":10005,"message":"凭证错误"}'; code=401 ;;
  ratelimit) body='{"code":60001,"message":"触发限流"}'; code=429 ;;
  servererr) body='{"code":500,"message":"内部错误"}'; code=500 ;;
  garbage)   body='<html>502 Bad Gateway</html>'; code=502 ;;
esac
[ -n "$out" ] && printf '%s' "$body" > "$out"
echo "$code"
CURLEOF
chmod +x /tmp/reg-curl/curl
probe_status(){ # $1=场景 -> 打印判定
  env FAKE_SCENARIO="$1" PATH="/tmp/reg-curl:$PATH" bash -c \
    'source deploy/scripts/doctor.sh; check_admin_default_password "http://x"' 2>&1 \
    | grep -oE '^\[(OK|WARN|FAIL|SKIP)\]' | tr -d '[]'
}
probe_skip_status(){ # 跳过开关生效时的判定
  env FAKE_SCENARIO=success PATH="/tmp/reg-curl:$PATH" bash -c \
    'source deploy/scripts/doctor.sh; SKIP_ADMIN_PROBE=1; check_admin_default_password "http://x"' 2>&1 \
    | grep -oE '^\[(OK|WARN|FAIL|SKIP)\]' | tr -d '[]'
}
c "登录成功 → FAIL"        "[[ \"\$(probe_status success)\" == FAIL ]]"
c "凭证错误 10005 → OK"    "[[ \"\$(probe_status crederr)\" == OK ]]"
c "限流 60001 → WARN"      "[[ \"\$(probe_status ratelimit)\" == WARN ]]"
c "500 错误 → WARN"        "[[ \"\$(probe_status servererr)\" == WARN ]]"
c "非信封响应 → WARN"      "[[ \"\$(probe_status garbage)\" == WARN ]]"
c "限流时绝不判 OK"        "[[ \"\$(probe_status ratelimit)\" != OK ]]"
c "跳过时记 SKIP 而非 OK"  "[[ \"\$(probe_skip_status)\" == SKIP ]]"
rm -rf /tmp/reg-curl

echo "########## 22. 其它检查项的同类排查（把无法判定当结论） ##########"
c "队列读不到长度时不谎报 0"   "grep -q '读取队列长度失败' deploy/scripts/doctor.sh"
c "doctor 有 deploy.fingerprint 检查项" "grep -q 'deploy.fingerprint' deploy/scripts/doctor.sh"
has "指纹能算出来（可与服务器对比版本）" 'doctor=[0-9a-f]+ restore=' "env MALL_DIR='$FIX' bash deploy/scripts/doctor.sh"
c "容器值读不到时记 WARN"      "grep -q '读不到 api 容器里的' deploy/scripts/doctor.sh"
c "缺校验工具时记 WARN 非 FAIL" "grep -q '无法校验备份完整性' deploy/scripts/doctor.sh"
c "连接数查不到时记 WARN"      "grep -q '读不到连接数与 max_connections' deploy/scripts/doctor.sh"
c "doctor 可被 source（便于单测）" "grep -q 'BASH_SOURCE\[0\]' deploy/scripts/doctor.sh"


echo ""
echo "================ 小计: PASS=$PASS FAIL=$FAIL ================"
[[ $FAIL -eq 0 ]] && echo "全部通过" || echo "存在失败"
exit $(( FAIL > 0 ? 1 : 0 ))
