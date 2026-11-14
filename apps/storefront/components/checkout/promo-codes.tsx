'use client';

import { useEffect, useState } from 'react';
import { Tag, TicketPercent, X } from 'lucide-react';
import { Button, Input, cn } from '@mall/ui';
import { fetchPromotionFeatures, type PromotionFeatures } from '@/lib/promo';

/**
 * 优惠码 / 礼品卡输码组件（结账页）。
 *
 * 只把「码凭证」交给上层回调，由上层调 store 接口、后端算折扣，本组件不碰金额。
 * 已应用的码以可移除 chip 展示，输入框回车或点「应用」提交。
 */

export interface PromoCodesProps {
  voucherCodes: string[];
  giftCardCodes: string[];
  /** 当前顾客积分余额（ADR-094）。 */
  pointBalance: number;
  /** 已设置的积分抵扣意愿。 */
  pointsToUse: number;
  busy: boolean;
  error: string | null;
  onApplyVoucher: (code: string) => void;
  onApplyGiftCard: (code: string) => void;
  onRemoveVoucher: (code: string) => void;
  onRemoveGiftCard: (code: string) => void;
  onSetPoints: (points: number) => void;
}

export function PromoCodes({
  voucherCodes,
  giftCardCodes,
  pointBalance,
  pointsToUse,
  busy,
  error,
  onApplyVoucher,
  onApplyGiftCard,
  onRemoveVoucher,
  onRemoveGiftCard,
  onSetPoints,
}: PromoCodesProps) {
  const [voucherInput, setVoucherInput] = useState('');
  const [giftCardInput, setGiftCardInput] = useState('');
  const [pointsInput, setPointsInput] = useState('');
  // 功能开关以后端为准：关闭的功能不显示输码入口（默认全关）。
  const [features, setFeatures] = useState<PromotionFeatures | null>(null);

  useEffect(() => {
    let alive = true;
    fetchPromotionFeatures()
      .then((f) => alive && setFeatures(f))
      .catch(() =>
        alive && setFeatures({ promotion: false, voucher: false, gift_card: false, points: false }),
      );
    return () => {
      alive = false;
    };
  }, []);

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
  const submitPoints = () => {
    const n = Math.max(0, Math.floor(Number(pointsInput)));
    if (!Number.isFinite(n) || n <= 0 || busy) return;
    onSetPoints(n);
    setPointsInput('');
  };

  // 未加载完或三个功能都关闭 → 整块不渲染，避免顾客输了码才发现不能用。
  if (!features || (!features.voucher && !features.gift_card && !features.points)) return null;

  return (
    <div className="space-y-3 rounded-lg border border-border bg-card p-4">
      <h2 className="text-sm font-semibold">{features.voucher ? '优惠码' : '礼品卡'}</h2>

      <div className="space-y-2">
        {features.voucher && (
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
        )}
        {features.gift_card && (
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
        )}
        {features.points && (
        <div className="space-y-1">
          <div className="flex gap-2">
            <Input
              aria-label="用积分抵扣"
              placeholder={`可用 ${pointBalance} 积分，100 积分抵 1 元`}
              value={pointsInput}
              onChange={(e) => setPointsInput(e.target.value.replace(/[^\d]/g, ''))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  submitPoints();
                }
              }}
              disabled={busy || pointBalance <= 0}
            />
            <Button
              size="sm"
              variant="secondary"
              className="shrink-0"
              onClick={submitPoints}
              disabled={busy || pointBalance <= 0 || !pointsInput.trim()}
            >
              应用
            </Button>
          </div>
          {pointBalance > 0 && (
            <p className="text-xs text-muted-foreground">
              输入想用的积分，下单时按 100 积分抵 1 元自动折算（最高抵订单一半）。
            </p>
          )}
        </div>
        )}
      </div>

      {error && (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}

      {(voucherCodes.length > 0 || giftCardCodes.length > 0 || pointsToUse > 0) && (
        <div className="flex flex-wrap gap-1.5">
          {features.voucher &&
            voucherCodes.map((code) => (
              <Chip key={`v-${code}`} icon={TicketPercent} label={code} onRemove={() => onRemoveVoucher(code)} disabled={busy} />
            ))}
          {features.gift_card &&
            giftCardCodes.map((code) => (
              <Chip key={`g-${code}`} icon={Tag} label={code} onRemove={() => onRemoveGiftCard(code)} disabled={busy} />
            ))}
          {features.points && pointsToUse > 0 && (
            <Chip
              key="points"
              icon={Tag}
              label={`${pointsToUse} 积分`}
              onRemove={() => onSetPoints(0)}
              disabled={busy}
            />
          )}
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
