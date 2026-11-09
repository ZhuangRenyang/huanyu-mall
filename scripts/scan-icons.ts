import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * scan-icons.ts — 图标合规扫描（架构 §1.2 不变式 / AC-12）。
 * 检测：emoji 功能图标 + 非 lucide-react 图标导入。
 * 扫描 apps/storefront、apps/admin、packages/ui（前端包由前端同学建设，目录缺失时优雅跳过）。
 */

const SCAN_ROOTS = [
  join(process.cwd(), "apps", "storefront"),
  join(process.cwd(), "apps", "admin"),
  join(process.cwd(), "packages", "ui"),
];

const SOURCE_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);

// 已知非 lucide 图标库（出现即违规，全项目唯一图标库 = lucide-react）。
const BANNED_ICON_LIBS = [
  "react-icons",
  "@heroicons/react",
  "@iconify",
  "@mui/icons-material",
  "feather-icons",
  "react-feather",
  "phosphor-react",
  "font-awesome",
  "@fortawesome",
];

// Emoji_Presentation：仅匹配默认按 emoji 呈现的图形字符（😀🚀🔥），
// 不误报 © ® ™ 等文本默认符号（版权/商标/箭头属于合法正文）。
const EMOJI_RE = /\p{Emoji_Presentation}/u;
const IMPORT_RE = /(?:import\s+(?:[\s\S]*?\s+from\s+)?["']([^"']+)["'])|(?:from\s+["']([^"']+)["'])/g;

interface Violation {
  file: string;
  line: number;
  kind: string;
  detail: string;
}

function collectSourceFiles(root: string): string[] {
  const out: string[] = [];
  if (!existsSync(root)) return out;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const full = join(root, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist" || entry.name === ".next") continue;
      out.push(...collectSourceFiles(full));
    } else if (SOURCE_EXT.has(join("", `.${entry.name.split(".").pop()}`))) {
      out.push(full);
    }
  }
  return out;
}

function check(): void {
  const files: string[] = [];
  for (const root of SCAN_ROOTS) {
    if (!existsSync(root)) {
      console.log(`skip（目录不存在）: ${root}`);
      continue;
    }
    files.push(...collectSourceFiles(root));
  }

  const violations: Violation[] = [];

  for (const file of files) {
    const lines = readFileSync(file, "utf8").split("\n");
    const rel = file.replace(process.cwd() + "/", "");

    lines.forEach((line, i) => {
      if (EMOJI_RE.test(line)) {
        violations.push({ file: rel, line: i + 1, kind: "emoji", detail: line.trim() });
      }
    });

    const raw = lines.join("\n");
    for (const match of raw.matchAll(IMPORT_RE)) {
      const spec = match[1] ?? match[2];
      if (!spec) continue;
      if (BANNED_ICON_LIBS.some((lib) => spec === lib || spec.startsWith(`${lib}/`))) {
        const lineNo = raw.slice(0, match.index).split("\n").length;
        violations.push({ file: rel, line: lineNo, kind: "non-lucide-icon", detail: spec });
      }
    }
  }

  if (violations.length > 0) {
    console.error("FAIL: 图标合规违规：");
    for (const v of violations) {
      console.error(`  - ${v.file}:${v.line} [${v.kind}] ${v.detail}`);
    }
    process.exit(1);
  }
  console.log(`PASS: 扫描 ${files.length} 个文件，0 emoji 功能图标、0 非 lucide 图标。`);
}

check();
