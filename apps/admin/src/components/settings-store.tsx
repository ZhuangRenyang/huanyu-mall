import { useEffect, useState } from 'react';
import { Button, Skeleton } from '@mall/ui';
import { TextAreaField, TextField } from './field';
import { getStoreProfile, saveStoreProfile } from '@/lib/admin-store-profile';

/**
 * 店铺资料（ADR-045）：店铺名称 + 客服电话。
 *
 * 店名之前写死在店头与页脚、发货单干脆没有 —— 三处各说各话。
 * 现在它是设置里的一条数据，改一次三处同步。
 *
 * 独立分组而不是塞进「外观」：店名不是配色变量，它是顾客看到的第一句话。
 */
export function StoreProfileSettings() {
  const [storeName, setStoreName] = useState('');
  const [supportPhone, setSupportPhone] = useState('');
  const [returnAddress, setReturnAddress] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void getStoreProfile()
      .then((p) => {
        setStoreName(p.storeName);
        setSupportPhone(p.supportPhone ?? '');
        setReturnAddress(p.returnAddress ?? '');
      })
      .catch(() => setError('读取店铺资料失败'))
      .finally(() => setLoading(false));
  }, []);

  const submit = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await saveStoreProfile({ storeName, supportPhone, returnAddress });
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Skeleton className="h-40 w-full" />;

  return (
    <section className="max-w-xl space-y-4" aria-label="店铺资料">
      <div>
        <h2 className="text-sm font-semibold text-foreground">店铺资料</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          店铺名称显示在店头、页脚与发货单上；客服电话会印在发货单与页脚，留空则不显示。
          退货地址只有同意退货的顾客能看到，用来把货寄回来。
        </p>
      </div>

      <TextField
        id="store-name"
        label="店铺名称"
        required
        value={storeName}
        maxLength={40}
        onChange={(e) => setStoreName(e.target.value)}
        placeholder="如：全球商城"
      />

      <TextField
        id="store-support-phone"
        label="客服电话"
        value={supportPhone}
        maxLength={30}
        onChange={(e) => setSupportPhone(e.target.value)}
        placeholder="选填，如：400-800-1234"
      />

      {/* 退货地址：淘宝在「物流工具 → 地址库」维护，我们放在店铺资料里一处配好（ADR-053） */}
      <TextAreaField
        id="store-return-address"
        label="退货地址"
        hint="选填。三行写清收件人 / 手机号 / 详细地址；同意退货时顾客会看到这段。留空则提示顾客联系客服。"
        rows={4}
        value={returnAddress}
        maxLength={300}
        onChange={(e) => setReturnAddress(e.target.value)}
        placeholder={'收件人：张三\n电话：13800000000\n地址：广东省深圳市南山区科苑路 15 号 3 号仓'}
      />

      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
      {saved && (
        <p className="text-sm text-success" role="status">
          已保存
        </p>
      )}

      <div className="flex justify-end">
        <Button onClick={() => void submit()} disabled={saving || !storeName.trim()}>
          {saving ? '保存中…' : '保存'}
        </Button>
      </div>
    </section>
  );
}
