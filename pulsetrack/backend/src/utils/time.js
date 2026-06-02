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
};
