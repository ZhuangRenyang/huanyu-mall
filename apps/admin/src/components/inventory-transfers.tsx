import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowRightLeft, Plus } from 'lucide-react';
import { Badge, Button, EmptyState } from '@mall/ui';
import { TransferEditor } from './inventory-transfer-editor';
import {
  cancelTransfer,
  completeTransfer,
  listInventoryLevels,
  listStockLocations,
  listTransfers,
} from '@/lib/admin-api';
import type { InventoryLevelView, StockLocationView, TransferStatus, TransferView } from '@/lib/admin-api';

const STATUS_META: Record<TransferStatus, { label: string; variant: 'warning' | 'success' | 'neutral' }> = {
  pending: { label: '待处理', variant: 'warning' },
  completed: { label: '已完成', variant: 'success' },
  cancelled: { label: '已取消', variant: 'neutral' },
};

function timeText(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('zh-CN', { hour12: false });
}

/** 调拨 tab：登记仓间搬货；数量是否够由后端裁决，前端只校验形状（正整数、源 ≠ 目标）。 */
export function InventoryTransfersTab() {
  const [transfers, setTransfers] = useState<TransferView[]>([]);
  const [locations, setLocations] = useState<StockLocationView[]>([]);
  const [levels, setLevels] = useState<InventoryLevelView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);

  const flash = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2200);
  };

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [rows, locs, lvls] = await Promise.all([
        listTransfers(),
        listStockLocations(),
        listInventoryLevels(),
      ]);
      setTransfers(rows);
      setLocations(locs);
      setLevels(lvls);
    } catch (err) {
      setError(err instanceof Error ? err.message : '调拨单加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const locationName = useMemo(() => {
    const map = new Map(locations.map((l) => [l.id, l.name]));
    return (id: string) => map.get(id) ?? id;
  }, [locations]);

  /** 可选物料：从库存行去重出 inventory_item_id + sku。 */
  const materials = useMemo(() => {
    const map = new Map<string, { id: string; sku: string }>();
    for (const level of levels) {
      if (!map.has(level.inventoryItemId)) map.set(level.inventoryItemId, { id: level.inventoryItemId, sku: level.sku });
    }
    return [...map.values()];
  }, [levels]);

  const run = async (action: () => Promise<void>, okText: string) => {
    setError(null);
    try {
      await action();
      flash(okText);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败');
    }
  };

  const complete = (t: TransferView) => {
    const msg = `确认完成调拨？将把 ${t.quantity} 件 ${t.sku} 从「${locationName(t.fromLocationId)}」搬到「${locationName(t.toLocationId)}」。`;
    if (!window.confirm(msg)) return;
    void run(() => completeTransfer(t.id), '调拨已完成');
  };

  const cancel = (t: TransferView) => {
    if (!window.confirm('确认取消该调拨单？取消后不会搬动任何库存。')) return;
    void run(() => cancelTransfer(t.id), '调拨已取消');
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          调拨单登记后为「待处理」，完成时才真正搬货（源仓在库 −、目标仓在库 +，已预留不动）。
        </p>
        <Button onClick={() => setEditorOpen(true)}>
          <Plus className="size-4" strokeWidth={2} aria-hidden="true" />
          新建调拨
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
        {toast && (
          <p className="text-sm text-success" role="status">
            {toast}
          </p>
        )}
      </div>

      {transfers.length === 0 && !loading ? (
        <EmptyState icon={ArrowRightLeft} title="还没有调拨单" description="点「新建调拨」发起第一笔仓间搬货" />
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted text-left text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">时间</th>
                <th scope="col" className="px-4 py-3 font-medium">SKU</th>
                <th scope="col" className="px-4 py-3 font-medium">源仓 → 目标仓</th>
                <th scope="col" className="px-4 py-3 text-right font-medium">数量</th>
                <th scope="col" className="px-4 py-3 font-medium">状态</th>
                <th scope="col" className="px-4 py-3 text-right font-medium">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {transfers.map((t) => {
                const meta = STATUS_META[t.status];
                return (
                  <tr key={t.id} className="transition-colors duration-150 hover:bg-muted/50">
                    <td className="px-4 py-3 text-xs text-muted-foreground">{timeText(t.createdAt)}</td>
                    <td className="px-4 py-3 font-mono text-xs text-foreground">
                      {t.sku}
                      {t.note && <span className="ml-2 font-sans text-muted-foreground">{t.note}</span>}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {locationName(t.fromLocationId)} → {locationName(t.toLocationId)}
                    </td>
                    <td className="tabular px-4 py-3 text-right">{t.quantity}</td>
                    <td className="px-4 py-3">
                      <Badge variant={meta.variant}>{meta.label}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      {t.status === 'pending' ? (
                        <div className="flex justify-end gap-1">
                          <Button size="sm" variant="secondary" onClick={() => complete(t)}>
                            完成
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => cancel(t)}>
                            取消
                          </Button>
                        </div>
                      ) : (
                        <p className="text-right text-xs text-muted-foreground">—</p>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {editorOpen && (
        <TransferEditor
          materials={materials}
          locations={locations}
          onClose={() => setEditorOpen(false)}
          onSaved={async () => {
            setEditorOpen(false);
            flash('调拨单已登记');
            await refresh();
          }}
        />
      )}
    </div>
  );
}
