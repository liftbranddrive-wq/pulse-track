import React, { useState } from 'react';

const DEFAULT_TERMS = [
  {
    term: 'Active time',
    definition:
      'Minutes counted while clocked in AND using keyboard/mouse anywhere on the computer (any Chrome profile, browser, or app). Chrome must stay open with PulseTrack installed.',
  },
  {
    term: 'Idle',
    definition:
      'No mouse/keyboard activity for about 10 minutes. You get reminders. Active time still runs until ghost (15 min).',
  },
  {
    term: 'Ghost time',
    definition:
      'No activity for 15+ minutes while still clocked in. Active timer pauses; ghost minutes are logged separately. Tap “Resume focus” when back.',
  },
  {
    term: 'Flag',
    definition:
      'An automatic admin alert (not punishment) — e.g. unusual IP, many ghost minutes, or late pattern. Review with the person before assuming wrongdoing.',
  },
  {
    term: 'Heartbeat',
    definition:
      'Extension checks in with the server every few minutes while clocked in. If the browser is closed too long, the session may auto-pause.',
  },
  {
    term: 'Break',
    definition:
      'Official pause you choose (lunch, short break). Active time stops until you resume.',
  },
  {
    term: 'Manual pause',
    definition:
      'You tapped “Pause — not working”. Active time stops until you resume.',
  },
  {
    term: 'Early start',
    definition:
      'Clocking in before the normal window. Member must leave a note; admin sees it on Early start page.',
  },
  {
    term: 'Whole computer',
    definition:
      'Activity uses the PC’s keyboard/mouse signals — works across Chrome profiles, Firefox, Edge, and desktop apps. PulseTrack must stay running in Chrome (one profile) for clock-in and sync.',
  },
  {
    term: 'Watching video',
    definition:
      'If you watch without moving mouse/keyboard for 15+ minutes, time moves to ghost (paused). Occasional scroll or keypress keeps active time running.',
  },
];

export default function TermsGlossary({ terms = DEFAULT_TERMS, title = 'What these terms mean' }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-xl2 border border-line bg-page/60 text-[12px] leading-relaxed">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-2 px-4 py-3 text-left font-semibold text-ink hover:bg-black/[0.03] rounded-xl2"
      >
        <span>{title}</span>
        <span className="text-muted text-lg leading-none" aria-hidden="true">
          {open ? '−' : '+'}
        </span>
      </button>
      {open ? (
        <dl className="px-4 pb-4 space-y-3 border-t border-line pt-3">
          {terms.map((t) => (
            <div key={t.term}>
              <dt className="font-bold text-ink">{t.term}</dt>
              <dd className="text-muted mt-0.5">{t.definition}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  );
}
