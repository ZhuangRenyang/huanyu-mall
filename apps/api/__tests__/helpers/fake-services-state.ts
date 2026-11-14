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
  /** 覆盖后台订单列表的命中总数（导出上限等「总数才重要」的用例）。 */
  ordersTotalOverride?: number;
  /** 视为「已下架」的变体 id（购物车失效宝贝用例，ADR-062）。 */
  unpurchasableVariantIds?: string[];
  /** 假购物车行的数量（默认 1），验「库存不足」时调大。 */
  cartLineQuantity?: number;
  /** 各变体销量（ADR-067）：默认不返回即 0。 */
  soldByVariant?: Record<string, number>;
  /** 各变体近 30 天销量（ADR-070 月销）：不配就是 0，和累计分开算。 */
  monthlySoldByVariant?: Record<string, number>;
  /** 低库存规格数（ADR-074 工作台预警卡）：不配就是 0。 */
  lowStockCount?: number;
  /** 订单归属顾客（ADR-093 积分发放）：不配 = 游客单（customer_id null）。 */
  orderCustomerId?: string | null;
  /** 某订单的库存预留（ADR-075 取消订单用）：用例可配「在占用 / 已释放」两种。 */
  orderReservations?: Array<{ id: string; status: string }>;
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
