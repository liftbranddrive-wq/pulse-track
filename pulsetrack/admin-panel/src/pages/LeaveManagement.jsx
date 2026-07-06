import React, { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { initialsFrom, avatarRingClass } from '../utils/format';

export default function LeaveManagement() {
  const [pending, setPending] = useState([]);
  const [approved, setApproved] = useState([]);
  const [balance, setBalance] = useState([]);
  const [msg, setMsg] = useState('');

  async function load() {
    const [p, a, b] = await Promise.all([
      api({ endpoint: '/api/leave/pending' }),
      api({ endpoint: '/api/leave/approved' }),
      api({ endpoint: '/api/leave/balance' }),
    ]);
    setPending(p);
    setApproved(a);
    setBalance(b);
  }

  useEffect(() => {
    load().catch(() => {});
  }, []);

  async function act(id, action) {
    const adminNote = window.prompt(action === 'approve' ? 'Optional admin note:' : 'Rejection reason (required):');
    if (action === 'reject' && (!adminNote || adminNote.length < 3)) return;
    await api({
      endpoint: `/api/leave/${id}/${action}`,
      method: 'PATCH',
      body: { adminNote: adminNote || undefined },
    });
    setMsg(action === 'approve' ? 'Leave approved' : 'Leave rejected');
    await load();
    setTimeout(() => setMsg(''), 2000);
  }

  async function cancelLeave(id, userName) {
    const adminNote = window.prompt(
      `Cancel approved leave for ${userName}? Optional note (e.g. they worked that day):`,
    );
    if (adminNote === null) return;
    const result = await api({
      endpoint: `/api/leave/${id}/cancel`,
      method: 'PATCH',
      body: { adminNote: adminNote || undefined },
    });
    setMsg(`Leave cancelled — cleared ${result.clearedDays ?? 0} day mark(s). Member can clock in again.`);
    await load();
    setTimeout(() => setMsg(''), 4000);
  }

  async function repairMember(userId, userName) {
    if (!window.confirm(`Fix stuck "on leave" marks for ${userName}? Use this if they still cannot clock in.`)) return;
    const result = await api({
      endpoint: `/api/leave/repair-stale/${userId}`,
      method: 'POST',
      body: { reason: 'Admin repair from leave page' },
    });
    setMsg(`Repaired ${result.fixed ?? 0} stale leave row(s) for ${userName}.`);
    setTimeout(() => setMsg(''), 4000);
  }

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-bold text-ink">Leave management</h1>
        <p className="text-sm text-muted mt-1">
          Approve or reject requests · cancel approved leave if someone worked anyway · repair stuck leave marks
        </p>
        {msg ? <p className="text-sm text-emerald-600 mt-2">{msg}</p> : null}
      </header>

      <section className="space-y-4">
        <h2 className="text-lg font-bold text-ink">Pending queue ({pending.length})</h2>
        {!pending.length ? (
          <div className="rounded-xl2 border border-line bg-surface p-8 text-center text-muted text-sm">
            No pending leave requests — all clear.
          </div>
        ) : (
          pending.map((l) => (
            <div
              key={l.id}
              className={`rounded-xl2 border shadow-soft p-5 ${l.isEmergency ? 'border-rose-300 bg-rose-50/30' : 'border-line bg-surface'}`}
            >
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center text-[11px] font-bold ${avatarRingClass(l.user.email)}`}>
                    {initialsFrom(l.user.name, l.user.email)}
                  </div>
                  <div>
                    <div className="font-bold text-ink">{l.user.name}</div>
                    <div className="text-[12px] text-muted">
                      {new Date(l.requestedDate).toLocaleDateString()}
                      {l.endDate ? ` → ${new Date(l.endDate).toLocaleDateString()}` : ''}
                      {' · '}
                      <span className="capitalize">{l.type.toLowerCase()}</span>
                      {l.isEmergency ? ' · 🚨 Emergency' : ''}
                    </div>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button type="button" onClick={() => act(l.id, 'approve')} className="px-4 py-2 rounded-xl bg-emerald-600 text-white text-[13px] font-semibold hover:bg-emerald-700">
                    Approve
                  </button>
                  <button type="button" onClick={() => act(l.id, 'reject')} className="px-4 py-2 rounded-xl border border-rose-200 text-rose-700 text-[13px] font-semibold hover:bg-rose-50">
                    Reject
                  </button>
                </div>
              </div>
              <p className="mt-3 text-[13px] text-ink/80 bg-page/80 rounded-lg p-3">{l.reason}</p>
              <p className="mt-2 text-[11px] text-muted">Submitted {new Date(l.submittedAt).toLocaleString()}</p>
            </div>
          ))
        )}
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-bold text-ink">Approved leave — cancel if they worked</h2>
        <p className="text-[12px] text-muted">
          Example: approved Monday off but they came in anyway — cancel here so they can clock in.
        </p>
        {!approved.length ? (
          <div className="rounded-xl2 border border-line bg-surface p-6 text-center text-muted text-sm">
            No active approved leaves on file.
          </div>
        ) : (
          <div className="rounded-xl2 border border-line bg-surface overflow-hidden">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-muted border-b border-line bg-page/50">
                  <th className="px-5 py-3 text-left font-semibold">Member</th>
                  <th className="px-5 py-3 text-left font-semibold">Dates</th>
                  <th className="px-5 py-3 text-left font-semibold">Type</th>
                  <th className="px-5 py-3 text-right font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {approved.map((l) => (
                  <tr key={l.id}>
                    <td className="px-5 py-3 font-medium text-ink">{l.user.name}</td>
                    <td className="px-5 py-3 text-muted">
                      {new Date(l.requestedDate).toLocaleDateString()}
                      {l.endDate ? ` → ${new Date(l.endDate).toLocaleDateString()}` : ''}
                    </td>
                    <td className="px-5 py-3 capitalize">{l.type.toLowerCase()}</td>
                    <td className="px-5 py-3 text-right space-x-3">
                      <button
                        type="button"
                        onClick={() => cancelLeave(l.id, l.user.name)}
                        className="text-[12px] font-semibold text-amber-700 hover:underline"
                      >
                        Cancel leave
                      </button>
                      <button
                        type="button"
                        onClick={() => repairMember(l.user.id, l.user.name)}
                        className="text-[12px] font-semibold text-brand hover:underline"
                      >
                        Fix stuck marks
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2 className="text-lg font-bold text-ink mb-4">Leave used this year</h2>
        <div className="rounded-xl2 border border-line bg-surface overflow-hidden">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-muted border-b border-line bg-page/50">
                <th className="px-5 py-3 text-left font-semibold">Member</th>
                <th className="px-5 py-3 text-left font-semibold">Total days</th>
                <th className="px-5 py-3 text-left font-semibold">By type</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {balance.map(({ member, used, byType }) => (
                <tr key={member.id}>
                  <td className="px-5 py-3 font-medium text-ink">{member.name}</td>
                  <td className="px-5 py-3">{used}</td>
                  <td className="px-5 py-3 text-muted">
                    {Object.entries(byType || {}).map(([k, v]) => `${k}: ${v}`).join(' · ') || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
