import { prisma } from '../db.js';
import { AttendanceStatus, AnomalyType } from '@prisma/client';
import {
  utcDayStart,
  utcDayEnd,
  minutesFromMidnightUTC,
  msToHours,
  hoursToMs,
} from '../utils/time.js';
import {
  validateDevice,
  logIpOnClockIn,
  checkIpChange,
  checkSessionAnomalies,
  checkGraceAbuse,
  logAnomaly,
} from './anomalyDetector.js';
import {
  awardOnTimeClockIn,
  awardFullHours,
  awardOvertime,
  deductAbsent,
  updateStreak,
} from './pointsEngine.js';
import { createNotification, notifyAdmins } from './notificationService.js';
import { aggregateSessionTotals, runPostClockOutHooks } from './sessionService.js';
import {
  getFullClockWindow,
  isWithinFullWindow,
  needsEarlyNote,
  computeEarlyMinutes,
  expectedClockOutTime,
  formatMinutesAsTime,
} from './earlyStartService.js';

export async function getScheduleForUser(user) {
  const org = await prisma.orgSettings.findUnique({ where: { id: 'singleton' } });
  return {
    clockInMin: user.expectedStartMin ?? org?.expectedWindowStartMin ?? 540,
    clockOutMin: user.expectedEndMin ?? org?.expectedWindowEndMin ?? 1080,
    requiredHoursMin: user.expectedDailyHoursMin ?? org?.requiredHoursMin ?? 480,
    graceMinutes: org?.graceMinutes ?? 5,
    windowBeforeMin: org?.clockInWindowBeforeMin ?? 30,
    windowAfterMin: org?.clockInWindowAfterMin ?? 120,
    maxEarlyStartMin: org?.maxEarlyStartMin ?? 240,
    timezone: user.timezone ?? org?.timezone ?? 'UTC',
  };
}

export function getClockInWindow(schedule, dayStart = utcDayStart()) {
  const earliest = schedule.clockInMin - schedule.windowBeforeMin;
  const latest = schedule.clockInMin + schedule.windowAfterMin;
  return { earliest, latest, dayStart };
}

export function isWithinClockInWindow(now, schedule) {
  const mins = minutesFromMidnightUTC(now);
  const { earliest, latest } = getClockInWindow(schedule);
  return mins >= earliest && mins <= latest;
}

export function computeLateMinutes(now, schedule) {
  const mins = minutesFromMidnightUTC(now);
  const scheduled = schedule.clockInMin;
  if (mins <= scheduled) return 0;
  return mins - scheduled;
}

export async function getOrCreateTodayRecord(userId) {
  const dayStart = utcDayStart();
  const user = await prisma.user.findUnique({ where: { id: userId } });
  const schedule = await getScheduleForUser(user);

  let record = await prisma.attendanceRecord.findUnique({
    where: { userId_date: { userId, date: dayStart } },
  });

  if (!record) {
    const onLeave = await prisma.leaveRequest.findFirst({
      where: {
        userId,
        status: 'APPROVED',
        requestedDate: { lte: dayStart },
        OR: [{ endDate: null }, { endDate: { gte: dayStart } }],
      },
    });

    record = await prisma.attendanceRecord.create({
      data: {
        userId,
        date: dayStart,
        scheduledClockIn: schedule.clockInMin,
        scheduledClockOut: schedule.clockOutMin,
        requiredHours: schedule.requiredHoursMin / 60,
        status: onLeave ? AttendanceStatus.ON_LEAVE : AttendanceStatus.NOT_CLOCKED,
      },
    });
  }

  return { record, schedule, user };
}

export async function getClockInStatus(userId) {
  const { record, schedule, user } = await getOrCreateTodayRecord(userId);
  const now = new Date();
  const win = getFullClockWindow(schedule);
  const withinWindow = isWithinFullWindow(now, schedule);
  const minsNow = minutesFromMidnightUTC(now);
  const isLate = minsNow > schedule.clockInMin + schedule.graceMinutes;
  const lateMinutes = isLate ? minsNow - schedule.clockInMin : 0;
  const earlyNoteRequired = needsEarlyNote(now, schedule);
  const minutesEarly = computeEarlyMinutes(now, schedule);

  const active = await prisma.workSession.findFirst({
    where: { userId, clockOut: null },
    include: { attendanceRecord: true },
  });

  const requiredHours = schedule.requiredHoursMin / 60;
  const expectedOut = expectedClockOutTime(
    active?.clockIn ?? now,
    schedule.requiredHoursMin,
  );

  let hoursWorked = record.totalHoursWorked ?? 0;
  if (active) {
    await aggregateSessionTotals(active.id).catch(() => {});
    const fresh = await prisma.workSession.findUnique({ where: { id: active.id } });
    hoursWorked = (fresh?.totalActiveMs ?? 0) / 3_600_000;
    if (fresh?.totalActiveMs) {
      const openSeg = await prisma.sessionSegment.findFirst({
        where: { sessionId: active.id, endedAt: null, type: 'ACTIVE' },
      });
      if (openSeg) {
        hoursWorked += (Date.now() - openSeg.startedAt.getTime()) / 3_600_000;
      }
    }
  }

  const hoursRemaining = Math.max(0, requiredHours - hoursWorked);
  const isComplete = hoursWorked >= requiredHours;

  return {
    record,
    schedule,
    window: {
      earliest: win.absoluteEarliest,
      normalEarliest: win.normalEarliest,
      latest: win.latest,
      earliestFormatted: formatMinutesAsTime(win.absoluteEarliest),
      normalEarliestFormatted: formatMinutesAsTime(win.normalEarliest),
      scheduledFormatted: formatMinutesAsTime(schedule.clockInMin),
      latestFormatted: formatMinutesAsTime(win.latest),
    },
    withinWindow,
    lateMinutes,
    isLate,
    graceMinutes: schedule.graceMinutes,
    hasActiveSession: !!active,
    requiredHours,
    requiredHoursMin: schedule.requiredHoursMin,
    hoursWorked: +hoursWorked.toFixed(2),
    hoursRemaining: +hoursRemaining.toFixed(2),
    isComplete,
    expectedClockOutBy: expectedOut.toISOString(),
    expectedClockOutFormatted: expectedOut.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) + ' UTC',
    windowClosed: !withinWindow && !active,
    earlyStart: {
      noteRequired: earlyNoteRequired,
      minutesEarly,
      isEarlyWindow: minutesEarly > 0 || record.isEarlyStart,
      savedNote: record.earlyNote,
    },
  };
}

export async function validateClockIn(userId, { lateNote, earlyNote, deviceFingerprint, ipAddress }) {
  const { record, schedule, user } = await getOrCreateTodayRecord(userId);

  if (record.status === AttendanceStatus.ON_LEAVE) {
    return { error: 'You are on approved leave today' };
  }

  const existing = await prisma.workSession.findFirst({
    where: { userId, clockOut: null },
  });
  if (existing) return { error: 'Already clocked in', session: existing };

  const now = new Date();
  const win = getFullClockWindow(schedule);

  if (!isWithinFullWindow(now, schedule)) {
    await logAnomaly(userId, AnomalyType.CLOCK_WINDOW_VIOLATION, {
      attemptedAt: now.toISOString(),
      window: win,
    }, { ipAddress, deviceFingerprint });
    return {
      error: 'Clock-in window closed',
      scheduledClockIn: schedule.clockInMin,
      effectiveEarliest: win.absoluteEarliest,
      windowAfter: schedule.windowAfterMin,
    };
  }

  const deviceCheck = await validateDevice(user, deviceFingerprint);
  if (!deviceCheck.ok) return deviceCheck;

  const isEarly = needsEarlyNote(now, schedule);
  const earlyMinutes = computeEarlyMinutes(now, schedule);

  if (isEarly) {
    if (!earlyNote || earlyNote.trim().length < 20) {
      return {
        error: 'Early start note required (minimum 20 characters)',
        needsEarlyNote: true,
        minutesEarly: earlyMinutes,
      };
    }
  }

  const minsNow = minutesFromMidnightUTC(now);
  const lateMinutes = minsNow > schedule.clockInMin ? minsNow - schedule.clockInMin : 0;
  const isLate = !isEarly && lateMinutes > schedule.graceMinutes;

  if (isLate) {
    if (!lateNote || lateNote.trim().length < 20) {
      return {
        error: 'Late note required (minimum 20 characters)',
        isLate: true,
        lateMinutes,
      };
    }
  }

  return {
    ok: true,
    record,
    schedule,
    user,
    now,
    lateMinutes: isLate ? lateMinutes : 0,
    isLate,
    lateNote: isLate ? lateNote.trim() : null,
    earlyNote: isEarly ? earlyNote.trim() : null,
    earlyMinutes,
    isEarlyStart: isEarly,
    ipAddress,
    deviceFingerprint,
  };
}

export async function processClockIn(userId, ctx) {
  const {
    record,
    schedule,
    now,
    lateMinutes,
    isLate,
    lateNote,
    earlyNote,
    earlyMinutes,
    ipAddress,
    deviceFingerprint,
    isEarlyStart,
  } = ctx;

  const dayStart = utcDayStart(now);
  await logIpOnClockIn(ctx.user, ipAddress, dayStart);

  const graceUsed = !isEarlyStart && lateMinutes > 0 && lateMinutes <= schedule.graceMinutes;
  const status = isLate ? AttendanceStatus.LATE : AttendanceStatus.PRESENT;

  const expectedOut = expectedClockOutTime(now, schedule.requiredHoursMin);

  const updatedRecord = await prisma.attendanceRecord.update({
    where: { id: record.id },
    data: {
      clockInTime: now,
      status,
      lateMinutes: isLate ? lateMinutes : graceUsed ? lateMinutes : 0,
      lateNote: lateNote ?? null,
      earlyNote: earlyNote ?? null,
      earlyMinutes: earlyMinutes ?? 0,
      ipAddress,
      deviceFingerprint,
      graceUsed,
      isEarlyStart: !!isEarlyStart,
    },
  });

  const session = await prisma.workSession.create({
    data: {
      userId,
      clockIn: now,
      status: 'WORKING',
      ipAddress,
      deviceFingerprint,
      lastHeartbeat: now,
      lateNote: lateNote ?? earlyNote ?? null,
      attendanceRecordId: updatedRecord.id,
    },
  });

  await prisma.sessionSegment.create({
    data: { sessionId: session.id, type: 'ACTIVE', startedAt: now },
  });

  if (graceUsed) {
    await checkGraceAbuse(userId, lateMinutes, schedule.graceMinutes);
  }

  if (!isLate) {
    await awardOnTimeClockIn(userId, updatedRecord.id);
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  const earlyLabel = isEarlyStart ? ` (${earlyMinutes}m early: "${(earlyNote || '').slice(0, 60)}")` : '';
  await notifyAdmins({
    type: isLate ? 'WARNING' : 'INFO',
    category: 'clock_in',
    message: isLate
      ? `${user.name} clocked in late (${lateMinutes} min)${lateNote ? `: "${lateNote.slice(0, 80)}"` : ''}`
      : isEarlyStart
        ? `${user.name} started early${earlyLabel} — must complete ${record.requiredHours}h (by ${expectedOut.toISOString().slice(11, 16)} UTC)`
        : `${user.name} clocked in on time`,
    relatedId: session.id,
  }).catch(() => {});

  return {
    session,
    record: updatedRecord,
    isLate,
    lateMinutes,
    isEarlyStart,
    expectedClockOutBy: expectedOut.toISOString(),
    requiredHours: record.requiredHours,
  };
}

export async function processClockOut(userId, sessionId, { ipAddress } = {}) {
  const session = await prisma.workSession.findFirst({
    where: { id: sessionId, userId, clockOut: null },
    include: { attendanceRecord: true },
  });
  if (!session) return { error: 'Session not found' };

  const now = new Date();
  await checkIpChange(session, ipAddress);

  const openSeg = await prisma.sessionSegment.findFirst({
    where: { sessionId, endedAt: null },
    orderBy: { startedAt: 'desc' },
  });
  if (openSeg) {
    await prisma.sessionSegment.update({
      where: { id: openSeg.id },
      data: { endedAt: now },
    });
  }

  await prisma.workSession.update({
    where: { id: sessionId },
    data: { clockOut: now, clockOutIp: ipAddress, status: 'CLOCKED_OUT' },
  });

  await aggregateSessionTotals(sessionId);
  await runPostClockOutHooks(userId, sessionId, now);

  const updatedSession = await prisma.workSession.findUnique({ where: { id: sessionId } });
  const totalHours = (updatedSession?.totalActiveMs ?? 0) / 3_600_000;
  const record = session.attendanceRecord;
  const requiredHours = record?.requiredHours ?? 8;
  const isComplete = totalHours >= requiredHours;
  const overtimeHours = Math.max(0, totalHours - requiredHours);
  const expectedClockOutBy = record?.clockInTime
    ? new Date(record.clockInTime.getTime() + requiredHours * 3_600_000)
    : null;
  const shortBy = isComplete ? 0 : requiredHours - totalHours;

  await prisma.workSession.update({
    where: { id: sessionId },
    data: {
      activityRatio: updatedSession?.activityRatio ?? 0,
    },
  });

  if (record) {
    await prisma.attendanceRecord.update({
      where: { id: record.id },
      data: {
        clockOutTime: now,
        totalHoursWorked: totalHours,
        isComplete,
        overtimeHours,
        clockOutIp: ipAddress,
        status: record.status === AttendanceStatus.LATE ? AttendanceStatus.LATE : AttendanceStatus.PRESENT,
      },
    });

    if (isComplete) {
      await awardFullHours(userId, record.id);
      if (overtimeHours >= 1) await awardOvertime(userId, overtimeHours, record.id);
    }

    const onTime = !record.lateMinutes || record.graceUsed;
    await updateStreak(userId, onTime && isComplete);

    const user = await prisma.user.findUnique({ where: { id: userId } });
    await notifyAdmins({
      type: isComplete ? 'SUCCESS' : 'WARNING',
      category: 'clock_out',
      message: isComplete
        ? `${user.name} completed ${requiredHours}h today ✓${record?.isEarlyStart ? ' (early start)' : ''}`
        : `${user.name} clocked out — short by ${shortBy.toFixed(1)}h${record?.isEarlyStart ? ' (started early)' : ''}`,
      relatedId: record.id,
    }).catch(() => {});
  }

  await checkSessionAnomalies(userId, { ...session, clockOut: now }, totalHours);

  const fresh = await prisma.workSession.findUnique({
    where: { id: sessionId },
    include: { segments: true },
  });

  return {
    session: fresh,
    summary: {
      totalHoursWorked: totalHours,
      requiredHours,
      isComplete,
      overtimeHours,
      shortBy,
      expectedClockOutBy: expectedClockOutBy?.toISOString() ?? null,
      isEarlyStart: record?.isEarlyStart ?? false,
      earlyMinutes: record?.earlyMinutes ?? 0,
    },
  };
}

export async function recordHeartbeat(userId, sessionId) {
  const session = await prisma.workSession.findFirst({
    where: { id: sessionId, userId, clockOut: null },
  });
  if (!session) return { error: 'No active session' };

  const now = new Date();
  await prisma.workSession.update({
    where: { id: sessionId },
    data: { lastHeartbeat: now, sessionPaused: false },
  });

  const record = session.attendanceRecordId
    ? await prisma.attendanceRecord.findUnique({ where: { id: session.attendanceRecordId } })
    : null;

  if (record) {
    const log = Array.isArray(record.heartbeatLog) ? [...record.heartbeatLog] : [];
    log.push(now.toISOString());
    if (log.length > 200) log.splice(0, log.length - 200);
    await prisma.attendanceRecord.update({
      where: { id: record.id },
      data: { heartbeatLog: log },
    });
  }

  return { ok: true, lastHeartbeat: now };
}

export async function markAbsentForDay(userId, dayStart = utcDayStart()) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user?.active) return null;

  const onLeave = await prisma.leaveRequest.findFirst({
    where: {
      userId,
      status: 'APPROVED',
      requestedDate: { lte: dayStart },
      OR: [{ endDate: null }, { endDate: { gte: dayStart } }],
    },
  });
  if (onLeave) return null;

  const session = await prisma.workSession.findFirst({
    where: {
      userId,
      clockIn: { gte: dayStart, lt: utcDayEnd(dayStart) },
    },
  });
  if (session) return null;

  const schedule = await getScheduleForUser(user);
  const record = await prisma.attendanceRecord.upsert({
    where: { userId_date: { userId, date: dayStart } },
    create: {
      userId,
      date: dayStart,
      status: AttendanceStatus.ABSENT,
      scheduledClockIn: schedule.clockInMin,
      scheduledClockOut: schedule.clockOutMin,
      requiredHours: schedule.requiredHoursMin / 60,
    },
    update: { status: AttendanceStatus.ABSENT },
  });

  await deductAbsent(userId, record.id);
  await notifyAdmins({
    type: 'DANGER',
    category: 'absent',
    message: `${user.name} did not clock in today`,
    relatedId: record.id,
  }).catch(() => {});

  return record;
}

export async function getAttendanceHistory(userId, { from, to, limit = 60 } = {}) {
  return prisma.attendanceRecord.findMany({
    where: {
      userId,
      ...(from || to
        ? {
            date: {
              ...(from ? { gte: new Date(from) } : {}),
              ...(to ? { lt: new Date(to) } : {}),
            },
          }
        : {}),
    },
    orderBy: { date: 'desc' },
    take: limit,
  });
}

export async function getTeamAttendanceReport({ day = utcDayStart() } = {}) {
  const dayStart = utcDayStart(new Date(day));
  const members = await prisma.user.findMany({
    where: { role: 'MEMBER', active: true },
    select: { id: true, name: true, email: true, jobTitle: true, points: true, streakDays: true },
  });

  const records = await prisma.attendanceRecord.findMany({
    where: { date: dayStart, userId: { in: members.map((m) => m.id) } },
  });
  const map = new Map(records.map((r) => [r.userId, r]));

  return members.map((m) => ({
    member: m,
    record: map.get(m.id) ?? null,
  }));
}

export async function correctAttendance(recordId, adminId, fields, reason) {
  const record = await prisma.attendanceRecord.findUnique({ where: { id: recordId } });
  if (!record) return { error: 'Record not found' };

  const diff = {};
  const data = {};
  for (const [k, v] of Object.entries(fields)) {
    if (record[k] !== undefined && record[k] !== v) {
      diff[k] = { from: record[k], to: v };
      data[k] = v;
    }
  }

  const updated = await prisma.attendanceRecord.update({
    where: { id: recordId },
    data,
  });

  await prisma.auditLog.create({
    data: {
      actorId: adminId,
      action: 'ATTENDANCE_CORRECT',
      entityType: 'AttendanceRecord',
      entityId: recordId,
      reason,
      diffJson: diff,
    },
  });

  return updated;
}

export function formatScheduleAnnouncement(schedule, org) {
  const fmt = (mins) => {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 || 12;
    return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
  };
  return (
    `📢 Team Schedule Update — ${org?.companyName ?? 'Our Team'}\n\n` +
    `Clock-in: ${fmt(schedule.clockInMin)} (grace: ${schedule.graceMinutes} min)\n` +
    `Clock-out target: ${fmt(schedule.clockOutMin)}\n` +
    `Required hours: ${(schedule.requiredHoursMin / 60).toFixed(1)}h/day\n\n` +
    `Please clock in via the PulseTrack extension. Late arrivals require a note.`
  );
}
