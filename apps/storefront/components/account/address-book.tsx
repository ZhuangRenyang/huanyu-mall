'use client';

import { useCallback, useEffect, useState } from 'react';
import { MapPin, Pencil, Plus, Star, Trash2 } from 'lucide-react';
import { Badge, Button, EmptyState, IconButton, Skeleton } from '@mall/ui';
import { AddressForm } from './address-form';
import {
  deleteAddress,
  listAddresses,
  saveAddress,
  setDefaultAddress,
  type AddressInput,
  type AddressRecord,
} from '@/lib/account';

/**
 * 地址簿：列表 + 新增/编辑/删除/设为默认（对齐淘宝「收货地址」）。
 *
 * 地址存在账号下（live 模式走 `/store/customer/addresses`），换设备也在，
 * 结账时可以直接选 —— 这是它和「结账时随手填一次」的区别。
 */
export function AddressBook() {
  const [addresses, setAddresses] = useState<AddressRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editing, setEditing] = useState<AddressRecord | null>(null);
  const [adding, setAdding] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setAddresses(await listAddresses());
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : '读取地址失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleSave = async (input: AddressInput, id?: string) => {
    await saveAddress(input, id);
    setEditing(null);
    setAdding(false);
    await refresh();
  };

  const handleDelete = async (id: string) => {
    setBusyId(id);
    setActionError(null);
    try {
      await deleteAddress(id);
      if (editing?.id === id) setEditing(null);
      await refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : '删除失败');
    } finally {
      setBusyId(null);
    }
  };

  const handleDefault = async (id: string) => {
    setBusyId(id);
    setActionError(null);
    try {
      await setDefaultAddress(id);
      await refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : '设置失败');
    } finally {
      setBusyId(null);
    }
  };

  const showForm = adding || editing !== null;

  return (
    <section aria-labelledby="addr-heading">
      <div className="mb-3 flex items-center justify-between">
        <h2 id="addr-heading" className="text-base font-semibold">
          收货地址
        </h2>
        {!showForm && (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              setAdding(true);
              setEditing(null);
              setActionError(null);
            }}
          >
            <Plus className="size-4" strokeWidth={2} aria-hidden="true" />
            新增地址
          </Button>
        )}
      </div>

      {showForm ? (
        <AddressForm
          initial={editing ?? undefined}
          onSave={handleSave}
          onCancel={() => {
            setAdding(false);
            setEditing(null);
          }}
        />
      ) : loading ? (
        <Skeleton className="h-24 w-full" />
      ) : loadError ? (
        <p className="text-sm text-destructive" role="alert">
          {loadError}
        </p>
      ) : addresses.length === 0 ? (
        <EmptyState
          icon={MapPin}
          title="还没有收货地址"
          description="保存后结账可直接选用，不用每次重填"
          action={<Button onClick={() => setAdding(true)}>新增地址</Button>}
        />
      ) : (
        <ul className="space-y-3">
          {addresses.map((a) => (
            <li key={a.id} className="rounded-lg border border-border bg-card p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium text-foreground">
                    {a.name}
                    {a.phone && <span className="tabular text-muted-foreground">{a.phone}</span>}
                    {a.isDefault && <Badge variant="brand">默认</Badge>}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {a.region} {a.line1}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1">
                  {!a.isDefault && (
                    <IconButton
                      aria-label="设为默认地址"
                      size="sm"
                      disabled={busyId === a.id}
                      onClick={() => void handleDefault(a.id)}
                    >
                      <Star className="size-4" strokeWidth={2} aria-hidden="true" />
                    </IconButton>
                  )}
                  <IconButton
                    aria-label="编辑地址"
                    size="sm"
                    onClick={() => {
                      setEditing(a);
                      setAdding(false);
                    }}
                  >
                    <Pencil className="size-4" strokeWidth={2} aria-hidden="true" />
                  </IconButton>
                  <IconButton
                    aria-label="删除地址"
                    size="sm"
                    disabled={busyId === a.id}
                    onClick={() => void handleDelete(a.id)}
                  >
                    <Trash2 className="size-4" strokeWidth={2} aria-hidden="true" />
                  </IconButton>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {actionError && (
        <p className="mt-2 text-sm text-destructive" role="alert">
          {actionError}
        </p>
      )}
    </section>
  );
}
