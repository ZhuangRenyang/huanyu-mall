import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Printer, ArrowLeft } from 'lucide-react';
import { Button, Skeleton, formatMoney } from '@mall/ui';
import { getOrder } from '@/lib/admin-api';
import type { AdminOrder } from '@/lib/admin-data';

/**
 * 发货单（后台，ADR-044）。
 *
 * 商家发货时要在包裹里放一张纸：订单号、收货人、商品与数量、商家备注。
 * 淘宝的「打印发货单」就是这个东西；Shopify 叫 packing slip。
 *
 * 独立路由、不套后台外壳：套着侧边栏打印会印出一列菜单。
 * 含金额：淘宝发货单模板是带金额的（装箱单才隐藏价格）。
 */
export function PackingSlipPage() {
  const { id = '' } = useParams<{ id: string }>();
  const [order, setOrder] = useState<AdminOrder | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void getOrder(id)
      .then((o) => {
        if (!cancelled) setOrder(o);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (loading) {
    return (
      <div className="mx-auto max-w-[210mm] p-8 print:p-0">
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (!order) {
    return (
      <div className="mx-auto max-w-[210mm] p-8">
        <p className="text-sm text-destructive">订单不存在或已删除：{id}</p>
        <Link to="/orders" className="mt-3 inline-block text-sm text-primary hover:underline">
          返回订单列表
        </Link>
      </div>
    );
  }

  const totalQty = order.items.reduce((n, i) => n + i.quantity, 0);

  return (
    <div className="min-h-dvh bg-background">
      {/* 操作条只在屏幕上出现：打印时留一张干净的纸 */}
      <div className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-border bg-card px-4 py-2 print:hidden">
        <Link
          to="/orders"
          className="inline-flex h-8 items-center gap-1 rounded-md border border-border px-3 text-sm text-foreground transition-colors duration-150 hover:bg-muted"
        >
          <ArrowLeft className="size-4" strokeWidth={2} aria-hidden="true" />
          返回订单列表
        </Link>
        <Button size="sm" onClick={() => window.print()}>
          <Printer className="size-4" strokeWidth={2} aria-hidden="true" />
          打印
        </Button>
      </div>

      <article className="mx-auto w-full max-w-[210mm] bg-card p-8 text-foreground print:max-w-none print:bg-white print:p-0">
        <header className="flex items-start justify-between gap-4 border-b border-border pb-4">
          <div>
            <h1 className="text-xl font-semibold">发货单</h1>
            <p className="mt-1 tabular font-mono text-sm text-muted-foreground">{order.id}</p>
          </div>
          <div className="text-right text-sm text-muted-foreground">
            <p>下单时间：{new Date(order.createdAt).toLocaleString('zh-CN')}</p>
            <p>商品件数：{totalQty}</p>
          </div>
        </header>

        <section className="mt-5 grid gap-4 sm:grid-cols-2">
          <div>
            <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">收货人</h2>
            <p className="mt-1 text-sm text-foreground">{order.customerName}</p>
            <p className="text-sm text-muted-foreground">{order.customerEmail}</p>
          </div>
          <div>
            <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">收货地址</h2>
            <p className="mt-1 text-sm leading-6 text-foreground">{order.shippingAddress || '—'}</p>
          </div>
        </section>

        <table className="mt-6 w-full border-collapse text-sm">
          <thead>
            <tr className="border-y border-border text-left text-xs text-muted-foreground">
              <th className="py-2 pr-3 font-medium">商品</th>
              <th className="py-2 pr-3 font-medium">规格</th>
              <th className="py-2 pr-3 text-right font-medium">数量</th>
              <th className="py-2 pr-3 text-right font-medium">单价</th>
              <th className="py-2 text-right font-medium">小计</th>
            </tr>
          </thead>
          <tbody>
            {order.items.map((item, i) => (
              <tr key={i} className="border-b border-border align-top">
                <td className="py-2 pr-3 text-foreground">{item.title}</td>
                <td className="py-2 pr-3 text-muted-foreground">{item.variantTitle ?? '—'}</td>
                <td className="py-2 pr-3 text-right tabular">{item.quantity}</td>
                <td className="py-2 pr-3 text-right tabular">
                  {formatMoney(item.unitPriceMinor, order.currency)}
                </td>
                <td className="py-2 text-right tabular">
                  {formatMoney(item.unitPriceMinor * item.quantity, order.currency)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <section className="mt-4 ml-auto w-full max-w-xs space-y-1 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">商品小计</span>
            <span className="tabular">{formatMoney(order.subtotalMinor, order.currency)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">运费</span>
            <span className="tabular">{formatMoney(order.shippingMinor, order.currency)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">税费</span>
            <span className="tabular">{formatMoney(order.taxMinor, order.currency)}</span>
          </div>
          <div className="flex justify-between border-t border-border pt-1 text-base font-semibold">
            <span>实付</span>
            <span className="tabular">{formatMoney(order.totalMinor, order.currency)}</span>
          </div>
        </section>

        {order.merchantNote && (
          <section className="mt-6 rounded border border-border px-3 py-2">
            <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">商家备注</h2>
            <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">{order.merchantNote}</p>
          </section>
        )}

        <footer className="mt-8 flex justify-between border-t border-border pt-3 text-xs text-muted-foreground">
          <span>请核对商品与数量后再签收</span>
          <span>客服联系：本店铺在线客服</span>
        </footer>
      </article>
    </div>
  );
}
