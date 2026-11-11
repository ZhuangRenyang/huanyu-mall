import { useCallback, useEffect, useState } from 'react';
import { Pencil, Plus, Warehouse } from 'lucide-react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  IconButton,
} from '@mall/ui';
import { TextField } from './field';
import { createStockLocation, listStockLocations, updateStockLocation } from '@/lib/admin-api';
import type { StockLocationView } from '@/lib/admin-api';

type EditorState = { mode: 'create' } | { mode: 'edit'; location: StockLocationView };

/** 仓库 tab：新建 / 编辑仓库与优先级（priority 大者优先，同优先级老仓优先）。 */
export function InventoryLocationsTab() {
  const [locations, setLocations] = useState<StockLocationView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setLocations(await listStockLocations());
    } catch (err) {
      setError(err instanceof Error ? err.message : '仓库加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          下单时按优先级从高到低分配库存。<span className="text-foreground">数值越大越优先</span>，同优先级时建得早的仓优先。
        </p>
        <Button onClick={() => setEditor({ mode: 'create' })}>
          <Plus className="size-4" strokeWidth={2} aria-hidden="true" />
          新建仓库
        </Button>
      </div>

      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      {locations.length === 0 && !loading ? (
        <EmptyState icon={Warehouse} title="还没有仓库" description="点「新建仓库」创建第一个" />
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted text-left text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">名称</th>
                <th scope="col" className="px-4 py-3 text-right font-medium">优先级</th>
                <th scope="col" className="px-4 py-3 text-right font-medium">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {locations.map((location) => (
                <tr key={location.id} className="transition-colors duration-150 hover:bg-muted/50">
                  <td className="px-4 py-3 font-medium text-foreground">{location.name}</td>
                  <td className="tabular px-4 py-3 text-right">{location.priority}</td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end">
                      <IconButton
                        aria-label={`编辑仓库 ${location.name}`}
                        size="sm"
                        onClick={() => setEditor({ mode: 'edit', location })}
                      >
                        <Pencil className="size-4" strokeWidth={2} aria-hidden="true" />
                      </IconButton>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editor && (
        <LocationEditor
          location={editor.mode === 'edit' ? editor.location : null}
          onClose={() => setEditor(null)}
          onSaved={async () => {
            setEditor(null);
            await refresh();
          }}
        />
      )}
    </div>
  );
}

function LocationEditor({
  location,
  onClose,
  onSaved,
}: {
  location: StockLocationView | null;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const [name, setName] = useState(location?.name ?? '');
  const [priority, setPriority] = useState(String(location?.priority ?? 0));
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    setError(null);
    if (!name.trim()) {
      setError('请输入仓库名称');
      return;
    }
    const value = Number(priority);
    if (!Number.isInteger(value) || value < 0) {
      setError('优先级必须是非负整数（越大越优先）');
      return;
    }

    setSubmitting(true);
    try {
      if (location) await updateStockLocation(location.id, { name: name.trim(), priority: value });
      else await createStockLocation({ name: name.trim(), priority: value });
      await onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败，请稍后重试');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{location ? '编辑仓库' : '新建仓库'}</DialogTitle>
          <DialogDescription>数值越大越优先；同优先级时老仓优先（保证默认仓不被后建的仓抢走）。</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <TextField
            id="location-name"
            label="仓库名称"
            required
            placeholder="如 主仓 / 华东仓"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <TextField
            id="location-priority"
            label="优先级"
            inputMode="numeric"
            placeholder="默认 0，越大越优先"
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
          />
          <p className="text-xs leading-5 text-muted-foreground">
            例：主仓 10、备用仓 5 —— 下单会先把主仓的可用量扣完再扣备用仓。
          </p>

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
            {submitting ? '保存中…' : '保存'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
