import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth.js';
import {
  getNotifications,
  markAllRead,
  unreadCount,
} from '../services/notificationService.js';
import { getAnomalies, resolveAnomaly, authorizeDevice } from '../services/anomalyDetector.js';
import { prisma } from '../db.js';
import { AnomalyType } from '@prisma/client';

const router = Router();

router.get('/anomalies/list', authMiddleware('ADMIN'), async (req, res) => {
  const resolved = req.query.resolved === 'true' ? true : req.query.resolved === 'false' ? false : undefined;
  const userId = req.query.userId;
  const rows = await getAnomalies({ resolved, userId, limit: 200 });
  return res.json(rows);
});

router.patch('/anomalies/:id/resolve', authMiddleware('ADMIN'), async (req, res) => {
  const Schema = z.object({ resolution: z.string().min(3) });
  const { resolution } = Schema.parse(req.body);
  const row = await resolveAnomaly(req.params.id, req.user.id, resolution);
  return res.json(row);
});

/** Clear noisy heartbeat-lost rows after server fix (admin only). */
router.post('/anomalies/resolve-heartbeat-batch', authMiddleware('ADMIN'), async (req, res) => {
  const result = await prisma.anomalyLog.updateMany({
    where: { type: AnomalyType.HEARTBEAT_GAP, resolved: false },
    data: {
      resolved: true,
      resolvedById: req.user.id,
      resolvedAt: new Date(),
      resolution: 'Bulk resolved — connection/rate-limit fix deployed',
    },
  });
  return res.json({ resolved: result.count });
});

router.patch('/users/:id/authorize-device', authMiddleware('ADMIN'), async (req, res) => {
  const Schema = z.object({ fingerprint: z.string().min(8) });
  const { fingerprint } = Schema.parse(req.body);
  const result = await authorizeDevice(req.params.id, fingerprint);
  if (result.error) return res.status(400).json(result);
  return res.json(result);
});

router.get('/:userId', authMiddleware(), async (req, res) => {
  if (req.user.role !== 'ADMIN' && req.user.id !== req.params.userId) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const limit = req.query.limit ? Number(req.query.limit) : 50;
  const unreadOnly = req.query.unread === 'true';
  const rows = await getNotifications(req.params.userId, { limit, unreadOnly });
  const unread = await unreadCount(req.params.userId);
  return res.json({ notifications: rows, unread });
});

router.patch('/read-all/:userId', authMiddleware(), async (req, res) => {
  if (req.user.role !== 'ADMIN' && req.user.id !== req.params.userId) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  await markAllRead(req.params.userId);
  return res.json({ ok: true });
});

export default router;
