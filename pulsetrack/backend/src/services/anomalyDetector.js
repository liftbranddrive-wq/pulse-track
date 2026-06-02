import { prisma } from '../db.js';
import { AnomalyType } from '@prisma/client';
import { notifyAdmins } from './notificationService.js';

export async function logAnomaly(userId, type, details = {}, { ipAddress, deviceFingerprint } = {}) {
  const anomaly = await prisma.anomalyLog.create({
    data: {
      userId,
      type,
      details,
      ipAddress,
      deviceFingerprint,
    },
    include: { user: { select: { name: true } } },
  });

  await notifyAdmins({
    type: 'DANGER',
    category: 'anomaly',
    message: `${anomaly.user.name} — ${type.replace(/_/g, ' ').toLowerCase()}`,
    relatedId: anomaly.id,
  }).catch(() => {});

  return anomaly;
}

export async function validateDevice(user, fingerprint) {
  if (!fingerprint) return { ok: true };

  const authorized = Array.isArray(user.authorizedDevices) ? user.authorizedDevices : [];

  if (!user.deviceFingerprint && authorized.length === 0) {
    await prisma.user.update({
      where: { id: user.id },
      data: {
        deviceFingerprint: fingerprint,
        authorizedDevices: [fingerprint],
      },
    });
    return { ok: true, firstDevice: true };
  }

  const known =
    fingerprint === user.deviceFingerprint || authorized.includes(fingerprint);

  if (!known) {
    await logAnomaly(user.id, AnomalyType.NEW_DEVICE, { fingerprint }, { deviceFingerprint: fingerprint });
    return { ok: false, error: 'Unknown device — contact admin for authorization', flagged: true };
  }

  return { ok: true };
}

export async function logIpOnClockIn(user, ip, dayStart) {
  if (!ip) return;

  const authorized = Array.isArray(user.authorizedIPs) ? user.authorizedIPs : [];
  if (authorized.length === 0) {
    await prisma.user.update({
      where: { id: user.id },
      data: { authorizedIPs: [ip] },
    });
    return;
  }

  const otherSessions = await prisma.workSession.findMany({
    where: {
      userId: user.id,
      clockIn: { gte: dayStart },
      ipAddress: { not: null },
    },
    select: { ipAddress: true },
  });

  const ips = new Set(otherSessions.map((s) => s.ipAddress).filter(Boolean));
  ips.add(ip);

  if (ips.size > 1) {
    await logAnomaly(user.id, AnomalyType.DUAL_IP, { ips: [...ips] }, { ipAddress: ip });
  }
}

export async function checkIpChange(session, clockOutIp) {
  if (!session.ipAddress || !clockOutIp) return;
  if (session.ipAddress !== clockOutIp) {
    await logAnomaly(session.userId, AnomalyType.IP_CHANGE, {
      clockInIp: session.ipAddress,
      clockOutIp,
    }, { ipAddress: clockOutIp, deviceFingerprint: session.deviceFingerprint });
  }
}

export async function checkSessionAnomalies(userId, session, totalHours) {
  const clockIn = session.clockIn;
  const clockOut = session.clockOut;
  if (clockIn && clockOut) {
    const mins = (clockOut - clockIn) / 60_000;
    if (mins < 5) {
      await logAnomaly(userId, AnomalyType.SHORT_SESSION, { minutes: mins });
    }
  }
  if (totalHours > 14) {
    await logAnomaly(userId, AnomalyType.EXCESSIVE_HOURS, { hours: totalHours });
  }
}

export async function checkGraceAbuse(userId, lateMinutes, graceMinutes) {
  if (lateMinutes > 0 && lateMinutes <= graceMinutes && lateMinutes >= graceMinutes - 1) {
    const recent = await prisma.attendanceRecord.count({
      where: {
        userId,
        graceUsed: true,
        lateMinutes: { gte: graceMinutes - 1, lte: graceMinutes },
        date: { gte: new Date(Date.now() - 30 * 86400_000) },
      },
    });
    if (recent >= 5) {
      await logAnomaly(userId, AnomalyType.GRACE_ABUSE, { count: recent });
    }
  }
}

export async function getAnomalies({ resolved, userId, limit = 200 } = {}) {
  return prisma.anomalyLog.findMany({
    where: {
      ...(typeof resolved === 'boolean' ? { resolved } : {}),
      ...(userId ? { userId } : {}),
    },
    include: { user: { select: { id: true, name: true, email: true } } },
    orderBy: { timestamp: 'desc' },
    take: limit,
  });
}

export async function resolveAnomaly(id, adminId, resolution) {
  return prisma.anomalyLog.update({
    where: { id },
    data: {
      resolved: true,
      resolvedById: adminId,
      resolvedAt: new Date(),
      resolution,
    },
  });
}

export async function authorizeDevice(userId, fingerprint) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return { error: 'User not found' };

  const devices = Array.isArray(user.authorizedDevices) ? [...user.authorizedDevices] : [];
  if (!devices.includes(fingerprint)) devices.push(fingerprint);

  await prisma.user.update({
    where: { id: userId },
    data: {
      deviceFingerprint: fingerprint,
      authorizedDevices: devices,
    },
  });

  await prisma.anomalyLog.updateMany({
    where: { userId, type: AnomalyType.NEW_DEVICE, resolved: false },
    data: {
      resolved: true,
      resolvedById: null,
      resolvedAt: new Date(),
      resolution: 'Device authorized by admin',
    },
  });

  return { ok: true };
}
