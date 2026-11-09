import { prefixedUlid } from "@mall/core";
import type { ProductRepository } from "../types.js";

/** 种子端口：价格与 links 由组合根注入，避免 M01 直接依赖 M02/links（架构 §2.1 M01 依赖为空）。 */
export interface CatalogSeedPorts {
  repo: ProductRepository;
  channelId: string;
  pricing: {
    createPriceSet(): Promise<string>;
    addPrice(input: { priceSetId: string; currencyCode: string; amountMinor: bigint }): Promise<void>;
  };
  links: {
    linkVariantPriceSet(variantId: string, priceSetId: string): Promise<void>;
    linkProductChannel(productId: string, channelId: string, isVisible: boolean): Promise<void>;
  };
}

/**
 * 种子：1 个 product type + 3 个可复用属性（含值）+ 2 个示例商品（含变体/价格 set/价格行，挂 cn channel）。
 * 幂等由调用方（SeedRunner）保证只跑一次；此处仅负责建数据。
 */
export async function seedCatalog(deps: CatalogSeedPorts): Promise<{ productIds: string[] }> {
  const type = await deps.repo.createProductType("服饰");
  const color = await deps.repo.createAttribute({
    name: "颜色",
    handle: "color",
    inputType: "swatch",
    isFilterable: true,
  });
  const size = await deps.repo.createAttribute({
    name: "尺码",
    handle: "size",
    inputType: "dropdown",
    isFilterable: true,
  });
  const material = await deps.repo.createAttribute({ name: "材质", handle: "material", inputType: "text" });

  const black = await deps.repo.createAttributeValue({ attributeId: color.id, value: "black", label: "黑色" });
  const white = await deps.repo.createAttributeValue({ attributeId: color.id, value: "white", label: "白色" });
  const small = await deps.repo.createAttributeValue({ attributeId: size.id, value: "s", label: "S" });
  const medium = await deps.repo.createAttributeValue({ attributeId: size.id, value: "m", label: "M" });
  await deps.repo.createAttributeValue({ attributeId: material.id, value: "cotton", label: "纯棉" });

  const specs = [
    {
      title: "基础款纯棉 T 恤",
      handle: "basic-tee",
      amountMinor: 9900n,
      variants: [
        { sku: "TEE-BLK-S", title: "黑色 S", options: { color: black.id, size: small.id } },
        { sku: "TEE-WHT-M", title: "白色 M", options: { color: white.id, size: medium.id } },
      ],
    },
    {
      title: "休闲直筒长裤",
      handle: "casual-pants",
      amountMinor: 19900n,
      variants: [{ sku: "PANTS-BLK-M", title: "黑色 M", options: { color: black.id, size: medium.id } }],
    },
  ];

  const productIds: string[] = [];
  for (const spec of specs) {
    const product = await deps.repo.insert({
      id: prefixedUlid("prod"),
      title: spec.title,
      handle: spec.handle,
      status: "published",
      productTypeId: type.id,
    });
    const variants = await deps.repo.createVariants(
      product.id,
      spec.variants.map((v) => ({ ...v, status: "published" })),
    );

    for (const variant of variants) {
      const priceSetId = await deps.pricing.createPriceSet();
      await deps.pricing.addPrice({
        priceSetId,
        currencyCode: "CNY",
        amountMinor: spec.amountMinor,
      });
      await deps.links.linkVariantPriceSet(variant.id, priceSetId);
    }
    await deps.links.linkProductChannel(product.id, deps.channelId, true);
    productIds.push(product.id);
  }

  return { productIds };
}
