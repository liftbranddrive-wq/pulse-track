import React, { useEffect, useState } from 'react';

import { api } from '../lib/api';



export default function Reports() {

  const [flagged, setFlagged] = useState(null);



  useEffect(() => {

    api({ endpoint: '/api/admin/export/flagged-members/preview' })

      .then(setFlagged)

      .catch(() => setFlagged({ flagged: [] }));

  }, []);



  async function dl(path, filename) {

    const blob = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:4000'}${path}`, {

      headers: {

        Authorization: `Bearer ${localStorage.getItem('pulsetrack_admin_access')}`,

      },

    }).then((r) => {

      if (!r.ok) throw new Error('Download failed');

      return r.blob();

    });



    const a = document.createElement('a');

    a.href = URL.createObjectURL(blob);

    a.download = filename;

    a.click();

  }



  return (

    <div className="space-y-6 max-w-2xl">

      <div>

        <h1 className="text-2xl font-bold text-ink tracking-tight">Reports & exports</h1>

        <p className="text-sm text-muted mt-1 leading-relaxed">

          Download team reports. Flagged members PDF lists people who need a performance conversation.

        </p>

      </div>



      <section className="rounded-xl2 border border-amber-200 dark:border-amber-900/50 bg-amber-50/50 dark:bg-amber-950/20 p-5">

        <h2 className="font-bold text-ink">Flagged members this month</h2>

        <p className="text-[12px] text-muted mt-1">

          Auto-detected: 3+ lates, 2+ absences, or under 90% required hours.

        </p>

        {!flagged ? (

          <p className="text-sm text-muted mt-3">Loading…</p>

        ) : flagged.flagged?.length === 0 ? (

          <p className="text-sm text-emerald-600 dark:text-emerald-400 mt-3 font-medium">

            No one flagged — team is on track.

          </p>

        ) : (

          <ul className="mt-3 space-y-2 text-[13px]">

            {flagged.flagged.map((row) => (

              <li key={row.member.id} className="flex justify-between gap-2 border-b border-line/50 pb-2">

                <span className="font-medium text-ink">{row.member.name}</span>

                <span className="text-rose-600 dark:text-rose-400 text-[12px]">{row.reasons.join(' · ')}</span>

              </li>

            ))}

          </ul>

        )}

        <button

          type="button"

          onClick={() => dl('/api/admin/export/pdf/flagged-members', `flagged-${flagged?.month ?? 'report'}.pdf`)}

          className="mt-4 px-4 py-2 rounded-xl bg-rose-600 text-white text-[13px] font-semibold hover:bg-rose-700 transition"

        >

          Download flagged members PDF

        </button>

      </section>



      <ul className="space-y-3 text-[13px]">

        <ExportRow title="CSV — Daily team bundle" onClick={() => dl('/api/admin/export/csv/daily-team', 'team-daily.csv')} />

        <ExportRow title="XLSX — Rolling week sessions" onClick={() => dl('/api/admin/export/xlsx/week', 'week.xlsx')} />

        <ExportRow title="PDF — Daily printable" onClick={() => dl('/api/admin/export/pdf/daily-summary', 'daily.pdf')} />

      </ul>

      <ReminderPanel />

      <GhostNote />

    </div>

  );

}



function ExportRow({ title, onClick }) {

  return (

    <li className="flex items-center justify-between rounded-xl2 border border-line bg-surface shadow-soft px-5 py-3.5">

      <span className="text-ink font-medium">{title}</span>

      <button type="button" onClick={onClick} className="text-[13px] font-bold text-brand hover:underline">

        Download

      </button>

    </li>

  );

}



function ReminderPanel() {

  const [data, setData] = React.useState(null);



  React.useEffect(() => {

    api({ endpoint: '/api/admin/reports/reminders' })

      .then(setData)

      .catch(() => setData([]));

  }, []);



  if (!data)

    return (

      <div className="text-muted text-sm rounded-xl2 border border-line bg-surface p-5 shadow-soft">

        Loading reminder rollup…

      </div>

    );



  return (

    <details className="rounded-xl2 border border-line bg-surface shadow-soft p-5" open>

      <summary className="cursor-pointer font-bold text-ink">Reminder analytics (7-day)</summary>

      <div className="mt-3 text-[12px] font-mono text-muted space-y-1 max-h-52 overflow-auto">

        {(data ?? []).map((x, i) => (

          <div key={i}>

            {x.userId?.slice?.(0, 8)} — {x.level}: {x._count}

          </div>

        ))}

      </div>

    </details>

  );

}



function GhostNote() {

  return (

    <p className="text-[12px] text-muted leading-relaxed">

      Ghost segments appear when someone stays clocked in without acknowledgement after escalated reminders. Use the Focus Board for context before conversations.

    </p>

  );

}


