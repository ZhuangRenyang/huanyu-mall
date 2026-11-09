import { DEFAULT_THEME, type IThemeModuleService, type ThemeRepository, type ThemeSettingsDTO } from "../types.js";

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
}
