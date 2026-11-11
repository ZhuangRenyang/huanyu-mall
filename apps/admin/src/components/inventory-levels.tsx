import { useCallback, useEffect, useMemo, useState } from 'react';
import { Boxes } from 'lucide-react';
import { EmptyState } from '@mall/ui';
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [locs, rows] = await Promise.all([listStockLocations(), listInventoryLevels()]);
      setLocations(locs);
      setLevels(rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : '库存加载失败');
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

  const rows = locationId === 'all' ? levels : levels.filter((l) => l.locationId === locationId);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          可用量由后端下发（在库 − 已预留）。多仓时下单按优先级从高到低分配，同优先级老仓优先。
        </p>
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
                        : 'tabular px-4 py-3 text-right'
                    }
                  >
                    {level.available}
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
