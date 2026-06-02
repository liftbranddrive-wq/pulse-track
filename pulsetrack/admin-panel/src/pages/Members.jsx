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
    if (!window.confirm(`Disable ${m.name} (${m.email})? They will not be able to sign in.`)) return;
    setMsg('');
    setErr('');
    try {
      await api({ endpoint: `/api/admin/members/${m.id}`, method: 'DELETE' });
      setMsg(`Disabled ${m.name}.`);
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
      setErr(e.message);
    }
  }

  if (err && !rows) return <div className="text-rose-600 text-sm">{err}</div>;
  if (!rows) return <TableSkeleton cols={5} />;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-ink tracking-tight">Team members</h1>
        <p className="text-sm text-muted mt-1">
          Add workers (MEMBER) for the extension, or other managers (ADMIN) for this dashboard.
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
            <option value="MEMBER">MEMBER — uses Chrome extension only</option>
            <option value="ADMIN">ADMIN — uses admin website</option>
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
                <td className="px-4 py-3">
                  <span
                    className={`text-[12px] font-bold px-2.5 py-1 rounded-full ring-1 ${m.active ? 'bg-emerald-50 text-emerald-800 ring-emerald-200' : 'bg-rose-50 text-rose-700 ring-rose-100'}`}
                  >
                    {m.active ? 'Active' : 'Disabled'}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  {m.active ? (
                    <button
                      type="button"
                      onClick={() => disableMember(m)}
                      className="text-[12px] font-semibold text-rose-600 hover:underline"
                    >
                      Disable
                    </button>
                  ) : (
                    <span className="text-[12px] text-muted">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
