/** M10 Customer DTO 与契约（对齐架构 §2.1）。手机号仅软标识（不校验、不发短信）。 */

export interface CustomerDTO {
  id: string;
  /** 手机号注册的顾客没有邮箱。 */
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  metadata: Record<string, unknown> | null;
}

export interface AddressDTO {
  id: string;
  customer_id: string;
  /** 收件人。中国地址不拆姓/名，last_name 通常为空。 */
  first_name: string;
  last_name: string | null;
  phone: string | null;
  line1: string;
  line2: string | null;
  /** 城市。中国地址把「省市区」整串存在 province，city 通常为空。 */
  city: string | null;
  province: string | null;
  postal_code: string | null;
  country_code: string;
  is_default_shipping: boolean;
  is_default_billing: boolean;
}

export interface CreateCustomerInput {
  /** 手机号注册时为空。 */
  email?: string | null;
  firstName?: string;
  lastName?: string;
  phone?: string;
  metadata?: Record<string, unknown> | null;
}

/**
 * 新增地址（ADR-026）。
 *
 * 只有收件人、详细地址、国家是必须的：其余字段按地区习惯可省
 * （中国地址没有独立城市与邮编，「省市区」整串放 province）。
 */
export interface AddAddressInput {
  firstName: string;
  lastName?: string;
  phone?: string;
  line1: string;
  line2?: string;
  city?: string;
  province?: string;
  postalCode?: string;
  countryCode: string;
  isDefaultShipping?: boolean;
  isDefaultBilling?: boolean;
}

/** 更新地址：所有字段可选（必填项传空串由路由层拦住）。 */
export type UpdateAddressInput = Partial<AddAddressInput>;

export interface CustomerListQuery {
  q?: string;
  /** 按标签筛选（ADR-103）：只返回带该标签的客户。 */
  tagId?: string;
  limit: number;
  offset: number;
}

/** 会员标签（ADR-103）。 */
export interface CustomerTagDTO {
  id: string;
  name: string;
  /** 带这个标签的客户数（列表展示用）。 */
  customer_count: number;
}

export interface CustomerRepository {
  // ---- 会员标签（ADR-103）----
  listTags(): Promise<CustomerTagDTO[]>;
  findTag(id: string): Promise<CustomerTagDTO | null>;
  findTagByName(name: string): Promise<CustomerTagDTO | null>;
  insertTag(row: { id: string; name: string }): Promise<CustomerTagDTO>;
  /** 删标签：同时清掉关联（否则会留下指向不存在标签的孤儿行）。 */
  deleteTag(id: string): Promise<void>;
  /** 覆盖式设置某客户的标签。 */
  setCustomerTags(customerId: string, tagIds: string[]): Promise<void>;
  listCustomerTags(customerId: string): Promise<CustomerTagDTO[]>;
  listTagsByCustomerIds(customerIds: string[]): Promise<Record<string, CustomerTagDTO[]>>;

  // ---- 会员等级（ADR-102）----
  insertMemberLevel(input: CreateMemberLevelInput & { id: string; sort: number }): Promise<MemberLevelDTO>;
  listMemberLevels(): Promise<MemberLevelDTO[]>;
  findMemberLevel(id: string): Promise<MemberLevelDTO | null>;
  updateMemberLevel(id: string, patch: UpdateMemberLevelInput): Promise<MemberLevelDTO | null>;

  insert(input: CreateCustomerInput & { id: string }): Promise<CustomerDTO>;
  findById(id: string): Promise<CustomerDTO | null>;
  findByEmail(email: string): Promise<CustomerDTO | null>;
  list(q: CustomerListQuery): Promise<{ items: CustomerDTO[]; count: number }>;
  softDelete(id: string): Promise<void>;
  listAddresses(customerId: string): Promise<AddressDTO[]>;
  findAddress(addressId: string): Promise<AddressDTO | null>;
  insertAddress(customerId: string, input: AddAddressInput): Promise<AddressDTO>;
  updateAddress(addressId: string, patch: UpdateAddressInput): Promise<AddressDTO | null>;
  /** 取消该客户所有地址的默认标记（exceptId 用于「改其中一条为默认」时排除自身）。 */
  clearDefaultShipping(customerId: string, exceptId?: string): Promise<void>;
  /** 把某条地址设为唯一默认收货地址（先清后设，同一事务）。 */
  setDefaultShipping(customerId: string, addressId: string): Promise<AddressDTO>;
  softDeleteAddress(addressId: string): Promise<void>;
  // —— 收藏（ADR-048）——
  insertFavorite(input: { id: string; customerId: string; productId: string }): Promise<void>;
  deleteFavorite(customerId: string, productId: string): Promise<void>;
  listFavorites(
    customerId: string,
    q: { limit: number; offset: number },
  ): Promise<{ items: FavoriteDTO[]; count: number }>;
  listFavoriteProductIds(customerId: string): Promise<string[]>;
}

/** 收藏（ADR-048）：只存「谁收藏了哪个商品」，商品资料由 product 模块提供。 */
export interface FavoriteDTO {
  product_id: string;
  created_at: Date;
}

/** 会员等级（ADR-102）。 */
export interface MemberLevelDTO {
  id: string;
  name: string;
  /** 达到该累计消费（minor）即为这一档。 */
  threshold_minor: bigint;
  /** 折扣力度（万分比）：500 = 便宜 5%。 */
  discount_bps: number;
  sort: number;
}

export interface CreateMemberLevelInput {
  name: string;
  thresholdMinor: bigint;
  discountBps: number;
}

export type UpdateMemberLevelInput = Partial<CreateMemberLevelInput>;

export interface ICustomerModuleService {
  createCustomer(input: CreateCustomerInput): Promise<CustomerDTO>;
  retrieveCustomer(id: string): Promise<CustomerDTO>;
  retrieveCustomerByEmail(email: string): Promise<CustomerDTO | null>;
  listCustomers(q: CustomerListQuery): Promise<{ items: CustomerDTO[]; count: number }>;
  listAddresses(customerId: string): Promise<AddressDTO[]>;
  addAddress(customerId: string, input: AddAddressInput): Promise<AddressDTO>;
  updateAddress(customerId: string, addressId: string, patch: UpdateAddressInput): Promise<AddressDTO>;
  /** 设为默认收货地址（淘宝地址簿里的「设为默认」是一个动作，不是改一个字段）。 */
  setDefaultAddress(customerId: string, addressId: string): Promise<AddressDTO>;
  deleteAddress(customerId: string, addressId: string): Promise<void>;
  /** 收藏（幂等：已收藏再收藏不报错）。 */
  addFavorite(customerId: string, productId: string): Promise<void>;
  removeFavorite(customerId: string, productId: string): Promise<void>;
  /** 收藏列表（分页，时间倒序）。 */
  listFavorites(
    customerId: string,
    q: { limit: number; offset: number },
  ): Promise<{ items: FavoriteDTO[]; count: number }>;
  /** 全部收藏的商品 id（详情页判断「已收藏」用，不分页）。 */
  listFavoriteProductIds(customerId: string): Promise<string[]>;
  deleteCustomer(id: string): Promise<void>;

  // ---- 会员标签（ADR-103）----
  listTags(): Promise<CustomerTagDTO[]>;
  createTag(name: string): Promise<CustomerTagDTO>;
  deleteTag(id: string): Promise<void>;
  /** 覆盖式设置客户标签；返回设置后的标签。 */
  setCustomerTags(customerId: string, tagIds: string[]): Promise<CustomerTagDTO[]>;
  listCustomerTags(customerId: string): Promise<CustomerTagDTO[]>;
  /** 批量取客户标签（客户列表用，一次 IN 查询，禁 N+1）。 */
  listTagsByCustomerIds(customerIds: string[]): Promise<Record<string, CustomerTagDTO[]>>;

  // ---- 会员等级（ADR-102）----
  listMemberLevels(): Promise<MemberLevelDTO[]>;
  createMemberLevel(input: CreateMemberLevelInput): Promise<MemberLevelDTO>;
  updateMemberLevel(id: string, patch: UpdateMemberLevelInput): Promise<MemberLevelDTO>;
  /**
   * 按累计消费匹配等级（取满足门槛的最高一档）。
   *
   * 不落库：等级规则随时可调，顾客下次进店就按新规则走。
   */
  resolveMemberLevel(spendMinor: bigint): Promise<MemberLevelDTO | null>;
  /** 会员折扣力度（万分比）；没有等级返回 0。 */
  getMemberDiscountBps(spendMinor: bigint): Promise<number>;
}
