import { describe, expect, it } from "vitest";
import { compileCompose, LinkRepository } from "@mall/core";
import {
  createLinkRegistry,
  priceListChannelLink,
  productChannelLink,
  variantPriceSetLink,
} from "../src/index.js";

describe("links 关联层（架构 §4.3）", () => {
  it("registry 注册并校验 13 个关联表（表名唯一 + cascade 规则）", () => {
    const registry = createLinkRegistry();
    expect(registry.list()).toHaveLength(13);
    expect(registry.get("product_channel")?.onDelete).toBe("restrict");
    expect(registry.get("variant_price_set")?.onDelete).toBe("dismiss");
    expect(registry.get("inventory_item_variant")?.onDelete).toBe("dismiss");
    expect(registry.get("order_payment_collection")?.onDelete).toBe("cascade");
    expect(registry.get("order_fulfillment")?.cardinality).toBe("1:N");
    expect(registry.get("cart_customer")?.onDelete).toBe("dismiss");
    expect(registry.get("order_customer")?.onDelete).toBe("restrict");
    expect(registry.get("tax_rate_channel")?.onDelete).toBe("restrict");
    expect(registry.get("shipping_option_channel")?.onDelete).toBe("restrict");
    expect(registry.get("payment_provider_channel")?.columns).toHaveLength(2);
    expect(registry.get("product_image_file")?.onDelete).toBe("dismiss");
  });

  it("product_channel：插入与按左 id 查询（参数化 SQL）", () => {
    const repo = new LinkRepository(productChannelLink);
    const insert = repo.buildInsert("prod_1", "chn_cn", { is_visible: true, sort_order: 3 });
    expect(insert.sql).toContain("INSERT INTO product_channel");
    expect(insert.sql).toContain("is_visible");
    expect(insert.params[1]).toBe("prod_1");
    expect(insert.params[2]).toBe("chn_cn");

    const list = repo.buildListByLeft("prod_1");
    expect(list.sql).toContain("WHERE product_id = $1");
    expect(list.params[0]).toBe("prod_1");
  });

  it("variant_price_set：N:1 dismiss 语义 + 按变体查价格集", () => {
    const repo = new LinkRepository(variantPriceSetLink);
    const list = repo.buildListByLeft("var_1");
    expect(list.sql).toContain("WHERE variant_id = $1");
    const dismiss = repo.buildDismiss("lnk_1");
    expect(dismiss.sql).toContain("SET deleted_at = now()");
  });

  it("price_list_channel：按右 id（channel）查询", () => {
    const repo = new LinkRepository(priceListChannelLink);
    const list = repo.buildListByRight("chn_cn");
    expect(list.sql).toContain("WHERE channel_id = $1");
    expect(list.params[0]).toBe("chn_cn");
  });

  it("compileCompose：product + product_channel 生成 LEFT JOIN（单库）", () => {
    const { sql, params } = compileCompose({
      entity: "product",
      from: "product",
      alias: "p",
      fields: [
        { expression: "p.id", alias: "product_id" },
        { expression: "p.title", alias: "title" },
        { expression: "lk1.sort_order", alias: "sort_order" },
      ],
      links: [productChannelLink],
      filters: [{ expression: "lk1.channel_id", operator: "=", value: "chn_cn" }],
      limit: 20,
      offset: 0,
    });
    expect(sql).toContain("FROM product p");
    expect(sql).toContain("LEFT JOIN product_channel lk1");
    expect(sql).toContain("lk1.channel_id = $1");
    expect(params[0]).toBe("chn_cn");
    expect(params[1]).toBe(20);
  });
});
