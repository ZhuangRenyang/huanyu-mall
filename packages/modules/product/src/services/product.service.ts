import { prefixedUlid } from "@mall/core";
import { productNotFound, variantNotFound } from "../errors.js";
import type {
  CreateProductInput,
  IProductModuleService,
  ProductDTO,
  ProductDetailDTO,
  ProductListItemDTO,
  ProductQuery,
  ProductRepository,
  SellableVariantDTO,
  SellableVariantQuery,
  UpdateProductInput,
  VariantDTO,
} from "../types.js";

/** M01 对外门面（架构 §2.1 契约）。 */
export class ProductService implements IProductModuleService {
  constructor(private readonly repo: ProductRepository) {}

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
    const variants = opts?.withVariants === false ? [] : await this.repo.listVariantsByProductIds([id]);
    const images = await this.repo.listImagesByProductId(id);
    return { ...product, variants, images };
  }

  async createProduct(input: CreateProductInput): Promise<ProductDetailDTO> {
    const id = prefixedUlid("prod");
    await this.repo.insert({ ...input, id });
    if (input.variants?.length) await this.repo.createVariants(id, input.variants);
    if (input.images?.length) await this.repo.createImages(id, input.images);
    if (input.categoryIds?.length) await this.repo.linkCategories(id, input.categoryIds);
    return this.retrieveProduct(id);
  }

  async updateProduct(id: string, patch: UpdateProductInput): Promise<ProductDTO> {
    const updated = await this.repo.update(id, patch);
    if (!updated) throw productNotFound(id);
    return updated;
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
}
