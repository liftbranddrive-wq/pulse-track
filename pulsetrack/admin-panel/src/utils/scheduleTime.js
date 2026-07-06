/** Minutes since midnight (0–1439) ↔ HTML time input (HH:MM). */

export function minutesToTimeValue(mins) {
  const n = ((Number(mins) % 1440) + 1440) % 1440;
  const h = Math.floor(n / 60);
  const m = n % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function timeValueToMinutes(value) {
  if (!value) return 0;
  const [h, m] = value.split(':').map(Number);
  return h * 60 + (m || 0);
}

/** Human 12-hour label for previews (org timezone shown separately). */
export function formatMinutesFriendly(mins) {
  const n = ((Number(mins) % 1440) + 1440) % 1440;
  const h = Math.floor(n / 60);
  const m = n % 60;
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

export function isOvernightEnd(clockInMin, clockOutMin) {
  return timeValueToMinutes(minutesToTimeValue(clockOutMin)) <= timeValueToMinutes(minutesToTimeValue(clockInMin));
}
