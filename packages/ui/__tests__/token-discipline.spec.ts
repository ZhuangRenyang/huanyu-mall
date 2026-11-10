import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Token 纪律护栏 —— 组件层不许出现「硬编码颜色」与「自造 z-index」。
 *
 * 为什么要有这条测试：design-tokens 是配色/层级/动效的单一事实来源，
 * 一旦组件里写死 `#1666D9` 或 `z-50`：
 * - 换肤时组件不跟着变（深色模式失效）；
 * - 层级会与抽屉/弹窗/Toast 打架（`z-50` 恰好等于 `--z-modal`，纯属巧合，
 *   一旦令牌调整就会出现「遮罩盖住弹窗」这类偶发 bug）。
 *
 * 扫描范围：`packages/ui/src` 下全部 .ts/.tsx/.css（跳过注释，避免文档里的
 * 色值示例误报）。CI 里 `scripts/scan-icons.ts` 负责图标，这条负责颜色与层级。
 */

/** 从当前工作目录向上找到含 `src/index.ts` 的包根（vitest 的 cwd = 包目录）。 */
function findSrcDir(): string {
  let dir = process.cwd();
  for (let i = 0; i < 5; i += 1) {
    const candidate = join(dir, 'src');
    try {
      if (statSync(join(candidate, 'index.ts')).isFile()) return candidate;
    } catch {
      /* 继续向上找 */
    }
    const parent = resolve(dir, '..');
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`找不到 packages/ui/src（cwd=${process.cwd()}）`);
}

const SRC_DIR = findSrcDir();

function collectSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...collectSourceFiles(full));
    } else if (/\.(ts|tsx|css)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/** 去掉块注释与行注释，只留真正会被编译进产物的代码。 */
function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

const files = collectSourceFiles(SRC_DIR);

describe('Token 纪律（packages/ui/src）', () => {
  it('扫描到了组件源码（护栏本身没跑空）', () => {
    expect(files.length).toBeGreaterThanOrEqual(15);
  });

  it('组件层没有硬编码颜色（hex / rgb / hsl）', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const code = stripComments(readFileSync(file, 'utf8'));
      code.split('\n').forEach((line, i) => {
        if (/#[0-9a-fA-F]{3,8}\b/.test(line) || /\b(rgb|rgba|hsl|hsla)\(/.test(line)) {
          offenders.push(`${file}:${i + 1} ${line.trim()}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });

  it('组件层不自造 z-index（必须用 --z-* 令牌）', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const code = stripComments(readFileSync(file, 'utf8'));
      code.split('\n').forEach((line, i) => {
        if (/(^|[\s'"\`])z-(\d+|auto)([\s'"\`]|$)/.test(line)) {
          offenders.push(`${file}:${i + 1} ${line.trim()}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });
});
