import { prisma } from '../db.js';

export async function createNotification({
  recipientId,
  type = 'INFO',
  category,
  message,
  relatedId,
}) {
  const n = await prisma.notification.create({
    data: {
      recipientId,
      type,
      category,
      message,
      relatedId,
    },
  });

  const io = globalThis.__pulsetrackIo;
  if (io) {
    io.to(`user:${recipientId}`).emit('notification:new', n);
    io.to('admins').emit('admin:notification', n);
  }

  return n;
}

export async function notifyAdmins({ type = 'WARNING', category, message, relatedId }) {
  const admins = await prisma.user.findMany({
    where: { role: 'ADMIN', active: true },
    select: { id: true },
  });
  const results = [];
  for (const a of admins) {
    results.push(
      await createNotification({
        recipientId: a.id,
        type,
        category,
        message,
        relatedId,
      }),
    );
  }
  return results;
}

export async function getNotifications(userId, { limit = 50, unreadOnly = false } = {}) {
  return prisma.notification.findMany({
    where: {
      recipientId: userId,
      ...(unreadOnly ? { read: false } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}

export async function markAllRead(userId) {
  await prisma.notification.updateMany({
    where: { recipientId: userId, read: false },
    data: { read: true },
  });
  return { ok: true };
}

export async function unreadCount(userId) {
  return prisma.notification.count({
    where: { recipientId: userId, read: false },
  });
}
