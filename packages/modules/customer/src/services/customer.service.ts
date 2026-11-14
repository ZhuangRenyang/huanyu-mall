import { DomainError, prefixedUlid } from "@mall/core";
import { addressNotFound, addressNotOwned, customerNotFound } from "../errors.js";
import type {
  AddAddressInput,
  AddressDTO,
  CreateCustomerInput,
  CreateMemberLevelInput,
  CustomerTagDTO,
  FavoriteDTO,
  CustomerDTO,
  MemberLevelDTO,
  UpdateMemberLevelInput,
  CustomerRepository,
  ICustomerModuleService,
  UpdateAddressInput,
} from "../types.js";

/** M10 对外门面。手机号仅软标识：不校验格式、不发短信（用户已定案）。 */
export class CustomerService implements ICustomerModuleService {
  constructor(private readonly repo: CustomerRepository) {}

  async createCustomer(input: CreateCustomerInput): Promise<CustomerDTO> {
    return this.repo.insert({ ...input, id: prefixedUlid("cust") });
  }

  async retrieveCustomer(id: string): Promise<CustomerDTO> {
    const customer = await this.repo.findById(id);
    if (!customer) throw customerNotFound(id);
    return customer;
  }

  async retrieveCustomerByEmail(email: string): Promise<CustomerDTO | null> {
    return this.repo.findByEmail(email);
  }

  async listCustomers(q: {
    q?: string;
    limit: number;
    offset: number;
  }): Promise<{ items: CustomerDTO[]; count: number }> {
    return this.repo.list(q);
  }

  async listAddresses(customerId: string): Promise<AddressDTO[]> {
    return this.repo.listAddresses(customerId);
  }

  async addAddress(customerId: string, input: AddAddressInput): Promise<AddressDTO> {
    await this.retrieveCustomer(customerId);
    const existing = await this.repo.listAddresses(customerId);
    // 第一条地址自动成为默认：淘宝/Shopify 都是这样，否则结账页「默认地址」永远是空的
    if (existing.length === 0) {
      return this.repo.insertAddress(customerId, { ...input, isDefaultShipping: true });
    }
    if (input.isDefaultShipping) await this.repo.clearDefaultShipping(customerId);
    return this.repo.insertAddress(customerId, input);
  }

  async updateAddress(customerId: string, addressId: string, patch: UpdateAddressInput): Promise<AddressDTO> {
    const address = await this.repo.findAddress(addressId);
    if (!address) throw addressNotFound(addressId);
    if (address.customer_id !== customerId) throw addressNotOwned(addressId);
    // 改成默认时先清掉其它地址的默认标记，避免出现两个默认地址
    if (patch.isDefaultShipping === true && !address.is_default_shipping) {
      await this.repo.clearDefaultShipping(customerId, addressId);
    }
    const updated = await this.repo.updateAddress(addressId, patch);
    return updated!;
  }

  /**
   * 设为默认收货地址。
   *
   * 单独一个动作而不是「改 is_default_shipping 字段」：淘宝的地址簿上就是一颗
   * 「设为默认地址」按钮，语义比让前端 PATCH 一个布尔值更清楚，也不用担心
   * 前端传 false 把唯一的默认地址清成没有默认。
   */
  async setDefaultAddress(customerId: string, addressId: string): Promise<AddressDTO> {
    const address = await this.repo.findAddress(addressId);
    if (!address) throw addressNotFound(addressId);
    if (address.customer_id !== customerId) throw addressNotOwned(addressId);
    return this.repo.setDefaultShipping(customerId, addressId);
  }

  // —— 收藏（ADR-048）——

  async addFavorite(customerId: string, productId: string): Promise<void> {
    // 收藏前先确认顾客存在：否则会留下指向不存在顾客的行
    await this.retrieveCustomer(customerId);
    await this.repo.insertFavorite({
      id: prefixedUlid("fav"),
      customerId,
      productId,
    });
  }

  async removeFavorite(customerId: string, productId: string): Promise<void> {
    await this.repo.deleteFavorite(customerId, productId);
  }

  async listFavorites(
    customerId: string,
    q: { limit: number; offset: number },
  ): Promise<{ items: FavoriteDTO[]; count: number }> {
    return this.repo.listFavorites(customerId, q);
  }

  async listFavoriteProductIds(customerId: string): Promise<string[]> {
    return this.repo.listFavoriteProductIds(customerId);
  }

  async deleteAddress(customerId: string, addressId: string): Promise<void> {
    const address = await this.repo.findAddress(addressId);
    if (!address) throw addressNotFound(addressId);
    if (address.customer_id !== customerId) throw addressNotOwned(addressId);
    await this.repo.softDeleteAddress(addressId);
  }

  async deleteCustomer(id: string): Promise<void> {
    await this.retrieveCustomer(id);
    await this.repo.softDelete(id);
  }

  // —— 会员标签（ADR-103）——

  async listTags(): Promise<CustomerTagDTO[]> {
    return this.repo.listTags();
  }

  /** 新建标签：名称唯一（唯一索引兜底），先查一次给友好错误。 */
  async createTag(name: string): Promise<CustomerTagDTO> {
    const trimmed = name?.trim() ?? "";
    if (trimmed === "") throw new DomainError({ code: 20001, message: "请填写标签名称" });
    if (trimmed.length > 20) {
      throw new DomainError({ code: 20001, message: "标签名称不超过 20 个字" });
    }
    const existing = await this.repo.findTagByName(trimmed);
    if (existing) throw new DomainError({ code: 20002, message: "标签已存在" });
    return this.repo.insertTag({ id: prefixedUlid("tag"), name: trimmed });
  }

  async deleteTag(id: string): Promise<void> {
    const tag = await this.repo.findTag(id);
    if (!tag) throw new DomainError({ code: 30001, message: `标签不存在：${id}` });
    await this.repo.deleteTag(id);
  }

  /** 覆盖式设置客户标签；不存在的标签直接忽略（幂等，不因一个脏 id 全失败）。 */
  async setCustomerTags(customerId: string, tagIds: string[]): Promise<CustomerTagDTO[]> {
    await this.retrieveCustomer(customerId);
    const all = await this.repo.listTags();
    const valid = new Set(all.map((t) => t.id));
    const cleaned = [...new Set(tagIds)].filter((id) => valid.has(id));
    await this.repo.setCustomerTags(customerId, cleaned);
    return this.repo.listCustomerTags(customerId);
  }

  async listCustomerTags(customerId: string): Promise<CustomerTagDTO[]> {
    return this.repo.listCustomerTags(customerId);
  }

  async listTagsByCustomerIds(customerIds: string[]): Promise<Record<string, CustomerTagDTO[]>> {
    return this.repo.listTagsByCustomerIds(customerIds);
  }

  // —— 会员等级（ADR-102）——

  async listMemberLevels(): Promise<MemberLevelDTO[]> {
    return this.repo.listMemberLevels();
  }

  /**
   * 新建等级。
   *
   * 门槛必须唯一（唯一索引兜底）：两档门槛相同，顾客算哪一档就没有答案。
   * 折扣力度上限 30%，与分销佣金上限同一考虑：再高不是权益，是清仓。
   */
  async createMemberLevel(input: CreateMemberLevelInput): Promise<MemberLevelDTO> {
    const name = input.name?.trim() ?? "";
    if (name === "") throw new DomainError({ code: 20001, message: "请填写等级名称" });
    if (input.thresholdMinor < 0n) {
      throw new DomainError({ code: 20001, message: "门槛金额不能为负" });
    }
    if (
      !Number.isInteger(input.discountBps) ||
      input.discountBps <= 0 ||
      input.discountBps > 3000
    ) {
      throw new DomainError({ code: 20001, message: "会员折扣需在 0.01%–30% 之间" });
    }
    const levels = await this.repo.listMemberLevels();
    if (levels.some((l) => l.threshold_minor === input.thresholdMinor)) {
      throw new DomainError({ code: 20001, message: "已有一档等级使用相同的消费门槛" });
    }
    return this.repo.insertMemberLevel({
      id: prefixedUlid("lvl"),
      name,
      thresholdMinor: input.thresholdMinor,
      discountBps: input.discountBps,
      // 排到最后一档之后
      sort: levels.length,
    });
  }

  async updateMemberLevel(id: string, patch: UpdateMemberLevelInput): Promise<MemberLevelDTO> {
    const existing = await this.repo.findMemberLevel(id);
    if (!existing) throw new DomainError({ code: 30001, message: `会员等级不存在：${id}` });

    if (patch.name !== undefined && patch.name.trim() === "") {
      throw new DomainError({ code: 20001, message: "等级名称不能为空" });
    }
    if (patch.discountBps !== undefined) {
      if (
        !Number.isInteger(patch.discountBps) ||
        patch.discountBps <= 0 ||
        patch.discountBps > 3000
      ) {
        throw new DomainError({ code: 20001, message: "会员折扣需在 0.01%–30% 之间" });
      }
    }
    if (patch.thresholdMinor !== undefined) {
      if (patch.thresholdMinor < 0n) {
        throw new DomainError({ code: 20001, message: "门槛金额不能为负" });
      }
      const levels = await this.repo.listMemberLevels();
      if (levels.some((l) => l.id !== id && l.threshold_minor === patch.thresholdMinor)) {
        throw new DomainError({ code: 20001, message: "已有一档等级使用相同的消费门槛" });
      }
    }
    const updated = await this.repo.updateMemberLevel(id, {
      ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
      ...(patch.thresholdMinor !== undefined ? { thresholdMinor: patch.thresholdMinor } : {}),
      ...(patch.discountBps !== undefined ? { discountBps: patch.discountBps } : {}),
    });
    return updated!;
  }

  /** 按累计消费匹配等级：取满足门槛的最高一档；没有满足的返回 null。 */
  async resolveMemberLevel(spendMinor: bigint): Promise<MemberLevelDTO | null> {
    const levels = await this.repo.listMemberLevels();
    let hit: MemberLevelDTO | null = null;
    for (const level of levels) {
      if (spendMinor >= level.threshold_minor) hit = level;
    }
    return hit;
  }

  async getMemberDiscountBps(spendMinor: bigint): Promise<number> {
    const level = await this.resolveMemberLevel(spendMinor);
    return level?.discount_bps ?? 0;
  }
}
