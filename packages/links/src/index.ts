import { LinkRegistry } from "@mall/core";
import { allLinks } from "./definitions.js";

export * from "./definitions.js";

/** 构建并校验 links 注册表（启动时调用，校验表名唯一 + cascade 规则）。 */
export function createLinkRegistry(): LinkRegistry {
  const registry = new LinkRegistry();
  for (const link of allLinks) registry.register(link);
  registry.validate();
  return registry;
}
