import React, { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { initialsFrom, avatarRingClass } from '../utils/format';

const RULE_LABELS = {
  onTimeClockIn: 'On-time clock-in',
  fullHours: 'Full required hours',
  overtimeHour: 'Each overtime hour',
  streakBonus: '20-day streak bonus',
  unexcusedAbsent: 'Unexcused absent',
  lateWithoutNote: 'Late without note',
  challengeFailed: 'Challenge failed',
  anomalyConfirmed: 'Anomaly confirmed',
};

const EARN_KEYS = ['onTimeClockIn', 'fullHours', 'overtimeHour', 'streakBonus'];
const DEDUCT_KEYS = ['unexcusedAbsent', 'lateWithoutNote', 'challengeFailed', 'anomalyConfirmed'];

function emptyTask() {
  return { id: '', name: '', points: 10, active: true };
}

export default function Points() {
  const [leaderboard, setLeaderboard] = useState([]);
  const [rules, setRules] = useState(null);
  const [draft, setDraft] = useState(null);
  const [customTasks, setCustomTasks] = useState([]);
  const [members, setMembers] = useState([]);
  const [msg, setMsg] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([
      api({ endpoint: '/api/points/leaderboard/monthly' }),
      api({ endpoint: '/api/points/rules' }),
      api({ endpoint: '/api/admin/members' }),
    ])
      .then(([lb, r, m]) => {
        setLeaderboard(lb);
        setRules(r);
        setDraft({ ...r });
        setCustomTasks(r?.customTasks?.length ? r.customTasks : []);
        setMembers(m);
      })
      .catch(() => {});
  }, []);

  function updateRule(key, value) {
    setDraft((d) => ({ ...d, [key]: Number(value) }));
  }

  function updateTask(i, field, value) {
    setCustomTasks((tasks) =>
      tasks.map((t, idx) => (idx === i ? { ...t, [field]: field === 'points' ? Number(value) : value } : t)),
    );
  }

  async function saveRules(e) {
    e.preventDefault();
    setSaving(true);
    try {
      const saved = await api({
        endpoint: '/api/points/rules',
        method: 'PATCH',
        body: { ...draft, customTasks },
      });
      setRules(saved);
      setDraft({ ...saved });
      setCustomTasks(saved.customTasks ?? []);
      setMsg('Point rules saved — team extension will pick these up automatically.');
      setTimeout(() => setMsg(''), 4000);
    } catch (err) {
      setMsg(err.message || 'Could not save rules');
    } finally {
      setSaving(false);
    }
  }

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

  async function awardTask(e) {
    e.preventDefault();
    const fd = new FormData(e.target);
    await api({
      endpoint: '/api/points/award-task',
      method: 'POST',
      body: {
        userId: fd.get('userId'),
        taskId: fd.get('taskId'),
      },
    });
    setMsg('Custom task points awarded');
    e.target.reset();
    setTimeout(() => setMsg(''), 2500);
  }

  const podium = leaderboard.slice(0, 3);
  const activeTasks = (customTasks ?? []).filter((t) => t.active !== false && t.name?.trim());

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-bold text-ink">Points & bonuses</h1>
        <p className="text-sm text-muted mt-1">Edit rules, add custom tasks, leaderboard, and manual adjustments</p>
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

      {draft ? (
        <section className="rounded-xl2 border border-line bg-surface p-5">
          <h2 className="font-bold text-ink mb-1">Edit point rules</h2>
          <p className="text-[12px] text-muted mb-4">Save here — automatic awards (clock-in, hours, overtime) use these numbers. Members see rules in the extension Points tab.</p>
          <form onSubmit={saveRules} className="space-y-6 text-[13px]">
            <div className="grid sm:grid-cols-2 gap-6">
              <div>
                <h3 className="font-semibold text-emerald-700 mb-3">Earning</h3>
                <div className="space-y-2">
                  {EARN_KEYS.map((key) => (
                    <label key={key} className="flex items-center justify-between gap-3">
                      <span className="text-muted">{RULE_LABELS[key]}</span>
                      <input
                        type="number"
                        className="w-24 rounded-lg border border-line px-2 py-1 text-right"
                        value={draft[key] ?? 0}
                        onChange={(e) => updateRule(key, e.target.value)}
                      />
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <h3 className="font-semibold text-rose-700 mb-3">Deductions</h3>
                <div className="space-y-2">
                  {DEDUCT_KEYS.map((key) => (
                    <label key={key} className="flex items-center justify-between gap-3">
                      <span className="text-muted">{RULE_LABELS[key]}</span>
                      <input
                        type="number"
                        className="w-24 rounded-lg border border-line px-2 py-1 text-right"
                        value={draft[key] ?? 0}
                        onChange={(e) => updateRule(key, e.target.value)}
                      />
                    </label>
                  ))}
                </div>
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-ink">Custom tasks</h3>
                <button
                  type="button"
                  className="text-[12px] text-brand font-semibold"
                  onClick={() => setCustomTasks((t) => [...t, emptyTask()])}
                >
                  + Add task
                </button>
              </div>
              <p className="text-[12px] text-muted mb-2">Example: “Weekly presentation” = 20 points. Award to a member below after they complete it.</p>
              {customTasks.length === 0 ? (
                <p className="text-muted text-[12px]">No custom tasks yet.</p>
              ) : (
                <div className="space-y-2">
                  {customTasks.map((task, i) => (
                    <div key={task.id || i} className="flex flex-wrap gap-2 items-center">
                      <input
                        className="flex-1 min-w-[180px] rounded-lg border border-line px-2 py-1"
                        placeholder="Task name"
                        value={task.name}
                        onChange={(e) => updateTask(i, 'name', e.target.value)}
                      />
                      <input
                        type="number"
                        className="w-20 rounded-lg border border-line px-2 py-1"
                        value={task.points}
                        onChange={(e) => updateTask(i, 'points', e.target.value)}
                      />
                      <label className="flex items-center gap-1 text-[12px]">
                        <input
                          type="checkbox"
                          checked={task.active !== false}
                          onChange={(e) => updateTask(i, 'active', e.target.checked)}
                        />
                        Active
                      </label>
                      <button
                        type="button"
                        className="text-[12px] text-rose-600"
                        onClick={() => setCustomTasks((t) => t.filter((_, idx) => idx !== i))}
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2 rounded-xl bg-brand text-white font-semibold disabled:opacity-60"
            >
              {saving ? 'Saving…' : 'Save point rules'}
            </button>
          </form>
        </section>
      ) : null}

      {activeTasks.length ? (
        <section className="rounded-xl2 border border-line bg-surface p-5 max-w-md">
          <h2 className="font-bold text-ink mb-3">Award custom task</h2>
          <form onSubmit={awardTask} className="space-y-3 text-[13px]">
            <select name="userId" required className="w-full rounded-lg border border-line px-3 py-2">
              <option value="">Select member</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>{m.name} ({m.points ?? 0} pts)</option>
              ))}
            </select>
            <select name="taskId" required className="w-full rounded-lg border border-line px-3 py-2">
              <option value="">Select task</option>
              {activeTasks.map((t) => (
                <option key={t.id} value={t.id}>{t.name} (+{t.points} pts)</option>
              ))}
            </select>
            <button type="submit" className="w-full py-2 rounded-xl bg-emerald-600 text-white font-semibold">Award task points</button>
          </form>
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
