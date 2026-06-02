import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Coffee } from 'lucide-react';
import { io } from 'socket.io-client';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from 'recharts';
import { api } from '../lib/api';
import { avatarRingClass, formatDuration, initialsFrom } from '../utils/format';

const COL = {
  active: '#14b8a6',
  breakC: '#3b82f6',
  ghost: '#f59e0b',
  idle: '#cbd5e1',
};

function MetricCard({ title, value, subtitle, footer }) {
  return (
    <div className="rounded-xl2 bg-surface border border-line shadow-soft px-5 py-4 flex flex-col min-h-[120px]">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">{title}</div>
      <div className="mt-2 text-3xl font-bold text-ink tabular-nums">{value}</div>
      {subtitle ? <div className="mt-2 text-[13px] text-muted">{subtitle}</div> : null}
      {footer ? <div className="mt-auto pt-2 text-[12px] font-medium">{footer}</div> : null}
    </div>
  );
}

function StatusPill({ presence }) {
  const map = {
    WORKING: {
      dot: 'bg-emerald-500',
      bg: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
      label: 'Working',
    },
    ON_BREAK: {
      dot: 'bg-brand',
      bg: 'bg-teal-50 text-teal-900 ring-teal-200',
      label: 'Break',
    },
    IDLE: {
      dot: 'bg-orange-400',
      bg: 'bg-orange-50 text-orange-900 ring-orange-100',
      label: 'Idle',
    },
    GHOST: {
      dot: 'bg-ghost',
      bg: 'bg-amber-50 text-amber-900 ring-amber-100',
      label: 'Ghost',
    },
    PAUSED: {
      dot: 'bg-sky-400',
      bg: 'bg-sky-50 text-sky-900 ring-sky-100',
      label: 'Paused',
    },
    OFFLINE: {
      dot: 'bg-slate-300',
      bg: 'bg-slate-50 text-muted ring-slate-200',
      label: 'Offline',
    },
  };
  const c = map[presence] || map.OFFLINE;
  const isBreak = presence === 'ON_BREAK';
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-semibold ring-1 ${c.bg}`}
    >
      <span className={`w-2 h-2 rounded-full shrink-0 ${c.dot}`} />
      {isBreak ? <Coffee className="w-3 h-3" /> : null}
      {c.label}
    </span>
  );
}

/** @param {{ active:number,idle:number,breakMs:number,ghost:number }} parts */
function DayTimeline({ parts }) {
  const t = Math.max(parts.active + parts.idle + parts.breakMs + parts.ghost, 1);
  const segs = [
    { pct: (parts.active / t) * 100, bg: COL.active },
    { pct: (parts.breakMs / t) * 100, bg: COL.breakC },
    { pct: (parts.ghost / t) * 100, bg: COL.ghost },
    { pct: (parts.idle / t) * 100, bg: COL.idle },
  ].filter((s) => s.pct >= 0.4);

  return (
    <div className="flex h-9 w-full rounded-lg overflow-hidden ring-1 ring-black/10">
      {segs.map((s, i) => (
        <div
          key={i}
          title={`${Math.round(s.pct)}%`}
          className="h-full min-w-[6px]"
          style={{ flex: `${Math.max(s.pct, 0)} 1 auto`, background: s.bg }}
        />
      ))}
    </div>
  );
}

export default function Dashboard() {
  const [dash, setDash] = useState(null);
  const [focus, setFocus] = useState(null);
  const [weekly, setWeekly] = useState(null);
  const [range] = useState('today');

  useEffect(() => {
    api({ endpoint: '/api/admin/dashboard' })
      .then(setDash)
      .catch(() => setDash(null));
    api({ endpoint: `/api/admin/reports/focus-board?range=today` })
      .then(setFocus)
      .catch(() => setFocus([]));
    api({ endpoint: '/api/admin/analytics/team-week' })
      .then(setWeekly)
      .catch(() => setWeekly([]));
  }, []);

  useEffect(() => {
    const url = import.meta.env.VITE_API_URL || 'http://localhost:4000';
    const token = localStorage.getItem('pulsetrack_admin_access');
    if (!token) return;
    const s = io(url, { auth: { token } });
    s.on('team:status', (payload) => {
      setDash((d) =>
        d
          ? {
              ...d,
              team: payload.board,
              totals: payload.totals,
            }
          : d,
      );
    });
    return () => s.disconnect();
  }, []);

  const focusMap = useMemo(() => new Map((focus ?? []).map((r) => [r.member.id, r])), [focus]);

  const rows = useMemo(() => {
    if (!dash?.team) return [];
    return dash.team.map((t) => {
      const fb = focusMap.get(t.userId);
      return { t, fb };
    });
  }, [dash, focusMap]);

  if (!dash) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-9 w-64 bg-black/10 rounded-xl" />
        <div className="grid md:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-32 bg-black/10 rounded-xl" />
          ))}
        </div>
        <div className="h-96 bg-black/10 rounded-xl" />
      </div>
    );
  }

  const workingNow = dash.team.filter((x) => x.presence === 'WORKING').length;
  const onBreak = dash.team.filter((x) => x.presence === 'ON_BREAK').length;

  const idleNow = dash.team.filter((x) => x.presence === 'IDLE' || x.presence === 'GHOST').length;

  const activeHToday = +( ((dash.totals?.totalActiveMs ?? 0) / 3_600_000)).toFixed(1);

  const ghostHToday = +( ((dash.totals?.totalGhostMs ?? 0) / 3_600_000)).toFixed(1);

  const delta = dash.hoursDeltaVsYesterday;
  const deltaLine =
    typeof delta === 'number'
      ? `${delta >= 0 ? '+' : ''}${delta.toFixed(1)}h vs yesterday`
      : 'Yesterday had no tracked hours';

  const avgScore =
    focus?.length ?
      +(focus.reduce((a, x) => a + x.activityScore, 0) / focus.length).toFixed(0)
      : null;

  const weekStartLab = weekly?.[0]?.dateKey ?? '';
  const weekLegend = weekly?.length
    ? `Mon–Sun totals (UTC rolling 7-day window ending today)`
    : '';

  const chartData = (weekly ?? []).map((w) => ({
    name: w.label,
    Active: w.activeH,
    Ghost: w.ghostH,
  }));

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-ink">Dashboard</h1>
        <p className="text-sm text-muted mt-1">
          Live pulse on your team — activity signals only (no screenshots or keylogging).
        </p>
      </header>

      <section className="grid md:grid-cols-3 gap-4">
        <MetricCard
          title="Active now"
          value={workingNow}
          subtitle={<span>{`● ${onBreak} on break`} &nbsp;● {`${idleNow} idle / ghost`}</span>}
        />

        <MetricCard
          title="Team active hours today"
          value={`${activeHToday}h`}
          subtitle="Sum of credited active minutes"
          footer={
            <span className={(typeof delta === 'number' && delta >= 0) ? 'text-emerald-600' : 'text-muted'}>{deltaLine}</span>
          }
        />

        <MetricCard
          title="Signals"
          value={ghostHToday}
          subtitle="Ghost hours today"
          footer={
            averageScoreFooter(avgScore) ?? (
              <span className="text-muted">Rolling activity score averages here when data exists</span>
            )
          }
        />
      </section>

      <section className="rounded-xl2 bg-surface border border-line shadow-soft p-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-ink">Team activity</h2>
            <p className="text-sm text-muted mt-0.5">Activity score + time breakdown per member</p>
          </div>
          <div className="inline-flex rounded-lg border border-line bg-page px-2 py-1 text-[13px] text-muted capitalize">
            {range}
          </div>
        </div>

        <div className="mt-6 overflow-x-auto">
          <table className="w-full text-left text-[13px] min-w-[800px]">
            <thead>
              <tr className="text-muted border-b border-line">
                <th className="pb-3 font-semibold">Member</th>
                <th className="pb-3 font-semibold">Status</th>
                <th className="pb-3 font-semibold">Clocked</th>
                <th className="pb-3 font-semibold w-[260px]">Timeline</th>
                <th className="pb-3 font-semibold text-right">Score</th>
                <th className="pb-3 font-semibold text-center">Flags</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map(({ t, fb }) => {
                const title = t.jobTitle || fb?.member?.jobTitle || 'Team member';
                const parts = {
                  active: fb?.activeMs ?? 0,
                  idle: fb?.idleMs ?? 0,
                  breakMs: fb?.breakMs ?? 0,
                  ghost: fb?.ghostMs ?? 0,
                };
                const score = fb?.activityScore ?? null;
                const flags = fb?.flags ?? (t.presence === 'OFFLINE' ? '—' : 0);

                return (
                  <tr key={t.userId} className="hover:bg-black/[0.02]">
                    <td className="py-3">
                      <div className="flex items-center gap-3">
                        <div
                          className={`w-10 h-10 rounded-full shrink-0 flex items-center justify-center text-[11px] font-bold ring-2 ring-white shadow-sm ${avatarRingClass((t.email || '') + t.name)}`}
                        >
                          {initialsFrom(t.name, t.email)}
                        </div>
                        <div>
                          <div className="font-semibold text-ink">{t.name}</div>
                          <div className="text-muted text-[12px]">{title}</div>
                        </div>
                      </div>
                    </td>
                    <td className="py-3 align-middle">
                      <StatusPill presence={t.presence} />
                    </td>
                    <td className="py-3 font-mono text-ink">
                      {fb ? formatDuration(fb.clockedMs) : '—'}
                    </td>
                    <td className="py-3">
                      <DayTimeline parts={parts} />
                    </td>
                    <td className="py-3 text-right font-semibold">
                      {score == null ? (
                        '—'
                      ) : (
                        <span className={score >= 75 ? 'text-emerald-600' : score >= 45 ? 'text-amber-600' : 'text-rose-600'}>
                          {score.toFixed(0)}%
                        </span>
                      )}
                    </td>
                    <td className="py-3 text-center">
                      {flags === '—' || flags === 0 ? (
                        <span className="text-muted">—</span>
                      ) : (
                        <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-rose-50 text-rose-700 font-bold ring-1 ring-rose-200">
                          ⚠ {flags}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="mt-6 flex flex-col lg:flex-row lg:items-end lg:justify-between gap-6">
          <div className="flex flex-wrap gap-x-5 gap-y-2 text-[12px] text-muted">
            <LegendDot color={COL.active} label="Active" />
            <LegendDot color={COL.breakC} label="Break" />
            <LegendDot color={COL.ghost} label="Ghost" />
            <LegendDot color={COL.idle} label="Idle" />
          </div>
          <Link
            to="/time-logs"
            className="inline-flex justify-center px-5 py-2.5 rounded-xl border border-line bg-white text-[13px] font-semibold text-ink hover:bg-page shadow-sm transition"
          >
            View full log →
          </Link>
        </div>
      </section>

      <section className="rounded-xl2 bg-surface border border-line shadow-soft p-6">
        <h2 className="text-lg font-bold text-ink">Weekly activity overview</h2>
        <p className="text-sm text-muted mt-1">{weekLegend}</p>

        {!weekly?.length ? (
          <p className="text-sm text-muted mt-10">No chart data yet — clock some sessions!</p>
        ) : (
          <div className="h-[320px] w-full mt-6">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <CartesianGrid stroke="#e7e9e7" vertical={false} />
                <XAxis dataKey="name" tick={{ fill: '#64748b', fontSize: 12 }} />
                <YAxis tick={{ fill: '#64748b', fontSize: 11 }} />
                <Tooltip
                  formatter={(value) => [`${Number(value)}h`, '']}
                  contentStyle={{ borderRadius: 12, border: '1px solid #e7e9e7', boxShadow: '0 8px 24px rgba(0,0,0,.08)' }}
                />
                <Legend />
                <Bar dataKey="Active" stackId={undefined} fill={COL.active} radius={[6, 6, 0, 0]} maxBarSize={32} />
                <Bar dataKey="Ghost" fill={COL.ghost} radius={[6, 6, 0, 0]} maxBarSize={32} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        <p className="text-[11px] text-muted mt-4">
          Stored range reference: earliest day key {weekStartLab} (UTC)
        </p>
      </section>
    </div>
  );
}

function LegendDot({ color, label }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className="w-3 h-3 rounded" style={{ background: color }} />
      {label}
    </span>
  );
}

function averageScoreFooter(avgScore) {
  if (avgScore == null || Number.isNaN(avgScore)) return null;
  return (
    <span className="text-muted">
      Average activity score across members today:{' '}
      <span className={`font-semibold ${avgScore >= 75 ? 'text-emerald-600' : 'text-amber-600'}`}>
        {avgScore}%
      </span>
    </span>
  );
}
