import Bull from 'bull';
import { EmailStatus } from '@prisma/client';
import { config } from '../config/index.js';
import { prisma } from '../db.js';
import { sendWeeklyTeamEmail } from '../services/weeklyEmail.js';
import {
  sendDailyAdminSummary,
  sendIndividualMemberWeekly,
  sendAbsenteeAlert,
  sendFlagAlertEmail,
} from '../services/bulkEmails.js';

/** @typedef {{ logId?: string; type: string; to?: string; userId?: string; alert?: { memberName: string; flagCount: number; ghostHours: number } }} JobPayload */

const handlers = {
  WEEKLY_TEAM: async ({ to }) => sendWeeklyTeamEmail(to),
  DAILY_ADMIN_SUMMARY: async ({ to }) => sendDailyAdminSummary(to),
  INDIVIDUAL_WEEKLY: async ({ to, userId }) => sendIndividualMemberWeekly(to, userId),
  ABSENTEE_ALERT: async ({ to, absentNames }) => sendAbsenteeAlert(to, absentNames),
  FLAG_ALERT: async ({ to, alert }) => sendFlagAlertEmail(to, alert),
};

let queue;

async function finalizeLog(logId, status, error) {
  if (!logId) return;
  await prisma.emailLog.update({
    where: { id: logId },
    data: status === EmailStatus.FAILED ? { status, error } : { status },
  });
}

async function execJob(payload) {
  const fn = handlers[payload.type];
  if (!fn) throw new Error(`Unknown mail type ${payload.type}`);
  await fn(payload);
}

if (config.redisUrl) {
  queue = new Bull('pulsetrack-email', config.redisUrl);
  queue.process(async (job) => {
    /** @type {JobPayload} */
    const data = job.data;
    try {
      await execJob(data);
      await finalizeLog(data.logId, EmailStatus.SENT);
    } catch (e) {
      await finalizeLog(data.logId, EmailStatus.FAILED, String(e?.message ?? e));
      throw e;
    }
  });
}

/**
 * @param {{ type: string; to: string; skipLog?: boolean }} opts
 */
export async function enqueueEmail(opts) {
  const { type, to, skipLog, ...rest } = opts;

  let logId;
  if (!skipLog) {
    const row = await prisma.emailLog.create({
      data: { type, recipient: to, status: EmailStatus.PENDING },
    });
    logId = row.id;
  }

  const payload = { type, to, logId, ...rest };

  if (queue) {
    await queue.add(payload, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
    });
    return;
  }

  try {
    await execJob(payload);
    await finalizeLog(logId, EmailStatus.SENT);
  } catch (e) {
    await finalizeLog(logId, EmailStatus.FAILED, String(e?.message ?? e));
    throw e;
  }
}
