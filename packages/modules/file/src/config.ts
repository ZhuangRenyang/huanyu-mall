export interface FileConfig {
  allowedMimeTypes: string[];
  maxSizeBytes: number;
  maxDimensionPx: number;
  storageProvider: "local" | "s3";
  publicBaseUrl: string;
}

export const DEFAULT_FILE_CONFIG: FileConfig = {
  allowedMimeTypes: ["image/jpeg", "image/png", "image/webp", "image/avif", "image/gif"],
  maxSizeBytes: 10 * 1024 * 1024,
  maxDimensionPx: 8000,
  storageProvider: "local",
  publicBaseUrl: "/uploads",
};
