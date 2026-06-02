import React, { useEffect, useState } from 'react';
import { api } from '../lib/api';

export default function Schedule() {
  const [org, setOrg] = useState(null);
  const [announcement, setAnnouncement] = useState('');
  const [msg, setMsg] = useState('');

  useEffect(() => {
    api({ endpoint: '/api/admin/org' }).then(setOrg).catch(() => setOrg({}));
  }, []);

  async function save(e) {
    e.preventDefault();
    const fd = new FormData(e.target);
    const body = {
      expectedWindowStartMin: Number(fd.get('startMin')),
      expectedWindowEndMin: Number(fd.get('endMin')),
      requiredHoursMin: Number(fd.get('requiredHours')) * 60,
      graceMinutes: Number(fd.get('grace')),
      clockInWindowBeforeMin: Number(fd.get('windowBefore')),
      clockInWindowAfterMin: Number(fd.get('windowAfter')),
      maxEarlyStartMin: Number(fd.get('maxEarly')),
      heartbeatTimeoutMin: Number(fd.get('heartbeatTimeout')),
      activityChallengeEnabled: fd.get('challengeEnabled') === 'on',
      activityChallengeIntervalMin: Number(fd.get('challengeInterval')),
    };
    const res = await api({ endpoint: '/api/attendance/schedule/set', method: 'POST', body });
    setOrg(res.org);
    setAnnouncement(res.announcement);
    setMsg('Schedule saved');
    setTimeout(() => setMsg(''), 2000);
  }

  function copyAnnouncement() {
    navigator.clipboard.writeText(announcement).then(() => {
      setMsg('Copied to clipboard — paste in company group');
      setTimeout(() => setMsg(''), 2000);
    });
  }

  if (!org) return <p className="text-muted text-sm">Loading schedule…</p>;

  const startH = Math.floor((org.expectedWindowStartMin ?? 540) / 60);
  const startM = (org.expectedWindowStartMin ?? 540) % 60;
  const endH = Math.floor((org.expectedWindowEndMin ?? 1080) / 60);
  const endM = (org.expectedWindowEndMin ?? 1080) % 60;

  return (
    <div className="space-y-8 max-w-xl">
      <header>
        <h1 className="text-2xl font-bold text-ink">Work schedule</h1>
        <p className="text-sm text-muted mt-1">Set clock-in/out times, grace period, and anti-cheat settings</p>
        {msg ? <p className="text-sm text-emerald-600 mt-2">{msg}</p> : null}
      </header>

      <form onSubmit={save} className="rounded-xl2 border border-line bg-surface shadow-soft p-6 space-y-4 text-[13px]">
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-muted font-medium">Clock-in (hour UTC)</span>
            <input name="startMin" type="number" defaultValue={startH * 60 + startM} className="mt-1 w-full rounded-lg border border-line px-3 py-2" />
            <span className="text-[11px] text-muted">Minutes from midnight UTC (540 = 9:00)</span>
          </label>
          <label className="block">
            <span className="text-muted font-medium">Clock-out target (min UTC)</span>
            <input name="endMin" type="number" defaultValue={endH * 60 + endM} className="mt-1 w-full rounded-lg border border-line px-3 py-2" />
          </label>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <label className="block">
            <span className="text-muted font-medium">Required hours</span>
            <input name="requiredHours" type="number" step="0.5" defaultValue={(org.requiredHoursMin ?? 480) / 60} className="mt-1 w-full rounded-lg border border-line px-3 py-2" />
          </label>
          <label className="block">
            <span className="text-muted font-medium">Grace (min)</span>
            <input name="grace" type="number" defaultValue={org.graceMinutes ?? 5} className="mt-1 w-full rounded-lg border border-line px-3 py-2" />
          </label>
          <label className="block">
            <span className="text-muted font-medium">Heartbeat timeout</span>
            <input name="heartbeatTimeout" type="number" defaultValue={org.heartbeatTimeoutMin ?? 15} className="mt-1 w-full rounded-lg border border-line px-3 py-2" />
          </label>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <label className="block">
            <span className="text-muted font-medium">Window before (min)</span>
            <input name="windowBefore" type="number" defaultValue={org.clockInWindowBeforeMin ?? 30} className="mt-1 w-full rounded-lg border border-line px-3 py-2" />
          </label>
          <label className="block">
            <span className="text-muted font-medium">Window after (min)</span>
            <input name="windowAfter" type="number" defaultValue={org.clockInWindowAfterMin ?? 120} className="mt-1 w-full rounded-lg border border-line px-3 py-2" />
          </label>
          <label className="block">
            <span className="text-muted font-medium">Max early (min)</span>
            <input name="maxEarly" type="number" defaultValue={org.maxEarlyStartMin ?? 240} className="mt-1 w-full rounded-lg border border-line px-3 py-2" />
            <span className="text-[11px] text-muted">How far before schedule members may clock in early with a note (240 = 4h)</span>
          </label>
        </div>
        <label className="flex items-center gap-2">
          <input type="checkbox" name="challengeEnabled" defaultChecked={org.activityChallengeEnabled} />
          <span>Require periodic activity confirmation</span>
        </label>
        <label className="block">
          <span className="text-muted font-medium">Challenge interval (min)</span>
          <input name="challengeInterval" type="number" defaultValue={org.activityChallengeIntervalMin ?? 45} className="mt-1 w-full rounded-lg border border-line px-3 py-2" />
        </label>
        <button type="submit" className="w-full py-2.5 rounded-xl bg-brand text-white font-semibold hover:opacity-90">
          Save schedule
        </button>
      </form>

      {announcement ? (
        <div className="rounded-xl2 border border-line bg-surface p-5">
          <h2 className="font-bold text-ink mb-2">Company group announcement</h2>
          <pre className="text-[12px] text-muted whitespace-pre-wrap bg-page rounded-lg p-4">{announcement}</pre>
          <button type="button" onClick={copyAnnouncement} className="mt-3 px-4 py-2 rounded-xl border border-line text-[13px] font-semibold hover:bg-page">
            Copy to clipboard
          </button>
        </div>
      ) : null}
    </div>
  );
}
