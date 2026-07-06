import { prisma } from '../db.js';
import { AttendanceStatus, AnomalyType } from '@prisma/client';
import {
  utcDayStart,
  utcDayEnd,
  minutesFromMidnightInTimezone,
  dayStartForTimezone,
  resolveTimezone,
  formatInstantInTimezone,
  formatWallClockMinutes,
  dayEndForTimezone,
  calendarDateKeyInTimezone,
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
import { aggregateSessionTotals, runPostClockOutHooks, computeLiveActiveMs } from './sessionService.js';
import {
  getFullClockWindow,
  isWithinFullWindow,
  needsEarlyNote,
  computeEarlyMinutes,
  expectedClockOutTime,
  formatMinutesAsTime,
  isNightShiftWindow,
} from './earlyStartService.js';
import { isUserOnLeaveForDay } from './leaveService.js';

/** All work sessions for one attendance day (supports clock-out then clock-in again same day). */
function dayBoundsForRecord(record) {
  const dayStart = record.date;
  const dayEnd = new Date(dayStart.getTime() + 86400000);
  return { dayStart, dayEnd };
}

async function sessionsForAttendanceDay(record, userId) {
  const { dayStart, dayEnd } = dayBoundsForRecord(record);
  return prisma.workSession.findMany({
    where: {
      userId,
      clockIn: { gte: dayStart, lt: dayEnd },
    },
  });
}

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
    timezone: resolveTimezone(user, org),
  };
}

export function getClockInWindow(schedule, dayStart = utcDayStart()) {
  const earliest = schedule.clockInMin - schedule.windowBeforeMin;
  const latest = schedule.clockInMin + schedule.windowAfterMin;
  return { earliest, latest, dayStart };
}

export function isWithinClockInWindow(now, schedule) {
  const mins = minutesFromMidnightInTimezone(now, schedule.timezone ?? 'UTC');
  const { earliest, latest } = getClockInWindow(schedule);
  return mins >= earliest && mins <= latest;
}

export function computeLateMinutes(now, schedule) {
  const mins = minutesFromMidnightInTimezone(now, schedule.timezone ?? 'UTC');
  const scheduled = schedule.clockInMin;
  if (mins <= scheduled) return 0;
  return mins - scheduled;
}

export async function getOrCreateTodayRecord(userId) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  const schedule = await getScheduleForUser(user);
  const dayStart = dayStartForTimezone(new Date(), schedule.timezone);

  let record = await prisma.attendanceRecord.findUnique({
    where: { userId_date: { userId, date: dayStart } },
  });

  if (!record) {
    const onLeave = await isUserOnLeaveForDay(userId, dayStart, schedule.timezone);

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
  } else if (record.status === AttendanceStatus.ON_LEAVE && !record.clockInTime) {
    const onLeave = await isUserOnLeaveForDay(userId, dayStart, schedule.timezone);
    if (!onLeave) {
      record = await prisma.attendanceRecord.update({
        where: { id: record.id },
        data: { status: AttendanceStatus.NOT_CLOCKED },
      });
    }
  }

  return { record, schedule, user };
}

export async function getClockInStatus(userId) {
  const { record, schedule, user } = await getOrCreateTodayRecord(userId);
  const now = new Date();
  const win = getFullClockWindow(schedule);
  const withinWindow = isWithinFullWindow(now, schedule);
  const minsNow = minutesFromMidnightInTimezone(now, schedule.timezone ?? 'UTC');
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
    const fresh = await prisma.workSession.findUnique({
      where: { id: active.id },
      include: { segments: { orderBy: { startedAt: 'asc' } } },
    });
    hoursWorked = computeLiveActiveMs(fresh) / 3_600_000;
  }

  const hoursRemaining = Math.max(0, requiredHours - hoursWorked);
  const isComplete = hoursWorked >= requiredHours;
  const tz = schedule.timezone ?? 'Asia/Karachi';
  const nowLocal = formatInstantInTimezone(now, tz);
  const scheduledStartLabel = formatWallClockMinutes(schedule.clockInMin, tz);

  let comparisonLabel = 'Within clock-in window';
  if (isLate) comparisonLabel = `${lateMinutes} min late (now ${nowLocal.timeShort} · start ${scheduledStartLabel})`;
  else if (minutesEarly > 0) comparisonLabel = `${minutesEarly} min before start (now ${nowLocal.timeShort} · start ${scheduledStartLabel})`;
  else if (minsNow < schedule.clockInMin) comparisonLabel = `Before start — opens ${formatWallClockMinutes(win.normalEarliest, tz)}`;

  return {
    record,
    schedule,
    nowLocal: {
      ...nowLocal,
      minutesFromMidnight: minsNow,
      comparisonLabel,
    },
    window: {
      earliest: win.absoluteEarliest,
      normalEarliest: win.normalEarliest,
      latest: win.latest,
      scheduled: schedule.clockInMin,
      timezone: tz,
      earliestFormatted: formatWallClockMinutes(win.absoluteEarliest, tz),
      normalEarliestFormatted: formatWallClockMinutes(win.normalEarliest, tz),
      scheduledFormatted: scheduledStartLabel,
      latestFormatted: formatWallClockMinutes(win.latest, tz),
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
    expectedClockOutFormatted: expectedOut.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: schedule.timezone ?? 'UTC',
      timeZoneName: 'short',
    }),
    windowClosed: !withinWindow && !active,
    earlyStart: {
      noteRequired: earlyNoteRequired && !isLate,
      minutesEarly: isLate ? 0 : minutesEarly,
      isEarlyWindow: !isLate && (minutesEarly > 0 || record.isEarlyStart),
      savedNote: record.earlyNote,
    },
    workDate: calendarDateKeyInTimezone(now, tz),
    workDateLabel: nowLocal.date,
    dayClosed: !!(record.clockOutTime && !active),
    autoClockOut: record.autoClockOut ?? false,
    overtimeHours: record.overtimeHours ?? 0,
    workShiftLabel: record.workShiftLabel ?? null,
    isResume: !!(record.clockInTime && !active),
    nightShift: (() => {
      const isNight = isNightShiftWindow(now, schedule);
      const tzz = schedule.timezone ?? 'Asia/Karachi';
      const prevAnchor = dayStartForTimezone(new Date(Date.now() - 86_400_000), tzz);
      return {
        active: isNight && !active,
        needsChoice: isNight && !active && record.status !== AttendanceStatus.ON_LEAVE,
        previousDayLabel: formatInstantInTimezone(prevAnchor, tzz).date,
        todayLabel: nowLocal.date,
      };
    })(),
  };
}

/** Get or create an attendance record for a specific day anchor (used for night-shift continue). */
async function getOrCreateRecordForDay(userId, dayAnchor, schedule) {
  let record = await prisma.attendanceRecord.findUnique({
    where: { userId_date: { userId, date: dayAnchor } },
  });
  if (!record) {
    record = await prisma.attendanceRecord.create({
      data: {
        userId,
        date: dayAnchor,
        scheduledClockIn: schedule.clockInMin,
        scheduledClockOut: schedule.clockOutMin,
        requiredHours: schedule.requiredHoursMin / 60,
        status: AttendanceStatus.NOT_CLOCKED,
      },
    });
  }
  return record;
}

export async function validateClockIn(userId, { lateNote, earlyNote, deviceFingerprint, ipAddress, dayChoice }) {
  const { record: todayRecord, schedule, user } = await getOrCreateTodayRecord(userId);
  const tz = schedule.timezone ?? 'Asia/Karachi';
  const dayStart = dayStartForTimezone(new Date(), tz);

  if (todayRecord.status === AttendanceStatus.ON_LEAVE) {
    const onLeave = await isUserOnLeaveForDay(userId, dayStart, tz);
    if (onLeave) {
      return { error: 'You are on approved leave today' };
    }
    todayRecord.status = AttendanceStatus.NOT_CLOCKED;
    await prisma.attendanceRecord.update({
      where: { id: todayRecord.id },
      data: { status: AttendanceStatus.NOT_CLOCKED },
    });
  }

  const existing = await prisma.workSession.findFirst({
    where: { userId, clockOut: null },
  });
  if (existing) return { error: 'Already clocked in', session: existing };

  const now = new Date();
  const win = getFullClockWindow(schedule);
  const nightShift = isNightShiftWindow(now, schedule);
  // After midnight, if an older client did not send a choice, default to the NEW day
  // (same as the old early-start behavior) so nothing ever errors.
  const effectiveChoice = nightShift ? (dayChoice || 'TODAY') : null;

  // Resolve which attendance record this session attaches to.
  let record = todayRecord;
  let workShiftLabel = null;
  if (nightShift && effectiveChoice === 'PREVIOUS_DAY') {
    const prevAnchor = dayStartForTimezone(new Date(Date.now() - 86_400_000), tz);
    record = await getOrCreateRecordForDay(userId, prevAnchor, schedule);
    workShiftLabel = 'PREV_DAY_CONTINUE';
  } else if (nightShift) {
    workShiftLabel = 'NIGHT_NEW_DAY';
  }

  // Resume = they already clocked in earlier today and are clocking back in
  // (e.g. clocked out by mistake). No window/late/early note should block this.
  const isResume = !!record.clockInTime;

  if (!nightShift && !isResume && !isWithinFullWindow(now, schedule)) {
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

  // Night-shift clock-ins always require an explanatory note (unless resuming).
  const isEarly = !nightShift && !isResume && needsEarlyNote(now, schedule);
  const earlyMinutes = computeEarlyMinutes(now, schedule);

  if (nightShift && !isResume) {
    const note = (earlyNote || lateNote || '').trim();
    if (note.length < 20) {
      return {
        error: 'Night shift note required (minimum 20 characters)',
        needsEarlyNote: true,
        needsNightNote: true,
        minutesEarly: earlyMinutes,
      };
    }
  } else if (isEarly) {
    if (!earlyNote || earlyNote.trim().length < 20) {
      return {
        error: 'Early start note required (minimum 20 characters)',
        needsEarlyNote: true,
        minutesEarly: earlyMinutes,
      };
    }
  }

  const minsNow = minutesFromMidnightInTimezone(now, tz);
  const lateMinutes = minsNow > schedule.clockInMin ? minsNow - schedule.clockInMin : 0;
  const isLate = !isEarly && !nightShift && !isResume && lateMinutes > schedule.graceMinutes;

  if (isLate) {
    if (!lateNote || lateNote.trim().length < 20) {
      return {
        error: 'Late note required (minimum 20 characters)',
        isLate: true,
        lateMinutes,
      };
    }
  }

  const noteForNight = nightShift ? (earlyNote || lateNote || '').trim() : null;

  return {
    ok: true,
    record,
    schedule,
    user,
    now,
    isNightShift: nightShift,
    isContinuePreviousDay: nightShift && dayChoice === 'PREVIOUS_DAY',
    lateMinutes: isLate ? lateMinutes : 0,
    isLate,
    lateNote: isLate ? lateNote.trim() : null,
    earlyNote: isEarly ? earlyNote.trim() : noteForNight,
    earlyMinutes,
    isEarlyStart: isEarly,
    ipAddress,
    deviceFingerprint,
    effectiveRequiredMin: schedule.requiredHoursMin,
    workShiftLabel,
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
    effectiveRequiredMin,
    workShiftLabel,
    isContinuePreviousDay,
  } = ctx;

  const requiredMin = effectiveRequiredMin ?? schedule.requiredHoursMin;
  const requiredHours = record.requiredHours ?? requiredMin / 60;

  const dayStart = utcDayStart(now);
  await logIpOnClockIn(ctx.user, ipAddress, dayStart);

  const graceUsed = !isEarlyStart && lateMinutes > 0 && lateMinutes <= schedule.graceMinutes;
  const reopening = !!record.clockInTime; // continuing a day that already had a session
  const status = reopening
    ? record.status
    : isLate
      ? AttendanceStatus.LATE
      : AttendanceStatus.PRESENT;

  const expectedOut = expectedClockOutTime(now, requiredMin);

  const updatedRecord = await prisma.attendanceRecord.update({
    where: { id: record.id },
    data: {
      clockInTime: record.clockInTime ?? now,
      clockOutTime: null,
      status,
      lateMinutes: reopening ? record.lateMinutes : isLate ? lateMinutes : graceUsed ? lateMinutes : 0,
      lateNote: lateNote ?? record.lateNote ?? null,
      earlyNote: earlyNote ?? record.earlyNote ?? null,
      earlyMinutes: reopening ? record.earlyMinutes : earlyMinutes ?? 0,
      ipAddress,
      deviceFingerprint,
      graceUsed: reopening ? record.graceUsed : graceUsed,
      isEarlyStart: reopening ? record.isEarlyStart : !!isEarlyStart,
      requiredHours,
      workShiftLabel: workShiftLabel ?? record.workShiftLabel ?? null,
    },
  });

  let session = null;
  if (reopening) {
    const priorClosed = await prisma.workSession.findFirst({
      where: {
        userId,
        attendanceRecordId: updatedRecord.id,
        clockOut: { not: null },
      },
      orderBy: { clockOut: 'desc' },
    });
    if (priorClosed) {
      await prisma.workSession.update({
        where: { id: priorClosed.id },
        data: {
          clockOut: null,
          clockOutIp: null,
          status: 'WORKING',
          lastHeartbeat: now,
          ipAddress,
          deviceFingerprint,
        },
      });
      const openSeg = await prisma.sessionSegment.findFirst({
        where: { sessionId: priorClosed.id, endedAt: null },
        orderBy: { startedAt: 'desc' },
      });
      if (openSeg) {
        await prisma.sessionSegment.update({
          where: { id: openSeg.id },
          data: { endedAt: now },
        });
      }
      await prisma.sessionSegment.create({
        data: { sessionId: priorClosed.id, type: 'ACTIVE', startedAt: now },
      });
      session = await prisma.workSession.findUnique({ where: { id: priorClosed.id } });
    }
  }

  if (!session) {
    // One attendance row can only link to one session at a time — unlink old closed sessions.
    await prisma.workSession.updateMany({
      where: { attendanceRecordId: updatedRecord.id },
      data: { attendanceRecordId: null },
    });
    session = await prisma.workSession.create({
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
  }

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
    requiredHours,
  };
}

export async function processClockOut(userId, sessionId, { ipAddress, autoEndOfDay = false, clockOutAt } = {}) {
  const session = await prisma.workSession.findFirst({
    where: { id: sessionId, userId, clockOut: null },
    include: { attendanceRecord: true },
  });
  if (!session) return { error: 'Session not found' };

  const now = clockOutAt ? new Date(clockOutAt) : new Date();
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
  const record = session.attendanceRecord;
  // Sum active time across ALL sessions tied to this day's record (handles multi-session / night continue).
  let totalHours = (updatedSession?.totalActiveMs ?? 0) / 3_600_000;
  if (record?.id) {
    const daySessions = await sessionsForAttendanceDay(record, userId);
    const sumMs = daySessions.reduce((acc, s) => acc + (s.totalActiveMs ?? 0), 0);
    totalHours = sumMs / 3_600_000;
  }
  const requiredHours = record?.requiredHours ?? 8;
  const isComplete = totalHours >= requiredHours;
  const overtimeHours = Math.max(0, totalHours - requiredHours);
  const expectedClockOutBy = record?.clockInTime
    ? new Date(record.clockInTime.getTime() + requiredHours * 3_600_000)
    : null;
  const shortBy = isComplete ? 0 : requiredHours - totalHours;
  const finalStatus = resolveFinalAttendanceStatus(record, totalHours, requiredHours);

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
        status: finalStatus,
        autoClockOut: autoEndOfDay ? true : undefined,
      },
    });

    if (isComplete) {
      await awardFullHours(userId, record.id);
      if (overtimeHours >= 1) await awardOvertime(userId, overtimeHours, record.id);
    }

    const onTime = !record.lateMinutes || record.graceUsed;
    await updateStreak(userId, onTime && isComplete);

    const user = await prisma.user.findUnique({ where: { id: userId } });
    const eodTag = autoEndOfDay ? ' — day closed automatically at 11:59 PM' : '';
    const otTag = overtimeHours > 0 ? ` (+${overtimeHours.toFixed(1)}h overtime)` : '';
    await notifyAdmins({
      type: isComplete ? 'SUCCESS' : 'WARNING',
      category: 'clock_out',
      message: isComplete
        ? `${user.name} completed ${requiredHours}h today ✓${otTag}${eodTag}`
        : finalStatus === AttendanceStatus.HALF_DAY
          ? `${user.name} — half day (${totalHours.toFixed(1)}h of ${requiredHours}h)${eodTag}`
          : `${user.name} — short by ${shortBy.toFixed(1)}h${eodTag}`,
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
      autoEndOfDay,
    },
  };
}

/** 11:59 PM org timezone — auto clock-out open sessions for that calendar day. */
export async function runEndOfDayAutoClockOut() {
  const org = await prisma.orgSettings.findUnique({ where: { id: 'singleton' } });
  const tz = resolveTimezone(null, org);
  const now = new Date();
  const dateKey = calendarDateKeyInTimezone(now, tz);
  const dedupKey = `eod-clockout-${dateKey}-${tz}`;
  const existing = await prisma.scheduledDedup.findUnique({ where: { key: dedupKey } });
  if (existing) return { skipped: true, dateKey };

  const todayStart = dayStartForTimezone(now, tz);
  const closeAt = dayEndForTimezone(now, tz);

  const openSessions = await prisma.workSession.findMany({
    where: { clockOut: null },
    include: {
      attendanceRecord: true,
      user: { select: { id: true, name: true } },
    },
  });

  let closed = 0;
  for (const s of openSessions) {
    const rec = s.attendanceRecord;
    let sessionCloseAt = closeAt;

    if (rec) {
      const recDayEnd = dayEndForTimezone(rec.date, tz);
      if (rec.date.getTime() < todayStart.getTime()) {
        sessionCloseAt = recDayEnd;
      } else if (rec.date.getTime() === todayStart.getTime()) {
        sessionCloseAt = closeAt;
      } else {
        continue;
      }
    }

    const result = await processClockOut(s.userId, s.id, {
      autoEndOfDay: true,
      clockOutAt: sessionCloseAt,
    }).catch((e) => {
      console.error('EOD clock-out failed', s.id, e);
      return null;
    });
    if (result && !result.error) closed += 1;
  }

  await prisma.scheduledDedup.create({ data: { key: dedupKey, runAt: new Date() } });
  return { closed, dateKey, timezone: tz };
}

export async function recordHeartbeat(userId, sessionId) {
  const session = await prisma.workSession.findFirst({
    where: { id: sessionId, userId, clockOut: null },
  });
  if (!session) return { error: 'No active session' };

  const now = new Date();
  await prisma.workSession.update({
    where: { id: sessionId },
    data: { lastHeartbeat: now },
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

/** Full day = required met. Half day = at least half of required (e.g. 4h when 8h required). */
export function resolveFinalAttendanceStatus(record, totalHours, requiredHours) {
  if (!record) return AttendanceStatus.PRESENT;
  const wasLate = record.status === AttendanceStatus.LATE || (record.lateMinutes ?? 0) > 0;
  if (totalHours >= requiredHours) {
    return wasLate ? AttendanceStatus.LATE : AttendanceStatus.PRESENT;
  }
  const halfDayMinimum = requiredHours / 2;
  if (totalHours >= halfDayMinimum) {
    return AttendanceStatus.HALF_DAY;
  }
  return wasLate ? AttendanceStatus.LATE : AttendanceStatus.PRESENT;
}

/** Human-readable pause/break/resume events for admin attendance view. */
export function buildMemberDayTimeline(sessions, tz = 'Asia/Karachi') {
  const events = [];
  for (const session of sessions || []) {
    for (const br of session.breaks || []) {
      events.push({
        kind: 'BREAK',
        label: br.type === 'LUNCH' ? 'Lunch break' : br.type === 'PERSONAL' ? 'Personal break' : 'Short break',
        startedAt: br.startedAt,
        endedAt: br.endedAt,
        startFormatted: formatInstantInTimezone(br.startedAt, tz).timeShort,
        endFormatted: br.endedAt
          ? formatInstantInTimezone(br.endedAt, tz).timeShort
          : 'still on break',
      });
    }
    for (const seg of session.segments || []) {
      if (seg.type === 'MANUAL_PAUSE') {
        events.push({
          kind: 'PAUSE',
          label: 'Paused (manual)',
          startedAt: seg.startedAt,
          endedAt: seg.endedAt,
          startFormatted: formatInstantInTimezone(seg.startedAt, tz).timeShort,
          endFormatted: seg.endedAt
            ? formatInstantInTimezone(seg.endedAt, tz).timeShort
            : 'still paused',
        });
      }
      if (seg.type === 'GHOST' && seg.endedAt) {
        events.push({
          kind: 'GHOST',
          label: 'Ghost (no activity)',
          startedAt: seg.startedAt,
          endedAt: seg.endedAt,
          startFormatted: formatInstantInTimezone(seg.startedAt, tz).timeShort,
          endFormatted: formatInstantInTimezone(seg.endedAt, tz).timeShort,
        });
      }
    }
  }
  events.sort((a, b) => new Date(a.startedAt) - new Date(b.startedAt));
  return events;
}

export async function getTeamAttendanceReport({ day } = {}) {
  const org = await prisma.orgSettings.findUnique({ where: { id: 'singleton' } });
  const tz = resolveTimezone(null, org);
  const dayStart = day
    ? dayStartForTimezone(new Date(day), tz)
    : dayStartForTimezone(new Date(), tz);

  const members = await prisma.user.findMany({
    where: { role: 'MEMBER', active: true },
    select: { id: true, name: true, email: true, jobTitle: true, points: true, streakDays: true },
  });
  const memberIds = members.map((m) => m.id);

  const records = await prisma.attendanceRecord.findMany({
    where: { date: dayStart, userId: { in: memberIds } },
  });
  const map = new Map(records.map((r) => [r.userId, r]));

  const activeSessions = await prisma.workSession.findMany({
    where: { clockOut: null, userId: { in: memberIds } },
    include: { attendanceRecord: true },
  });
  for (const s of activeSessions) {
    await aggregateSessionTotals(s.id).catch(() => {});

    const rec = s.attendanceRecord;
    // Only show this live session under the day its attendance record belongs to.
    if (!rec?.clockInTime || rec.date.getTime() !== dayStart.getTime()) continue;

    const recSessions = await sessionsForAttendanceDay(rec, s.userId);
    const liveHours =
      recSessions.reduce((acc, x) => acc + (x.totalActiveMs ?? 0), 0) / 3_600_000;

    const required = rec.requiredHours ?? 8;
    const previewStatus = resolveFinalAttendanceStatus(rec, liveHours, required);
    map.set(s.userId, {
      ...rec,
      totalHoursWorked: liveHours,
      isLive: true,
      status: previewStatus,
      isComplete: liveHours >= required,
    });
  }

  const dayEnd = new Date(dayStart.getTime() + 86400_000);
  const recordIdsForDay = records.map((r) => r.id);
  const daySessions = await prisma.workSession.findMany({
    where: {
      userId: { in: memberIds },
      OR: [
        { clockIn: { gte: dayStart, lt: dayEnd } },
        { attendanceRecordId: { in: recordIdsForDay } },
      ],
    },
    include: {
      breaks: { orderBy: { startedAt: 'asc' } },
      segments: { orderBy: { startedAt: 'asc' } },
    },
    orderBy: { clockIn: 'asc' },
  });
  const sessionsByUser = new Map();
  for (const s of daySessions) {
    const list = sessionsByUser.get(s.userId) || [];
    list.push(s);
    sessionsByUser.set(s.userId, list);
  }

  return members.map((m) => ({
    member: m,
    record: map.get(m.id) ?? null,
    timeline: buildMemberDayTimeline(sessionsByUser.get(m.id) || [], tz),
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
