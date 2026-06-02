import { verifyAccessToken } from '../utils/jwt.js';
import { prisma } from '../db.js';

export function authMiddleware(requiredRole) {
  return async (req, res, next) => {
    try {
      const header = req.headers.authorization;
      const token =
        header?.startsWith('Bearer ') ? header.slice(7) : req.cookies?.accessToken;

      if (!token) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const decoded = verifyAccessToken(token);
      const user = await prisma.user.findUnique({ where: { id: decoded.sub } });

      if (!user?.active) {
        return res.status(401).json({ error: 'Account inactive' });
      }

      req.user = { id: user.id, role: user.role, email: user.email, name: user.name };

      if (requiredRole === 'ADMIN' && user.role !== 'ADMIN') {
        return res.status(403).json({ error: 'Admin only' });
      }

      next();
    } catch (e) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
  };
}
