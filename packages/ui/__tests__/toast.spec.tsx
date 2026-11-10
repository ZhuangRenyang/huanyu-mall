import { beforeAll, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { installRadixPolyfills } from './setup';
import { Toaster, toast } from '../src/toast';

/** 每个 spec 都要手动 cleanup（testing-library 的自动 cleanup 依赖 globals）。 */
import { afterEach } from 'vitest';
afterEach(cleanup);

beforeAll(() => {
  installRadixPolyfills();
});

describe('Toast（sonner）', () => {
  it('Toaster 渲染出礼貌播报的通知区域（aria-live=polite）', () => {
    render(<Toaster />);
    const region = screen.getByLabelText(/Notifications/);
    expect(region.getAttribute('aria-live')).toBe('polite');
  });

  it('toast 是可直接调用的提示函数（透传 sonner API）', () => {
    expect(typeof toast).toBe('function');
    expect(typeof toast.success).toBe('function');
    expect(typeof toast.error).toBe('function');
  });

  it('默认皮肤走 Token（card / card-foreground / border），不是 sonner 默认白底', async () => {
    render(<Toaster />);
    act(() => {
      toast('已保存');
    });
    /* sonner 的列表容器（带 data-sonner-toaster）只在有消息时挂载 */
    await waitFor(() => {
      expect(document.querySelector('[data-sonner-toaster]')).toBeTruthy();
    });
    const list = document.querySelector('[data-sonner-toaster]') as HTMLElement;
    expect(list.style.getPropertyValue('--normal-bg')).toBe('var(--card)');
    expect(list.style.getPropertyValue('--normal-text')).toBe('var(--card-foreground)');
    expect(list.style.getPropertyValue('--normal-border')).toBe('var(--border)');
    expect(list.style.zIndex).toBe('var(--z-toast)');
  });
});
