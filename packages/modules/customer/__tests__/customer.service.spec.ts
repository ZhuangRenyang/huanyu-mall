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
      last_name: input.lastName,
      phone: input.phone ?? null,
      line1: input.line1,
      line2: input.line2 ?? null,
      city: input.city,
      province: input.province ?? null,
      postal_code: input.postalCode,
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
});
