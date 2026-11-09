import { createStoreClient } from "@mall/sdk";

/** 前端数据源模式：mock（默认，无后端可预览）| live（打真 API）。 */
export type ApiMode = "mock" | "live";

export function getApiMode(): ApiMode {
  return process.env.NEXT_PUBLIC_API_MODE === "live" ? "live" : "mock";
}

/**
 * 基础地址：
 * - 浏览器 / client 组件：同源相对路径（经 nginx 反代 /api）
 * - SSR（server component）：直连 api 容器（相对路径在服务端无法解析）
 */
function apiBaseUrl(): string {
  if (typeof window === "undefined") {
    return process.env.API_INTERNAL_URL ?? "http://api:3000";
  }
  return process.env.NEXT_PUBLIC_API_BASE ?? "";
}

let storeClient: ReturnType<typeof createStoreClient> | null = null;

/** 店面客户端（live 模式用；路径已含 /api/v1）。 */
export function getStoreClient(): ReturnType<typeof createStoreClient> {
  if (!storeClient) {
    storeClient = createStoreClient({
      baseUrl: apiBaseUrl(),
      publishableKey: process.env.NEXT_PUBLIC_CHANNEL ?? "cn",
    });
  }
  return storeClient;
}

/** bootstrap 返回的主题（换肤闭环：后台改设计变量 → 店面注入 CSS 变量）。 */
export interface BootstrapTheme {
  primary_color?: string;
  gradient_color?: string;
  accent_color?: string;
  font_family?: string;
  border_radius?: string;
  product_image_ratio?: string;
}

export interface BootstrapData {
  channel?: string;
  locale?: string;
  currency_code?: string;
  theme?: BootstrapTheme | null;
  [k: string]: unknown;
}
