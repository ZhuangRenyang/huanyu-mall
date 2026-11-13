'use client';

import { useEffect } from 'react';
import { recordView } from '@/lib/recently-viewed';

/**
 * 记一次浏览（ADR-063）。
 *
 * 单独一个「只写不渲染」的客户端组件，是因为商品详情页是服务端组件：
 * localStorage 只能在客户端读，写在服务端组件里会直接报错。
 *
 * 依赖只放 productId —— 同一次访问里其它字段不会变，多挂依赖会重复写。
 */
export function TrackView({
  productId,
  handle,
  title,
  priceMinor,
  imageUrl,
  currencyCode = 'CNY',
}: {
  productId: string;
  handle: string;
  title: string;
  priceMinor: number;
  imageUrl?: string;
  currencyCode?: string;
}) {
  useEffect(() => {
    recordView({
      productId,
      handle,
      title,
      priceMinor,
      currencyCode,
      ...(imageUrl ? { imageUrl } : {}),
      viewedAt: Date.now(),
    });
  }, [productId, handle, title, priceMinor, imageUrl, currencyCode]);

  return null;
}
