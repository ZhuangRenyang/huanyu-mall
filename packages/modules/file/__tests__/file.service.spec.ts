import { describe, expect, it } from "vitest";
import { prefixedUlid } from "@mall/core";
import { FileService } from "../src/services/file.service.js";
import type {
  FileDTO,
  FileRepository,
  FileVariantDTO,
  ImageVariantName,
  InsertFileInput,
  InsertFileVariantInput,
} from "../src/types.js";

class InMemoryFileRepository implements FileRepository {
  readonly files = new Map<string, FileDTO>();
  readonly variants: FileVariantDTO[] = [];

  async insertFile(input: InsertFileInput): Promise<FileDTO> {
    const dto: FileDTO = {
      id: prefixedUlid("file"),
      key: input.key,
      filename: input.filename,
      content_type: input.contentType,
      size_bytes: input.sizeBytes,
      width_px: null,
      height_px: null,
      storage_provider: input.storageProvider,
    };
    this.files.set(dto.id, dto);
    return dto;
  }
  async insertVariant(input: InsertFileVariantInput): Promise<FileVariantDTO> {
    const v: FileVariantDTO = {
      id: prefixedUlid("filevar"),
      file_id: input.fileId,
      variant: input.variant,
      key: input.key,
      width_px: null,
      height_px: null,
      size_bytes: input.sizeBytes,
    };
    this.variants.push(v);
    return v;
  }
  async findById(id: string): Promise<FileDTO | null> {
    return this.files.get(id) ?? null;
  }
  async findVariant(fileId: string, variant: ImageVariantName): Promise<FileVariantDTO | null> {
    return this.variants.find((v) => v.file_id === fileId && v.variant === variant) ?? null;
  }
  async softDelete(id: string): Promise<void> {
    this.files.delete(id);
  }
}

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);

function setup() {
  const repo = new InMemoryFileRepository();
  return { repo, service: new FileService(repo) };
}

describe("FileService（M13 魔数双校验，坑 10）", () => {
  it("真实 PNG（content-type 与魔数一致）通过，派生原图 + webp", async () => {
    const { repo, service } = setup();
    const file = await service.upload({ filename: "a.png", contentType: "image/png", data: PNG });
    expect(file.content_type).toBe("image/png");
    expect(file.key.endsWith(".png")).toBe(true);
    expect(repo.variants.map((v) => v.variant).sort()).toEqual(["original", "webp"]);
  });

  it("伪造扩展名（.png 但内容不是图片）被拒", async () => {
    const { service } = setup();
    await expect(
      service.upload({ filename: "evil.png", contentType: "image/png", data: Buffer.from("not an image") }),
    ).rejects.toThrow(/Invalid file type/);
  });

  it("content-type 与魔数不一致（声明 png 实为 jpeg）被拒", async () => {
    const { service } = setup();
    await expect(
      service.upload({ filename: "x.png", contentType: "image/png", data: JPEG }),
    ).rejects.toThrow(/mismatch/);
  });

  it("超大小上限被拒；空文件被拒", async () => {
    const { service } = setup();
    const big = Buffer.concat([PNG, Buffer.alloc(11 * 1024 * 1024)]);
    await expect(service.upload({ filename: "big.png", contentType: "image/png", data: big })).rejects.toThrow(
      /too large/,
    );
    await expect(service.upload({ filename: "e.png", contentType: "image/png", data: Buffer.alloc(0) })).rejects.toThrow(
      /Empty/,
    );
  });

  it("getPublicUrl 使用随机 key（防路径穿越），deleteFile 软删", async () => {
    const { service } = setup();
    const file = await service.upload({ filename: "../../etc/passwd.png", contentType: "image/png", data: PNG });
    const url = await service.getPublicUrl(file.id);
    expect(url.startsWith("/uploads/")).toBe(true);
    expect(url).not.toContain("..");
    expect(file.filename).not.toContain("/");

    await service.deleteFile(file.id);
    await expect(service.getPublicUrl(file.id)).rejects.toThrow(/not found/);
  });
});
