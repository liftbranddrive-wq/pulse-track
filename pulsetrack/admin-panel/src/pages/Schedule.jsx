import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import TermsGlossary from '../components/TermsGlossary';
import LiveOrgClock from '../components/LiveOrgClock';
import {
  formatMinutesFriendly,
  isOvernightEnd,
  minutesToTimeValue,
  timeValueToMinutes,
} from '../utils/scheduleTime';

const TZ_LABELS = {
  'Asia/Islamabad': 'Pakistan (Islamabad / Lahore / Karachi) — UTC+5',
  'Asia/Karachi': 'Pakistan (same as Islamabad) — UTC+5',
  UTC: 'UTC',
};

function orgToForm(org) {
  const clockIn = org.expectedWindowStartMin ?? 540;
  const clockOut = org.expectedWindowEndMin ?? 1080;
  const windowBefore = org.clockInWindowBeforeMin ?? 30;
  const windowAfter = org.clockInWindowAfterMin ?? 120;
  const maxEarly = org.maxEarlyStartMin ?? 240;
  return {
    clockInTime: minutesToTimeValue(clockIn),
    clockOutTime: minutesToTimeValue(clockOut),
    earliestTime: minutesToTimeValue(Math.max(0, clockIn - maxEarly)),
    normalOpensTime: minutesToTimeValue(Math.max(0, clockIn - windowBefore)),
    latestTime: minutesToTimeValue(clockIn + windowAfter),
    requiredHours: String((org.requiredHoursMin ?? 480) / 60),
    grace: String(org.graceMinutes ?? 5),
    heartbeatTimeout: String(org.heartbeatTimeoutMin ?? 15),
    challengeEnabled: !!org.activityChallengeEnabled,
    challengeInterval: String(org.activityChallengeIntervalMin ?? 45),
  };
}

export default function Schedule() {
  const [org, setOrg] = useState(null);
  const [form, setForm] = useState(null);
  const [announcement, setAnnouncement] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);

  async function loadOrg() {
    const data = await api({ endpoint: '/api/admin/org' });
    setOrg(data);
    setForm(orgToForm(data));
  }

  useEffect(() => {
    loadOrg().catch(() => {
      setOrg({});
      setForm(orgToForm({}));
    });
  }, []);

  const tz = org?.timezone ?? 'Asia/Islamabad';
  const tzLabel = TZ_LABELS[tz] ?? tz;

  const preview = useMemo(() => {
    if (!form) return null;
    const clockIn = timeValueToMinutes(form.clockInTime);
    const earliest = timeValueToMinutes(form.earliestTime);
    const normalOpens = timeValueToMinutes(form.normalOpensTime);
    const latest = timeValueToMinutes(form.latestTime);
    const clockOut = timeValueToMinutes(form.clockOutTime);
    return {
      clockIn,
      clockOut,
      earliestWithNote: earliest,
      normalOpens,
      latestLate: latest,
      overnight: isOvernightEnd(clockIn, clockOut),
    };
  }, [form]);

  function setField(name, value) {
    if (name === 'clockInTime') {
      setForm((prev) => {
        const oldClockIn = timeValueToMinutes(prev.clockInTime);
        const newClockIn = timeValueToMinutes(value);
        const delta = newClockIn - oldClockIn;
        if (delta === 0) return { ...prev, clockInTime: value };
        const shift = (t) => minutesToTimeValue(timeValueToMinutes(t) + delta);
        return {
          ...prev,
          clockInTime: value,
          earliestTime: shift(prev.earliestTime),
          normalOpensTime: shift(prev.normalOpensTime),
          latestTime: shift(prev.latestTime),
        };
      });
      return;
    }
    setForm((prev) => ({ ...prev, [name]: value }));
  }

  async function save(e) {
    e.preventDefault();
    setErr('');
    setMsg('');

    const clockInMin = timeValueToMinutes(form.clockInTime);
    const clockOutMin = timeValueToMinutes(form.clockOutTime);
    const earliestMin = timeValueToMinutes(form.earliestTime);
    const normalOpensMin = timeValueToMinutes(form.normalOpensTime);
    const latestMin = timeValueToMinutes(form.latestTime);

    if (earliestMin > normalOpensMin) {
      setErr('“Earliest (note required)” must be at or before “Normal window opens”.');
      return;
    }
    if (normalOpensMin > clockInMin) {
      setErr('“Normal window opens” must be at or before official clock-in time.');
      return;
    }
    if (latestMin < clockInMin) {
      setErr('“Latest late clock-in” must be at or after official clock-in time.');
      return;
    }

    const maxEarlyStartMin = clockInMin - earliestMin;
    const clockInWindowBeforeMin = clockInMin - normalOpensMin;
    const clockInWindowAfterMin = latestMin - clockInMin;
    const requiredHours = Number(form.requiredHours);

    if (!Number.isFinite(requiredHours) || requiredHours < 1 || requiredHours > 24) {
      setErr('Required hours must be between 1 and 24.');
      return;
    }

    const body = {
      expectedWindowStartMin: clockInMin,
      expectedWindowEndMin: clockOutMin,
      requiredHoursMin: Math.round(requiredHours * 60),
      graceMinutes: Number(form.grace),
      clockInWindowBeforeMin,
      clockInWindowAfterMin,
      maxEarlyStartMin,
      heartbeatTimeoutMin: Number(form.heartbeatTimeout),
      activityChallengeEnabled: form.challengeEnabled,
      activityChallengeIntervalMin: Number(form.challengeInterval),
      timezone: org?.timezone && org.timezone !== 'UTC' ? org.timezone : 'Asia/Karachi',
    };

    setSaving(true);
    try {
      const res = await api({ endpoint: '/api/attendance/schedule/set', method: 'POST', body });
      setOrg(res.org);
      setForm(orgToForm(res.org));
      setAnnouncement(res.announcement || '');
      setMsg('Schedule saved successfully');
      setTimeout(() => setMsg(''), 3000);
    } catch (ex) {
      setErr(ex.message || 'Could not save schedule. Try again.');
    } finally {
      setSaving(false);
    }
  }

  function copyAnnouncement() {
    navigator.clipboard.writeText(announcement).then(() => {
      setMsg('Copied to clipboard — paste in company group');
      setTimeout(() => setMsg(''), 2500);
    });
  }

  if (!org || !form || !preview) return <p className="text-muted text-sm">Loading schedule…</p>;

  return (
    <div className="space-y-8 max-w-2xl">
      <header>
        <h1 className="text-2xl font-bold text-ink">Work schedule</h1>
        <p className="text-sm text-muted mt-1">
          Pick real clock times in <strong className="text-ink">{tzLabel}</strong>. Change timezone under Settings if needed.
        </p>
        {msg ? <p className="text-sm text-emerald-600 mt-2 font-semibold">{msg}</p> : null}
        {err ? <p className="text-sm text-rose-600 mt-2 font-semibold">{err}</p> : null}
      </header>

      <LiveOrgClock timezone={tz} />

      {tz === 'UTC' ? (
        <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
          Timezone is still <strong>UTC</strong>. Go to <strong>Settings</strong> → pick <strong>Pakistan</strong> → Save, then save schedule again.
        </p>
      ) : null}

      <form onSubmit={save} className="rounded-xl2 border border-line bg-surface shadow-soft p-6 space-y-5 text-[13px]">
        <div className="rounded-lg bg-page/80 border border-line px-4 py-3 text-[12px] text-muted leading-relaxed">
          <strong className="text-ink">Tip:</strong> After you change <strong>clock-in</strong>, also move{' '}
          <strong>Normal window opens</strong> and <strong>Earliest</strong> if needed, then click{' '}
          <strong>Save schedule</strong>.
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          <TimeField
            label="Official clock-in time"
            name="clockInTime"
            value={form.clockInTime}
            onChange={setField}
            hint={`Scheduled start — ${formatMinutesFriendly(preview.clockIn)}`}
          />
          <TimeField
            label="Clock-out target time"
            name="clockOutTime"
            value={form.clockOutTime}
            onChange={setField}
            hint={
              preview.overnight
                ? `End of shift — ${formatMinutesFriendly(preview.clockOut)} (next calendar day)`
                : `End of shift — ${formatMinutesFriendly(preview.clockOut)}`
            }
          />
        </div>

        <div className="border-t border-line pt-4">
          <h2 className="font-bold text-ink text-sm mb-3">Clock-in window (who can clock in when)</h2>
          <div className="grid sm:grid-cols-1 gap-4">
            <TimeField
              label="Earliest clock-in (note required)"
              name="earliestTime"
              value={form.earliestTime}
              onChange={setField}
              hint="Before this time: blocked. From here until normal opens: early-start note required."
            />
            <TimeField
              label="Normal window opens (no note)"
              name="normalOpensTime"
              value={form.normalOpensTime}
              onChange={setField}
              hint="From here until official clock-in: on-time early, no note needed."
            />
            <TimeField
              label="Latest late clock-in allowed"
              name="latestTime"
              value={form.latestTime}
              onChange={setField}
              hint="After official clock-in + grace → member is late and must explain."
            />
          </div>
        </div>

        <div className="grid sm:grid-cols-3 gap-3">
          <label className="block">
            <span className="text-muted font-medium">Required hours per day</span>
            <input
              name="requiredHours"
              type="number"
              step="0.5"
              min="1"
              max="24"
              value={form.requiredHours}
              onChange={(e) => setField('requiredHours', e.target.value)}
              className="mt-1 w-full rounded-lg border border-line px-3 py-2"
            />
          </label>
          <label className="block">
            <span className="text-muted font-medium">Late grace (minutes)</span>
            <input
              name="grace"
              type="number"
              min="0"
              value={form.grace}
              onChange={(e) => setField('grace', e.target.value)}
              className="mt-1 w-full rounded-lg border border-line px-3 py-2"
            />
          </label>
          <label className="block">
            <span className="text-muted font-medium">Heartbeat timeout (min)</span>
            <input
              name="heartbeatTimeout"
              type="number"
              min="5"
              value={form.heartbeatTimeout}
              onChange={(e) => setField('heartbeatTimeout', e.target.value)}
              className="mt-1 w-full rounded-lg border border-line px-3 py-2"
            />
          </label>
        </div>

        <div className="rounded-lg border border-dashed border-line px-4 py-3 text-[12px] text-muted space-y-1">
          <div>
            <strong className="text-ink">Preview — today’s window:</strong>
          </div>
          <div>Earliest (with note): {formatMinutesFriendly(preview.earliestWithNote)}</div>
          <div>Opens normally: {formatMinutesFriendly(preview.normalOpens)}</div>
          <div>Official start: {formatMinutesFriendly(preview.clockIn)}</div>
          <div>Latest late: {formatMinutesFriendly(preview.latestLate)}</div>
        </div>

        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            name="challengeEnabled"
            checked={form.challengeEnabled}
            onChange={(e) => setField('challengeEnabled', e.target.checked)}
          />
          <span>Require periodic activity confirmation popup</span>
        </label>
        <label className="block">
          <span className="text-muted font-medium">Challenge interval (minutes)</span>
          <input
            name="challengeInterval"
            type="number"
            min="15"
            value={form.challengeInterval}
            onChange={(e) => setField('challengeInterval', e.target.value)}
            className="mt-1 w-full max-w-xs rounded-lg border border-line px-3 py-2"
          />
        </label>

        <button
          type="submit"
          disabled={saving}
          className="w-full py-2.5 rounded-xl bg-brand text-white font-semibold hover:opacity-90 disabled:opacity-60"
        >
          {saving ? 'Saving…' : 'Save schedule'}
        </button>
      </form>

      <TermsGlossary title="How time tracking works (share with your team)" />

      {announcement ? (
        <div className="rounded-xl2 border border-line bg-surface p-5">
          <h2 className="font-bold text-ink mb-2">Company group announcement</h2>
          <pre className="text-[12px] text-muted whitespace-pre-wrap bg-page rounded-lg p-4">{announcement}</pre>
          <button
            type="button"
            onClick={copyAnnouncement}
            className="mt-3 px-4 py-2 rounded-xl border border-line text-[13px] font-semibold hover:bg-page"
          >
            Copy to clipboard
          </button>
        </div>
      ) : null}
    </div>
  );
}

function TimeField({ label, name, value, onChange, hint }) {
  return (
    <label className="block">
      <span className="text-muted font-medium">{label}</span>
      <input
        name={name}
        type="time"
        value={value}
        onChange={(e) => onChange(name, e.target.value)}
        className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-[15px] font-medium"
        required
      />
      {hint ? <span className="text-[11px] text-muted block mt-1 leading-snug">{hint}</span> : null}
    </label>
  );
}
