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

export {
  listProducts,
  saveProduct,
  deleteProduct,
  uploadProductImage,
  bulkProductAction,
} from './admin-catalog';

export { listReviews, setReviewVisible, replyReview } from './admin-reviews';
export type {
  AdminReviewView,
  ReviewListResult,
  ReviewVisibilityFilter,
} from './admin-reviews';

export {
  listOrders,
  getOrder,
  shipOrder,
  requestOrderRefund,
  listOrderReservations,
  listOrderFulfillments,
  getFulfillmentPlan,
  setOrderNote,
  listOrderLogs,
} from './admin-orders';
export type {
  OrderReservationView,
  OrderFulfillmentView,
  FulfillmentPlanView,
  ShipOrderOptions,
  OrderListParams,
  OrderListResult,
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

export {
  getNotificationSettings,
  updateNotificationSettings,
  sendTestNotification,
  listNotifications,
  resendNotification,
  NOTIFICATION_TEMPLATE_LABEL,
} from './admin-notifications';
export type {
  NotificationSettingsView,
  NotificationSettingsPatch,
  NotificationView,
  NotificationStatus,
  NotificationTemplate,
} from './admin-notifications';

export {
  getSystemInfo,
  setUpdateSource,
  checkUpdate,
  requestUpgrade,
  requestBackup,
  listSystemJobs,
  getSystemJob,
} from './admin-system';
export type {
  SystemInfoView,
  SystemJobView,
  SystemJobAction,
  SystemJobStatus,
  CheckUpdateView,
  UpdateManifestView,
} from './admin-system';

export {
  getTaxConfig,
  updateTaxSettings,
  setDefaultRate,
  setCountryRate,
  deleteCountryRate,
  percentToBps,
  bpsToPercent,
} from './admin-tax';
export type { TaxConfigView, TaxSettingsView, TaxRateView } from './admin-tax';
