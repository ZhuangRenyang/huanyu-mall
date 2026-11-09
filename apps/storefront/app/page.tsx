import { redirect } from 'next/navigation';

/** 根路径重定向到一期唯一 locale/channel。 */
export default function RootPage() {
  redirect('/zh-CN/cn');
}
