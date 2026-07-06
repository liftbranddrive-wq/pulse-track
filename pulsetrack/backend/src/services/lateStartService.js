import { prisma } from '../db.js';
import { AttendanceStatus } from '@prisma/client';
import { dayStartForTimezone, resolveTimezone } from '../utils/time.js';

export async function getLateClockInLog({ days = 30 } = {}) {
  const org = await prisma.orgSettings.findUnique({ where: { id: 'singleton' } });
  const tz = resolveTimezone(null, org);
  const since = dayStartForTimezone(new Date(), tz);
  since.setUTCDate(since.getUTCDate() - days);

  return prisma.attendanceRecord.findMany({
    where: {
      date: { gte: since },
      clockInTime: { not: null },
      OR: [
        { status: AttendanceStatus.LATE },
        { lateMinutes: { gt: 0 } },
        { lateNote: { not: null } },
      ],
    },
    include: {
      user: { select: { id: true, name: true, email: true, jobTitle: true } },
    },
    orderBy: [{ date: 'desc' }, { clockInTime: 'desc' }],
  });
}
