import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import authRoutes from './routes/auth.routes.js';
import sessionRoutes from './routes/session.routes.js';
import adminRoutes from './routes/admin.routes.js';
import exportRoutes from './routes/export.routes.js';
import attendanceRoutes from './routes/attendance.routes.js';
import leaveRoutes from './routes/leave.routes.js';
import pointsRoutes from './routes/points.routes.js';
import notificationsRoutes from './routes/notifications.routes.js';
import earlyStartRoutes from './routes/earlyStart.routes.js';
import { apiLimiter } from './middleware/rateLimit.js';
import { config } from './config/index.js';

export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cookieParser());
  app.use(express.json({ limit: '1mb' }));
  app.use(apiLimiter);

  const allowed = [
    config.adminPanelOrigin,
    ...(config.extensionOrigin ? [config.extensionOrigin] : []),
    ...config.allowedOrigins,
  ].filter(Boolean);

  app.use(
    cors({
      origin: (origin, cb) => {
        if (!origin) return cb(null, true);
        if (allowed.length === 0 || allowed.some((o) => origin.startsWith(o) || origin === o)) {
          return cb(null, true);
        }
        if (origin.startsWith('chrome-extension://') || origin.startsWith('moz-extension://')) {
          return cb(null, true);
        }
        return cb(new Error(`CORS blocked: ${origin}`), false);
      },
      credentials: true,
    }),
  );

  app.get('/health', (_req, res) => res.json({ ok: true, service: 'pulsetrack-api' }));

  app.use('/api/auth', authRoutes);
  app.use('/api/sessions', sessionRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/admin/export', exportRoutes);
  app.use('/api/attendance', attendanceRoutes);
  app.use('/api/leave', leaveRoutes);
  app.use('/api/points', pointsRoutes);
  app.use('/api/notifications', notificationsRoutes);
  app.use('/api/early-start', earlyStartRoutes);

  app.use((_err, _req, res, _next) => {
    console.error(_err?.message ?? _err);
    return res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}
