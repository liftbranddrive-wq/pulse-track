import React, { useEffect, useState } from 'react';
import { api } from '../lib/api';

export default function EmailLogs() {
  const [rows, setRows] = useState(null);

  useEffect(() => {
    api({ endpoint: '/api/admin/email-log' })
      .then(setRows)
      .catch(() => setRows([]));
  }, []);

  if (!rows) return <p className="text-muted">Loading outbound mail…</p>;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-ink tracking-tight">Email logs</h1>
        <p className="text-sm text-muted mt-1">Delivery attempts from PulseTrack cron & queue workers</p>
      </div>
      <div className="rounded-xl2 border border-line bg-surface shadow-soft overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead className="bg-page/70 text-muted border-b border-line">
            <tr>
              <th className="text-left px-4 py-3 font-semibold">When</th>
              <th className="text-left px-4 py-3 font-semibold">Type</th>
              <th className="text-left px-4 py-3 font-semibold">Recipient</th>
              <th className="text-left px-4 py-3 font-semibold">Status</th>
              <th className="text-left px-4 py-3 font-semibold">Detail</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((r) => (
              <tr key={r.id} className="hover:bg-black/[0.015]">
                <td className="px-4 py-2.5 font-mono text-[12px]">
                  {new Date(r.createdAt).toLocaleString()}
                </td>
                <td className="px-4 py-2.5 font-medium">{r.type}</td>
                <td className="px-4 py-2.5">{r.recipient}</td>
                <td className="px-4 py-2.5">
                  <span
                    className={
                      r.status === 'SENT'
                        ? 'text-emerald-600 font-semibold'
                        : r.status === 'FAILED'
                          ? 'text-rose-600 font-semibold'
                          : 'text-muted font-medium'
                    }
                  >
                    {r.status}
                  </span>
                </td>
                <td className="px-4 py-2.5 max-w-[240px] truncate text-muted text-[12px]" title={r.error ?? ''}>
                  {r.error || '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
