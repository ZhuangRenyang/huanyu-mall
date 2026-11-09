import { useEffect, useState } from 'react';
import { Badge, Button } from '@mall/ui';
import { getProviders, saveProviders } from '@/lib/admin-api';
import { DEFAULT_PROVIDERS, type ProviderConfig } from '@/lib/admin-data';

/** 支付 Provider 配置：四家各一行，填密钥 + 按 Channel 启用开关，密钥掩码显示。 */
export function PaymentSettings() {
  const [providers, setProviders] = useState<ProviderConfig[]>(DEFAULT_PROVIDERS);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void getProviders().then(setProviders);
  }, []);

  const update = (id: string, patch: Partial<ProviderConfig>) => {
    setProviders((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
    setSaved(false);
  };
  const save = async () => {
    await saveProviders(providers);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="max-w-2xl space-y-3">
      <p className="text-sm text-muted-foreground">填写密钥并启用后对该 Channel 生效；密钥加密存储，界面掩码显示。</p>

      {providers.map((p) => (
        <div key={p.id} className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-foreground">{p.label}</span>
              {p.enabled && <Badge variant="success">已启用</Badge>}
            </div>
            <label className="inline-flex items-center gap-2 text-sm text-muted-foreground">
              <input
                type="checkbox"
                checked={p.enabled}
                onChange={(e) => update(p.id, { enabled: e.target.checked })}
                className="size-4 accent-primary"
              />
              启用
            </label>
          </div>
          <div className="mt-3">
            <label htmlFor={`key-${p.id}`} className="mb-1 block text-xs font-medium text-muted-foreground">
              密钥
            </label>
            <input
              id={`key-${p.id}`}
              type="password"
              autoComplete="off"
              value={p.secretKey}
              onChange={(e) => update(p.id, { secretKey: e.target.value })}
              placeholder="•••••••• 填写后保存"
              className="h-9 w-full rounded-md border border-input bg-background px-3 font-mono text-sm text-foreground outline-none transition-colors duration-150 placeholder:text-muted-foreground focus:border-ring"
            />
          </div>
        </div>
      ))}

      <div className="flex items-center gap-2 pt-2">
        <Button onClick={save}>保存支付配置</Button>
        {saved && (
          <span className="text-xs text-success" role="status">
            已保存
          </span>
        )}
      </div>
    </div>
  );
}
