/**
 * visual-snapshot.ts —— 「计算样式快照」视觉零变化门禁（阶段 3/4）。
 *
 * 为什么要它：迁移 shadcn/ui 改的是「组件实现」，但**视觉不能变**。
 * 光看 class 字符串 diff 不可靠（`bg-card` 与 `bg-[#fff]` 视觉等价、
 * `bg-neutral-900/40` 与 `bg-black/50` 不等价）；光看源码 diff 更不可靠。
 * 所以这里做的是**计算样式级对比**：
 *
 *   1. 用 Tailwind v4 官方 Node API（`compile()`）把「类名清单」编译成真实 CSS；
 *   2. 解析出每个类的声明，并把 `var(--token)` 解析成 design-tokens 里的字面值
 *      （`bg-card` → `background-color: #FFFFFF`，`bg-neutral-900/40` →
 *      `color-mix(in oklab, #17171B 40%, transparent)`）；
 *   3. 按「同一元素的类名清单」合并出最终声明表（后写的覆盖先写的）；
 *   4. 迁移前（基线）与迁移后（现状）逐属性对比，**只允许登记过的差异**。
 *
 * 基线从哪来：仓库不是 git 仓库，没有历史快照可用，所以基线是
 * 「迁移前 admin 自写组件的类名清单」逐条抄录进 `surfaces.ts`（每条带出处行号）。
 * 抄录的是**类名**，不是渲染结果 —— 渲染结果由 Tailwind 引擎算，两边算法一致。
 *
 * 跑法（仓库根目录）：
 *   pnpm exec tsx packages/ui/scripts/visual-snapshot.ts
 *
 * 退出码：0 = 差异全部在「已登记」清单内；1 = 出现未登记的视觉差异。
 */

import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  REPO_ROOT,
  compileTailwind,
  parseRules,
  styleTableFor,
  type StyleTable,
} from './visual-snapshot/engine';
import { SURFACES, type Surface } from './visual-snapshot/surfaces';

interface Diff {
  surface: string;
  page: string;
  kind: 'base' | 'variant';
  variant?: string;
  prop: string;
  before?: string;
  after?: string;
  expected: boolean;
  note?: string;
}

/** 登记键支持两种写法：`prop`（任意变体）或 `variant.prop`（只针对某个变体）。 */
function isExpected(surface: Surface, variant: string, prop: string): boolean {
  if (surface.expected?.[prop]) return true;
  if (variant && surface.expected?.[`${variant}.${prop}`]) return true;
  return false;
}

/** 取某个变体分组；给变体名时返回「基础声明 + 变体声明」（如 tab 选中态）。 */
function pick(table: StyleTable, variant?: string): Record<string, string> {
  if (!variant) return table.base;
  return { ...table.base, ...(table.variants[variant] ?? {}) };
}

function diffTables(surface: Surface, before: StyleTable, after: StyleTable): Diff[] {
  const diffs: Diff[] = [];
  const b = pick(before, surface.beforeVariant);
  const a = pick(after, surface.afterVariant);
  const props = new Set([...Object.keys(b), ...Object.keys(a)]);
  for (const prop of props) {
    const bv = b[prop];
    const av = a[prop];
    if (bv !== av) {
      diffs.push({
        surface: surface.id,
        page: surface.page,
        kind: 'base',
        prop,
        before: bv,
        after: av,
        expected: isExpected(surface, '', prop),
        note: surface.expected?.[prop],
      });
    }
  }
  /* 变体分组也逐个比（hover / focus / data-[state=active] 等） */
  const variants = new Set([...Object.keys(before.variants), ...Object.keys(after.variants)]);
  for (const variant of variants) {
    if (variant === surface.beforeVariant || variant === surface.afterVariant) continue;
    const bv = before.variants[variant] ?? {};
    const av = after.variants[variant] ?? {};
    const vprops = new Set([...Object.keys(bv), ...Object.keys(av)]);
    for (const prop of vprops) {
      if (bv[prop] !== av[prop]) {
        diffs.push({
          surface: surface.id,
          page: surface.page,
          kind: 'variant',
          variant,
          prop,
          before: bv[prop],
          after: av[prop],
          expected: isExpected(surface, variant, prop),
          note: surface.expected?.[`${variant}.${prop}`] ?? surface.expected?.[prop],
        });
      }
    }
  }
  return diffs;
}

async function main(): Promise<void> {
  const candidates = new Set<string>();
  for (const s of SURFACES) {
    for (const cls of `${s.before} ${s.after}`.split(/\s+/)) {
      if (cls) candidates.add(cls);
    }
  }
  const css = await compileTailwind([...candidates]);
  const compiled = parseRules(css);

  const diffs: Diff[] = [];
  for (const surface of SURFACES) {
    const before = styleTableFor(surface.before, compiled);
    const after = styleTableFor(surface.after, compiled);
    diffs.push(...diffTables(surface, before, after));
  }

  const unexpected = diffs.filter((d) => !d.expected);

  console.log('=== 视觉快照：迁移前 vs 迁移后（计算样式级） ===');
  console.log(`表面数：${SURFACES.length}；候选类：${candidates.size}；差异条目：${diffs.length}`);
  console.log(`未登记差异：${unexpected.length}`);
  console.log('');
  for (const d of diffs) {
    const tag = d.expected ? '已登记' : '未登记';
    const where = d.kind === 'variant' ? ` [${d.variant}]` : '';
    console.log(`  ${tag} ${d.surface}${where} ${d.prop}: ${d.before ?? '(无)'} → ${d.after ?? '(无)'}`);
    if (d.note) console.log(`        说明：${d.note}`);
  }
  console.log('');

  const snapshot = {
    generatedBy: 'packages/ui/scripts/visual-snapshot.ts',
    surfaces: SURFACES.map((s) => ({
      id: s.id,
      page: s.page,
      source: s.source,
      before: s.before,
      after: s.after,
      base: styleTableFor(s.after, compiled).base,
    })),
    diffs,
  };
  const outPath = path.join(REPO_ROOT, 'docs/05-delivery/visual-snapshot.json');
  if (existsSync(path.dirname(outPath))) {
    writeFileSync(outPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
    console.log(`快照已写入：${path.relative(REPO_ROOT, outPath)}`);
  }

  if (unexpected.length > 0) {
    console.error(`FAIL: 出现 ${unexpected.length} 处未登记的视觉差异 —— 视觉零变化门禁不通过。`);
    process.exit(1);
  }
  console.log('PASS: 所有视觉差异均在「已登记」清单内（视觉零变化）。');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
