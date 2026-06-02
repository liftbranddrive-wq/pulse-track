import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { getEarlyStartLog, getTodayEarlyStartCount } from '../services/earlyStartService.js';

const router = Router();

router.get('/log', authMiddleware('ADMIN'), async (req, res) => {
  const days = Math.min(90, Math.max(1, Number(req.query.days) || 30));
  const rows = await getEarlyStartLog({ days });
  return res.json(rows);
});

router.get('/today-count', authMiddleware('ADMIN'), async (_req, res) => {
  const count = await getTodayEarlyStartCount();
  return res.json({ count });
});

export default router;
