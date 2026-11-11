import { useState } from 'react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@mall/ui';
import { SelectField, TextField } from './field';
import { createTransfer } from '@/lib/admin-api';
import type { StockLocationView } from '@/lib/admin-api';

/**
 * 新建调拨 Dialog。
 *
 * 前端只校验形状（正整数、源 ≠ 目标）；数量够不够由后端在「完成」时裁决，
 * 失败时把后端 message 原样显示出来。
 */
export function TransferEditor({
  materials,
  locations,
  onClose,
  onSaved,
}: {
  materials: { id: string; sku: string }[];
  locations: StockLocationView[];
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const [materialId, setMaterialId] = useState(materials[0]?.id ?? '');
  const [fromId, setFromId] = useState(locations[0]?.id ?? '');
  const [toId, setToId] = useState(locations[1]?.id ?? '');
  const [quantity, setQuantity] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    setError(null);
    const qty = Number(quantity);
    if (!materialId) {
      setError('请选择物料');
      return;
    }
    if (!fromId || !toId) {
      setError('请选择源仓与目标仓');
      return;
    }
    if (fromId === toId) {
      setError('源仓与目标仓不能相同');
      return;
    }
    if (!Number.isInteger(qty) || qty <= 0) {
      setError('数量必须是正整数');
      return;
    }

    setSubmitting(true);
    try {
      await createTransfer({
        inventoryItemId: materialId,
        fromLocationId: fromId,
        toLocationId: toId,
        quantity: qty,
        note,
      });
      await onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败，请稍后重试');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>新建调拨</DialogTitle>
          <DialogDescription>
            登记仓间搬货。数量是否足够由后端在「完成」时裁决：源仓可用量（在库 − 已预留）不足会被拒绝。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <SelectField
            id="transfer-material"
            label="物料（SKU）"
            required
            value={materialId}
            onChange={(e) => setMaterialId(e.target.value)}
            options={materials.map((m) => ({ value: m.id, label: m.sku }))}
          />

          <div className="grid gap-3 sm:grid-cols-2">
            <SelectField
              id="transfer-from"
              label="源仓"
              required
              value={fromId}
              onChange={(e) => setFromId(e.target.value)}
              options={locations.map((l) => ({ value: l.id, label: l.name }))}
            />
            <SelectField
              id="transfer-to"
              label="目标仓"
              required
              value={toId}
              onChange={(e) => setToId(e.target.value)}
              options={locations.map((l) => ({ value: l.id, label: l.name }))}
            />
          </div>

          <TextField
            id="transfer-quantity"
            label="数量（件）"
            required
            inputMode="numeric"
            placeholder="如 5"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
          />

          <TextField
            id="transfer-note"
            label="备注（选填）"
            placeholder="如 双十一前补货"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />

          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            取消
          </Button>
          <Button onClick={() => void submit()} disabled={submitting}>
            {submitting ? '登记中…' : '登记调拨'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
