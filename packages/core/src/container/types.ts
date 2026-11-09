export type Token = string | symbol;

export type Lifecycle = "singleton" | "transient";

export interface ContainerApi {
  resolve<T>(token: Token): T;
  /** 是否已注册（用于可选端口，如事件发射器）。 */
  has(token: Token): boolean;
}

export interface Registration<T = unknown> {
  token: Token;
  factory: (ctx: ContainerApi) => T;
  lifecycle: Lifecycle;
  /** 显式声明依赖，用于启动拓扑序与周期管理。 */
  dependencies: Token[];
  start?: () => Promise<void>;
  stop?: () => Promise<void>;
}
