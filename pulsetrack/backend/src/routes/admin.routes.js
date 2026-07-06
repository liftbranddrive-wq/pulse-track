import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { FlagType } from '@prisma/client';
import { authMiddleware } from '../middleware/auth.js';
import { hashPassword } from '../utils/password.js';
import { getTeamPresence, todayTeamTotals } from '../services/presenceService.js';
import { aggregateSessionTotals } from '../services/sessionService.js';

const router = Router();

router.use(authMiddleware('ADMIN'));

router.get('/dashboard', async (req, res) => {
  const team = await getTeamPresence();
  const totals = await todayTeamTotals();

  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);

  const yStart = new Date(start);
  yStart.setUTCDate(yStart.getUTCDate() - 1);

  const [yesterdayAgg, flaggedMembers] = await Promise.all([
    prisma.workSession.aggregate({
      where: { clockIn: { gte: yStart, lt: start } },
      _sum: { totalActiveMs: true },
    }),
    prisma.cheatFlag.findMany({
      where: {
        dismissed: false,
        day: { gte: start, lt: new Date(start.getTime() + 86400000) },
      },
      distinct: ['userId'],
      select: { userId: true },
    }),
  ]);

  const todayActiveMs = totals?.totalActiveMs ?? 0;
  const yesterdayActiveMs = yesterdayAgg._sum.totalActiveMs ?? 0;
  const hoursDeltaVsYesterday =
    yesterdayActiveMs > 0 ? (todayActiveMs - yesterdayActiveMs) / 3_600_000 : null;

  return res.json({
    team,
    totals,
    flaggedToday: flaggedMembers.length,
    yesterdayActiveMs,
    hoursDeltaVsYesterday,
  });
});

router.get('/nav-badges', async (_req, res) => {
  const ghostAlerts = await prisma.cheatFlag.count({
    where: { dismissed: false, type: FlagType.GHOST_TIMER },
  });

  const openFlags = await prisma.cheatFlag.count({
    where: { dismissed: false },
  });

  const pendingLeaves = await prisma.leaveRequest.count({
    where: { status: 'PENDING' },
  });

  const openAnomalies = await prisma.anomalyLog.count({
    where: { resolved: false },
  });

  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);

  const todayEarlyStarts = await prisma.attendanceRecord.count({
    where: {
      isEarlyStart: true,
      date: { gte: dayStart },
    },
  });

  res.json({ ghostAlerts, openFlags, pendingLeaves, openAnomalies, todayEarlyStarts });
});

router.get('/analytics/team-week', async (_req, res) => {
  const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const out = [];

  for (let i = 6; i >= 0; i--) {
    const day = new Date();
    day.setUTCHours(0, 0, 0, 0);
    day.setUTCDate(day.getUTCDate() - i);
    const next = new Date(day.getTime() + 86400000);

    const sessions = await prisma.workSession.findMany({
      where: { clockIn: { gte: day, lt: next } },
    });

    let activeMs = 0;
    let ghostMs = 0;
    for (const s of sessions) {
      activeMs += s.totalActiveMs ?? 0;
      ghostMs += s.totalGhostMs ?? 0;
    }

    out.push({
      label: dayLabels[day.getUTCDay()],
      dateKey: day.toISOString().slice(0, 10),
      activeH: Math.round((activeMs / 3_600_000) * 100) / 100,
      ghostH: Math.round((ghostMs / 3_600_000) * 100) / 100,
    });
  }

  res.json(out);
});

router.get('/time-logs/recent', async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 120, 500);
  const rows = await prisma.workSession.findMany({
    orderBy: { clockIn: 'desc' },
    take: limit,
    include: {
      user: { select: { id: true, name: true, email: true, jobTitle: true } },
    },
  });
  res.json(rows);
});

router.get('/members', async (req, res) => {
  const users = await prisma.user.findMany({
    select: {
      id: true,
      email: true,
      name: true,
      jobTitle: true,
      role: true,
      active: true,
      expectedStartMin: true,
      expectedEndMin: true,
      expectedDailyHoursMin: true,
      createdAt: true,
    },
  });
  res.json(users);
});

router.patch('/members/:id', async (req, res) => {
  const Schema = z.object({
    name: z.string().optional(),
    jobTitle: z.string().max(120).nullable().optional(),
    role: z.enum(['ADMIN', 'MEMBER']).optional(),
    active: z.boolean().optional(),
    password: z.string().min(8).optional(),
    expectedStartMin: z.number().int().nullable().optional(),
    expectedEndMin: z.number().int().nullable().optional(),
    expectedDailyHoursMin: z.number().int().nullable().optional(),
  });
  const data = Schema.parse(req.body);

  const update = { ...data };
  if (data.password) {
    update.passwordHash = await hashPassword(data.password);
    delete update.password;
  }

  const user = await prisma.user.update({ where: { id: req.params.id }, data: update });

  await prisma.auditLog.create({
    data: {
      actorId: req.user.id,
      action: 'USER_UPDATED',
      entityType: 'User',
      entityId: user.id,
      diffJson: update,
    },
  });

  res.json({ id: user.id, email: user.email, role: user.role, active: user.active });
});

router.delete('/members/:id', async (req, res) => {
  await prisma.user.update({
    where: { id: req.params.id },
    data: { active: false },
  });
  await prisma.auditLog.create({
    data: {
      actorId: req.user.id,
      action: 'USER_DISABLED',
      entityType: 'User',
      entityId: req.params.id,
    },
  });
  res.json({ ok: true });
});

router.get('/members/:id/sessions', async (req, res) => {
  const sessions = await prisma.workSession.findMany({
    where: { userId: req.params.id },
    orderBy: { clockIn: 'desc' },
    take: 60,
    include: { segments: true, breaks: true, reminders: true },
  });
  res.json(sessions);
});

router.patch('/sessions/:id/edit', async (req, res) => {
  const Schema = z.object({
    clockIn: z.coerce.date().optional(),
    clockOut: z.coerce.date().optional().nullable(),
    reason: z.string().min(3),
    totals: z
      .object({
        totalActiveMs: z.number(),
        totalIdleMs: z.number(),
        totalGhostMs: z.number(),
        totalBreakMs: z.number(),
        totalPausedMs: z.number(),
      })
      .optional(),
  });

  const body = Schema.parse(req.body);
  const session = await prisma.workSession.findUnique({ where: { id: req.params.id } });
  if (!session) return res.status(404).json({ error: 'Not found' });

  const prev = session;
  const next = await prisma.workSession.update({
    where: { id: req.params.id },
    data: {
      clockIn: body.clockIn ?? session.clockIn,
      clockOut: body.clockOut === undefined ? session.clockOut : body.clockOut,
      totalActiveMs: body.totals?.totalActiveMs ?? session.totalActiveMs,
      totalIdleMs: body.totals?.totalIdleMs ?? session.totalIdleMs,
      totalGhostMs: body.totals?.totalGhostMs ?? session.totalGhostMs,
      totalBreakMs: body.totals?.totalBreakMs ?? session.totalBreakMs,
      totalPausedMs: body.totals?.totalPausedMs ?? session.totalPausedMs,
    },
  });

  await prisma.timeEdit.create({
    data: {
      sessionId: session.id,
      editorId: req.user.id,
      previousJson: prev,
      updatedJson: next,
      reason: body.reason,
    },
  });

  await prisma.auditLog.create({
    data: {
      actorId: req.user.id,
      action: 'SESSION_EDITED',
      entityType: 'WorkSession',
      entityId: session.id,
      reason: body.reason,
      diffJson: { before: prev, after: next },
    },
  });

  res.json(next);
});

router.post('/sessions/:id/recompute', async (req, res) => {
  await aggregateSessionTotals(req.params.id);
  const s = await prisma.workSession.findUnique({ where: { id: req.params.id } });
  res.json(s);
});

router.get('/flags', async (req, res) => {
  const flags = await prisma.cheatFlag.findMany({
    orderBy: { createdAt: 'desc' },
    take: 200,
    include: { user: { select: { id: true, name: true, email: true } } },
  });
  res.json(flags);
});

router.patch('/flags/:id/dismiss', async (req, res) => {
  const Schema = z.object({ note: z.string().min(3) });
  const { note } = Schema.parse(req.body);

  const flag = await prisma.cheatFlag.update({
    where: { id: req.params.id },
    data: {
      dismissed: true,
      dismissedAt: new Date(),
      dismissedNote: note,
      dismissedById: req.user.id,
    },
  });

  await prisma.auditLog.create({
    data: {
      actorId: req.user.id,
      action: 'FLAG_DISMISSED',
      entityType: 'CheatFlag',
      entityId: flag.id,
      reason: note,
    },
  });

  res.json(flag);
});

router.get('/audit', async (_req, res) => {
  const rows = await prisma.auditLog.findMany({
    orderBy: { createdAt: 'desc' },
    take: 250,
    include: { actor: { select: { id: true, name: true, email: true } } },
  });
  res.json(rows);
});

router.get('/org', async (_req, res) => {
  let org = await prisma.orgSettings.findUnique({ where: { id: 'singleton' } });
  if (!org) {
    org = await prisma.orgSettings.create({
      data: { id: 'singleton', companyName: 'PulseTrack Team', timezone: 'Asia/Karachi' },
    });
  } else if (!org.timezone || org.timezone === 'UTC') {
    org = await prisma.orgSettings.update({
      where: { id: 'singleton' },
      data: { timezone: 'Asia/Karachi' },
    });
  }
  res.json(org);
});

router.patch('/org', async (req, res) => {
  const Schema = z
    .object({
      companyName: z.string().optional(),
      globalL1Min: z.number().optional(),
      globalL2Min: z.number().optional(),
      globalL3Min: z.number().optional(),
      timezone: z.string().optional(),
      ghostDayRatioThreshold: z.number().optional(),
      allowMemberTimeEdits: z.boolean().optional(),
      customReminderTemplate: z.string().optional(),
      weeklyTeamReportEnabled: z.boolean().optional(),
      dailySummaryEnabled: z.boolean().optional(),
      individualWeeklyEnabled: z.boolean().optional(),
      flagAlertEnabled: z.boolean().optional(),
      absenteeAlertEnabled: z.boolean().optional(),
      emailProvider: z.enum(['SMTP', 'SENDGRID']).optional(),
      smtpHost: z.string().optional(),
      smtpPort: z.number().optional(),
      smtpUser: z.string().optional(),
      smtpPass: z.string().optional(),
      smtpFrom: z.string().optional(),
      sendgridApiKey: z.string().optional(),
      weeklyReportRecipients: z.array(z.string().email()).optional(),
      adminSummaryRecipients: z.array(z.string().email()).optional(),
    })
    .strict()
    .partial();

  const data = Schema.parse(req.body);

  let org = await prisma.orgSettings.findUnique({ where: { id: 'singleton' } });
  if (!org) {
    org = await prisma.orgSettings.create({
      data: { id: 'singleton', ...data },
    });
  } else {
    org = await prisma.orgSettings.update({
      where: { id: 'singleton' },
      data: {
        ...data,
        ...(data.weeklyReportRecipients
          ? { weeklyReportRecipients: data.weeklyReportRecipients }
          : {}),
        ...(data.adminSummaryRecipients
          ? { adminSummaryRecipients: data.adminSummaryRecipients }
          : {}),
      },
    });
  }

  await prisma.auditLog.create({
    data: {
      actorId: req.user.id,
      action: 'ORG_UPDATED',
      entityType: 'OrgSettings',
      entityId: 'singleton',
      diffJson: data,
    },
  });

  res.json(org);
});

router.get('/reports/focus-board', async (req, res) => {
  const range = z.enum(['today', 'week']).parse(req.query.range ?? 'today');
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  if (range === 'week') start.setUTCDate(start.getUTCDate() - 6);

  const members = await prisma.user.findMany({
    where: { role: 'MEMBER', active: true },
    select: { id: true, name: true, email: true, jobTitle: true },
  });

  const rows = [];
  for (const m of members) {
    const sessions = await prisma.workSession.findMany({
      where: { userId: m.id, clockIn: { gte: start } },
    });

    let clocked = 0;
    let active = 0;
    let ghost = 0;
    let idle = 0;
    let brk = 0;

    for (const s of sessions) {
      const out = s.clockOut || new Date();
      clocked += out - s.clockIn;
      active += s.totalActiveMs || 0;
      ghost += s.totalGhostMs || 0;
      idle += s.totalIdleMs || 0;
      brk += s.totalBreakMs || 0;
    }

    const score = clocked > 0 ? (active / clocked) * 100 : 0;
    const flagCount = await prisma.cheatFlag.count({
      where: { userId: m.id, dismissed: false, day: { gte: start } },
    });

    rows.push({
      member: m,
      clockedMs: clocked,
      activeMs: active,
      ghostMs: ghost,
      idleMs: idle,
      breakMs: brk,
      activityScore: Math.round(score * 10) / 10,
      flags: flagCount,
    });
  }

  rows.sort((a, b) => b.activityScore - a.activityScore);
  res.json(rows);
});

router.get('/weekly-accountability/weeks', async (_req, res) => {
  const { listAvailableWeeks } = await import('../services/weeklyAccountabilityService.js');
  const data = await listAvailableWeeks(20);
  res.json(data);
});

router.get('/weekly-accountability', async (req, res) => {
  const weekStart = req.query.weekStart ? String(req.query.weekStart) : undefined;
  const { generateWeeklyAccountability } = await import('../services/weeklyAccountabilityService.js');
  try {
    const data = await generateWeeklyAccountability(weekStart);
    res.json(data);
  } catch (e) {
    res.status(400).json({ error: e?.message ?? 'Could not generate report' });
  }
});

router.get('/reports/reminders', async (req, res) => {
  const start = req.query.from
    ? new Date(String(req.query.from))
    : (() => {
        const d = new Date();
        d.setUTCDate(d.getUTCDate() - 7);
        return d;
      })();

  const reminders = await prisma.inactivityReminder.groupBy({
    by: ['userId', 'level'],
    where: { sentAt: { gte: start } },
    _count: true,
  });

  res.json(reminders);
});

router.get('/email-log', async (_req, res) => {
  const rows = await prisma.emailLog.findMany({
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  res.json(rows);
});

router.post('/email/test', async (req, res) => {
  const Schema = z.object({ to: z.string().email() });
  const { to } = Schema.parse(req.body);

  const { sendRawEmail } = await import('../services/mailer.js');

  try {
    await sendRawEmail({
      to,
      subject: 'PulseTrack Test Email',
      html: '<p style="font-family:system-ui">If you received this, mail configuration is working.</p>',
    });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e?.message ?? e) });
  }
});

export default router;
