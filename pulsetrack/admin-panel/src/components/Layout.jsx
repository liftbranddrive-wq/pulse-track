import React, { useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  Users,
  Clock3,
  Ghost,
  FlagTriangleRight,
  BarChart3,
  FileSpreadsheet,
  Mail,
  Settings,
  Plug,
  ChevronRight,
  LogOut,
  Activity,
  ClipboardList,
  CalendarCheck,
  CalendarOff,
  Timer,
  Trophy,
  Shield,
  Bell,
  Sun,
  Moon,
  Sunrise,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { api } from '../lib/api';
import { initialsFrom } from '../utils/format';

function NavBadge({ children, tone = 'rose' }) {
  if (children === undefined || children === null) return null;
  const t =
    tone === 'amber'
      ? 'bg-amber-500 text-white'
      : 'bg-rose-500 text-white shadow-sm shadow-rose-500/25';
  return (
    <span
      className={`ml-auto text-[10px] font-bold min-w-[1.25rem] h-5 px-1.5 rounded-full inline-flex items-center justify-center ${t}`}
    >
      {children}
    </span>
  );
}

function NavItem({ to, icon: Icon, end, badge, badgeTone, label }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        [
          'group flex items-center gap-2.5 px-3 py-2 rounded-xl text-[13px] font-medium transition',
          isActive
            ? 'bg-brand/15 text-teal-800 dark:text-teal-300 ring-1 ring-brand/30'
            : 'text-muted hover:bg-black/[0.04] hover:text-ink dark:hover:text-slate-100',
        ].join(' ')
      }
    >
      <Icon
        strokeWidth={1.75}
        className="w-[18px] h-[18px] shrink-0 text-brand opacity-90"
      />
      <span className="flex-1 text-left">{label}</span>
      {badge !== undefined ? <NavBadge tone={badgeTone}>{badge}</NavBadge> : null}
    </NavLink>
  );
}

function SectionLabel({ children }) {
  return (
    <div className="px-3 pt-4 pb-2 text-[10px] font-semibold tracking-widest uppercase text-muted/80">
      {children}
    </div>
  );
}

export default function Layout() {
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();

  const [badges, setBadges] = useState({
    ghostAlerts: 0,
    openFlags: 0,
    pendingLeaves: 0,
    openAnomalies: 0,
    pendingEarlyStarts: 0,
    todayEarlyStarts: 0,
  });

  useEffect(() => {
    api({ endpoint: '/api/admin/nav-badges' })
      .then(setBadges)
      .catch(() => setBadges({ ghostAlerts: 0, openFlags: 0, pendingLeaves: 0, openAnomalies: 0, pendingEarlyStarts: 0, todayEarlyStarts: 0 }));
    const iv = setInterval(() => {
      api({ endpoint: '/api/admin/nav-badges' })
        .then(setBadges)
        .catch(() => {});
    }, 120_000);
    return () => clearInterval(iv);
  }, []);

  return (
    <div className="min-h-screen flex bg-page">
      <aside className="w-[248px] shrink-0 border-r border-line bg-surface flex flex-col shadow-soft min-h-screen">
        <div className="p-5 flex items-center gap-3 border-b border-line/80">
          <div className="w-10 h-10 rounded-xl bg-brand flex items-center justify-center shadow-sm">
            <Activity className="w-5 h-5 text-white" strokeWidth={2.2} />
          </div>
          <div>
            <div className="font-bold text-ink leading-tight tracking-tight">PulseTrack</div>
            <div className="text-[11px] text-muted font-medium">Admin console</div>
          </div>
        </div>

        <nav className="flex-1 px-3 py-2 overflow-y-auto">
          <SectionLabel>Overview</SectionLabel>
          <div className="space-y-0.5">
            <NavItem to="/" end icon={LayoutDashboard} label="Dashboard" />
            <NavItem to="/members" icon={Users} label="Team Members" />
            <NavItem to="/time-logs" icon={Clock3} label="Time Logs" />
          </div>

          <SectionLabel>Attendance</SectionLabel>
          <div className="space-y-0.5">
            <NavItem to="/attendance" icon={CalendarCheck} label="Attendance" />
            <NavItem
              to="/leave"
              icon={CalendarOff}
              label="Leave"
              badge={badges.pendingLeaves || undefined}
              badgeTone="amber"
            />
            <NavItem
              to="/early-start"
              icon={Sunrise}
              label="Early start"
              badgeTone="amber"
            />
            <NavItem to="/schedule" icon={Timer} label="Schedule" />
            <NavItem to="/points" icon={Trophy} label="Points" />
            <NavItem
              to="/security"
              icon={Shield}
              label="Security log"
              badge={badges.openAnomalies || undefined}
            />
            <NavItem to="/notifications" icon={Bell} label="Notifications" />
          </div>

          <SectionLabel>Intelligence</SectionLabel>
          <div className="space-y-0.5">
            <NavItem
              to="/ghost-time"
              icon={Ghost}
              label="Ghost Time"
              badge={badges.ghostAlerts || undefined}
              badgeTone="amber"
            />
            <NavItem
              to="/flags"
              icon={FlagTriangleRight}
              label="Flags"
              badge={badges.openFlags || undefined}
            />
            <NavItem to="/focus" icon={BarChart3} label="Focus Board" />
          </div>

          <SectionLabel>Reports</SectionLabel>
          <div className="space-y-0.5">
            <NavItem to="/reports" icon={FileSpreadsheet} label="Reports" />
            <NavItem to="/email-logs" icon={Mail} label="Email Logs" />
            <NavItem to="/audit" icon={ClipboardList} label="Audit log" />
          </div>

          <SectionLabel>Settings</SectionLabel>
          <div className="space-y-0.5">
            <NavItem to="/settings" icon={Settings} label="Settings" />
            <NavItem to="/integrations/ghl" icon={Plug} label="GoHighLevel" />
          </div>
        </nav>

        <div className="p-3 border-t border-line">
          <button
            type="button"
            onClick={() => navigate('/settings')}
            className="w-full rounded-xl px-3 py-2.5 flex items-center gap-3 hover:bg-black/[0.04] transition text-left"
          >
            <div className="w-10 h-10 rounded-full flex items-center justify-center text-[11px] font-bold ring-2 ring-brand/30 bg-brand text-white">
              {initialsFrom(user?.name, user?.email)}
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-[13px] text-ink truncate">{user?.name}</div>
              <div className="text-[11px] text-muted truncate">Administrator</div>
            </div>
            <ChevronRight className="w-4 h-4 text-muted shrink-0" />
          </button>
          <button
            type="button"
            onClick={logout}
            className="mt-1 w-full flex items-center justify-center gap-2 text-[12px] font-medium text-muted hover:text-rose-600 py-2 rounded-lg"
          >
            <LogOut className="w-3.5 h-3.5" />
            Sign out
          </button>
        </div>
      </aside>

      <main className="flex-1 min-w-0 overflow-auto">
        <header className="sticky top-0 z-10 border-b border-line bg-page/90 dark:bg-slate-950/90 backdrop-blur-sm px-6 py-3 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={toggleTheme}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-line bg-surface text-[13px] font-medium text-ink hover:bg-black/[0.04] dark:hover:bg-white/5 transition"
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {theme === 'dark' ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-slate-600" />}
            {theme === 'dark' ? 'Light' : 'Dark'}
          </button>
        </header>
        <div className="max-w-[1280px] mx-auto px-6 py-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
