import { prisma } from '../db.js';
import { AttendanceStatus } from '@prisma/client';
import {
  dayStartForTimezone,
  calendarDateKeyInTimezone,
  resolveTimezone,
  formatInstantInTimezone,
} from '../utils/time.js';

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function parseWeekStartKey(weekStartStr, timezone) {
  const tz = timezone || 'Asia/Karachi';
  if (!weekStartStr) {
    return mondayOfWeek(new Date(), tz);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStartStr)) {
    throw new Error('Invalid weekStart — use YYYY-MM-DD (Monday)');
  }
  const [y, mo, d] = weekStartStr.split('-').map(Number);
  const probe = dayStartForTimezone(new Date(Date.UTC(y, mo - 1, d, 12, 0, 0)), tz);
  const key = calendarDateKeyInTimezone(probe, tz);
  const monday = mondayOfWeek(probe, tz);
  if (key !== monday.weekKey) {
    throw new Error('weekStart must be a Monday in org timezone');
  }
  return monday;
}

/** Monday 00:00 org-local for the week containing `d`. */
export function mondayOfWeek(d = new Date(), timezone = 'Asia/Karachi') {
  const tz = timezone;
  const dayStart = dayStartForTimezone(d, tz);
  const key = calendarDateKeyInTimezone(dayStart, tz);
  const weekday = weekdayIndexInTimezone(dayStart, tz);
  const mondayStart = new Date(dayStart.getTime() - weekday * 86400_000);
  const weekKey = calendarDateKeyInTimezone(mondayStart, tz);
  const weekEndExclusive = new Date(mondayStart.getTime() + 7 * 86400_000);
  const sundayStart = new Date(mondayStart.getTime() + 6 * 86400_000);

  return {
    weekKey,
    weekStart: mondayStart,
    weekEndExclusive,
    sundayStart,
    label: formatWeekLabel(mondayStart, sundayStart, tz),
  };
}

function weekdayIndexInTimezone(d, timezone) {
  try {
    const wd = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short' }).format(d);
    const map = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
    return map[wd] ?? 0;
  } catch {
    return (d.getUTCDay() + 6) % 7;
  }
}

function formatWeekLabel(mondayStart, sundayStart, timezone) {
  const mon = formatInstantInTimezone(mondayStart, timezone);
  const sun = formatInstantInTimezone(sundayStart, timezone);
  return `${mon.date} – ${sun.date}`;
}

function statusEmoji(status, isComplete, worked, required) {
  if (status === AttendanceStatus.ON_LEAVE) return '🏖️';
  if (status === AttendanceStatus.ABSENT) return '❌';
  if (status === AttendanceStatus.HALF_DAY) return '⚠️';
  if (isComplete) return '✅';
  if (worked > 0) return '⚠️';
  if (status === AttendanceStatus.LATE) return '🕐';
  return '—';
}

function formatHours(h) {
  if (h == null || Number.isNaN(h)) return '0h';
  const totalMin = Math.round(h * 60);
  const hrs = Math.floor(totalMin / 60);
  const mins = totalMin % 60;
  if (hrs <= 0) return `${mins}m`;
  if (mins <= 0) return `${hrs}h`;
  return `${hrs}h ${mins}m`;
}

function computeTier(summary) {
  const { completionPct, absentDays, lateDays, workDays } = summary;
  if (workDays === 0 && absentDays === 0) return 'no_data';
  if (completionPct >= 95 && absentDays === 0 && lateDays <= 1) return 'excellent';
  if (completionPct >= 80 && absentDays <= 1) return 'good';
  if (completionPct >= 60 || (workDays >= 3 && absentDays <= 2)) return 'needs_improvement';
  return 'critical';
}

const TIER_COPY = {
  excellent: [
    'Outstanding week — you hit your targets consistently. Keep this momentum going!',
    'Excellent discipline on hours and attendance. You are setting a strong example for the team.',
    'Brilliant work this week. Your consistency is exactly what we need — thank you!',
  ],
  good: [
    'Solid week overall. A few small gaps — let us close them and push for full 8-hour days every day.',
    'Good effort this week. Tighten up the short days and you will be in the top tier next week.',
    'You are on the right track. Aim to complete every required hour — you are closer than you think.',
  ],
  needs_improvement: [
    'This week fell short of our hour targets. We need you fully present and completing your full shift every working day.',
    'Hours and attendance need attention. Please treat 7–8 hours as non-negotiable and clock in on time.',
    'Let us turn this around — block your day, minimize distractions, and hit full hours each day this week.',
  ],
  critical: [
    'This week was well below expectations on hours and/or attendance. We need an immediate improvement — full hours every working day, no exceptions.',
    'Serious gap this week. Please discuss your blockers with me and commit to completing every required hour going forward.',
    'Accountability check: missed hours and absences hurt the whole team. We expect full commitment starting tomorrow.',
  ],
  no_data: [
    'No tracked work this week. If you were on leave, ignore this — otherwise please ensure you clock in daily.',
  ],
};

function pickTierMessage(tier, name) {
  const lines = TIER_COPY[tier] || TIER_COPY.needs_improvement;
  const idx = name.length % lines.length;
  return lines[idx];
}

function buildWhatsAppMessage({ user, org, week, summary, days, tier }) {
  const company = org?.companyName || 'Team';
  const reqPerDay = summary.avgRequiredPerDay;
  const personal = pickTierMessage(tier, user.name);

  const dayLines = days.map((d) => {
    if (d.status === AttendanceStatus.ON_LEAVE) {
      return `• ${d.dayName}: On leave 🏖️`;
    }
    if (d.status === AttendanceStatus.ABSENT) {
      return `• ${d.dayName}: Absent ❌ (0h / ${formatHours(d.required)} required)`;
    }
    if (d.status === AttendanceStatus.NOT_CLOCKED && d.worked <= 0) {
      return `• ${d.dayName}: No clock-in —`;
    }
    const icon = statusEmoji(d.status, d.isComplete, d.worked, d.required);
    const short = d.shortfall > 0 ? ` · short ${formatHours(d.shortfall)}` : '';
    const late = d.status === AttendanceStatus.LATE && d.lateMinutes > 0
      ? ` · late ${d.lateMinutes}m`
      : '';
    return `• ${d.dayName}: ${formatHours(d.worked)} / ${formatHours(d.required)} ${icon}${short}${late}`;
  });

  const streakLine = summary.streakDays > 0
    ? `🔥 Streak: ${summary.streakDays} day${summary.streakDays === 1 ? '' : 's'} on-time + complete`
    : '🔥 Streak: start a new one this week!';

  const pointsSection = [
    `⭐ Earned: +${summary.pointsEarned}`,
    summary.pointsDeducted > 0 ? `📉 Lost: -${summary.pointsDeducted}` : null,
    `📊 Net this week: ${summary.pointsNet >= 0 ? '+' : ''}${summary.pointsNet}`,
    `🏆 Total balance: ${summary.totalPoints} pts`,
  ].filter(Boolean).join('\n');

  return [
    `Assalam-o-Alaikum ${user.name}! 👋`,
    '',
    `📋 *Weekly Accountability Review*`,
    `Week: ${week.label}`,
    `_${company}_`,
    '',
    `*Daily hours:*`,
    ...dayLines,
    '',
    `*Week totals:*`,
    `✅ Worked: ${formatHours(summary.totalHoursWorked)}`,
    `📋 Required: ${formatHours(summary.expectedHours)}`,
    summary.hoursShort > 0
      ? `❌ Shortfall: ${formatHours(summary.hoursShort)} (${summary.completionPct}% completion)`
      : `✅ Target met — ${summary.completionPct}% completion`,
    summary.overtimeHours > 0 ? `⏱️ Overtime: +${formatHours(summary.overtimeHours)}` : null,
    '',
    `*Attendance:*`,
    `• Present on-time: ${summary.presentDays}`,
    `• Late: ${summary.lateDays}`,
    `• Absent: ${summary.absentDays}`,
    summary.onLeaveDays > 0 ? `• On leave: ${summary.onLeaveDays}` : null,
    `• Full-hour days: ${summary.completeDays} / ${summary.workDays} work days`,
    '',
    `*Points:*`,
    pointsSection,
    streakLine,
    '',
    `*Feedback:*`,
    personal,
    '',
    `🎯 *Goal this week:* Complete ${formatHours(reqPerDay)} every working day. Clock in on time, stay focused, and finish strong.`,
    '',
    '— Management',
  ]
    .filter((line) => line !== null)
    .join('\n');
}

async function buildMemberReport(user, org, week, timezone) {
  const defaultRequired = (user.expectedDailyHoursMin ?? org?.requiredHoursMin ?? 480) / 60;

  const [records, pointRows] = await Promise.all([
    prisma.attendanceRecord.findMany({
      where: {
        userId: user.id,
        date: { gte: week.weekStart, lt: week.weekEndExclusive },
      },
      orderBy: { date: 'asc' },
    }),
    prisma.pointTransaction.findMany({
      where: {
        userId: user.id,
        createdAt: { gte: week.weekStart, lt: week.weekEndExclusive },
      },
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  const recordByTime = new Map(records.map((r) => [r.date.getTime(), r]));

  const days = [];
  let presentDays = 0;
  let lateDays = 0;
  let absentDays = 0;
  let onLeaveDays = 0;
  let completeDays = 0;
  let workDays = 0;
  let totalHoursWorked = 0;
  let expectedHours = 0;
  let overtimeHours = 0;

  for (let i = 0; i < 7; i += 1) {
    const dayStart = new Date(week.weekStart.getTime() + i * 86400_000);
    const rec = recordByTime.get(dayStart.getTime());
    const dayName = DAY_NAMES[i];
    const dateKey = calendarDateKeyInTimezone(dayStart, timezone);

    const status = rec?.status ?? AttendanceStatus.NOT_CLOCKED;
    const worked = rec?.totalHoursWorked ?? 0;
    const required = rec?.requiredHours ?? defaultRequired;
    const isComplete = rec?.isComplete ?? false;
    const shortfall =
      status === AttendanceStatus.ON_LEAVE
        ? 0
        : Math.max(0, required - worked);

    if (status === AttendanceStatus.PRESENT) presentDays += 1;
    if (status === AttendanceStatus.LATE) lateDays += 1;
    if (status === AttendanceStatus.ABSENT) absentDays += 1;
    if (status === AttendanceStatus.ON_LEAVE) onLeaveDays += 1;

    const countsAsWork =
      status !== AttendanceStatus.ON_LEAVE &&
      status !== AttendanceStatus.NOT_CLOCKED &&
      (worked > 0 || status === AttendanceStatus.ABSENT);

    if (countsAsWork) {
      workDays += 1;
      expectedHours += required;
      totalHoursWorked += worked;
      if (isComplete) completeDays += 1;
    } else if (
      status === AttendanceStatus.PRESENT ||
      status === AttendanceStatus.LATE ||
      status === AttendanceStatus.HALF_DAY
    ) {
      workDays += 1;
      expectedHours += required;
      totalHoursWorked += worked;
      if (isComplete) completeDays += 1;
    }

    overtimeHours += rec?.overtimeHours ?? 0;

    days.push({
      dayName,
      dateKey,
      status,
      worked: +worked.toFixed(2),
      required: +required.toFixed(2),
      shortfall: +shortfall.toFixed(2),
      isComplete,
      lateMinutes: rec?.lateMinutes ?? 0,
      clockInTime: rec?.clockInTime ?? null,
      clockOutTime: rec?.clockOutTime ?? null,
    });
  }

  let pointsEarned = 0;
  let pointsDeducted = 0;
  for (const p of pointRows) {
    if (p.points > 0) pointsEarned += p.points;
    else pointsDeducted += Math.abs(p.points);
  }

  const hoursShort = Math.max(0, expectedHours - totalHoursWorked);
  const completionPct =
    expectedHours > 0 ? Math.round((totalHoursWorked / expectedHours) * 1000) / 10 : 0;

  const summary = {
    presentDays,
    lateDays,
    absentDays,
    onLeaveDays,
    workDays,
    completeDays,
    totalHoursWorked: +totalHoursWorked.toFixed(2),
    expectedHours: +expectedHours.toFixed(2),
    hoursShort: +hoursShort.toFixed(2),
    completionPct,
    overtimeHours: +overtimeHours.toFixed(2),
    pointsEarned,
    pointsDeducted,
    pointsNet: pointsEarned - pointsDeducted,
    totalPoints: user.points ?? 0,
    streakDays: user.streakDays ?? 0,
    avgRequiredPerDay: defaultRequired,
  };

  const tier = computeTier(summary);
  const message = buildWhatsAppMessage({
    user,
    org,
    week,
    summary,
    days,
    tier,
  });

  return {
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      jobTitle: user.jobTitle,
    },
    weekKey: week.weekKey,
    weekLabel: week.label,
    summary,
    days,
    tier,
    message,
    recentPoints: pointRows.slice(0, 8).map((p) => ({
      points: p.points,
      description: p.description,
      type: p.type,
      createdAt: p.createdAt,
    })),
  };
}

export async function listAvailableWeeks(count = 16) {
  const org = await prisma.orgSettings.findUnique({ where: { id: 'singleton' } });
  const tz = resolveTimezone(null, org);
  const weeks = [];
  let cursor = new Date();

  for (let i = 0; i < count; i += 1) {
    const w = mondayOfWeek(cursor, tz);
    if (!weeks.some((x) => x.weekKey === w.weekKey)) {
      weeks.push({
        weekKey: w.weekKey,
        label: w.label,
        isCurrent: i === 0,
      });
    }
    cursor = new Date(w.weekStart.getTime() - 86400_000);
  }

  return { timezone: tz, weeks };
}

export async function generateWeeklyAccountability(weekStartStr) {
  const org = await prisma.orgSettings.findUnique({ where: { id: 'singleton' } });
  const tz = resolveTimezone(null, org);
  const week = weekStartStr
    ? parseWeekStartKey(weekStartStr, tz)
    : previousCompletedWeek(tz);

  const members = await prisma.user.findMany({
    where: { role: 'MEMBER', active: true },
    select: {
      id: true,
      name: true,
      email: true,
      jobTitle: true,
      points: true,
      streakDays: true,
      expectedDailyHoursMin: true,
    },
    orderBy: { name: 'asc' },
  });

  const reports = [];
  for (const m of members) {
    reports.push(await buildMemberReport(m, org, week, tz));
  }

  const team = {
    memberCount: reports.length,
    avgCompletion:
      reports.length > 0
        ? Math.round(
            (reports.reduce((a, r) => a + r.summary.completionPct, 0) / reports.length) * 10,
          ) / 10
        : 0,
    totalHoursWorked: +reports.reduce((a, r) => a + r.summary.totalHoursWorked, 0).toFixed(2),
    totalShortfall: +reports.reduce((a, r) => a + r.summary.hoursShort, 0).toFixed(2),
    excellent: reports.filter((r) => r.tier === 'excellent').length,
    good: reports.filter((r) => r.tier === 'good').length,
    needsImprovement: reports.filter((r) => r.tier === 'needs_improvement').length,
    critical: reports.filter((r) => r.tier === 'critical').length,
  };

  return {
    generatedAt: new Date().toISOString(),
    timezone: tz,
    weekKey: week.weekKey,
    weekLabel: week.label,
    weekStart: week.weekStart.toISOString(),
    team,
    reports,
  };
}

/** Previous Mon–Sun week (the one that just ended before this Monday). */
export function previousCompletedWeek(timezone = 'Asia/Karachi') {
  const now = new Date();
  const thisMonday = mondayOfWeek(now, timezone);
  const prevMondayStart = new Date(thisMonday.weekStart.getTime() - 7 * 86400_000);
  return mondayOfWeek(prevMondayStart, timezone);
}

export async function runScheduledWeeklyAccountability() {
  const org = await prisma.orgSettings.findUnique({ where: { id: 'singleton' } });
  const tz = resolveTimezone(null, org);
  const week = previousCompletedWeek(tz);
  const key = `weekly-accountability-${week.weekKey}`;

  const existing = await prisma.scheduledDedup.findUnique({ where: { key } });
  if (existing) return { skipped: true, weekKey: week.weekKey };

  await prisma.scheduledDedup.create({ data: { key, runAt: new Date() } });

  const result = await generateWeeklyAccountability(week.weekKey);
  console.log(
    `Weekly accountability generated for ${week.weekKey}: ${result.reports.length} members, avg ${result.team.avgCompletion}% completion`,
  );
  return { skipped: false, weekKey: week.weekKey, memberCount: result.reports.length };
}
