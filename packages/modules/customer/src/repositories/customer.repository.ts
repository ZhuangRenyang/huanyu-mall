import { and, asc, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { prefixedUlid, type NodePgDatabase } from "@mall/core";
import * as schema from "../models/index.js";
import type {
  AddAddressInput,
  CreateMemberLevelInput,
  CustomerTagDTO,
  MemberLevelDTO,
  UpdateMemberLevelInput,
  FavoriteDTO,
  AddressDTO,
  CreateCustomerInput,
  CustomerDTO,
  CustomerRepository,
  UpdateAddressInput,
} from "../types.js";

type Db = NodePgDatabase<typeof schema>;

export class DrizzleCustomerRepository implements CustomerRepository {
  constructor(private readonly db: Db) {}

  async insert(input: CreateCustomerInput & { id: string }): Promise<CustomerDTO> {
    const rows = await this.db
      .insert(schema.customer)
      .values({
        id: input.id,
        email: input.email ?? null,
        firstName: input.firstName ?? null,
        lastName: input.lastName ?? null,
        phone: input.phone ?? null,
        metadata: input.metadata ?? null,
      })
      .returning();
    return toCustomerDTO(rows[0]!);
  }

  async findById(id: string): Promise<CustomerDTO | null> {
    const rows = await this.db
      .select()
      .from(schema.customer)
      .where(and(eq(schema.customer.id, id), isNull(schema.customer.deletedAt)))
      .limit(1);
    return rows[0] ? toCustomerDTO(rows[0]) : null;
  }

  async findByEmail(email: string): Promise<CustomerDTO | null> {
    const rows = await this.db
      .select()
      .from(schema.customer)
      .where(and(eq(schema.customer.email, email), isNull(schema.customer.deletedAt)))
      .limit(1);
    return rows[0] ? toCustomerDTO(rows[0]) : null;
  }

  async list(q: {
    q?: string;
    tagId?: string;
    limit: number;
    offset: number;
  }): Promise<{ items: CustomerDTO[]; count: number }> {
    const conditions = [isNull(schema.customer.deletedAt)];
    if (q.q) {
      // 邮箱或姓名都能搜：商家手上通常只有其中一个
      const like = `%${q.q}%`;
      conditions.push(
        sql`(${schema.customer.email} ILIKE ${like}
          OR coalesce(${schema.customer.firstName}, '') ILIKE ${like}
          OR coalesce(${schema.customer.lastName}, '') ILIKE ${like})`,
      );
    }
    if (q.tagId) {
      // EXISTS 比 join + distinct 更省：分页与计数用的是同一段条件
      conditions.push(
        sql`EXISTS (SELECT 1 FROM customer_tag_link l
                    WHERE l.customer_id = ${schema.customer.id} AND l.tag_id = ${q.tagId})`,
      );
    }
    const where = and(...conditions);
    const rows = await this.db
      .select()
      .from(schema.customer)
      .where(where)
      .limit(q.limit)
      .offset(q.offset);
    const countRows = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.customer)
      .where(where);
    return { items: rows.map(toCustomerDTO), count: countRows[0]?.count ?? 0 };
  }

  async softDelete(id: string): Promise<void> {
    await this.db
      .update(schema.customer)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.customer.id, id));
  }

  async listAddresses(customerId: string): Promise<AddressDTO[]> {
    // 默认地址排最前：淘宝/Shopify 的地址簿都是这个顺序，顾客不用自己找
    const rows = await this.db
      .select()
      .from(schema.customerAddress)
      .where(and(eq(schema.customerAddress.customerId, customerId), isNull(schema.customerAddress.deletedAt)))
      .orderBy(desc(schema.customerAddress.isDefaultShipping), desc(schema.customerAddress.createdAt));
    return rows.map(toAddressDTO);
  }

  async findAddress(addressId: string): Promise<AddressDTO | null> {
    const rows = await this.db
      .select()
      .from(schema.customerAddress)
      .where(and(eq(schema.customerAddress.id, addressId), isNull(schema.customerAddress.deletedAt)))
      .limit(1);
    return rows[0] ? toAddressDTO(rows[0]) : null;
  }

  async insertAddress(customerId: string, input: AddAddressInput): Promise<AddressDTO> {
    const rows = await this.db
      .insert(schema.customerAddress)
      .values({
        id: prefixedUlid("addr"),
        customerId,
        firstName: input.firstName,
        lastName: input.lastName ?? null,
        phone: input.phone ?? null,
        line1: input.line1,
        line2: input.line2 ?? null,
        city: input.city ?? null,
        province: input.province ?? null,
        postalCode: input.postalCode ?? null,
        countryCode: input.countryCode,
        isDefaultShipping: input.isDefaultShipping ?? false,
        isDefaultBilling: input.isDefaultBilling ?? false,
      })
      .returning();
    return toAddressDTO(rows[0]!);
  }

  async updateAddress(addressId: string, patch: UpdateAddressInput): Promise<AddressDTO | null> {
    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (patch.firstName !== undefined) set.firstName = patch.firstName;
    if (patch.lastName !== undefined) set.lastName = patch.lastName;
    if (patch.phone !== undefined) set.phone = patch.phone;
    if (patch.line1 !== undefined) set.line1 = patch.line1;
    if (patch.line2 !== undefined) set.line2 = patch.line2;
    if (patch.city !== undefined) set.city = patch.city;
    if (patch.province !== undefined) set.province = patch.province;
    if (patch.postalCode !== undefined) set.postalCode = patch.postalCode;
    if (patch.countryCode !== undefined) set.countryCode = patch.countryCode;
    if (patch.isDefaultShipping !== undefined) set.isDefaultShipping = patch.isDefaultShipping;
    if (patch.isDefaultBilling !== undefined) set.isDefaultBilling = patch.isDefaultBilling;
    const rows = await this.db
      .update(schema.customerAddress)
      .set(set)
      .where(eq(schema.customerAddress.id, addressId))
      .returning();
    return rows[0] ? toAddressDTO(rows[0]) : null;
  }

  /** 取消该客户所有地址的默认标记（`exceptId` 用于「把其中一条改成默认」时排除自身）。 */
  async clearDefaultShipping(customerId: string, exceptId?: string): Promise<void> {
    const conditions = [
      eq(schema.customerAddress.customerId, customerId),
      isNull(schema.customerAddress.deletedAt),
    ];
    if (exceptId) conditions.push(ne(schema.customerAddress.id, exceptId));
    await this.db
      .update(schema.customerAddress)
      .set({ isDefaultShipping: false, updatedAt: new Date() })
      .where(and(...conditions));
  }

  /**
   * 设为唯一默认收货地址：先清后设在同一事务里。
   *
   * 不放在服务层分两步做：两个请求并发「设为默认」时会各清各的、最后两条都是默认。
   */
  async setDefaultShipping(customerId: string, addressId: string): Promise<AddressDTO> {
    return this.db.transaction(async (tx) => {
      await tx
        .update(schema.customerAddress)
        .set({ isDefaultShipping: false, updatedAt: new Date() })
        .where(
          and(
            eq(schema.customerAddress.customerId, customerId),
            isNull(schema.customerAddress.deletedAt),
          ),
        );
      const rows = await tx
        .update(schema.customerAddress)
        .set({ isDefaultShipping: true, updatedAt: new Date() })
        .where(eq(schema.customerAddress.id, addressId))
        .returning();
      return toAddressDTO(rows[0]!);
    });
  }

  // —— 收藏（ADR-048）——

  async insertFavorite(input: { id: string; customerId: string; productId: string }): Promise<void> {
    // onConflictDoNothing：重复收藏是幂等的（连点两下不该报错）
    await this.db
      .insert(schema.customerFavorite)
      .values({ id: input.id, customerId: input.customerId, productId: input.productId })
      .onConflictDoNothing();
  }

  async deleteFavorite(customerId: string, productId: string): Promise<void> {
    await this.db
      .delete(schema.customerFavorite)
      .where(
        and(
          eq(schema.customerFavorite.customerId, customerId),
          eq(schema.customerFavorite.productId, productId),
        ),
      );
  }

  async listFavorites(
    customerId: string,
    q: { limit: number; offset: number },
  ): Promise<{ items: FavoriteDTO[]; count: number }> {
    const rows = await this.db
      .select()
      .from(schema.customerFavorite)
      .where(eq(schema.customerFavorite.customerId, customerId))
      .orderBy(desc(schema.customerFavorite.createdAt))
      .limit(q.limit)
      .offset(q.offset);
    const countRows = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.customerFavorite)
      .where(eq(schema.customerFavorite.customerId, customerId));
    return {
      items: rows.map((r) => ({ product_id: r.productId, created_at: r.createdAt })),
      count: Number(countRows[0]?.count ?? 0),
    };
  }

  async listFavoriteProductIds(customerId: string): Promise<string[]> {
    const rows = await this.db
      .select({ productId: schema.customerFavorite.productId })
      .from(schema.customerFavorite)
      .where(eq(schema.customerFavorite.customerId, customerId))
      .orderBy(desc(schema.customerFavorite.createdAt));
    return rows.map((r) => r.productId);
  }

  async softDeleteAddress(addressId: string): Promise<void> {
    await this.db
      .update(schema.customerAddress)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.customerAddress.id, addressId));
  }

  // —— 会员标签（ADR-103）——

  async listTags(): Promise<CustomerTagDTO[]> {
    /*
     * 标签 + 客户数一次查完：逐个标签 count 就是 N+1，
     * 标签十几个之后页面会明显卡。
     */
    const rows = await this.db
      .select({
        tag: schema.customerTag,
        count: sql<number>`count(${schema.customerTagLink.customerId})::int`,
      })
      .from(schema.customerTag)
      .leftJoin(schema.customerTagLink, eq(schema.customerTagLink.tagId, schema.customerTag.id))
      .groupBy(schema.customerTag.id)
      .orderBy(asc(schema.customerTag.createdAt));
    return rows.map((r) => toTagDTO(r.tag, Number(r.count ?? 0)));
  }

  async findTag(id: string): Promise<CustomerTagDTO | null> {
    const rows = await this.db
      .select()
      .from(schema.customerTag)
      .where(eq(schema.customerTag.id, id))
      .limit(1);
    return rows[0] ? toTagDTO(rows[0], 0) : null;
  }

  async findTagByName(name: string): Promise<CustomerTagDTO | null> {
    const rows = await this.db
      .select()
      .from(schema.customerTag)
      .where(eq(schema.customerTag.name, name))
      .limit(1);
    return rows[0] ? toTagDTO(rows[0], 0) : null;
  }

  async insertTag(row: { id: string; name: string }): Promise<CustomerTagDTO> {
    const rows = await this.db.insert(schema.customerTag).values(row).returning();
    return toTagDTO(rows[0]!, 0);
  }

  async deleteTag(id: string): Promise<void> {
    // 先清关联再删标签：反过来会留下指向不存在标签的孤儿行
    await this.db.delete(schema.customerTagLink).where(eq(schema.customerTagLink.tagId, id));
    await this.db.delete(schema.customerTag).where(eq(schema.customerTag.id, id));
  }

  async setCustomerTags(customerId: string, tagIds: string[]): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx
        .delete(schema.customerTagLink)
        .where(eq(schema.customerTagLink.customerId, customerId));
      if (tagIds.length > 0) {
        await tx
          .insert(schema.customerTagLink)
          .values(tagIds.map((tagId) => ({ customerId, tagId })))
          // 同一标签重复传不报错（覆盖式语义）
          .onConflictDoNothing();
      }
    });
  }

  async listCustomerTags(customerId: string): Promise<CustomerTagDTO[]> {
    const rows = await this.db
      .select({ tag: schema.customerTag })
      .from(schema.customerTagLink)
      .innerJoin(schema.customerTag, eq(schema.customerTag.id, schema.customerTagLink.tagId))
      .where(eq(schema.customerTagLink.customerId, customerId))
      .orderBy(asc(schema.customerTag.createdAt));
    return rows.map((r) => toTagDTO(r.tag, 0));
  }

  async listTagsByCustomerIds(customerIds: string[]): Promise<Record<string, CustomerTagDTO[]>> {
    if (customerIds.length === 0) return {};
    const rows = await this.db
      .select({ customerId: schema.customerTagLink.customerId, tag: schema.customerTag })
      .from(schema.customerTagLink)
      .innerJoin(schema.customerTag, eq(schema.customerTag.id, schema.customerTagLink.tagId))
      .where(inArray(schema.customerTagLink.customerId, customerIds));
    const out: Record<string, CustomerTagDTO[]> = {};
    for (const r of rows) {
      (out[r.customerId] ??= []).push(toTagDTO(r.tag, 0));
    }
    return out;
  }

  // —— 会员等级（ADR-102）——

  async insertMemberLevel(
    input: CreateMemberLevelInput & { id: string; sort: number },
  ): Promise<MemberLevelDTO> {
    const rows = await this.db
      .insert(schema.memberLevel)
      .values({
        id: input.id,
        name: input.name,
        thresholdMinor: input.thresholdMinor,
        discountBps: input.discountBps,
        sort: input.sort,
      })
      .returning();
    return toMemberLevelDTO(rows[0]!);
  }

  async listMemberLevels(): Promise<MemberLevelDTO[]> {
    const rows = await this.db
      .select()
      .from(schema.memberLevel)
      // 门槛从低到高：列表就是「等级阶梯」
      .orderBy(schema.memberLevel.thresholdMinor);
    return rows.map(toMemberLevelDTO);
  }

  async findMemberLevel(id: string): Promise<MemberLevelDTO | null> {
    const rows = await this.db
      .select()
      .from(schema.memberLevel)
      .where(eq(schema.memberLevel.id, id))
      .limit(1);
    return rows[0] ? toMemberLevelDTO(rows[0]) : null;
  }

  async updateMemberLevel(
    id: string,
    patch: UpdateMemberLevelInput,
  ): Promise<MemberLevelDTO | null> {
    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (patch.name !== undefined) set.name = patch.name;
    if (patch.thresholdMinor !== undefined) set.thresholdMinor = patch.thresholdMinor;
    if (patch.discountBps !== undefined) set.discountBps = patch.discountBps;
    const rows = await this.db
      .update(schema.memberLevel)
      .set(set)
      .where(eq(schema.memberLevel.id, id))
      .returning();
    return rows[0] ? toMemberLevelDTO(rows[0]) : null;
  }

}

function toTagDTO(r: typeof schema.customerTag.$inferSelect, customerCount: number): CustomerTagDTO {
  return {
    id: r.id,
    name: r.name,
    customer_count: customerCount,
  };
}

function toMemberLevelDTO(r: typeof schema.memberLevel.$inferSelect): MemberLevelDTO {
  return {
    id: r.id,
    name: r.name,
    threshold_minor: r.thresholdMinor,
    discount_bps: r.discountBps,
    sort: r.sort,
  };
}

function toCustomerDTO(r: typeof schema.customer.$inferSelect): CustomerDTO {
  return {
    id: r.id,
    email: r.email ?? null,
    first_name: r.firstName ?? null,
    last_name: r.lastName ?? null,
    phone: r.phone ?? null,
    metadata: (r.metadata as Record<string, unknown> | null) ?? null,
  };
}

function toAddressDTO(r: typeof schema.customerAddress.$inferSelect): AddressDTO {
  return {
    id: r.id,
    customer_id: r.customerId,
    first_name: r.firstName,
    last_name: r.lastName ?? null,
    phone: r.phone ?? null,
    line1: r.line1,
    line2: r.line2 ?? null,
    city: r.city ?? null,
    province: r.province ?? null,
    postal_code: r.postalCode ?? null,
    country_code: r.countryCode,
    is_default_shipping: r.isDefaultShipping,
    is_default_billing: r.isDefaultBilling,
  };
}
