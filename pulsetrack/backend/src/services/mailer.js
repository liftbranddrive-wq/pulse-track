import nodemailer from 'nodemailer';
import { prisma } from '../db.js';

export async function getTransport() {
  const org = await prisma.orgSettings.findUnique({ where: { id: 'singleton' } });
  const port = org?.smtpPort || Number(process.env.SMTP_PORT) || 587;
  const host = org?.smtpHost || process.env.SMTP_HOST;

  if (!host) {
    return {
      send: async () => {
        throw new Error('SMTP not configured');
      },
    };
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth:
      org?.smtpUser && org?.smtpPass
        ? { user: org.smtpUser, pass: org.smtpPass }
        : undefined,
  });
}

export async function sendRawEmail({ to, subject, html, text }) {
  const org = await prisma.orgSettings.findUnique({ where: { id: 'singleton' } });
  const from =
    org?.smtpFrom ||
    process.env.SMTP_FROM ||
    `"PulseTrack" <noreply@${org?.smtpHost ?? 'localhost'}>`;

  if (org?.emailProvider === 'SENDGRID' && org.sendgridApiKey) {
    const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${org.sendgridApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: to }] }],
        from: { email: from.match(/<(.+)>/)?.[1] || from },
        subject,
        content: [{ type: 'text/html', value: html }, text && { type: 'text/plain', value: text }].filter(
          Boolean,
        ),
      }),
    });
    if (!res.ok) {
      const msg = await res.text();
      throw new Error(msg || `SendGrid ${res.status}`);
    }
    return;
  }

  const transport = await getTransport();
  await transport.sendMail({ from, to, subject, html, text });
}
