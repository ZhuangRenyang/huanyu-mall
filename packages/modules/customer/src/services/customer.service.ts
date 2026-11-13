import { prefixedUlid } from "@mall/core";
import { addressNotFound, addressNotOwned, customerNotFound } from "../errors.js";
import type {
  AddAddressInput,
  AddressDTO,
  CreateCustomerInput,
  FavoriteDTO,
  CustomerDTO,
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
}
