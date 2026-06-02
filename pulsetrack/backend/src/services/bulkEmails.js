import mjml2html from 'mjml';
import { prisma } from '../db.js';
import { sendRawEmail } from './mailer.js';

function mjDoc(title, accent, bodyBlocks) {
  return `
<mjml>
  <mj-body background-color="#0f172a">
    <mj-section background-color="#0f172a" padding-bottom="12px">
      <mj-column>
        <mj-text font-family="Helvetica, Arial" color="#e2e8f0" font-size="22px">${title}</mj-text>
        <mj-text font-family="Helvetica, Arial" color="#14b8a6" font-size="14px">${accent}</mj-text>
      </mj-column>
    </mj-section>
    <mj-section background-color="#ffffff" border-radius="8px" padding="16px">
      <mj-column>
        ${bodyBlocks}
      </mj-column>
    </mj-section>
  </mj-body>
</mjml>`;
}

function weekRangeLabel() {
  const end = new Date();
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 7);
  return `${start.toISOString().slice(0, 10)} → ${end.toISOString().slice(0, 10)}`;
}

/** Daily admin rollup — toggled via OrgSettings.dailySummaryEnabled */
export async function sendDailyAdminSummary(to) {
  const org = await prisma.orgSettings.findUnique({ where: { id: 'singleton' } });
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);

  const members = await prisma.user.findMany({ where: { role: 'MEMBER', active: true } });
  let present = 0;
  let totalActiveMs = 0;
  const forgotOut = [];
  const openFlags = await prisma.cheatFlag.count({
    where: { dismissed: false, day: { gte: dayStart, lt: dayEnd } },
  });

  for (const m of members) {
    const sessions = await prisma.workSession.findMany({
      where: { userId: m.id, clockIn: { gte: dayStart, lt: dayEnd } },
    });
    if (sessions.length) present += 1;
    for (const s of sessions) {
      totalActiveMs += s.totalActiveMs || 0;
      if (!s.clockOut) forgotOut.push(m.name);
    }
  }

  const blocks = [
    `<mj-text color="#0f172a" font-size="14px"><strong>${org?.companyName ?? 'Team'}</strong> — ${dayStart.toISOString().slice(0, 10)} (UTC)</mj-text>`,
    `<mj-text font-size="13px" color="#334155">Members present today: <strong>${present}</strong> / ${members.length}</mj-text>`,
    `<mj-text font-size="13px" color="#334155">Total active hours (approx): <strong>${(totalActiveMs / 3_600_000).toFixed(2)}h</strong></mj-text>`,
    `<mj-text font-size="13px" color="#334155">Open flags logged today: <strong>${openFlags}</strong></mj-text>`,
    forgotOut.length
      ? `<mj-text font-size="13px" color="#b45309"><strong>Still clocked in:</strong> ${forgotOut.join(', ')}</mj-text>`
      : `<mj-text font-size="13px" color="#14b8a6">No open sessions at send time.</mj-text>`,
  ];

  const { html } = mjml2html(mjDoc('PulseTrack', 'Daily summary', blocks.join('')));
  await sendRawEmail({
    to,
    subject: `PulseTrack daily summary — ${dayStart.toISOString().slice(0, 10)}`,
    html,
  });
}

/** Personal weekly — member-only stats */
export async function sendIndividualMemberWeekly(to, userId) {
  const org = await prisma.orgSettings.findUnique({ where: { id: 'singleton' } });
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || user.role !== 'MEMBER') return;

  const start = new Date();
  start.setUTCDate(start.getUTCDate() - 7);

  const sess = await prisma.workSession.findMany({
    where: { userId, clockIn: { gte: start } },
  });

  let active = 0;
  let ghost = 0;
  let brk = 0;
  let idle = 0;
  let clockedMs = 0;

  for (const s of sess) {
    const out = s.clockOut || new Date();
    clockedMs += out - s.clockIn;
    active += s.totalActiveMs || 0;
    ghost += s.totalGhostMs || 0;
    brk += s.totalBreakMs || 0;
    idle += s.totalIdleMs || 0;
  }

  const score = clockedMs > 0 ? Math.round((active / clockedMs) * 1000) / 10 : 0;

  const blocks = [
    `<mj-text color="#0f172a" font-size="15px">Hi <strong>${user.name}</strong>,</mj-text>`,
    `<mj-text font-size="13px" color="#475569">Here is your week at a glance (${weekRangeLabel()}, UTC).</mj-text>`,
    `<mj-text font-size="13px" color="#334155">Activity score: <strong style="color:${
      score >= 80 ? '#14b8a6' : score >= 50 ? '#ca8a04' : '#dc2626'
    }">${score}%</strong></mj-text>`,
    `<mj-text font-size="13px" color="#334155">Active ≈ <strong>${(active / 3_600_000).toFixed(2)}h</strong> • Breaks ≈ <strong>${(brk / 3_600_000).toFixed(2)}h</strong> • Idle ≈ <strong>${(idle / 3_600_000).toFixed(2)}h</strong> • Ghost ≈ <strong>${(ghost / 3_600_000).toFixed(2)}h</strong></mj-text>`,
    `<mj-text font-size="12px" color="#64748b">Questions about long idle stretches are best handled as a quick human check-in — not a gotcha.</mj-text>`,
  ];

  const { html } = mjml2html(
    mjDoc('Your PulseTrack week', org?.companyName ?? 'Team', blocks.join('')),
  );
  await sendRawEmail({
    to,
    subject: `Your PulseTrack week — ${user.name}`,
    html,
  });
}

/** Members with no session clock-in today (UTC day) */
export async function sendAbsenteeAlert(to, absentNames) {
  const org = await prisma.orgSettings.findUnique({ where: { id: 'singleton' } });
  const blocks = [
    `<mj-text color="#0f172a" font-size="14px"><strong>${absentNames.length}</strong> members have not clocked in yet today (UTC).</mj-text>`,
    `<mj-text font-size="13px" color="#334155">${absentNames.map((n) => `• ${n}`).join('<br/>')}</mj-text>`,
    `<mj-text font-size="12px" color="#64748b">Tune trigger time & timezone in a future update; job currently runs 11:00 UTC on weekdays.</mj-text>`,
  ];
  const { html } = mjml2html(mjDoc('PulseTrack', 'Absentee nudge', blocks.join('')));
  await sendRawEmail({
    to,
    subject: `PulseTrack — ${absentNames.length} not clocked in yet`,
    html,
  });
}

export async function sendFlagAlertEmail(to, { memberName, flagCount, ghostHours }) {
  const blocks = [
    `<mj-text color="#b45309" font-size="15px"><strong>${memberName}</strong> crossed alert thresholds.</mj-text>`,
    `<mj-text font-size="13px" color="#334155">Open flags today (non-dismissed): <strong>${flagCount}</strong></mj-text>`,
    `<mj-text font-size="13px" color="#334155">Ghost hours today: <strong>${ghostHours.toFixed(2)}h</strong></mj-text>`,
    `<mj-text font-size="12px" color="#64748b">Review the Focus Board and member profile in the admin dashboard.</mj-text>`,
  ];
  const { html } = mjml2html(mjDoc('PulseTrack alert', 'Trust but verify — gently', blocks.join('')));
  await sendRawEmail({
    to,
    subject: `PulseTrack alert — ${memberName}`,
    html,
  });
}
