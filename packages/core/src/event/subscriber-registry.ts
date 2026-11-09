import type { SubscriberHandler } from "./types.js";

/** subscriber 注册表：按事件名登记处理器（架构 §8.3）。 */
export class SubscriberRegistry {
  private readonly handlers = new Map<string, SubscriberHandler[]>();

  register(name: string, handler: SubscriberHandler): void {
    const list = this.handlers.get(name) ?? [];
    list.push(handler);
    this.handlers.set(name, list);
  }

  get(name: string): SubscriberHandler[] {
    return this.handlers.get(name) ?? [];
  }

  names(): string[] {
    return [...this.handlers.keys()];
  }
}
