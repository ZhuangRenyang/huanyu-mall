#!/usr/bin/env bash
set -euo pipefail

# tuning.sh — 按内存/CPU 自动调参（架构 §9.4 + SPEC §10）。
# 生成 PostgreSQL 与 Redis 参数，写入 config/ 供 compose 挂载。
# 小机器保守、大机器放开；宁可低性能，不可启动失败。
# 用法: bash tuning.sh [mem_gb] [cpus]   （不传则自动探测 /proc 与 nproc）

MALL_DIR="${MALL_DIR:-/opt/mall}"
PG_OUT="${MALL_DIR}/config/pg.conf"
REDIS_OUT="${MALL_DIR}/config/redis.conf"
SUMMARY_OUT="${MALL_DIR}/config/tuning.env"

mem_gb="${1:-$(awk '/MemTotal/{printf "%d", $2/1048576}' /proc/meminfo 2>/dev/null || echo 4)}"
cpus="${2:-$(nproc 2>/dev/null || echo 2)}"
[[ -n "${mem_gb}" && "${mem_gb}" =~ ^[0-9]+$ ]] || mem_gb=4
[[ -n "${cpus}" && "${cpus}" =~ ^[0-9]+$ ]] || cpus=2

# 档位：S(<4G) M(4-8) L(8-16) XL(>=16)
if   (( mem_gb < 4 ));  then tier=S
elif (( mem_gb < 8 ));  then tier=M
elif (( mem_gb < 16 )); then tier=L
else                       tier=XL
fi

# PG：shared_buffers 取内存 25%，但不超过档位上限；work_mem 随档位递增
case "$tier" in
  S)  sb_cap=256; wm=2;  mc=40;  redis_max="128mb" ;;
  M)  sb_cap=512; wm=4;  mc=80;  redis_max="256mb" ;;
  L)  sb_cap=1024; wm=8; mc=160; redis_max="512mb" ;;
  XL) sb_cap=2048; wm=16; mc=320; redis_max="1gb" ;;
esac
sb=$(( mem_gb * 1024 / 4 ))            # 25% of RAM (MB)
(( sb > sb_cap )) && sb=$sb_cap
# 保守下限：shared_buffers 至少 128MB，PG 才够用
(( sb < 128 )) && sb=128

mkdir -p "${MALL_DIR}/config"

cat > "$PG_OUT" <<EOF
# 由 tuning.sh 生成（${tier} 档，内存 ${mem_gb}G / ${cpus} 核）
shared_buffers = ${sb}MB
effective_cache_size = $(( mem_gb * 1024 * 3 / 4 ))MB
work_mem = ${wm}MB
maintenance_work_mem = $(( sb / 4 ))MB
max_connections = ${mc}
max_worker_processes = ${cpus}
max_parallel_workers = ${cpus}
max_parallel_workers_per_gather = $(( cpus > 4 ? 4 : cpus ))
wal_buffers = $(( sb / 32 < 16 ? 16 : sb / 32 ))MB
checkpoint_completion_target = 0.9
random_page_cost = 1.1
EOF

cat > "$REDIS_OUT" <<EOF
# 由 tuning.sh 生成（${tier} 档）
maxmemory ${redis_max}
maxmemory-policy allkeys-lru
appendonly yes
EOF

cat > "$SUMMARY_OUT" <<EOF
TIER=${tier}
MEM_GB=${mem_gb}
CPUS=${cpus}
SHARED_BUFFERS_MB=${sb}
REDIS_MAXMEMORY=${redis_max}
EOF

echo "[tuning] 档位=${tier} (内存 ${mem_gb}G / ${cpus} 核)"
echo "[tuning] PG  shared_buffers=${sb}MB  max_connections=${mc}  work_mem=${wm}MB"
echo "[tuning] Redis maxmemory=${redis_max}"
echo "[tuning] 已写: ${PG_OUT} / ${REDIS_OUT} / ${SUMMARY_OUT}"
