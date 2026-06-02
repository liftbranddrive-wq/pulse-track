import React, { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { initialsFrom, avatarRingClass } from '../utils/format';

export default function Points() {
  const [leaderboard, setLeaderboard] = useState([]);
  const [rules, setRules] = useState(null);
  const [members, setMembers] = useState([]);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    Promise.all([
      api({ endpoint: '/api/points/leaderboard/monthly' }),
      api({ endpoint: '/api/points/rules' }),
      api({ endpoint: '/api/admin/members' }),
    ])
      .then(([lb, r, m]) => {
        setLeaderboard(lb);
        setRules(r);
        setMembers(m);
      })
      .catch(() => {});
  }, []);

  async function adjust(e) {
    e.preventDefault();
    const fd = new FormData(e.target);
    await api({
      endpoint: '/api/points/manual-adjust',
      method: 'POST',
      body: {
        userId: fd.get('userId'),
        points: Number(fd.get('points')),
        reason: fd.get('reason'),
      },
    });
    setMsg('Points adjusted');
    e.target.reset();
    setTimeout(() => setMsg(''), 2000);
  }

  const podium = leaderboard.slice(0, 3);

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-bold text-ink">Points & bonuses</h1>
        <p className="text-sm text-muted mt-1">Leaderboard, rules, and manual adjustments</p>
        {msg ? <p className="text-sm text-emerald-600 mt-2">{msg}</p> : null}
      </header>

      {podium.length ? (
        <section className="grid md:grid-cols-3 gap-4">
          {podium.map((p, i) => (
            <div
              key={p.member?.id}
              className={`rounded-xl2 border shadow-soft p-5 text-center ${
                i === 0 ? 'border-amber-300 bg-amber-50/40 md:-mt-2' : 'border-line bg-surface'
              }`}
            >
              <div className="text-3xl mb-2">{i === 0 ? '🥇' : i === 1 ? '🥈' : '🥉'}</div>
              <div className={`mx-auto w-12 h-12 rounded-full flex items-center justify-center text-[11px] font-bold ${avatarRingClass(p.member?.email)}`}>
                {initialsFrom(p.member?.name, p.member?.email)}
              </div>
              <div className="font-bold text-ink mt-2">{p.member?.name}</div>
              <div className="text-2xl font-bold text-amber-600 tabular-nums">{p.monthlyPoints} pts</div>
              <div className="text-[11px] text-muted">Balance: {p.member?.points ?? 0}</div>
            </div>
          ))}
        </section>
      ) : null}

      {rules ? (
        <section className="rounded-xl2 border border-line bg-surface p-5">
          <h2 className="font-bold text-ink mb-3">Point rules</h2>
          <div className="grid sm:grid-cols-2 gap-4 text-[13px]">
            <div>
              <h3 className="font-semibold text-emerald-700 mb-2">Earning</h3>
              <ul className="space-y-1 text-muted">
                <li>On-time clock-in: +{rules.onTimeClockIn}</li>
                <li>Full hours: +{rules.fullHours}</li>
                <li>Each overtime hour: +{rules.overtimeHour}</li>
                <li>Streak bonus: +{rules.streakBonus}</li>
              </ul>
            </div>
            <div>
              <h3 className="font-semibold text-rose-700 mb-2">Deductions</h3>
              <ul className="space-y-1 text-muted">
                <li>Unexcused absent: {rules.unexcusedAbsent}</li>
                <li>Late without note: {rules.lateWithoutNote}</li>
                <li>Challenge failed: {rules.challengeFailed}</li>
                <li>Anomaly confirmed: {rules.anomalyConfirmed}</li>
              </ul>
            </div>
          </div>
        </section>
      ) : null}

      <section className="rounded-xl2 border border-line bg-surface p-5 max-w-md">
        <h2 className="font-bold text-ink mb-3">Manual adjustment</h2>
        <form onSubmit={adjust} className="space-y-3 text-[13px]">
          <select name="userId" required className="w-full rounded-lg border border-line px-3 py-2">
            <option value="">Select member</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>{m.name} ({m.points ?? 0} pts)</option>
            ))}
          </select>
          <input name="points" type="number" required placeholder="Points (+ or -)" className="w-full rounded-lg border border-line px-3 py-2" />
          <input name="reason" required minLength={5} placeholder="Reason (required)" className="w-full rounded-lg border border-line px-3 py-2" />
          <button type="submit" className="w-full py-2 rounded-xl bg-brand text-white font-semibold">Apply</button>
        </form>
      </section>
    </div>
  );
}
