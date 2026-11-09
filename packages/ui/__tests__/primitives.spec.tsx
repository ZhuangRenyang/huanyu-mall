import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { Input } from '../src/input';
import { Textarea } from '../src/textarea';
import { Label } from '../src/label';
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogTrigger } from '../src/dialog';
import { Sheet, SheetContent, SheetTitle } from '../src/sheet';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../src/tabs';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '../src/select';

/**
 * 注意：本包 vitest 未启用 `globals`，testing-library 的自动 cleanup 不会生效，
 * 必须手动注册 —— 否则前一个用例的 DOM 会残留，`getByRole` 命中多个元素，
 * 表现为"明明渲染了却断言为 null"这类假失败（本项目踩过一次）。
 */
afterEach(cleanup);

/**
 * jsdom 未实现 Pointer Events 的捕获 API 与 scrollIntoView，而 Radix 的 Select
 * 在展开时会调用 `hasPointerCapture` / `setPointerCapture` 并在定位时调用
 * `scrollIntoView`。缺这些会让展开流程静默中断（aria-expanded 停留在 false）。
 * 这不是组件缺陷，是测试环境的空洞 —— 补最小 polyfill 让交互能跑通。
 */
beforeAll(() => {
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
  }
  if (!Element.prototype.setPointerCapture) {
    Element.prototype.setPointerCapture = () => {};
  }
  if (!Element.prototype.releasePointerCapture) {
    Element.prototype.releasePointerCapture = () => {};
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
});

/**
 * 原子组件契约测试（jsdom 真实 DOM 渲染 + 真实事件）。
 *
 * 为什么用 jsdom 而不是 renderToStaticMarkup：Radix 的 Portal 在服务端静态渲染下
 * 不产出节点，Dialog / Sheet / Select 的内容根本渲染不出来 —— 那样只能测到"外壳"，
 * 恰好把本次迁移最该验证的东西（焦点、Escape、aria 关联）跳过去。
 *
 * 注意：焦点陷阱的完整行为（Tab 循环、Shift+Tab 回绕）依赖浏览器 focus 管理，
 * jsdom 只实现了部分；这里断言"打开后焦点被移入 dialog 内"这个前提条件，
 * 完整 Tab 循环在真实浏览器验收时确认。
 */

describe('Input / Textarea / Label', () => {
  it('Input 把 aria-invalid 映射成错误边框，并保留原生属性透传', () => {
    render(<Input aria-invalid="true" name="email" placeholder="you@example.com" />);
    const el = screen.getByRole('textbox');
    expect(el.getAttribute('aria-invalid')).toBe('true');
    expect(el.getAttribute('name')).toBe('email');
    expect(el.className).toContain('aria-invalid:border-destructive');
    expect(el.getAttribute('data-slot')).toBe('input');
  });

  it('Input 默认 type=text，可覆盖为 password', () => {
    const { container, unmount } = render(<Input />);
    expect(container.querySelector('input')?.getAttribute('type')).toBe('text');
    unmount();
    const second = render(<Input type="password" />);
    expect(second.container.querySelector('input')?.getAttribute('type')).toBe('password');
  });

  it('Textarea 默认 rows=3 且有 min-h 兜底', () => {
    render(<Textarea aria-label="备注" />);
    const el = screen.getByRole('textbox');
    expect(el.getAttribute('rows')).toBe('3');
    expect(el.className).toContain('min-h-[72px]');
    expect(el.className).toContain('aria-invalid:border-destructive');
  });

  it('Label 是原生 label，htmlFor 生效（点击文本能聚焦目标控件）', () => {
    render(
      <>
        <Label htmlFor="email">邮箱</Label>
        <Input id="email" />
      </>,
    );
    const label = screen.getByText('邮箱');
    expect(label.tagName).toBe('LABEL');
    expect(label.getAttribute('for')).toBe('email');
    expect(screen.getByRole('textbox').id).toBe('email');
  });
});

describe('Dialog', () => {
  it('打开后具备 dialog 语义，aria-labelledby 指向标题、aria-describedby 指向描述', () => {
    render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>退款确认</DialogTitle>
          <DialogDescription>退款后不可撤销</DialogDescription>
        </DialogContent>
      </Dialog>,
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('data-slot')).toBe('dialog-content');

    const labelledBy = dialog.getAttribute('aria-labelledby');
    expect(labelledBy).toBeTruthy();
    expect(document.getElementById(labelledBy!)?.textContent).toBe('退款确认');

    const describedBy = dialog.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)?.textContent).toBe('退款后不可撤销');
  });

  it('按 Escape 触发 onOpenChange(false)', () => {
    const onOpenChange = vi.fn();
    render(
      <Dialog open onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogTitle>标题</DialogTitle>
        </DialogContent>
      </Dialog>,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('打开后焦点被移入对话框内（焦点陷阱的前提条件）', () => {
    render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>标题</DialogTitle>
          <Input aria-label="备注" />
        </DialogContent>
      </Dialog>,
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it('关闭时不渲染内容，辅助技术读不到残留节点', () => {
    render(
      <Dialog open={false}>
        <DialogContent>
          <DialogTitle>不该出现</DialogTitle>
        </DialogContent>
      </Dialog>,
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByText('不该出现')).toBeNull();
  });

  it('关闭按钮有可读标签（不是只有一个图标）', () => {
    render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>标题</DialogTitle>
        </DialogContent>
      </Dialog>,
    );
    const closeButton = screen.getByRole('button', { name: '关闭' });
    expect(closeButton.getAttribute('type')).toBe('button');
  });

  it('触发器能打开对话框（受控到非受控的默认行为）', () => {
    render(
      <Dialog>
        <DialogTrigger>打开</DialogTrigger>
        <DialogContent>
          <DialogTitle>已打开</DialogTitle>
        </DialogContent>
      </Dialog>,
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '打开' }));
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
});

describe('Sheet', () => {
  it('side=left 命中原生左侧定位，且具备 dialog 语义', () => {
    render(
      <Sheet open>
        <SheetContent side="left">
          <SheetTitle>筛选</SheetTitle>
        </SheetContent>
      </Sheet>,
    );
    const sheet = screen.getByRole('dialog');
    expect(sheet.getAttribute('aria-modal')).toBe('true');
    expect(sheet.getAttribute('data-slot')).toBe('sheet-content');
    expect(sheet.className).toContain('left-0');
    expect(sheet.className).not.toMatch(/right-0/);
  });

  it('side=bottom 走底部贴边 + 上圆角', () => {
    render(
      <Sheet open>
        <SheetContent side="bottom">
          <SheetTitle>底部面板</SheetTitle>
        </SheetContent>
      </Sheet>,
    );
    const sheet = screen.getByRole('dialog');
    expect(sheet.className).toContain('bottom-0');
    expect(sheet.className).toContain('rounded-t-xl');
  });

  it('不传 side 时默认 right', () => {
    render(
      <Sheet open>
        <SheetContent>
          <SheetTitle>默认</SheetTitle>
        </SheetContent>
      </Sheet>,
    );
    expect(screen.getByRole('dialog').className).toContain('right-0');
  });
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
