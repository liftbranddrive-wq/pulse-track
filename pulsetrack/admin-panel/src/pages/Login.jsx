import React, { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Activity } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export default function LoginPage() {
  const { login, user, loading } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');

  if (!loading && user?.role === 'ADMIN') return <Navigate to="/" replace />;

  async function onSubmit(e) {
    e.preventDefault();
    setErr('');
    try {
      await login(email, password);
    } catch (ex) {
      setErr(ex.message ?? 'Login failed');
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-page px-4 py-12">
      <div className="w-full max-w-[420px] rounded-xl2 border border-line bg-surface p-8 shadow-soft">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-11 h-11 rounded-xl bg-brand flex items-center justify-center shadow-sm">
            <Activity className="w-5 h-5 text-white" strokeWidth={2.2} />
          </div>
          <div>
            <h1 className="text-xl font-bold text-ink tracking-tight">PulseTrack</h1>
            <p className="text-[12px] text-muted font-medium">Administrator sign-in</p>
          </div>
        </div>
        <p className="text-sm text-muted mt-3 leading-relaxed">
          Honest time tracking — activity signals only. No screenshots, no key capture.
        </p>
        <form onSubmit={onSubmit} className="mt-8 space-y-4">
          <div>
            <label className="text-[11px] font-semibold uppercase tracking-wide text-muted">Email</label>
            <input
              className="mt-1.5 w-full rounded-xl border border-line bg-page px-3.5 py-2.5 text-[14px] text-ink outline-none focus:ring-2 focus:ring-brand/40"
              type="email"
              value={email}
              required
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div>
            <label className="text-[11px] font-semibold uppercase tracking-wide text-muted">Password</label>
            <input
              className="mt-1.5 w-full rounded-xl border border-line bg-page px-3.5 py-2.5 text-[14px] text-ink outline-none focus:ring-2 focus:ring-brand/40"
              type="password"
              value={password}
              required
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          {err ? <div className="text-[13px] text-rose-600 font-medium">{err}</div> : null}
          <button
            type="submit"
            className="w-full rounded-xl bg-brand py-3 text-[14px] font-bold text-white hover:bg-teal-600 transition shadow-sm"
          >
            Sign in to dashboard
          </button>
        </form>
      </div>
    </div>
  );
}
