import React, { useEffect, useState } from 'react';
import { api } from '../lib/api';

export default function Audit() {
  const [rows, setRows] = useState(null);

  useEffect(() => {
    api({ endpoint: '/api/admin/audit' }).then(setRows).catch(() => setRows([]));
  }, []);

  if (!rows) return <p className="text-muted text-sm px-2">Loading…</p>;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-ink tracking-tight">Audit log</h1>
        <p className="text-sm text-muted mt-1">Immutable trace of privileged admin edits</p>
      </div>
      <div className="rounded-xl2 border border-line bg-surface shadow-soft overflow-auto max-h-[72vh]">
        <table className="min-w-full text-[12px]">
          <thead className="bg-page/80 text-muted sticky top-0 border-b border-line font-semibold z-10">
            <tr>
              <th className="text-left px-4 py-2.5">When</th>
              <th className="text-left px-4 py-2.5">Who</th>
              <th className="text-left px-4 py-2.5">Action</th>
              <th className="text-left px-4 py-2.5">Entity</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((r) => (
              <tr key={r.id} className="hover:bg-black/[0.015]">
                <td className="px-4 py-2 font-mono text-muted">
                  {new Date(r.createdAt).toLocaleString()}
                </td>
                <td className="px-4 py-2 text-brand font-medium">{r.actor?.name ?? '—'}</td>
                <td className="px-4 py-2 font-semibold text-ink">{r.action}</td>
                <td className="px-4 py-2 text-muted">
                  {r.entityType} {r.entityId ?? ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
