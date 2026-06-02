const base = () => import.meta.env.VITE_API_URL || 'http://localhost:4000';

function getStoredToken() {
  return localStorage.getItem('pulsetrack_admin_access');
}

/** @typedef {{ endpoint: string, method?: string, body?: any, skipAuth?: boolean }} Opts */
export async function api({ endpoint, method = 'GET', body, skipAuth }) {
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

  if (res.status === 401) {
    localStorage.removeItem('pulsetrack_admin_access');
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
