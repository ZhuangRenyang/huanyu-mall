import { useCallback, useEffect, useMemo, useState } from 'react';
import { Boxes } from 'lucide-react';
import { Badge, EmptyState } from '@mall/ui';
import { SelectField } from './field';
import { listInventoryLevels, listStockLocations } from '@/lib/admin-api';
import type { InventoryLevelView, StockLocationView } from '@/lib/admin-api';

/**
 * 库存 tab：仓 × SKU 的「在库 / 已预留 / 可用」。
 *
 * 可用量直接用后端 `available_quantity`（ADR-013 §5），前端不做 `stocked - reserved`。
 */
export function InventoryLevelsTab() {
  const [locations, setLocations] = useState<StockLocationView[]>([]);
  const [levels, setLevels] = useState<InventoryLevelView[]>([]);
  const [locationId, setLocationId] = useState('all');
  /** 库存预警（ADR-039）：只看可用量 ≤ 阈值的行。阈值由商家定，不写死。 */
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [threshold, setThreshold] = useState('5');
  const thresholdNum = Math.max(0, Math.floor(Number(threshold)) || 0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [locs, rows] = await Promise.all([
        listStockLocations(),
        listInventoryLevels(undefined, lowStockOnly ? thresholdNum : undefined),
      ]);
      setLocations(locs);
      setLevels(rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : '库存加载失败');
    } finally {
      setLoading(false);
    }
  }, [lowStockOnly, thresholdNum]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const locationName = useMemo(() => {
    const map = new Map(locations.map((l) => [l.id, l.name]));
    return (id: string) => map.get(id) ?? id;
  }, [locations]);

  const rows = locationId === 'all' ? levels : levels.filter((l) => l.locationId === locationId);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          可用量由后端下发（在库 − 已预留）。多仓时下单按优先级从高到低分配，同优先级老仓优先。
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex items-center gap-2 pb-2 text-sm text-foreground">
            <input
              type="checkbox"
              checked={lowStockOnly}
              onChange={(e) => setLowStockOnly(e.target.checked)}
              className="size-4 accent-primary"
            />
            只看低库存
          </label>
          <label className="text-sm text-foreground">
            <span className="mb-1 block text-xs text-muted-foreground">低库存阈值</span>
            <input
              type="number"
              min="0"
              step="1"
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
              className="tabular h-9 w-24 rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-ring"
              aria-label="低库存阈值"
            />
          </label>
          <div className="w-48">
            <SelectField
              id="inventory-location-filter"
              label="仓库"
              value={locationId}
              onChange={(e) => setLocationId(e.target.value)}
              options={[{ value: 'all', label: '全部仓库' }, ...locations.map((l) => ({ value: l.id, label: l.name }))]}
            />
          </div>
        </div>
      </div>

      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      {rows.length === 0 && !loading ? (
        <EmptyState icon={Boxes} title="没有库存行" description="该仓库还没有登记任何 SKU 库存" />
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted text-left text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">仓库</th>
                <th scope="col" className="px-4 py-3 font-medium">SKU</th>
                <th scope="col" className="px-4 py-3 text-right font-medium">在库</th>
                <th scope="col" className="px-4 py-3 text-right font-medium">已预留</th>
                <th scope="col" className="px-4 py-3 text-right font-medium">可用</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((level) => (
                <tr key={level.id} className="transition-colors duration-150 hover:bg-muted/50">
                  <td className="px-4 py-3 text-foreground">{locationName(level.locationId)}</td>
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{level.sku}</td>
                  <td className="tabular px-4 py-3 text-right">{level.stocked}</td>
                  <td className="tabular px-4 py-3 text-right">{level.reserved}</td>
                  <td
                    className={
                      level.available === 0
                        ? 'tabular px-4 py-3 text-right text-muted-foreground'
                        : level.available <= thresholdNum
                          ? 'tabular px-4 py-3 text-right font-medium text-destructive'
                          : 'tabular px-4 py-3 text-right'
                    }
                  >
                    {level.available}
                    {level.available > 0 && level.available <= thresholdNum && (
                      <Badge variant="destructive" className="ml-2">
                        偏低
                      </Badge>
                    )}
                    {level.available === 0 && (
                      <Badge variant="neutral" className="ml-2">
                        无货
                      </Badge>
                    )}
                    {/*
                      有多少人在等到货（ADR-059）：缺货且有 20 人等，和缺货但没人等，
                      补货优先级完全不同。只在有人等的时候显示，不给正常行添噪音。
                    */}
                    {(level.stockAlertCount ?? 0) > 0 && (
                      <Badge variant="warning" className="ml-2">
                        {level.stockAlertCount ?? 0} 人等货
                      </Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-muted-foreground">共 {rows.length} 行</p>
    </div>
  );
}
