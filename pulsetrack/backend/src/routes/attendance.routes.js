import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth.js';
import {
  getClockInStatus,
  getAttendanceHistory,
  getTeamAttendanceReport,
  correctAttendance,
  formatScheduleAnnouncement,
  getScheduleForUser,
} from '../services/attendanceService.js';
import { getMemberMonthlyReport } from '../services/memberReportService.js';
import { prisma } from '../db.js';

const router = Router();

function clientIp(req) {
  return (
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.headers['x-real-ip'] ||
    req.socket?.remoteAddress ||
    null
  );
}

router.use(authMiddleware());

router.get('/status', async (req, res) => {
  const status = await getClockInStatus(req.user.id);
  return res.json(status);
});

router.get('/today/:userId', async (req, res) => {
  if (req.user.role !== 'ADMIN' && req.user.id !== req.params.userId) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const status = await getClockInStatus(req.params.userId);
  return res.json(status);
});

router.get('/history/:userId', async (req, res) => {
  if (req.user.role !== 'ADMIN' && req.user.id !== req.params.userId) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const { from, to, limit } = req.query;
  const rows = await getAttendanceHistory(req.params.userId, {
    from,
    to,
    limit: limit ? Number(limit) : 60,
  });
  return res.json(rows);
});

router.get('/monthly/:userId', async (req, res) => {
  if (req.user.role !== 'ADMIN' && req.user.id !== req.params.userId) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  try {
    const report = await getMemberMonthlyReport(req.params.userId, req.query.month);
    if (report.error) return res.status(404).json(report);
    return res.json(report);
  } catch (e) {
    return res.status(400).json({ error: e.message || 'Invalid month' });
  }
});

router.get('/report', authMiddleware('ADMIN'), async (req, res) => {
  const day = req.query.day ? new Date(req.query.day) : undefined;
  const report = await getTeamAttendanceReport({ day });
  return res.json(report);
});

router.patch('/:id/correct', authMiddleware('ADMIN'), async (req, res) => {
  const Schema = z.object({
    reason: z.string().min(5),
    fields: z.record(z.any()),
  });
  const { reason, fields } = Schema.parse(req.body);
  const result = await correctAttendance(req.params.id, req.user.id, fields, reason);
  if (result.error) return res.status(400).json(result);
  req.app.locals.io?.broadcastTeam?.().catch?.(() => {});
  return res.json(result);
});

router.get('/schedule/current', async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  const schedule = await getScheduleForUser(user);
  const org = await prisma.orgSettings.findUnique({ where: { id: 'singleton' } });
  return res.json({ schedule, announcement: formatScheduleAnnouncement(schedule, org) });
});

router.post('/schedule/set', authMiddleware('ADMIN'), async (req, res) => {
  const Schema = z.object({
    expectedWindowStartMin: z.number().int().min(0).max(1439).optional(),
    expectedWindowEndMin: z.number().int().min(0).max(1439).optional(),
    requiredHoursMin: z.number().int().min(60).max(720).optional(),
    graceMinutes: z.number().int().min(0).max(60).optional(),
    clockInWindowBeforeMin: z.number().int().min(0).max(120).optional(),
    clockInWindowAfterMin: z.number().int().min(0).max(240).optional(),
    maxEarlyStartMin: z.number().int().min(30).max(480).optional(),
    activityChallengeEnabled: z.boolean().optional(),
    activityChallengeIntervalMin: z.number().int().min(15).max(120).optional(),
    heartbeatTimeoutMin: z.number().int().min(5).max(60).optional(),
    effectiveFrom: z.string().optional(),
  });
  const data = Schema.parse(req.body);
  const { effectiveFrom, ...orgFields } = data;

  const org = await prisma.orgSettings.update({
    where: { id: 'singleton' },
    data: orgFields,
  });

  await prisma.auditLog.create({
    data: {
      actorId: req.user.id,
      action: 'SCHEDULE_UPDATE',
      entityType: 'OrgSettings',
      entityId: 'singleton',
      reason: effectiveFrom ? `Effective from ${effectiveFrom}` : 'Schedule updated',
      diffJson: orgFields,
    },
  });

  const schedule = await getScheduleForUser({ expectedStartMin: org.expectedWindowStartMin });
  return res.json({
    org,
    announcement: formatScheduleAnnouncement(
      {
        clockInMin: org.expectedWindowStartMin,
        clockOutMin: org.expectedWindowEndMin,
        requiredHoursMin: org.requiredHoursMin,
        graceMinutes: org.graceMinutes,
      },
      org,
    ),
  });
});

export { clientIp };
export default router;
