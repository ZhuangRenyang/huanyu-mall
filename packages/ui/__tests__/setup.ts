/**
 * 测试环境补丁（jsdom ↔ 浏览器能力差异）。
 *
 * jsdom 未实现 Pointer Events 的捕获 API 与 scrollIntoView，而 Radix 的 Select
 * 在展开时会调用 `hasPointerCapture` / `setPointerCapture` 并在定位时调用
 * `scrollIntoView`。缺这些会让展开流程静默中断（aria-expanded 停留在 false）。
 * 这不是组件缺陷，是测试环境的空洞 —— 补最小 polyfill 让交互能跑通。
 */
export function installRadixPolyfills(): void {
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
}
