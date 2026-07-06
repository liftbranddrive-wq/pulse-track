import { prisma } from '../db.js';
import {
  SegmentType,
  SessionStatus,
  ReminderLevel,
  BreakType,
  FlagType,
} from '@prisma/client';
import { enqueueEmail } from '../jobs/emailQueue.js';

const now = () => new Date();

async function activeSession(userId) {
  return prisma.workSession.findFirst({
    where: { userId, clockOut: null },
    include: {
      segments: { orderBy: { startedAt: 'asc' } },
      breaks: { orderBy: { startedAt: 'asc' } },
    },
  });
}

async function closeOpenSegment(sessionId, end = now()) {
  const open = await prisma.sessionSegment.findFirst({
    where: { sessionId, endedAt: null },
    orderBy: { startedAt: 'desc' },
  });
  if (open) {
    await prisma.sessionSegment.update({
      where: { id: open.id },
      data: { endedAt: end },
    });
  }
}

async function ensureOpenSegment(sessionId, type, t = now()) {
  await closeOpenSegment(sessionId, t);
  return prisma.sessionSegment.create({
    data: { sessionId, type, startedAt: t },
  });
}

function msBetween(a, b) {
  return Math.max(0, b.getTime() - a.getTime());
}

export async function aggregateSessionTotals(sessionId) {
  const segs = await prisma.sessionSegment.findMany({
    where: { sessionId },
    orderBy: { startedAt: 'asc' },
  });

  let active = 0;
  let idle = 0;
  let ghost = 0;
  let manualPause = 0;
  let brkMs = 0;

  for (const s of segs) {
    const end = s.endedAt || now();
    const d = msBetween(s.startedAt, end);
    if (s.type === SegmentType.ACTIVE) active += d;
    if (s.type === SegmentType.IDLE) idle += d;
    if (s.type === SegmentType.GHOST) ghost += d;
    if (s.type === SegmentType.MANUAL_PAUSE) manualPause += d;
    if (s.type === SegmentType.BREAK) brkMs += d;
  }

  const clocked =
    segs.length > 0 ? msBetween(segs[0].startedAt, segs[segs.length - 1].endedAt || now()) : 0;

  const activityRatio = clocked > 0 ? (active / clocked) * 100 : 0;

  await prisma.workSession.update({
    where: { id: sessionId },
    data: {
      totalActiveMs: Math.round(active),
      totalIdleMs: Math.round(idle),
      totalGhostMs: Math.round(ghost),
      totalPausedMs: Math.round(manualPause),
      totalBreakMs: Math.round(brkMs),
      activityRatio,
    },
  });

  return { active, idle, ghost, manualPause, brkMs, activityRatio };
}

export async function clockIn(userId) {
  const existing = await activeSession(userId);
  if (existing) return { error: 'Already clocked in', session: existing };

  const session = await prisma.workSession.create({
    data: {
      userId,
      clockIn: now(),
      status: SessionStatus.WORKING,
    },
  });

  await prisma.sessionSegment.create({
    data: { sessionId: session.id, type: SegmentType.ACTIVE, startedAt: session.clockIn },
  });

  return { session: await prisma.workSession.findUnique({ where: { id: session.id } }) };
}

async function maybeInstantClockoutFlag(userId, sessionId, clockOutAt) {
  const lastL3 = await prisma.inactivityReminder.findFirst({
    where: { sessionId, level: ReminderLevel.L3 },
    orderBy: { sentAt: 'desc' },
  });
  if (!lastL3) return;
  const delta = Math.abs(msBetween(lastL3.sentAt, clockOutAt));
  if (delta <= 60_000) {
    const dayStart = new Date(clockOutAt);
    dayStart.setUTCHours(0, 0, 0, 0);
    await upsertFlag(userId, dayStart, FlagType.INSTANT_CLOCKOUT, {
      summary: 'Clock-out within 60s of Level 3 reminder',
      payload: { secondsAfterL3: Math.round(delta / 1000) },
    });
  }
}

export async function runPostClockOutHooks(userId, sessionId, clockOutAt) {
  await maybeInstantClockoutFlag(userId, sessionId, clockOutAt);
  await evaluateFlagsForDay(userId, clockOutAt);
  await maybeEnqueueFlagAlerts(userId, clockOutAt);
}

export async function clockOut(userId, sessionId) {
  const session = await prisma.workSession.findFirst({
    where: { id: sessionId, userId, clockOut: null },
  });
  if (!session) return { error: 'Session not found' };

  const t = now();
  await closeOpenSegment(session.id, t);

  await prisma.workSession.update({
    where: { id: session.id },
    data: { clockOut: t, status: SessionStatus.CLOCKED_OUT },
  });

  await aggregateSessionTotals(session.id);
  await runPostClockOutHooks(userId, session.id, t);

  return prisma.workSession.findUnique({
    where: { id: session.id },
    include: {
      segments: true,
      breaks: true,
    },
  });
}

export async function startBreak(userId, sessionId, breakType) {
  const session = await activeSession(userId);
  if (!session || session.id !== sessionId) return { error: 'No active session' };

  await prisma.workSession.update({
    where: { id: sessionId },
    data: { status: SessionStatus.ON_BREAK, lastHeartbeat: now() },
  });

  await closeOpenSegment(sessionId);
  await ensureOpenSegment(sessionId, SegmentType.BREAK);

  await prisma.breakRecord.create({
    data: { sessionId, type: breakType, startedAt: now() },
  });

  return activeSession(userId);
}

export async function endBreak(userId, sessionId) {
  const session = await activeSession(userId);
  if (!session || session.id !== sessionId) return { error: 'No active session' };

  const openBreak = await prisma.breakRecord.findFirst({
    where: { sessionId, endedAt: null },
    orderBy: { startedAt: 'desc' },
  });
  if (openBreak) {
    await prisma.breakRecord.update({
      where: { id: openBreak.id },
      data: { endedAt: now() },
    });
  }

  await closeOpenSegment(sessionId);
  await ensureOpenSegment(sessionId, SegmentType.ACTIVE);

  await prisma.workSession.update({
    where: { id: sessionId },
    data: { status: SessionStatus.WORKING },
  });

  await aggregateSessionTotals(sessionId);
  return activeSession(userId);
}

export async function manualPause(userId, sessionId) {
  const session = await activeSession(userId);
  if (!session || session.id !== sessionId) return { error: 'No active session' };

  await prisma.workSession.update({
    where: { id: sessionId },
    data: { status: SessionStatus.PAUSED_MANUAL, lastHeartbeat: now() },
  });
  await closeOpenSegment(sessionId);
  await ensureOpenSegment(sessionId, SegmentType.MANUAL_PAUSE);
  return activeSession(userId);
}

export async function manualResume(userId, sessionId) {
  const session = await activeSession(userId);
  if (!session || session.id !== sessionId) return { error: 'No active session' };

  await prisma.workSession.update({
    where: { id: sessionId },
    data: { status: SessionStatus.WORKING },
  });
  await closeOpenSegment(sessionId);
  await ensureOpenSegment(sessionId, SegmentType.ACTIVE);
  await aggregateSessionTotals(sessionId);
  return activeSession(userId);
}

export async function markIdle(userId, sessionId) {
  const session = await activeSession(userId);
  if (!session || session.id !== sessionId) return { error: 'No active session' };
  if (
    session.status === SessionStatus.ON_BREAK ||
    session.status === SessionStatus.PAUSED_MANUAL
  ) {
    return session;
  }

  await prisma.workSession.update({ where: { id: sessionId }, data: { status: SessionStatus.IDLE } });
  await closeOpenSegment(sessionId);
  await ensureOpenSegment(sessionId, SegmentType.IDLE);
  await aggregateSessionTotals(sessionId);
  return activeSession(userId);
}

export async function markGhost(userId, sessionId) {
  const session = await activeSession(userId);
  if (!session || session.id !== sessionId) return { error: 'No active session' };
  if (
    session.status === SessionStatus.ON_BREAK ||
    session.status === SessionStatus.PAUSED_MANUAL
  ) {
    return session;
  }

  await prisma.workSession.update({
    where: { id: sessionId },
    data: { status: SessionStatus.GHOST },
  });
  await closeOpenSegment(sessionId);
  await ensureOpenSegment(sessionId, SegmentType.GHOST);
  await aggregateSessionTotals(sessionId);
  return activeSession(userId);
}

export async function resumeFromIdleOrGhost(userId, sessionId) {
  const session = await activeSession(userId);
  if (!session || session.id !== sessionId) return { error: 'No active session' };
  if (
    session.status !== SessionStatus.GHOST &&
    session.status !== SessionStatus.IDLE
  ) {
    return { session, liveActiveMs: computeLiveActiveMs(session) };
  }

  const ts = now();
  await prisma.workSession.update({
    where: { id: sessionId },
    data: {
      status: SessionStatus.WORKING,
      sessionPaused: false,
      lastHeartbeat: ts,
    },
  });
  await closeOpenSegment(sessionId);
  await ensureOpenSegment(sessionId, SegmentType.ACTIVE, ts);
  await aggregateSessionTotals(sessionId);
  const fresh = await activeSession(userId);
  return {
    session: fresh,
    liveActiveMs: computeLiveActiveMs(fresh),
  };
}

export async function logReminder(sessionId, userId, level) {
  const lvl =
    level === 'L3'
      ? ReminderLevel.L3
      : level === 'L2'
        ? ReminderLevel.L2
        : ReminderLevel.L1;

  await prisma.inactivityReminder.create({
    data: { sessionId, userId, level: lvl },
  });

  const inc =
    level === 'L3' ? 'l3Sent' : level === 'L2' ? 'l2Sent' : 'l1Sent';
  await prisma.workSession.update({
    where: { id: sessionId },
    data: { [inc]: { increment: 1 } },
  });
}

export async function acknowledgeReminder(sessionId, userId, level) {
  const lvl =
    level === 'L3'
      ? ReminderLevel.L3
      : level === 'L2'
        ? ReminderLevel.L2
        : ReminderLevel.L1;

  const last = await prisma.inactivityReminder.findFirst({
    where: { sessionId, userId, level: lvl },
    orderBy: { sentAt: 'desc' },
  });
  if (last && !last.respondedAt) {
    const delay = msBetween(last.sentAt, now()) / 1000;
    await prisma.inactivityReminder.update({
      where: { id: last.id },
      data: { respondedAt: now(), responseDelaySec: Math.round(delay) },
    });
  }
}

async function evaluateFlagsForDay(userId, endOfPeriod) {
  const org = await prisma.orgSettings.findUnique({ where: { id: 'singleton' } });
  const dayStart = new Date(endOfPeriod);
  dayStart.setUTCHours(0, 0, 0, 0);

  const sessions = await prisma.workSession.findMany({
    where: { userId, clockIn: { gte: dayStart, lte: endOfPeriod } },
  });

  let clockedMs = 0;
  let activeMs = 0;
  let ghostMs = 0;

  for (const s of sessions) {
    const out = s.clockOut || endOfPeriod;
    clockedMs += msBetween(s.clockIn, out);
    activeMs += s.totalActiveMs;
    ghostMs += s.totalGhostMs;
  }

  const ghostRatio = clockedMs > 0 ? ghostMs / clockedMs : 0;

  const reminders = await prisma.inactivityReminder.findMany({
    where: {
      userId,
      sentAt: { gte: dayStart },
      level: { in: [ReminderLevel.L2, ReminderLevel.L3] },
    },
  });

  if (ghostRatio >= (org?.ghostDayRatioThreshold ?? 0.3)) {
    await upsertFlag(userId, dayStart, FlagType.GHOST_TIMER, {
      summary: 'High ghost time relative to clocked time today',
      payload: { ghostRatio, ghostMs, clockedMs },
    });
  }

  if (reminders.length >= (org?.reminderL2DailyThreshold ?? 3)) {
    await upsertFlag(userId, dayStart, FlagType.REMINDER_IGNORER, {
      summary: 'Multiple firm or auto-pause reminders without timely response',
      payload: { count: reminders.length },
    });
  }

  const ratio = clockedMs > 0 ? (activeMs / clockedMs) * 100 : 0;
  if (ratio < (org?.lowActivityScoreThreshold ?? 50)) {
    await upsertFlag(userId, dayStart, FlagType.LOW_ACTIVITY_SCORE, {
      summary: 'Activity score below threshold for the day',
      payload: { score: ratio },
    });
  }
}

async function upsertFlag(userId, day, type, { summary, payload }) {
  const existing = await prisma.cheatFlag.findFirst({
    where: { userId, day, type, dismissed: false },
  });
  if (existing) return existing;
  return prisma.cheatFlag.create({
    data: { userId, day, type, summary, payload: payload || {} },
  });
}

async function maybeEnqueueFlagAlerts(userId, endOfPeriod) {
  const org = await prisma.orgSettings.findUnique({ where: { id: 'singleton' } });
  if (!org?.flagAlertEnabled) return;

  const recips = [];
  if (Array.isArray(org.adminSummaryRecipients) && org.adminSummaryRecipients.length) {
    for (const x of org.adminSummaryRecipients) {
      if (typeof x === 'string' && x.includes('@')) recips.push(x);
    }
  } else if (Array.isArray(org.weeklyReportRecipients)) {
    for (const x of org.weeklyReportRecipients) {
      if (typeof x === 'string' && x.includes('@')) recips.push(x);
    }
  }
  if (!recips.length) return;

  const dayStart = new Date(endOfPeriod);
  dayStart.setUTCHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);

  const flagCount = await prisma.cheatFlag.count({
    where: { userId, dismissed: false, day: dayStart },
  });

  const sessions = await prisma.workSession.findMany({
    where: { userId, clockIn: { gte: dayStart, lt: dayEnd } },
  });
  let ghostMs = 0;
  for (const s of sessions) ghostMs += s.totalGhostMs || 0;
  const ghostHours = ghostMs / 3_600_000;

  if (flagCount < 3 && ghostHours <= 2) return;

  const dedupKey = `flag-alert-${userId}-${dayStart.toISOString().slice(0, 10)}`;
  const hit = await prisma.scheduledDedup.findUnique({ where: { key: dedupKey } });
  if (hit) return;

  await prisma.scheduledDedup.create({
    data: { key: dedupKey, runAt: new Date() },
  });

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { name: true },
  });
  if (!user) return;

  const alert = { memberName: user.name, flagCount, ghostHours };

  for (const to of recips) {
    await enqueueEmail({ type: 'FLAG_ALERT', to, alert }).catch((e) =>
      console.error('Flag alert email failed', to, e),
    );
  }
}

/** Live billable/active ms including open ACTIVE segment (excludes idle/ghost/break). */
export function computeLiveActiveMs(session) {
  if (!session) return 0;
  const segs = session.segments || [];
  if (segs.length) {
    let active = 0;
    for (const s of segs) {
      if (s.type !== SegmentType.ACTIVE) continue;
      const end = s.endedAt || now();
      active += msBetween(s.startedAt, end);
    }
    return Math.round(active);
  }
  return session.totalActiveMs || 0;
}

/** Stop billing active time when extension heartbeats stop (browser closed, etc.). */
export async function autoPauseStaleSession(session) {
  if (!session?.id || session.clockOut) return session;
  if (
    session.status === SessionStatus.GHOST ||
    session.status === SessionStatus.IDLE ||
    session.status === SessionStatus.PAUSED_MANUAL ||
    session.status === SessionStatus.ON_BREAK
  ) {
    return session;
  }

  const org = await prisma.orgSettings.findUnique({ where: { id: 'singleton' } });
  const timeoutMin = org?.heartbeatTimeoutMin ?? 15;
  const lastBeat = session.lastHeartbeat ? new Date(session.lastHeartbeat) : new Date(session.clockIn);
  const pauseAt = new Date(lastBeat.getTime() + timeoutMin * 60_000);

  if (Date.now() <= pauseAt.getTime()) return session;

  await closeOpenSegment(session.id, pauseAt);
  await prisma.workSession.update({
    where: { id: session.id },
    data: { status: SessionStatus.GHOST, sessionPaused: true },
  });
  await ensureOpenSegment(session.id, SegmentType.GHOST, pauseAt);
  await aggregateSessionTotals(session.id);
  return activeSession(session.userId);
}

export async function heartbeatSession(userId, sessionId) {
  let session = await activeSession(userId);
  if (!session || session.id !== sessionId) return { error: 'No active session' };

  session = await autoPauseStaleSession(session);

  await aggregateSessionTotals(sessionId);
  const fresh = await activeSession(userId);
  return {
    session: fresh,
    liveActiveMs: computeLiveActiveMs(fresh),
  };
}

export async function getTodaySummary(userId) {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);

  const sessions = await prisma.workSession.findMany({
    where: { userId, clockIn: { gte: start } },
    include: { breaks: true, segments: true },
  });

  let work = 0;
  let brk = 0;
  let idle = 0;
  let ghost = 0;

  for (const s of sessions) {
    work += s.totalActiveMs;
    brk += s.totalBreakMs;
    idle += s.totalIdleMs;
    ghost += s.totalGhostMs;
  }

  return {
    sessions: sessions.length,
    workMs: work,
    breakMs: brk,
    idleMs: idle,
    ghostMs: ghost,
  };
}

export { activeSession, BreakType };
