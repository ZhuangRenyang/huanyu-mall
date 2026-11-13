/**
 * 到货提醒（ADR-059）。
 *
 * 售罄商品页登记邮箱，补货后由服务端发一封「到货了」。
 * 登录顾客可以不带邮箱（服务端用账号邮箱），游客必须自己填。
 */
import { getApiMode, getStoreClient } from './api';
import { getSession } from './account';

export interface StockAlertResult {
  /** 服务端回显的脱敏邮箱（让顾客确认发到哪个地址）。 */
  email: string;
  /** 有效期截止时间（ADR-069）；服务端没返回时按本地兜底算出。 */
  expiresAt: number | null;
  /** 演示模式：只在本机假装成功，不会真的发邮件 —— 界面必须说清楚。 */
  demo: boolean;
}

/** 登录顾客的账号邮箱（没有就返回空串，让顾客自己填）。 */
export function knownEmail(): string {
  return getSession()?.email ?? '';
}

export async function subscribeStockAlert(input: {
  productId: string;
  variantId: string;
  email: string;
}): Promise<StockAlertResult> {
  const email = input.email.trim();
  if (getApiMode() !== 'live') {
    // 演示模式不碰真接口，但也不假装「邮件已在路上」
    await new Promise((resolve) => setTimeout(resolve, 250));
    return { email: maskEmail(email), expiresAt: Date.now() + 30 * 24 * 3600 * 1000, demo: true };
  }
  const res = (await getStoreClient().subscribeStockAlert({
    product_id: input.productId,
    variant_id: input.variantId,
    ...(email ? { email } : {}),
  })) as { email: string; expires_at?: string };
  return {
    email: res.email,
    expiresAt: res.expires_at ? Date.parse(res.expires_at) : null,
    demo: false,
  };
}

function maskEmail(email: string): string {
  const [name, domain] = email.split('@');
  if (!domain) return email;
  return `${name?.slice(0, 1) ?? ''}***@${domain}`;
}
