import { prisma } from '../db.js';
import { minutesFromMidnightUTC } from '../utils/time.js';

export function formatMinutesAsTime(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, '0')} ${ampm} UTC`;
}

/** Full allowed clock-in range including early (note required before normal window). */
export function getFullClockWindow(schedule) {
  const normalEarliest = schedule.clockInMin - schedule.windowBeforeMin;
  const absoluteEarliest = Math.max(0, schedule.clockInMin - (schedule.maxEarlyStartMin ?? 240));
  const latest = schedule.clockInMin + schedule.windowAfterMin;
  return {
    normalEarliest,
    absoluteEarliest,
    latest,
    scheduled: schedule.clockInMin,
  };
}

export function isWithinFullWindow(now, schedule) {
  const mins = minutesFromMidnightUTC(now);
  const { absoluteEarliest, latest } = getFullClockWindow(schedule);
  return mins >= absoluteEarliest && mins <= latest;
}

/** Before normal window but inside max-early range — note required, no approval. */
export function needsEarlyNote(now, schedule) {
  const mins = minutesFromMidnightUTC(now);
  const { normalEarliest, absoluteEarliest } = getFullClockWindow(schedule);
  return mins >= absoluteEarliest && mins < normalEarliest;
}

export function computeEarlyMinutes(now, schedule) {
  const mins = minutesFromMidnightUTC(now);
  const scheduled = schedule.clockInMin;
  if (mins >= scheduled) return 0;
  const { normalEarliest } = getFullClockWindow(schedule);
  if (mins >= normalEarliest) return 0;
  return scheduled - mins;
}

/** When member must finish active hours if they clock in at `now`. */
export function expectedClockOutTime(now, requiredHoursMin) {
  return new Date(now.getTime() + requiredHoursMin * 60_000);
}

export async function getEarlyStartLog({ days = 30 } = {}) {
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - days);
  since.setUTCHours(0, 0, 0, 0);

  return prisma.attendanceRecord.findMany({
    where: {
      isEarlyStart: true,
      date: { gte: since },
    },
    include: {
      user: { select: { id: true, name: true, email: true, jobTitle: true } },
    },
    orderBy: { date: 'desc' },
  });
}

export async function getTodayEarlyStartCount() {
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  return prisma.attendanceRecord.count({
    where: { isEarlyStart: true, date: dayStart },
  });
}
