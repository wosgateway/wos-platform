'use client';

// src/components/admin/AuditLogManager.tsx
//
// "Audit log" tab — read-only view of public.audit_log (sql/073_audit_log.sql)
// via /api/admin/audit-log, so staff can see who did what without opening
// the SQL editor. Nothing here can write — the table itself has no
// UPDATE/DELETE policy for anyone and this UI never even tries an
// INSERT (see audit-log.ts: writes only happen server-side, right after
// the action they're logging).

import { useEffect, useState } from 'react';

interface AuditLogRow {
  id: string;
  created_at: string;
  actor_user_id: string | null;
  actor_email: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  before: unknown;
  after: unknown;
  metadata: unknown;
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString('th-TH', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

// Rough color coding by action prefix (before the first '.') so
// suspend/reject-style actions stand out from routine ones without
// needing a hardcoded list that goes stale every time a new action
// string gets added somewhere in the codebase.
function actionBadgeClass(action: string) {
  if (/suspend|reject|delete/i.test(action)) return 'bg-red-100 text-red-700';
  if (/impersonate/i.test(action)) return 'bg-amber-100 text-amber-800';
  if (/verify|reactivate|approve/i.test(action)) return 'bg-emerald-100 text-emerald-700';
  return 'bg-slate-100 text-slate-700';
}

export function AuditLogManager() {
  const [rows, setRows] = useState<AuditLogRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [actionFilter, setActionFilter] = useState('');
  const [entityTypeFilter, setEntityTypeFilter] = useState('');
  const [entityIdFilter, setEntityIdFilter] = useState('');
  const [actorEmailFilter, setActorEmailFilter] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  async function load(targetPage: number) {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(targetPage) });
      if (actionFilter.trim()) params.set('action', actionFilter.trim());
      if (entityTypeFilter.trim()) params.set('entityType', entityTypeFilter.trim());
      if (entityIdFilter.trim()) params.set('entityId', entityIdFilter.trim());
      if (actorEmailFilter.trim()) params.set('actorEmail', actorEmailFilter.trim());

      const res = await fetch(`/api/admin/audit-log?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'โหลด audit log ไม่สำเร็จ');
        setRows([]);
        return;
      }
      setRows(data.rows);
      setTotal(data.total);
      setPage(data.page);
      setPageSize(data.pageSize);
    } catch (e) {
      setError('เชื่อมต่อ API ไม่สำเร็จ: ' + (e instanceof Error ? e.message : String(e)));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleFilterSubmit(e: React.FormEvent) {
    e.preventDefault();
    load(0);
  }

  function handleClearFilters() {
    setActionFilter('');
    setEntityTypeFilter('');
    setEntityIdFilter('');
    setActorEmailFilter('');
    load(0);
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-slate-900">
          Audit log {total > 0 && <span className="font-normal text-slate-400">({total} รายการ)</span>}
        </h2>
        <button onClick={() => load(page)} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm">
          รีเฟรช
        </button>
      </div>

      <form onSubmit={handleFilterSubmit} className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-100 bg-slate-50 p-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500">Action</label>
          <input
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            placeholder="เช่น partner.suspend"
            className="rounded-lg border border-slate-200 px-2 py-1 text-sm"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500">Entity type</label>
          <input
            value={entityTypeFilter}
            onChange={(e) => setEntityTypeFilter(e.target.value)}
            placeholder="เช่น partner"
            className="rounded-lg border border-slate-200 px-2 py-1 text-sm"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500">Entity ID</label>
          <input
            value={entityIdFilter}
            onChange={(e) => setEntityIdFilter(e.target.value)}
            placeholder="UUID"
            className="rounded-lg border border-slate-200 px-2 py-1 text-sm"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500">Actor email</label>
          <input
            value={actorEmailFilter}
            onChange={(e) => setActorEmailFilter(e.target.value)}
            placeholder="admin@..."
            className="rounded-lg border border-slate-200 px-2 py-1 text-sm"
          />
        </div>
        <div className="flex gap-2">
          <button type="submit" className="btn-primary text-sm">
            กรอง
          </button>
          <button type="button" onClick={handleClearFilters} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm">
            ล้างตัวกรอง
          </button>
        </div>
      </form>

      {error && <div className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      {loading && !rows ? (
        <div className="py-8 text-center text-sm text-slate-400">🔄 กำลังโหลด...</div>
      ) : rows && rows.length === 0 ? (
        <div className="py-8 text-center text-sm text-slate-400">ไม่พบรายการที่ตรงกับตัวกรอง</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-100">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-400">
              <tr>
                <th className="px-4 py-2">เวลา</th>
                <th className="px-4 py-2">Action</th>
                <th className="px-4 py-2">Entity</th>
                <th className="px-4 py-2">ผู้ทำรายการ</th>
                <th className="px-4 py-2 text-right">รายละเอียด</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows?.map((row) => (
                <>
                  <tr key={row.id}>
                    <td className="whitespace-nowrap px-4 py-2 text-slate-500">{formatDateTime(row.created_at)}</td>
                    <td className="px-4 py-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${actionBadgeClass(row.action)}`}>
                        {row.action}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-slate-600">
                      {row.entity_type}
                      {row.entity_id && (
                        <div className="font-mono text-xs text-slate-400" title={row.entity_id}>
                          {row.entity_id.slice(0, 8)}…
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-2 text-slate-600">{row.actor_email ?? '—'}</td>
                    <td className="px-4 py-2 text-right">
                      <button
                        onClick={() => setExpandedId(expandedId === row.id ? null : row.id)}
                        className="text-primary-dark hover:underline"
                      >
                        {expandedId === row.id ? 'ซ่อน' : 'ดู before/after'}
                      </button>
                    </td>
                  </tr>
                  {expandedId === row.id && (
                    <tr key={`${row.id}-detail`}>
                      <td colSpan={5} className="bg-slate-50 px-4 py-3">
                        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                          <div>
                            <div className="mb-1 text-xs font-semibold text-slate-400">before</div>
                            <pre className="max-h-48 overflow-auto rounded-lg bg-white p-2 text-xs text-slate-600">
                              {JSON.stringify(row.before, null, 2) ?? '—'}
                            </pre>
                          </div>
                          <div>
                            <div className="mb-1 text-xs font-semibold text-slate-400">after</div>
                            <pre className="max-h-48 overflow-auto rounded-lg bg-white p-2 text-xs text-slate-600">
                              {JSON.stringify(row.after, null, 2) ?? '—'}
                            </pre>
                          </div>
                          <div>
                            <div className="mb-1 text-xs font-semibold text-slate-400">metadata</div>
                            <pre className="max-h-48 overflow-auto rounded-lg bg-white p-2 text-xs text-slate-600">
                              {JSON.stringify(row.metadata, null, 2) ?? '—'}
                            </pre>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {rows && rows.length > 0 && (
        <div className="flex items-center justify-between text-sm text-slate-500">
          <span>
            หน้า {page + 1} / {totalPages}
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => load(page - 1)}
              disabled={page <= 0 || loading}
              className="rounded-lg border border-slate-200 px-3 py-1.5 disabled:opacity-40"
            >
              ก่อนหน้า
            </button>
            <button
              onClick={() => load(page + 1)}
              disabled={page + 1 >= totalPages || loading}
              className="rounded-lg border border-slate-200 px-3 py-1.5 disabled:opacity-40"
            >
              ถัดไป
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
