import { topologicalSort } from "./topo-sort.js";
import type { ContainerApi, Lifecycle, Registration, Token } from "./types.js";

/**
 * 自研 DI 容器（架构 §8.3）。
 * register/resolve 同步；启动顺序 = 依赖拓扑序；停止 = 逆序。
 */
export class Container implements ContainerApi {
  private readonly registrations = new Map<Token, Registration>();
  private readonly instances = new Map<Token, unknown>();
  private started = false;

  register<T>(
    token: Token,
    factory: (ctx: ContainerApi) => T,
    opts: { lifecycle?: Lifecycle; dependencies?: Token[]; start?: () => Promise<void>; stop?: () => Promise<void> } = {},
  ): this {
    if (this.registrations.has(token)) {
      throw new Error(`Duplicate registration: ${String(token)}`);
    }
    this.registrations.set(token, {
      token,
      factory,
      lifecycle: opts.lifecycle ?? "singleton",
      dependencies: opts.dependencies ?? [],
      start: opts.start,
      stop: opts.stop,
    });
    return this;
  }

  has(token: Token): boolean {
    return this.registrations.has(token);
  }

  resolve<T>(token: Token): T {
    const reg = this.registrations.get(token);
    if (!reg) throw new Error(`No registration for token: ${String(token)}`);
    if (reg.lifecycle === "singleton" && this.instances.has(token)) {
      return this.instances.get(token) as T;
    }
    const value = reg.factory(this);
    if (reg.lifecycle === "singleton") this.instances.set(token, value);
    return value as T;
  }

  /** 启动顺序 = 依赖拓扑序（依赖先启动）。 */
  startupOrder(): Token[] {
    const edges = new Map<Token, Token[]>();
    for (const reg of this.registrations.values()) {
      edges.set(reg.token, reg.dependencies);
    }
    return topologicalSort([...this.registrations.keys()], edges);
  }

  /** 按拓扑序 resolve 全部 singleton 并触发 start 钩子。 */
  async start(): Promise<void> {
    if (this.started) return;
    const order = this.startupOrder();
    for (const token of order) {
      const reg = this.registrations.get(token)!;
      this.resolve(token);
      await reg.start?.();
    }
    this.started = true;
  }

  /** 逆拓扑序触发 stop 钩子。 */
  async dispose(): Promise<void> {
    const order = [...this.startupOrder()].reverse();
    for (const token of order) {
      const reg = this.registrations.get(token)!;
      await reg.stop?.();
    }
    this.instances.clear();
    this.started = false;
  }
}

export function createContainer(): Container {
  return new Container();
}
