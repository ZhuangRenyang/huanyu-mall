import { describe, expect, it } from "vitest";
import { prefixedUlid } from "@mall/core";
import { ProductService } from "../src/services/product.service.js";
import { seedCatalog } from "../src/services/seed.js";
import type {
  AttributeDTO,
  AttributeInputType,
  AttributeValueDTO,
  CreateImageInput,
  CreateProductInput,
  CreateVariantInput,
  ImageDTO,
  ProductDTO,
  ProductQuery,
  ProductRepository,
  ProductStatus,
  ProductTypeDTO,
  UpdateProductInput,
  VariantDTO,
} from "../src/types.js";

class InMemoryProductRepository implements ProductRepository {
  readonly products = new Map<string, ProductDTO>();
  readonly variants = new Map<string, VariantDTO>();
  readonly types: ProductTypeDTO[] = [];
  readonly attributes: AttributeDTO[] = [];
  readonly values: AttributeValueDTO[] = [];
  readonly channelVisible = new Map<string, Set<string>>();
  readonly variantPriceSet = new Map<string, string>();

  async findById(id: string): Promise<ProductDTO | null> {
    return this.products.get(id) ?? null;
  }
  async list(q: ProductQuery): Promise<{ items: ProductDTO[]; count: number }> {
    let items = [...this.products.values()];
    if (q.status) items = items.filter((p) => p.status === q.status);
    if (q.handle) items = items.filter((p) => p.handle === q.handle);
    const offset = q.offset ?? 0;
    const limit = q.limit ?? 20;
    return { items: items.slice(offset, offset + limit), count: items.length };
  }
  async insert(input: CreateProductInput & { id: string }): Promise<ProductDTO> {
    const dto: ProductDTO = {
      id: input.id,
      title: input.title,
      handle: input.handle,
      subtitle: input.subtitle ?? null,
      description: input.description ?? null,
      status: input.status ?? "draft",
      thumbnail_file_id: input.thumbnailFileId ?? null,
      product_type_id: input.productTypeId ?? null,
      metadata: input.metadata ?? null,
    };
    this.products.set(dto.id, dto);
    return dto;
  }
  async update(id: string, patch: UpdateProductInput): Promise<ProductDTO | null> {
    const p = this.products.get(id);
    if (!p) return null;
    const next: ProductDTO = {
      ...p,
      title: patch.title ?? p.title,
      handle: patch.handle ?? p.handle,
      status: (patch.status ?? p.status) as ProductStatus,
    };
    this.products.set(id, next);
    return next;
  }
  async softDelete(id: string): Promise<void> {
    this.products.delete(id);
  }
  async listVariantsByIds(ids: string[]): Promise<VariantDTO[]> {
    return ids.map((id) => this.variants.get(id)).filter((v): v is VariantDTO => v !== undefined);
  }
  async listVariantsByProductIds(productIds: string[]): Promise<VariantDTO[]> {
    const set = new Set(productIds);
    return [...this.variants.values()].filter((v) => set.has(v.product_id));
  }
  async listImagesByProductId(): Promise<ImageDTO[]> {
    return [];
  }
  async createVariants(productId: string, variants: CreateVariantInput[]): Promise<VariantDTO[]> {
    const created = variants.map((v) => ({
      id: prefixedUlid("var"),
      product_id: productId,
      sku: v.sku,
      title: v.title,
      options: v.options ?? {},
      allow_backorder: v.allowBackorder ?? false,
      status: (v.status ?? "draft") as ProductStatus,
    }));
    for (const c of created) this.variants.set(c.id, c);
    return created;
  }
  async createImages(_: string, __: CreateImageInput[]): Promise<void> {}
  async linkCategories(): Promise<void> {}
  async listSellableProductIds(channelId: string): Promise<string[]> {
    return [...(this.channelVisible.get(channelId) ?? new Set<string>())];
  }
  async priceSetIdsByVariantIds(variantIds: string[]): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    for (const id of variantIds) {
      const ps = this.variantPriceSet.get(id);
      if (ps) map.set(id, ps);
    }
    return map;
  }
  async createProductType(name: string): Promise<ProductTypeDTO> {
    const t = { id: prefixedUlid("pt"), name };
    this.types.push(t);
    return t;
  }
  async createAttribute(input: {
    name: string;
    handle: string;
    inputType: AttributeInputType;
    isFilterable?: boolean;
    isTranslatable?: boolean;
  }): Promise<AttributeDTO> {
    const a: AttributeDTO = {
      id: prefixedUlid("attr"),
      name: input.name,
      handle: input.handle,
      input_type: input.inputType,
      is_filterable: input.isFilterable ?? false,
      is_translatable: input.isTranslatable ?? false,
    };
    this.attributes.push(a);
    return a;
  }
  async createAttributeValue(input: {
    attributeId: string;
    value: string;
    label: string;
    sortOrder?: number;
  }): Promise<AttributeValueDTO> {
    const v: AttributeValueDTO = {
      id: prefixedUlid("attrv"),
      attribute_id: input.attributeId,
      value: input.value,
      label: input.label,
      sort_order: input.sortOrder ?? 0,
    };
    this.values.push(v);
    return v;
  }
}

function setup() {
  const repo = new InMemoryProductRepository();
  return { repo, service: new ProductService(repo) };
}

describe("ProductService（M01 契约）", () => {
  it("createProduct + retrieveProduct 返回变体", async () => {
    const { service } = setup();
    const created = await service.createProduct({
      title: "T 恤",
      handle: "tee",
      status: "published",
      variants: [{ sku: "TEE-S", title: "S", status: "published" }],
    });
    expect(created.variants).toHaveLength(1);
    const detail = await service.retrieveProduct(created.id);
    expect(detail.handle).toBe("tee");
    expect(detail.variants[0]?.sku).toBe("TEE-S");
  });

  it("listProducts 过滤 status + 分页", async () => {
    const { service } = setup();
    await service.createProduct({ title: "A", handle: "a", status: "published" });
    await service.createProduct({ title: "B", handle: "b", status: "draft" });
    const res = await service.listProducts({ status: "published" });
    expect(res.count).toBe(1);
    expect(res.items[0]?.handle).toBe("a");
  });

  it("updateProduct 命中 / 未命中抛 DomainError", async () => {
    const { service } = setup();
    const p = await service.createProduct({ title: "A", handle: "a" });
    const updated = await service.updateProduct(p.id, { title: "A2" });
    expect(updated.title).toBe("A2");
    await expect(service.updateProduct("prod_missing", { title: "x" })).rejects.toThrow();
  });

  it("deleteProduct 软删后不可检索", async () => {
    const { service } = setup();
    const p = await service.createProduct({ title: "A", handle: "a" });
    await service.deleteProduct(p.id);
    await expect(service.retrieveProduct(p.id)).rejects.toThrow();
  });

  it("listVariantsByIds 批量（禁循环）", async () => {
    const { repo, service } = setup();
    const p = await service.createProduct({
      title: "A",
      handle: "a",
      variants: [
        { sku: "S1", title: "S1", status: "published" },
        { sku: "S2", title: "S2", status: "published" },
      ],
    });
    const ids = [...repo.variants.values()].map((v) => v.id);
    const found = await service.listVariantsByIds(ids);
    expect(found).toHaveLength(2);
    expect(await service.listVariantsByIds([])).toEqual([]);
    void p;
  });

  it("resolveSellableVariants：渠道可见 + published + price_set_id", async () => {
    const { repo, service } = setup();
    const a = await service.createProduct({
      title: "A",
      handle: "a",
      status: "published",
      variants: [
        { sku: "A1", title: "A1", status: "published" },
        { sku: "A2", title: "A2", status: "draft" },
      ],
    });
    const b = await service.createProduct({
      title: "B",
      handle: "b",
      status: "published",
      variants: [{ sku: "B1", title: "B1", status: "published" }],
    });
    repo.channelVisible.set("chn_cn", new Set([a.id, b.id]));
    for (const v of repo.variants.values()) repo.variantPriceSet.set(v.id, `pset_${v.sku}`);

    const res = await service.resolveSellableVariants({ channelId: "chn_cn" });
    const skus = res.items.map((i) => i.sku).sort();
    expect(skus).toEqual(["A1", "B1"]);
    expect(res.items.every((i) => i.price_set_id?.startsWith("pset_"))).toBe(true);

    const empty = await service.resolveSellableVariants({ channelId: "chn_us" });
    expect(empty.items).toHaveLength(0);
  });

  it("seedCatalog 建 type + 属性 + 2 商品 + 价格 set + 渠道挂载", async () => {
    const { repo } = setup();
    const priceSets: string[] = [];
    const result = await seedCatalog({
      repo,
      channelId: "chn_cn",
      pricing: {
        createPriceSet: async () => {
          const id = prefixedUlid("pset");
          priceSets.push(id);
          return id;
        },
        addPrice: async () => {},
      },
      links: {
        linkVariantPriceSet: async (variantId, priceSetId) => {
          repo.variantPriceSet.set(variantId, priceSetId);
        },
        linkProductChannel: async (productId, channelId) => {
          const set = repo.channelVisible.get(channelId) ?? new Set<string>();
          set.add(productId);
          repo.channelVisible.set(channelId, set);
        },
      },
    });
    expect(result.productIds).toHaveLength(2);
    expect(repo.types).toHaveLength(1);
    expect(repo.attributes).toHaveLength(3);
    expect(priceSets).toHaveLength(3); // 2 变体 + 1 变体
    expect(repo.channelVisible.get("chn_cn")?.size).toBe(2);
  });
});
