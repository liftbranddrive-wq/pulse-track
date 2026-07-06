const base = () =>
  import.meta.env.VITE_API_URL ||
  (import.meta.env.PROD ? 'https://api.liftbrandfulfillment.com' : 'http://localhost:4000');

function getStoredToken() {
  return localStorage.getItem('pulsetrack_admin_access');
}

async function tryRefreshToken() {
  const refresh = localStorage.getItem('pulsetrack_admin_refresh');
  if (!refresh) return false;
  try {
    const res = await fetch(`${base()}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ refreshToken: refresh }),
    });
    const text = await res.text();
    let data;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    if (!res.ok || !data?.accessToken) return false;
    localStorage.setItem('pulsetrack_admin_access', data.accessToken);
    localStorage.setItem('pulsetrack_admin_refresh', data.refreshToken);
    return true;
  } catch {
    return false;
  }
}

/** @typedef {{ endpoint: string, method?: string, body?: any, skipAuth?: boolean, _retried?: boolean }} Opts */
export async function api({ endpoint, method = 'GET', body, skipAuth, _retried = false }) {
  const headers = new Headers({
    Accept: 'application/json',
    'Content-Type': 'application/json',
  });

  const token = skipAuth ? null : getStoredToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const res = await fetch(`${base()}${endpoint}`, {
    method,
    headers,
    credentials: 'include',
    body: body ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401 && !skipAuth && !_retried) {
    const refreshed = await tryRefreshToken();
    if (refreshed) {
      return api({ endpoint, method, body, skipAuth, _retried: true });
    }
    localStorage.removeItem('pulsetrack_admin_access');
    localStorage.removeItem('pulsetrack_admin_refresh');
    window.dispatchEvent(new Event('pulsetrack:auth'));
  }

  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!res.ok) {
    const msg = typeof data === 'object' && data?.error ? data.error : res.statusText;
    throw new Error(msg);
  }
  return data;
}
