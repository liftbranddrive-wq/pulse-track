import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import {
  formatPkTime,
  formatWorkedHours,
  initialsFrom,
  avatarRingClass,
} from '../utils/format';

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
    orange: 'text-orange-600',
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
  const [msg, setMsg] = useState('');

  function loadReport() {
    return api({ endpoint: '/api/attendance/report' })
      .then(setReport)
      .catch(() => setReport([]))
      .finally(() => setLoading(false));
  }

  async function clearLeaveMark(member) {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' });
    if (!window.confirm(`Remove ON_LEAVE mark for ${member.name} today (${today})? They can clock in if working.`)) return;
    await api({
      endpoint: '/api/leave/clear-day',
      method: 'POST',
      body: { userId: member.id, date: today, reason: 'Admin cleared from attendance page' },
    });
    setMsg(`Leave mark cleared for ${member.name}.`);
    await loadReport();
    setTimeout(() => setMsg(''), 3000);
  }

  useEffect(() => {
    loadReport();
    const t = setInterval(loadReport, 30_000);
    return () => clearInterval(t);
  }, []);

  const stats = {
    present: report.filter((r) => r.record?.status === 'PRESENT').length,
    late: report.filter((r) => r.record?.status === 'LATE').length,
    halfDay: report.filter((r) => r.record?.status === 'HALF_DAY').length,
    absent: report.filter((r) => r.record?.status === 'ABSENT').length,
    onLeave: report.filter((r) => r.record?.status === 'ON_LEAVE').length,
    notClocked: report.filter((r) => !r.record || r.record.status === 'NOT_CLOCKED').length,
  };

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-ink">Attendance</h1>
        <p className="text-sm text-muted mt-1">
          Today&apos;s team attendance (Pakistan time) — each day closes at 11:59 PM · auto clock-out ·{' '}
          <Link to="/late-log" className="text-brand font-semibold hover:underline">
            View late notes log
          </Link>
        </p>
        {msg ? <p className="text-sm text-emerald-600 mt-2">{msg}</p> : null}
      </header>

      <section className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard title="Present" value={stats.present} tone="emerald" />
        <StatCard title="Late" value={stats.late} tone="amber" />
        <StatCard title="Half day" value={stats.halfDay} tone="orange" />
        <StatCard title="Absent" value={stats.absent} tone="rose" />
        <StatCard title="On leave" value={stats.onLeave} tone="sky" />
        <StatCard title="Not clocked" value={stats.notClocked} tone="slate" />
      </section>

      <section className="rounded-xl2 bg-surface border border-line shadow-soft overflow-hidden">
        <div className="px-5 py-4 border-b border-line">
          <h2 className="font-bold text-ink">Today&apos;s roster</h2>
          <p className="text-[11px] text-muted mt-1">
            Half day = worked at least half of required hours (e.g. 4h of 8h) but did not finish full day
          </p>
        </div>
        {loading ? (
          <p className="p-6 text-sm text-muted animate-pulse">Loading attendance…</p>
        ) : !report.length ? (
          <p className="p-6 text-sm text-muted">No team members found.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px] min-w-[860px]">
              <thead>
                <tr className="text-muted border-b border-line bg-page/50">
                  <th className="px-5 py-3 font-semibold">Member</th>
                  <th className="px-5 py-3 font-semibold">Status</th>
                  <th className="px-5 py-3 font-semibold">Clock in / out</th>
                  <th className="px-5 py-3 font-semibold">Time worked</th>
                  <th className="px-5 py-3 font-semibold">Pauses & breaks</th>
                  <th className="px-5 py-3 font-semibold">Notes</th>
                  <th className="px-5 py-3 font-semibold">Points</th>
                  <th className="px-5 py-3 font-semibold">Admin</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {report.map(({ member, record, timeline }) => {
                  const status = record?.status ?? 'NOT_CLOCKED';
                  const rowBorder =
                    status === 'PRESENT' ? 'border-l-4 border-l-emerald-400' :
                    status === 'LATE' ? 'border-l-4 border-l-amber-400' :
                    status === 'HALF_DAY' ? 'border-l-4 border-l-orange-400' :
                    status === 'ABSENT' ? 'border-l-4 border-l-rose-400' :
                    status === 'ON_LEAVE' ? 'border-l-4 border-l-sky-400' :
                    'border-l-4 border-l-transparent';

                  const worked = record?.totalHoursWorked ?? 0;
                  const required = record?.requiredHours ?? 8;

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
                      <td className="px-5 py-3 text-ink">
                        <div>
                          <span className="text-muted text-[11px]">In </span>
                          {record?.clockInTime ? formatPkTime(record.clockInTime) : '—'}
                          {record?.lateMinutes > 0 ? (
                            <span className="ml-1 text-amber-600 text-[11px]">+{record.lateMinutes}m late</span>
                          ) : null}
                        </div>
                        <div className="mt-0.5">
                          <span className="text-muted text-[11px]">Out </span>
                          {record?.clockOutTime
                            ? (
                              <>
                                {formatPkTime(record.clockOutTime)}
                                {record?.autoClockOut ? (
                                  <span className="ml-1 text-violet-600 text-[11px]">auto 11:59 PM</span>
                                ) : null}
                              </>
                            )
                            : record?.isLive
                              ? <span className="text-brand text-[11px]">working…</span>
                              : '—'}
                        </div>
                      </td>
                      <td className="px-5 py-3">
                        {worked > 0 || record?.isLive ? (
                          <div>
                            <div
                              className={
                                record?.isComplete
                                  ? 'text-emerald-600 font-bold'
                                  : status === 'HALF_DAY'
                                    ? 'text-orange-600 font-bold'
                                    : 'text-amber-600 font-semibold'
                              }
                            >
                              {formatWorkedHours(worked)}
                              {record?.isLive ? <span className="text-[11px] font-normal text-muted"> live</span> : null}
                            </div>
                            <div className="text-[11px] text-muted mt-0.5">
                              of {formatWorkedHours(required)} required
                              {record?.isComplete ? ' ✓' : ''}
                              {(record?.overtimeHours ?? 0) > 0 ? (
                                <span className="text-emerald-700"> · OT +{formatWorkedHours(record.overtimeHours)}</span>
                              ) : null}
                            </div>
                          </div>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="px-5 py-3 text-[11px] text-muted max-w-[240px]">
                        {!timeline?.length ? (
                          '—'
                        ) : (
                          <ul className="space-y-1">
                            {timeline.slice(0, 4).map((ev, i) => (
                              <li key={`${ev.kind}-${ev.startedAt}-${i}`}>
                                <span
                                  className={
                                    ev.kind === 'BREAK'
                                      ? 'text-sky-700 font-medium'
                                      : ev.kind === 'PAUSE'
                                        ? 'text-violet-700 font-medium'
                                        : 'text-amber-700'
                                  }
                                >
                                  {ev.label}
                                </span>
                                {' '}
                                {ev.startFormatted} → {ev.endFormatted}
                              </li>
                            ))}
                            {timeline.length > 4 ? (
                              <li className="text-muted">+{timeline.length - 4} more</li>
                            ) : null}
                          </ul>
                        )}
                      </td>
                      <td className="px-5 py-3 text-muted max-w-[220px] truncate" title={record?.earlyNote || record?.lateNote}>
                        {record?.workShiftLabel ? (
                          <span className="block text-violet-700 font-medium text-[11px] mb-0.5">
                            {record.workShiftLabel === 'PREV_DAY_CONTINUE'
                              ? '🌙 Continued after midnight'
                              : record.workShiftLabel === 'NIGHT_NEW_DAY'
                                ? '🌙 Started early (after midnight)'
                                : `Shift: ${record.workShiftLabel.replace(/_/g, ' ')}`}
                          </span>
                        ) : null}
                        {record?.earlyNote ? (
                          <span className="text-sky-700">Early: {record.earlyNote}</span>
                        ) : record?.lateNote ? (
                          <Link to="/late-log" className="text-amber-800 hover:underline">
                            Late: {record.lateNote}
                          </Link>
                        ) : (
                          !record?.workShiftLabel ? '—' : null
                        )}
                      </td>
                      <td className="px-5 py-3 font-semibold text-amber-600">{member.points ?? 0}</td>
                      <td className="px-5 py-3">
                        {status === 'ON_LEAVE' ? (
                          <button
                            type="button"
                            onClick={() => clearLeaveMark(member)}
                            className="text-[11px] font-semibold text-brand hover:underline"
                          >
                            Clear leave
                          </button>
                        ) : (
                          '—'
                        )}
                      </td>
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
