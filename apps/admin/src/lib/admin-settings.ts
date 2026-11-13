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
