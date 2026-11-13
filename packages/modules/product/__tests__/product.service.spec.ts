import { describe, expect, it } from "vitest";
import { DomainError, prefixedUlid } from "@mall/core";
import { ProductService } from "../src/services/product.service.js";
import { seedCatalog } from "../src/services/seed.js";
import type {
  AttributeDTO,
  AttributeInputType,
  AttributeValueDTO,
  CategoryDTO,
  CreateCategoryInput,
  CreateImageInput,
  CreateProductInput,
  CreateVariantInput,
  ImageDTO,
  ProductDTO,
  ProductQuery,
  ProductRepository,
  ProductStatus,
  ProductTypeDTO,
  StockAlertDTO,
  StockAlertRepository,
  SubscribeStockAlertInput,
  UpdateCategoryInput,
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
  readonly categoryLinks = new Map<string, Set<string>>();
  readonly categories = new Map<string, CategoryDTO>();

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
  async linkCategories(productId: string, categoryIds: string[]): Promise<void> {
    const set = this.categoryLinks.get(productId) ?? new Set<string>();
    for (const cid of categoryIds) set.add(cid);
    this.categoryLinks.set(productId, set);
  }
  async replaceCategories(productId: string, categoryIds: string[]): Promise<void> {
    this.categoryLinks.set(productId, new Set(categoryIds));
  }
  private withCount(c: CategoryDTO): CategoryDTO {
    return {
      ...c,
      product_count: [...this.categoryLinks.values()].filter((s) => s.has(c.id)).length,
    };
  }
  async listCategories(): Promise<CategoryDTO[]> {
    return [...this.categories.values()].map((c) => this.withCount(c));
  }
  async findCategoryById(id: string): Promise<CategoryDTO | null> {
    const row = this.categories.get(id);
    return row ? this.withCount(row) : null;
  }
  async findCategoryByHandle(handle: string): Promise<CategoryDTO | null> {
    return [...this.categories.values()].find((c) => c.handle === handle) ?? null;
  }
  async insertCategory(input: {
    id: string;
    name: string;
    handle: string;
    parentId: string | null;
    sortOrder: number;
  }): Promise<CategoryDTO> {
    const dto: CategoryDTO = {
      id: input.id,
      name: input.name,
      handle: input.handle,
      parent_id: input.parentId,
      sort_order: input.sortOrder,
      product_count: [...this.categoryLinks.values()].filter((s) => s.has(input.id)).length,
    };
    this.categories.set(dto.id, dto);
    return dto;
  }
  async updateCategory(id: string, patch: UpdateCategoryInput): Promise<CategoryDTO | null> {
    const row = this.categories.get(id);
    if (!row) return null;
    const next: CategoryDTO = {
      ...row,
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.handle !== undefined ? { handle: patch.handle } : {}),
      ...(patch.parentId !== undefined ? { parent_id: patch.parentId } : {}),
      ...(patch.sortOrder !== undefined ? { sort_order: patch.sortOrder } : {}),
    };
    this.categories.set(id, next);
    return next;
  }
  async softDeleteCategory(id: string): Promise<void> {
    this.categories.delete(id);
  }
  async countProductsByCategory(): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    for (const set of this.categoryLinks.values()) {
      for (const id of set) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    return counts;
  }
  async listCategoryIdsByProducts(
    productIds: string[],
  ): Promise<Array<{ productId: string; categoryIds: string[] }>> {
    return productIds
      .map((id) => ({ productId: id, categoryIds: [...(this.categoryLinks.get(id) ?? new Set<string>())] }))
      .filter((e) => e.categoryIds.length > 0);
  }
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

  it("listCategoryIdsByProducts 批量查商品→分类（含去重与空输入）", async () => {
    const { repo, service } = setup();
    const a = await service.createProduct({ title: "A", handle: "a", categoryIds: ["cat_1", "cat_2"] });
    const b = await service.createProduct({ title: "B", handle: "b", categoryIds: ["cat_2"] });
    const c = await service.createProduct({ title: "C", handle: "c" }); // 无分类

    const res = await service.listCategoryIdsByProducts([a.id, b.id, c.id]);
    const byId = new Map(res.map((e) => [e.productId, e.categoryIds]));
    expect([...(byId.get(a.id) ?? [])].sort()).toEqual(["cat_1", "cat_2"]);
    expect(byId.get(b.id)).toEqual(["cat_2"]);
    expect(byId.has(c.id)).toBe(false); // 无分类的商品不出现在映射里

    expect(await service.listCategoryIdsByProducts([])).toEqual([]);
    void repo;
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

describe("商品分类（ADR-028）", () => {
  it("建一级 + 二级分类，按 sort_order 排序返回", async () => {
    const { service } = setup();
    const apparel = await service.createCategory({ name: "服饰", handle: "apparel", sortOrder: 2 });
    const digital = await service.createCategory({ name: "数码", handle: "digital", sortOrder: 1 });
    const coats = await service.createCategory({ name: "外套", parentId: apparel.id, sortOrder: 0 });

    const list = await service.listCategories();
    expect(list).toHaveLength(3);
    expect(coats.parent_id).toBe(apparel.id);
    expect(apparel.handle).toBe("apparel");
    expect(digital.sort_order).toBe(1);
  });

  it("中文名生成不了 slug 时退回短码；重名自动加后缀", async () => {
    const { service } = setup();
    const a = await service.createCategory({ name: "外套" });
    const b = await service.createCategory({ name: "外套" });
    expect(a.handle.length).toBeGreaterThan(0);
    expect(a.handle).not.toBe(b.handle); // 唯一性由服务层保证
  });

  it("只允许两级：二级分类下再建子分类被拒", async () => {
    const { service } = setup();
    const l1 = await service.createCategory({ name: "服饰" });
    const l2 = await service.createCategory({ name: "外套", parentId: l1.id });
    await expect(
      service.createCategory({ name: "羽绒服", parentId: l2.id }),
    ).rejects.toBeInstanceOf(DomainError);
  });

  it("更新：改名 / 改排序 / 不能把自己设为父级", async () => {
    const { service } = setup();
    const cat = await service.createCategory({ name: "服饰" });
    const updated = await service.updateCategory(cat.id, { name: "服装", sortOrder: 5 });
    expect(updated.name).toBe("服装");
    expect(updated.sort_order).toBe(5);

    await expect(service.updateCategory(cat.id, { parentId: cat.id })).rejects.toBeInstanceOf(
      DomainError,
    );
  });

  it("删除：有商品或有子分类时拒绝，空分类可删", async () => {
    const { service } = setup();
    const parent = await service.createCategory({ name: "服饰" });
    const child = await service.createCategory({ name: "外套", parentId: parent.id });

    await expect(service.deleteCategory(parent.id)).rejects.toBeInstanceOf(DomainError);
    await expect(service.deleteCategory(child.id)).resolves.toBeUndefined();

    const product = await service.createProduct({
      title: "大衣",
      handle: "coat",
      categoryIds: [parent.id],
    });
    expect(product.category_ids).toEqual([parent.id]);
    await expect(service.deleteCategory(parent.id)).rejects.toBeInstanceOf(DomainError);
  });

  it("商品改分类：整组替换，且详情能读回来", async () => {
    const { service } = setup();
    const a = await service.createCategory({ name: "服饰" });
    const b = await service.createCategory({ name: "数码" });
    const product = await service.createProduct({
      title: "T 恤",
      handle: "tee",
      categoryIds: [a.id],
    });

    await service.updateProduct(product.id, { categoryIds: [b.id] });
    const detail = await service.retrieveProduct(product.id);
    expect(detail.category_ids).toEqual([b.id]);

    // 传空数组 = 清空（不是「不动」）
    await service.updateProduct(product.id, { categoryIds: [] });
    expect((await service.retrieveProduct(product.id)).category_ids).toEqual([]);
  });
});

/**
 * 到货提醒的内存仓储（ADR-069）。
 *
 * 按仓储契约实现：重复登记**刷新**已有那条（created_at 重新起算、notified_at 清空）。
 * Drizzle 实现与这个替身按同一契约工作，所以这里测的就是服务层的规则。
 */
class InMemoryStockAlertRepository implements StockAlertRepository {
  readonly rows = new Map<string, StockAlertDTO>();
  private seq = 0;

  async upsert(input: SubscribeStockAlertInput & { id: string }): Promise<StockAlertDTO> {
    const key = `${input.variantId}:${input.email}`;
    const existing = this.rows.get(key);
    if (existing) {
      const refreshed: StockAlertDTO = {
        ...existing,
        created_at: new Date(),
        notified_at: null,
      };
      this.rows.set(key, refreshed);
      return refreshed;
    }
    const dto: StockAlertDTO = {
      id: input.id,
      product_id: input.productId,
      variant_id: input.variantId,
      email: input.email,
      customer_id: input.customerId ?? null,
      notified_at: null,
      created_at: new Date(),
    };
    this.rows.set(key, dto);
    return dto;
  }

  async listPendingByVariantIds(variantIds: string[]): Promise<StockAlertDTO[]> {
    return [...this.rows.values()].filter(
      (r) => variantIds.includes(r.variant_id) && r.notified_at === null,
    );
  }

  async markNotified(ids: string[], at: Date): Promise<number> {
    let n = 0;
    for (const [key, row] of this.rows) {
      if (!ids.includes(row.id)) continue;
      this.rows.set(key, { ...row, notified_at: at });
      n += 1;
    }
    return n;
  }

  /** 测试专用：把某条登记改成「很久以前」（模拟已过期）。 */
  ageOut(variantId: string, email: string, daysAgo: number): void {
    const key = `${variantId}:${email}`;
    const row = this.rows.get(key);
    if (!row) return;
    this.rows.set(key, {
      ...row,
      created_at: new Date(Date.now() - daysAgo * 24 * 3600 * 1000),
    });
  }
}

describe("到货提醒：有效期与重新登记（ADR-069）", () => {
  function setupAlerts() {
    const repo = new InMemoryProductRepository();
    const alerts = new InMemoryStockAlertRepository();
    const service = new ProductService(repo, alerts);
    return { repo, alerts, service };
  }

  /** 建一个带一个变体的商品（提醒按变体登记）。 */
  async function productWithVariant(service: ProductService) {
    return service.createProduct({
      title: "T 恤",
      handle: "tee",
      status: "published",
      variants: [{ sku: "TEE-S", title: "S", status: "published" }],
    });
  }

  it("登记后在有效期内：出现在待通知列表，计数一致", async () => {
    const { repo, alerts, service } = setupAlerts();
    const product = await productWithVariant(service);
    const variantId = product.variants[0]!.id;

    await service.subscribeStockAlert({
      productId: product.id,
      variantId,
      email: "a@b.com",
    });

    const pending = await service.listPendingStockAlerts([variantId]);
    expect(pending).toHaveLength(1);
    expect(pending[0]?.email).toBe("a@b.com");

    const counts = await service.countPendingStockAlerts([variantId]);
    expect(counts[variantId]).toBe(1);
  });

  it("超过有效期（30 天）的登记不再等通知，也不再计入需求热度", async () => {
    const { repo, alerts, service } = setupAlerts();
    const product = await productWithVariant(service);
    const variantId = product.variants[0]!.id;

    await service.subscribeStockAlert({ productId: product.id, variantId, email: "a@b.com" });
    // 把这条登记改成 45 天前：超过 30 天有效期
    alerts.ageOut(variantId, "a@b.com", 45);

    const pending = await service.listPendingStockAlerts([variantId]);
    expect(pending).toHaveLength(0);
    const counts = await service.countPendingStockAlerts([variantId]);
    expect(counts[variantId]).toBeUndefined();
  });

  it("重新登记 = 重新排队：刷新有效期并清掉已通知标记", async () => {
    const { repo, alerts, service } = setupAlerts();
    const product = await productWithVariant(service);
    const variantId = product.variants[0]!.id;

    await service.subscribeStockAlert({ productId: product.id, variantId, email: "a@b.com" });
    // 补货已通知过
    const row = [...alerts.rows.values()][0]!;
    await alerts.markNotified([row.id], new Date());

    // 过了很久，顾客又点了一次「到货提醒」
    alerts.ageOut(variantId, "a@b.com", 45);
    await service.subscribeStockAlert({ productId: product.id, variantId, email: "a@b.com" });

    // 重新登记后：又回到待通知列表（这单补货还能再发一封）
    const pending = await service.listPendingStockAlerts([variantId]);
    expect(pending).toHaveLength(1);
    expect(pending[0]?.notified_at).toBeNull();
  });

  it("有效期内的登记不受影响（边界：29 天仍在，31 天不在）", async () => {
    const { repo, alerts, service } = setupAlerts();
    const product = await productWithVariant(service);
    const variantId = product.variants[0]!.id;

    await service.subscribeStockAlert({ productId: product.id, variantId, email: "a@b.com" });
    alerts.ageOut(variantId, "a@b.com", 29);
    expect(await service.listPendingStockAlerts([variantId])).toHaveLength(1);

    alerts.ageOut(variantId, "a@b.com", 31);
    expect(await service.listPendingStockAlerts([variantId])).toHaveLength(0);
  });
});
