/**
 * 密钥泄露扫描（提交前门禁）。
 *
 * 起因：一次部署体检的输出 `d.json` 被提交进公开仓库，里面带着 doctor.sh 生成的
 * **真实 ** JWT_SECRET / ENCRYPTION_KEY / POSTGRES_PASSWORD。GitHub 随后报警，
 * 但这三个值已经公开了很久 —— 代码里改掉没用，只能轮换。
 *
 * 这个脚本守的是"别再发生"：源码里出现高熵密钥、私钥块、云厂商 key 前缀就红。
 *
 * 判据（故意保守，宁可放过也不乱报）：
 * - 32/40/64 位十六进制，且**不是**明显低熵（如全 a、0123456789abcdef 重复）；
 * - PEM 私钥块；
 * - 常见平台的 key 前缀（sk_live_ / AKIA / AIza ...）。
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const SCAN_DIRS = ["apps", "packages", "deploy", "scripts"];
const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  ".next",
  ".turbo",
  "coverage",
  ".git",
  ".workbuddy",
]);
/** 允许出现假密钥的目录（测试用，且已用低熵串）。 */
const SKIP_PATH_PARTS = ["__tests__", ".test.", ".spec."];

interface Finding {
  file: string;
  line: number;
  kind: string;
  /** 只输出前 6 位，避免二次泄露。 */
  head: string;
}

const RULES: Array<{ kind: string; re: RegExp }> = [
  { kind: "PEM 私钥", re: /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { kind: "Stripe live key", re: /\bsk_live_[A-Za-z0-9]{16,}/ },
  { kind: "AWS access key", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { kind: "Google API key", re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { kind: "GitHub token", re: /\bgh[pousr]_[A-Za-z0-9]{36,}/ },
  { kind: "Slack token", re: /\bxox[abprs]-[A-Za-z0-9-]{10,}/ },
  // 微信支付 APIv3 密钥 / 商户密钥：32 位十六进制，且不在测试目录
  { kind: "疑似微信支付密钥", re: /\b[0-9a-f]{32}\b/i },
  { kind: "疑似 64 位密钥", re: /\b[0-9a-f]{64}\b/i },
];

/** 低熵判定：全同字符、顺序串、重复块 —— 这些是测试占位，不是真密钥。 */
function isLowEntropy(value: string): boolean {
  const lower = value.toLowerCase();
  if (new Set(lower).size <= 3) return true; // 全 a / 全 0
  if ("0123456789abcdef".repeat(4).startsWith(lower)) return true; // 顺序 hex
  if (/^(.{2,8})\1+$/.test(lower)) return true; // abababab / abcabcabc
  return false;
}

function walk(dir: string, out: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|js|mjs|cjs|json|sh|ya?ml|env|sql)$/.test(name)) out.push(full);
  }
}

const files: string[] = [];
for (const d of SCAN_DIRS) walk(join(ROOT, d), files);

const findings: Finding[] = [];
for (const file of files) {
  const rel = relative(ROOT, file).replace(/\\/g, "/");
  if (SKIP_PATH_PARTS.some((p) => rel.includes(p))) continue;

  let content: string;
  try {
    content = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  // 大文件与 lock 文件跳过
  if (content.length > 2_000_000 || rel.includes("pnpm-lock")) continue;

  const lines = content.split("\n");
  lines.forEach((line, idx) => {
    if (line.length > 4000) return;
    for (const rule of RULES) {
      const m = line.match(rule.re);
      if (!m) continue;
      const value = m[0];
      // 只对十六进制类做低熵过滤（PEM/平台前缀本身就是强特征）
      if (rule.kind.startsWith("疑似") && isLowEntropy(value)) continue;
      findings.push({
        file: rel,
        line: idx + 1,
        kind: rule.kind,
        head: value.slice(0, 6),
      });
    }
  });
}

if (findings.length === 0) {
  console.log(`PASS: 扫描 ${files.length} 个文件，未发现疑似密钥。`);
  process.exit(0);
}

console.error(`FAIL: 发现 ${findings.length} 处疑似密钥 —— 不要提交，先换成环境变量：`);
for (const f of findings) {
  console.error(`  ${f.file}:${f.line}  ${f.kind}  (${f.head}…)`);
}
console.error(
  "\n提示：真密钥只放部署机的 config/.env；仓库里连测试数据都别用高熵 hex（会被 GitHub 反复告警）。",
);
process.exit(1);
