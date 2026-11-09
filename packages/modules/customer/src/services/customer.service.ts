import { prefixedUlid } from "@mall/core";
import { addressNotFound, addressNotOwned, customerNotFound } from "../errors.js";
import type {
  AddAddressInput,
  AddressDTO,
  CreateCustomerInput,
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
    return this.repo.insertAddress(customerId, input);
  }

  async updateAddress(customerId: string, addressId: string, patch: UpdateAddressInput): Promise<AddressDTO> {
    const address = await this.repo.findAddress(addressId);
    if (!address) throw addressNotFound(addressId);
    if (address.customer_id !== customerId) throw addressNotOwned(addressId);
    const updated = await this.repo.updateAddress(addressId, patch);
    return updated!;
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
