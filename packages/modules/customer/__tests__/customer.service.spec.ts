import { describe, expect, it } from "vitest";
import { DomainError } from "@mall/core";
import { CustomerService } from "../src/services/customer.service.js";
import type {
  AddAddressInput,
  AddressDTO,
  CreateCustomerInput,
  CustomerDTO,
  CustomerRepository,
  UpdateAddressInput,
} from "../src/types.js";

class InMemoryCustomerRepository implements CustomerRepository {
  readonly customers = new Map<string, CustomerDTO>();
  readonly addresses = new Map<string, AddressDTO>();
  private counter = 0;

  async insert(input: CreateCustomerInput & { id: string }): Promise<CustomerDTO> {
    const dto: CustomerDTO = {
      id: input.id,
      email: input.email,
      first_name: input.firstName ?? null,
      last_name: input.lastName ?? null,
      phone: input.phone ?? null,
      metadata: input.metadata ?? null,
    };
    this.customers.set(dto.id, dto);
    return dto;
  }
  async findById(id: string): Promise<CustomerDTO | null> {
    return this.customers.get(id) ?? null;
  }
  async findByEmail(email: string): Promise<CustomerDTO | null> {
    return [...this.customers.values()].find((c) => c.email === email) ?? null;
  }
  async softDelete(id: string): Promise<void> {
    this.customers.delete(id);
  }
  async listAddresses(customerId: string): Promise<AddressDTO[]> {
    return [...this.addresses.values()].filter((a) => a.customer_id === customerId);
  }
  async findAddress(addressId: string): Promise<AddressDTO | null> {
    return this.addresses.get(addressId) ?? null;
  }
  async insertAddress(customerId: string, input: AddAddressInput): Promise<AddressDTO> {
    const dto: AddressDTO = {
      id: `addr_${++this.counter}`,
      customer_id: customerId,
      first_name: input.firstName,
      last_name: input.lastName ?? null,
      phone: input.phone ?? null,
      line1: input.line1,
      line2: input.line2 ?? null,
      city: input.city ?? null,
      province: input.province ?? null,
      postal_code: input.postalCode ?? null,
      country_code: input.countryCode,
      is_default_shipping: input.isDefaultShipping ?? false,
      is_default_billing: input.isDefaultBilling ?? false,
    };
    this.addresses.set(dto.id, dto);
    return dto;
  }
  async updateAddress(addressId: string, patch: UpdateAddressInput): Promise<AddressDTO | null> {
    const a = this.addresses.get(addressId);
    if (!a) return null;
    const next: AddressDTO = {
      ...a,
      phone: patch.phone ?? a.phone,
      line1: patch.line1 ?? a.line1,
      city: patch.city ?? a.city,
      is_default_shipping: patch.isDefaultShipping ?? a.is_default_shipping,
    };
    this.addresses.set(addressId, next);
    return next;
  }
  async softDeleteAddress(addressId: string): Promise<void> {
    this.addresses.delete(addressId);
  }

  async clearDefaultShipping(customerId: string, exceptId?: string): Promise<void> {
    for (const [id, a] of this.addresses) {
      if (a.customer_id === customerId && id !== exceptId && a.is_default_shipping) {
        this.addresses.set(id, { ...a, is_default_shipping: false });
      }
    }
  }

  async setDefaultShipping(customerId: string, addressId: string): Promise<AddressDTO> {
    await this.clearDefaultShipping(customerId);
    const a = this.addresses.get(addressId)!;
    const next = { ...a, is_default_shipping: true };
    this.addresses.set(addressId, next);
    return next;
  }

  // —— 收藏（ADR-048）——
  readonly favorites: Array<{ customerId: string; productId: string; createdAt: Date }> = [];

  async insertFavorite(input: { id: string; customerId: string; productId: string }): Promise<void> {
    // 与 SQL 的 onConflictDoNothing 同语义：重复收藏不新增行
    if (this.favorites.some((f) => f.customerId === input.customerId && f.productId === input.productId)) {
      return;
    }
    this.favorites.push({
      customerId: input.customerId,
      productId: input.productId,
      createdAt: new Date(),
    });
  }

  async deleteFavorite(customerId: string, productId: string): Promise<void> {
    const idx = this.favorites.findIndex(
      (f) => f.customerId === customerId && f.productId === productId,
    );
    if (idx >= 0) this.favorites.splice(idx, 1);
  }

  async listFavorites(customerId: string, q: { limit: number; offset: number }) {
    const mine = this.favorites.filter((f) => f.customerId === customerId);
    return {
      items: mine
        .slice(q.offset, q.offset + q.limit)
        .map((f) => ({ product_id: f.productId, created_at: f.createdAt })),
      count: mine.length,
    };
  }

  async listFavoriteProductIds(customerId: string): Promise<string[]> {
    return this.favorites.filter((f) => f.customerId === customerId).map((f) => f.productId);
  }
}

function setup() {
  const repo = new InMemoryCustomerRepository();
  return { repo, service: new CustomerService(repo) };
}

const addressInput: AddAddressInput = {
  firstName: "三",
  lastName: "张",
  phone: "not-a-phone-number",
  line1: "科技园路 1 号",
  city: "深圳",
  province: "广东",
  postalCode: "518000",
  countryCode: "CN",
  isDefaultShipping: true,
};

describe("CustomerService（M10，手机号软标识 + 地址簿）", () => {
  it("createCustomer + 手机号软标识（不校验格式）", async () => {
    const { service } = setup();
    const c = await service.createCustomer({ email: "a@b.com", firstName: "三", lastName: "张", phone: "abc-任意-123" });
    expect(c.email).toBe("a@b.com");
    expect(c.phone).toBe("abc-任意-123"); // 原样存储，不校验
  });

  it("retrieveCustomer / retrieveCustomerByEmail", async () => {
    const { service } = setup();
    const c = await service.createCustomer({ email: "a@b.com" });
    await expect(service.retrieveCustomer(c.id)).resolves.toMatchObject({ email: "a@b.com" });
    await expect(service.retrieveCustomerByEmail("a@b.com")).resolves.toMatchObject({ id: c.id });
    await expect(service.retrieveCustomerByEmail("none@x.com")).resolves.toBeNull();
    await expect(service.retrieveCustomer("cust_missing")).rejects.toBeInstanceOf(DomainError);
  });

  it("addAddress + listAddresses", async () => {
    const { service } = setup();
    const c = await service.createCustomer({ email: "a@b.com" });
    const addr = await service.addAddress(c.id, addressInput);
    expect(addr.country_code).toBe("CN");
    expect(addr.is_default_shipping).toBe(true);
    const list = await service.listAddresses(c.id);
    expect(list).toHaveLength(1);
  });

  it("updateAddress + deleteAddress（归属校验）", async () => {
    const { service } = setup();
    const c = await service.createCustomer({ email: "a@b.com" });
    const addr = await service.addAddress(c.id, addressInput);

    const updated = await service.updateAddress(c.id, addr.id, { city: "广州" });
    expect(updated.city).toBe("广州");

    // 越权：其他客户不能改
    const other = await service.createCustomer({ email: "o@b.com" });
    await expect(service.updateAddress(other.id, addr.id, { city: "x" })).rejects.toBeInstanceOf(DomainError);

    await service.deleteAddress(c.id, addr.id);
    expect(await service.listAddresses(c.id)).toHaveLength(0);
  });

  it("deleteCustomer 软删后不可检索", async () => {
    const { service } = setup();
    const c = await service.createCustomer({ email: "a@b.com" });
    await service.deleteCustomer(c.id);
    await expect(service.retrieveCustomer(c.id)).rejects.toBeInstanceOf(DomainError);
  });

  // —— 地址默认（ADR-026）：首条自动默认、默认唯一、独立设默认动作 ——

  it("第一条地址自动成为默认地址（不用勾选）", async () => {
    const { service } = setup();
    const c = await service.createCustomer({ email: "a@b.com" });
    const addr = await service.addAddress(c.id, {
      firstName: "三",
      line1: "科技园路 1 号",
      province: "广东省深圳市南山区",
      countryCode: "CN",
    });
    expect(addr.is_default_shipping).toBe(true);
    // 中文地址口径：不拆姓/名，城市与邮编可空
    expect(addr.last_name).toBeNull();
    expect(addr.city).toBeNull();
    expect(addr.postal_code).toBeNull();
  });

  it("新增时勾了默认 → 旧默认被清掉（默认唯一）", async () => {
    const { service } = setup();
    const c = await service.createCustomer({ email: "a@b.com" });
    const first = await service.addAddress(c.id, addressInput);
    expect(first.is_default_shipping).toBe(true);

    const second = await service.addAddress(c.id, { ...addressInput, isDefaultShipping: true });
    const list = await service.listAddresses(c.id);
    const defaults = list.filter((a) => a.is_default_shipping);
    expect(defaults).toHaveLength(1);
    expect(defaults[0]!.id).toBe(second.id);
  });

  it("setDefaultAddress：切换默认且只能有一条", async () => {
    const { service } = setup();
    const c = await service.createCustomer({ email: "a@b.com" });
    const first = await service.addAddress(c.id, { ...addressInput, isDefaultShipping: false });
    const second = await service.addAddress(c.id, { ...addressInput, isDefaultShipping: false });

    const now = await service.setDefaultAddress(c.id, second.id);
    expect(now.is_default_shipping).toBe(true);
    const list = await service.listAddresses(c.id);
    expect(list.filter((a) => a.is_default_shipping).map((a) => a.id)).toEqual([second.id]);
    expect(list.find((a) => a.id === first.id)!.is_default_shipping).toBe(false);
  });

  it("setDefaultAddress：不能设别人的地址", async () => {
    const { service } = setup();
    const c = await service.createCustomer({ email: "a@b.com" });
    const addr = await service.addAddress(c.id, addressInput);
    const other = await service.createCustomer({ email: "o@b.com" });

    await expect(service.setDefaultAddress(other.id, addr.id)).rejects.toBeInstanceOf(DomainError);
  });
});

describe("收藏（ADR-048）", () => {
  it("重复收藏只有一条，列表与 ids 一致", async () => {
    const { service } = setup();
    const c = await service.createCustomer({ email: "fav@example.com" });

    await service.addFavorite(c.id, "prod_1");
    await service.addFavorite(c.id, "prod_1");

    const list = await service.listFavorites(c.id, { limit: 10, offset: 0 });
    expect(list.count).toBe(1);
    expect(list.items[0]!.product_id).toBe("prod_1");
    expect(await service.listFavoriteProductIds(c.id)).toEqual(["prod_1"]);
  });

  it("取消收藏是幂等的（没收藏过也不报错）", async () => {
    const { service } = setup();
    const c = await service.createCustomer({ email: "fav2@example.com" });

    await service.removeFavorite(c.id, "prod_never");
    await service.addFavorite(c.id, "prod_1");
    await service.removeFavorite(c.id, "prod_1");

    expect(await service.listFavoriteProductIds(c.id)).toEqual([]);
  });

  it("收藏不存在的顾客 → 报错（不留指向空顾客的行）", async () => {
    const { service } = setup();
    await expect(service.addFavorite("cus_missing", "prod_1")).rejects.toBeInstanceOf(DomainError);
  });

  it("收藏列表按顾客隔离", async () => {
    const { service } = setup();
    const a = await service.createCustomer({ email: "a@example.com" });
    const b = await service.createCustomer({ email: "b@example.com" });
    await service.addFavorite(a.id, "prod_1");

    expect(await service.listFavoriteProductIds(b.id)).toEqual([]);
    expect(await service.listFavoriteProductIds(a.id)).toEqual(["prod_1"]);
  });
});
