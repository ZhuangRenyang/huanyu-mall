export type Cardinality = "1:1" | "N:1" | "1:N" | "N:N";

/** 删除语义只有三种（架构 §4.3 规则 4）。 */
export type OnDelete = "restrict" | "dismiss" | "cascade";

export interface LinkEndpoint {
  /** 模块名（如 "product"）。 */
  module: string;
  /** 模块内表名（如 "product"）。 */
  table: string;
  /** 实体 id 字段（如 "id"）。 */
  field: string;
}

export interface LinkColumn {
  name: string;
  type: "text" | "boolean" | "integer";
  default?: unknown;
}

export interface LinkDefinition {
  /** 表名，形如 link_<左复数>__<右复数>。 */
  table: string;
  left: LinkEndpoint;
  right: LinkEndpoint;
  cardinality: Cardinality;
  onDelete: OnDelete;
  /** 关联属性列（只许 is_* / sort_order 等关系属性，禁业务字段，架构 §4.3 规则 2）。 */
  columns?: LinkColumn[];
  /** 联合唯一键（列名数组）。 */
  uniqueKeys?: string[][];
}
