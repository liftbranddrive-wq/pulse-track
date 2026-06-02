import { Router } from 'express';
import { z } from 'zod';
import { LeaveType } from '@prisma/client';
import { authMiddleware } from '../middleware/auth.js';
import {
  submitLeaveRequest,
  getPendingLeaves,
  getLeaveHistory,
  approveLeave,
  rejectLeave,
  getLeaveBalanceOverview,
} from '../services/leaveService.js';

const router = Router();

router.post('/request', authMiddleware(), async (req, res) => {
  const Schema = z.object({
    requestedDate: z.string(),
    endDate: z.string().optional(),
    type: z.nativeEnum(LeaveType),
    reason: z.string().min(30),
    isEmergency: z.boolean().optional(),
  });
  const body = Schema.parse(req.body);
  const result = await submitLeaveRequest(req.user.id, body);
  if (result.error) return res.status(400).json(result);
  return res.json(result);
});

router.get('/pending', authMiddleware('ADMIN'), async (_req, res) => {
  const rows = await getPendingLeaves();
  return res.json(rows);
});

router.get('/history/:userId', authMiddleware(), async (req, res) => {
  if (req.user.role !== 'ADMIN' && req.user.id !== req.params.userId) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const rows = await getLeaveHistory(req.params.userId);
  return res.json(rows);
});

router.patch('/:id/approve', authMiddleware('ADMIN'), async (req, res) => {
  const Schema = z.object({ adminNote: z.string().optional() });
  const { adminNote } = Schema.parse(req.body ?? {});
  const result = await approveLeave(req.params.id, req.user.id, adminNote);
  if (result.error) return res.status(400).json(result);
  req.app.locals.io?.broadcastTeam?.().catch?.(() => {});
  return res.json(result);
});

router.patch('/:id/reject', authMiddleware('ADMIN'), async (req, res) => {
  const Schema = z.object({ adminNote: z.string().min(3) });
  const { adminNote } = Schema.parse(req.body);
  const result = await rejectLeave(req.params.id, req.user.id, adminNote);
  if (result.error) return res.status(400).json(result);
  return res.json(result);
});

router.get('/balance', authMiddleware('ADMIN'), async (_req, res) => {
  const rows = await getLeaveBalanceOverview();
  return res.json(rows);
});

export default router;
