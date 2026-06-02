import { prisma } from '../db.js';
import { AttendanceStatus } from '@prisma/client';

/**
 * Members flagged for performance review this month:
 * - 3+ late days
 * - 2+ unexcused absences
 * - hours below 90% of required total
 */
export async function getFlaggedMembersReport() {
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);

  const members = await prisma.user.findMany({
    where: { role: 'MEMBER', active: true },
    select: { id: true, name: true, email: true, department: true, jobTitle: true },
  });

  const records = await prisma.attendanceRecord.findMany({
    where: { date: { gte: monthStart }, userId: { in: members.map((m) => m.id) } },
  });

  const byUser = new Map();
  for (const r of records) {
    if (!byUser.has(r.userId)) byUser.set(r.userId, []);
    byUser.get(r.userId).push(r);
  }

  const org = await prisma.orgSettings.findUnique({ where: { id: 'singleton' } });
  const requiredPerDay = (org?.requiredHoursMin ?? 480) / 60;

  const flagged = [];

  for (const m of members) {
    const rows = byUser.get(m.id) ?? [];
    const lateDays = rows.filter((r) => r.status === AttendanceStatus.LATE).length;
    const absentDays = rows.filter((r) => r.status === AttendanceStatus.ABSENT).length;
    const workDays = rows.filter((r) =>
      [AttendanceStatus.PRESENT, AttendanceStatus.LATE].includes(r.status),
    ).length;

    const totalWorked = rows.reduce((a, r) => a + (r.totalHoursWorked ?? 0), 0);
    const expectedTotal = workDays * requiredPerDay;
    const completionPct = expectedTotal > 0 ? (totalWorked / expectedTotal) * 100 : 100;

    const reasons = [];
    if (lateDays >= 3) reasons.push(`${lateDays} late days`);
    if (absentDays >= 2) reasons.push(`${absentDays} unexcused absences`);
    if (workDays > 0 && completionPct < 90) {
      reasons.push(`${completionPct.toFixed(0)}% hours completion`);
    }

    if (reasons.length) {
      flagged.push({
        member: m,
        lateDays,
        absentDays,
        totalWorked: +totalWorked.toFixed(1),
        expectedTotal: +expectedTotal.toFixed(1),
        completionPct: +completionPct.toFixed(1),
        reasons,
      });
    }
  }

  flagged.sort((a, b) => b.lateDays + b.absentDays - (a.lateDays + a.absentDays));

  return {
    month: monthStart.toISOString().slice(0, 7),
    generatedAt: new Date().toISOString(),
    flagged,
  };
}
