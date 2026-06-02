import { Router } from 'express';
import { prisma } from '../db.js';
import { authMiddleware } from '../middleware/auth.js';
import { getFlaggedMembersReport } from '../services/flaggedReportService.js';

const router = Router();
router.use(authMiddleware('ADMIN'));

router.get('/csv/daily-team', async (req, res) => {
  const day = req.query.day ? new Date(String(req.query.day)) : new Date();
  day.setUTCHours(0, 0, 0, 0);
  const end = new Date(day);
  end.setUTCDate(end.getUTCDate() + 1);

  const sessions = await prisma.workSession.findMany({
    where: { clockIn: { gte: day, lt: end } },
    include: {
      user: { select: { name: true, email: true } },
      segments: true,
      breaks: true,
    },
  });

  const header = [
    'name',
    'email',
    'clock_in',
    'clock_out',
    'active_ms',
    'idle_ms',
    'ghost_ms',
    'break_ms',
    'activity_pct',
    'session_count',
  ];

  const lines = [header.join(',')];
  const byMember = {};

  for (const s of sessions) {
    if (!byMember[s.userId]) {
      byMember[s.userId] = {
        name: s.user.name,
        email: s.user.email,
        sessions: [],
      };
    }
    byMember[s.userId].sessions.push(s);
  }

  for (const [, v] of Object.entries(byMember)) {
    const count = v.sessions.length;
    let active = 0;
    let idle = 0;
    let ghost = 0;
    let brk = 0;
    let firstIn = null;
    let lastOut = null;

    for (const s of v.sessions) {
      active += s.totalActiveMs;
      idle += s.totalIdleMs;
      ghost += s.totalGhostMs;
      brk += s.totalBreakMs;
      firstIn =
        firstIn && firstIn < s.clockIn ? firstIn : s.clockIn;

      const out = s.clockOut || null;
      if (out && (!lastOut || out > lastOut)) lastOut = out;
    }

    const clocked =
      firstIn && lastOut ? lastOut.getTime() - firstIn.getTime() : active + idle + ghost + brk;
    const pct = clocked ? Math.round(((active || 0) / clocked) * 1000) / 10 : 0;

    lines.push(
      [
        JSON.stringify(v.name),
        JSON.stringify(v.email),
        firstIn?.toISOString(),
        lastOut?.toISOString(),
        active,
        idle,
        ghost,
        brk,
        pct,
        count,
      ].join(','),
    );
  }

  res.header('Content-Type', 'text/csv');
  res.attachment(`pulsetrack-team-${day.toISOString().slice(0, 10)}.csv`);
  return res.send(lines.join('\n'));
});

router.get('/xlsx/week', async (req, res) => {
  const XLSX = await import('xlsx');
  const start = req.query.weekStart
    ? new Date(String(req.query.weekStart))
    : new Date();
  start.setUTCHours(0, 0, 0, 0);

  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 7);

  const sessions = await prisma.workSession.findMany({
    where: { clockIn: { gte: start, lt: end } },
    include: { user: { select: { name: true } } },
  });

  const rows = sessions.map((s) => ({
    member: s.user.name,
    clock_in: s.clockIn.toISOString(),
    clock_out: s.clockOut?.toISOString() ?? '',
    active_hours: +(s.totalActiveMs / 3_600_000).toFixed(2),
    ghost_hours: +(s.totalGhostMs / 3_600_000).toFixed(2),
    activity_pct: (s.activityRatio ?? 0).toFixed(1),
  }));

  const sheet = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, 'Week');

  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.header(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  );
  res.attachment('pulsetrack-week.xlsx');
  return res.send(Buffer.from(buffer));
});

router.get('/pdf/daily-summary', async (req, res) => {
  const PDFDocument = (await import('pdfkit')).default;

  const day = req.query.day ? new Date(String(req.query.day)) : new Date();
  day.setUTCHours(0, 0, 0, 0);

  const sessions = await prisma.workSession.findMany({
    where: {
      clockIn: {
        gte: day,
        lt: new Date(day.getTime() + 86400000),
      },
    },
    include: { user: { select: { name: true, email: true } } },
    orderBy: { clockIn: 'asc' },
  });

  const doc = new PDFDocument({ margin: 40 });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="pulsetrack-daily-${day.toISOString().slice(0, 10)}.pdf"`,
  );

  doc.pipe(res);

  doc.fontSize(18).fillColor('#0f172a').text('PulseTrack Daily Report', { underline: true });
  doc.moveDown();
  doc.fontSize(11).fillColor('#334155').text(`Date: ${day.toISOString().slice(0, 10)} (UTC)`);
  doc.moveDown();

  for (const s of sessions) {
    doc
      .fontSize(11)
      .fillColor('#0f172a')
      .text(
        `${s.user.name} — active ${(s.totalActiveMs / 3_600_000).toFixed(2)}h | ghost ${(s.totalGhostMs / 3_600_000).toFixed(2)}h | score ${(s.activityRatio ?? 0).toFixed(1)}%`,
      );
    doc.fontSize(9).fillColor('#64748b').text(` ${s.user.email}`, { indent: 10 });
    doc.moveDown(0.3);
  }

  doc.end();
});

router.get('/pdf/flagged-members', async (_req, res) => {
  const PDFDocument = (await import('pdfkit')).default;
  const report = await getFlaggedMembersReport();

  const doc = new PDFDocument({ margin: 40 });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="pulsetrack-flagged-${report.month}.pdf"`,
  );

  doc.pipe(res);

  doc.fontSize(18).fillColor('#0f172a').text('PulseTrack — Flagged Members Report', { underline: true });
  doc.moveDown(0.5);
  doc.fontSize(11).fillColor('#334155').text(`Month: ${report.month} (UTC)`);
  doc.fontSize(10).fillColor('#64748b').text(`Generated: ${new Date(report.generatedAt).toLocaleString()}`);
  doc.moveDown();

  doc.fontSize(10).fillColor('#475569').text(
    'Criteria: 3+ late days, 2+ unexcused absences, or below 90% required hours.',
  );
  doc.moveDown();

  if (!report.flagged.length) {
    doc.fontSize(12).fillColor('#059669').text('No members flagged this month — great team performance!');
  } else {
    doc.fontSize(11).fillColor('#b45309').text(`${report.flagged.length} member(s) flagged for review:`);
    doc.moveDown(0.5);

    for (const row of report.flagged) {
      doc.fontSize(12).fillColor('#0f172a').text(row.member.name, { continued: false });
      doc.fontSize(9).fillColor('#64748b').text(row.member.email);
      doc.fontSize(10).fillColor('#334155').text(
        `Late: ${row.lateDays} · Absent: ${row.absentDays} · Hours: ${row.totalWorked}/${row.expectedTotal}h (${row.completionPct}%)`,
      );
      doc.fontSize(9).fillColor('#be123c').text(`Flags: ${row.reasons.join(' · ')}`);
      doc.moveDown(0.8);
    }
  }

  doc.end();
});

router.get('/flagged-members/preview', async (_req, res) => {
  const report = await getFlaggedMembersReport();
  return res.json(report);
});

export default router;
