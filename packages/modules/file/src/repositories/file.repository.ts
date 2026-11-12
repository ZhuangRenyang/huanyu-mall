import { and, eq, inArray, isNull } from "drizzle-orm";
import { prefixedUlid, type NodePgDatabase } from "@mall/core";
import * as schema from "../models/index.js";
import type {
  FileDTO,
  FileRepository,
  FileVariantDTO,
  ImageVariantName,
  InsertFileInput,
  InsertFileVariantInput,
} from "../types.js";

type Db = NodePgDatabase<typeof schema>;

export class DrizzleFileRepository implements FileRepository {
  constructor(private readonly db: Db) {}

  async insertFile(input: InsertFileInput): Promise<FileDTO> {
    const rows = await this.db
      .insert(schema.file)
      .values({
        id: prefixedUlid("file"),
        key: input.key,
        filename: input.filename,
        contentType: input.contentType,
        sizeBytes: BigInt(input.sizeBytes),
        storageProvider: input.storageProvider,
      })
      .returning();
    return toFileDTO(rows[0]!);
  }

  async insertVariant(input: InsertFileVariantInput): Promise<FileVariantDTO> {
    const rows = await this.db
      .insert(schema.fileVariant)
      .values({
        id: prefixedUlid("filevar"),
        fileId: input.fileId,
        variant: input.variant,
        key: input.key,
        sizeBytes: BigInt(input.sizeBytes),
        widthPx: input.widthPx ?? null,
        heightPx: input.heightPx ?? null,
      })
      .returning();
    return toVariantDTO(rows[0]!);
  }

  async findById(id: string): Promise<FileDTO | null> {
    const rows = await this.db
      .select()
      .from(schema.file)
      .where(and(eq(schema.file.id, id), isNull(schema.file.deletedAt)))
      .limit(1);
    return rows[0] ? toFileDTO(rows[0]) : null;
  }

  async findByIds(ids: string[]): Promise<FileDTO[]> {
    if (ids.length === 0) return [];
    const rows = await this.db.select().from(schema.file).where(inArray(schema.file.id, ids));
    return rows.map(toFileDTO);
  }

  async findVariant(fileId: string, variant: ImageVariantName): Promise<FileVariantDTO | null> {
    const rows = await this.db
      .select()
      .from(schema.fileVariant)
      .where(
        and(
          eq(schema.fileVariant.fileId, fileId),
          eq(schema.fileVariant.variant, variant),
          isNull(schema.fileVariant.deletedAt),
        ),
      )
      .limit(1);
    return rows[0] ? toVariantDTO(rows[0]) : null;
  }

  async softDelete(id: string): Promise<void> {
    await this.db
      .update(schema.file)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.file.id, id));
  }
}

function toFileDTO(r: typeof schema.file.$inferSelect): FileDTO {
  return {
    id: r.id,
    key: r.key,
    filename: r.filename,
    content_type: r.contentType,
    size_bytes: Number(r.sizeBytes),
    width_px: r.widthPx ?? null,
    height_px: r.heightPx ?? null,
    storage_provider: r.storageProvider,
  };
}

function toVariantDTO(r: typeof schema.fileVariant.$inferSelect): FileVariantDTO {
  return {
    id: r.id,
    file_id: r.fileId,
    variant: r.variant as ImageVariantName,
    key: r.key,
    width_px: r.widthPx ?? null,
    height_px: r.heightPx ?? null,
    size_bytes: Number(r.sizeBytes),
  };
}
