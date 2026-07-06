import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import TermsGlossary from '../components/TermsGlossary';
import { formatDuration } from '../utils/format';

export default function GhostTime() {
  const [focus, setFocus] = useState(null);

  useEffect(() => {
    api({ endpoint: '/api/admin/reports/focus-board?range=week' })
      .then(setFocus)
      .catch(() => setFocus([]));
  }, []);

  const sorted = useMemo(() => {
    if (!focus) return [];
    return [...focus].sort((a, b) => (b.ghostMs ?? 0) - (a.ghostMs ?? 0));
  }, [focus]);

  if (!focus) return <p className="text-muted">Loading ghost-time summary…</p>;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-ink tracking-tight">Ghost time</h1>
        <p className="text-sm text-muted mt-1 max-w-3xl leading-relaxed">
          <strong className="text-ink">Ghost time</strong> = clocked in but no keyboard/mouse on the <em>whole computer</em> for 15+ minutes (after reminders).
          Active pay time pauses; ghost minutes are logged separately. Watching a video without moving counts as idle → ghost.
        </p>
      </header>

      <TermsGlossary
        title="Ghost vs idle vs active"
        terms={[
          {
            term: 'Active',
            definition: 'Keyboard/mouse anywhere on the PC while clocked in. Counts toward required hours.',
          },
          {
            term: 'Idle (L1/L2)',
            definition: '5–10 min no input — reminders only; timer still runs.',
          },
          {
            term: 'Ghost (L3)',
            definition: '15+ min no input on the PC — active timer stops until “Resume focus”. Common causes: lunch at desk watching video, phone call, stepped away.',
          },
        ]}
      />

      <div className="rounded-xl2 border border-line bg-surface shadow-soft overflow-x-auto">
        <table className="w-full text-[13px] min-w-[640px]">
          <thead className="bg-page/70 text-muted border-b border-line">
            <tr>
              <th className="text-left px-4 py-3 font-semibold">Member</th>
              <th className="text-right px-4 py-3 font-semibold">Ghost (7 days)</th>
              <th className="text-right px-4 py-3 font-semibold">Active (7 days)</th>
              <th className="text-right px-4 py-3 font-semibold">Ghost %</th>
              <th className="text-right px-4 py-3 font-semibold">Score</th>
              <th className="text-left px-4 py-3 font-semibold">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {sorted.map((r) => {
              const pct =
                r.clockedMs > 0 ? (((r.ghostMs ?? 0) / r.clockedMs) * 100).toFixed(1) + '%' : '—';

              return (
                <tr key={r.member.id} className="hover:bg-black/[0.015]">
                  <td className="px-4 py-3 font-semibold text-ink">
                    <Link className="text-brand hover:underline" to={`/members/${r.member.id}`}>
                      {r.member.name}
                    </Link>
                    <div className="text-[11px] text-muted">{r.member.email}</div>
                  </td>
                  <td className="px-4 py-3 text-right font-mono font-semibold text-ghost">
                    {formatDuration(r.ghostMs ?? 0)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-ink">{formatDuration(r.activeMs ?? 0)}</td>
                  <td className="px-4 py-3 text-right">{pct}</td>
                  <td className="px-4 py-3 text-right">{r.activityScore?.toFixed(1) ?? '—'}%</td>
                  <td className="px-4 py-3">
                    <Link className="text-[12px] font-semibold text-brand hover:underline" to={`/members/${r.member.id}`}>
                      Open profile →
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
