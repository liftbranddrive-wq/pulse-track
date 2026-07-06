import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Copy,
  Check,
  RefreshCw,
  MessageSquare,
  TrendingUp,
  AlertTriangle,
  Star,
  Search,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { api } from '../lib/api';
import { initialsFrom, avatarRingClass, formatWorkedHours } from '../utils/format';

const TIER_META = {
  excellent: {
    label: 'Excellent',
    tone: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300 ring-emerald-200/80',
    icon: Star,
  },
  good: {
    label: 'Good',
    tone: 'bg-sky-100 text-sky-800 dark:bg-sky-950/50 dark:text-sky-300 ring-sky-200/80',
    icon: TrendingUp,
  },
  needs_improvement: {
    label: 'Needs focus',
    tone: 'bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-300 ring-amber-200/80',
    icon: AlertTriangle,
  },
  critical: {
    label: 'Critical',
    tone: 'bg-rose-100 text-rose-800 dark:bg-rose-950/50 dark:text-rose-300 ring-rose-200/80',
    icon: AlertTriangle,
  },
  no_data: {
    label: 'No data',
    tone: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400 ring-slate-200/80',
    icon: MessageSquare,
  },
};

function TierBadge({ tier }) {
  const meta = TIER_META[tier] || TIER_META.needs_improvement;
  const Icon = meta.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold ring-1 ${meta.tone}`}>
      <Icon className="w-3 h-3" />
      {meta.label}
    </span>
  );
}

function CopyButton({ text, label = 'Copy message' }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold bg-brand text-white hover:opacity-90 transition"
    >
      {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
      {copied ? 'Copied!' : label}
    </button>
  );
}

function MemberCard({ report, defaultOpen }) {
  const [open, setOpen] = useState(defaultOpen);
  const s = report.summary;

  return (
    <article className="rounded-xl2 border border-line bg-surface shadow-soft overflow-hidden">
      <div className="p-5 flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <div
            className={`w-11 h-11 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 ${avatarRingClass(report.user.email)}`}
          >
            {initialsFrom(report.user.name, report.user.email)}
          </div>
          <div className="min-w-0">
            <div className="font-bold text-ink flex flex-wrap items-center gap-2">
              {report.user.name}
              <TierBadge tier={report.tier} />
            </div>
            <div className="text-[12px] text-muted mt-0.5">
              {formatWorkedHours(s.totalHoursWorked)} worked
              {s.hoursShort > 0 ? (
                <span className="text-rose-600 dark:text-rose-400 font-semibold">
                  {' '}
                  · short {formatWorkedHours(s.hoursShort)}
                </span>
              ) : (
                <span className="text-emerald-600 dark:text-emerald-400 font-semibold"> · target met</span>
              )}
              {(s.missedDays ?? 0) > 0 ? (
                <span className="text-rose-600 font-semibold"> · {s.missedDays} no clock-in</span>
              ) : null}
              {' · '}
              {s.completionPct}% · {s.pointsNet >= 0 ? '+' : ''}
              {s.pointsNet} pts
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <CopyButton text={report.message} />
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="p-2 rounded-lg border border-line text-muted hover:text-ink transition"
            title={open ? 'Collapse' : 'Expand'}
          >
            {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {open ? (
        <div className="border-t border-line px-5 py-4 space-y-4 bg-page/40">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-[12px]">
            <Stat label="Required" value={formatWorkedHours(s.expectedHours)} />
            <Stat label="Complete days" value={`${s.completeDays} / ${s.workDays}`} />
            <Stat label="Late / Absent" value={`${s.lateDays} / ${s.absentDays + (s.missedDays ?? 0)}`} />
            <Stat label="Points balance" value={`${s.totalPoints} pts`} />
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="text-muted text-left border-b border-line">
                  <th className="py-2 pr-3 font-semibold">Day</th>
                  <th className="py-2 pr-3 font-semibold">Worked</th>
                  <th className="py-2 pr-3 font-semibold">Required</th>
                  <th className="py-2 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {report.days.map((d) => (
                  <tr key={d.dateKey} className="border-b border-line/60">
                    <td className="py-2 pr-3 text-ink font-medium">{d.dayName}</td>
                    <td className="py-2 pr-3">{formatWorkedHours(d.worked)}</td>
                    <td className="py-2 pr-3">{formatWorkedHours(d.required)}</td>
                    <td className="py-2">
                      <DayStatus day={d} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div>
            <div className="text-[11px] font-semibold text-muted uppercase tracking-wide mb-2">
              WhatsApp message (copy & share)
            </div>
            <pre className="text-[12px] leading-relaxed whitespace-pre-wrap font-sans text-ink/90 bg-surface rounded-xl border border-line p-4 max-h-80 overflow-y-auto">
              {report.message}
            </pre>
          </div>
        </div>
      ) : null}
    </article>
  );
}

function Stat({ label, value }) {
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2">
      <div className="text-muted text-[10px] font-semibold uppercase tracking-wide">{label}</div>
      <div className="font-bold text-ink mt-0.5">{value}</div>
    </div>
  );
}

function DayStatus({ day: d }) {
  if (d.isHoliday || d.dayKind === 'holiday') return <span className="text-violet-600">Sunday off</span>;
  if (d.dayKind === 'leave' || d.status === 'ON_LEAVE') return <span className="text-sky-600">Approved leave</span>;
  if (d.dayKind === 'missed') return <span className="text-rose-600 font-semibold">No clock-in</span>;
  if (d.dayKind === 'absent' || d.status === 'ABSENT') return <span className="text-rose-600 font-semibold">Absent</span>;
  if (d.dayKind === 'pending') return <span className="text-muted">Pending</span>;
  if (d.isComplete) return <span className="text-emerald-600 font-semibold">Complete</span>;
  if (d.worked > 0) return <span className="text-amber-600">Short {formatWorkedHours(d.shortfall)}</span>;
  if (d.status === 'LATE') return <span className="text-amber-600">Late</span>;
  return <span className="text-muted">—</span>;
}

export default function WeeklyAccountability() {
  const [weeks, setWeeks] = useState([]);
  const [weekKey, setWeekKey] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [tierFilter, setTierFilter] = useState('all');
  const [copiedAll, setCopiedAll] = useState(false);

  const loadWeeks = useCallback(async () => {
    const w = await api({ endpoint: '/api/admin/weekly-accountability/weeks' });
    setWeeks(w.weeks || []);
    if (!weekKey && w.weeks?.length) {
      const prev = w.weeks[1] || w.weeks[0];
      setWeekKey(prev.weekKey);
    }
  }, [weekKey]);

  const loadReport = useCallback(async (key) => {
    if (!key) return;
    setLoading(true);
    setError('');
    try {
      const report = await api({ endpoint: `/api/admin/weekly-accountability?weekStart=${key}` });
      setData(report);
    } catch (e) {
      setError(e.message || 'Could not load report');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadWeeks().catch(() => {});
  }, [loadWeeks]);

  useEffect(() => {
    if (weekKey) loadReport(weekKey).catch(() => {});
  }, [weekKey, loadReport]);

  const filtered = useMemo(() => {
    if (!data?.reports) return [];
    const q = search.trim().toLowerCase();
    return data.reports.filter((r) => {
      if (tierFilter !== 'all' && r.tier !== tierFilter) return false;
      if (!q) return true;
      return (
        r.user.name.toLowerCase().includes(q) ||
        r.user.email.toLowerCase().includes(q)
      );
    });
  }, [data, search, tierFilter]);

  async function copyAll() {
    if (!filtered.length) return;
    const text = filtered
      .map((r) => `━━━ ${r.user.name} ━━━\n\n${r.message}`)
      .join('\n\n\n');
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setCopiedAll(true);
    setTimeout(() => setCopiedAll(false), 2000);
  }

  const team = data?.team;

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-ink">Weekly accountability</h1>
          <p className="text-sm text-muted mt-1 max-w-2xl">
            Copy-ready WhatsApp messages for each team member — hours, shortfalls, points, and
            personalized feedback. Auto-refreshes every Monday at 1:00 PM (Pakistan time). Pick any
            past week for historical reviews.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={weekKey}
            onChange={(e) => setWeekKey(e.target.value)}
            className="rounded-lg border border-line px-3 py-2 text-[13px] bg-surface min-w-[220px]"
          >
            {weeks.map((w) => (
              <option key={w.weekKey} value={w.weekKey}>
                {w.label}
                {w.isCurrent ? ' (this week)' : ''}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => loadReport(weekKey)}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-line text-[13px] font-medium hover:bg-black/[0.04] transition disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </header>

      {error ? (
        <div className="rounded-xl2 border border-rose-200 bg-rose-50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-300 px-4 py-3 text-sm">
          {error}
        </div>
      ) : null}

      {team ? (
        <section className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <TeamStat label="Team avg" value={`${team.avgCompletion}%`} />
          <TeamStat label="Hours worked" value={formatWorkedHours(team.totalHoursWorked)} />
          <TeamStat label="Total shortfall" value={formatWorkedHours(team.totalShortfall)} highlight={team.totalShortfall > 0} />
          <TeamStat label="Excellent" value={team.excellent} tone="emerald" />
          <TeamStat label="Needs focus" value={team.needsImprovement} tone="amber" />
          <TeamStat label="Critical" value={team.critical} tone="rose" />
        </section>
      ) : null}

      <section className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" />
          <input
            type="search"
            placeholder="Search member…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 rounded-lg border border-line text-[13px] bg-surface"
          />
        </div>
        <select
          value={tierFilter}
          onChange={(e) => setTierFilter(e.target.value)}
          className="rounded-lg border border-line px-3 py-2 text-[13px] bg-surface"
        >
          <option value="all">All tiers</option>
          <option value="excellent">Excellent</option>
          <option value="good">Good</option>
          <option value="needs_improvement">Needs focus</option>
          <option value="critical">Critical</option>
        </select>
        <button
          type="button"
          onClick={copyAll}
          disabled={!filtered.length}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-ink text-white dark:bg-slate-100 dark:text-slate-900 text-[13px] font-semibold hover:opacity-90 transition disabled:opacity-40"
        >
          {copiedAll ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
          {copiedAll ? 'All copied!' : `Copy all (${filtered.length})`}
        </button>
      </section>

      {loading && !data ? (
        <div className="rounded-xl2 border border-line bg-surface p-12 text-center text-muted text-sm">
          Generating weekly reports…
        </div>
      ) : !filtered.length ? (
        <div className="rounded-xl2 border border-line bg-surface p-12 text-center text-muted text-sm">
          No members match your filters.
        </div>
      ) : (
        <div className="space-y-4">
          {filtered.map((r, i) => (
            <MemberCard key={r.user.id} report={r} defaultOpen={i === 0 && filtered.length <= 3} />
          ))}
        </div>
      )}

      <section className="rounded-xl2 border border-line bg-surface p-5 text-[13px] text-muted leading-relaxed max-w-3xl space-y-3">
        <h2 className="font-bold text-ink">How it works</h2>
        <ul className="list-disc pl-5 space-y-1.5">
          <li>
            <strong className="text-ink">Working days: Monday–Saturday.</strong> Sunday is the only
            weekly off day and is excluded from hours and ratings.
          </li>
          <li>
            <strong className="text-ink">No clock-in on a work day</strong> (including Saturday)
            counts as absent and lowers the rating — even if the system did not auto-mark absent.
          </li>
          <li>
            <strong className="text-ink">Approved leave</strong> is excluded — add leave in{' '}
            <strong className="text-ink">Leave Management</strong> before the week is reviewed.
          </li>
          <li>
            Tap <strong className="text-ink">Copy message</strong> and paste into WhatsApp. Messages
            are built from real attendance, hours, and points — no AI.
          </li>
        </ul>
      </section>
    </div>
  );
}

function TeamStat({ label, value, tone, highlight }) {
  const color =
    tone === 'emerald'
      ? 'text-emerald-600'
      : tone === 'amber'
        ? 'text-amber-600'
        : tone === 'rose'
          ? 'text-rose-600'
          : highlight
            ? 'text-rose-600'
            : 'text-ink';
  return (
    <div className="rounded-xl2 border border-line bg-surface px-4 py-3">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted">{label}</div>
      <div className={`text-xl font-bold mt-1 ${color}`}>{value}</div>
    </div>
  );
}
