/**
 * live 模式的优惠码 / 礼品卡状态层。
 *
 * 铁律 13 / 资金安全硬约束：前端**只传码凭证**，折扣金额一律由后端
 * computeDiscounts 算好返回，这里只透传展示，绝不在前端算折扣。
 *
 * 后端 store 购物车接口当前返回 `totals.discount_minor`（折扣合计）与
 * `voucher_codes` / `gift_card_codes`（已输码），但**未透出 `discounts` 明细**。
 * 因此前端在「有明细」时逐项展示，缺省时降级为单条「优惠」合计。
 */
import type { Cart, CartDiscount } from '@mall/sdk';
import { getStoreClient } from './api';

/** 结账页展示用的促销快照。 */
export interface CartPromoView {
  voucherCodes: string[];
  giftCardCodes: string[];
  /** 后端算好的折扣合计（minor unit）。 */
  discountMinor: number;
  /** 后端算好的税额（minor unit）。前端绝不自己乘税率（铁律 13）。 */
  taxMinor: number;
  /** 后端自动选定的运费（minor unit）。 */
  shippingMinor: number;
  /** 自动选定的运费方案名，用于合计区展示「含运费」。 */
  shippingLabel: string;
  /** 后端算好的应付合计：含税价时已含税，价外税时才另加。 */
  totalMinor: number;
  /** 是否已从后端拿到合计。0 元订单与「还没拉到」必须区分开。 */
  totalsLoaded: boolean;
  /** 折扣明细（后端若未透出则为空数组）。 */
  discounts: CartDiscount[];
}

export const EMPTY_PROMO: CartPromoView = {
  voucherCodes: [],
  giftCardCodes: [],
  discountMinor: 0,
  taxMinor: 0,
  shippingMinor: 0,
  shippingLabel: '',
  totalMinor: 0,
  totalsLoaded: false,
  discounts: [],
};

export function toPromoView(cart: Cart): CartPromoView {
  return {
    voucherCodes: cart.voucher_codes ?? [],
    giftCardCodes: cart.gift_card_codes ?? [],
    discountMinor: cart.totals?.discount_minor ?? 0,
    taxMinor: cart.totals?.tax_minor ?? 0,
    shippingMinor: cart.totals?.shipping_minor ?? 0,
    shippingLabel: cart.shipping_method?.name ?? '',
    totalMinor: cart.totals?.total_minor ?? 0,
    totalsLoaded: true,
    discounts: cart.discounts ?? [],
  };
}

/** 拉取当前购物车的促销快照（供刷新 / 恢复）。 */
export async function fetchCartPromo(
  cartId: string,
  /** 收货国家：税率按它解析，合计会跟着变（ADR-018）。 */
  country?: string,
): Promise<CartPromoView> {
  const cart = (await getStoreClient().getCart(cartId, country)) as Cart;
  return toPromoView(cart);
}

/** 保存收货国家：税与运费都按它自动算（ADR-019）。 */
export async function setCartCountry(cartId: string, country: string): Promise<void> {
  await getStoreClient().setCartAddress(cartId, country);
}

/** 覆盖式设置优惠券码（后端算折扣，前端只传码）。 */
export async function setCartVoucherCodes(
  cartId: string,
  codes: string[],
  country?: string,
): Promise<CartPromoView> {
  const cart = (await getStoreClient().setVoucherCodes(cartId, { codes })) as Cart;
  // 写接口不带国家，税额会按默认税率回；有国家就再读一次，保证展示与结账一致
  return country ? fetchCartPromo(cartId, country) : toPromoView(cart);
}

/** 覆盖式设置礼品卡码（后端算抵扣，前端只传卡码）。 */
export async function setCartGiftCardCodes(
  cartId: string,
  codes: string[],
  country?: string,
): Promise<CartPromoView> {
  const cart = (await getStoreClient().setGiftCardCodes(cartId, { codes })) as Cart;
  return country ? fetchCartPromo(cartId, country) : toPromoView(cart);
}

/**
 * 把优惠码 + 礼品卡码一次性落到指定购物车（下单前把码搬到最终下单的那辆车）。
 *
 * 换车场景：邮箱对不上或内容变化时，prepareCartForOrder 会新建一辆车并搬运行，
 * 但**不会**搬优惠码 —— 若不重放，下单会按「无码」计价，展示价与实收价不一致。
 * 所以下单前必须把当前码覆盖式重放到最终 cartId 上。
 */
export async function applyPromoCodesToCart(
  cartId: string,
  voucherCodes: string[],
  giftCardCodes: string[],
): Promise<CartPromoView> {
  await getStoreClient().setVoucherCodes(cartId, { codes: voucherCodes });
  const cart = (await getStoreClient().setGiftCardCodes(cartId, { codes: giftCardCodes })) as Cart;
  return toPromoView(cart);
}

/** 折扣明细行（订单摘要展示用，label 为中文类型名）。 */
export interface DiscountLine {
  label: string;
  amountMinor: number;
}

const DISCOUNT_LABEL: Record<CartDiscount['type'], string> = {
  voucher: '优惠券',
  gift_card: '礼品卡',
  order: '订单促销',
  catalogue: '目录促销',
};

/**
 * 把后端促销快照整理成订单摘要的折扣行。
 *
 * - 后端透出 `discounts` 明细时逐项展示；
 * - 未透出（现阶段）时，降级为单条「优惠」合计（金额仍来自后端 discount_minor）。
 */
export function buildDiscountLines(promo: CartPromoView): DiscountLine[] {
  if (promo.discounts.length > 0) {
    return promo.discounts.map((d) => ({
      label: DISCOUNT_LABEL[d.type] ?? '优惠',
      amountMinor: d.amount_minor,
    }));
  }
  if (promo.discountMinor > 0) {
    return [{ label: '优惠', amountMinor: promo.discountMinor }];
  }
  return [];
}

/** 营销功能开关（后端为准；默认全关）。 */
export interface PromotionFeatures {
  promotion: boolean;
  voucher: boolean;
  gift_card: boolean;
}

export async function fetchPromotionFeatures(): Promise<PromotionFeatures> {
  const res = (await getStoreClient().getPromotionFeatures()) as Partial<PromotionFeatures>;
  return {
    promotion: res.promotion ?? false,
    voucher: res.voucher ?? false,
    gift_card: res.gift_card ?? false,
  };
}
