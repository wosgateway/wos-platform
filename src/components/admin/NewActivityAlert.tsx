'use client';

// src/components/admin/NewActivityAlert.tsx
//
// Blinking notification bell for the admin nav (mounted once in
// AdminGate.tsx so it's visible on every /admin* page). Polls
// GET /api/admin/notifications/summary every POLL_MS for new orders
// and new (PENDING) partner applications.
//
// "New" is tracked per-browser via localStorage, not per-admin-account
// server-side — two admins on two devices each get their own read/unread
// state, and clearing site data resets it. That's an intentional MVP
// trade-off (no new table/columns needed); a real per-account read-state
// would need a server-side notifications row per admin, same shape as
// the partner-portal `notifications` table this mirrors in spirit.
//
// First load on a device seeds the cursor to whatever's already latest
// instead of counting all pre-existing orders/leads as "new" — nobody
// wants 400 unread the first time they open this on a new laptop. Only
// arrivals after that point light up the bell.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Bell, ShoppingBag, UserPlus } from 'lucide-react';

const POLL_MS = 15_000;
const LAST_SEEN_ORDERS_KEY = 'wos_admin_last_seen_orders_at';
const LAST_SEEN_LEADS_KEY = 'wos_admin_last_seen_leads_at';

interface CounterResult {
  latestCreatedAt: string | null;
  newCount: number;
}

interface SummaryResponse {
  orders: CounterResult;
  leads: CounterResult;
}

export function NewActivityAlert() {
  const [open, setOpen] = useState(false);
  const [newOrders, setNewOrders] = useState(0);
  const [newLeads, setNewLeads] = useState(0);
  // Candidate cursor to commit to localStorage once the admin actually
  // looks at that category — see markSeen(). Not committed on every poll,
  // or the bell would clear itself before anyone noticed it.
  const latestOrdersAt = useRef<string | null>(null);
  const latestLeadsAt = useRef<string | null>(null);

  const poll = useCallback(async () => {
    let sinceOrders = localStorage.getItem(LAST_SEEN_ORDERS_KEY);
    let sinceLeads = localStorage.getItem(LAST_SEEN_LEADS_KEY);

    try {
      const params = new URLSearchParams();
      if (sinceOrders) params.set('since_orders', sinceOrders);
      if (sinceLeads) params.set('since_leads', sinceLeads);

      const res = await fetch(`/api/admin/notifications/summary?${params.toString()}`, {
        credentials: 'include',
      });
      if (!res.ok) return;
      const data: SummaryResponse = await res.json();

      // First time ever on this device/browser for a category — seed the
      // cursor to "now" (the latest row at this moment) so existing
      // backlog doesn't show up as "new". Nothing to alert on yet.
      if (!sinceOrders && data.orders.latestCreatedAt) {
        localStorage.setItem(LAST_SEEN_ORDERS_KEY, data.orders.latestCreatedAt);
        sinceOrders = data.orders.latestCreatedAt;
      }
      if (!sinceLeads && data.leads.latestCreatedAt) {
        localStorage.setItem(LAST_SEEN_LEADS_KEY, data.leads.latestCreatedAt);
        sinceLeads = data.leads.latestCreatedAt;
      }

      latestOrdersAt.current = data.orders.latestCreatedAt;
      latestLeadsAt.current = data.leads.latestCreatedAt;
      // On this first-seed poll, since_orders/since_leads were empty so the
      // server had nothing to compare against and always returns newCount:
      // 0 — correct, matches "no alert on backlog" above.
      setNewOrders(data.orders.newCount);
      setNewLeads(data.leads.newCount);
    } catch {
      // Best-effort — a failed poll just tries again in POLL_MS, never
      // blocks or breaks the rest of the admin UI.
    }
  }, []);

  useEffect(() => {
    poll();
    const id = setInterval(poll, POLL_MS);
    return () => clearInterval(id);
  }, [poll]);

  function markOrdersSeen() {
    if (latestOrdersAt.current) {
      localStorage.setItem(LAST_SEEN_ORDERS_KEY, latestOrdersAt.current);
    }
    setNewOrders(0);
  }

  function markLeadsSeen() {
    if (latestLeadsAt.current) {
      localStorage.setItem(LAST_SEEN_LEADS_KEY, latestLeadsAt.current);
    }
    setNewLeads(0);
  }

  const hasNew = newOrders > 0 || newLeads > 0;
  const totalNew = newOrders + newLeads;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={`relative rounded-full p-2 transition-colors hover:bg-slate-100 ${
          hasNew ? 'animate-bell-blink text-red-500' : 'text-slate-500'
        }`}
        aria-label="รายการใหม่"
      >
        <Bell className="h-5 w-5" strokeWidth={hasNew ? 2.25 : 2} />
        {hasNew ? (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
            <span className="relative inline-flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[9px] font-bold text-white">
              {totalNew > 9 ? '9+' : totalNew}
            </span>
          </span>
        ) : null}
      </button>

      {open ? (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-50 mt-2 w-72 rounded-xl border border-slate-100 bg-white shadow-card">
            <div className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-900">
              รายการใหม่
            </div>
            {!hasNew ? (
              <div className="p-6 text-center text-sm text-slate-400">ไม่มีรายการใหม่</div>
            ) : (
              <div className="divide-y divide-slate-100">
                {newOrders > 0 ? (
                  <a
                    href="/admin/orders"
                    onClick={markOrdersSeen}
                    className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50"
                  >
                    <ShoppingBag className="h-4 w-4 shrink-0 text-primary-dark" />
                    <span className="text-sm text-slate-700">
                      คำสั่งซื้อใหม่ <span className="font-semibold">{newOrders}</span> รายการ
                    </span>
                  </a>
                ) : null}
                {newLeads > 0 ? (
                  <a
                    href="/admin?tab=leads"
                    onClick={markLeadsSeen}
                    className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50"
                  >
                    <UserPlus className="h-4 w-4 shrink-0 text-primary-dark" />
                    <span className="text-sm text-slate-700">
                      พาร์ทเนอร์สมัครใหม่ <span className="font-semibold">{newLeads}</span> รายการ
                    </span>
                  </a>
                ) : null}
              </div>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}
