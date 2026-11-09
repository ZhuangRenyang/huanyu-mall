/**
 * 跨页面的一次性提示（改密成功 → 回登录页时告诉用户发生了什么）。
 *
 * 存 sessionStorage 而不是路由 state：
 * 改密成功后本地会话已被清掉，路由守卫随时可能把用户弹回 /login，
 * 提示必须能活过一次重定向；同时刷新页面也不该丢。
 *
 * 读取与清除分成两个动作（read / clear），不要做成「读即删」：
 * React StrictMode 下 effect 会执行两次，「读即删」会让第二次读到 null，
 * 把已经显示出来的提示又抹掉。改成「非破坏性读取 + 显式清除」后行为稳定。
 */
const NOTICE_KEY = 'admin:notice';

export function setAuthNotice(message: string): void {
  try {
    sessionStorage.setItem(NOTICE_KEY, message);
  } catch {
    /* sessionStorage 不可用 */
  }
}

export function readAuthNotice(): string | null {
  try {
    return sessionStorage.getItem(NOTICE_KEY);
  } catch {
    return null;
  }
}

export function clearAuthNotice(): void {
  try {
    sessionStorage.removeItem(NOTICE_KEY);
  } catch {
    /* noop */
  }
}
