import { prisma } from '../db.js';
import { AttendanceStatus } from '@prisma/client';

function parseMonth(monthStr) {
  const m = monthStr || new Date().toISOString().slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(m)) throw new Error('Invalid month — use YYYY-MM');
  const start = new Date(`${m}-01T00:00:00.000Z`);
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
  return { month: m, start, end };
}

export async function getMemberMonthlyReport(userId, monthStr) {
  const { month, start, end } = parseMonth(monthStr);

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true, points: true, streakDays: true, jobTitle: true },
  });
  if (!user) return { error: 'User not found' };

  const [records, pointRows, org] = await Promise.all([
    prisma.attendanceRecord.findMany({
      where: { userId, date: { gte: start, lt: end } },
      orderBy: { date: 'asc' },
    }),
    prisma.pointTransaction.findMany({
      where: { userId, createdAt: { gte: start, lt: end } },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.orgSettings.findUnique({ where: { id: 'singleton' } }),
  ]);

  const requiredPerDay = (org?.requiredHoursMin ?? 480) / 60;

  let presentDays = 0;
  let lateDays = 0;
  let absentDays = 0;
  let onLeaveDays = 0;
  let earlyStarts = 0;
  let completeDays = 0;
  let incompleteDays = 0;
  let totalHoursWorked = 0;
  let expectedHours = 0;
  let overtimeHours = 0;

  for (const r of records) {
    if (r.status === AttendanceStatus.PRESENT) presentDays += 1;
    if (r.status === AttendanceStatus.LATE) lateDays += 1;
    if (r.status === AttendanceStatus.ABSENT) absentDays += 1;
    if (r.status === AttendanceStatus.ON_LEAVE) onLeaveDays += 1;
    if (r.isEarlyStart) earlyStarts += 1;

    const worked = r.totalHoursWorked ?? 0;
    totalHoursWorked += worked;
    overtimeHours += r.overtimeHours ?? 0;

    if ([AttendanceStatus.PRESENT, AttendanceStatus.LATE].includes(r.status)) {
      const req = r.requiredHours ?? requiredPerDay;
      expectedHours += req;
      if (r.isComplete) completeDays += 1;
      else if (worked > 0 || r.clockOutTime) incompleteDays += 1;
    }
  }

  const workDays = presentDays + lateDays;
  const completionPct = expectedHours > 0 ? (totalHoursWorked / expectedHours) * 100 : 0;
  const attendanceRate = workDays + absentDays > 0
    ? Math.round((workDays / (workDays + absentDays)) * 100)
    : 0;
  const onTimeDays = presentDays;

  let monthPointsEarned = 0;
  let monthPointsDeducted = 0;
  for (const p of pointRows) {
    if (p.points > 0) monthPointsEarned += p.points;
    else monthPointsDeducted += Math.abs(p.points);
  }

  return {
    month,
    generatedAt: new Date().toISOString(),
    user,
    summary: {
      presentDays,
      lateDays,
      absentDays,
      onLeaveDays,
      workDays,
      earlyStarts,
      completeDays,
      incompleteDays,
      onTimeDays,
      totalHoursWorked: +totalHoursWorked.toFixed(2),
      expectedHours: +expectedHours.toFixed(2),
      completionPct: +completionPct.toFixed(1),
      attendanceRate,
      overtimeHours: +overtimeHours.toFixed(2),
      monthPointsEarned,
      monthPointsDeducted,
      monthNetPoints: monthPointsEarned - monthPointsDeducted,
      streakDays: user.streakDays ?? 0,
      totalPoints: user.points ?? 0,
    },
    records,
    recentPoints: pointRows.slice(0, 15),
  };
}
