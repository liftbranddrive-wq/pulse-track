import cron from 'node-cron';
import { markAbsentForDay, runEndOfDayAutoClockOut } from '../services/attendanceService.js';
import { prisma } from '../db.js';
import { AnomalyType, SessionStatus } from '@prisma/client';
import { enqueueEmail } from './emailQueue.js';

function emailList(org, primary, fallback) {
  const a = org?.[primary];
  if (Array.isArray(a) && a.length) {
    return a.filter((x) => typeof x === 'string' && x.includes('@'));
  }
  const b = org?.[fallback];
  if (Array.isArray(b) && b.length) {
    return b.filter((x) => typeof x === 'string' && x.includes('@'));
  }
  return [];
}

async function tryWeeklySend() {
  const org = await prisma.orgSettings.findUnique({ where: { id: 'singleton' } });
  if (!org?.weeklyTeamReportEnabled) return;

  const recipients = org.weeklyReportRecipients;
  if (!Array.isArray(recipients) || recipients.length === 0) return;

  const key = `weekly-team-${new Date().toISOString().slice(0, 10)}`;
  const existing = await prisma.scheduledDedup.findUnique({ where: { key } });
  if (existing) return;

  await prisma.scheduledDedup.create({
    data: { key, runAt: new Date() },
  });

  for (const to of recipients) {
    if (typeof to === 'string' && to.includes('@')) {
      await enqueueEmail({ type: 'WEEKLY_TEAM', to }).catch((e) =>
        console.error('Weekly email failed', to, e),
      );
    }
  }
}

async function tryIndividualWeeklySend() {
  const org = await prisma.orgSettings.findUnique({ where: { id: 'singleton' } });
  if (!org?.individualWeeklyEnabled) return;

  const key = `individual-weekly-${new Date().toISOString().slice(0, 10)}`;
  const existing = await prisma.scheduledDedup.findUnique({ where: { key } });
  if (existing) return;

  await prisma.scheduledDedup.create({ data: { key, runAt: new Date() } });

  const members = await prisma.user.findMany({
    where: { role: 'MEMBER', active: true, individualEmailOptIn: true },
  });

  for (const m of members) {
    await enqueueEmail({ type: 'INDIVIDUAL_WEEKLY', to: m.email, userId: m.id }).catch((e) =>
      console.error('Individual weekly failed', m.email, e),
    );
  }
}

async function tryDailySummarySend() {
  const org = await prisma.orgSettings.findUnique({ where: { id: 'singleton' } });
  if (!org?.dailySummaryEnabled) return;

  const recips = emailList(org, 'adminSummaryRecipients', 'weeklyReportRecipients');
  if (!recips.length) return;

  const key = `daily-summary-${new Date().toISOString().slice(0, 10)}`;
  const existing = await prisma.scheduledDedup.findUnique({ where: { key } });
  if (existing) return;

  await prisma.scheduledDedup.create({ data: { key, runAt: new Date() } });

  for (const to of recips) {
    await enqueueEmail({ type: 'DAILY_ADMIN_SUMMARY', to }).catch((e) =>
      console.error('Daily summary failed', to, e),
    );
  }
}

async function tryAbsenteeSend() {
  const org = await prisma.orgSettings.findUnique({ where: { id: 'singleton' } });
  if (!org?.absenteeAlertEnabled) return;

  const recips = emailList(org, 'adminSummaryRecipients', 'weeklyReportRecipients');
  if (!recips.length) return;

  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);

  const members = await prisma.user.findMany({ where: { role: 'MEMBER', active: true } });
  const absentNames = [];

  for (const m of members) {
    const hit = await prisma.workSession.findFirst({
      where: { userId: m.id, clockIn: { gte: dayStart, lt: dayEnd } },
    });
    if (!hit) absentNames.push(m.name);
  }

  if (!absentNames.length) return;

  const key = `absentee-${new Date().toISOString().slice(0, 10)}`;
  const existing = await prisma.scheduledDedup.findUnique({ where: { key } });
  if (existing) return;

  await prisma.scheduledDedup.create({ data: { key, runAt: new Date() } });

  for (const to of recips) {
    await enqueueEmail({ type: 'ABSENTEE_ALERT', to, absentNames }).catch((e) =>
      console.error('Absentee alert failed', to, e),
    );
  }
}

async function runMondayJobs() {
  await tryWeeklySend();
  await tryIndividualWeeklySend();
}

async function tryWeeklyAccountabilityGeneration() {
  const { runScheduledWeeklyAccountability } = await import(
    '../services/weeklyAccountabilityService.js'
  );
  await runScheduledWeeklyAccountability().catch((e) =>
    console.error('Weekly accountability generation failed', e),
  );
}

async function tryAutoAbsentMarking() {
  const org = await prisma.orgSettings.findUnique({ where: { id: 'singleton' } });
  const clockInMin = org?.expectedWindowStartMin ?? 540;
  const windowAfter = org?.clockInWindowAfterMin ?? 120;
  const cutoffMin = clockInMin + windowAfter + 30; // 30 min after window closes

  const now = new Date();
  const currentMin = now.getUTCHours() * 60 + now.getUTCMinutes();
  if (currentMin < cutoffMin) return;

  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const key = `auto-absent-${dayStart.toISOString().slice(0, 10)}`;
  const existing = await prisma.scheduledDedup.findUnique({ where: { key } });
  if (existing) return;

  await prisma.scheduledDedup.create({ data: { key, runAt: new Date() } });

  const members = await prisma.user.findMany({ where: { role: 'MEMBER', active: true } });
  for (const m of members) {
    await markAbsentForDay(m.id, dayStart).catch((e) =>
      console.error('Auto absent failed', m.id, e),
    );
  }
}

async function checkHeartbeatTimeouts(app) {
  const org = await prisma.orgSettings.findUnique({ where: { id: 'singleton' } });
  const timeoutMin = org?.heartbeatTimeoutMin ?? 15;
  const cutoff = new Date(Date.now() - timeoutMin * 60_000);

  const stale = await prisma.workSession.findMany({
    where: {
      clockOut: null,
      sessionPaused: false,
      status: {
        notIn: [
          SessionStatus.ON_BREAK,
          SessionStatus.PAUSED_MANUAL,
          SessionStatus.GHOST,
          SessionStatus.IDLE,
        ],
      },
      OR: [{ lastHeartbeat: { lt: cutoff } }, { lastHeartbeat: null }],
    },
    include: { user: { select: { id: true, name: true } } },
  });

  for (const s of stale) {
    if (!s.lastHeartbeat && Date.now() - s.clockIn.getTime() < timeoutMin * 60_000) continue;

    const openGap = await prisma.anomalyLog.findFirst({
      where: {
        userId: s.userId,
        type: AnomalyType.HEARTBEAT_GAP,
        resolved: false,
      },
      orderBy: { timestamp: 'desc' },
    });
    const gapSessionId = openGap?.details?.sessionId;
    if (openGap && gapSessionId === s.id) continue;

    const { autoPauseStaleSession } = await import('../services/sessionService.js');
    await autoPauseStaleSession(s).catch((e) =>
      console.error('Auto-pause stale session failed', s.id, e),
    );

    const { logAnomaly } = await import('../services/anomalyDetector.js');
    await logAnomaly(s.userId, AnomalyType.HEARTBEAT_GAP, {
      sessionId: s.id,
      lastHeartbeat: s.lastHeartbeat,
    }).catch(() => {});

    app.locals.io?.emitActivity?.({
      type: 'heartbeat_lost',
      userId: s.userId,
      name: s.user.name,
    }).catch?.(() => {});
  }
}

export function startSchedulers(app) {
  setInterval(() => {
    app.locals.io?.broadcastTeam?.().catch?.(() => {});
  }, 30_000);

  cron.schedule(
    '0 9 * * 1',
    () => {
      runMondayJobs().catch((e) => console.error(e));
    },
    { timezone: 'UTC' },
  );

  cron.schedule(
    '0 19 * * *',
    () => {
      tryDailySummarySend().catch((e) => console.error(e));
    },
    { timezone: 'UTC' },
  );

  cron.schedule(
    '0 11 * * 1-5',
    () => {
      tryAbsenteeSend().catch((e) => console.error(e));
    },
    { timezone: 'UTC' },
  );

  cron.schedule(
    '30 12 * * 1-5',
    () => {
      tryAutoAbsentMarking().catch((e) => console.error(e));
    },
    { timezone: 'UTC' },
  );

  cron.schedule(
    '*/5 * * * *',
    () => {
      checkHeartbeatTimeouts(app).catch((e) => console.error(e));
    },
    { timezone: 'UTC' },
  );

  /** Monday 1:00 PM Pakistan — pre-generate last week's accountability digests for admin. */
  cron.schedule(
    '0 13 * * 1',
    () => {
      tryWeeklyAccountabilityGeneration().catch((e) => console.error(e));
    },
    { timezone: 'Asia/Karachi' },
  );

  /** 11:59 PM Pakistan — auto clock-out all open sessions for that calendar day. */
  cron.schedule(
    '59 23 * * *',
    () => {
      runEndOfDayAutoClockOut()
        .then((r) => {
          if (r?.closed > 0) {
            console.log(`EOD auto clock-out: ${r.closed} session(s) on ${r.dateKey} (${r.timezone})`);
            app.locals.io?.broadcastTeam?.().catch?.(() => {});
          }
        })
        .catch((e) => console.error('EOD auto clock-out failed', e));
    },
    { timezone: 'Asia/Karachi' },
  );
}
