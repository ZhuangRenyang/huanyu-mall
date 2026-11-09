import type { LinkDefinition } from "./types.js";

/** 启动时收集全部 link 定义，校验表名唯一、无循环级联（架构 §4.4）。 */
export class LinkRegistry {
  private readonly links = new Map<string, LinkDefinition>();

  register(def: LinkDefinition): void {
    if (this.links.has(def.table)) {
      throw new Error(`Duplicate link table: ${def.table}`);
    }
    this.links.set(def.table, def);
  }

  get(table: string): LinkDefinition | undefined {
    return this.links.get(table);
  }

  list(): LinkDefinition[] {
    return [...this.links.values()];
  }

  /**
   * 校验：表名唯一、onDelete 合法。
   * cascade 只允许从「1」侧级联（1:1 或 1:N）；N:1 / N:N 的 cascade 会误删被共享的一端，禁止。
   * （architecture §4.3 规则 4；order_fulfillment 为 1:N cascade，已在 db-schema 登记理由）
   */
  validate(): void {
    for (const link of this.links.values()) {
      if (link.onDelete === "cascade" && (link.cardinality === "N:N" || link.cardinality === "N:1")) {
        throw new Error(
          `Link ${link.table}: cascade only allowed from the 'one' side (1:1 or 1:N), got ${link.cardinality}`,
        );
      }
    }
  }
}
