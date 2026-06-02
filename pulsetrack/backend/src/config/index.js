/**
 * Environment configuration loaded once at startup.
 */
import 'dotenv/config';

const parseOrigins = (raw) =>
  raw
    ? raw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

export const config = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 4000),
  databaseUrl: process.env.DATABASE_URL,
  jwtAccessSecret: process.env.JWT_ACCESS_SECRET || 'dev-access-secret-change-me',
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET || 'dev-refresh-secret-change-me',
  jwtAccessExpires: process.env.JWT_ACCESS_EXPIRES || '15m',
  jwtRefreshExpires: process.env.JWT_REFRESH_EXPIRES || '7d',
  adminPanelOrigin: process.env.ADMIN_PANEL_ORIGIN || 'http://localhost:5173',
  extensionOrigin: process.env.EXTENSION_ORIGIN || '',
  allowedOrigins: parseOrigins(process.env.ALLOWED_ORIGINS || ''),
  redisUrl: process.env.REDIS_URL || '',
};
