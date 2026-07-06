import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { api } from '../lib/api';

const TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days idle (refresh token lifetime)

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const idleTimer = useRef(null);

  const logout = useCallback(() => {
    localStorage.removeItem('pulsetrack_admin_access');
    localStorage.removeItem('pulsetrack_admin_refresh');
    setUser(null);
  }, []);

  const resetIdle = useCallback(() => {
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = window.setTimeout(() => {
      logout();
    }, TTL_MS);
  }, [logout]);

  useEffect(() => {
    const onActivity = () => resetIdle();
    window.addEventListener('mousemove', onActivity);
    window.addEventListener('keydown', onActivity);
    return () => {
      window.removeEventListener('mousemove', onActivity);
      window.removeEventListener('keydown', onActivity);
      clearTimeout(idleTimer.current ?? 0);
    };
  }, [resetIdle]);

  useEffect(() => {
    const boot = async () => {
      const token = localStorage.getItem('pulsetrack_admin_access');
      if (!token) {
        setLoading(false);
        return;
      }
      try {
        const me = await api({ endpoint: '/api/auth/me' });
        setUser(me);
        resetIdle();
      } catch {
        logout();
      } finally {
        setLoading(false);
      }
    };
    boot();
    const h = () => boot();
    window.addEventListener('pulsetrack:auth', h);
    return () => window.removeEventListener('pulsetrack:auth', h);
  }, [logout, resetIdle]);

  const login = useCallback(async (email, password) => {
    const data = await api({
      endpoint: '/api/auth/login/admin',
      method: 'POST',
      skipAuth: true,
      body: { email: email.trim(), password },
    });

    if (data.user?.role && data.user.role !== 'ADMIN') {
      throw new Error(
        `This account is ${data.user.role}, not ADMIN. In Members, click "Make admin" for this email.`,
      );
    }

    localStorage.setItem('pulsetrack_admin_access', data.accessToken);
    localStorage.setItem('pulsetrack_admin_refresh', data.refreshToken);
    localStorage.setItem('pulsetrack_admin_email', email.trim().toLowerCase());

    if (data.user?.role === 'ADMIN') {
      setUser(data.user);
      resetIdle();
    }

    try {
      const me = await api({ endpoint: '/api/auth/me' });
      setUser(me);
      resetIdle();
      return me;
    } catch (meErr) {
      if (data.user?.role === 'ADMIN') {
        return data.user;
      }
      throw new Error(
        meErr.message?.includes('inactive') || meErr.message?.includes('disabled')
          ? 'Account is disabled — another admin must click Enable in Members.'
          : `Login reached server but profile check failed: ${meErr.message}. Check API / CORS on server .env.`,
      );
    }
  }, [resetIdle]);

  const ctx = useMemo(
    () => ({ user, loading, login, logout, resetIdle }),
    [user, loading, login, logout, resetIdle],
  );

  return <AuthContext.Provider value={ctx}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const v = useContext(AuthContext);
  if (!v) throw new Error('useAuth missing provider');
  return v;
}
