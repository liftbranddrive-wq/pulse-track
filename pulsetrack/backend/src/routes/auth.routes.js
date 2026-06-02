import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { hashPassword, verifyPassword } from '../utils/password.js';
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  hashToken,
} from '../utils/jwt.js';
import { authLimiter } from '../middleware/rateLimit.js';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();

router.post('/bootstrap', authLimiter, async (req, res) => {
  const count = await prisma.user.count();
  if (count > 0) return res.status(403).json({ error: 'Already initialized' });

  const Schema = z.object({
    email: z.string().email(),
    password: z.string().min(8),
    name: z.string().min(1),
    companyName: z.string().optional(),
  });
  const body = Schema.parse(req.body);

  const passwordHash = await hashPassword(body.password);
  const user = await prisma.user.create({
    data: {
      email: body.email,
      name: body.name,
      passwordHash,
      role: 'ADMIN',
    },
  });

  if (body.companyName) {
    await prisma.orgSettings.upsert({
      where: { id: 'singleton' },
      create: { id: 'singleton', companyName: body.companyName },
      update: { companyName: body.companyName },
    });
  }

  return issueTokens(res, user);
});

router.post(
  '/register',
  authLimiter,
  authMiddleware('ADMIN'),
  async (req, res) => {
    const Schema = z.object({
      email: z.string().email(),
      password: z.string().min(8),
      name: z.string().min(1),
      role: z.enum(['ADMIN', 'MEMBER']).optional(),
    });
    const body = Schema.parse(req.body);

    const exists = await prisma.user.findUnique({ where: { email: body.email } });
    if (exists) return res.status(409).json({ error: 'Email exists' });

    const passwordHash = await hashPassword(body.password);
    const user = await prisma.user.create({
      data: {
        email: body.email,
        name: body.name,
        passwordHash,
        role: body.role ?? 'MEMBER',
      },
    });

    await prisma.auditLog.create({
      data: {
        actorId: req.user.id,
        action: 'USER_CREATED',
        entityType: 'User',
        entityId: user.id,
        diffJson: { email: user.email },
      },
    });

    return res.json({ id: user.id, email: user.email, role: user.role });
  },
);

router.post('/login/admin', authLimiter, async (req, res) => {
  const Schema = z.object({ email: z.string().email(), password: z.string() });
  const { email, password } = Schema.parse(req.body);

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  if (user.role !== 'ADMIN') {
    return res.status(403).json({ error: 'Admin portal only' });
  }
  return issueTokens(res, user);
});

router.post('/login/member', authLimiter, async (req, res) => {
  const Schema = z.object({ email: z.string().email(), password: z.string() });
  const { email, password } = Schema.parse(req.body);

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  if (!user.active) return res.status(403).json({ error: 'Account disabled' });

  return issueTokens(res, user);
});

router.post('/refresh', authLimiter, async (req, res) => {
  const token = req.body?.refreshToken || req.cookies?.refreshToken;
  if (!token) return res.status(401).json({ error: 'Missing refresh token' });

  let payload;
  try {
    payload = verifyRefreshToken(token);
  } catch {
    return res.status(401).json({ error: 'Invalid refresh token' });
  }

  const tokenHash = hashToken(token);
  const stored = await prisma.refreshToken.findUnique({ where: { tokenHash } });
  if (!stored || stored.expiresAt < new Date()) {
    return res.status(401).json({ error: 'Refresh revoked' });
  }

  const user = await prisma.user.findUnique({ where: { id: payload.sub } });
  if (!user?.active) return res.status(401).json({ error: 'Unauthorized' });

  await prisma.refreshToken.delete({ where: { id: stored.id } });
  return issueTokens(res, user);
});

router.post('/logout', async (req, res) => {
  const token = req.body?.refreshToken || req.cookies?.refreshToken;
  if (token) {
    const tokenHash = hashToken(token);
    await prisma.refreshToken.deleteMany({ where: { tokenHash } });
  }
  res.clearCookie('refreshToken');
  return res.json({ ok: true });
});

router.get('/me', authMiddleware(), async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user.id },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      avatarUrl: true,
      inactivityThresholdMin: true,
      preferredTheme: true,
      active: true,
    },
  });
  return res.json(user);
});

async function issueTokens(res, user) {
  const accessToken = signAccessToken({ sub: user.id, role: user.role });
  const refreshToken = signRefreshToken({ sub: user.id });

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7);

  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(refreshToken),
      expiresAt,
    },
  });

  res.cookie('refreshToken', refreshToken, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });

  return res.json({
    accessToken,
    refreshToken,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    },
  });
}

export default router;
