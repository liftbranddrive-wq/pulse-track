import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth.js';
import {
  getPointsHistory,
  getLeaderboard,
  manualAdjust,
  redeemPoints,
  getPointRules,
  updatePointRules,
  awardCustomTask,
} from '../services/pointsEngine.js';
import { FIXED_RULE_KEYS } from '../utils/time.js';
import { prisma } from '../db.js';

const router = Router();

router.get('/rules', authMiddleware(), async (req, res) => {
  const rules = await getPointRules();
  return res.json(rules);
});

router.patch('/rules', authMiddleware('ADMIN'), async (req, res) => {
  const num = z.number().int();
  const shape = {};
  for (const key of FIXED_RULE_KEYS) shape[key] = num.optional();
  shape.customTasks = z
    .array(
      z.object({
        id: z.string().optional(),
        name: z.string().min(2),
        points: z.number().int(),
        active: z.boolean().optional(),
      }),
    )
    .optional();
  const payload = z.object(shape).parse(req.body);
  const rules = await updatePointRules(payload);
  return res.json(rules);
});

router.post('/award-task', authMiddleware('ADMIN'), async (req, res) => {
  const Schema = z.object({
    userId: z.string(),
    taskId: z.string(),
  });
  const { userId, taskId } = Schema.parse(req.body);
  const result = await awardCustomTask(userId, taskId, req.user.id);
  if (result?.error) return res.status(400).json(result);
  return res.json(result);
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
