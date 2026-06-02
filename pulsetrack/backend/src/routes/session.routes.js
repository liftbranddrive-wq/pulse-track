import { Router } from 'express';
import { z } from 'zod';
import {
  startBreak,
  endBreak,
  manualPause,
  manualResume,
  markIdle,
  markGhost,
  resumeFromIdleOrGhost,
  logReminder,
  acknowledgeReminder,
  getTodaySummary,
  activeSession,
  heartbeatSession,
  aggregateSessionTotals,
  computeLiveActiveMs,
  BreakType,
} from '../services/sessionService.js';
import { authMiddleware } from '../middleware/auth.js';
import { prisma } from '../db.js';
import {
  validateClockIn,
  processClockIn,
  processClockOut,
  recordHeartbeat,
  getClockInStatus,
} from '../services/attendanceService.js';
import { clientIp } from './attendance.routes.js';

const router = Router();

router.use(authMiddleware());

router.get('/today', async (req, res) => {
  const summary = await getTodaySummary(req.user.id);
  return res.json(summary);
});

router.get('/active', async (req, res) => {
  const session = await activeSession(req.user.id);
  if (session?.id) await aggregateSessionTotals(session.id).catch(() => {});
  const fresh = session?.id ? await activeSession(req.user.id) : session;
  return res.json({
    session: fresh,
    liveActiveMs: computeLiveActiveMs(fresh),
  });
});

router.post('/heartbeat', async (req, res) => {
  const Schema = z.object({ sessionId: z.string() });
  const { sessionId } = Schema.parse(req.body);
  await recordHeartbeat(req.user.id, sessionId).catch(() => {});
  const result = await heartbeatSession(req.user.id, sessionId);
  if (result?.error) return res.status(400).json(result);
  return res.json(result);
});

router.get('/clock-status', async (req, res) => {
  const status = await getClockInStatus(req.user.id);
  return res.json(status);
});

router.post('/clock-in', async (req, res) => {
  const Schema = z.object({
    lateNote: z.string().optional(),
    earlyNote: z.string().optional(),
    deviceFingerprint: z.string().optional(),
  });
  const body = Schema.parse(req.body ?? {});
  const ip = clientIp(req);

  const validation = await validateClockIn(req.user.id, {
    lateNote: body.lateNote,
    earlyNote: body.earlyNote,
    deviceFingerprint: body.deviceFingerprint,
    ipAddress: ip,
  });
  if (validation.error) return res.status(400).json(validation);

  const result = await processClockIn(req.user.id, validation);
  req.app.locals.io?.broadcastTeam?.().catch?.(() => {});
  req.app.locals.io?.emitActivity?.({
    type: 'clock_in',
    userId: req.user.id,
    isLate: result.isLate,
    lateMinutes: result.lateMinutes,
    isEarlyStart: result.isEarlyStart,
  }).catch?.(() => {});
  return res.json({
    ...result.session,
    attendance: result.record,
    isLate: result.isLate,
    isEarlyStart: result.isEarlyStart,
    expectedClockOutBy: result.expectedClockOutBy,
    requiredHours: result.requiredHours,
  });
});

router.post('/clock-out', async (req, res) => {
  const Schema = z.object({ sessionId: z.string() });
  const { sessionId } = Schema.parse(req.body);
  const ip = clientIp(req);

  const attResult = await processClockOut(req.user.id, sessionId, { ipAddress: ip });
  if (attResult.error) return res.status(400).json(attResult);

  req.app.locals.io?.broadcastTeam?.().catch?.(() => {});
  req.app.locals.io?.emitActivity?.({
    type: 'clock_out',
    userId: req.user.id,
    summary: attResult.summary,
  }).catch?.(() => {});
  return res.json({ ...attResult.session, summary: attResult.summary });
});

router.post('/break/start', async (req, res) => {
  const Schema = z.object({
    sessionId: z.string(),
    type: z.nativeEnum(BreakType),
  });
  const { sessionId, type } = Schema.parse(req.body);

  const result = await startBreak(req.user.id, sessionId, type);
  if (result?.error) return res.status(400).json(result);
  req.app.locals.io?.broadcastTeam?.().catch?.(() => {});
  return res.json(result);
});

router.post('/break/end', async (req, res) => {
  const Schema = z.object({ sessionId: z.string() });
  const { sessionId } = Schema.parse(req.body);

  const result = await endBreak(req.user.id, sessionId);
  if (result?.error) return res.status(400).json(result);
  req.app.locals.io?.broadcastTeam?.().catch?.(() => {});
  return res.json(result);
});

router.post('/pause', async (req, res) => {
  const Schema = z.object({ sessionId: z.string() });
  const { sessionId } = Schema.parse(req.body);
  const result = await manualPause(req.user.id, sessionId);
  if (result?.error) return res.status(400).json(result);
  req.app.locals.io?.broadcastTeam?.().catch?.(() => {});
  return res.json(result);
});

router.post('/resume', async (req, res) => {
  const Schema = z.object({ sessionId: z.string() });
  const { sessionId } = Schema.parse(req.body);
  const result = await manualResume(req.user.id, sessionId);
  if (result?.error) return res.status(400).json(result);
  req.app.locals.io?.broadcastTeam?.().catch?.(() => {});
  return res.json(result);
});

router.post('/state/idle', async (req, res) => {
  const Schema = z.object({ sessionId: z.string() });
  const { sessionId } = Schema.parse(req.body);
  const result = await markIdle(req.user.id, sessionId);
  if (result?.error) return res.status(400).json(result);
  req.app.locals.io?.broadcastTeam?.().catch?.(() => {});
  return res.json(result);
});

router.post('/state/ghost', async (req, res) => {
  const Schema = z.object({ sessionId: z.string() });
  const { sessionId } = Schema.parse(req.body);
  const result = await markGhost(req.user.id, sessionId);
  if (result?.error) return res.status(400).json(result);
  req.app.locals.io?.broadcastTeam?.().catch?.(() => {});
  return res.json(result);
});

router.post('/state/resume-focus', async (req, res) => {
  const Schema = z.object({ sessionId: z.string() });
  const { sessionId } = Schema.parse(req.body);
  const result = await resumeFromIdleOrGhost(req.user.id, sessionId);
  if (result?.error) return res.status(400).json(result);
  req.app.locals.io?.broadcastTeam?.().catch?.(() => {});
  return res.json(result);
});

router.post('/reminder', async (req, res) => {
  const Schema = z.object({
    sessionId: z.string(),
    level: z.enum(['L1', 'L2', 'L3']),
  });
  const { sessionId, level } = Schema.parse(req.body);
  await logReminder(sessionId, req.user.id, level);
  return res.json({ ok: true });
});

router.post('/reminder/ack', async (req, res) => {
  const Schema = z.object({
    sessionId: z.string(),
    level: z.enum(['L1', 'L2', 'L3']),
  });
  const { sessionId, level } = Schema.parse(req.body);
  await acknowledgeReminder(sessionId, req.user.id, level);
  return res.json({ ok: true });
});

router.patch('/preferences', async (req, res) => {
  const Schema = z.object({
    inactivityThresholdMin: z.number().int().min(5).max(60).optional(),
    preferredTheme: z.enum(['light', 'dark']).optional(),
  });
  const data = Schema.parse(req.body);
  const user = await prisma.user.update({
    where: { id: req.user.id },
    data,
  });
  return res.json({
    inactivityThresholdMin: user.inactivityThresholdMin,
    preferredTheme: user.preferredTheme,
  });
});

export default router;
