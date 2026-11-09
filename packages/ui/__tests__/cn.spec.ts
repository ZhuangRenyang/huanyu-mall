import { describe, expect, it } from 'vitest';
import { cn } from '../src/lib/cn';

/**
 * cn() = clsx + tailwind-merge 的契约测试。
 *
 * 这里锁两件事，任一退化都会造成真实视觉 bug：
 * 1. **默认类零丢失** —— 组件把「变体默认类」交给 cn() 时，不能有默认类被误吞；
 * 2. **冲突正确消解** —— 调用方 className 必须能覆盖默认类（同组只留最后一个）。
 *
 * 尤其 aspect-product：tailwind-merge 内置 aspect 分组只认 auto/square/video 与分数，
 * 不在 extendTailwindMerge 里登记就会「两个 aspect 同时留下」——本文件即为该回归的护栏。
 */
describe('cn（clsx + tailwind-merge）', () => {
  it('基础冲突只留最后一个', () => {
    expect(cn('px-2', 'px-4')).toBe('px-4');
    expect(cn('h-11', 'h-8')).toBe('h-8');
    expect(cn('rounded-md', 'rounded-lg')).toBe('rounded-lg');
  });

  it('品牌 token 色参与冲突消解（含 hover/active/subtle 派生档）', () => {
    expect(cn('bg-primary', 'bg-accent-orange')).toBe('bg-accent-orange');
    expect(cn('bg-primary', 'bg-primary-hover')).toBe('bg-primary-hover');
    expect(cn('bg-destructive', 'bg-destructive-subtle')).toBe('bg-destructive-subtle');
    expect(cn('text-accent-orange-deep', 'text-muted-foreground')).toBe('text-muted-foreground');
    expect(cn('border-input', 'border-destructive')).toBe('border-destructive');
  });

  it('标准 Tailwind 色不被品牌 token 挤出消解范围', () => {
    expect(cn('bg-red-500', 'bg-primary')).toBe('bg-primary');
    expect(cn('bg-neutral-900/40', 'bg-card')).toBe('bg-card');
    expect(cn('text-slate-700', 'text-muted-foreground')).toBe('text-muted-foreground');
  });

  it('字号与文字色分属不同组，互不吞并', () => {
    expect(cn('text-sm text-muted-foreground', 'text-primary')).toBe('text-sm text-primary');
    expect(cn('text-xs font-medium', 'text-base')).toBe('font-medium text-base');
  });

  it('商品图比例 token 正确消解（aspect-product 回归护栏）', () => {
    expect(cn('aspect-product', 'aspect-square')).toBe('aspect-square');
    expect(cn('aspect-square', 'aspect-product')).toBe('aspect-product');
    expect(cn('aspect-wide', 'aspect-product')).toBe('aspect-product');
    expect(cn('aspect-product', 'aspect-auto')).toBe('aspect-auto');
  });

  it('无条件类被正确丢弃', () => {
    expect(cn('p-4', false, null, undefined, '', 'mt-2')).toBe('p-4 mt-2');
  });

  it('组件默认类不被自身消解吞掉（Button primary/md 全量）', () => {
    const defaults = cn(
      'inline-flex select-none items-center justify-center gap-2 rounded-md font-medium',
      'transition-colors duration-150',
      'disabled:pointer-events-none disabled:opacity-40',
      'bg-primary text-primary-foreground hover:bg-primary-hover active:bg-primary-active',
      'h-11 px-4 text-sm',
    );
    for (const cls of [
      'inline-flex',
      'rounded-md',
      'font-medium',
      'bg-primary',
      'text-primary-foreground',
      'hover:bg-primary-hover',
      'active:bg-primary-active',
      'h-11',
      'px-4',
      'text-sm',
      'disabled:opacity-40',
    ]) {
      expect(defaults).toContain(cls);
    }
  });

  it('图标按钮 44×44 触摸区不被 className 意外顶掉（size-11）', () => {
    expect(cn('grid place-items-center rounded-md text-muted-foreground', 'size-11', 'text-foreground')).toBe(
      'grid place-items-center rounded-md size-11 text-foreground',
    );
  });
});
