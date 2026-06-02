import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { formatDuration } from '../utils/format';

export default function TimeLogs() {
  const [rows, setRows] = useState(null);

  useEffect(() => {
    api({ endpoint: '/api/admin/time-logs/recent?limit=200' })
      .then(setRows)
      .catch(() => setRows([]));
  }, []);

  if (!rows) {
    return <p className="text-muted">Loading sessions…</p>;
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-ink tracking-tight">Time logs</h1>
        <p className="text-sm text-muted mt-1">Recent sessions across the team (UTC)</p>
      </div>
      <div className="rounded-xl2 border border-line bg-surface shadow-soft overflow-x-auto">
        <table className="w-full text-[13px] min-w-[900px]">
          <thead className="text-muted bg-page/70 border-b border-line">
            <tr>
              <th className="text-left px-4 py-3 font-semibold">Member</th>
              <th className="text-left px-4 py-3 font-semibold">In</th>
              <th className="text-left px-4 py-3 font-semibold">Out</th>
              <th className="text-right px-4 py-3 font-semibold">Active</th>
              <th className="text-right px-4 py-3 font-semibold">Ghost</th>
              <th className="text-right px-4 py-3 font-semibold">Score</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((s) => (
              <tr key={s.id} className="hover:bg-black/[0.015]">
                <td className="px-4 py-3">
                  <Link
                    to={`/members/${s.userId}`}
                    className="font-semibold text-brand hover:underline"
                  >
                    {s.user.name}
                  </Link>
                  <div className="text-[11px] text-muted">{s.user.jobTitle ?? 'Team member'}</div>
                </td>
                <td className="px-4 py-3 font-mono text-[12px]">
                  {new Date(s.clockIn).toLocaleString()}
                </td>
                <td className="px-4 py-3 font-mono text-[12px]">
                  {s.clockOut ? new Date(s.clockOut).toLocaleString() : '—'}
                </td>
                <td className="px-4 py-3 text-right">{formatDuration(s.totalActiveMs)}</td>
                <td className="px-4 py-3 text-right text-ghost">{formatDuration(s.totalGhostMs)}</td>
                <td className="px-4 py-3 text-right">{s.activityRatio != null ? `${s.activityRatio.toFixed(1)}%` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
