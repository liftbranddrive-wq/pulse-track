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

const TTL_MS = 20 * 60 * 1000;

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
      body: { email, password },
    });

    localStorage.setItem('pulsetrack_admin_access', data.accessToken);
    localStorage.setItem('pulsetrack_admin_refresh', data.refreshToken);
    const me = await api({ endpoint: '/api/auth/me' });
    setUser(me);
    resetIdle();
    return me;
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
