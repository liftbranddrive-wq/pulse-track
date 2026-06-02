import { prisma } from '../db.js';
import { LeaveStatus, AttendanceStatus } from '@prisma/client';
import { utcDayStart } from '../utils/time.js';
import { createNotification, notifyAdmins } from './notificationService.js';

const MIN_ADVANCE_DAYS = 3;

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

export async function getLeaveHistory(userId) {
  return prisma.leaveRequest.findMany({
    where: { userId },
    orderBy: { submittedAt: 'desc' },
    include: { reviewedBy: { select: { name: true } } },
  });
}

async function markLeaveDays(userId, startDate, endDate) {
  const start = utcDayStart(new Date(startDate));
  const end = endDate ? utcDayStart(new Date(endDate)) : start;
  const org = await prisma.orgSettings.findUnique({ where: { id: 'singleton' } });

  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const day = utcDayStart(d);
    await prisma.attendanceRecord.upsert({
      where: { userId_date: { userId, date: day } },
      create: {
        userId,
        date: day,
        status: AttendanceStatus.ON_LEAVE,
        scheduledClockIn: org?.expectedWindowStartMin ?? 540,
        scheduledClockOut: org?.expectedWindowEndMin ?? 1080,
        requiredHours: (org?.requiredHoursMin ?? 480) / 60,
      },
      update: { status: AttendanceStatus.ON_LEAVE },
    });
  }
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
