import type { ModuleDefinition, ProviderDefinition, LinkableDefinition } from "./types.js";
import type { ContainerApi, Token } from "../container/index.js";
import { Container } from "../container/index.js";

/** 模块名即容器 token（架构 §1.2 不变式 1：container.resolve("payment")）。 */
export function moduleToken(name: string): Token {
  return name;
}

/** Module() 注册器：service + migrations + linkable + providers（架构 §8.3）。 */
export function Module<TService>(
  name: string,
  def: {
    service: (ctx: ContainerApi) => TService;
    migrations?: string[];
    linkable?: LinkableDefinition[];
    providers?: ProviderDefinition[];
  },
): ModuleDefinition<TService> {
  if (!/^[a-z][a-z0-9-]*$/.test(name)) {
    throw new Error(`Invalid module name: ${name}`);
  }
  return {
    name,
    service: def.service,
    migrations: def.migrations ?? [],
    linkable: def.linkable ?? [],
    providers: def.providers ?? [],
  };
}

/** 收集全部模块定义，并把 service 注册进容器（单例）。 */
export class ModuleRegistry {
  private readonly modules = new Map<string, ModuleDefinition>();

  register(module: ModuleDefinition, container: Container): void {
    if (this.modules.has(module.name)) {
      throw new Error(`Duplicate module: ${module.name}`);
    }
    this.modules.set(module.name, module);
    container.register(moduleToken(module.name), module.service, { lifecycle: "singleton" });
  }

  get(name: string): ModuleDefinition | undefined {
    return this.modules.get(name);
  }

  list(): ModuleDefinition[] {
    return [...this.modules.values()];
  }

  names(): string[] {
    return [...this.modules.keys()];
  }
}
