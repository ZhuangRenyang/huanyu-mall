import { prefixedUlid } from "@mall/core";
import { DEFAULT_FILE_CONFIG, type FileConfig } from "../config.js";
import {
  contentTypeMismatch,
  emptyFile,
  fileNotFound,
  fileTooLarge,
  invalidFileType,
} from "../errors.js";
import { detectImageMime, extensionForMime } from "./magic.js";
import type { FileDTO, FileRepository, IFileModuleService, ImageVariantName, UploadInput } from "../types.js";

/** M13 对外门面：上传做 content-type + 魔数双校验（坑 10），派生原图 + webp。 */
export class FileService implements IFileModuleService {
  constructor(
    private readonly repo: FileRepository,
    private readonly config: FileConfig = DEFAULT_FILE_CONFIG,
  ) {}

  async upload(input: UploadInput): Promise<FileDTO> {
    if (input.data.length === 0) throw emptyFile();
    if (input.data.length > this.config.maxSizeBytes) throw fileTooLarge(this.config.maxSizeBytes);

    const detected = detectImageMime(input.data);
    if (!detected) throw invalidFileType("unrecognized content");
    if (!this.config.allowedMimeTypes.includes(detected)) throw invalidFileType(detected);
    if (detected !== input.contentType) throw contentTypeMismatch(input.contentType, detected);

    const key = `${prefixedUlid("file")}.${extensionForMime(detected)}`;
    const file = await this.repo.insertFile({
      key,
      filename: sanitizeFilename(input.filename),
      contentType: detected,
      sizeBytes: input.data.length,
      storageProvider: input.storageProvider ?? this.config.storageProvider,
    });

    await this.repo.insertVariant({
      fileId: file.id,
      variant: "original",
      key,
      sizeBytes: input.data.length,
    });
    if (detected !== "image/gif") {
      await this.repo.insertVariant({
        fileId: file.id,
        variant: "webp",
        key: `${prefixedUlid("file")}.webp`,
        sizeBytes: input.data.length,
      });
    }
    return file;
  }

  async getPublicUrl(id: string, variant?: ImageVariantName): Promise<string> {
    const file = await this.repo.findById(id);
    if (!file) throw fileNotFound(id);
    let key = file.key;
    if (variant && variant !== "original") {
      const v = await this.repo.findVariant(id, variant);
      if (v) key = v.key;
    }
    return `${this.config.publicBaseUrl}/${key}`;
  }

  async getPublicUrls(ids: string[]): Promise<Record<string, string>> {
    const unique = [...new Set(ids.filter(Boolean))];
    if (unique.length === 0) return {};
    const files = await this.repo.findByIds(unique);
    const out: Record<string, string> = {};
    for (const f of files) out[f.id] = `${this.config.publicBaseUrl}/${f.key}`;
    return out;
  }

  async deleteFile(id: string): Promise<void> {
    const file = await this.repo.findById(id);
    if (!file) throw fileNotFound(id);
    await this.repo.softDelete(id);
  }
}

function sanitizeFilename(name: string): string {
  const cleaned = name.replace(/[\\/]/g, "_").replace(/[\u0000-\u001f]/g, "").slice(0, 200);
  return cleaned.length > 0 ? cleaned : "file";
}
