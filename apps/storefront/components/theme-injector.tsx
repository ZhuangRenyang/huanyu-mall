"use client";

import { useEffect } from "react";
import { getApiMode, getStoreClient, type BootstrapData } from "@/lib/api";

/**
 * 换肤闭环（AC-13）：live 模式下拉取 bootstrap.theme，注入 CSS 变量，
 * 后台改设计变量后店面外观随之变化。mock 模式无操作。
 */
export function ThemeInjector() {
  useEffect(() => {
    if (getApiMode() !== "live") return;
    let cancelled = false;

    getStoreClient()
      .bootstrap()
      .then((raw) => {
        if (cancelled) return;
        const data = raw as BootstrapData;
        const theme = data.theme;
        if (!theme) return;
        const root = document.documentElement;
        if (theme.primary_color) root.style.setProperty("--primary", theme.primary_color);
        if (theme.primary_color) root.style.setProperty("--primary-600", theme.primary_color);
        if (theme.gradient_color) root.style.setProperty("--gradient", theme.gradient_color);
        if (theme.accent_color) root.style.setProperty("--accent-orange-600", theme.accent_color);
        if (theme.font_family) root.style.setProperty("--font-family-sans", theme.font_family);
        if (theme.border_radius) root.style.setProperty("--radius", theme.border_radius);
        if (theme.product_image_ratio)
          root.style.setProperty("--aspect-product", theme.product_image_ratio);
      })
      .catch(() => {
        /* live 模式后端未就绪时静默降级，不阻塞页面 */
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
