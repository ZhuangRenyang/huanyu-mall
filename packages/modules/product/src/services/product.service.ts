import { prefixedUlid } from "@mall/core";
import {
  categoryCannotBeOwnParent,
  categoryHandleTaken,
  categoryHasChildren,
  categoryHasProducts,
  categoryNestingTooDeep,
  categoryNotFound,
  productNotFound,
  variantNotFound,
} from "../errors.js";
import type {
  CategoryDTO,
  CreateCategoryInput,
  CreateProductInput,
  IProductModuleService,
  ProductDTO,
  ProductDetailDTO,
  ProductListItemDTO,
  ProductQuery,
  ProductRepository,
  StockAlertDTO,
  StockAlertRepository,
  SubscribeStockAlertInput,
  ProductStatus,
  SellableVariantDTO,
  SellableVariantQuery,
  UpdateCategoryInput,
  UpdateProductInput,
  VariantDTO,
} from "../types.js";

/** 分类标识：英文名转 slug；中文名转不出可读 slug，退回随机短码。 */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** M01 对外门面（架构 §2.1 契约）。 */
export class ProductService implements IProductModuleService {
  /**
   * `alerts` 可选：只在用到到货提醒时传。
   * 既有单测都是 `new ProductService(repo)`，不给第二个参数就不会破。
   */
  constructor(
    private readonly repo: ProductRepository,
    private readonly alerts?: StockAlertRepository,
  ) {}

  async listProducts(q: ProductQuery = {}): Promise<{ items: ProductDTO[]; count: number }> {
    return this.repo.list(q);
  }

  /** 列表 + 批量变体（一次查询，禁 N+1）。 */
  async listProductsWithVariants(
    q: ProductQuery = {},
  ): Promise<{ items: ProductListItemDTO[]; count: number }> {
    const { items, count } = await this.repo.list(q);
    const variants = await this.repo.listVariantsByProductIds(items.map((p) => p.id));
    const byProduct = new Map<string, VariantDTO[]>();
    for (const v of variants) {
      const list = byProduct.get(v.product_id) ?? [];
      list.push(v);
      byProduct.set(v.product_id, list);
    }
    return {
      items: items.map((p) => ({ ...p, variants: byProduct.get(p.id) ?? [] })),
      count,
    };
  }

  async retrieveProduct(id: string, opts?: { withVariants?: boolean }): Promise<ProductDetailDTO> {
    const product = await this.repo.findById(id);
    if (!product) throw productNotFound(id);
    const [variants, images, categoryLinks] = await Promise.all([
      opts?.withVariants === false ? Promise.resolve([]) : this.repo.listVariantsByProductIds([id]),
      this.repo.listImagesByProductId(id),
      this.repo.listCategoryIdsByProducts([id]),
    ]);
    return {
      ...product,
      variants,
      images,
      category_ids: categoryLinks[0]?.categoryIds ?? [],
    };
  }

  async createProduct(input: CreateProductInput): Promise<ProductDetailDTO> {
    const id = prefixedUlid("prod");
    await this.repo.insert({ ...input, id });
    if (input.variants?.length) await this.repo.createVariants(id, input.variants);
    if (input.images?.length) await this.repo.createImages(id, input.images);
    if (input.categoryIds?.length) await this.repo.linkCategories(id, input.categoryIds);
    return this.retrieveProduct(id);
  }

  /**
   * 整组替换商品图片（后台一次提交整组，前端不用做增量 diff）。
   *
   * 第一张自动成为主图并写回 `thumbnail_file_id` —— 列表页、购物车、订单都用它，
   * 漏写就会出现「详情有图、列表空白」。
   */
  async replaceProductImages(productId: string, fileIds: string[]): Promise<ProductDetailDTO> {
    const existing = await this.repo.findById(productId);
    if (!existing) throw productNotFound(productId);

    await this.repo.softDeleteImages(productId);
    if (fileIds.length > 0) {
      await this.repo.createImages(
        productId,
        fileIds.map((fileId, index) => ({
          fileId,
          sortOrder: index,
          isPrimary: index === 0,
        })),
      );
    }
    await this.repo.update(productId, { thumbnailFileId: fileIds[0] ?? null });
    return this.retrieveProduct(productId);
  }

  async updateProduct(id: string, patch: UpdateProductInput): Promise<ProductDTO> {
    const updated = await this.repo.update(id, patch);
    if (!updated) throw productNotFound(id);
    // 分类是另一张关联表：不在这里整组替换，后台改分类就会静默不生效
    if (patch.categoryIds !== undefined) {
      await this.repo.replaceCategories(id, patch.categoryIds);
    }
    return updated;
  }

  // —— 分类（ADR-028）——

  async listCategories(publishedOnly = false): Promise<CategoryDTO[]> {
    return this.repo.listCategories(publishedOnly);
  }

  async createCategory(input: CreateCategoryInput): Promise<CategoryDTO> {
    const name = input.name.trim();
    const parentId = input.parentId ?? null;
    if (parentId) {
      const parent = await this.repo.findCategoryById(parentId);
      if (!parent) throw categoryNotFound(parentId);
      // 只做两级：父级自己已经是二级分类，就不能再往下挂
      if (parent.parent_id) throw categoryNestingTooDeep();
    }
    const handle = await this.uniqueHandle(input.handle?.trim() || slugify(name) || "category");
    const created = await this.repo.insertCategory({
      id: prefixedUlid("cat"),
      name,
      handle,
      parentId,
      sortOrder: input.sortOrder ?? 0,
    });
    return created;
  }

  async updateCategory(id: string, patch: UpdateCategoryInput): Promise<CategoryDTO> {
    const current = await this.repo.findCategoryById(id);
    if (!current) throw categoryNotFound(id);

    const next: UpdateCategoryInput = {};
    if (patch.name !== undefined) next.name = patch.name.trim();
    if (patch.sortOrder !== undefined) next.sortOrder = patch.sortOrder;

    if (patch.handle !== undefined && patch.handle.trim() !== current.handle) {
      next.handle = await this.uniqueHandle(patch.handle.trim());
    }

    if (patch.parentId !== undefined) {
      const parentId = patch.parentId;
      if (parentId === id) throw categoryCannotBeOwnParent();
      if (parentId) {
        const parent = await this.repo.findCategoryById(parentId);
        if (!parent) throw categoryNotFound(parentId);
        if (parent.parent_id) throw categoryNestingTooDeep();
        // 自己下面已经挂了子分类，就不能再变成别人的子分类（否则成环/超两层）
        const all = await this.repo.listCategories();
        if (all.some((c) => c.parent_id === id)) throw categoryCannotBeOwnParent();
      }
      next.parentId = parentId;
    }

    const updated = await this.repo.updateCategory(id, next);
    if (!updated) throw categoryNotFound(id);
    return updated;
  }

  /**
   * 删除分类。
   *
   * 有子分类或仍有商品时拒绝 —— 软删分类后商品会变成「挂在不存在分类下」，
   * 店面的分类导航与筛选都会指向空页，比直接报错更难排查。
   */
  async deleteCategory(id: string): Promise<void> {
    const current = await this.repo.findCategoryById(id);
    if (!current) throw categoryNotFound(id);
    if (current.product_count > 0) throw categoryHasProducts(current.product_count);
    const all = await this.repo.listCategories();
    const children = all.filter((c) => c.parent_id === id).length;
    if (children > 0) throw categoryHasChildren(children);
    await this.repo.softDeleteCategory(id);
  }

  /** handle 唯一：重复时依次尝试 -2、-3…（商家不该为了一个标识去改名字）。 */
  private async uniqueHandle(base: string): Promise<string> {
    const root = base || "category";
    for (let i = 1; i <= 50; i++) {
      const candidate = i === 1 ? root : `${root}-${i}`;
      const existing = await this.repo.findCategoryByHandle(candidate);
      if (!existing) return candidate;
    }
    throw categoryHandleTaken(root);
  }

  async subscribeStockAlert(input: SubscribeStockAlertInput): Promise<StockAlertDTO> {
    if (!this.alerts) throw new Error("stock alerts repository not wired");
    // 邮箱统一小写去空白：大小写不同的同一邮箱不该在提醒表里存两条
    const email = input.email.trim().toLowerCase();
    const product = await this.repo.findById(input.productId);
    if (!product) throw productNotFound(input.productId);
    // findById 不带变体（列表用才带），单查一次更直观
    const variants = await this.repo.listVariantsByProductIds([input.productId]);
    const variant = variants.find((v) => v.id === input.variantId);
    if (!variant) throw variantNotFound(input.variantId);
    return this.alerts.upsert({
      ...input,
      email,
      id: prefixedUlid("salt"),
    });
  }

  async listPendingStockAlerts(variantIds: string[]): Promise<StockAlertDTO[]> {
    if (!this.alerts) return [];
    return this.alerts.listPendingByVariantIds(variantIds);
  }

  async markStockAlertsNotified(ids: string[]): Promise<number> {
    if (!this.alerts) return 0;
    return this.alerts.markNotified(ids, new Date());
  }

  async variantIdsBySkus(skus: string[]): Promise<Record<string, string>> {
    const rows = await this.repo.listVariantIdsBySkus(skus);
    const out: Record<string, string> = {};
    for (const r of rows) out[r.sku] = r.id;
    return out;
  }

  async countPendingStockAlerts(variantIds: string[]): Promise<Record<string, number>> {
    if (!this.alerts) return {};
    return this.alerts.countPendingByVariantIds(variantIds);
  }

  async countByStatus(): Promise<Record<string, number>> {
    return this.repo.countByStatus();
  }

  /** 批量改状态：一次 SQL 完成，返回实际生效条数（已删的不算）。 */
  async bulkUpdateStatus(ids: string[], status: ProductStatus): Promise<number> {
    const unique = [...new Set(ids)].filter(Boolean);
    if (unique.length === 0) return 0;
    return this.repo.bulkUpdateStatus(unique, status);
  }

  async bulkDelete(ids: string[]): Promise<number> {
    const unique = [...new Set(ids)].filter(Boolean);
    if (unique.length === 0) return 0;
    return this.repo.bulkSoftDelete(unique);
  }

  async deleteProduct(id: string): Promise<void> {
    const existing = await this.repo.findById(id);
    if (!existing) throw productNotFound(id);
    await this.repo.softDelete(id);
  }

  async listVariantsByIds(ids: string[]): Promise<VariantDTO[]> {
    if (ids.length === 0) return [];
    return this.repo.listVariantsByIds(ids);
  }

  async createVariant(productId: string, input: import("../types.js").CreateVariantInput): Promise<VariantDTO> {
    const [variant] = await this.repo.createVariants(productId, [input]);
    return variant!;
  }

  async updateVariant(
    variantId: string,
    patch: { title?: string; status?: import("../types.js").ProductStatus },
  ): Promise<VariantDTO> {
    const updated = await this.repo.updateVariant(variantId, patch);
    if (!updated) throw variantNotFound(variantId);
    return updated;
  }

  async resolveSellableVariants(
    q: SellableVariantQuery,
  ): Promise<{ items: SellableVariantDTO[]; count: number }> {
    const productIds = q.productIds ?? (await this.repo.listSellableProductIds(q.channelId));
    if (productIds.length === 0) return { items: [], count: 0 };

    const variants = await this.repo.listVariantsByProductIds(productIds);
    const sellable = variants.filter((v) => v.status === "published");
    const priceSets = await this.repo.priceSetIdsByVariantIds(sellable.map((v) => v.id));

    const items: SellableVariantDTO[] = sellable.map((v) => ({
      id: v.id,
      product_id: v.product_id,
      sku: v.sku,
      title: v.title,
      options: v.options,
      allow_backorder: v.allow_backorder,
      price_set_id: priceSets.get(v.id) ?? null,
    }));

    const offset = q.offset ?? 0;
    const limit = q.limit ?? 20;
    return { items: items.slice(offset, offset + limit), count: items.length };
  }

  /** 批量查「商品 → 分类」映射（供 promotion 目录促销算折扣，禁 N+1）。 */
  async listCategoryIdsByProducts(
    productIds: string[],
  ): Promise<Array<{ productId: string; categoryIds: string[] }>> {
    if (productIds.length === 0) return [];
    return this.repo.listCategoryIdsByProducts(productIds);
  }

  /**
   * 批量查商品的运费归属（模板 + 是否卖家包邮），供购物车分组算运费。
   *
   * 商品是运费的**归属者**：不同商品可以挂不同模板（重货 / 冷链），
   * 也可以标「卖家包邮」。结账时按这个分组，不能全店一套价。
   */
  async listShippingInfoByProducts(
    productIds: string[],
  ): Promise<Array<{ productId: string; profileId: string | null; freeShipping: boolean }>> {
    if (productIds.length === 0) return [];
    return this.repo.listShippingInfoByProducts(productIds);
  }
}
