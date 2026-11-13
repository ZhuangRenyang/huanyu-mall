'use client';

import { TextAreaField } from '@/components/form-field';

/** 与后端 CUSTOMER_NOTE_MAX_LENGTH 对齐（order 模块，ADR-050）。 */
export const CUSTOMER_NOTE_MAX = 200;

/**
 * 给卖家留言（淘宝下单页的同一块）。
 *
 * 位置照淘宝：商品与优惠之后、金额合计之前 —— 顾客看完要买什么、多少钱，
 * 才想起来「这单有特殊要求」。放在第一步问，多数人会跳过，回头又找不到。
 *
 * 选填、不校验：一个备注不该拦住下单。超长由 maxLength 在输入时就挡掉，
 * 服务端另有截断兜底（API 直连的情况）。
 */
export function CustomerNote({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <section
      aria-label="给卖家留言"
      className="rounded-lg border border-border bg-card p-4"
    >
      <TextAreaField
        id="checkout-customer-note"
        label="给卖家留言"
        hint="选填。包装、送货时间等特殊要求可以写在这里，商家看得到。"
        rows={3}
        maxLength={CUSTOMER_NOTE_MAX}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="例如：工作日白天送，别放快递柜"
      />
      <p className="mt-1 text-right text-xs tabular text-muted-foreground">
        {value.length}/{CUSTOMER_NOTE_MAX}
      </p>
    </section>
  );
}
