/**
 * 可嵌入组件（M18）的展示型 props 类型。
 * 与 @mall/sdk 解耦：组件只关心展示需要的最小字段，任何店面模板都能喂数据。
 */

/** 金额（最小单位 + 币种）。与 sdk.Money 同构但用 camelCase，UI 层友好。 */
export interface MoneyValue {
  amountMinor: number;
  currencyCode: string;
}

/** 购物车行（CartDrawer 使用）。 */
export interface CartLineItemProps {
  id: string;
  title: string;
  /** 规格文案，如「黑色 / M」。 */
  variantTitle?: string;
  quantity: number;
  unitPriceMinor: number;
  currencyCode: string;
  imageUrl?: string;
  /** 单行最大可购数量（库存上限）。缺省不限制。 */
  maxQuantity?: number;
  /**
   * 该行是否还能买（ADR-062）。缺省视为正常。
   * delisted / out_of_stock 的行会被购物车归入「失效宝贝」，不参与结算。
   */
  availabilityStatus?: 'ok' | 'insufficient' | 'out_of_stock' | 'delisted';
  /** 当前可用量（用于「仅剩 N 件」与数量上限）。 */
  availableQuantity?: number;
}

/** 商品图（ProductGallery 使用）。 */
export interface GalleryImage {
  id: string;
  url: string;
  alt?: string;
  isPrimary?: boolean;
}

/** 规格选项值（VariantPicker 使用）。swatch 为数据色/变量名，非设计 token。 */
export interface VariantOptionValue {
  value: string;
  label?: string;
  swatch?: string;
}

/** 规格选项组（如 颜色 / 尺码）。 */
export interface VariantOptionGroup {
  id: string;
  name: string;
  values: VariantOptionValue[];
}
