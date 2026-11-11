import { useEffect, useState } from 'react';
import { Badge, Button, Switch } from '@mall/ui';
import { TextField, SelectField } from './field';
import {
  bpsToPercent,
  deleteCountryRate,
  getTaxConfig,
  percentToBps,
  setCountryRate,
  setDefaultRate,
  updateTaxSettings,
  type TaxConfigView,
} from '@/lib/admin-tax';

interface CountryRow {
  /** 编辑中的国家码（大写两位）。 */
  code: string;
  name: string;
  /** 百分比，展示/编辑用。 */
  percent: string;
  /** 已保存的原始码，用于识别删除。 */
  persistedCode: string | null;
}

/**
 * 税务设置（ADR-018）。
 *
 * 用户口径：没有固定税区，税率看顾客选的国家，后台可切换可调整。
 * 所以是「总开关 + 默认税率 + 国家覆盖表」三段。
 * 税率输入用百分比（如 13），内部换算成万分比（1300）——商家不该看到 bps。
 */
export function TaxSettings() {
  const [config, setConfig] = useState<TaxConfigView | null>(null);
  const [defaultPercent, setDefaultPercent] = useState('');
  const [rows, setRows] = useState<CountryRow[]>([]);
  const [removed, setRemoved] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void getTaxConfig()
      .then((c) => {
        setConfig(c);
        setDefaultPercent(c.defaultRate ? String(bpsToPercent(c.defaultRate.rateBps)) : '');
        setRows(
          c.countryRates.map((r) => ({
            code: r.countryCode ?? '',
            name: r.name,
            percent: String(bpsToPercent(r.rateBps)),
            persistedCode: r.countryCode,
          })),
        );
      })
      .catch(() => setConfig(null));
  }, []);

  if (!config) return <p className="text-sm text-muted-foreground">正在读取税务设置…</p>;

  const patchSettings = (next: Partial<TaxConfigView['settings']>) => {
    setConfig((prev) => (prev ? { ...prev, settings: { ...prev.settings, ...next } } : prev));
    setSaved(false);
  };

  const setRow = (idx: number, patch: Partial<CountryRow>) => {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
    setSaved(false);
  };

  const removeRow = (idx: number) => {
    const row = rows[idx]!;
    if (row.persistedCode) setRemoved((prev) => [...prev, row.persistedCode!]);
    setRows((prev) => prev.filter((_, i) => i !== idx));
    setSaved(false);
  };

  const addRow = () => {
    setRows((prev) => [...prev, { code: '', name: '', percent: '', persistedCode: null }]);
    setSaved(false);
  };

  const save = async () => {
    if (!config) return;
    setSaving(true);
    setError(null);
    try {
      await updateTaxSettings(config.settings);
      if (defaultPercent.trim() !== '') {
        await setDefaultRate(config.settings.taxName || '默认税率', percentToBps(Number(defaultPercent)));
      }
      for (const row of rows) {
        if (row.code.trim().length !== 2) {
          setError('国家/地区码必须是两位字母（如 CN / US）');
          setSaving(false);
          return;
        }
        await setCountryRate(
          row.code.trim().toUpperCase(),
          row.name || '地区税率',
          percentToBps(Number(row.percent)),
        );
      }
      for (const code of removed) await deleteCountryRate(code);
      setRemoved([]);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2200);
      // 重新拉一份，把 persistedCode 对齐
      const fresh = await getTaxConfig();
      setRows(
        fresh.countryRates.map((r) => ({
          code: r.countryCode ?? '',
          name: r.name,
          percent: String(bpsToPercent(r.rateBps)),
          persistedCode: r.countryCode,
        })),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const percentValid = (v: string) => v === '' || (!Number.isNaN(Number(v)) && Number(v) >= 0 && Number(v) <= 100);

  return (
    <div className="max-w-3xl space-y-4">
      <section className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-border bg-card p-4">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-foreground">计税</h2>
          <p className="mt-1 max-w-xl text-xs leading-5 text-muted-foreground">
            税率跟着顾客收货的国家走：有该国家的单独税率就用它，没有就用默认税率。
            关闭时不收任何税。
          </p>
          {!config.settings.enabled && (
            <p className="mt-1 text-xs text-warning" role="status">
              当前关闭：订单不显示税，也不收税。
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{config.settings.enabled ? '开启' : '关闭'}</span>
          <Switch
            checked={config.settings.enabled}
            onCheckedChange={(next) => patchSettings({ enabled: next })}
            aria-label={`计税${config.settings.enabled ? '关闭' : '开启'}`}
          />
        </div>
      </section>

      <section className="rounded-lg border border-border bg-card p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField
            id="tax-name"
            label="税名（订单上显示的名字）"
            value={config.settings.taxName}
            onChange={(e) => patchSettings({ taxName: e.target.value })}
            placeholder="如：增值税 / VAT / GST"
          />
          <SelectField
            id="tax-inclusive"
            label="价格是否含税"
            value={config.settings.pricesIncludeTax ? 'inclusive' : 'exclusive'}
            onChange={(e) => patchSettings({ pricesIncludeTax: e.target.value === 'inclusive' })}
            options={[
              { value: 'inclusive', label: '价格已含税（合计不再加）' },
              { value: 'exclusive', label: '价外税（结账时另加）' },
            ]}
          />
          <TextField
            id="tax-default"
            label="默认税率（%，没有单独设置的地区用它）"
            inputMode="decimal"
            value={defaultPercent}
            onChange={(e) => setDefaultPercent(e.target.value)}
            placeholder="0"
            className={percentValid(defaultPercent) ? '' : 'border-destructive'}
          />
        </div>
      </section>

      <section className="rounded-lg border border-border bg-card p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-foreground">地区税率</h3>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              给特定国家/地区单独设税率，覆盖默认税率。
            </p>
          </div>
          <Button variant="secondary" size="sm" onClick={addRow}>
            添加地区
          </Button>
        </div>

        {rows.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">还没有地区税率，全部走默认。</p>
        ) : (
          <div className="mt-3 space-y-2">
            {rows.map((row, idx) => (
              <div key={idx} className="flex flex-wrap items-end gap-2">
                <TextField
                  id={`tax-country-${idx}`}
                  label="国家/地区码"
                  value={row.code}
                  onChange={(e) => setRow(idx, { code: e.target.value.toUpperCase() })}
                  placeholder="CN"
                  className="w-24"
                />
                <TextField
                  id={`tax-country-name-${idx}`}
                  label="名称"
                  value={row.name}
                  onChange={(e) => setRow(idx, { name: e.target.value })}
                  placeholder="如：美国"
                  className="min-w-32"
                />
                <TextField
                  id={`tax-country-rate-${idx}`}
                  label="税率 %"
                  inputMode="decimal"
                  value={row.percent}
                  onChange={(e) => setRow(idx, { percent: e.target.value })}
                  placeholder="0"
                  className="w-24"
                />
                <Button variant="ghost" size="sm" className="mb-0.5" onClick={() => removeRow(idx)}>
                  删除
                </Button>
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => void save()} disabled={saving}>
          {saving ? '保存中…' : '保存税务设置'}
        </Button>
        {saved && (
          <span className="text-xs text-success" role="status">
            已保存
          </span>
        )}
        {error && (
          <span className="text-xs text-destructive" role="alert">
            {error}
          </span>
        )}
      </div>

      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <Badge variant="neutral">提示</Badge>
        税率按订单创建时的设置快照，之后调整税率不影响历史订单。
      </p>
    </div>
  );
}
