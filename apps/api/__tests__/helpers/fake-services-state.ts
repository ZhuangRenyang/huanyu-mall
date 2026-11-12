/** 业务模块测试替身共享状态。 */
export interface FakeServicesState {
  /** webhook 幂等去重已见集合。 */
  seen: Set<string>;
  /** 支付商配置（掩码后）缓存。 */
  providerConfig: Map<string, Record<string, string>>;
  /** 主题设置当前值。 */
  theme: Record<string, unknown>;
  /** 管理员当前口令（明文替身，等价真实实现里的哈希）。 */
  adminPassword: string;
  /** 改密时被撤销的 refresh_token 数量。 */
  revokedRefreshTokens: number;
  /** 购物车 cart_1 是否已下单（模拟一车一单的幂等重放）。 */
  orderCreated: boolean;
  /** 顾客注册方式（auth 设置，默认邮箱注册）。 */
  registerMode: "email" | "phone";
  /** 变体可用量（默认 12）；设 0 可测「已售罄」链路。 */
  variantAvailable?: number;
  /** 商品分类（ADR-028）：改完能读回来，测试才能断言「保存真的生效」。 */
  categories: Array<{
    id: string;
    name: string;
    handle: string;
    parent_id: string | null;
    sort_order: number;
    product_count: number;
  }>;
}
