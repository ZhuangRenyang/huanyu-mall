import { useCallback, useEffect, useState } from 'react';
import { Badge, Button, Switch } from '@mall/ui';
import { SelectField, TextField } from '../components/field';
import {
  createOption,
  createProfile,
  createZone,
  deleteOption,
  deleteProfile,
  deleteZone,
  getShippingConfig,
  minorToYuan,
  updateOption,
  updateProfile,
  updateZone,
  yuanToMinor,
  type ShippingConfigView,
  type ShippingOptionView,
  type ShippingZoneView,
} from '@/lib/admin-shipping';

/**
 * 运费模板（ADR-021）。
 *
 * 淘宝的模型：**商品上架时选运费模板**（或标「卖家包邮」），模板里配发货区与价格。
 * 所以这个页面属于「商品」域，不是系统设置——它决定的是商品怎么卖，不是系统怎么跑。
 *
 * 一个模板 = 一组发货区（按国家）+ 每个区的运费方式。
 * 同一个国家可以出现在不同模板里（默认模板发中国 8 元、重货模板 30 元），
 * 但**同一模板内**一个国家只能属于一个区，否则结账会同时命中两套价。
 */
export function ShippingProfilesPage() {
  const [config, setConfig] = useState<ShippingConfigView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');

  const reload = useCallback(async (preferId?: string) => {
    try {
      const next = await getShippingConfig();
      setConfig(next);
      setActiveId((prev) => {
        const want = preferId ?? prev;
        if (want && next.profiles.some((p) => p.id === want)) return want;
        return next.profiles[0]?.id ?? null;
      });
    } catch {
      setConfig(null);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败');
    } finally {
      setBusy(false);
    }
  };

  if (!config) return <p className="text-sm text-muted-foreground">正在读取运费模板…</p>;

  const active = config.profiles.find((p) => p.id === activeId) ?? config.profiles[0] ?? null;
  const zones = active ? config.zones.filter((z) => z.profileId === active.id) : [];

  /**
   * 国家占用表只在**同一模板内**成立：跨模板重复是允许的（正是多模板的意义）。
   */
  const takenCountries = new Map<string, string>();
  for (const zone of zones) {
    for (const code of zone.countryCodes) takenCountries.set(code, zone.name);
  }

  return (
    <div className="max-w-4xl space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-foreground">运费模板</h1>
        <p className="mt-1 max-w-2xl text-xs leading-5 text-muted-foreground">
          商品上架时选一个模板（或标「卖家包邮」）。结账按收货国家自动算运费，顾客不用选。
          重货、冷链这类需要单独计价的商品，给它单独建一个模板即可。
        </p>
      </div>

      {config.profiles.length === 0 ? (
        <section className="rounded-lg border border-border bg-card p-4">
          <p className="text-sm text-warning" role="status">
            还没有运费模板：顾客暂时无法下单。先新建一个模板，再把要卖的国家放进去。
          </p>
        </section>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {config.profiles.map((profile) => (
            <button
              key={profile.id}
              type="button"
              onClick={() => setActiveId(profile.id)}
              className={`rounded-md border px-3 py-1.5 text-sm transition-colors ${
                active?.id === profile.id
                  ? 'border-primary bg-primary/5 text-foreground'
                  : 'border-border text-muted-foreground hover:text-foreground'
              }`}
            >
              {profile.name}
              {profile.isDefault && (
                <span className="ml-1.5 text-[11px] text-muted-foreground">默认</span>
              )}
            </button>
          ))}
          {creating ? (
            <span className="flex items-center gap-1">
              <input
                aria-label="新模板名称"
                className="h-8 w-40 rounded-md border border-input bg-background px-2 text-sm text-foreground"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="如：重货专线"
              />
              <Button
                size="sm"
                disabled={busy || newName.trim() === ''}
                onClick={() =>
                  void run(async () => {
                    await createProfile(newName.trim());
                    setNewName('');
                    setCreating(false);
                  })
                }
              >
                创建
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setCreating(false)}>
                取消
              </Button>
            </span>
          ) : (
            <Button variant="secondary" size="sm" onClick={() => setCreating(true)}>
              新建模板
            </Button>
          )}
        </div>
      )}

      {active && (
        <>
          <ProfileHeader
            profile={active}
            busy={busy}
            onRun={run}
            zoneCount={zones.length}
          />

          {zones.map((zone) => (
            <ZoneCard
              key={zone.id}
              zone={zone}
              countries={config.countries}
              takenCountries={takenCountries}
              busy={busy}
              onRun={run}
            />
          ))}

          <NewZoneCard
            profileId={active.id}
            countries={config.countries}
            takenCountries={takenCountries}
            busy={busy}
            onRun={run}
          />
        </>
      )}

      {error && (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}

      <p className="text-xs leading-5 text-muted-foreground">
        <Badge variant="neutral">说明</Badge>{' '}
        同一模板内一个国家只能在一个区；区内有多个运费方式时取
        <strong className="font-medium text-foreground">最便宜</strong>
        的那个（满额包邮达标即为 0）。包邮商品不产生运费，金额也不计入满额门槛。
      </p>
    </div>
  );
}

/** 模板名可改；默认模板不可删，其它模板下有区时也不可删。 */
function ProfileHeader({
  profile,
  zoneCount,
  busy,
  onRun,
}: {
  profile: { id: string; name: string; isDefault: boolean };
  zoneCount: number;
  busy: boolean;
  onRun: (fn: () => Promise<void>) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(profile.name);

  if (editing) {
    return (
      <section className="flex flex-wrap items-end gap-2 rounded-lg border border-border bg-card p-4">
        <TextField
          id={`profile-name-${profile.id}`}
          label="模板名称"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="max-w-xs"
        />
        <Button
          size="sm"
          disabled={busy || name.trim() === ''}
          onClick={() =>
            void onRun(async () => {
              await updateProfile(profile.id, name.trim());
              setEditing(false);
            })
          }
        >
          保存
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
          取消
        </Button>
      </section>
    );
  }

  return (
    <section className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card px-4 py-3">
      <div>
        <h2 className="text-sm font-semibold text-foreground">
          {profile.name}
          {profile.isDefault && (
            <span className="ml-2 text-[11px] font-normal text-muted-foreground">
              商品未指定模板时用它
            </span>
          )}
        </h2>
        <p className="mt-0.5 text-xs text-muted-foreground">{zoneCount} 个发货区</p>
      </div>
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setName(profile.name);
            setEditing(true);
          }}
        >
          重命名
        </Button>
        {!profile.isDefault && (
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive"
            disabled={busy}
            onClick={() => void onRun(() => deleteProfile(profile.id))}
          >
            删除模板
          </Button>
        )}
      </div>
    </section>
  );
}

function ZoneCard({
  zone,
  countries,
  takenCountries,
  busy,
  onRun,
}: {
  zone: ShippingZoneView;
  countries: { code: string; name: string }[];
  takenCountries: Map<string, string>;
  busy: boolean;
  onRun: (fn: () => Promise<void>) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(zone.name);
  const [codes, setCodes] = useState<string[]>(zone.countryCodes);
  const [adding, setAdding] = useState(false);

  const nameOf = (code: string) => countries.find((c) => c.code === code)?.name ?? code;

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      {editing ? (
        <div className="space-y-3">
          <TextField
            id={`zone-name-${zone.id}`}
            label="发货区名称"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="如：中国大陆 / 北美"
          />
          <CountryPicker
            idPrefix={`zone-${zone.id}`}
            countries={countries}
            selected={codes}
            takenCountries={takenCountries}
            selfName={zone.name}
            onToggle={(code) =>
              setCodes((prev) => (prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]))
            }
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              disabled={busy || name.trim() === '' || codes.length === 0}
              onClick={() =>
                void onRun(async () => {
                  await updateZone(zone.id, { name: name.trim(), countryCodes: codes });
                  setEditing(false);
                })
              }
            >
              保存
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
              取消
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-foreground">{zone.name}</h3>
            <div className="mt-1 flex flex-wrap gap-1">
              {zone.countryCodes.map((code) => (
                <Badge key={code} variant="neutral">
                  {nameOf(code)}
                </Badge>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setName(zone.name);
                setCodes(zone.countryCodes);
                setEditing(true);
              }}
            >
              编辑
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive"
              disabled={busy}
              onClick={() => void onRun(() => deleteZone(zone.id))}
            >
              删除
            </Button>
          </div>
        </div>
      )}

      <div className="mt-4 space-y-2 border-t border-border pt-3">
        {zone.options.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            这个区还没有运费方式，顾客结算到这些国家会算不出运费。
          </p>
        ) : (
          zone.options.map((option) => (
            <OptionRow key={option.id} option={option} busy={busy} onRun={onRun} />
          ))
        )}

        {adding ? (
          <NewOptionForm
            zoneId={zone.id}
            busy={busy}
            onCancel={() => setAdding(false)}
            onSubmit={async (input) => {
              await onRun(async () => {
                await createOption({ zoneId: zone.id, ...input });
                setAdding(false);
              });
            }}
          />
        ) : (
          <Button variant="secondary" size="sm" onClick={() => setAdding(true)}>
            添加运费方式
          </Button>
        )}
      </div>
    </section>
  );
}

function OptionRow({
  option,
  busy,
  onRun,
}: {
  option: ShippingOptionView;
  busy: boolean;
  onRun: (fn: () => Promise<void>) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(option.name);
  const [type, setType] = useState<'flat' | 'free_over'>(option.type);
  const [amount, setAmount] = useState(minorToYuan(option.amountMinor));
  const [threshold, setThreshold] = useState(
    option.freeOverThresholdMinor === null ? '' : minorToYuan(option.freeOverThresholdMinor),
  );

  const amountMinor = yuanToMinor(amount);
  const thresholdMinor = threshold.trim() === '' ? null : yuanToMinor(threshold);
  const valid =
    name.trim() !== '' &&
    !Number.isNaN(amountMinor) &&
    amountMinor >= 0 &&
    (type === 'flat' || (thresholdMinor !== null && !Number.isNaN(thresholdMinor) && thresholdMinor > 0));

  if (editing) {
    return (
      <div className="space-y-2 rounded-md border border-border p-3">
        <div className="grid gap-2 sm:grid-cols-2">
          <TextField
            id={`opt-name-${option.id}`}
            label="名称（结账时顾客能看到）"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="标准快递"
          />
          <SelectField
            id={`opt-type-${option.id}`}
            label="计费方式"
            value={type}
            onChange={(e) => setType(e.target.value as 'flat' | 'free_over')}
            options={[
              { value: 'flat', label: '固定运费' },
              { value: 'free_over', label: '满额包邮' },
            ]}
          />
          <TextField
            id={`opt-amount-${option.id}`}
            label={`运费（${option.currencyCode === 'CNY' ? '元' : option.currencyCode}）`}
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="8"
            className={Number.isNaN(amountMinor) ? 'border-destructive' : ''}
          />
          {type === 'free_over' && (
            <TextField
              id={`opt-threshold-${option.id}`}
              label="满多少免运费（元）"
              inputMode="decimal"
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
              placeholder="99"
            />
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            disabled={busy || !valid}
            onClick={() =>
              void onRun(async () => {
                await updateOption(option.id, {
                  name: name.trim(),
                  type,
                  amountMinor,
                  freeOverThresholdMinor: type === 'free_over' ? thresholdMinor : null,
                });
                setEditing(false);
              })
            }
          >
            保存
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
            取消
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-foreground">{option.name}</span>
          <Badge variant="neutral">{option.type === 'free_over' ? '满额包邮' : '固定运费'}</Badge>
          {!option.isActive && <Badge variant="neutral">已停用</Badge>}
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {option.type === 'free_over'
            ? `不满 ${option.freeOverThresholdMinor === null ? '—' : `${minorToYuan(option.freeOverThresholdMinor)} 元`} 收 ${minorToYuan(option.amountMinor)} 元，达标免运费`
            : `每单 ${minorToYuan(option.amountMinor)} 元`}
          {option.carrier ? ` · ${option.carrier}` : ''}
        </p>
      </div>
      <div className="flex items-center gap-1">
        <Switch
          checked={option.isActive}
          onCheckedChange={(next) => void onRun(() => updateOption(option.id, { isActive: next }))}
          disabled={busy}
          aria-label={`${option.name}${option.isActive ? '停用' : '启用'}`}
        />
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setName(option.name);
            setType(option.type);
            setAmount(minorToYuan(option.amountMinor));
            setThreshold(
              option.freeOverThresholdMinor === null ? '' : minorToYuan(option.freeOverThresholdMinor),
            );
            setEditing(true);
          }}
        >
          编辑
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="text-destructive"
          disabled={busy}
          onClick={() => void onRun(() => deleteOption(option.id))}
        >
          删除
        </Button>
      </div>
    </div>
  );
}

function NewOptionForm({
  zoneId,
  busy,
  onCancel,
  onSubmit,
}: {
  zoneId: string;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (input: {
    name: string;
    carrier: string | null;
    type: 'flat' | 'free_over';
    amountMinor: number;
    freeOverThresholdMinor: number | null;
  }) => Promise<void>;
}) {
  const [name, setName] = useState('标准快递');
  const [type, setType] = useState<'flat' | 'free_over'>('flat');
  const [amount, setAmount] = useState('8');
  const [threshold, setThreshold] = useState('99');

  const amountMinor = yuanToMinor(amount);
  const thresholdMinor = type === 'free_over' ? yuanToMinor(threshold) : null;
  const valid =
    name.trim() !== '' &&
    !Number.isNaN(amountMinor) &&
    amountMinor >= 0 &&
    (thresholdMinor === null || (!Number.isNaN(thresholdMinor) && thresholdMinor > 0));

  return (
    <div className="space-y-2 rounded-md border border-dashed border-border p-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <TextField
          id={`new-opt-name-${zoneId}`}
          label="名称（结账时顾客能看到）"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="标准快递"
        />
        <SelectField
          id={`new-opt-type-${zoneId}`}
          label="计费方式"
          value={type}
          onChange={(e) => setType(e.target.value as 'flat' | 'free_over')}
          options={[
            { value: 'flat', label: '固定运费' },
            { value: 'free_over', label: '满额包邮' },
          ]}
        />
        <TextField
          id={`new-opt-amount-${zoneId}`}
          label="运费（元）"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="8"
        />
        {type === 'free_over' && (
          <TextField
            id={`new-opt-threshold-${zoneId}`}
            label="满多少免运费（元）"
            inputMode="decimal"
            value={threshold}
            onChange={(e) => setThreshold(e.target.value)}
            placeholder="99"
          />
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        固定运费填 0 就是全场包邮；满额包邮需要填门槛，门槛必须大于 0。
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          disabled={busy || !valid}
          onClick={() =>
            void onSubmit({
              name: name.trim(),
              carrier: null,
              type,
              amountMinor,
              freeOverThresholdMinor: thresholdMinor,
            })
          }
        >
          添加
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          取消
        </Button>
      </div>
    </div>
  );
}

function NewZoneCard({
  profileId,
  countries,
  takenCountries,
  busy,
  onRun,
}: {
  profileId: string;
  countries: { code: string; name: string }[];
  takenCountries: Map<string, string>;
  busy: boolean;
  onRun: (fn: () => Promise<void>) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [codes, setCodes] = useState<string[]>([]);

  if (!open) {
    return (
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        新增发货区
      </Button>
    );
  }

  return (
    <section className="space-y-3 rounded-lg border border-dashed border-border bg-card p-4">
      <TextField
        id="new-zone-name"
        label="发货区名称"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="如：中国大陆 / 北美 / 东南亚"
      />
      <CountryPicker
        idPrefix="new-zone"
        countries={countries}
        selected={codes}
        takenCountries={takenCountries}
        selfName={null}
        onToggle={(code) =>
          setCodes((prev) => (prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]))
        }
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          disabled={busy || name.trim() === '' || codes.length === 0}
          onClick={() =>
            void onRun(async () => {
              await createZone(name.trim(), codes, profileId);
              setName('');
              setCodes([]);
              setOpen(false);
            })
          }
        >
          创建
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
          取消
        </Button>
      </div>
    </section>
  );
}

/** 国家多选：同一模板内已被其它区占用的置灰。 */
function CountryPicker({
  idPrefix,
  countries,
  selected,
  takenCountries,
  selfName,
  onToggle,
}: {
  idPrefix: string;
  countries: { code: string; name: string }[];
  selected: string[];
  takenCountries: Map<string, string>;
  /** 正在编辑的区自己：它占用的国家不算冲突。 */
  selfName: string | null;
  onToggle: (code: string) => void;
}) {
  if (countries.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        暂无可选国家。请先确认系统已加载国家清单。
      </p>
    );
  }
  return (
    <div>
      <p className="mb-1 text-xs font-medium text-foreground">覆盖的国家/地区</p>
      <div className="grid max-h-56 grid-cols-2 gap-1 overflow-y-auto rounded-md border border-border p-2 sm:grid-cols-3">
        {countries.map((country) => {
          const owner = takenCountries.get(country.code);
          const takenByOther = owner !== undefined && owner !== selfName;
          const checked = selected.includes(country.code);
          return (
            <label
              key={country.code}
              className={`flex items-center gap-2 rounded px-1.5 py-1 text-xs ${
                takenByOther ? 'text-muted-foreground' : 'text-foreground'
              }`}
            >
              <input
                id={`${idPrefix}-${country.code}`}
                type="checkbox"
                className="size-3.5 accent-primary"
                checked={checked}
                disabled={takenByOther}
                onChange={() => onToggle(country.code)}
              />
              <span className="truncate">
                {country.name}
                {takenByOther && <span className="ml-1 opacity-70">（已在「{owner}」）</span>}
              </span>
            </label>
          );
        })}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        已选 {selected.length} 个；同一模板内一个国家只能属于一个区。
      </p>
    </div>
  );
}
