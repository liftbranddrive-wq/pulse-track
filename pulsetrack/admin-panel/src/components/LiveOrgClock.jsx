import React, { useEffect, useState } from 'react';

export default function LiveOrgClock({ timezone = 'Asia/Karachi' }) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const tz = timezone && timezone !== 'UTC' ? timezone : 'Asia/Karachi';
  let date = '';
  let time = '';
  try {
    date = now.toLocaleDateString('en-US', {
      timeZone: tz,
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
    time = now.toLocaleTimeString('en-US', {
      timeZone: tz,
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
      timeZoneName: 'short',
    });
  } catch {
    date = now.toLocaleDateString();
    time = now.toLocaleTimeString();
  }

  return (
    <div className="rounded-xl2 border border-line bg-surface shadow-soft px-5 py-4 flex flex-wrap items-center justify-between gap-3">
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">Live time (team timezone)</div>
        <div className="text-2xl font-bold text-ink tabular-nums mt-1">{time}</div>
        <div className="text-[12px] text-muted mt-0.5">{date} · {tz}</div>
      </div>
      <div className="text-[12px] text-muted max-w-xs leading-relaxed">
        Schedule times below use this clock. Extension and late/early checks use the same timezone.
      </div>
    </div>
  );
}
