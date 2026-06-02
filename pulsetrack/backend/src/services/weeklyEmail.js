import mjml2html from 'mjml';
import { prisma } from '../db.js';
import { sendRawEmail } from './mailer.js';

function wrapTeamWeekly(orgName, rowsHtml, statsHtml) {
  return `
<mjml>
  <mj-body background-color="#0f172a">
    <mj-section background-color="#0f172a" padding-bottom="16px">
      <mj-column>
        <mj-text font-family="Helvetica, Arial" color="#e2e8f0" font-size="26px">${orgName}</mj-text>
        <mj-text font-family="Helvetica, Arial" color="#14b8a6">PulseTrack Weekly Summary</mj-text>
      </mj-column>
    </mj-section>
    <mj-section background-color="#ffffff" border-radius="8px" padding="16px">
      <mj-column>
        ${statsHtml}
        <mj-divider/>
        ${rowsHtml}
      </mj-column>
    </mj-section>
  </mj-body>
</mjml>`;
}

export async function sendWeeklyTeamEmail(to) {
  const org = await prisma.orgSettings.findUnique({ where: { id: 'singleton' } });

  const start = new Date();
  start.setUTCDate(start.getUTCDate() - 7);

  const members = await prisma.user.findMany({ where: { role: 'MEMBER', active: true } });
  const rowsHtml = [];

  for (const m of members) {
    const sess = await prisma.workSession.findMany({
      where: { userId: m.id, clockIn: { gte: start } },
    });

    let active = 0;
    let ghost = 0;
    let clockedMs = 0;

    for (const s of sess) {
      const out = s.clockOut || new Date();
      clockedMs += out - s.clockIn;
      active += s.totalActiveMs || 0;
      ghost += s.totalGhostMs || 0;
    }

    const score = clockedMs > 0 ? Math.round((active / clockedMs) * 1000) / 10 : 0;
    rowsHtml.push(
      `<mj-text font-family="Helvetica, Arial" font-size="12px">
        <strong>${m.name}</strong> — Score <span style="color:${
          score >= 80 ? '#14b8a6' : score >= 50 ? '#eab308' : '#ef4444'
        }">${score}%</span> — Ghost ${(ghost / 3_600_000).toFixed(2)}h
      </mj-text>`,
    );
  }

  const mj = wrapTeamWeekly(
    org?.companyName ?? 'Team',
    rowsHtml.join(''),
    `<mj-text font-size="14px" color="#0f172a">Previous 7 days (UTC)</mj-text>`,
  );

  const { html } = mjml2html(mj);
  await sendRawEmail({
    to,
    subject: `PulseTrack Weekly Report — ${org?.companyName ?? 'Team'}`,
    html,
  });
}
