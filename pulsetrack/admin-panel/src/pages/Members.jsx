import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { TableSkeleton } from '../components/Skeleton';

export default function Members() {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [form, setForm] = useState({
    name: '',
    email: '',
    password: '',
    role: 'MEMBER',
    jobTitle: '',
  });

  async function load() {
    setErr('');
    const data = await api({ endpoint: '/api/admin/members' });
    setRows(data);
  }

  useEffect(() => {
    load().catch((e) => setErr(e.message));
  }, []);

  async function disableMember(m) {
    if (!window.confirm(`Disable ${m.name} (${m.email})? They cannot sign in until you enable them again.`)) return;
    setMsg('');
    setErr('');
    try {
      await api({ endpoint: `/api/admin/members/${m.id}`, method: 'DELETE' });
      setMsg(`Disabled ${m.name}. You can enable them again from the list below.`);
      await load();
    } catch (e) {
      setErr(e.message);
    }
  }

  async function enableMember(m) {
    setMsg('');
    setErr('');
    try {
      await api({
        endpoint: `/api/admin/members/${m.id}`,
        method: 'PATCH',
        body: { active: true },
      });
      setMsg(`Enabled ${m.name} — they can sign in to admin and extension now.`);
      await load();
    } catch (e) {
      setErr(e.message);
    }
  }

  async function resetPassword(m) {
    const pwd = window.prompt(`New password for ${m.name} (${m.email}) — min 8 characters:`);
    if (!pwd) return;
    if (pwd.length < 8) {
      setErr('Password must be at least 8 characters');
      return;
    }
    setMsg('');
    setErr('');
    try {
      await api({
        endpoint: `/api/admin/members/${m.id}`,
        method: 'PATCH',
        body: { password: pwd },
      });
      setMsg(`Password updated for ${m.name}. Share the new password with them.`);
    } catch (e) {
      setErr(e.message);
    }
  }

  async function setDailyHours(m) {
    const current = m.expectedDailyHoursMin ?? 480;
    const hours = window.prompt(
      `Daily required hours for ${m.name} (current: ${(current / 60).toFixed(1)}h). Enter 4, 5, 6, 8, etc:`,
      String(current / 60),
    );
    if (hours === null) return;
    const parsed = Number(hours);
    if (!Number.isFinite(parsed) || parsed < 1 || parsed > 24) {
      setErr('Enter a number between 1 and 24 hours');
      return;
    }
    setMsg('');
    setErr('');
    try {
      await api({
        endpoint: `/api/admin/members/${m.id}`,
        method: 'PATCH',
        body: { expectedDailyHoursMin: Math.round(parsed * 60) },
      });
      setMsg(`${m.name} — required hours set to ${parsed}h/day.`);
      await load();
    } catch (e) {
      setErr(e.message);
    }
  }

  async function setRole(m, role) {
    if (m.role === role) return;
    if (!window.confirm(`Change ${m.name} to ${role}?`)) return;
    setMsg('');
    setErr('');
    try {
      await api({
        endpoint: `/api/admin/members/${m.id}`,
        method: 'PATCH',
        body: { role },
      });
      setMsg(`${m.name} is now ${role}.`);
      await load();
    } catch (e) {
      setErr(e.message);
    }
  }

  async function addMember(e) {
    e.preventDefault();
    setMsg('');
    setErr('');
    try {
      await api({
        endpoint: '/api/auth/register',
        method: 'POST',
        body: {
          name: form.name.trim(),
          email: form.email.trim(),
          password: form.password,
          role: form.role,
        },
      });
      if (form.jobTitle.trim() && form.email.trim()) {
        const list = await api({ endpoint: '/api/admin/members' });
        const created = list.find((u) => u.email === form.email.trim());
        if (created) {
          await api({
            endpoint: `/api/admin/members/${created.id}`,
            method: 'PATCH',
            body: { jobTitle: form.jobTitle.trim() },
          });
        }
      }
      setForm({ name: '', email: '', password: '', role: 'MEMBER', jobTitle: '' });
      setMsg('User created — share email + password with them for the extension or admin site.');
      await load();
    } catch (e) {
      const msg = e.message || '';
      if (/email exists/i.test(msg)) {
        setErr('That email already exists — scroll down, find them, click Enable, then Reset password if needed.');
      } else {
        setErr(msg);
      }
    }
  }

  if (err && !rows) return <div className="text-rose-600 text-sm">{err}</div>;
  if (!rows) return <TableSkeleton cols={5} />;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-ink tracking-tight">Team members</h1>
        <p className="text-sm text-muted mt-1">
          ADMIN = admin website + extension (same login). MEMBER = extension only. Disabled users cannot sign in — use Enable to turn them back on.
        </p>
      </div>

      <form
        onSubmit={addMember}
        className="rounded-xl2 border border-line bg-surface shadow-soft p-5 grid gap-3 md:grid-cols-2 text-[13px]"
      >
        <h2 className="md:col-span-2 font-bold text-ink">Add person</h2>
        <label className="block">
          <span className="text-[11px] font-semibold uppercase text-muted">Full name</span>
          <input
            required
            className="mt-1 w-full rounded-xl border border-line px-3 py-2"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </label>
        <label className="block">
          <span className="text-[11px] font-semibold uppercase text-muted">Job title (optional)</span>
          <input
            className="mt-1 w-full rounded-xl border border-line px-3 py-2"
            value={form.jobTitle}
            onChange={(e) => setForm({ ...form, jobTitle: e.target.value })}
          />
        </label>
        <label className="block">
          <span className="text-[11px] font-semibold uppercase text-muted">Email</span>
          <input
            required
            type="email"
            className="mt-1 w-full rounded-xl border border-line px-3 py-2"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
        </label>
        <label className="block">
          <span className="text-[11px] font-semibold uppercase text-muted">Temporary password (8+ chars)</span>
          <input
            required
            minLength={8}
            type="password"
            className="mt-1 w-full rounded-xl border border-line px-3 py-2"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
          />
        </label>
        <label className="block md:col-span-2">
          <span className="text-[11px] font-semibold uppercase text-muted">Role</span>
          <select
            className="mt-1 w-full rounded-xl border border-line px-3 py-2"
            value={form.role}
            onChange={(e) => setForm({ ...form, role: e.target.value })}
          >
            <option value="MEMBER">MEMBER — extension only (no admin website)</option>
            <option value="ADMIN">ADMIN — admin website + extension</option>
          </select>
        </label>
        <div className="md:col-span-2 flex items-center gap-3">
          <button type="submit" className="rounded-xl bg-brand px-5 py-2.5 font-bold text-white">
            Create account
          </button>
          {msg ? <span className="text-brand font-semibold">{msg}</span> : null}
          {err ? <span className="text-rose-600">{err}</span> : null}
        </div>
      </form>

      <div className="overflow-auto rounded-xl2 border border-line bg-surface shadow-soft">
        <table className="min-w-full text-[13px]">
          <thead className="bg-page/70 text-muted text-left border-b border-line font-semibold">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Title</th>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Role</th>
              <th className="px-4 py-3">Hours/day</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((m) => (
              <tr key={m.id} className="hover:bg-black/[0.015]">
                <td className="px-4 py-3">
                  <Link className="font-semibold text-brand hover:underline" to={`/members/${m.id}`}>
                    {m.name}
                  </Link>
                </td>
                <td className="px-4 py-3 text-muted">{m.jobTitle ?? '—'}</td>
                <td className="px-4 py-3 font-mono text-[12px] text-muted">{m.email}</td>
                <td className="px-4 py-3 text-ink">{m.role}</td>
                <td className="px-4 py-3 text-muted">
                  {((m.expectedDailyHoursMin ?? 480) / 60).toFixed(1)}h
                  {m.role === 'MEMBER' ? (
                    <button
                      type="button"
                      onClick={() => setDailyHours(m)}
                      className="ml-2 text-[11px] font-semibold text-brand hover:underline"
                    >
                      Edit
                    </button>
                  ) : null}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`text-[12px] font-bold px-2.5 py-1 rounded-full ring-1 ${m.active ? 'bg-emerald-50 text-emerald-800 ring-emerald-200' : 'bg-rose-50 text-rose-700 ring-rose-100'}`}
                  >
                    {m.active ? 'Active' : 'Disabled'}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex flex-wrap justify-end gap-2">
                    {m.active ? (
                      <>
                        {m.role === 'MEMBER' ? (
                          <button
                            type="button"
                            onClick={() => setRole(m, 'ADMIN')}
                            className="text-[12px] font-semibold text-brand hover:underline"
                          >
                            Make admin
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setRole(m, 'MEMBER')}
                            className="text-[12px] font-semibold text-muted hover:underline"
                          >
                            Make member
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => resetPassword(m)}
                          className="text-[12px] font-semibold text-muted hover:underline"
                        >
                          Reset password
                        </button>
                        <button
                          type="button"
                          onClick={() => disableMember(m)}
                          className="text-[12px] font-semibold text-rose-600 hover:underline"
                        >
                          Disable
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => enableMember(m)}
                          className="text-[12px] font-semibold text-emerald-700 hover:underline"
                        >
                          Enable
                        </button>
                        <button
                          type="button"
                          onClick={() => resetPassword(m)}
                          className="text-[12px] font-semibold text-brand hover:underline"
                        >
                          Reset password
                        </button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
