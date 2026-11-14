/** M17 Theme DTO 与契约。设计变量权威来源；默认值取自 docs/03-uiux/design-tokens.json。 */

export interface ThemeSettingsDTO {
  id: string;
  primary_color: string;
  gradient_color: string;
  accent_color: string;
  font_family: string;
  border_radius: string;
  shadow: string;
  logo_file_id: string | null;
  product_image_ratio: string;
  /** 店铺名称：店头、发货单页眉、页脚都用它（ADR-045）。 */
  store_name: string;
  /** 客服电话（可空）：发货单与页脚展示。 */
  support_phone: string | null;
  /** 店铺公告（可空）：店面顶部公告条，空 = 不显示（ADR-047）。 */
  announcement: string | null;
  /**
   * 退货收件地址（可空，多行：收件人/电话/地址，ADR-053）。
   * 顾客在「退货退款」流程里照着它寄回 —— 不配这一项，顾客只能去问客服。
   */
  return_address: string | null;
  metadata: Record<string, unknown> | null;
}

export const DEFAULT_THEME: ThemeSettingsDTO = {
  id: "theme_default",
  primary_color: "#1666D9",
  gradient_color: "#5B8DEF",
  accent_color: "#FF6B35",
  font_family: "Archivo, 'Noto Sans SC', sans-serif",
  border_radius: "8px",
  shadow: "none",
  logo_file_id: null,
  product_image_ratio: "4:5",
  store_name: "全球商城",
  support_phone: null,
  announcement: null,
  return_address: null,
  metadata: null,
};

export interface ThemeRepository {
  getSettings(): Promise<ThemeSettingsDTO | null>;
  upsertSettings(patch: Partial<ThemeSettingsDTO>): Promise<ThemeSettingsDTO>;
  nextVersion(): Promise<number>;
  insertRevision(version: number, settings: ThemeSettingsDTO): Promise<void>;
  listBanners(activeOnly: boolean): Promise<BannerDTO[]>;
  insertBanner(row: {
    id: string;
    imageFileId: string;
    link: string | null;
    sortOrder: number;
    isActive: boolean;
  }): Promise<BannerDTO>;
  updateBanner(
    id: string,
    patch: { imageFileId?: string; link?: string | null; sortOrder?: number; isActive?: boolean },
  ): Promise<BannerDTO | null>;
  softDeleteBanner(id: string): Promise<void>;
  listMicroPages(): Promise<MicroPageDTO[]>;
  findMicroPageBySlug(slug: string, publishedOnly: boolean): Promise<MicroPageDTO | null>;
  insertMicroPage(row: {
    id: string;
    slug: string;
    title: string;
    content: string;
    isPublished: boolean;
  }): Promise<MicroPageDTO>;
  updateMicroPage(
    id: string,
    patch: { slug?: string; title?: string; content?: string; isPublished?: boolean },
  ): Promise<MicroPageDTO | null>;
  softDeleteMicroPage(id: string): Promise<void>;
}

/** 首页轮播图（ADR-080）。 */
export interface BannerDTO {
  id: string;
  image_file_id: string;
  /** 站内路径或 https 外链；null = 不可点。 */
  link: string | null;
  sort_order: number;
  is_active: boolean;
}

export interface BannerInput {
  image_file_id: string;
  link?: string | null;
  sort_order?: number;
  is_active?: boolean;
}

/** 微页面（ADR-082）。 */
export interface MicroPageDTO {
  id: string;
  slug: string;
  title: string;
  content: string;
  is_published: boolean;
}

export interface MicroPageInput {
  slug: string;
  title: string;
  content?: string;
  is_published?: boolean;
}

export interface IThemeModuleService {
  getSettings(): Promise<ThemeSettingsDTO>;
  updateSettings(patch: Partial<ThemeSettingsDTO>): Promise<ThemeSettingsDTO>;
  /** 轮播图（ADR-080）：activeOnly=true 供店面，false 供后台。 */
  listBanners(activeOnly?: boolean): Promise<BannerDTO[]>;
  createBanner(input: BannerInput): Promise<BannerDTO>;
  updateBanner(id: string, patch: Partial<BannerInput>): Promise<BannerDTO>;
  deleteBanner(id: string): Promise<void>;
  listMicroPages(): Promise<MicroPageDTO[]>;
  /** 店面按 slug 取已发布的；草稿不给。 */
  getPublishedMicroPage(slug: string): Promise<MicroPageDTO | null>;
  createMicroPage(input: MicroPageInput): Promise<MicroPageDTO>;
  updateMicroPage(id: string, patch: Partial<MicroPageInput>): Promise<MicroPageDTO>;
  deleteMicroPage(id: string): Promise<void>;
}
