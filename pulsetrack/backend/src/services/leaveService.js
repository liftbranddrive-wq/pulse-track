import { prisma } from '../db.js';
import { LeaveStatus, AttendanceStatus } from '@prisma/client';
import { utcDayStart, dayStartForTimezone, resolveTimezone } from '../utils/time.js';
import { createNotification, notifyAdmins } from './notificationService.js';

const MIN_ADVANCE_DAYS = 3;

/** True only when `dayStart` falls inside [requestedDate, endDate ?? requestedDate]. */
export async function isUserOnLeaveForDay(userId, dayStart, timezone = 'Asia/Karachi') {
  const day = dayStart instanceof Date ? dayStart : dayStartForTimezone(new Date(dayStart), timezone);
  const dayMs = day.getTime();

  const leaves = await prisma.leaveRequest.findMany({
    where: {
      userId,
      status: LeaveStatus.APPROVED,
      requestedDate: { lte: day },
    },
  });

  for (const leave of leaves) {
    const start = dayStartForTimezone(new Date(leave.requestedDate), timezone);
    const end = leave.endDate
      ? dayStartForTimezone(new Date(leave.endDate), timezone)
      : start;
    if (dayMs >= start.getTime() && dayMs <= end.getTime()) return true;
  }
  return false;
}

export async function submitLeaveRequest(userId, { requestedDate, endDate, type, reason, isEmergency }) {
  const reqDate = utcDayStart(new Date(requestedDate));
  const today = utcDayStart();
  const daysAhead = Math.floor((reqDate - today) / 86400_000);

  if (reqDate < today) {
    await prisma.auditLog.create({
      data: {
        actorId: userId,
        action: 'LEAVE_BACKDATE_ATTEMPT',
        entityType: 'LeaveRequest',
        reason: `Attempted past date: ${requestedDate}`,
      },
    });
    return { error: 'Leave requests cannot be submitted for past dates' };
  }

  if (!isEmergency && daysAhead < MIN_ADVANCE_DAYS) {
    return {
      error: `Leave must be requested at least ${MIN_ADVANCE_DAYS} days in advance. Use emergency leave for same-day requests.`,
      minDays: MIN_ADVANCE_DAYS,
    };
  }

  if (!reason || reason.trim().length < 30) {
    return { error: 'Reason required (minimum 30 characters)' };
  }

  const leave = await prisma.leaveRequest.create({
    data: {
      userId,
      requestedDate: reqDate,
      endDate: endDate ? utcDayStart(new Date(endDate)) : null,
      type,
      reason: reason.trim(),
      isEmergency: !!isEmergency,
      status: LeaveStatus.PENDING,
    },
    include: { user: { select: { name: true } } },
  });

  const urgent = daysAhead <= 1;
  await notifyAdmins({
    type: urgent ? 'DANGER' : 'WARNING',
    category: 'leave',
    message: `${leave.user.name} submitted ${isEmergency ? 'emergency ' : ''}leave for ${reqDate.toISOString().slice(0, 10)}`,
    relatedId: leave.id,
  }).catch(() => {});

  return leave;
}

export async function getPendingLeaves() {
  return prisma.leaveRequest.findMany({
    where: { status: LeaveStatus.PENDING },
    include: { user: { select: { id: true, name: true, email: true, avatarUrl: true, department: true } } },
    orderBy: [{ isEmergency: 'desc' }, { requestedDate: 'asc' }],
  });
}

export async function getApprovedLeaves({ limit = 50 } = {}) {
  return prisma.leaveRequest.findMany({
    where: { status: LeaveStatus.APPROVED },
    include: {
      user: { select: { id: true, name: true, email: true } },
      reviewedBy: { select: { name: true } },
    },
    orderBy: { requestedDate: 'desc' },
    take: limit,
  });
}

export async function getLeaveHistory(userId) {
  return prisma.leaveRequest.findMany({
    where: { userId },
    orderBy: { submittedAt: 'desc' },
    include: { reviewedBy: { select: { name: true } } },
  });
}

async function markLeaveDays(userId, startDate, endDate) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  const org = await prisma.orgSettings.findUnique({ where: { id: 'singleton' } });
  const tz = resolveTimezone(user, org);
  const start = dayStartForTimezone(new Date(startDate), tz);
  const end = endDate ? dayStartForTimezone(new Date(endDate), tz) : start;
  const requiredHoursMin = user?.expectedDailyHoursMin ?? org?.requiredHoursMin ?? 480;

  for (let t = start.getTime(); t <= end.getTime(); t += 86400_000) {
    const dayAnchor = dayStartForTimezone(new Date(t), tz);
    await prisma.attendanceRecord.upsert({
      where: { userId_date: { userId, date: dayAnchor } },
      create: {
        userId,
        date: dayAnchor,
        status: AttendanceStatus.ON_LEAVE,
        scheduledClockIn: org?.expectedWindowStartMin ?? 540,
        scheduledClockOut: org?.expectedWindowEndMin ?? 1080,
        requiredHours: requiredHoursMin / 60,
      },
      update: { status: AttendanceStatus.ON_LEAVE },
    });
  }
}

async function clearLeaveDaysFromAttendance(userId, startDate, endDate) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  const org = await prisma.orgSettings.findUnique({ where: { id: 'singleton' } });
  const tz = resolveTimezone(user, org);
  const start = dayStartForTimezone(new Date(startDate), tz);
  const end = endDate ? dayStartForTimezone(new Date(endDate), tz) : start;
  let cleared = 0;

  for (let t = start.getTime(); t <= end.getTime(); t += 86400_000) {
    const dayAnchor = dayStartForTimezone(new Date(t), tz);
    const rec = await prisma.attendanceRecord.findUnique({
      where: { userId_date: { userId, date: dayAnchor } },
    });
    if (rec && rec.status === AttendanceStatus.ON_LEAVE && !rec.clockInTime) {
      await prisma.attendanceRecord.update({
        where: { id: rec.id },
        data: { status: AttendanceStatus.NOT_CLOCKED },
      });
      cleared += 1;
    }
  }
  return cleared;
}

/** Fix attendance rows stuck ON_LEAVE after leave day(s) passed or leave was cancelled. */
export async function repairStaleOnLeaveRecords(userId, adminId, reason) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return { error: 'User not found' };

  const org = await prisma.orgSettings.findUnique({ where: { id: 'singleton' } });
  const tz = resolveTimezone(user, org);

  const records = await prisma.attendanceRecord.findMany({
    where: { userId, status: AttendanceStatus.ON_LEAVE },
  });

  let fixed = 0;
  for (const rec of records) {
    const onLeave = await isUserOnLeaveForDay(userId, rec.date, tz);
    if (!onLeave && !rec.clockInTime) {
      await prisma.attendanceRecord.update({
        where: { id: rec.id },
        data: { status: AttendanceStatus.NOT_CLOCKED },
      });
      fixed += 1;
    }
  }

  if (adminId) {
    await prisma.auditLog.create({
      data: {
        actorId: adminId,
        action: 'LEAVE_STALE_REPAIR',
        entityType: 'User',
        entityId: userId,
        reason: reason || `Cleared ${fixed} stale ON_LEAVE row(s)`,
      },
    });
  }

  return { fixed, userId };
}

export async function clearLeaveDay(userId, dateStr, adminId, reason) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return { error: 'User not found' };

  const org = await prisma.orgSettings.findUnique({ where: { id: 'singleton' } });
  const tz = resolveTimezone(user, org);
  const dayAnchor = dayStartForTimezone(new Date(dateStr), tz);

  const rec = await prisma.attendanceRecord.findUnique({
    where: { userId_date: { userId, date: dayAnchor } },
  });
  if (!rec) return { error: 'No attendance record for that date' };
  if (rec.clockInTime) {
    return { error: 'Member already clocked in that day — use attendance correction instead' };
  }

  const updated = await prisma.attendanceRecord.update({
    where: { id: rec.id },
    data: { status: AttendanceStatus.NOT_CLOCKED },
  });

  await prisma.auditLog.create({
    data: {
      actorId: adminId,
      action: 'LEAVE_DAY_CLEAR',
      entityType: 'AttendanceRecord',
      entityId: rec.id,
      reason: reason || `Admin cleared ON_LEAVE for ${dateStr}`,
    },
  });

  await createNotification({
    recipientId: userId,
    type: 'INFO',
    category: 'leave',
    message: `Leave mark removed for ${dateStr} — you can clock in if you are working.`,
  }).catch(() => {});

  return updated;
}

export async function approveLeave(id, adminId, adminNote) {
  const leave = await prisma.leaveRequest.findUnique({
    where: { id },
    include: { user: true },
  });
  if (!leave || leave.status !== LeaveStatus.PENDING) {
    return { error: 'Leave request not found or already processed' };
  }

  const updated = await prisma.leaveRequest.update({
    where: { id },
    data: {
      status: LeaveStatus.APPROVED,
      reviewedById: adminId,
      reviewedAt: new Date(),
      adminNote,
    },
  });

  await markLeaveDays(leave.userId, leave.requestedDate, leave.endDate ?? leave.requestedDate);

  await createNotification({
    recipientId: leave.userId,
    type: 'SUCCESS',
    category: 'leave',
    message: `Leave approved for ${leave.requestedDate.toISOString().slice(0, 10)}`,
    relatedId: id,
  }).catch(() => {});

  await prisma.auditLog.create({
    data: {
      actorId: adminId,
      action: 'LEAVE_APPROVE',
      entityType: 'LeaveRequest',
      entityId: id,
      reason: adminNote,
    },
  });

  return updated;
}

export async function rejectLeave(id, adminId, adminNote) {
  const leave = await prisma.leaveRequest.findUnique({ where: { id } });
  if (!leave || leave.status !== LeaveStatus.PENDING) {
    return { error: 'Leave request not found or already processed' };
  }

  const updated = await prisma.leaveRequest.update({
    where: { id },
    data: {
      status: LeaveStatus.REJECTED,
      reviewedById: adminId,
      reviewedAt: new Date(),
      adminNote,
    },
  });

  await createNotification({
    recipientId: leave.userId,
    type: 'DANGER',
    category: 'leave',
    message: `Leave request rejected${adminNote ? `: ${adminNote}` : ''}`,
    relatedId: id,
  }).catch(() => {});

  await prisma.auditLog.create({
    data: {
      actorId: adminId,
      action: 'LEAVE_REJECT',
      entityType: 'LeaveRequest',
      entityId: id,
      reason: adminNote,
    },
  });

  return updated;
}

/** Cancel an approved leave (e.g. member worked that day anyway). Clears ON_LEAVE marks. */
export async function cancelApprovedLeave(id, adminId, adminNote) {
  const leave = await prisma.leaveRequest.findUnique({
    where: { id },
    include: { user: true },
  });
  if (!leave || leave.status !== LeaveStatus.APPROVED) {
    return { error: 'Approved leave not found' };
  }

  const updated = await prisma.leaveRequest.update({
    where: { id },
    data: {
      status: LeaveStatus.CANCELLED,
      reviewedById: adminId,
      reviewedAt: new Date(),
      adminNote: adminNote || leave.adminNote,
    },
  });

  const cleared = await clearLeaveDaysFromAttendance(
    leave.userId,
    leave.requestedDate,
    leave.endDate ?? leave.requestedDate,
  );

  await createNotification({
    recipientId: leave.userId,
    type: 'INFO',
    category: 'leave',
    message: `Approved leave cancelled — you can clock in on those days if you are working.`,
    relatedId: id,
  }).catch(() => {});

  await prisma.auditLog.create({
    data: {
      actorId: adminId,
      action: 'LEAVE_CANCEL',
      entityType: 'LeaveRequest',
      entityId: id,
      reason: adminNote || `Cancelled approved leave, cleared ${cleared} day(s)`,
    },
  });

  return { ...updated, clearedDays: cleared };
}

export async function getLeaveBalanceOverview() {
  const yearStart = new Date();
  yearStart.setUTCMonth(0, 1);
  yearStart.setUTCHours(0, 0, 0, 0);

  const members = await prisma.user.findMany({
    where: { role: 'MEMBER', active: true },
    select: { id: true, name: true, email: true },
  });

  const approved = await prisma.leaveRequest.findMany({
    where: {
      status: LeaveStatus.APPROVED,
      requestedDate: { gte: yearStart },
    },
  });

  return members.map((m) => {
    const mine = approved.filter((l) => l.userId === m.id);
    const byType = {};
    for (const l of mine) {
      byType[l.type] = (byType[l.type] ?? 0) + 1;
    }
    return { member: m, used: mine.length, byType };
  });
}
