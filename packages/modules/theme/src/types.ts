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
  metadata: null,
};

export interface ThemeRepository {
  getSettings(): Promise<ThemeSettingsDTO | null>;
  upsertSettings(patch: Partial<ThemeSettingsDTO>): Promise<ThemeSettingsDTO>;
  nextVersion(): Promise<number>;
  insertRevision(version: number, settings: ThemeSettingsDTO): Promise<void>;
}

export interface IThemeModuleService {
  getSettings(): Promise<ThemeSettingsDTO>;
  updateSettings(patch: Partial<ThemeSettingsDTO>): Promise<ThemeSettingsDTO>;
}
