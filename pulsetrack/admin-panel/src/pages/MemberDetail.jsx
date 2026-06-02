import React, { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from 'recharts';
import { TableSkeleton } from '../components/Skeleton';

const SEGMENT_COLORS = {
  ACTIVE: '#14B8A6',
  IDLE: '#cbd5e1',
  BREAK: '#3b82f6',
  GHOST: '#f59e0b',
  MANUAL_PAUSE: '#a78bfa',
};

export default function MemberDetail() {
  const { id } = useParams();
  const [sessions, setSessions] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    api({ endpoint: `/api/admin/members/${id}/sessions` })
      .then(setSessions)
      .catch((e) => setErr(e.message));
  }, [id]);

  const pie = useMemo(() => {
    if (!sessions?.length) return [{ name: 'No data', value: 1, color: '#e2e8f0' }];
    const last = sessions[0];
    return [
      { name: 'Active', value: last.totalActiveMs || 1, color: SEGMENT_COLORS.ACTIVE },
      { name: 'Idle', value: last.totalIdleMs || 0, color: SEGMENT_COLORS.IDLE },
      { name: 'Ghost', value: last.totalGhostMs || 0, color: SEGMENT_COLORS.GHOST },
      { name: 'Break', value: last.totalBreakMs || 0, color: SEGMENT_COLORS.BREAK },
    ].filter((x) => x.value > 0);
  }, [sessions]);

  if (err) return <div className="text-rose-600 text-sm">{err}</div>;
  if (!sessions) return <TableSkeleton cols={3} />;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-ink tracking-tight">Member sessions</h1>
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl2 border border-line bg-surface shadow-soft p-5 h-[280px]">
          <h2 className="text-[13px] font-bold text-muted mb-2 uppercase tracking-wide">Latest session mix</h2>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie dataKey="value" data={pie} innerRadius={50} outerRadius={80}>
                {pie.map((e, i) => (
                  <Cell key={i} fill={e.color} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="rounded-xl2 border border-line bg-surface shadow-soft p-5 space-y-3 text-[13px]">
          <h2 className="font-bold text-ink">Timeline (latest session)</h2>
          {sessions[0] ? (
            <SessionTimeline session={sessions[0]} />
          ) : (
            <p className="text-muted">No sessions recorded.</p>
          )}
        </div>
      </div>

      <div className="rounded-xl2 border border-line bg-surface shadow-soft overflow-hidden">
        <table className="min-w-full text-[13px]">
          <thead className="bg-page/70 text-muted text-left border-b border-line font-semibold">
            <tr>
              <th className="px-4 py-3">Clock in</th>
              <th className="px-4 py-3">Clock out</th>
              <th className="px-4 py-3">Active</th>
              <th className="px-4 py-3 text-ghost">Ghost</th>
              <th className="px-4 py-3 text-right">Score</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {sessions.map((s) => (
              <tr key={s.id} className="hover:bg-black/[0.015]">
                <td className="px-4 py-2 font-mono text-[12px] text-muted">{new Date(s.clockIn).toLocaleString()}</td>
                <td className="px-4 py-2 font-mono text-[12px] text-muted">
                  {s.clockOut ? new Date(s.clockOut).toLocaleString() : '—'}
                </td>
                <td className="px-4 py-2 text-brand font-mono">{((s.totalActiveMs || 0) / 3_600_000).toFixed(2)}h</td>
                <td className="px-4 py-2 text-ghost font-mono">{((s.totalGhostMs || 0) / 3_600_000).toFixed(2)}h</td>
                <td className="px-4 py-2 text-right font-bold text-ink">{(s.activityRatio ?? 0).toFixed(1)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SessionTimeline({ session }) {
  const segs = session.segments || [];
  if (!segs.length) return <p className="text-muted">No segment data.</p>;

  const start = new Date(session.clockIn).getTime();
  const end = session.clockOut ? new Date(session.clockOut).getTime() : Date.now();
  const total = Math.max(1, end - start);

  return (
    <div className="flex h-10 w-full overflow-hidden rounded-lg ring-1 ring-line">
      {segs.map((seg) => {
        const s = new Date(seg.startedAt).getTime();
        const e = seg.endedAt ? new Date(seg.endedAt).getTime() : end;
        const pct = ((e - s) / total) * 100;
        return (
          <div
            key={seg.id}
            title={`${seg.type} ${new Date(seg.startedAt).toLocaleTimeString()}`}
            style={{
              width: `${Math.max(pct, 1)}%`,
              background: SEGMENT_COLORS[seg.type] || '#94a3b8',
            }}
          />
        );
      })}
    </div>
  );
}
