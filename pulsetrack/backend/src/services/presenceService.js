import { prisma } from '../db.js';
import { SessionStatus } from '@prisma/client';

export async function getTeamPresence() {
  const users = await prisma.user.findMany({
    where: { active: true, role: 'MEMBER' },
    select: {
      id: true,
      name: true,
      email: true,
      avatarUrl: true,
      jobTitle: true,
      workSessions: {
        where: { clockOut: null },
        take: 1,
      },
    },
  });

  return users.map((u) => {
    const sess = u.workSessions[0];
    let presence = 'OFFLINE';
    if (sess) {
      presence =
        sess.status === SessionStatus.ON_BREAK
          ? 'ON_BREAK'
          : sess.status === SessionStatus.IDLE
            ? 'IDLE'
            : sess.status === SessionStatus.GHOST
              ? 'GHOST'
              : sess.status === SessionStatus.PAUSED_MANUAL
              ? 'PAUSED'
              : 'WORKING';
    }
    return {
      userId: u.id,
      name: u.name,
      email: u.email,
      jobTitle: u.jobTitle,
      avatarUrl: u.avatarUrl,
      presence,
      session: sess ?? null,
    };
  });
}

export async function todayTeamTotals() {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);

  const agg = await prisma.workSession.aggregate({
    where: {
      clockIn: { gte: start },
    },
    _sum: {
      totalActiveMs: true,
      totalGhostMs: true,
      totalIdleMs: true,
      totalBreakMs: true,
    },
  });

  return agg._sum;
}
