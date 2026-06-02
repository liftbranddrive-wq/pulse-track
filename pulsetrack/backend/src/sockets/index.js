import { Server as IOServer } from 'socket.io';
import jwt from 'jsonwebtoken';
import { prisma } from '../db.js';
import { config } from '../config/index.js';
import { getTeamPresence, todayTeamTotals } from '../services/presenceService.js';
import { getTeamAttendanceReport } from '../services/attendanceService.js';

const activityFeed = [];
const MAX_FEED = 100;

function pushActivity(event) {
  const entry = { ...event, at: new Date().toISOString(), id: `${Date.now()}-${Math.random()}` };
  activityFeed.unshift(entry);
  if (activityFeed.length > MAX_FEED) activityFeed.pop();
  return entry;
}

export function attachSocket(httpServer, app) {
  const io = new IOServer(httpServer, {
    cors: { origin: true, credentials: true },
  });

  app.locals.io = io;
  globalThis.__pulsetrackIo = io;

  io.use(async (socket, next) => {
    try {
      const token =
        socket.handshake.auth?.token ||
        socket.handshake.headers.authorization?.replace('Bearer ', '');
      if (!token) throw new Error('No token');

      const decoded = jwt.verify(token, config.jwtAccessSecret);
      const user = await prisma.user.findUnique({ where: { id: decoded.sub } });
      if (!user?.active) throw new Error('Inactive');

      socket.data.userId = user.id;
      socket.data.role = user.role;
      next();
    } catch (e) {
      next(new Error('Unauthorized'));
    }
  });

  const emitPresence = async () => {
    const board = await getTeamPresence();
    const totals = await todayTeamTotals();
    const attendance = await getTeamAttendanceReport().catch(() => []);

    const present = attendance.filter((a) =>
      ['PRESENT', 'LATE'].includes(a.record?.status),
    ).length;
    const absent = attendance.filter((a) => a.record?.status === 'ABSENT').length;
    const late = attendance.filter((a) => a.record?.status === 'LATE').length;
    const onLeave = attendance.filter((a) => a.record?.status === 'ON_LEAVE').length;
    const notClocked = attendance.filter(
      (a) => !a.record || a.record.status === 'NOT_CLOCKED',
    ).length;

    io.to('admins').emit('team:status', {
      board,
      totals,
      attendance: { present, absent, late, onLeave, notClocked, rows: attendance },
    });
  };

  io.emitActivity = async (event) => {
    const user = event.userId
      ? await prisma.user.findUnique({
          where: { id: event.userId },
          select: { name: true },
        })
      : null;
    const entry = pushActivity({ ...event, name: user?.name ?? event.name });
    io.to('admins').emit('activity:feed', entry);
  };

  io.on('connection', async (socket) => {
    if (socket.data.role === 'ADMIN') {
      socket.join('admins');
      await emitPresence();
      socket.emit('activity:feed:history', activityFeed.slice(0, 50));
    } else {
      socket.join(`user:${socket.data.userId}`);
    }

    socket.on('team:refresh', async () => {
      if (socket.data.role === 'ADMIN') await emitPresence();
    });
  });

  io.broadcastTeam = emitPresence;

  return io;
}
