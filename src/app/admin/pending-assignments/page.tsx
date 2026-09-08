'use client';

// app/admin/pending-assignments/page.tsx
//
// Minimal admin screen for resolving "let team decide" order_items
// (needs_assignment = true — see migration 013/014). Lists every
// pending row with its order/customer context, and lets an admin
// search a partner then pick one of that partner's packages
// (PackagePickerCombobox — same two-step picker BookingsManager uses
// for reassignment) plus a quantity, to assign.
//
// Assumes this route already sits behind your existing admin
// layout/auth guard (e.g. an app/admin/layout.tsx that redirects
// non-admins) — the API route itself also re-checks admin status
// server-side regardless (see lib/admin/require-admin.ts), so this
// page can't be used to bypass that even if the layout guard is
// missing.

import { useEffect, useState } from 'react';
import { PackagePickerCombobox } from '@/components/admin/PackagePickerCombobox';

interface PendingItem {
  id: string;
  order_id: string;
  service_type: 'hotel' | 'transport';
  scheduled_date: string | null;
  scheduled_time: string | null;
  hotel_checkout_date: string | null;
  transport_mode: string | null;
  transport_return_date: string | null;
  transport_return_time: string | null;
  pickup_location: string | null;
  dropoff_location: string | null;
  room_quantity: number;
  created_at: string;
  order_number: string | null;
  customer_name: string | null;
  customer_phone: string | null;
}

export default function PendingAssignmentsPage() {
  const [items, setItems] = useState<PendingItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [assigning, setAssigning] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<
    Record<string, { package_id: string; package_label: string; quantity: string }>
  >({});

  async function load() {
    setError(null);
    try {
      const res = await fetch('/api/admin/order-items/pending');
      const result = await res.json();
      if (!res.ok) throw new Error(result?.error ?? 'failed to load');
      setItems(result.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed to load');
    }
  }

  useEffect(() => {
    load();
  }, []);

  const emptyDraft = { package_id: '', package_label: '', quantity: '1' };

  function draftFor(id: string) {
    return drafts[id] ?? emptyDraft;
  }

  // Merges one or more field updates into a draft atomically off
  // `prev` (the up-to-date state inside the functional updater), not
  // off draftFor(id)/the outer `drafts` closure. Two updateDraft
  // calls fired back-to-back in the same handler (see onSelect below)
  // both get batched by React into the same render — reading the
  // outer `drafts` in either updater sees the SAME stale snapshot,
  // so the second call's spread silently overwrites whatever the
  // first call just set. Reading off `prev` instead means each
  // updater sees the previous one's result.
  function updateDraft(
    id: string,
    fields: Partial<{ package_id: string; package_label: string; quantity: string }>
  ) {
    setDrafts((prev) => ({
      ...prev,
      [id]: { ...(prev[id] ?? emptyDraft), ...fields },
    }));
  }

  async function assign(item: PendingItem) {
    const draft = draftFor(item.id);
    if (!draft.package_id.trim()) {
      setError(`item ${item.id}: package_id is required`);
      return;
    }
    setAssigning(item.id);
    setError(null);
    try {
      const res = await fetch(`/api/admin/order-items/${item.id}/assign`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          package_id: draft.package_id.trim(),
          quantity: Number(draft.quantity) || 1,
        }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result?.error ?? 'assignment failed');
      // Remove the resolved row from the list rather than re-fetching
      // everything.
      setItems((prev) => (prev ?? []).filter((i) => i.id !== item.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'assignment failed');
    } finally {
      setAssigning(null);
    }
  }

  return (
    <div className="mx-auto max-w-4xl p-6">
      <h1 className="mb-1 text-xl font-bold text-slate-900">Pending assignments</h1>
      <p className="mb-6 text-sm text-slate-500">
        Hotel/transport items where the customer left the choice to the team.
      </p>

      {error ? (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-600">
          {error}
        </div>
      ) : null}

      {items === null ? (
        <p className="text-sm text-slate-400">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-slate-400">Nothing pending. 🎉</p>
      ) : (
        <div className="space-y-4">
          {items.map((item) => {
            const draft = draftFor(item.id);
            return (
              <div key={item.id} className="rounded-xl border border-slate-200 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <div>
                    <p className="font-medium text-slate-900">
                      {item.order_number ?? item.order_id} · {item.service_type}
                    </p>
                    <p className="text-sm text-slate-500">
                      {item.customer_name} · {item.customer_phone}
                    </p>
                  </div>
                  <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-700">
                    needs assignment
                  </span>
                </div>

                <div className="mb-3 text-sm text-slate-600">
                  {item.service_type === 'hotel' ? (
                    <p>
                      Check-in: {item.scheduled_date ?? '—'} · Check-out:{' '}
                      {item.hotel_checkout_date ?? '—'}
                      {item.room_quantity > 1 ? ` · Rooms: ${item.room_quantity}` : ''}
                    </p>
                  ) : (
                    <p>
                      Pickup: {item.scheduled_date ?? '—'} {item.scheduled_time ?? ''} · Mode:{' '}
                      {item.transport_mode ?? '—'}
                      {item.transport_mode === 'round_trip'
                        ? ` · Return: ${item.transport_return_date ?? '—'} ${item.transport_return_time ?? ''}`
                        : ''}
                      {item.transport_mode === 'daily'
                        ? ` · Days: ${draft.quantity || '?'}`
                        : ''}
                      {item.pickup_location ? ` · From: ${item.pickup_location}` : ''}
                      {item.dropoff_location ? ` · To: ${item.dropoff_location}` : ''}
                    </p>
                  )}
                </div>

                <div className="flex flex-wrap items-end gap-3">
                  <div className="w-80">
                    <label className="mb-1 block text-xs font-medium text-slate-500">
                      package ({item.service_type})
                    </label>
                    <PackagePickerCombobox
                      category={item.service_type === 'hotel' ? 'Hotel' : 'Transport'}
                      disabled={assigning === item.id}
                      selectedLabel={draft.package_label}
                      onSelect={(packageId, packageLabel) =>
                        updateDraft(item.id, {
                          package_id: packageId,
                          package_label: packageLabel ?? packageId,
                        })
                      }
                      placeholder="-- ค้นหาร้าน แล้วเลือกแพ็กเกจ --"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-500">
                      quantity ({item.service_type === 'hotel' ? 'nights only — rooms folded in automatically' : 'days'})
                    </label>
                    <input
                      type="number"
                      min={1}
                      className="form-input w-24"
                      value={draft.quantity}
                      onChange={(e) => updateDraft(item.id, { quantity: e.target.value })}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => assign(item)}
                    disabled={assigning === item.id}
                    className="btn-primary disabled:opacity-60"
                  >
                    {assigning === item.id ? 'Assigning…' : 'Assign'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
