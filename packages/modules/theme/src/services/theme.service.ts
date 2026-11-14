import { prefixedUlid } from "@mall/core";
import {
  DEFAULT_THEME,
  type BannerDTO,
  type BannerInput,
  type IThemeModuleService,
  type MicroPageDTO,
  type MicroPageInput,
  type ThemeRepository,
  type ThemeSettingsDTO,
} from "../types.js";

/** M17 对外门面：设计变量读写；写前存 revision 留痕。 */
export class ThemeService implements IThemeModuleService {
  constructor(private readonly repo: ThemeRepository) {}

  async getSettings(): Promise<ThemeSettingsDTO> {
    return (await this.repo.getSettings()) ?? DEFAULT_THEME;
  }

  async updateSettings(patch: Partial<ThemeSettingsDTO>): Promise<ThemeSettingsDTO> {
    const current = await this.getSettings();
    const version = await this.repo.nextVersion();
    await this.repo.insertRevision(version, current); // 写前存版本，可回滚
    return this.repo.upsertSettings(patch);
  }

  async listBanners(activeOnly = false): Promise<BannerDTO[]> {
    return this.repo.listBanners(activeOnly);
  }

  async createBanner(input: BannerInput): Promise<BannerDTO> {
    return this.repo.insertBanner({
      id: prefixedUlid("bnr"),
      imageFileId: input.image_file_id,
      // 链接只允许站内路径或 https：javascript: 之类不能在装修入口混进来（XSS）
      link: normalizeLink(input.link ?? null),
      sortOrder: input.sort_order ?? Date.now(),
      isActive: input.is_active !== false,
    });
  }

  async updateBanner(id: string, patch: Partial<BannerInput>): Promise<BannerDTO> {
    const updated = await this.repo.updateBanner(id, {
      ...(patch.image_file_id !== undefined ? { imageFileId: patch.image_file_id } : {}),
      ...(patch.link !== undefined ? { link: normalizeLink(patch.link) } : {}),
      ...(patch.sort_order !== undefined ? { sortOrder: patch.sort_order } : {}),
      ...(patch.is_active !== undefined ? { isActive: patch.is_active } : {}),
    });
    if (!updated) throw new Error(`banner not found: ${id}`);
    return updated;
  }

  async deleteBanner(id: string): Promise<void> {
    await this.repo.softDeleteBanner(id);
  }

  async listMicroPages(): Promise<MicroPageDTO[]> {
    return this.repo.listMicroPages();
  }

  async getPublishedMicroPage(slug: string): Promise<MicroPageDTO | null> {
    return this.repo.findMicroPageBySlug(slug, true);
  }

  async createMicroPage(input: MicroPageInput): Promise<MicroPageDTO> {
    return this.repo.insertMicroPage({
      id: prefixedUlid("page"),
      slug: normalizeSlug(input.slug),
      title: input.title.trim(),
      content: input.content ?? "",
      isPublished: input.is_published === true,
    });
  }

  async updateMicroPage(id: string, patch: Partial<MicroPageInput>): Promise<MicroPageDTO> {
    const updated = await this.repo.updateMicroPage(id, {
      ...(patch.slug !== undefined ? { slug: normalizeSlug(patch.slug) } : {}),
      ...(patch.title !== undefined ? { title: patch.title.trim() } : {}),
      ...(patch.content !== undefined ? { content: patch.content } : {}),
      ...(patch.is_published !== undefined ? { isPublished: patch.is_published } : {}),
    });
    if (!updated) throw new Error(`micro page not found: ${id}`);
    return updated;
  }

  async deleteMicroPage(id: string): Promise<void> {
    await this.repo.softDeleteMicroPage(id);
  }
}

/** slug 只允许小写字母、数字与连字符；中文标题不自动转拼音（转不准，让商家自己填）。 */
export function normalizeSlug(slug: string): string {
  const v = slug.trim().toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9-]{1,58}[a-z0-9])?$/.test(v)) {
    throw new Error("页面地址只能用小写字母、数字与连字符，2–60 位");
  }
  return v;
}

/** 链接白名单：空 / 站内 `/` 开头 / https 外链。其它一律拒绝。 */
export function normalizeLink(link: string | null): string | null {
  const v = link?.trim();
  if (!v) return null;
  if (v.startsWith("/") && !v.startsWith("//")) return v;
  if (v.toLowerCase().startsWith("https://")) return v;
  throw new Error("轮播图链接只允许站内路径（/ 开头）或 https 外链");
}
