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
  /** 顾客当前口令（明文替身）；改密成功后更新，用来验「旧口令失效」。 */
  customerPassword: string;
  /** 改密时被撤销的 refresh_token 数量。 */
  revokedRefreshTokens: number;
  /** 购物车 cart_1 是否已下单（模拟一车一单的幂等重放）。 */
  orderCreated: boolean;
  /** 顾客注册方式（auth 设置，默认邮箱注册）。 */
  registerMode: "email" | "phone";
  /** 变体可用量（默认 12）；设 0 可测「已售罄」链路。 */
  variantAvailable?: number;
  /** 订单是否可评价（默认 true）；设 false 模拟「还没收货」。 */
  orderReviewable?: boolean;
  /** 覆盖假订单状态（默认用夹具里的 pending），测确认收货等流转时用。 */
  orderStatus?: string;
  /**
   * 最近一次 workflow.run 收到的输入。
   *
   * 假 workflow 直接返回 ord_1、不真建单，所以「路由有没有把顾客留言传下去」
   * 只能从入参上断言 —— 断言「返回值里有留言」等于什么都没测。
   */
  lastWorkflowInput?: Record<string, unknown>;
  /** 覆盖假订单的顾客留言（默认 null），测「店面/后台都能看到同一段留言」时用。 */
  orderCustomerNote?: string | null;
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
