/**
 * engine.ts —— 计算样式引擎：类名 → Tailwind 真实声明 → 元素级声明表。
 *
 * 被 visual-snapshot.ts 调用；单独成文件是为了把「怎么算」与「算什么」分开，
 * 两者都不超过 300 行。
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);

/** Tailwind v4 Node API 的最小签名（只用到 compile + build）。 */
interface TailwindCompile {
  (
    css: string,
    opts: {
      base: string;
      loadStylesheet: (id: string, base: string) => Promise<{ base: string; content: string }>;
      loadModule: (id: string, base: string) => Promise<{ base: string; content: string }>;
    },
  ): Promise<{ build: (c: string[]) => unknown }>;
}

export const REPO_ROOT = path.resolve(import.meta.dirname, '../../../..');
export const TOKENS_CSS = path.join(REPO_ROOT, 'packages/design-tokens/src/tokens.css');

/* ------------------------------------------------------------------ *
 * 1. design-tokens：把 :root 里的变量解析成字面值
 * ------------------------------------------------------------------ */

export function loadTokenValues(): Record<string, string> {
  const css = readFileSync(TOKENS_CSS, 'utf8');
  /* 只取第一个 :root 块（浅色主题），.dark 覆盖块不参与对比 */
  const rootStart = css.indexOf(':root {');
  const rootEnd = css.indexOf('}', rootStart);
  const rootBlock = css.slice(rootStart, rootEnd);
  const values: Record<string, string> = {};
  for (const m of rootBlock.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) {
    const name = m[1];
    if (!name) continue;
    values[name] = m[2]?.trim() ?? '';
  }
  return values;
}

const TOKENS = loadTokenValues();

/** 把 `var(--card)` / `var(--card, #fff)` 递归解析成字面值。 */
export function resolveVars(value: string, depth = 0): string {
  if (depth > 6) return value;
  return value.replace(/var\((--[a-z0-9-]+)([^)]*)\)/gi, (whole, name: string, fallback: string) => {
    const raw = TOKENS[name] ?? fallback.replace(/^\s*,?\s*/, '').trim();
    if (!raw) return whole;
    return resolveVars(raw, depth + 1);
  });
}

/* ------------------------------------------------------------------ *
 * 2. Tailwind 引擎：类名 → 真实声明
 * ------------------------------------------------------------------ */

function resolveCssPath(spec: string): string {
  if (spec === 'tailwindcss') {
    const pkgPath = require.resolve('tailwindcss/package.json', {
      paths: [path.join(REPO_ROOT, 'apps/admin')],
    });
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
      exports: Record<string, { style?: string }>;
    };
    const style = pkg.exports['.']?.style ?? 'index.css';
    return path.resolve(path.dirname(pkgPath), style);
  }
  if (spec === '@mall/design-tokens/tokens.css') return TOKENS_CSS;
  return path.resolve(spec);
}

export async function compileTailwind(candidates: string[]): Promise<string> {
  /* tailwindcss 装在 apps/admin（apps/storefront 也有一份），本脚本在 packages/ui 下，
     所以要用绝对路径加载，不能靠裸 import 的相对解析。 */
  const entryFile = require.resolve('tailwindcss', {
    paths: [path.join(REPO_ROOT, 'apps/admin')],
  });
  const mod = (await import(pathToFileURL(entryFile).href)) as {
    compile?: TailwindCompile;
    default?: { compile?: TailwindCompile };
  };
  const compile = mod.compile ?? mod.default?.compile;
  if (!compile) throw new Error('tailwindcss 的 compile API 不可用');

  const entry = `@import "tailwindcss" source(none);\n${readFileSync(TOKENS_CSS, 'utf8')}`;
  const compiler = await compile(entry, {
    base: REPO_ROOT,
    async loadStylesheet(id: string) {
      const input = resolveCssPath(id);
      return { base: path.dirname(input), content: readFileSync(input, 'utf8') };
    },
    async loadModule(id: string) {
      const input = resolveCssPath(id);
      return { base: path.dirname(input), content: readFileSync(input, 'utf8') };
    },
  });
  return String(compiler.build(candidates));
}

/**
 * 解析编译产物：类名 → 声明表。
 *
 * 用手写扫描器而不是正则：Tailwind v4 的产物是**带缩进的多行 CSS**，
 * 而且会在规则体内嵌 `@supports`（例如 `bg-neutral-900/40` 会同时给老语法兜底
 * 和 color-mix 新语法）。正则处理不了嵌套；这里按花括号配对扫描，
 * 并让**后出现的声明覆盖先出现的**（`@supports` 里的新语法才是现代浏览器的实际取值）。
 */
export function parseRules(css: string): { rules: Map<string, Record<string, string>>; starting: Map<string, Record<string, string>> } {
  const rules = new Map<string, Record<string, string>>();
  const starting = new Map<string, Record<string, string>>();

  /** 找到与 { 配对的 }，返回块内容与结束位置。 */
  function readBlock(text: string, open: number): { content: string; end: number } {
    let depth = 0;
    for (let i = open; i < text.length; i += 1) {
      const ch = text[i];
      if (ch === '{') depth += 1;
      else if (ch === '}') {
        depth -= 1;
        if (depth === 0) return { content: text.slice(open + 1, i), end: i + 1 };
      }
    }
    return { content: text.slice(open + 1), end: text.length };
  }

  /** 收集声明（包含嵌套 @supports 内的声明，后者覆盖前者）。 */
  function collectDecls(body: string): Record<string, string> {
    const decls: Record<string, string> = {};
    let depth = 0;
    let buffer = '';
    const flush = (): void => {
      const text = buffer.trim();
      buffer = '';
      if (!text) return;
      const idx = text.indexOf(':');
      if (idx < 0) return;
      const prop = text.slice(0, idx).trim();
      const value = text.slice(idx + 1).trim();
      if (prop && !prop.startsWith('@')) decls[prop] = value;
    };
    for (const ch of body) {
      if (ch === '{') {
        depth += 1;
        flush();
        continue;
      }
      if (ch === '}') {
        depth -= 1;
        flush();
        continue;
      }
      if (ch === ';' && depth === 0) {
        flush();
        continue;
      }
      buffer += ch;
    }
    flush();
    return decls;
  }

  function scan(text: string, inStartingStyle = false): void {
    let i = 0;
    while (i < text.length) {
      const open = text.indexOf('{', i);
      if (open < 0) break;
      const selector = text.slice(i, open).trim();
      const { content, end } = readBlock(text, open);
      if (selector.startsWith('@')) {
        /* @starting-style 里的规则是「进场起始值」，语义上属于变体，单独收一张表 */
        scan(content, inStartingStyle || selector.includes('starting-style'));
      } else if (selector.startsWith('.')) {
        const decls = collectDecls(content);
        if (!Object.keys(decls).length) {
          i = end;
          continue;
        }
        if (inStartingStyle) starting.set(selector, decls);
        else rules.set(selector, decls);
      }
      i = end;
    }
  }

  scan(css);
  return { rules, starting };
}

/** 把 Tailwind 的转义选择器还原回类名：`bg-neutral-900\/40` → `bg-neutral-900/40`。 */
function unescapeSelector(selector: string): string {
  return selector.replace(/\\/g, '');
}

/* ------------------------------------------------------------------ *
 * 3. 元素级「最终声明表」
 * ------------------------------------------------------------------ */

export interface CompiledRules {
  /** 普通规则：选择器 → 声明 */
  rules: Map<string, Record<string, string>>;
  /** `@starting-style` 内的规则：进场起始值 */
  starting: Map<string, Record<string, string>>;
}

export interface StyleTable {
  /** 基础声明（无变体） */
  base: Record<string, string>;
  /** 变体声明：variant → {prop: value}（如 hover / focus / data-[state=active]） */
  variants: Record<string, Record<string, string>>;
}

/** 类名里的变体前缀：`data-[state=active]:border-primary` → `data-[state=active]` */
function variantKeyOf(cls: string): string {
  const idx = cls.lastIndexOf(':');
  return idx > 0 ? cls.slice(0, idx) : '';
}

export function styleTableFor(classList: string, compiled: CompiledRules): StyleTable {
  const base: Record<string, string> = {};
  const variants: Record<string, Record<string, string>> = {};
  const classes = classList.split(/\s+/).filter(Boolean);

  for (const cls of classes) {
    const merge = (selector: string, decls: Record<string, string>): void => {
      const name = unescapeSelector(selector).replace(/^\./, '');
      if (!name.startsWith(cls)) return;
      const rest = name.slice(cls.length);
      if (rest !== '' && !rest.startsWith(':') && !rest.startsWith('[')) return;
      const resolved: Record<string, string> = {};
      for (const [prop, value] of Object.entries(decls)) resolved[prop] = resolveVars(value);
      const key = variantKeyOf(cls);
      if (key === '') Object.assign(base, resolved);
      else variants[key] = { ...(variants[key] ?? {}), ...resolved };
    };

    for (const [selector, decls] of compiled.rules) merge(selector, decls);
    for (const [selector, decls] of compiled.starting) {
      const name = unescapeSelector(selector).replace(/^\./, '');
      if (name !== cls) continue;
      const resolved: Record<string, string> = {};
      for (const [prop, value] of Object.entries(decls)) resolved[prop] = resolveVars(value);
      variants['starting'] = { ...(variants['starting'] ?? {}), ...resolved };
    }
  }
  return { base, variants };
}