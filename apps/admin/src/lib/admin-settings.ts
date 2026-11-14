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

/** 轮播图（ADR-080）。 */
export interface BannerView {
  id: string;
  imageUrl: string | null;
  link: string | null;
  isActive: boolean;
}

const BANNER_KEY = 'admin:banners';

export async function listBanners(): Promise<BannerView[]> {
  if (getAdminApiMode() !== 'live') {
    try {
      return JSON.parse(window.localStorage.getItem(BANNER_KEY) ?? '[]') as BannerView[];
    } catch {
      return [];
    }
  }
  const res = (await adminClient().listBanners()) as {
    items?: Array<{ id: string; image_url?: string | null; link?: string | null; is_active?: boolean }>;
  };
  return (res.items ?? []).map((b) => ({
    id: b.id,
    imageUrl: b.image_url ?? null,
    link: b.link ?? null,
    isActive: b.is_active !== false,
  }));
}

export async function addBanner(imageFileId: string, link: string): Promise<void> {
  if (getAdminApiMode() !== 'live') {
    const list = await listBanners();
    list.push({ id: `bnr_${Date.now()}`, imageUrl: null, link: link || null, isActive: true });
    window.localStorage.setItem(BANNER_KEY, JSON.stringify(list));
    return;
  }
  await adminClient().createBanner({ image_file_id: imageFileId, link: link.trim() || null });
}

export async function setBannerActive(id: string, isActive: boolean): Promise<void> {
  if (getAdminApiMode() !== 'live') return;
  await adminClient().updateBanner(id, { is_active: isActive });
}

export async function removeBanner(id: string): Promise<void> {
  if (getAdminApiMode() !== 'live') {
    const list = (await listBanners()).filter((b) => b.id !== id);
    window.localStorage.setItem(BANNER_KEY, JSON.stringify(list));
    return;
  }
  await adminClient().deleteBanner(id);
}

/** 链接选择器（ADR-081）：返回带 locale/channel 前缀的站内路径。 */
export interface LinkTargetView {
  id: string;
  label: string;
  href: string;
}

export async function searchLinkTargets(
  type: 'product' | 'category' | 'page',
  keyword: string,
): Promise<LinkTargetView[]> {
  if (getAdminApiMode() !== 'live') return [];
  const res = (await adminClient().listLinkTargets({
    type,
    ...(keyword.trim() ? { q: keyword.trim() } : {}),
  })) as { items?: Array<{ id?: string; label?: string; href?: string }> };
  return (res.items ?? [])
    .filter((i): i is { id: string; label: string; href: string } => Boolean(i.id && i.label && i.href))
    .map((i) => ({ id: i.id, label: i.label, href: i.href }));
}

/** 微页面（ADR-082）。 */
export interface MicroPageView {
  id: string;
  slug: string;
  title: string;
  content: string;
  /** 正文格式（ADR-091）：plain / html。 */
  contentFormat: 'plain' | 'html';
  published: boolean;
}

const PAGE_KEY = 'admin:micro-pages';

export async function listMicroPages(): Promise<MicroPageView[]> {
  if (getAdminApiMode() !== 'live') {
    try {
      return JSON.parse(window.localStorage.getItem(PAGE_KEY) ?? '[]') as MicroPageView[];
    } catch {
      return [];
    }
  }
  const res = (await adminClient().listMicroPages()) as {
    items?: Array<{
      id: string;
      slug: string;
      title: string;
      content?: string;
      content_format?: string;
      is_published?: boolean;
    }>;
  };
  return (res.items ?? []).map((p) => ({
    id: p.id,
    slug: p.slug,
    title: p.title,
    content: p.content ?? '',
    contentFormat: p.content_format === 'html' ? 'html' : 'plain',
    published: p.is_published === true,
  }));
}

export async function createMicroPage(input: {
  slug: string;
  title: string;
  content: string;
  contentFormat: 'plain' | 'html';
  published: boolean;
}): Promise<void> {
  if (getAdminApiMode() !== 'live') {
    const list = await listMicroPages();
    list.unshift({
      id: `page_${Date.now()}`,
      slug: input.slug,
      title: input.title,
      content: input.content,
      contentFormat: input.contentFormat,
      published: input.published,
    });
    window.localStorage.setItem(PAGE_KEY, JSON.stringify(list));
    return;
  }
  await adminClient().createMicroPage({
    slug: input.slug,
    title: input.title,
    content: input.content,
    content_format: input.contentFormat,
    is_published: input.published,
  });
}

export async function setMicroPagePublished(id: string, published: boolean): Promise<void> {
  if (getAdminApiMode() !== 'live') return;
  await adminClient().updateMicroPage(id, { is_published: published });
}

export async function removeMicroPage(id: string): Promise<void> {
  if (getAdminApiMode() !== 'live') {
    const list = (await listMicroPages()).filter((p) => p.id !== id);
    window.localStorage.setItem(PAGE_KEY, JSON.stringify(list));
    return;
  }
  await adminClient().deleteMicroPage(id);
}
