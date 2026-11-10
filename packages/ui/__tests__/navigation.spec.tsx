import { beforeAll, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { installRadixPolyfills } from './setup';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../src/tabs';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '../src/select';

/** 每个 spec 都要手动 cleanup（testing-library 的自动 cleanup 依赖 globals）。 */
import { afterEach } from 'vitest';
afterEach(cleanup);

beforeAll(() => {
  installRadixPolyfills();
});

describe('Tabs', () => {
  it('默认选中项 aria-selected=true，其余为 false', () => {
    render(
      <Tabs defaultValue="theme">
        <TabsList>
          <TabsTrigger value="theme">外观</TabsTrigger>
          <TabsTrigger value="payments">支付方式</TabsTrigger>
        </TabsList>
        <TabsContent value="theme">外观面板</TabsContent>
      </Tabs>,
    );
    expect(screen.getByRole('tab', { name: '外观' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tab', { name: '支付方式' }).getAttribute('aria-selected')).toBe('false');
  });

  it('tabpanel 有 aria-labelledby 指回对应 tab（可访问名称链完整）', () => {
    render(
      <Tabs defaultValue="theme">
        <TabsList>
          <TabsTrigger value="theme">外观</TabsTrigger>
        </TabsList>
        <TabsContent value="theme">外观面板</TabsContent>
      </Tabs>,
    );
    const panel = screen.getByRole('tabpanel');
    const labelledBy = panel.getAttribute('aria-labelledby');
    expect(labelledBy).toBeTruthy();
    expect(document.getElementById(labelledBy!)?.textContent).toBe('外观');
  });

  it('点击另一个 tab 会切换选中态', () => {
    render(
      <Tabs defaultValue="theme">
        <TabsList>
          <TabsTrigger value="theme">外观</TabsTrigger>
          <TabsTrigger value="payments">支付方式</TabsTrigger>
        </TabsList>
        <TabsContent value="theme">外观面板</TabsContent>
        <TabsContent value="payments">支付面板</TabsContent>
      </Tabs>,
    );
    /* Radix Tabs 在 mousedown 上激活（而非 click），这是它的既定交互语义 */
    fireEvent.mouseDown(screen.getByRole('tab', { name: '支付方式' }));
    expect(screen.getByRole('tab', { name: '支付方式' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByText('支付面板')).toBeTruthy();
  });
});

describe('Select', () => {
  it('关闭态 aria-expanded=false，且是 combobox 语义', () => {
    render(
      <Select>
        <SelectTrigger aria-label="币种">
          <SelectValue placeholder="请选择" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="CNY">人民币</SelectItem>
        </SelectContent>
      </Select>,
    );
    const trigger = screen.getByRole('combobox', { name: '币种' });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('关闭时选项不在 DOM（Portal 未挂载，隐藏选项不会被辅助技术误读）', () => {
    render(
      <Select>
        <SelectTrigger aria-label="币种">
          <SelectValue placeholder="请选择" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="CNY">人民币</SelectItem>
          <SelectItem value="USD">美元</SelectItem>
        </SelectContent>
      </Select>,
    );
    expect(screen.queryByRole('option')).toBeNull();
    expect(screen.queryByText('人民币')).toBeNull();
  });

  /*
   * 未覆盖：点击触发器后展开（aria-expanded 变 true、选项进入 listbox）。
   *
   * 原因：Radix Select 的展开链路依赖 Pointer Events 的捕获 API、ResizeObserver、
   * DOMRect 等一整套浏览器能力，jsdom 实现不全 —— 补 polyfill 仍会在后续步骤静默中断。
   * 这是**测试环境空洞**，不是组件缺陷。
   *
   * 处理方式：不在单测里用静态断言"假装测过"，改为在浏览器端验收时点开下拉确认。
   * 组件本身直接包 Radix 原语（未替换其行为），展开/键盘交互由 Radix 保证。
   */
});
