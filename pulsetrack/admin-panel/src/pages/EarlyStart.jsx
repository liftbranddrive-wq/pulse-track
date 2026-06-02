import React, { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { initialsFrom, avatarRingClass } from '../utils/format';

export default function EarlyStart() {
  const [rows, setRows] = useState([]);
  const [days, setDays] = useState(30);

  async function load() {
    const data = await api({ endpoint: `/api/early-start/log?days=${days}` });
    setRows(data);
  }

  useEffect(() => {
    load().catch(() => {});
  }, [days]);

  const todayKey = new Date().toISOString().slice(0, 10);
  const todayRows = rows.filter((r) => r.date?.slice?.(0, 10) === todayKey);

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-ink">Early start log</h1>
          <p className="text-sm text-muted mt-1">
            Members who clock in before the normal window leave a note — no approval required. They must still complete full required hours.
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
        <section className="rounded-xl2 border border-sky-200 dark:border-sky-900/40 bg-sky-50/30 dark:bg-sky-950/20 p-5">
          <h2 className="font-bold text-ink mb-3">Today ({todayRows.length})</h2>
          <div className="space-y-3">
            {todayRows.map((r) => (
              <EarlyRow key={r.id} row={r} highlight />
            ))}
          </div>
        </section>
      ) : null}

      <section className="space-y-4">
        <h2 className="text-lg font-bold text-ink">History ({rows.length})</h2>
        {!rows.length ? (
          <div className="rounded-xl2 border border-line bg-surface p-8 text-center text-muted text-sm">
            No early starts in this period.
          </div>
        ) : (
          rows.map((r) => <EarlyRow key={r.id} row={r} />)
        )}
      </section>

      <section className="rounded-xl2 border border-line bg-surface p-5 text-[13px] text-muted leading-relaxed max-w-2xl">
        <h2 className="font-bold text-ink mb-2">How it works</h2>
        <ul className="list-disc pl-5 space-y-1">
          <li>Normal clock-in opens 30 minutes before schedule (configurable in Schedule).</li>
          <li>Before that window, members may clock in early with a note (min 20 characters) — no admin approval.</li>
          <li>Starting early does <strong>not</strong> shorten the day — they must complete required hours (7–8h by default).</li>
          <li>Hours completed / incomplete are tracked on clock-out and shown in Attendance.</li>
          <li>Max early limit is set in Schedule (default 4 hours before normal start).</li>
        </ul>
      </section>
    </div>
  );
}

function EarlyRow({ row: r, highlight }) {
  const req = r.requiredHours ?? 8;
  const worked = r.totalHoursWorked ?? 0;
  const done = r.isComplete;
  const expectedOut = r.clockInTime
    ? new Date(new Date(r.clockInTime).getTime() + req * 3_600_000)
    : null;

  return (
    <div className={`rounded-xl2 border shadow-soft p-5 ${highlight ? 'border-sky-300 dark:border-sky-800 bg-surface' : 'border-line bg-surface'}`}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-full flex items-center justify-center text-[11px] font-bold ${avatarRingClass(r.user.email)}`}>
            {initialsFrom(r.user.name, r.user.email)}
          </div>
          <div>
            <div className="font-bold text-ink">{r.user.name}</div>
            <div className="text-[12px] text-muted">
              {new Date(r.date).toLocaleDateString()}
              {' · '}
              Clocked in {r.clockInTime ? new Date(r.clockInTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) + ' UTC' : '—'}
              {r.earlyMinutes > 0 ? (
                <span className="text-sky-700 dark:text-sky-400 font-semibold"> · {r.earlyMinutes}m early</span>
              ) : null}
            </div>
          </div>
        </div>
        <div className="text-right text-[13px]">
          <div className={done ? 'text-emerald-600 font-bold' : worked > 0 ? 'text-amber-600 font-bold' : 'text-muted'}>
            {worked > 0 ? `${worked.toFixed(1)}h / ${req}h` : `Required: ${req}h`}
            {done ? ' ✓ Complete' : worked > 0 ? ` · Short ${(req - worked).toFixed(1)}h` : r.clockOutTime ? '' : ' · In progress'}
          </div>
          {expectedOut && !r.clockOutTime ? (
            <div className="text-[11px] text-muted mt-1">Must finish by {expectedOut.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })} UTC</div>
          ) : null}
        </div>
      </div>
      {r.earlyNote ? (
        <p className="mt-3 text-[13px] text-ink/80 bg-page/80 rounded-lg p-3 border border-line/60">
          <span className="text-muted font-semibold">Note: </span>{r.earlyNote}
        </p>
      ) : null}
    </div>
  );
}
