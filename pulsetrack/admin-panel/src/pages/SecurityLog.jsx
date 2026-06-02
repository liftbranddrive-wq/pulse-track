import React, { useEffect, useState } from 'react';
import { api } from '../lib/api';

const TYPE_LABELS = {
  NEW_DEVICE: 'New device',
  IP_CHANGE: 'IP changed mid-session',
  DUAL_IP: 'Multiple IPs same day',
  HEARTBEAT_GAP: 'Heartbeat lost',
  SHORT_SESSION: 'Very short session',
  EXCESSIVE_HOURS: 'Excessive hours',
  CLOCK_WINDOW_VIOLATION: 'Clock-in window violation',
  GRACE_ABUSE: 'Grace period abuse',
  CHALLENGE_FAILED: 'Activity challenge failed',
};

export default function SecurityLog() {
  const [rows, setRows] = useState([]);
  const [filter, setFilter] = useState('open');

  async function load() {
    const q = filter === 'open' ? '?resolved=false' : filter === 'resolved' ? '?resolved=true' : '';
    const data = await api({ endpoint: `/api/notifications/anomalies/list${q}` });
    setRows(data);
  }

  useEffect(() => {
    load().catch(() => setRows([]));
  }, [filter]);

  async function resolve(id) {
    const note = window.prompt('Resolution note:');
    if (!note || note.length < 3) return;
    await api({
      endpoint: `/api/notifications/anomalies/${id}/resolve`,
      method: 'PATCH',
      body: { resolution: note },
    });
    await load();
  }

  const stale = rows.filter(
    (r) => !r.resolved && Date.now() - new Date(r.timestamp).getTime() > 48 * 3600_000,
  );

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-ink">Security log</h1>
        <p className="text-sm text-muted mt-1">Anomalies, device flags, and integrity events</p>
      </header>

      {stale.length ? (
        <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-[13px] text-amber-900 font-medium animate-pulse">
          ⚠ {stale.length} unresolved anomaly(ies) older than 48 hours
        </div>
      ) : null}

      <div className="flex gap-2">
        {['open', 'resolved', 'all'].map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-lg text-[13px] font-medium capitalize ${
              filter === f ? 'bg-brand/15 text-teal-900 ring-1 ring-brand/30' : 'text-muted hover:bg-black/[0.04]'
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      <div className="rounded-xl2 border border-line bg-surface overflow-hidden">
        {!rows.length ? (
          <p className="p-8 text-center text-muted text-sm">No anomalies found.</p>
        ) : (
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-muted border-b border-line bg-page/50">
                <th className="px-5 py-3 text-left font-semibold">Time</th>
                <th className="px-5 py-3 text-left font-semibold">Member</th>
                <th className="px-5 py-3 text-left font-semibold">Type</th>
                <th className="px-5 py-3 text-left font-semibold">Status</th>
                <th className="px-5 py-3 text-left font-semibold">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r) => {
                const old = !r.resolved && Date.now() - new Date(r.timestamp).getTime() > 48 * 3600_000;
                return (
                  <tr key={r.id} className={old ? 'bg-rose-50/50' : ''}>
                    <td className="px-5 py-3 font-mono text-[12px]">{new Date(r.timestamp).toLocaleString()}</td>
                    <td className="px-5 py-3 font-medium">{r.user?.name}</td>
                    <td className="px-5 py-3">{TYPE_LABELS[r.type] || r.type}</td>
                    <td className="px-5 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                        r.resolved ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'
                      }`}>
                        {r.resolved ? 'Resolved' : 'Open'}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      {!r.resolved ? (
                        <button type="button" onClick={() => resolve(r.id)} className="text-brand font-semibold hover:underline">
                          Resolve
                        </button>
                      ) : (
                        <span className="text-muted text-[12px]">{r.resolution}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
