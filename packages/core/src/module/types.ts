import type { ContainerApi } from "../container/index.js";

export interface LinkableDefinition {
  /** 本模块可被 links join 的实体名（如 "product"、"variant"）。 */
  entity: string;
  /** 允许被跨模块 join 的字段白名单。 */
  fields: string[];
}

export interface ProviderDefinition {
  id: string;
  kind: "payment" | "fulfillment" | "storage" | "tax";
  resolve: (ctx: ContainerApi) => unknown;
}

export interface ModuleDefinition<TService = unknown> {
  name: string;
  service: (ctx: ContainerApi) => TService;
  /** 迁移 SQL 文件路径（相对本模块）。 */
  migrations?: string[];
  linkable?: LinkableDefinition[];
  providers?: ProviderDefinition[];
}
