'use client';

import { useEffect, useState } from 'react';
import { MapPin, Pencil, Plus, Star, Trash2 } from 'lucide-react';
import { Badge, Button, EmptyState, IconButton } from '@mall/ui';
import { AddressForm } from './address-form';
import { deleteAddress, listAddresses, saveAddress, setDefaultAddress, type AddressInput, type AddressRecord } from '@/lib/account';

/** 地址簿：列表 + 新增/编辑/删除/设为默认。 */
export function AddressBook() {
  const [addresses, setAddresses] = useState<AddressRecord[]>([]);
  const [editing, setEditing] = useState<AddressRecord | null>(null);
  const [adding, setAdding] = useState(false);

  const refresh = () => setAddresses(listAddresses());

  useEffect(() => {
    refresh();
  }, []);

  const handleSave = (input: AddressInput, id?: string) => {
    saveAddress(input, id);
    setEditing(null);
    setAdding(false);
    refresh();
  };
  const handleDelete = (id: string) => {
    deleteAddress(id);
    if (editing?.id === id) setEditing(null);
    refresh();
  };
  const handleDefault = (id: string) => {
    setDefaultAddress(id);
    refresh();
  };

  const showForm = adding || editing !== null;

  return (
    <section aria-labelledby="addr-heading">
      <div className="mb-3 flex items-center justify-between">
        <h2 id="addr-heading" className="text-base font-semibold">
          地址簿
        </h2>
        {!showForm && (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              setAdding(true);
              setEditing(null);
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
      ) : addresses.length === 0 ? (
        <EmptyState
          icon={MapPin}
          title="还没有收货地址"
          description="添加后结账会更快"
          action={<Button onClick={() => setAdding(true)}>新增地址</Button>}
        />
      ) : (
        <ul className="space-y-3">
          {addresses.map((a) => (
            <li key={a.id} className="rounded-lg border border-border bg-card p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium text-foreground">
                    {a.name} · {a.phone}
                    {a.isDefault && <Badge variant="brand">默认</Badge>}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {a.region} {a.line1}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1">
                  {!a.isDefault && (
                    <IconButton aria-label="设为默认地址" size="sm" onClick={() => handleDefault(a.id)}>
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
                  <IconButton aria-label="删除地址" size="sm" onClick={() => handleDelete(a.id)}>
                    <Trash2 className="size-4" strokeWidth={2} aria-hidden="true" />
                  </IconButton>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
