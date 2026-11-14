import {
  DEFAULT_PROVIDERS,
  DEFAULT_THEME,
  FONT_PRESETS,
  THEME_PRESETS,
  type ProviderConfig,
  type ThemeConfig,
} from './admin-data';
import { adminClient, getAdminApiMode } from './admin-client';
import {
  getProviders as mockGetProviders,
  getTheme as mockGetTheme,
  saveProviders as mockSaveProviders,
  saveTheme as mockSaveTheme,
} from './admin-store';

/**
 * 后台设置域：外观（主题）与支付方式。
 *
 * 主题/支付 Provider 都是「可配置品牌数据」：读回来的是 preset id / 掩码，
 * 组件一律通过 Token 类名引用，不出现裸色值。
 */

export async function getTheme(): Promise<ThemeConfig> {
  if (getAdminApiMode() !== 'live') return mockGetTheme();
  try {
    const t = (await adminClient().getTheme()) as Record<string, unknown>;
    const primaryHex = String(t?.primary_color ?? '');
    const preset = THEME_PRESETS.find((p) => p.value.toLowerCase() === primaryHex.toLowerCase());
    const fontStack = String(t?.font_family ?? '');
    const font = FONT_PRESETS.find((f) => f.stack === fontStack);
    const shadow = String(t?.shadow ?? '');
    const ratio = String(t?.product_image_ratio ?? '');
    const radius = Number.parseInt(String(t?.border_radius ?? '8'), 10);
    return {
      primaryColor: preset?.id ?? DEFAULT_THEME.primaryColor,
      fontPreset: font?.id ?? DEFAULT_THEME.fontPreset,
      radius: Number.isFinite(radius) && radius > 0 ? radius : DEFAULT_THEME.radius,
      shadow: (shadow === 'none' || shadow === 'medium' ? shadow : DEFAULT_THEME.shadow) as ThemeConfig['shadow'],
      productRatio: (ratio === '1:1' || ratio === '3:4' ? ratio : DEFAULT_THEME.productRatio) as ThemeConfig['productRatio'],
      announcement: String(t?.announcement ?? ''),
      logoFileId: (t?.logo_file_id as string | null | undefined) ?? null,
      logoUrl: (t?.logo_url as string | null | undefined) ?? null,
    };
  } catch {
    return DEFAULT_THEME;
  }
}

/** 首页模块（ADR-079）：顺序与开关，存 theme.metadata.home_modules。 */
export type HomeModuleId = 'categories' | 'vouchers' | 'featured';
export interface HomeModuleView {
  id: HomeModuleId;
  enabled: boolean;
}

const HOME_MODULES_KEY = 'admin:home-modules';
const DEFAULT_HOME_MODULES: HomeModuleView[] = [
  { id: 'categories', enabled: true },
  { id: 'vouchers', enabled: true },
  { id: 'featured', enabled: true },
];

export async function getHomeModules(): Promise<HomeModuleView[]> {
  if (getAdminApiMode() !== 'live') {
    try {
      const raw = window.localStorage.getItem(HOME_MODULES_KEY);
      return raw ? (JSON.parse(raw) as HomeModuleView[]) : DEFAULT_HOME_MODULES;
    } catch {
      return DEFAULT_HOME_MODULES;
    }
  }
  const t = (await adminClient().getTheme()) as {
    metadata?: { home_modules?: Array<{ id?: string; enabled?: boolean }> } | null;
  };
  const stored = t.metadata?.home_modules;
  if (!Array.isArray(stored) || stored.length === 0) return DEFAULT_HOME_MODULES;
  const known = stored.filter(
    (m): m is { id: HomeModuleId; enabled?: boolean } =>
      m?.id === 'categories' || m?.id === 'vouchers' || m?.id === 'featured',
  );
  const seen = new Set<HomeModuleId>();
  const list = known
    .filter((m) => (seen.has(m.id) ? false : (seen.add(m.id), true)))
    .map((m) => ({ id: m.id, enabled: m.enabled !== false }));
  for (const m of DEFAULT_HOME_MODULES) {
    if (!seen.has(m.id)) list.push({ ...m });
  }
  return list;
}

export async function saveHomeModules(modules: HomeModuleView[]): Promise<void> {
  if (getAdminApiMode() !== 'live') {
    try {
      window.localStorage.setItem(HOME_MODULES_KEY, JSON.stringify(modules));
    } catch {
      /* 隐私模式写不进不影响演示 */
    }
    return;
  }
  // 只发 home_modules；服务端把它合并进 metadata（ADR-079），不会抹掉别的键
  await adminClient().updateTheme({ metadata: { home_modules: modules } } as never);
}

export async function saveTheme(theme: ThemeConfig): Promise<void> {
  if (getAdminApiMode() !== 'live') {
    mockSaveTheme(theme);
    return;
  }
  const preset = THEME_PRESETS.find((p) => p.id === theme.primaryColor);
  const font = FONT_PRESETS.find((f) => f.id === theme.fontPreset);
  await adminClient().updateTheme({
    primary_color: preset?.value,
    font_family: font?.stack,
    border_radius: `${theme.radius}px`,
    product_image_ratio: theme.productRatio,
    // logo 必须一起提交：外观保存原本只发 4 个字段，上传后的 logo 会被下一次保存悄悄抹掉
    logo_file_id: theme.logoFileId,
    // 公告同理：输入框从一期就在，但一直没落库，保存一次就丢（ADR-047）
    announcement: theme.announcement.trim() ? theme.announcement.trim() : null,
  });
}

export async function getProviders(): Promise<ProviderConfig[]> {
  if (getAdminApiMode() !== 'live') return mockGetProviders();
  try {
    const res = (await adminClient().getPaymentProviders()) as {
      items?: Array<{ identifier: string; label?: string; is_enabled?: boolean; options_masked?: Record<string, string> }>;
    };
    return (res.items ?? []).map((p) => ({
      id: p.identifier,
      label: p.label ?? p.identifier,
      enabled: p.is_enabled ?? false,
      // 后端只回掩码，绝不回明文
      secretKey: Object.values(p.options_masked ?? {}).join(' / '),
    }));
  } catch {
    return DEFAULT_PROVIDERS;
  }
}

export async function saveProviders(providers: ProviderConfig[]): Promise<void> {
  if (getAdminApiMode() !== 'live') {
    mockSaveProviders(providers);
    return;
  }
  const client = adminClient();
  for (const p of providers) {
    await client.updatePaymentProvider(p.id, { is_enabled: p.enabled });
  }
}
