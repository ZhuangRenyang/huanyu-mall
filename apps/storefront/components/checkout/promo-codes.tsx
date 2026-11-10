'use client';

import { useState } from 'react';
import { Tag, TicketPercent, X } from 'lucide-react';
import { Button, Input, cn } from '@mall/ui';

/**
 * 优惠码 / 礼品卡输码组件（结账页）。
 *
 * 只把「码凭证」交给上层回调，由上层调 store 接口、后端算折扣，本组件不碰金额。
 * 已应用的码以可移除 chip 展示，输入框回车或点「应用」提交。
 */

export interface PromoCodesProps {
  voucherCodes: string[];
  giftCardCodes: string[];
  busy: boolean;
  error: string | null;
  onApplyVoucher: (code: string) => void;
  onApplyGiftCard: (code: string) => void;
  onRemoveVoucher: (code: string) => void;
  onRemoveGiftCard: (code: string) => void;
}

export function PromoCodes({
  voucherCodes,
  giftCardCodes,
  busy,
  error,
  onApplyVoucher,
  onApplyGiftCard,
  onRemoveVoucher,
  onRemoveGiftCard,
}: PromoCodesProps) {
  const [voucherInput, setVoucherInput] = useState('');
  const [giftCardInput, setGiftCardInput] = useState('');

  const submitVoucher = () => {
    const code = voucherInput.trim();
    if (!code || busy) return;
    onApplyVoucher(code);
    setVoucherInput('');
  };
  const submitGiftCard = () => {
    const code = giftCardInput.trim();
    if (!code || busy) return;
    onApplyGiftCard(code);
    setGiftCardInput('');
  };

  return (
    <div className="space-y-3 rounded-lg border border-border bg-card p-4">
      <h2 className="text-sm font-semibold">优惠码</h2>

      <div className="space-y-2">
        <div className="flex gap-2">
          <Input
            aria-label="优惠券码"
            placeholder="优惠券码"
            value={voucherInput}
            onChange={(e) => setVoucherInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                submitVoucher();
              }
            }}
            disabled={busy}
          />
          <Button size="sm" variant="secondary" className="shrink-0" onClick={submitVoucher} disabled={busy || !voucherInput.trim()}>
            应用
          </Button>
        </div>
        <div className="flex gap-2">
          <Input
            aria-label="礼品卡码"
            placeholder="礼品卡码"
            value={giftCardInput}
            onChange={(e) => setGiftCardInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                submitGiftCard();
              }
            }}
            disabled={busy}
          />
          <Button size="sm" variant="secondary" className="shrink-0" onClick={submitGiftCard} disabled={busy || !giftCardInput.trim()}>
            应用
          </Button>
        </div>
      </div>

      {error && (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}

      {(voucherCodes.length > 0 || giftCardCodes.length > 0) && (
        <div className="flex flex-wrap gap-1.5">
          {voucherCodes.map((code) => (
            <Chip key={`v-${code}`} icon={TicketPercent} label={code} onRemove={() => onRemoveVoucher(code)} disabled={busy} />
          ))}
          {giftCardCodes.map((code) => (
            <Chip key={`g-${code}`} icon={Tag} label={code} onRemove={() => onRemoveGiftCard(code)} disabled={busy} />
          ))}
        </div>
      )}
    </div>
  );
}

function Chip({
  icon: Icon,
  label,
  onRemove,
  disabled,
}: {
  icon: typeof TicketPercent;
  label: string;
  onRemove: () => void;
  disabled: boolean;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border border-border bg-muted py-0.5 pl-2 pr-1 text-xs text-foreground',
      )}
    >
      <Icon className="size-3.5 text-muted-foreground" strokeWidth={2} aria-hidden="true" />
      <span className="font-mono">{label}</span>
      <button
        type="button"
        aria-label={`移除 ${label}`}
        onClick={onRemove}
        disabled={disabled}
        className="grid size-5 place-items-center rounded-full text-muted-foreground transition-colors duration-150 hover:bg-background hover:text-foreground disabled:opacity-40"
      >
        <X className="size-3.5" strokeWidth={2} aria-hidden="true" />
      </button>
    </span>
  );
}
