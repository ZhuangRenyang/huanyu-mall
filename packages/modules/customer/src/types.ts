/** M10 Customer DTO 与契约（对齐架构 §2.1）。手机号仅软标识（不校验、不发短信）。 */

export interface CustomerDTO {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  metadata: Record<string, unknown> | null;
}

export interface AddressDTO {
  id: string;
  customer_id: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  line1: string;
  line2: string | null;
  city: string;
  province: string | null;
  postal_code: string;
  country_code: string;
  is_default_shipping: boolean;
  is_default_billing: boolean;
}

export interface CreateCustomerInput {
  email: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  metadata?: Record<string, unknown> | null;
}

export interface AddAddressInput {
  firstName: string;
  lastName: string;
  phone?: string;
  line1: string;
  line2?: string;
  city: string;
  province?: string;
  postalCode: string;
  countryCode: string;
  isDefaultShipping?: boolean;
  isDefaultBilling?: boolean;
}

export type UpdateAddressInput = Partial<Omit<AddAddressInput, "firstName" | "lastName" | "line1" | "city" | "postalCode" | "countryCode">> & {
  firstName?: string;
  lastName?: string;
  line1?: string;
  city?: string;
  postalCode?: string;
  countryCode?: string;
};

export interface CustomerListQuery {
  q?: string;
  limit: number;
  offset: number;
}

export interface CustomerRepository {
  insert(input: CreateCustomerInput & { id: string }): Promise<CustomerDTO>;
  findById(id: string): Promise<CustomerDTO | null>;
  findByEmail(email: string): Promise<CustomerDTO | null>;
  list(q: CustomerListQuery): Promise<{ items: CustomerDTO[]; count: number }>;
  softDelete(id: string): Promise<void>;
  listAddresses(customerId: string): Promise<AddressDTO[]>;
  findAddress(addressId: string): Promise<AddressDTO | null>;
  insertAddress(customerId: string, input: AddAddressInput): Promise<AddressDTO>;
  updateAddress(addressId: string, patch: UpdateAddressInput): Promise<AddressDTO | null>;
  softDeleteAddress(addressId: string): Promise<void>;
}

export interface ICustomerModuleService {
  createCustomer(input: CreateCustomerInput): Promise<CustomerDTO>;
  retrieveCustomer(id: string): Promise<CustomerDTO>;
  retrieveCustomerByEmail(email: string): Promise<CustomerDTO | null>;
  listCustomers(q: CustomerListQuery): Promise<{ items: CustomerDTO[]; count: number }>;
  listAddresses(customerId: string): Promise<AddressDTO[]>;
  addAddress(customerId: string, input: AddAddressInput): Promise<AddressDTO>;
  updateAddress(customerId: string, addressId: string, patch: UpdateAddressInput): Promise<AddressDTO>;
  deleteAddress(customerId: string, addressId: string): Promise<void>;
  deleteCustomer(id: string): Promise<void>;
}
