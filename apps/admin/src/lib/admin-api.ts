/**
 * 后台数据层唯一对外出口（门面）。
 *
 * 按域拆到 admin-session / admin-catalog / admin-orders / admin-settings / admin-password，
 * 这里只做再导出 —— 调用方的 `import { listOrders } from '@/lib/admin-api'` 一行都不用改，
 * 而实现文件各自控制在 300 行以内。
 *
 * 模式分流（mock / live）见 admin-client.ts；令牌与会话底座见 admin-client.ts。
 */
export { getAdminApiMode } from './admin-client';
export type { AdminApiMode } from './admin-client';

export { login, logout, type AdminLoginResult } from './admin-session';

export { listProducts, saveProduct, deleteProduct } from './admin-catalog';

export {
  listOrders,
  getOrder,
  shipOrder,
  refundOrder,
  listOrderReservations,
  listOrderFulfillments,
} from './admin-orders';
export type {
  OrderReservationView,
  OrderFulfillmentView,
  ShipOrderOptions,
} from './admin-orders';

export {
  listStockLocations,
  createStockLocation,
  updateStockLocation,
  listInventoryLevels,
  listTransfers,
  createTransfer,
  completeTransfer,
  cancelTransfer,
} from './admin-inventory';
export type {
  StockLocationView,
  StockLocationInput,
  InventoryLevelView,
  TransferView,
  TransferInput,
  TransferStatus,
} from './admin-inventory';

export { getTheme, saveTheme, getProviders, saveProviders } from './admin-settings';

export {
  listVouchers,
  getVoucher,
  createVoucher,
  updateVoucher,
  setVoucherStatus,
  listVoucherCodes,
  addVoucherCodes,
  deleteVoucherCode,
  setVoucherCodeStatus,
  listGiftCards,
  getGiftCard,
  createGiftCard,
  updateGiftCard,
  setGiftCardStatus,
  adjustGiftCard,
  listGiftCardEvents,
  giftCardEventLabel,
  listPromotions,
  getPromotion,
  createPromotion,
  setPromotionStatus,
  deletePromotion,
  addPromotionRule,
  deletePromotionRule,
} from './admin-promotions';
export type {
  VoucherView,
  VoucherCodeView,
  VoucherDetailView,
  VoucherInput,
  GiftCardView,
  GiftCardEventView,
  GiftCardInput,
  PromotionView,
  PromotionDetailView,
  PromotionRuleView,
  PromotionInput,
} from './admin-promotions';

export { changePassword } from './admin-password';
export type { ChangePasswordErrorKind, ChangePasswordResult } from './admin-password';

export { getMarketingFeatures, setMarketingFeature } from './admin-promotions';
export type { MarketingFeature, MarketingFeatureFlags } from './admin-promotions';
