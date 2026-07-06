/** UTC day anchor (midnight UTC) */
export function utcDayStart(d = new Date()) {
  const x = new Date(d);
  x.setUTCHours(0, 0, 0, 0);
  return x;
}

export function utcDayEnd(d = new Date()) {
  const x = utcDayStart(d);
  x.setUTCDate(x.getUTCDate() + 1);
  return x;
}

/** Minutes from midnight UTC for a date */
export function minutesFromMidnightUTC(d) {
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

const TZ_ALIASES = {
  'Asia/Islamabad': 'Asia/Karachi',
};

export function normalizeTimezone(tz) {
  const t = (tz || '').trim();
  if (!t) return 'UTC';
  return TZ_ALIASES[t] ?? t;
}

/** Org timezone wins. Per-user UTC is ignored (schema default). Falls back to Pakistan. */
export function resolveTimezone(user, org) {
  const orgTz = normalizeTimezone(org?.timezone);
  const userTz = normalizeTimezone(user?.timezone);
  if (orgTz && orgTz !== 'UTC') return orgTz;
  if (userTz && userTz !== 'UTC') return userTz;
  return 'Asia/Karachi';
}

export function formatInstantInTimezone(d, timezone = 'Asia/Karachi') {
  const tz = normalizeTimezone(timezone);
  try {
    return {
      timezone: tz,
      date: new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      }).format(d),
      time: new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit',
        hour12: true,
      }).format(d),
      timeShort: new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
        timeZoneName: 'short',
      }).format(d),
    };
  } catch {
    return {
      timezone: tz,
      date: d.toDateString(),
      time: d.toLocaleTimeString(),
      timeShort: d.toLocaleTimeString(),
    };
  }
}

export function formatWallClockMinutes(mins, timezone = 'Asia/Karachi') {
  const tz = normalizeTimezone(timezone);
  const h24 = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  try {
    const probe = new Date();
    const nowMins = minutesFromMidnightInTimezone(probe, tz);
    probe.setTime(probe.getTime() + (h24 * 60 + m - nowMins) * 60_000);
    return new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).format(probe);
  } catch {
    const ampm = h24 >= 12 ? 'PM' : 'AM';
    const h12 = h24 % 12 || 12;
    return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
  }
}

/** Minutes from midnight in an IANA timezone (e.g. Asia/Karachi, America/New_York). */
export function minutesFromMidnightInTimezone(d, timezone = 'UTC') {
  const tz = normalizeTimezone(timezone);
  if (!tz || tz === 'UTC') return minutesFromMidnightUTC(d);
  try {
    const fmt = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      hour: 'numeric',
      minute: 'numeric',
      hourCycle: 'h23',
    });
    const parts = fmt.formatToParts(d);
    let hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
    const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
    if (hour === 24) hour = 0;
    return hour * 60 + minute;
  } catch {
    return minutesFromMidnightUTC(d);
  }
}

/** UTC instant for midnight at the start of the calendar day in `timezone`. */
export function dayStartForTimezone(d = new Date(), timezone = 'UTC') {
  const tz = normalizeTimezone(timezone);
  if (!tz || tz === 'UTC') return utcDayStart(d);
  try {
    const dateStr = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(d);
    const [y, mo, day] = dateStr.split('-').map(Number);
    let guess = Date.UTC(y, mo - 1, day, 0, 0, 0);
    for (let i = 0; i < 4; i += 1) {
      const mins = minutesFromMidnightInTimezone(new Date(guess), tz);
      guess -= mins * 60_000;
    }
    return new Date(guess);
  } catch {
    return utcDayStart(d);
  }
}

/** Last millisecond of the calendar day in `timezone` (11:59:59.999 PM local). */
export function dayEndForTimezone(d = new Date(), timezone = 'Asia/Karachi') {
  const start = dayStartForTimezone(d, timezone);
  return new Date(start.getTime() + 86400_000 - 1);
}

/** YYYY-MM-DD calendar key in timezone (for dedup keys). */
export function calendarDateKeyInTimezone(d = new Date(), timezone = 'Asia/Karachi') {
  const tz = normalizeTimezone(timezone);
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

export function formatMinutesAsLocalTime(mins, timezone = 'UTC') {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  const label = `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
  return timezone && timezone !== 'UTC' ? `${label} (${timezone})` : `${label} UTC`;
}

/** Build Date from UTC day + minutes offset */
export function dateFromDayAndMinutes(dayStart, minutes) {
  return new Date(dayStart.getTime() + minutes * 60_000);
}

export function msToHours(ms) {
  return ms / 3_600_000;
}

export function hoursToMs(h) {
  return h * 3_600_000;
}

export const DEFAULT_POINT_RULES = {
  onTimeClockIn: 5,
  fullHours: 10,
  overtimeHour: 15,
  streakBonus: 500,
  unexcusedAbsent: -30,
  lateWithoutNote: -10,
  challengeFailed: -5,
  anomalyConfirmed: -20,
  customTasks: [],
};

export const FIXED_RULE_KEYS = [
  'onTimeClockIn',
  'fullHours',
  'overtimeHour',
  'streakBonus',
  'unexcusedAbsent',
  'lateWithoutNote',
  'challengeFailed',
  'anomalyConfirmed',
];
