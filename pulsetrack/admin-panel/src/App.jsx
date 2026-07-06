import React from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import Layout from './components/Layout';
import LoginPage from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Members from './pages/Members.jsx';
import MemberDetail from './pages/MemberDetail.jsx';
import FocusBoard from './pages/FocusBoard.jsx';
import Reports from './pages/Reports.jsx';
import Audit from './pages/Audit.jsx';
import Flags from './pages/Flags.jsx';
import Settings from './pages/Settings.jsx';
import TimeLogs from './pages/TimeLogs.jsx';
import GhostTime from './pages/GhostTime.jsx';
import EmailLogs from './pages/EmailLogs.jsx';
import IntegrationGHL from './pages/IntegrationGHL.jsx';
import Attendance from './pages/Attendance.jsx';
import LeaveManagement from './pages/LeaveManagement.jsx';
import Schedule from './pages/Schedule.jsx';
import Points from './pages/Points.jsx';
import SecurityLog from './pages/SecurityLog.jsx';
import EarlyStart from './pages/EarlyStart.jsx';
import LateLog from './pages/LateLog.jsx';
import WeeklyAccountability from './pages/WeeklyAccountability.jsx';
import NotificationsPage from './pages/NotificationsPage.jsx';

function Guard({ children }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="min-h-screen bg-page flex items-center justify-center text-muted text-sm">
        Loading your workspace…
      </div>
    );
  }
  if (!user || user.role !== 'ADMIN') {
    return <Navigate to="/login" replace />;
  }
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        element={
          <Guard>
            <Layout />
          </Guard>
        }
      >
        <Route path="/" element={<Dashboard />} />
        <Route path="/focus" element={<FocusBoard />} />
        <Route path="/members" element={<Members />} />
        <Route path="/members/:id" element={<MemberDetail />} />
        <Route path="/attendance" element={<Attendance />} />
        <Route path="/leave" element={<LeaveManagement />} />
        <Route path="/early-start" element={<EarlyStart />} />
        <Route path="/late-log" element={<LateLog />} />
        <Route path="/schedule" element={<Schedule />} />
        <Route path="/points" element={<Points />} />
        <Route path="/security" element={<SecurityLog />} />
        <Route path="/notifications" element={<NotificationsPage />} />
        <Route path="/time-logs" element={<TimeLogs />} />
        <Route path="/ghost-time" element={<GhostTime />} />
        <Route path="/flags" element={<Flags />} />
        <Route path="/reports" element={<Reports />} />
        <Route path="/weekly-accountability" element={<WeeklyAccountability />} />
        <Route path="/email-logs" element={<EmailLogs />} />
        <Route path="/audit" element={<Audit />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/integrations/ghl" element={<IntegrationGHL />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
