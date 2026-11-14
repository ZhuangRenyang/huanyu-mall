'use client';

import { useEffect } from 'react';

/**
 * 推广码落地归因（ADR-101）。
 *
 * 顾客通过 `?ref=CODE` 进来时，把码记在 localStorage（30 天）。
 * 下单时由结账流程带上 —— **只传码**，服务端查表校验并换算，
 * 前端永远不参与金额（铁律 13）。
 *
 * 放在 layout 里：任何落地页带 ref 都能记住，而不是只有商品页才行。
 */
const KEY = 'affiliate_ref';
const MAX_AGE_MS = 30 * 86_400_000;

export function AffiliateCapture() {
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const ref = params.get('ref')?.trim().toUpperCase();
      if (ref && /^[A-Z0-9]{4,16}$/.test(ref)) {
        window.localStorage.setItem(
          KEY,
          JSON.stringify({ code: ref, at: Date.now() }),
        );
      }
    } catch {
      /* 隐私模式/禁用存储：归因丢了不影响下单 */
    }
  }, []);

  return null;
}

/** 读取有效的推广码（超过 30 天视为失效）。 */
export function readAffiliateRef(): string | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { code?: string; at?: number };
    if (!parsed.code || typeof parsed.at !== 'number') return null;
    if (Date.now() - parsed.at > MAX_AGE_MS) return null;
    return parsed.code;
  } catch {
    return null;
  }
}
