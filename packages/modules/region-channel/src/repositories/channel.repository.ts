import { and, eq, isNull } from "drizzle-orm";
import type { NodePgDatabase } from "@mall/core";
import * as schema from "../models/index.js";
import type { ChannelDTO, ChannelRepository, CreateChannelInput } from "../types.js";

type Db = NodePgDatabase<typeof schema>;

export class DrizzleChannelRepository implements ChannelRepository {
  constructor(private readonly db: Db) {}

  async findById(id: string): Promise<ChannelDTO | null> {
    const rows = await this.db
      .select()
      .from(schema.channel)
      .where(and(eq(schema.channel.id, id), isNull(schema.channel.deletedAt)))
      .limit(1);
    return rows[0] ? toChannelDTO(rows[0]) : null;
  }

  async findBySlug(slug: string): Promise<ChannelDTO | null> {
    const rows = await this.db
      .select()
      .from(schema.channel)
      .where(and(eq(schema.channel.slug, slug), isNull(schema.channel.deletedAt)))
      .limit(1);
    return rows[0] ? toChannelDTO(rows[0]) : null;
  }

  async list(q?: { isActive?: boolean }): Promise<ChannelDTO[]> {
    const conditions = [isNull(schema.channel.deletedAt)];
    if (q?.isActive !== undefined) conditions.push(eq(schema.channel.isActive, q.isActive));
    const rows = await this.db.select().from(schema.channel).where(and(...conditions));
    return rows.map(toChannelDTO);
  }

  async create(input: CreateChannelInput): Promise<ChannelDTO> {
    const rows = await this.db
      .insert(schema.channel)
      .values({
        id: input.id,
        name: input.name,
        slug: input.slug,
        currencyCode: input.currencyCode,
        regionId: input.regionId,
        defaultLocale: input.defaultLocale ?? "zh-CN",
        marketScope: input.marketScope ?? "cn",
        isActive: input.isActive ?? true,
        metadata: input.metadata ?? null,
      })
      .returning();
    return toChannelDTO(rows[0]!);
  }
}

function toChannelDTO(row: typeof schema.channel.$inferSelect): ChannelDTO {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    currency_code: row.currencyCode,
    region_id: row.regionId,
    default_locale: row.defaultLocale,
    market_scope: row.marketScope,
    is_active: row.isActive,
    metadata: (row.metadata as Record<string, unknown> | null) ?? null,
  };
}
