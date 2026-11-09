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
}
