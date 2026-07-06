import React, { useEffect, useState } from 'react';
import { api } from '../lib/api';
import TermsGlossary from '../components/TermsGlossary';

export default function Flags() {
  const [rows, setRows] = useState(null);
  const [noteById, setNoteById] = useState({});

  async function reload() {
    const data = await api({ endpoint: '/api/admin/flags' });
    setRows(data);
  }

  useEffect(() => {
    reload().catch(() => setRows([]));
  }, []);

  async function dismiss(id) {
    const note = noteById[id] || 'Dismissed via admin.';
    await api({
      endpoint: `/api/admin/flags/${id}/dismiss`,
      method: 'PATCH',
      body: { note },
    });
    reload();
  }

  if (!rows) return <p className="text-muted text-sm">Loading flags…</p>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-ink tracking-tight flex items-center gap-2">
          <span aria-hidden="true">⚠️</span> Flags & gentle signals
        </h1>
        <p className="text-sm text-muted mt-1 leading-relaxed max-w-3xl">
          A <strong className="text-ink">flag</strong> is an automatic heads-up for managers — not a guilty verdict.
          Examples: new IP on clock-in, high ghost %, or repeated late arrivals. Talk to the person before assuming a problem.
        </p>
      </div>

      <TermsGlossary
        title="What is a flag?"
        terms={[
          {
            term: 'Flag',
            definition:
              'Software noticed something unusual worth a quick human check. Dismissing a flag means “I reviewed this” — it stays in the audit log.',
          },
          {
            term: 'Not the same as ghost',
            definition: 'Ghost = idle time while clocked in. Flag = broader anomaly alert that may reference ghost, IP, schedule, etc.',
          },
          {
            term: 'What to do',
            definition: 'Read the summary, add a short manager note, acknowledge & archive. Use Member profile for full context.',
          },
        ]}
      />
      <ul className="space-y-3">
        {rows.map((f) => (
          <li
            key={f.id}
            className="rounded-xl2 border border-line bg-surface shadow-soft p-5 flex flex-col gap-4 md:flex-row md:items-start md:justify-between"
          >
            <div>
              <div className="font-bold text-ink">{f.user.name}</div>
              <div className="text-[11px] font-mono font-semibold text-ghost mt-0.5">{f.type}</div>
              <div className="text-[13px] text-muted mt-2 leading-snug">{f.summary}</div>
              {f.dismissed ? (
                <div className="text-[12px] text-muted mt-2">Archived — {f.dismissedNote}</div>
              ) : null}
            </div>
            {!f.dismissed ? (
              <div className="flex flex-col gap-2 w-full md:w-[280px] shrink-0">
                <input
                  placeholder="Manager note…"
                  value={noteById[f.id] ?? ''}
                  onChange={(e) => setNoteById((p) => ({ ...p, [f.id]: e.target.value }))}
                  className="rounded-xl border border-line bg-page px-3 py-2 text-[13px] text-ink"
                />
                <button
                  type="button"
                  onClick={() => dismiss(f.id)}
                  className="rounded-xl bg-page border border-line py-2 text-[13px] font-semibold text-ink hover:bg-black/[0.04]"
                >
                  Acknowledge & archive
                </button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
