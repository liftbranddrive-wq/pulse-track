import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';

const TYPE_STYLE = {
  INFO: 'border-l-sky-400 bg-sky-50/30',
  WARNING: 'border-l-amber-400 bg-amber-50/30',
  SUCCESS: 'border-l-emerald-400 bg-emerald-50/30',
  DANGER: 'border-l-rose-400 bg-rose-50/30',
};

export default function NotificationsPage() {
  const { user } = useAuth();
  const [data, setData] = useState({ notifications: [], unread: 0 });

  async function load() {
    if (!user?.id) return;
    const d = await api({ endpoint: `/api/notifications/${user.id}?limit=100` });
    setData(d);
  }

  useEffect(() => {
    load().catch(() => {});
  }, [user?.id]);

  async function markAllRead() {
    await api({ endpoint: `/api/notifications/read-all/${user.id}`, method: 'PATCH' });
    await load();
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-ink">Notifications</h1>
          <p className="text-sm text-muted mt-1">{data.unread} unread</p>
        </div>
        {data.unread > 0 ? (
          <button type="button" onClick={markAllRead} className="px-4 py-2 rounded-xl border border-line text-[13px] font-semibold hover:bg-page">
            Mark all read
          </button>
        ) : null}
      </header>

      <div className="space-y-2">
        {!data.notifications?.length ? (
          <div className="rounded-xl2 border border-line bg-surface p-10 text-center text-muted text-sm">
            No notifications yet.
          </div>
        ) : (
          data.notifications.map((n) => (
            <div
              key={n.id}
              className={`rounded-xl border-l-4 border border-line p-4 ${TYPE_STYLE[n.type] || TYPE_STYLE.INFO} ${
                !n.read ? 'ring-1 ring-brand/20' : 'opacity-80'
              }`}
            >
              <div className="flex justify-between gap-2">
                <p className="text-[13px] text-ink font-medium">{n.message}</p>
                {!n.read ? <span className="shrink-0 w-2 h-2 rounded-full bg-brand mt-1.5" /> : null}
              </div>
              <p className="text-[11px] text-muted mt-1">
                {n.category} · {new Date(n.createdAt).toLocaleString()}
              </p>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
