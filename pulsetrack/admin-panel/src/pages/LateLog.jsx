import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { formatPkDate, formatPkTime, formatWorkedHours, initialsFrom, avatarRingClass } from '../utils/format';

export default function LateLog() {
  const [rows, setRows] = useState([]);
  const [days, setDays] = useState(30);

  async function load() {
    const data = await api({ endpoint: `/api/attendance/late-log?days=${days}` });
    setRows(data);
  }

  useEffect(() => {
    load().catch(() => setRows([]));
  }, [days]);

  const todayKey = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' });
  const todayRows = rows.filter((r) => {
    if (!r.date) return false;
    return new Date(r.date).toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' }) === todayKey;
  });

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-ink">Late clock-in log</h1>
          <p className="text-sm text-muted mt-1">
            Members who clocked in after the grace period — includes their late reason note and hours worked that day.
          </p>
        </div>
        <select
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
          className="rounded-lg border border-line px-3 py-2 text-[13px]"
        >
          <option value={7}>Last 7 days</option>
          <option value={30}>Last 30 days</option>
          <option value={90}>Last 90 days</option>
        </select>
      </header>

      {todayRows.length > 0 ? (
        <section className="rounded-xl2 border border-amber-200 bg-amber-50/40 p-5">
          <h2 className="font-bold text-ink mb-3">Today ({todayRows.length})</h2>
          <div className="space-y-3">
            {todayRows.map((r) => (
              <LateRow key={r.id} row={r} highlight />
            ))}
          </div>
        </section>
      ) : null}

      <section className="space-y-4">
        <h2 className="text-lg font-bold text-ink">History ({rows.length})</h2>
        {!rows.length ? (
          <div className="rounded-xl2 border border-line bg-surface p-8 text-center text-muted text-sm">
            No late clock-ins in this period.
          </div>
        ) : (
          rows.map((r) => <LateRow key={r.id} row={r} />)
        )}
      </section>
    </div>
  );
}

function LateRow({ row: r, highlight }) {
  const req = r.requiredHours ?? 8;
  const worked = r.totalHoursWorked ?? 0;
  const halfMin = req / 2;

  return (
    <div
      className={`rounded-xl2 border shadow-soft p-5 ${
        highlight ? 'border-amber-300 bg-surface' : 'border-line bg-surface'
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div
            className={`w-10 h-10 rounded-full flex items-center justify-center text-[11px] font-bold ${avatarRingClass(r.user.email)}`}
          >
            {initialsFrom(r.user.name, r.user.email)}
          </div>
          <div>
            <Link to={`/members/${r.user.id}`} className="font-bold text-ink hover:text-brand">
              {r.user.name}
            </Link>
            <div className="text-[12px] text-muted">
              {formatPkDate(r.date)}
              {' · '}
              Clocked in {formatPkTime(r.clockInTime)}
              {r.lateMinutes > 0 ? (
                <span className="text-amber-700 font-semibold"> · {r.lateMinutes}m late</span>
              ) : null}
            </div>
          </div>
        </div>
        <div className="text-right text-[13px]">
          <div className="font-bold text-ink">{formatWorkedHours(worked)} worked</div>
          <div className="text-[11px] text-muted mt-0.5">
            Required {formatWorkedHours(req)}
            {r.isComplete ? (
              <span className="text-emerald-600 font-semibold"> · Complete ✓</span>
            ) : worked >= halfMin ? (
              <span className="text-orange-600 font-semibold"> · Half day</span>
            ) : worked > 0 ? (
              <span className="text-amber-600"> · Short {formatWorkedHours(req - worked)}</span>
            ) : r.clockOutTime ? (
              <span> · No active time</span>
            ) : (
              <span> · In progress</span>
            )}
          </div>
          {r.clockOutTime ? (
            <div className="text-[11px] text-muted mt-1">Clock out {formatPkTime(r.clockOutTime)}</div>
          ) : null}
        </div>
      </div>
      {r.lateNote ? (
        <p className="mt-3 text-[13px] text-ink/80 bg-page/80 rounded-lg p-3 border border-line/60">
          <span className="text-muted font-semibold">Late note: </span>
          {r.lateNote}
        </p>
      ) : (
        <p className="mt-3 text-[12px] text-muted italic">No late note saved.</p>
      )}
    </div>
  );
}
