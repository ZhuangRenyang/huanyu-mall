import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * lint-migrations.ts — 迁移破坏性变更拦截（架构 §1.2 不变式 7 / AC-11）。
 * 迁移只增不删：拦截 DROP TABLE/COLUMN/INDEX/VIEW、TRUNCATE、ALTER COLUMN ... TYPE。
 * 扫描 packages 下各模块 migrations 目录中的 .sql 文件。
 */

const BANNED = [
  { name: "DROP TABLE", re: /\bDROP\s+TABLE\b/i },
  { name: "DROP COLUMN", re: /\bDROP\s+COLUMN\b/i },
  { name: "DROP INDEX", re: /\bDROP\s+INDEX\b/i },
  { name: "DROP VIEW", re: /\bDROP\s+VIEW\b/i },
  { name: "DROP SCHEMA", re: /\bDROP\s+SCHEMA\b/i },
  { name: "TRUNCATE", re: /\bTRUNCATE\b/i },
  { name: "ALTER COLUMN TYPE", re: /\bALTER\s+COLUMN\s+\S+\s+TYPE\b/i },
];

interface Violation {
  file: string;
  line: number;
  rule: string;
  stmt: string;
}

function splitStatements(sql: string): Array<{ stmt: string; line: number }> {
  const statements: Array<{ stmt: string; line: number }> = [];
  let current = "";
  let line = 1;
  let stmtStartLine = 1;
  let inString = false;
  let quote = "";

  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (ch === undefined) continue;
    if (ch === "\n") line++;
    if (inString) {
      current += ch;
      if (ch === quote) inString = false;
      continue;
    }
    if (ch === "'" || ch === '"') {
      inString = true;
      quote = ch;
      current += ch;
      continue;
    }
    // 行注释：跳过到行尾
    if (ch === "-" && sql[i + 1] === "-") {
      while (i < sql.length && sql[i] !== "\n") i++;
      i--; // 回退，让外层处理换行
      continue;
    }
    if (ch === ";") {
      const stmt = current.trim();
      if (stmt) statements.push({ stmt, line: stmtStartLine });
      current = "";
      stmtStartLine = line;
      continue;
    }
    if (!current.trim() && /\s/.test(ch)) {
      stmtStartLine = line;
    }
    current += ch;
  }
  const tail = current.trim();
  if (tail) statements.push({ stmt: tail, line: stmtStartLine });
  return statements;
}

function collectMigrationFiles(root: string): string[] {
  const out: string[] = [];
  if (!existsSync(root)) return out;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const full = join(root, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist" || entry.name === ".turbo") continue;
      out.push(...collectMigrationFiles(full));
    } else if (entry.name.endsWith(".sql") && root.includes("migrations")) {
      out.push(full);
    }
  }
  return out;
}

function check(): void {
  const roots = [
    join(process.cwd(), "packages"),
    join(process.cwd(), "apps"),
  ];
  const files: string[] = [];
  for (const r of roots) files.push(...collectMigrationFiles(r));

  if (files.length === 0) {
    console.log("PASS: 未发现迁移 SQL 文件。");
    process.exit(0);
  }

  const violations: Violation[] = [];
  for (const file of files) {
    const sql = readFileSync(file, "utf8");
    for (const { stmt, line } of splitStatements(sql)) {
      for (const rule of BANNED) {
        if (rule.re.test(stmt)) {
          violations.push({
            file: file.replace(process.cwd() + "/", ""),
            line,
            rule: rule.name,
            stmt: stmt.slice(0, 80),
          });
        }
      }
    }
  }

  if (violations.length > 0) {
    console.error("FAIL: 检测到破坏性迁移变更：");
    for (const v of violations) {
      console.error(`  - ${v.file}:${v.line} [${v.rule}] ${v.stmt}`);
    }
    process.exit(1);
  }
  console.log(`PASS: ${files.length} 个迁移文件，无破坏性变更。`);
}

check();
