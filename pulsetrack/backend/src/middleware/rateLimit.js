import rateLimit from 'express-rate-limit';

/** High-frequency session sync (heartbeat, today summary) — skip global cap. */
function isSessionSyncRequest(req) {
  const p = req.path || '';
  if (req.method === 'POST' && p.endsWith('/heartbeat')) return true;
  if (req.method === 'GET') {
    return (
      p.endsWith('/today') ||
      p.endsWith('/active') ||
      p.endsWith('/clock-status')
    );
  }
  return false;
}

export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 4000,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => isSessionSyncRequest(req),
  message: { error: 'Too many requests — wait a minute and try again.' },
});

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Wait 15 minutes and try again.' },
});
