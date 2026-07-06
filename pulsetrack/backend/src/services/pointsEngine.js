import { prisma } from '../db.js';
import { DEFAULT_POINT_RULES, FIXED_RULE_KEYS } from '../utils/time.js';
import { createNotification } from './notificationService.js';
import { randomUUID } from 'crypto';

function normalizeCustomTasks(tasks) {
  if (!Array.isArray(tasks)) return [];
  return tasks
    .filter((t) => t && typeof t.name === 'string' && t.name.trim())
    .map((t) => ({
      id: typeof t.id === 'string' && t.id ? t.id : randomUUID(),
      name: t.name.trim(),
      points: Number.isFinite(Number(t.points)) ? Math.trunc(Number(t.points)) : 0,
      active: t.active !== false,
    }));
}

export async function getPointRules() {
  const org = await prisma.orgSettings.findUnique({ where: { id: 'singleton' } });
  const stored = org?.pointRules;
  if (stored && typeof stored === 'object' && !Array.isArray(stored)) {
    const merged = { ...DEFAULT_POINT_RULES, ...stored };
    merged.customTasks = normalizeCustomTasks(stored.customTasks ?? merged.customTasks);
    return merged;
  }
  return { ...DEFAULT_POINT_RULES, customTasks: [] };
}

export async function updatePointRules(payload) {
  const current = await getPointRules();
  const next = { ...current };

  for (const key of FIXED_RULE_KEYS) {
    if (payload[key] != null) next[key] = Math.trunc(Number(payload[key]));
  }
  if (payload.customTasks != null) {
    next.customTasks = normalizeCustomTasks(payload.customTasks);
  }

  await prisma.orgSettings.upsert({
    where: { id: 'singleton' },
    create: { id: 'singleton', pointRules: next },
    update: { pointRules: next },
  });

  return getPointRules();
}

export async function awardCustomTask(userId, taskId, adminId) {
  const rules = await getPointRules();
  const task = (rules.customTasks ?? []).find((t) => t.id === taskId && t.active !== false);
  if (!task) return { error: 'Task not found or inactive' };
  if (!task.points) return { error: 'Task has zero points' };

  const tx = await applyPoints(userId, {
    points: task.points,
    type: 'earn',
    description: task.name,
    triggeredBy: 'ADMIN',
    relatedRecordId: adminId,
  });
  return { tx, task };
}

export async function applyPoints(userId, { points, type, description, relatedRecordId, triggeredBy = 'SYSTEM' }) {
  if (!points) return null;

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return null;

  const balanceBefore = user.points;
  const balanceAfter = balanceBefore + points;

  const tx = await prisma.pointTransaction.create({
    data: {
      userId,
      type,
      points,
      description,
      triggeredBy,
      relatedRecordId,
      balanceBefore,
      balanceAfter,
    },
  });

  await prisma.user.update({
    where: { id: userId },
    data: { points: balanceAfter },
  });

  if (points > 0) {
    await createNotification({
      recipientId: userId,
      type: 'SUCCESS',
      category: 'points',
      message: `+${points} pts — ${description}`,
      relatedId: tx.id,
    }).catch(() => {});
  } else if (points < 0) {
    await createNotification({
      recipientId: userId,
      type: 'WARNING',
      category: 'points',
      message: `${points} pts — ${description}`,
      relatedId: tx.id,
    }).catch(() => {});
  }

  return tx;
}

export async function awardOnTimeClockIn(userId, recordId) {
  const rules = await getPointRules();
  return applyPoints(userId, {
    points: rules.onTimeClockIn,
    type: 'earn',
    description: 'On-time clock-in',
    relatedRecordId: recordId,
  });
}

export async function awardFullHours(userId, recordId) {
  const rules = await getPointRules();
  return applyPoints(userId, {
    points: rules.fullHours,
    type: 'earn',
    description: 'Full required hours completed',
    relatedRecordId: recordId,
  });
}

export async function awardOvertime(userId, overtimeHours, recordId) {
  const rules = await getPointRules();
  const pts = Math.floor(overtimeHours) * rules.overtimeHour;
  if (pts <= 0) return null;
  return applyPoints(userId, {
    points: pts,
    type: 'earn',
    description: `Overtime (${overtimeHours.toFixed(1)}h)`,
    relatedRecordId: recordId,
  });
}

export async function deductAbsent(userId, recordId) {
  const rules = await getPointRules();
  return applyPoints(userId, {
    points: rules.unexcusedAbsent,
    type: 'deduct',
    description: 'Unexcused absence',
    relatedRecordId: recordId,
  });
}

export async function deductLateWithoutNote(userId, recordId) {
  const rules = await getPointRules();
  return applyPoints(userId, {
    points: rules.lateWithoutNote,
    type: 'deduct',
    description: 'Late without note',
    relatedRecordId: recordId,
  });
}

export async function manualAdjust(userId, points, reason, adminId) {
  return applyPoints(userId, {
    points,
    type: 'admin_adjust',
    description: reason,
    triggeredBy: 'ADMIN',
    relatedRecordId: adminId,
  });
}

export async function redeemPoints(userId, points, reason) {
  if (points <= 0) return { error: 'Invalid amount' };
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || user.points < points) return { error: 'Insufficient points' };
  return applyPoints(userId, {
    points: -points,
    type: 'redeem',
    description: reason,
    triggeredBy: 'ADMIN',
  });
}

export async function getPointsHistory(userId, limit = 100) {
  return prisma.pointTransaction.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}

export async function getLeaderboard(limit = 10) {
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);

  const txs = await prisma.pointTransaction.groupBy({
    by: ['userId'],
    where: {
      createdAt: { gte: monthStart },
      type: { in: ['earn', 'admin_adjust'] },
      points: { gt: 0 },
    },
    _sum: { points: true },
    orderBy: { _sum: { points: 'desc' } },
    take: limit,
  });

  const users = await prisma.user.findMany({
    where: { id: { in: txs.map((t) => t.userId) } },
    select: { id: true, name: true, email: true, points: true, avatarUrl: true },
  });
  const map = new Map(users.map((u) => [u.id, u]));

  return txs.map((t, i) => ({
    rank: i + 1,
    monthlyPoints: t._sum.points ?? 0,
    member: map.get(t.userId),
  }));
}

export async function updateStreak(userId, onTimeAndComplete) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return;

  if (onTimeAndComplete) {
    const newStreak = user.streakDays + 1;
    await prisma.user.update({
      where: { id: userId },
      data: {
        streakDays: newStreak,
        perfectStreakStart: user.perfectStreakStart ?? new Date(),
      },
    });

    if (newStreak > 0 && newStreak % 20 === 0) {
      const rules = await getPointRules();
      await applyPoints(userId, {
        points: rules.streakBonus,
        type: 'earn',
        description: `${newStreak}-day perfect attendance streak bonus`,
      });
      await createNotification({
        recipientId: userId,
        type: 'SUCCESS',
        category: 'streak',
        message: `🔥 ${newStreak}-day streak! +${rules.streakBonus} bonus points`,
      }).catch(() => {});
    }
  } else {
    await prisma.user.update({
      where: { id: userId },
      data: { streakDays: 0, perfectStreakStart: null },
    });
  }
}
