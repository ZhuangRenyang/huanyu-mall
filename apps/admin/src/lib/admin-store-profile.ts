import { adminClient, getAdminApiMode } from './admin-client';

/**
 * 店铺资料（店名 / 客服电话，ADR-045）。
 *
 * 存在店铺设置（theme_settings）里，与外观变量同一行：
 * 它是「店铺是谁」的唯一事实来源，店头、页脚、发货单都从这里读。
 */

export interface StoreProfileView {
  storeName: string;
  supportPhone: string | null;
  /**
   * 退货收件地址（ADR-053）：顾客在退货退款流程里照着它寄回。
   * 多行文本（收件人 / 电话 / 地址），留空则前台提示「联系客服获取地址」。
   */
  returnAddress: string | null;
}

const MOCK_KEY = 'admin:store-profile';
const DEFAULT_PROFILE: StoreProfileView = {
  storeName: '全球商城',
  supportPhone: null,
  returnAddress: null,
};

function readMock(): StoreProfileView {
  try {
    const raw = localStorage.getItem(MOCK_KEY);
    return raw ? (JSON.parse(raw) as StoreProfileView) : DEFAULT_PROFILE;
  } catch {
    return DEFAULT_PROFILE;
  }
}

export async function getStoreProfile(): Promise<StoreProfileView> {
  if (getAdminApiMode() !== 'live') return readMock();
  try {
    const res = (await adminClient().getSettings()) as {
      settings?: {
        store_name?: string;
        support_phone?: string | null;
        return_address?: string | null;
      };
    };
    return {
      storeName: res.settings?.store_name?.trim() || DEFAULT_PROFILE.storeName,
      supportPhone: res.settings?.support_phone ?? null,
      returnAddress: res.settings?.return_address ?? null,
    };
  } catch {
    return DEFAULT_PROFILE;
  }
}

export async function saveStoreProfile(input: StoreProfileView): Promise<void> {
  const storeName = input.storeName.trim() || DEFAULT_PROFILE.storeName;
  const supportPhone = input.supportPhone?.trim() ? input.supportPhone.trim() : null;
  const returnAddress = input.returnAddress?.trim() ? input.returnAddress.trim() : null;

  if (getAdminApiMode() !== 'live') {
    localStorage.setItem(MOCK_KEY, JSON.stringify({ storeName, supportPhone, returnAddress }));
    return;
  }
  await adminClient().updateSettings({
    store_name: storeName,
    support_phone: supportPhone,
    return_address: returnAddress,
  });
}
