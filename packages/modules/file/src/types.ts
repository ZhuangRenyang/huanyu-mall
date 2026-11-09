export interface FileDTO {
  id: string;
  key: string;
  filename: string;
  content_type: string;
  size_bytes: number;
  width_px: number | null;
  height_px: number | null;
  storage_provider: string;
}

export type ImageVariantName = "original" | "webp" | "thumb";

export interface FileVariantDTO {
  id: string;
  file_id: string;
  variant: ImageVariantName;
  key: string;
  width_px: number | null;
  height_px: number | null;
  size_bytes: number;
}

export interface UploadInput {
  filename: string;
  contentType: string;
  data: Buffer;
  storageProvider?: "local" | "s3";
}

export interface InsertFileInput {
  key: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  storageProvider: string;
}

export interface InsertFileVariantInput {
  fileId: string;
  variant: ImageVariantName;
  key: string;
  sizeBytes: number;
  widthPx?: number | null;
  heightPx?: number | null;
}

export interface FileRepository {
  insertFile(input: InsertFileInput): Promise<FileDTO>;
  insertVariant(input: InsertFileVariantInput): Promise<FileVariantDTO>;
  findById(id: string): Promise<FileDTO | null>;
  findVariant(fileId: string, variant: ImageVariantName): Promise<FileVariantDTO | null>;
  softDelete(id: string): Promise<void>;
}

export interface IFileModuleService {
  upload(input: UploadInput): Promise<FileDTO>;
  getPublicUrl(id: string, variant?: ImageVariantName): Promise<string>;
  deleteFile(id: string): Promise<void>;
}
