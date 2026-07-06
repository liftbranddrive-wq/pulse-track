import React, { useEffect, useState } from 'react';
import { api } from '../lib/api';
import TermsGlossary from '../components/TermsGlossary';

export default function Settings() {
  const [org, setOrg] = useState(null);
  const [testEmail, setTestEmail] = useState('');
  const [msg, setMsg] = useState('');

  useEffect(() => {
    api({ endpoint: '/api/admin/org' }).then(setOrg).catch(() => setOrg({}));
  }, []);

  async function save(e) {
    e.preventDefault();
    const fd = new FormData(e.target);
    const body = {
      companyName: fd.get('companyName'),
      globalL1Min: Number(fd.get('l1')),
      globalL2Min: Number(fd.get('l2')),
      globalL3Min: Number(fd.get('l3')),
      timezone: fd.get('timezone'),
      allowMemberTimeEdits: fd.get('allowMemberTimeEdits') === 'on',
      weeklyTeamReportEnabled: fd.get('weeklyTeamReportEnabled') === 'on',
      dailySummaryEnabled: fd.get('dailySummaryEnabled') === 'on',
      individualWeeklyEnabled: fd.get('individualWeeklyEnabled') === 'on',
      flagAlertEnabled: fd.get('flagAlertEnabled') === 'on',
      absenteeAlertEnabled: fd.get('absenteeAlertEnabled') === 'on',
      weeklyReportRecipients: String(fd.get('weeklyReportRecipients') || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      adminSummaryRecipients: String(fd.get('adminSummaryRecipients') || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    };
    const next = await api({ endpoint: '/api/admin/org', method: 'PATCH', body });
    setOrg(next);
    setMsg('Saved');
    setTimeout(() => setMsg(''), 2000);
  }

  async function sendTest() {
    setMsg('');
    await api({
      endpoint: '/api/admin/email/test',
      method: 'POST',
      body: { to: testEmail },
    });
    setMsg('Test dispatched');
  }

  if (!org) return <p className="text-muted text-sm">Loading organization…</p>;

  const recips = Array.isArray(org.weeklyReportRecipients)
    ? org.weeklyReportRecipients.join(', ')
    : '';
  const adminRecips = Array.isArray(org.adminSummaryRecipients)
    ? org.adminSummaryRecipients.join(', ')
    : '';

  return (
    <div className="space-y-8 max-w-xl">
      <div>
        <h1 className="text-2xl font-bold text-ink tracking-tight">Organization & policy</h1>
        <p className="text-sm text-muted mt-1">Reminder ladder, mail toggles, and humane defaults</p>
      </div>
      <form className="space-y-5 text-[13px] rounded-xl2 border border-line bg-surface shadow-soft p-6" onSubmit={save}>
        <Field label="Company name" name="companyName" defaultValue={org.companyName} />

        <div className="grid grid-cols-3 gap-3">
          <Field
            label="Reminder 1 (minutes idle)"
            name="l1"
            defaultValue={org.globalL1Min ?? 5}
            type="number"
            hint="First nudge — “still working?”"
          />
          <Field
            label="Reminder 2 (idle)"
            name="l2"
            defaultValue={org.globalL2Min ?? 10}
            type="number"
            hint="Second warning before timer pauses"
          />
          <Field
            label="Ghost after (idle)"
            name="l3"
            defaultValue={org.globalL3Min ?? 15}
            type="number"
            hint="Active time pauses; ghost minutes logged"
          />
        </div>

        <label className="block">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">Timezone</span>
          <select
            name="timezone"
            defaultValue={org.timezone ?? 'Asia/Islamabad'}
            className="mt-1.5 w-full rounded-xl border border-line bg-page px-3 py-2.5 text-[13px]"
          >
            <option value="Asia/Islamabad">Pakistan — Islamabad / Lahore / Karachi (UTC+5)</option>
            <option value="Asia/Karachi">Pakistan — Karachi label (same UTC+5)</option>
            <option value="UTC">UTC</option>
          </select>
          <span className="text-[11px] text-muted mt-1 block">
            Schedule page clock times use this timezone. Islamabad and Karachi are the same offset in Pakistan.
          </span>
        </label>

        <label className="flex gap-3 text-muted items-start">
          <input type="checkbox" name="allowMemberTimeEdits" defaultChecked={org.allowMemberTimeEdits} className="mt-1 rounded border-line text-brand focus:ring-brand" />
          <span>Allow members to self-edit time entries</span>
        </label>

        <label className="flex gap-3 text-muted items-start">
          <input type="checkbox" name="weeklyTeamReportEnabled" defaultChecked={org.weeklyTeamReportEnabled} className="mt-1 rounded border-line text-brand focus:ring-brand" />
          <span>Weekly team email (Monday 09:00 UTC)</span>
        </label>

        <label className="flex gap-3 text-muted items-start">
          <input type="checkbox" name="individualWeeklyEnabled" defaultChecked={org.individualWeeklyEnabled !== false} className="mt-1 rounded border-line text-brand focus:ring-brand" />
          <span>Individual member week summary (Monday 09:00 UTC, members with email opt-in)</span>
        </label>

        <label className="flex gap-3 text-muted items-start">
          <input type="checkbox" name="dailySummaryEnabled" defaultChecked={org.dailySummaryEnabled} className="mt-1 rounded border-line text-brand focus:ring-brand" />
          <span>Daily admin summary (19:00 UTC)</span>
        </label>

        <label className="flex gap-3 text-muted items-start">
          <input type="checkbox" name="flagAlertEnabled" defaultChecked={org.flagAlertEnabled !== false} className="mt-1 rounded border-line text-brand focus:ring-brand" />
          <span>Instant flag alerts when a member hits ≥3 flags in a day or &gt;2h ghost (on clock-out)</span>
        </label>

        <label className="flex gap-3 text-muted items-start">
          <input type="checkbox" name="absenteeAlertEnabled" defaultChecked={org.absenteeAlertEnabled} className="mt-1 rounded border-line text-brand focus:ring-brand" />
          <span>Absentee reminder if no clock-in by 11:00 UTC (weekdays)</span>
        </label>

        <div>
          <label className="text-[11px] font-semibold uppercase tracking-wide text-muted">Weekly recipients</label>
          <input
            name="weeklyReportRecipients"
            defaultValue={recips}
            className="mt-1.5 w-full rounded-xl border border-line bg-page px-3 py-2.5 text-[13px] text-ink"
            placeholder="ops@yourcompany.com, hr@..."
          />
        </div>

        <div>
          <label className="text-[11px] font-semibold uppercase tracking-wide text-muted">Admin alert recipients (daily / absentee / flag emails; falls back to weekly list if empty)</label>
          <input
            name="adminSummaryRecipients"
            defaultValue={adminRecips}
            className="mt-1.5 w-full rounded-xl border border-line bg-page px-3 py-2.5 text-[13px] text-ink"
            placeholder="you@yourcompany.com"
          />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" className="rounded-xl bg-brand px-5 py-2.5 font-bold text-white hover:bg-teal-600 shadow-sm">
            Save policy
          </button>
          {msg ? <span className="text-brand text-[13px] font-semibold">{msg}</span> : null}
        </div>
      </form>

      <TermsGlossary title="Policy terms explained" />

      <div className="rounded-xl2 border border-line bg-surface shadow-soft p-6 space-y-3">
        <h2 className="text-ink font-bold">Email smoke test</h2>
        <p className="text-[12px] text-muted leading-relaxed">
          Wire SMTP or SendGrid through the org record (see README). This button still exercises the API path.
        </p>
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            className="flex-1 rounded-xl border border-line bg-page px-3 py-2.5 text-[13px]"
            placeholder="you@company.com"
            value={testEmail}
            onChange={(e) => setTestEmail(e.target.value)}
          />
          <button
            type="button"
            onClick={sendTest}
            className="rounded-xl border border-line bg-page px-4 py-2.5 text-[13px] font-bold hover:bg-black/[0.04]"
          >
            Send test mail
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, name, defaultValue, type = 'text', hint }) {
  return (
    <label className="block">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">{label}</span>
      <input
        name={name}
        type={type}
        defaultValue={defaultValue}
        className="mt-1.5 w-full rounded-xl border border-line bg-page px-3 py-2.5 text-[13px]"
      />
      {hint ? <span className="text-[11px] text-muted mt-1 block">{hint}</span> : null}
    </label>
  );
}
