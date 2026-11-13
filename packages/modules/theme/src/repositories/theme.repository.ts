import { eq, sql } from "drizzle-orm";
import { prefixedUlid, type NodePgDatabase } from "@mall/core";
import * as schema from "../models/index.js";
import { DEFAULT_THEME, type ThemeRepository, type ThemeSettingsDTO } from "../types.js";

type Db = NodePgDatabase<typeof schema>;

export class DrizzleThemeRepository implements ThemeRepository {
  constructor(private readonly db: Db) {}

  async getSettings(): Promise<ThemeSettingsDTO | null> {
    const rows = await this.db.select().from(schema.themeSettings).limit(1);
    return rows[0] ? toThemeDTO(rows[0]) : null;
  }

  async upsertSettings(patch: Partial<ThemeSettingsDTO>): Promise<ThemeSettingsDTO> {
    const current = (await this.getSettings()) ?? DEFAULT_THEME;
    const merged = { ...current, ...patch, id: "theme_default" };
    const values = {
      id: merged.id,
      primaryColor: merged.primary_color,
      gradientColor: merged.gradient_color,
      accentColor: merged.accent_color,
      fontFamily: merged.font_family,
      borderRadius: merged.border_radius,
      shadow: merged.shadow,
      logoFileId: merged.logo_file_id,
      productImageRatio: merged.product_image_ratio,
      storeName: merged.store_name,
      supportPhone: merged.support_phone,
      announcement: merged.announcement,
      returnAddress: merged.return_address,
      metadata: merged.metadata,
      updatedAt: new Date(),
    };
    const rows = await this.db
      .insert(schema.themeSettings)
      .values(values)
      .onConflictDoUpdate({ target: schema.themeSettings.id, set: values })
      .returning();
    return toThemeDTO(rows[0]!);
  }

  async nextVersion(): Promise<number> {
    const rows = await this.db
      .select({ max: sql<number>`coalesce(max(version), 0)` })
      .from(schema.themeRevision);
    return (rows[0]?.max ?? 0) + 1;
  }

  async insertRevision(version: number, settings: ThemeSettingsDTO): Promise<void> {
    await this.db.insert(schema.themeRevision).values({
      id: prefixedUlid("themerev"),
      version,
      settings,
    });
  }
}

function toThemeDTO(r: typeof schema.themeSettings.$inferSelect): ThemeSettingsDTO {
  return {
    id: r.id,
    primary_color: r.primaryColor,
    gradient_color: r.gradientColor,
    accent_color: r.accentColor,
    font_family: r.fontFamily,
    border_radius: r.borderRadius,
    shadow: r.shadow,
    logo_file_id: r.logoFileId ?? null,
    product_image_ratio: r.productImageRatio,
    store_name: r.storeName,
    support_phone: r.supportPhone ?? null,
    announcement: r.announcement ?? null,
    return_address: r.returnAddress ?? null,
    metadata: (r.metadata as Record<string, unknown> | null) ?? null,
  };
}
