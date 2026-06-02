import React, { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { TableSkeleton } from '../components/Skeleton';

export default function FocusBoard() {
  const [rows, setRows] = useState(null);
  const [range, setRange] = useState('today');
  const [err, setErr] = useState('');

  useEffect(() => {
    api({ endpoint: `/api/admin/reports/focus-board?range=${range}` })
      .then(setRows)
      .catch((e) => setErr(e.message));
  }, [range]);

  if (err) return <div className="text-rose-600 text-sm">{err}</div>;
  if (!rows) return <TableSkeleton cols={6} />;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-4">
        <h1 className="text-2xl font-bold text-ink tracking-tight">Focus Board</h1>
        <select
          value={range}
          onChange={(e) => setRange(e.target.value)}
          className="rounded-xl border border-line bg-page px-3 py-2 text-[13px] text-ink"
        >
          <option value="today">Today</option>
          <option value="week">This week</option>
        </select>
      </div>
      <div className="overflow-auto rounded-xl2 border border-line bg-surface shadow-soft">
        <table className="min-w-full text-[13px]">
          <thead className="bg-page/70 text-muted text-left border-b border-line font-semibold">
            <tr>
              <th className="px-4 py-3">Member</th>
              <th className="px-4 py-3">Clocked</th>
              <th className="px-4 py-3">Active</th>
              <th className="px-4 py-3 text-ghost">Ghost</th>
              <th className="px-4 py-3">Score</th>
              <th className="px-4 py-3">Flags</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((r) => (
              <tr key={r.member.id} className="hover:bg-black/[0.015]">
                <td className="px-4 py-3 font-semibold text-ink">{r.member.name}</td>
                <td className="px-4 py-3 font-mono text-muted">
                  {((r.clockedMs ?? 0) / 3_600_000).toFixed(2)}h
                </td>
                <td className="px-4 py-3 text-brand font-mono">
                  {((r.activeMs ?? 0) / 3_600_000).toFixed(2)}h
                </td>
                <td className="px-4 py-3 text-ghost font-mono font-medium">
                  {((r.ghostMs ?? 0) / 3_600_000).toFixed(2)}h
                </td>
                <td className="px-4 py-3">
                  <ScorePill score={r.activityScore} />
                </td>
                <td className="px-4 py-3 font-medium text-rose-700">{r.flags}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ScorePill({ score }) {
  const tone =
    score >= 80
      ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
      : score >= 50
        ? 'bg-amber-50 text-amber-900 ring-amber-200'
        : 'bg-rose-50 text-rose-800 ring-rose-100';

  return (
    <span className={`inline-flex rounded-full px-3 py-0.5 text-xs font-bold ring-1 ${tone}`}>
      {score.toFixed(1)}%
    </span>
  );
}
