import { beforeAll, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { installRadixPolyfills } from './setup';
import { Input } from '../src/input';
import { Textarea } from '../src/textarea';
import { Label } from '../src/label';
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogTrigger } from '../src/dialog';
import { Sheet, SheetContent, SheetTitle } from '../src/sheet';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../src/tabs';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '../src/select';
import { Toaster, toast } from '../src/toast';

/** 每个 spec 都要手动 cleanup（testing-library 的自动 cleanup 依赖 globals）。 */
import { afterEach } from 'vitest';
afterEach(cleanup);

beforeAll(() => {
  installRadixPolyfills();
});

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

  it('关闭按钮的触摸区是 44×44（WCAG 2.5.5），图标小不等于可点区域小', () => {
    render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>标题</DialogTitle>
        </DialogContent>
      </Dialog>,
    );
    const closeButton = screen.getByRole('button', { name: '关闭' });
    expect(closeButton.className).toContain('size-11');
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

  it('四个方向各自定位（top/bottom 贴上下边，left/right 贴左右边）', () => {
    const sides = [
      { side: 'top', expect: 'top-0' },
      { side: 'bottom', expect: 'bottom-0' },
      { side: 'left', expect: 'left-0' },
      { side: 'right', expect: 'right-0' },
    ] as const;
    for (const { side, expect: cls } of sides) {
      const { unmount } = render(
        <Sheet open>
          <SheetContent side={side}>
            <SheetTitle>{side}</SheetTitle>
          </SheetContent>
        </Sheet>,
      );
      expect(screen.getByRole('dialog').className).toContain(cls);
      unmount();
    }
  });

  it('抽屉层级用 --z-drawer 令牌，不是自造的 z-50', () => {
    render(
      <Sheet open>
        <SheetContent>
          <SheetTitle>默认</SheetTitle>
        </SheetContent>
      </Sheet>,
    );
    expect(screen.getByRole('dialog').className).toContain('z-[var(--z-drawer)]');
  });
});


