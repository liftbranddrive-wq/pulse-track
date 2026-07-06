/** @param {string} name @param {string} email */
export function initialsFrom(name, email) {
  const n = (name || email || '?').trim();
  const parts = n.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return n.slice(0, 2).toUpperCase();
}

const PALETTES = [
  'bg-teal-100 text-teal-800 ring-teal-200/80',
  'bg-sky-100 text-sky-800 ring-sky-200/80',
  'bg-rose-100 text-rose-800 ring-rose-200/80',
  'bg-violet-100 text-violet-800 ring-violet-200/80',
  'bg-amber-100 text-amber-900 ring-amber-200/80',
  'bg-emerald-100 text-emerald-800 ring-emerald-200/80',
];

/** @param {string} key */
export function avatarRingClass(key) {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return PALETTES[h % PALETTES.length];
}

export function formatDuration(ms) {
  const m = Math.floor((ms ?? 0) / 60000);
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h <= 0) return `${r}m`;
  return `${h}h ${r.toString().padStart(2, '0')}m`;
}

/** Decimal hours → "4h 23m" */
export function formatWorkedHours(hours) {
  if (hours == null || Number.isNaN(Number(hours)) || hours <= 0) return '0m';
  const totalMin = Math.round(Number(hours) * 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h <= 0) return `${m}m`;
  if (m <= 0) return `${h}h`;
  return `${h}h ${m.toString().padStart(2, '0')}m`;
}

const PK_TZ = 'Asia/Karachi';

export function formatPkTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('en-US', {
    timeZone: PK_TZ,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

export function formatPkDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', {
    timeZone: PK_TZ,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}
