/* global chrome */
import { getDeviceFingerprint } from './fingerprint.js';

const LS = {
  access: 'pulsetrack_access',
  refresh: 'pulsetrack_refresh',
  apiBase: 'pulsetrack_api_base',
  sessionId: 'pulsetrack_session_id',
  paused: 'pulsetrack_paused',
  lastActivity: 'pulsetrack_last_activity',
  l1Sent: 'pulsetrack_l1_sent',
  l2Sent: 'pulsetrack_l2_sent',
  l3Reached: 'pulsetrack_l3_sent',
  l1Min: 'pulsetrack_l1_min',
  l2Min: 'pulsetrack_l2_min',
  l3Min: 'pulsetrack_l3_min',
  clockStarted: 'pulsetrack_clock_in_started_at',
  reportUrl: 'pulsetrack_report_url',
  liveActiveMs: 'pulsetrack_live_active_ms',
  sessionStatus: 'pulsetrack_session_status',
};

const THRESH = { l1: 5, l2: 10, l3: 15 };

const motivational = [
  'Small consistent steps beat frantic sprints.',
  'Your active minutes are saved automatically every few minutes.',
  'Thanks for staying honest about your hours.',
];

const qs = (id) => document.getElementById(id);

let tickHandle = null;
let pollHandle = null;
let liveActiveBase = 0;
let liveActiveAnchor = 0;

async function blobGet(key) {
  const x = await chrome.storage.local.get(key);
  return x[key];
}

async function blobPut(obj) {
  await chrome.storage.local.set(obj);
}

function apiUrl() {
  const el = qs('apiBase');
  return ((el?.value || '') || 'https://api.liftbrandfulfillment.com').replace(/\/$/, '');
}

function friendlyApiError(status, text, base) {
  const looksHtml = /<\s*html/i.test(text || '');
  if (looksHtml || status === 405) {
    if (/admin\./i.test(base) || text?.includes('405')) {
      return (
        'Wrong Company API URL.\n\n' +
        'Use: https://api.liftbrandfulfillment.com\n' +
        '(not the admin website).'
      );
    }
    return `Server error (${status || 'unknown'}). Use https://api.liftbrandfulfillment.com`;
  }
  const trimmed = (text || '').trim();
  if (trimmed.length > 200) return `Server error (${status}). Check Company API URL.`;
  return trimmed || `Request failed (${status})`;
}

async function refreshAccessToken() {
  const refresh = await blobGet(LS.refresh);
  if (!refresh) return false;

  const base = apiUrl();
  try {
    const res = await fetch(`${base}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ refreshToken: refresh }),
    });
    const text = await res.text();
    let data;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    if (!res.ok) return false;
    await blobPut({
      [LS.access]: data.accessToken,
      [LS.refresh]: data.refreshToken,
    });
    return true;
  } catch {
    return false;
  }
}

async function clearAuthAndShowLogin(message) {
  await blobPut({ [LS.access]: '', [LS.refresh]: '' });
  qs('authView')?.classList.remove('hidden');
  qs('appView')?.classList.add('hidden');
  stopTicker();
  stopPoll();
  if (message) toast(message);
}

async function apiFetch(path, opts = {}, retried = false) {
  const base = apiUrl();
  await blobPut({ [LS.apiBase]: base });

  const token = await blobGet(LS.access);
  if (!token && !opts.skipAuth) throw new Error('Not signed in');

  const headers = new Headers(opts.headers || {});
  if (!opts.skipAuth && token) headers.set('Authorization', `Bearer ${token}`);
  headers.set('Accept', 'application/json');
  if (opts.body && !(opts.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(`${base}${path}`, { ...opts, headers });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    const errMsg = (data && data.error) || friendlyApiError(res.status, text, base);
    if (res.status === 401 && !opts.skipAuth && !retried) {
      const refreshed = await refreshAccessToken();
      if (refreshed) return apiFetch(path, opts, true);
      await clearAuthAndShowLogin('Session expired — please sign in again');
      throw new Error('Session expired — please sign in again');
    }
    throw new Error(errMsg);
  }
  return data;
}

async function applyIdleThresholds() {
  await blobPut({
    [LS.l1Min]: THRESH.l1,
    [LS.l2Min]: THRESH.l2,
    [LS.l3Min]: THRESH.l3,
  });
}

async function login() {
  const email = qs('email').value.trim();
  const password = qs('password').value;
  const payload = await apiFetch('/api/auth/login/member', {
    skipAuth: true,
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });

  await blobPut({
    [LS.access]: payload.accessToken,
    [LS.refresh]: payload.refreshToken,
  });

  await applyIdleThresholds();
  qs('authView').classList.add('hidden');
  qs('appView').classList.remove('hidden');
  await refreshEverything();
}

let clockStatus = null;
let meProfile = null;
let calYear = new Date().getUTCFullYear();
let calMonth = new Date().getUTCMonth();
let calRecords = [];
let monthlyReport = null;

async function clockInNow(lateNote, earlyNote) {
  const fp = await getDeviceFingerprint();
  const body = { deviceFingerprint: fp };
  if (lateNote) body.lateNote = lateNote;
  if (earlyNote) body.earlyNote = earlyNote;

  const s = await apiFetch('/api/sessions/clock-in', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  await applyIdleThresholds();
  await blobPut({
    [LS.sessionId]: s.id,
    [LS.paused]: false,
    [LS.clockStarted]: Date.now(),
    [LS.lastActivity]: Date.now(),
    [LS.l1Sent]: false,
    [LS.l2Sent]: false,
    [LS.l3Reached]: false,
    [LS.sessionStatus]: 'WORKING',
    [LS.liveActiveMs]: 0,
  });
  hideModal('lateModal');
  hideModal('earlyModal');
  if (s.isLate) toast('Clocked in (late) — note saved');
  else if (s.isEarlyStart) toast(`Clocked in early — finish by ${s.expectedClockOutBy?.slice(11, 16) ?? '?'} UTC`);
  else toast('Clocked in — on time!');
  await refreshEverything();
}

async function tryClockIn() {
  try {
    clockStatus = await apiFetch('/api/sessions/clock-status');
  } catch (e) {
    if (/session expired|not signed in/i.test(e.message)) return;
    return clockInNow();
  }

  if (clockStatus.windowClosed && !clockStatus.hasActiveSession) {
    alert('Clock-in window is closed for today.');
    return;
  }

  if (clockStatus.earlyStart?.noteRequired) {
    const mins = clockStatus.earlyStart.minutesEarly ?? 0;
    qs('earlyModalMsg').textContent =
      `You're ${mins} min before the normal window. Add a note (min 20 chars). You must complete ${clockStatus.requiredHours ?? 8}h today.`;
    showModal('earlyModal');
    return;
  }

  if (clockStatus.isLate) {
    qs('lateModalMsg').textContent = `You are ${clockStatus.lateMinutes} minutes late. Add a note (min 20 chars) to continue.`;
    showModal('lateModal');
    return;
  }

  await clockInNow();
}

async function clockOutNow() {
  const id = await blobGet(LS.sessionId);
  if (!id) return;

  const result = await apiFetch('/api/sessions/clock-out', {
    method: 'POST',
    body: JSON.stringify({ sessionId: id }),
  });

  hideModal('clockOutModal');
  await blobPut({
    [LS.sessionId]: '',
    [LS.paused]: false,
    [LS.clockStarted]: 0,
    [LS.sessionStatus]: '',
    [LS.liveActiveMs]: 0,
  });

  const sum = result.summary;
  if (sum) {
    toast(
      sum.isComplete
        ? `Done! ${sum.totalHoursWorked.toFixed(1)}h — full day ✓`
        : `Clocked out — short by ${sum.shortBy.toFixed(1)}h`,
    );
  } else {
    toast('Clocked out — today saved on server');
  }
  await refreshEverything();
}

function showClockOutConfirm() {
  const req = clockStatus?.requiredHours ?? 8;
  const worked = (liveActiveBase + (liveActiveAnchor ? Date.now() - liveActiveAnchor : 0)) / 3_600_000;
  const complete = worked >= req;
  const finishBy = clockStatus?.expectedClockOutFormatted;
  const earlyLine = clockStatus?.earlyStart?.isEarlyWindow && finishBy
    ? `<br/>Required finish: <strong>${finishBy}</strong>`
    : '';
  qs('clockOutSummary').innerHTML = complete
    ? `You worked <strong>${worked.toFixed(1)}h</strong>. Required: ${req}h.${earlyLine} <span style="color:var(--success)">Status: Complete ✓</span>`
    : `You worked <strong>${worked.toFixed(1)}h</strong>. Required: ${req}h.${earlyLine} Short by: <strong>${(req - worked).toFixed(1)}h</strong> — affects your record.`;
  showModal('clockOutModal');
}

async function startBreakFlow() {
  const id = await blobGet(LS.sessionId);
  const type = qs('breakType').value;
  await apiFetch('/api/sessions/break/start', {
    method: 'POST',
    body: JSON.stringify({ sessionId: id, type }),
  });
  toast('Break started');
  await refreshEverything();
}

async function endBreakFlow() {
  const id = await blobGet(LS.sessionId);
  await apiFetch('/api/sessions/break/end', {
    method: 'POST',
    body: JSON.stringify({ sessionId: id }),
  });
  await blobPut({ [LS.lastActivity]: Date.now(), [LS.l1Sent]: false, [LS.l2Sent]: false, [LS.l3Reached]: false });
  toast('Back to work');
  await refreshEverything();
}

async function pauseManual() {
  const id = await blobGet(LS.sessionId);
  await apiFetch('/api/sessions/pause', { method: 'POST', body: JSON.stringify({ sessionId: id }) });
  await blobPut({ [LS.paused]: true, [LS.sessionStatus]: 'PAUSED_MANUAL' });
  toast('Paused — not counting active time');
  await refreshEverything();
}

async function resumeManual() {
  const id = await blobGet(LS.sessionId);
  await apiFetch('/api/sessions/resume', { method: 'POST', body: JSON.stringify({ sessionId: id }) });
  await blobPut({
    [LS.paused]: false,
    [LS.lastActivity]: Date.now(),
    [LS.sessionStatus]: 'WORKING',
    [LS.l1Sent]: false,
    [LS.l2Sent]: false,
    [LS.l3Reached]: false,
  });
  toast('Resumed');
  await refreshEverything();
}

async function resumeFocus() {
  const id = await blobGet(LS.sessionId);
  await apiFetch('/api/sessions/reminder/ack', {
    method: 'POST',
    body: JSON.stringify({ sessionId: id, level: 'L3' }),
  }).catch(() => {});
  await apiFetch('/api/sessions/state/resume-focus', {
    method: 'POST',
    body: JSON.stringify({ sessionId: id }),
  });
  await blobPut({
    [LS.lastActivity]: Date.now(),
    [LS.l1Sent]: false,
    [LS.l2Sent]: false,
    [LS.l3Reached]: false,
    [LS.paused]: false,
    [LS.sessionStatus]: 'WORKING',
  });
  toast('Focus resumed — active time counting again');
  await refreshEverything();
}

function showModal(id) {
  qs(id)?.classList.remove('hidden');
}
function hideModal(id) {
  qs(id)?.classList.add('hidden');
}

function updateEarlyStartPanel() {
  const panel = qs('earlyStartPanel');
  const msg = qs('earlyStartMsg');
  if (!panel || !clockStatus?.earlyStart) return;

  if (clockStatus.hasActiveSession) {
    panel.classList.add('hidden');
    return;
  }

  const es = clockStatus.earlyStart;
  if (es.noteRequired) {
    panel.classList.remove('hidden');
    msg.textContent =
      `Early window open until ${clockStatus.window?.normalEarliestFormatted ?? '—'}. ` +
      `A note is required (${es.minutesEarly ?? 0} min early). You must still complete ${clockStatus.requiredHours ?? 8}h.`;
    return;
  }

  panel.classList.add('hidden');
}

function updateHoursDueHint() {
  const el = qs('hoursDueHint');
  if (!el || !clockStatus) return;

  const req = clockStatus.requiredHours ?? 8;
  const worked = clockStatus.hoursWorked ?? 0;
  const remaining = clockStatus.hoursRemaining ?? Math.max(0, req - worked);
  const finishBy = clockStatus.expectedClockOutFormatted;

  if (clockStatus.hasActiveSession && finishBy) {
    el.classList.remove('hidden');
    if (clockStatus.isComplete) {
      el.textContent = `✓ Required ${req}h complete`;
      el.classList.add('complete');
    } else {
      el.textContent = `${remaining.toFixed(1)}h left · finish by ${finishBy}`;
      el.classList.remove('complete');
    }
  } else if (clockStatus.earlyStart?.noteRequired) {
    el.classList.remove('hidden');
    el.classList.remove('complete');
    el.textContent = `If you clock in now: ${req}h required · finish by ${clockStatus.expectedClockOutFormatted ?? '—'}`;
  } else {
    el.classList.add('hidden');
  }
}

function updateClockButtons() {
  const inBtn = qs('clockInBtn');
  const lateBtn = qs('clockInLateBtn');
  if (!inBtn || !clockStatus) return;

  updateEarlyStartPanel();
  updateHoursDueHint();

  if (clockStatus.hasActiveSession) {
    inBtn.classList.add('hidden');
    lateBtn?.classList.add('hidden');
    return;
  }

  if (clockStatus.windowClosed) {
    inBtn.classList.add('hidden');
    lateBtn?.classList.add('hidden');
    const hint = qs('scheduleHint');
    if (hint) {
      hint.textContent = 'Clock-in window closed for today';
      hint.classList.remove('hidden');
    }
    return;
  }

  if (clockStatus.isLate) {
    inBtn.classList.add('hidden');
    lateBtn?.classList.remove('hidden');
  } else {
    inBtn.classList.remove('hidden');
    lateBtn?.classList.add('hidden');
    inBtn.textContent = clockStatus.earlyStart?.noteRequired ? 'Clock in (early — note required)' : 'Clock In';
  }

  const hint = qs('scheduleHint');
  if (hint && clockStatus.isLate && !clockStatus.hasActiveSession) {
    hint.textContent = `⚠ You are ${clockStatus.lateMinutes} min late (grace: ${clockStatus.graceMinutes} min)`;
    hint.classList.remove('hidden');
  } else if (hint && clockStatus.earlyStart?.noteRequired) {
    hint.textContent = `Early window — note required (${clockStatus.earlyStart.minutesEarly ?? 0} min before normal)`;
    hint.classList.remove('hidden');
  } else if (hint) {
    hint.classList.add('hidden');
  }
}

function updateProgress(liveMs) {
  const reqH = clockStatus?.requiredHours ?? 8;
  const workedH = liveMs / 3_600_000;
  const pct = Math.min(100, (workedH / reqH) * 100);
  const wrap = qs('progressWrap');
  if (!wrap) return;
  if (liveMs > 0 || clockStatus?.hasActiveSession) {
    wrap.classList.remove('hidden');
    qs('progressFill').style.width = `${pct}%`;
    const remaining = Math.max(0, reqH - workedH);
    qs('progressLabel').textContent =
      pct >= 100
        ? `✓ Required hours met (+${(workedH - reqH).toFixed(1)}h extra)`
        : `${pct.toFixed(0)}% · ${workedH.toFixed(1)}h / ${reqH}h · ${remaining.toFixed(1)}h left`;
  } else {
    wrap.classList.add('hidden');
  }
}

async function loadLeaveTab() {
  if (!meProfile?.id) return;
  try {
    const rows = await apiFetch(`/api/leave/history/${meProfile.id}`);
    qs('leaveHistory').innerHTML = rows.length
      ? rows.slice(0, 8).map((l) =>
          `<div class="leave-item"><strong>${l.type}</strong> ${new Date(l.requestedDate).toLocaleDateString()} — <span>${l.status}</span></div>`,
        ).join('')
      : 'No leave requests yet.';
  } catch {
    qs('leaveHistory').textContent = 'Could not load leave history.';
  }
}

async function submitLeave() {
  const date = qs('leaveDate').value;
  const reason = qs('leaveReason').value.trim();
  const isEmergency = qs('leaveEmergency').checked || qs('leaveType').value === 'EMERGENCY';
  if (!date) return alert('Pick a date');
  await apiFetch('/api/leave/request', {
    method: 'POST',
    body: JSON.stringify({
      requestedDate: date,
      type: qs('leaveType').value,
      reason,
      isEmergency,
    }),
  });
  toast('Leave request submitted — pending admin approval');
  qs('leaveReason').value = '';
  await loadLeaveTab();
}

async function loadPointsTab() {
  if (!meProfile?.id) return;
  try {
    const data = await apiFetch(`/api/points/${meProfile.id}`);
    qs('pointsBalance').textContent = data.user?.points ?? 0;
    qs('pointsToday').textContent = `Today: +${data.todayEarned ?? 0}`;
    qs('streakLabel').textContent = `🔥 ${data.user?.streakDays ?? 0}-day streak`;
    qs('pointsHistory').innerHTML = (data.history ?? []).slice(0, 10).map((t) =>
      `<div class="point-item">${t.points > 0 ? '+' : ''}${t.points} — ${t.description}</div>`,
    ).join('') || 'No points yet — clock in on time to earn!';
  } catch {
    qs('pointsHistory').textContent = 'Could not load points.';
  }
}

function switchTab(name) {
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
  qs('tabWork').classList.toggle('hidden', name !== 'work');
  qs('tabLeave').classList.toggle('hidden', name !== 'leave');
  qs('tabPoints').classList.toggle('hidden', name !== 'points');
  qs('tabRecord').classList.toggle('hidden', name !== 'record');
  if (name === 'leave') loadLeaveTab().catch(() => {});
  if (name === 'points') loadPointsTab().catch(() => {});
  if (name === 'record') loadRecordTab().catch(() => {});
}

const STATUS_CLASS = {
  PRESENT: 'status-PRESENT',
  LATE: 'status-LATE',
  ABSENT: 'status-ABSENT',
  ON_LEAVE: 'status-ON_LEAVE',
};

function dayKey(d) {
  return d.toISOString().slice(0, 10);
}

async function loadRecordTab() {
  if (!meProfile?.id) return;

  const monthStr = `${calYear}-${String(calMonth + 1).padStart(2, '0')}`;
  const from = new Date(Date.UTC(calYear, calMonth, 1)).toISOString();
  const to = new Date(Date.UTC(calYear, calMonth + 1, 1)).toISOString();

  try {
    monthlyReport = await apiFetch(`/api/attendance/monthly/${meProfile.id}?month=${monthStr}`);
    calRecords = monthlyReport.records ?? [];
  } catch {
    monthlyReport = null;
    try {
      calRecords = await apiFetch(`/api/attendance/history/${meProfile.id}?from=${from}&to=${to}&limit=35`);
    } catch {
      calRecords = [];
    }
  }

  renderMonthlyPerformance();
  renderCalendar();
}

function renderMonthlyPerformance() {
  const el = qs('monthlyPerformance');
  if (!el) return;

  const s = monthlyReport?.summary;
  if (!s) {
    el.innerHTML = '<p class="hint hint-small">Could not load monthly stats.</p>';
    return;
  }

  const completeClass = s.completionPct >= 90 ? 'perf-good' : s.completionPct >= 70 ? 'perf-warn' : 'perf-bad';

  el.innerHTML = `
    <div class="perf-grid">
      <div class="perf-card">
        <div class="perf-val">${s.workDays}</div>
        <div class="perf-lbl">Work days</div>
        <div class="perf-sub">${s.presentDays} on time · ${s.lateDays} late</div>
      </div>
      <div class="perf-card">
        <div class="perf-val">${s.totalHoursWorked}h</div>
        <div class="perf-lbl">Hours worked</div>
        <div class="perf-sub">Expected ${s.expectedHours}h</div>
      </div>
      <div class="perf-card ${completeClass}">
        <div class="perf-val">${s.completionPct}%</div>
        <div class="perf-lbl">Hours completion</div>
        <div class="perf-sub">${s.completeDays} complete · ${s.incompleteDays} short</div>
      </div>
      <div class="perf-card">
        <div class="perf-val">${s.attendanceRate}%</div>
        <div class="perf-lbl">Attendance rate</div>
        <div class="perf-sub">${s.absentDays} absent · ${s.onLeaveDays} leave</div>
      </div>
      <div class="perf-card">
        <div class="perf-val">${s.monthNetPoints >= 0 ? '+' : ''}${s.monthNetPoints}</div>
        <div class="perf-lbl">Points this month</div>
        <div class="perf-sub">+${s.monthPointsEarned} earned · −${s.monthPointsDeducted} lost</div>
      </div>
      <div class="perf-card">
        <div class="perf-val">🔥 ${s.streakDays}</div>
        <div class="perf-lbl">Current streak</div>
        <div class="perf-sub">${s.earlyStarts} early starts · ${s.overtimeHours}h overtime</div>
      </div>
    </div>
    ${monthlyReport.recentPoints?.length ? `
      <div class="perf-points-title">Recent points this month</div>
      <div class="perf-points-list">
        ${monthlyReport.recentPoints.slice(0, 6).map((p) =>
          `<div class="perf-point-row"><span class="${p.points >= 0 ? 'pos' : 'neg'}">${p.points >= 0 ? '+' : ''}${p.points}</span> ${p.description || p.type}</div>`,
        ).join('')}
      </div>` : ''}
  `;
}

function showDayDetail(rec) {
  if (!rec) return;
  const modal = qs('dayDetailModal');
  const body = qs('dayDetailBody');
  if (!modal || !body) return;

  const d = new Date(rec.date).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
  const inT = rec.clockInTime
    ? new Date(rec.clockInTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) + ' UTC'
    : '—';
  const outT = rec.clockOutTime
    ? new Date(rec.clockOutTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) + ' UTC'
    : '—';

  body.innerHTML = `
    <h3>${d}</h3>
    <p><strong>Status:</strong> ${(rec.status || '—').replace(/_/g, ' ')}</p>
    <p><strong>Clock in:</strong> ${inT}${rec.lateMinutes > 0 ? ` (+${rec.lateMinutes}m late)` : ''}${rec.earlyMinutes > 0 ? ` (${rec.earlyMinutes}m early)` : ''}</p>
    <p><strong>Clock out:</strong> ${outT}</p>
    <p><strong>Hours:</strong> ${(rec.totalHoursWorked ?? 0).toFixed(1)}h / ${rec.requiredHours ?? 8}h ${rec.isComplete ? '✓' : rec.totalHoursWorked > 0 ? '(incomplete)' : ''}</p>
    ${rec.lateNote ? `<p><strong>Late note:</strong> ${rec.lateNote}</p>` : ''}
    ${rec.earlyNote ? `<p><strong>Early note:</strong> ${rec.earlyNote}</p>` : ''}
  `;
  showModal('dayDetailModal');
}

function renderCalendar() {
  const title = qs('calTitle');
  const grid = qs('calGrid');
  const stats = qs('calStats');
  if (!title || !grid) return;

  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  title.textContent = `${monthNames[calMonth]} ${calYear}`;

  const recordMap = new Map(
    calRecords.map((r) => [new Date(r.date).toISOString().slice(0, 10), r]),
  );

  const first = new Date(Date.UTC(calYear, calMonth, 1));
  const startPad = first.getUTCDay();
  const daysInMonth = new Date(Date.UTC(calYear, calMonth + 1, 0)).getUTCDate();
  const todayKey = dayKey(new Date());

  let present = 0;
  let late = 0;
  let absent = 0;
  let onLeave = 0;
  let totalHours = 0;

  let html = '';
  for (let i = 0; i < startPad; i += 1) {
    html += '<div class="cal-day empty"></div>';
  }
  for (let d = 1; d <= daysInMonth; d += 1) {
    const key = dayKey(new Date(Date.UTC(calYear, calMonth, d)));
    const rec = recordMap.get(key);
    const st = rec?.status;
    if (st === 'PRESENT') present += 1;
    if (st === 'LATE') late += 1;
    if (st === 'ABSENT') absent += 1;
    if (st === 'ON_LEAVE') onLeave += 1;
    if (rec?.totalHoursWorked) totalHours += rec.totalHoursWorked;

    const cls = ['cal-day'];
    if (st && STATUS_CLASS[st]) cls.push(STATUS_CLASS[st]);
    if (rec && !rec.isComplete && rec.totalHoursWorked > 0) cls.push('incomplete');
    if (key === todayKey) cls.push('today');
    const tipParts = [];
    if (rec?.lateNote) tipParts.push(rec.lateNote);
    if (rec?.earlyNote) tipParts.push(`Early: ${rec.earlyNote}`);
    if (rec?.totalHoursWorked) tipParts.push(`${rec.totalHoursWorked.toFixed(1)}h`);
    const tip = tipParts.length ? ` title="${tipParts.join(' · ').replace(/"/g, "'")}"` : '';
    const click = rec ? ` data-day-key="${key}"` : '';
    html += `<div class="${cls.join(' ')}"${tip}${click}>${d}</div>`;
  }
  grid.innerHTML = html;

  grid.querySelectorAll('[data-day-key]').forEach((cell) => {
    cell.addEventListener('click', () => {
      const rec = recordMap.get(cell.dataset.dayKey);
      showDayDetail(rec);
    });
  });

  const s = monthlyReport?.summary;
  const workDays = s?.workDays ?? present + late;
  const rate = s?.attendanceRate ?? (workDays ? Math.round((workDays / (workDays + absent)) * 100) : 0);
  const hours = s?.totalHoursWorked ?? totalHours;
  const completion = s?.completionPct;
  if (stats) {
    stats.innerHTML =
      `<strong>This month:</strong> ${present} present · ${late} late · ${absent} absent · ${onLeave} leave<br/>` +
      `<strong>Total hours:</strong> ${Number(hours).toFixed(1)}h` +
      (completion != null ? ` · <strong>Completion:</strong> ${completion}%` : '') +
      ` · <strong>Attendance rate:</strong> ${rate}%`;
  }
}

function toast(line) {
  const el = qs('toast');
  if (el) el.textContent = line;
}

function format(ms) {
  const sec = Math.floor(ms / 1000);
  const hh = Math.floor(sec / 3600);
  const mm = Math.floor((sec % 3600) / 60);
  const ss = sec % 60;
  return [hh, mm, ss].map((n) => String(n).padStart(2, '0')).join(':');
}

function setTimerHint(session) {
  const hint = qs('timerHint');
  if (!hint) return;
  if (!session) {
    hint.textContent = 'Clock in to start tracking';
    return;
  }
  if (session.status === 'GHOST') {
    hint.textContent = 'Paused — 15 min no activity (ghost time recording)';
    return;
  }
  if (session.status === 'IDLE') {
    hint.textContent = 'Active time paused — move mouse/keyboard';
    return;
  }
  if (session.status === 'ON_BREAK') {
    hint.textContent = 'On break — active time not counting';
    return;
  }
  if (session.status === 'PAUSED_MANUAL') {
    hint.textContent = 'Manual pause — tap Resume when working';
    return;
  }
  hint.textContent = 'Auto-pause after 15 min with no mouse/keyboard';
}

function stopTicker() {
  if (tickHandle) clearInterval(tickHandle);
  tickHandle = null;
  liveActiveBase = 0;
  liveActiveAnchor = 0;
}

function startTicker(session, liveMs) {
  stopTicker();
  const frozen = session.status === 'GHOST' || session.status === 'IDLE' || session.status === 'PAUSED_MANUAL' || session.status === 'ON_BREAK';
  liveActiveBase = liveMs;
  liveActiveAnchor = frozen ? 0 : Date.now();

  const tick = () => {
    const extra = frozen ? 0 : Date.now() - liveActiveAnchor;
    const total = liveActiveBase + extra;
    qs('timer').textContent = format(total);
    updateProgress(total);
  };
  tick();
  tickHandle = setInterval(tick, 500);
}

function stopPoll() {
  if (pollHandle) clearInterval(pollHandle);
  pollHandle = null;
}

function startPoll() {
  stopPoll();
  pollHandle = setInterval(() => refreshEverything().catch(() => {}), 12_000);
}

async function syncLiveFromServer(activePayload) {
  const session = activePayload?.session ?? activePayload;
  const liveMs = activePayload?.liveActiveMs ?? session?.totalActiveMs ?? 0;
  if (session?.id) {
    await blobPut({
      [LS.liveActiveMs]: liveMs,
      [LS.sessionStatus]: session.status,
    });
  }
  return { session, liveMs };
}

async function refreshEverything() {
  const token = await blobGet(LS.access);
  if (!token) {
    qs('authView').classList.remove('hidden');
    qs('appView').classList.add('hidden');
    qs('apiBase').value = (await blobGet(LS.apiBase)) || 'https://api.liftbrandfulfillment.com';
    stopTicker();
    stopPoll();
    return;
  }

  qs('authView').classList.add('hidden');
  qs('appView').classList.remove('hidden');

  let me = null;
  try {
    me = await apiFetch('/api/auth/me');
  } catch (e) {
    if (/session expired|invalid or expired token|not signed in/i.test(e.message)) return;
  }

  meProfile = me;
  qs('userName').textContent = me?.name || 'Team member';
  qs('avatar').textContent = ((me?.name || 'LB').split(/\s+/g).map((p) => p[0]).slice(0, 2).join('')).toUpperCase();

  await applyIdleThresholds();

  let activePayload = null;
  try {
    activePayload = await apiFetch('/api/sessions/active');
  } catch {}

  try {
    clockStatus = await apiFetch('/api/sessions/clock-status');
    updateClockButtons();
  } catch {}

  const { session: serverSession, liveMs } = await syncLiveFromServer(activePayload);

  if (serverSession?.id && serverSession.clockOut === null) {
    await blobPut({
      [LS.sessionId]: serverSession.id,
      [LS.paused]: serverSession.status === 'PAUSED_MANUAL',
    });
    hydrateControls(serverSession);
    setTimerHint(serverSession);
    startTicker(serverSession, liveMs);
    updateProgress(liveMs);
    startPoll();
  } else {
    await logoutSessionLocal();
    hydrateControlsClosed();
    setTimerHint(null);
    stopTicker();
    stopPoll();
    qs('clockInBtn').classList.remove('hidden');
    qs('clockOutBtn').classList.add('hidden');
    qs('breakBtn').classList.add('hidden');
    qs('resumeBtn').classList.add('hidden');
    qs('resumeFocusBtn').classList.add('hidden');
    qs('pauseBtn').classList.add('hidden');
    qs('manualResumeBtn').classList.add('hidden');
    qs('breakRow')?.classList.add('hidden');
  }

  try {
    const sum = await apiFetch('/api/sessions/today');
    const w = +(sum.workMs / 3_600_000).toFixed(2);
    const b = +(sum.breakMs / 3_600_000).toFixed(2);
    const i = +(sum.idleMs / 3_600_000).toFixed(2);
    const g = +(sum.ghostMs / 3_600_000).toFixed(2);
    qs('todaySummary').innerHTML =
      `<span><strong>Active</strong> ${w}h</span> · ` +
      `<span><strong>Break</strong> ${b}h</span> · ` +
      `<span><strong>Idle</strong> ${i}h</span> · ` +
      `<span><strong>Ghost</strong> ${g}h</span><br/>` +
      `<span class="muted-inline">${sum.sessions} session(s) today</span>`;
    qs('quote').textContent = motivational[(sum?.sessions ?? 0) % motivational.length];
  } catch {
    qs('todaySummary').textContent = 'Could not load today — check API URL';
  }

  qs('apiBase').value = (await blobGet(LS.apiBase)) || 'https://api.liftbrandfulfillment.com';
}

async function logoutSessionLocal() {
  await blobPut({
    [LS.sessionId]: '',
    [LS.clockStarted]: 0,
    [LS.paused]: false,
  });
}

function hydrateControls(session) {
  const manualPaused = session.status === 'PAUSED_MANUAL';
  const idleish = session.status === 'IDLE' || session.status === 'GHOST';
  const onBreak = session.status === 'ON_BREAK';
  const working = session.status === 'WORKING' && !manualPaused && !idleish;

  qs('pill').dataset.state =
    onBreak ? 'break' :
    session.status === 'GHOST' ? 'danger' :
    idleish || manualPaused ? 'idle' :
    working ? 'working' : '';

  qs('pill').textContent =
    onBreak ? 'On break' :
    session.status === 'GHOST' ? 'Ghost — timer paused' :
    session.status === 'IDLE' ? 'Idle — no activity' :
    session.status === 'PAUSED_MANUAL' ? 'Paused manually' :
    'Working';

  qs('clockOutBtn').classList.remove('hidden');
  qs('clockInBtn').classList.add('hidden');
  qs('breakRow')?.classList.toggle('hidden', !working && !onBreak);

  qs('breakBtn').classList.toggle('hidden', onBreak || manualPaused || idleish);
  qs('resumeBtn').classList.toggle('hidden', !onBreak);
  qs('resumeFocusBtn').classList.toggle('hidden', !idleish);
  qs('pauseBtn').classList.toggle('hidden', onBreak || manualPaused || idleish);
  qs('manualResumeBtn').classList.toggle('hidden', !manualPaused);
}

function hydrateControlsClosed() {
  qs('pill').dataset.state = '';
  qs('pill').textContent = 'Clocked out';
  qs('timer').textContent = '00:00:00';
}

function wireAuth() {
  qs('loginBtn').addEventListener('click', () => login().catch((e) => alert(e.message)));
  qs('signOutBtn')?.addEventListener('click', () => signOut().catch((e) => alert(e.message)));
}

async function signOut() {
  const refresh = await blobGet(LS.refresh);
  try {
    await apiFetch('/api/auth/logout', {
      method: 'POST',
      body: JSON.stringify({ refreshToken: refresh }),
    });
  } catch {
    /* ignore */
  }
  await blobPut({
    [LS.access]: '',
    [LS.refresh]: '',
    [LS.sessionId]: '',
  });
  qs('authView')?.classList.remove('hidden');
  qs('appView')?.classList.add('hidden');
  stopTicker();
  stopPoll();
  toast('Signed out');
}

function wireWork() {
  qs('clockInBtn').addEventListener('click', () => tryClockIn().catch((e) => alert(e.message)));
  qs('clockInLateBtn')?.addEventListener('click', () => {
    qs('lateModalMsg').textContent = clockStatus
      ? `You are ${clockStatus.lateMinutes} minutes late. Add a note (min 20 chars).`
      : 'Please explain why you are late.';
    showModal('lateModal');
  });
  qs('lateSubmitBtn')?.addEventListener('click', () => {
    const note = qs('lateNote').value.trim();
    if (note.length < 20) return alert('Note must be at least 20 characters');
    clockInNow(note).catch((e) => alert(e.message));
  });
  qs('lateCancelBtn')?.addEventListener('click', () => hideModal('lateModal'));
  qs('clockOutBtn').addEventListener('click', () => showClockOutConfirm());
  qs('clockOutConfirmBtn')?.addEventListener('click', () => clockOutNow().catch((e) => alert(e.message)));
  qs('clockOutCancelBtn')?.addEventListener('click', () => hideModal('clockOutModal'));
  qs('breakBtn').addEventListener('click', () => startBreakFlow().catch((e) => alert(e.message)));
  qs('resumeBtn').addEventListener('click', () => endBreakFlow().catch((e) => alert(e.message)));
  qs('pauseBtn').addEventListener('click', () => pauseManual().catch((e) => alert(e.message)));
  qs('manualResumeBtn').addEventListener('click', () => resumeManual().catch((e) => alert(e.message)));
  qs('resumeFocusBtn').addEventListener('click', () => resumeFocus().catch((e) => alert(e.message)));
  qs('submitLeaveBtn')?.addEventListener('click', () => submitLeave().catch((e) => alert(e.message)));
  qs('earlySubmitBtn')?.addEventListener('click', () => {
    const note = qs('earlyNote')?.value?.trim();
    if (!note || note.length < 20) return alert('Note must be at least 20 characters');
    clockInNow(null, note).catch((e) => alert(e.message));
  });
  qs('earlyCancelBtn')?.addEventListener('click', () => hideModal('earlyModal'));
  qs('dayDetailCloseBtn')?.addEventListener('click', () => hideModal('dayDetailModal'));
  document.querySelectorAll('.tab').forEach((t) => {
    t.addEventListener('click', () => switchTab(t.dataset.tab));
  });
  qs('calPrev')?.addEventListener('click', () => {
    calMonth -= 1;
    if (calMonth < 0) { calMonth = 11; calYear -= 1; }
    loadRecordTab().catch(() => {});
  });
  qs('calNext')?.addEventListener('click', () => {
    calMonth += 1;
    if (calMonth > 11) { calMonth = 0; calYear += 1; }
    loadRecordTab().catch(() => {});
  });
}

(async () => {
  qs('apiBase').value = (await blobGet(LS.apiBase)) || 'https://api.liftbrandfulfillment.com';
  wireAuth();
  wireWork();
  await refreshEverything();
})();
