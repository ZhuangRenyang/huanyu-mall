import type { Metadata } from 'next';
import { NotFoundContent } from '@/components/not-found-content';

export const metadata: Metadata = {
  title: '页面未找到',
};

/** 全局 404（未知路由）：一期 locale/channel 固定为 zh-CN/cn。 */
export default function NotFound() {
  return <NotFoundContent base="/zh-CN/cn" />;
}
