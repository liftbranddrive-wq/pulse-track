import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { formatDuration, initialsFrom, avatarRingClass } from '../utils/format';

const STATUS_STYLE = {
  PRESENT: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  LATE: 'bg-amber-50 text-amber-900 ring-amber-200',
  ABSENT: 'bg-rose-50 text-rose-800 ring-rose-200',
  ON_LEAVE: 'bg-sky-50 text-sky-900 ring-sky-200',
  NOT_CLOCKED: 'bg-slate-50 text-muted ring-slate-200',
  HALF_DAY: 'bg-orange-50 text-orange-900 ring-orange-200',
};

function StatCard({ title, value, tone = 'ink' }) {
  const tones = {
    emerald: 'text-emerald-600',
    amber: 'text-amber-600',
    rose: 'text-rose-600',
    sky: 'text-sky-600',
    slate: 'text-muted',
    ink: 'text-ink',
  };
  return (
    <div className="rounded-xl2 bg-surface border border-line shadow-soft px-4 py-3">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted">{title}</div>
      <div className={`mt-1 text-2xl font-bold tabular-nums ${tones[tone]}`}>{value}</div>
    </div>
  );
}

export default function Attendance() {
  const [report, setReport] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api({ endpoint: '/api/attendance/report' })
      .then(setReport)
      .catch(() => setReport([]))
      .finally(() => setLoading(false));
  }, []);

  const stats = {
    present: report.filter((r) => r.record?.status === 'PRESENT').length,
    late: report.filter((r) => r.record?.status === 'LATE').length,
    absent: report.filter((r) => r.record?.status === 'ABSENT').length,
    onLeave: report.filter((r) => r.record?.status === 'ON_LEAVE').length,
    notClocked: report.filter((r) => !r.record || r.record.status === 'NOT_CLOCKED').length,
  };

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-ink">Attendance</h1>
        <p className="text-sm text-muted mt-1">Today&apos;s team attendance — present, late, absent, and on leave</p>
      </header>

      <section className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <StatCard title="Present" value={stats.present} tone="emerald" />
        <StatCard title="Late" value={stats.late} tone="amber" />
        <StatCard title="Absent" value={stats.absent} tone="rose" />
        <StatCard title="On leave" value={stats.onLeave} tone="sky" />
        <StatCard title="Not clocked" value={stats.notClocked} tone="slate" />
      </section>

      <section className="rounded-xl2 bg-surface border border-line shadow-soft overflow-hidden">
        <div className="px-5 py-4 border-b border-line">
          <h2 className="font-bold text-ink">Today&apos;s roster</h2>
        </div>
        {loading ? (
          <p className="p-6 text-sm text-muted animate-pulse">Loading attendance…</p>
        ) : !report.length ? (
          <p className="p-6 text-sm text-muted">No team members found.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px] min-w-[720px]">
              <thead>
                <tr className="text-muted border-b border-line bg-page/50">
                  <th className="px-5 py-3 font-semibold">Member</th>
                  <th className="px-5 py-3 font-semibold">Status</th>
                  <th className="px-5 py-3 font-semibold">Clock in</th>
                  <th className="px-5 py-3 font-semibold">Hours</th>
                  <th className="px-5 py-3 font-semibold">Notes</th>
                  <th className="px-5 py-3 font-semibold">Points</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {report.map(({ member, record }) => {
                  const status = record?.status ?? 'NOT_CLOCKED';
                  const rowBorder =
                    status === 'PRESENT' ? 'border-l-4 border-l-emerald-400' :
                    status === 'LATE' ? 'border-l-4 border-l-amber-400' :
                    status === 'ABSENT' ? 'border-l-4 border-l-rose-400' :
                    status === 'ON_LEAVE' ? 'border-l-4 border-l-sky-400' :
                    'border-l-4 border-l-transparent';

                  return (
                    <tr key={member.id} className={`hover:bg-black/[0.02] ${rowBorder}`}>
                      <td className="px-5 py-3">
                        <Link to={`/members/${member.id}`} className="flex items-center gap-3 group">
                          <div className={`w-9 h-9 rounded-full flex items-center justify-center text-[10px] font-bold ring-2 ring-white ${avatarRingClass(member.email)}`}>
                            {initialsFrom(member.name, member.email)}
                          </div>
                          <div>
                            <div className="font-semibold text-ink group-hover:text-brand">{member.name}</div>
                            <div className="text-[11px] text-muted">{member.jobTitle || member.email}</div>
                          </div>
                        </Link>
                      </td>
                      <td className="px-5 py-3">
                        <span className={`inline-flex px-2.5 py-1 rounded-full text-[11px] font-semibold ring-1 ${STATUS_STYLE[status] || STATUS_STYLE.NOT_CLOCKED}`}>
                          {status.replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td className="px-5 py-3 font-mono text-ink">
                        {record?.clockInTime
                          ? new Date(record.clockInTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                          : '—'}
                        {record?.earlyMinutes > 0 ? (
                          <span className="ml-2 text-sky-600 text-[11px]">−{record.earlyMinutes}m early</span>
                        ) : null}
                        {record?.lateMinutes > 0 ? (
                          <span className="ml-2 text-amber-600 text-[11px]">+{record.lateMinutes}m late</span>
                        ) : null}
                      </td>
                      <td className="px-5 py-3">
                        {record?.totalHoursWorked > 0 ? (
                          <span className={record.isComplete ? 'text-emerald-600 font-semibold' : 'text-amber-600'}>
                            {record.totalHoursWorked.toFixed(1)}h / {record.requiredHours}h
                            {record.isComplete ? ' ✓' : ''}
                          </span>
                        ) : '—'}
                      </td>
                      <td className="px-5 py-3 text-muted max-w-[220px] truncate" title={record?.earlyNote || record?.lateNote}>
                        {record?.earlyNote ? (
                          <span className="text-sky-700 dark:text-sky-400">Early: {record.earlyNote}</span>
                        ) : record?.lateNote ? (
                          <span>Late: {record.lateNote}</span>
                        ) : '—'}
                      </td>
                      <td className="px-5 py-3 font-semibold text-amber-600">{member.points ?? 0}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
