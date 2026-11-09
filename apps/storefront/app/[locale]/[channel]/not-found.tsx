import { NotFoundContent } from '@/components/not-found-content';

/** channel 内 404（如 PDP handle 不存在时 notFound()）：渲染在 channel 布局内，带 Header/Footer。 */
export default function ChannelNotFound() {
  return <NotFoundContent base="/zh-CN/cn" />;
}
