export interface FooterProps {
  locale: string;
  channel: string;
}

/** 页脚：分类入口 + 服务承诺 + 版权。移动端折叠为纵向列。 */
export function Footer({ locale, channel }: FooterProps) {
  const base = `/${locale}/${channel}`;

  return (
    <footer className="border-t border-border bg-card">
      <div className="mx-auto grid max-w-content grid-cols-2 gap-8 px-4 py-10 md:grid-cols-4">
        <div className="col-span-2 md:col-span-1">
          <p className="text-base font-semibold">全球商城</p>
          <p className="mt-2 text-sm text-muted-foreground">单商户跨境商城，自托管、零抽佣、数据自主。</p>
        </div>
        <div>
          <p className="text-sm font-medium">商品</p>
          <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
            <li>
              <a href={`${base}/products`} className="transition-colors duration-150 hover:text-foreground">
                全部商品
              </a>
            </li>
            <li>
              <a href={`${base}/products`} className="transition-colors duration-150 hover:text-foreground">
                数码配件
              </a>
            </li>
          </ul>
        </div>
        <div>
          <p className="text-sm font-medium">服务</p>
          <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
            <li>正品保障</li>
            <li>跨境直邮</li>
            <li>7 天可退</li>
          </ul>
        </div>
        <div>
          <p className="text-sm font-medium">账户</p>
          <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
            <li>
              <a href={`${base}/orders`} className="transition-colors duration-150 hover:text-foreground">
                订单查询
              </a>
            </li>
            <li>
              <a href={`${base}/account`} className="transition-colors duration-150 hover:text-foreground">
                账户
              </a>
            </li>
          </ul>
        </div>
      </div>
      <div className="border-t border-border py-4">
        <p className="px-4 text-center text-xs text-muted-foreground">© 2026 全球商城</p>
      </div>
    </footer>
  );
}
