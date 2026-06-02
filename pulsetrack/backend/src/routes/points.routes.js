import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth.js';
import {
  getPointsHistory,
  getLeaderboard,
  manualAdjust,
  redeemPoints,
  getPointRules,
} from '../services/pointsEngine.js';
import { prisma } from '../db.js';

const router = Router();

router.get('/rules', authMiddleware('ADMIN'), async (_req, res) => {
  const rules = await getPointRules();
  return res.json(rules);
});

router.get('/leaderboard/monthly', authMiddleware('ADMIN'), async (_req, res) => {
  const board = await getLeaderboard(10);
  return res.json(board);
});

router.post('/manual-adjust', authMiddleware('ADMIN'), async (req, res) => {
  const Schema = z.object({
    userId: z.string(),
    points: z.number().int(),
    reason: z.string().min(5),
  });
  const { userId, points, reason } = Schema.parse(req.body);
  const tx = await manualAdjust(userId, points, reason, req.user.id);
  return res.json(tx);
});

router.post('/redeem', authMiddleware('ADMIN'), async (req, res) => {
  const Schema = z.object({
    userId: z.string(),
    points: z.number().int().positive(),
    reason: z.string().min(5),
  });
  const { userId, points, reason } = Schema.parse(req.body);
  const result = await redeemPoints(userId, points, reason);
  if (result?.error) return res.status(400).json(result);
  return res.json(result);
});

router.get('/:userId', authMiddleware(), async (req, res) => {
  if (req.user.role !== 'ADMIN' && req.user.id !== req.params.userId) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const user = await prisma.user.findUnique({
    where: { id: req.params.userId },
    select: { id: true, name: true, points: true, streakDays: true },
  });
  const history = await getPointsHistory(req.params.userId);
  const todayEarned = history
    .filter((t) => t.createdAt >= new Date(new Date().setUTCHours(0, 0, 0, 0)) && t.points > 0)
    .reduce((a, t) => a + t.points, 0);

  return res.json({ user, history, todayEarned });
});

export default router;
