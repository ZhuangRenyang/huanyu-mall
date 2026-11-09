import { eq, isNull } from "drizzle-orm";
import type { NodePgDatabase } from "@mall/core";
import * as schema from "../models/index.js";
import type { CreateRegionInput, RegionDTO, RegionRepository } from "../types.js";

type Db = NodePgDatabase<typeof schema>;

export class DrizzleRegionRepository implements RegionRepository {
  constructor(private readonly db: Db) {}

  async findById(id: string): Promise<RegionDTO | null> {
    const rows = await this.db
      .select()
      .from(schema.region)
      .where(eq(schema.region.id, id))
      .limit(1);
    return rows[0] ? toRegionDTO(rows[0]) : null;
  }

  async findByCurrency(currencyCode: string): Promise<RegionDTO | null> {
    const rows = await this.db
      .select()
      .from(schema.region)
      .where(eq(schema.region.currencyCode, currencyCode))
      .limit(1);
    return rows[0] ? toRegionDTO(rows[0]) : null;
  }

  async list(): Promise<RegionDTO[]> {
    const rows = await this.db.select().from(schema.region).where(isNull(schema.region.deletedAt));
    return rows.map(toRegionDTO);
  }

  async create(input: CreateRegionInput): Promise<RegionDTO> {
    const rows = await this.db
      .insert(schema.region)
      .values({
        id: input.id,
        name: input.name,
        currencyCode: input.currencyCode,
        isActive: input.isActive ?? true,
      })
      .returning();
    return toRegionDTO(rows[0]!);
  }
}

function toRegionDTO(row: typeof schema.region.$inferSelect): RegionDTO {
  return {
    id: row.id,
    name: row.name,
    currency_code: row.currencyCode,
    is_active: row.isActive,
  };
}
