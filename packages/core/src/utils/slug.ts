function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export interface SlugifyOptions {
  separator?: string;
  maxLength?: number;
}

/**
 * slugify：NFKC 规范化 + 小写 + 去变音符 + 非字母数字折叠为分隔符。
 * 保留 Unicode 字母/数字（\p{L}\p{N}），中文标题不被清空。
 */
export function slugify(input: string, opts: SlugifyOptions = {}): string {
  const sep = opts.separator ?? "-";
  const max = opts.maxLength ?? 200;
  const escaped = escapeRegExp(sep);

  const normalized = input
    .normalize("NFKC")
    .toLowerCase()
    .trim()
    .replace(/['\u2019]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, sep)
    .replace(new RegExp(`${escaped}+`, "g"), sep)
    .replace(new RegExp(`^${escaped}|${escaped}$`, "g"), "");

  if (!normalized) return "";
  return normalized.slice(0, max).replace(new RegExp(`${escaped}$`, "g"), "");
}
