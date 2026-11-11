import { and, eq, isNull, sql } from "drizzle-orm";
import { prefixedUlid, type NodePgDatabase } from "@mall/core";
import * as schema from "../models/index.js";
import type {
  AddLineItemInput,
  ResolvedLineItem,
  ShippingMethodInput,
  CartDTO,
  CartLineItemDTO,
  CartRepository,
  CartShippingMethodDTO,
  CartStatus,
  CartTotals,
  CreateCartInput,
  SetShippingInput,
} from "../types.js";

type Db = NodePgDatabase<typeof schema>;

export class DrizzleCartRepository implements CartRepository {
  constructor(private readonly db: Db) {}

  async insert(input: CreateCartInput & { id: string }): Promise<CartDTO> {
    const rows = await this.db
      .insert(schema.cart)
      .values({
        id: input.id,
        channelId: input.channelId,
        regionId: input.regionId,
        currencyCode: input.currencyCode,
        customerId: input.customerId ?? null,
        email: input.email ?? null,
        status: "open",
      })
      .returning();
    return toCartDTO(rows[0]!);
  }

  async findById(id: string): Promise<CartDTO | null> {
    const rows = await this.db
      .select()
      .from(schema.cart)
      .where(and(eq(schema.cart.id, id), isNull(schema.cart.deletedAt)))
      .limit(1);
    return rows[0] ? toCartDTO(rows[0]) : null;
  }

  async updateStatus(id: string, status: CartStatus): Promise<void> {
    await this.db.update(schema.cart).set({ status, updatedAt: new Date() }).where(eq(schema.cart.id, id));
  }

  async updateShippingCountry(id: string, countryCode: string): Promise<void> {
    await this.db
      .update(schema.cart)
      .set({ shippingCountry: countryCode, updatedAt: new Date() })
      .where(eq(schema.cart.id, id));
  }

  async updateVoucherCodes(id: string, codes: string[]): Promise<void> {
    await this.db
      .update(schema.cart)
      .set({ voucherCodes: codes, updatedAt: new Date() })
      .where(eq(schema.cart.id, id));
  }

  async updateGiftCardCodes(id: string, codes: string[]): Promise<void> {
    await this.db
      .update(schema.cart)
      .set({ giftCardCodes: codes, updatedAt: new Date() })
      .where(eq(schema.cart.id, id));
  }

  async softDelete(id: string): Promise<void> {
    await this.db
      .update(schema.cart)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.cart.id, id));
  }

  async restore(id: string): Promise<void> {
    await this.db.update(schema.cart).set({ deletedAt: null, updatedAt: new Date() }).where(eq(schema.cart.id, id));
  }

  async listLineItems(cartId: string): Promise<CartLineItemDTO[]> {
    const rows = await this.db
      .select()
      .from(schema.cartLineItem)
      .where(and(eq(schema.cartLineItem.cartId, cartId), isNull(schema.cartLineItem.deletedAt)));
    return rows.map(toLineItemDTO);
  }

  async findLineItem(lineId: string): Promise<CartLineItemDTO | null> {
    const rows = await this.db
      .select()
      .from(schema.cartLineItem)
      .where(and(eq(schema.cartLineItem.id, lineId), isNull(schema.cartLineItem.deletedAt)))
      .limit(1);
    return rows[0] ? toLineItemDTO(rows[0]) : null;
  }

  async insertLineItem(cartId: string, input: ResolvedLineItem): Promise<CartLineItemDTO> {
    const rows = await this.db
      .insert(schema.cartLineItem)
      .values({
        id: prefixedUlid("cli"),
        cartId,
        variantId: input.variantId,
        productId: input.productId,
        title: input.title,
        quantity: input.quantity,
        unitPriceMinor: input.unitPriceMinor,
        currencyCode: input.currencyCode,
      })
      .returning();
    return toLineItemDTO(rows[0]!);
  }

  async updateLineItemQuantity(lineId: string, quantity: number): Promise<void> {
    await this.db
      .update(schema.cartLineItem)
      .set({ quantity, updatedAt: new Date() })
      .where(eq(schema.cartLineItem.id, lineId));
  }

  async softDeleteLineItem(lineId: string): Promise<void> {
    await this.db
      .update(schema.cartLineItem)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.cartLineItem.id, lineId));
  }

  async upsertShippingMethod(
    cartId: string,
    input: ShippingMethodInput & { currencyCode: string },
  ): Promise<void> {
    await this.db
      .update(schema.cartShippingMethod)
      .set({ deletedAt: new Date() })
      .where(and(eq(schema.cartShippingMethod.cartId, cartId), isNull(schema.cartShippingMethod.deletedAt)));
    await this.db.insert(schema.cartShippingMethod).values({
      id: prefixedUlid("csm"),
      cartId,
      shippingOptionId: input.shippingOptionId,
      name: input.name,
      amountMinor: input.amountMinor,
      currencyCode: input.currencyCode,
    });
  }

  async findShippingMethod(cartId: string): Promise<CartShippingMethodDTO | null> {
    const rows = await this.db
      .select()
      .from(schema.cartShippingMethod)
      .where(and(eq(schema.cartShippingMethod.cartId, cartId), isNull(schema.cartShippingMethod.deletedAt)))
      .limit(1);
    return rows[0] ? toShippingDTO(rows[0]) : null;
  }

  async linkCustomer(cartId: string, customerId: string): Promise<void> {
    await this.db.execute(
      sql`INSERT INTO cart_customer (id, cart_id, customer_id) VALUES (${prefixedUlid("lnk")}, ${cartId}, ${customerId})`,
    );
  }
}

function toCartDTO(r: typeof schema.cart.$inferSelect): CartDTO {
  return {
    id: r.id,
    channel_id: r.channelId,
    region_id: r.regionId,
    currency_code: r.currencyCode,
    customer_id: r.customerId ?? null,
    email: r.email ?? null,
    status: r.status as CartStatus,
    shipping_country: r.shippingCountry ?? null,
    voucher_codes: parseVoucherCodes(r.voucherCodes),
    gift_card_codes: parseStringArray(r.giftCardCodes),
    totals: parseTotals(r.totals),
  };
}

/** voucher_codes 是 string[] 的 jsonb；空/非数组一律按 []（容忍脏数据）。 */
function parseVoucherCodes(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((c): c is string => typeof c === "string");
}

/** gift_card_codes 是 string[] 的 jsonb；空/非数组一律按 []（容忍脏数据）。 */
function parseStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((c): c is string => typeof c === "string");
}

function parseTotals(raw: unknown): CartTotals | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, string>;
  return {
    subtotal_minor: BigInt(o.subtotal_minor ?? 0),
    shipping_minor: BigInt(o.shipping_minor ?? 0),
    tax_minor: BigInt(o.tax_minor ?? 0),
    shipping_tax_minor: BigInt(o.shipping_tax_minor ?? 0),
    total_minor: BigInt(o.total_minor ?? 0),
    discount_minor: BigInt(o.discount_minor ?? 0),
  };
}

function toLineItemDTO(r: typeof schema.cartLineItem.$inferSelect): CartLineItemDTO {
  return {
    id: r.id,
    cart_id: r.cartId,
    variant_id: r.variantId,
    product_id: r.productId,
    title: r.title,
    quantity: r.quantity,
    unit_price_minor: r.unitPriceMinor,
    currency_code: r.currencyCode,
    discount_minor: 0n, // 落库行无折扣，retrieveCart 读时动态算
    // 税额由服务层按收货国家读时算，落库行恒 0（与 discount_minor 同一策略）
    tax_rate_bps: 0,
    tax_amount_minor: 0n,
  };
}

function toShippingDTO(r: typeof schema.cartShippingMethod.$inferSelect): CartShippingMethodDTO {
  return {
    id: r.id,
    cart_id: r.cartId,
    shipping_option_id: r.shippingOptionId,
    name: r.name,
    amount_minor: r.amountMinor,
    currency_code: r.currencyCode,
  };
}
