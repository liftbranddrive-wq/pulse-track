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
  savedEmail: 'pulsetrack_saved_email',
  liveActiveMs: 'pulsetrack_live_active_ms',
  liveAnchorAt: 'pulsetrack_live_anchor_at',
  sessionStatus: 'pulsetrack_session_status',
  clockInAt: 'pulsetrack_clock_in_at',
  pointRulesHash: 'pulsetrack_point_rules_hash',
};

const THRESH = { l1: 5, l2: 10, l3: 15 };

const localTz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Local';

function formatLocalTime(iso, withSeconds = false) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: withSeconds ? '2-digit' : undefined,
    timeZoneName: 'short',
  });
}

function formatLocalDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

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
  if (status === 504 || status === 502) {
    return 'API server not responding. Admin must restart the API on DigitalOcean (pm2 restart pulsetrack-api).';
  }
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
    if (res.status === 409 && data?.needsWorkShiftChoice) return data;
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
  const email = qs('email').value.trim().toLowerCase();
  const password = qs('password').value.trim();
  if (!email || !password) {
    throw new Error('Enter your email and password.');
  }
  const base = apiUrl();
  if (!/^https:\/\/api\./i.test(base) && !/localhost|127\.0\.0\.1/i.test(base)) {
    throw new Error(
      'Check Company API URL.\n\nUse: https://api.liftbrandfulfillment.com\n(not the admin website).',
    );
  }
  let payload;
  try {
    const fp = await getDeviceFingerprint();
    payload = await apiFetch('/api/auth/login/member', {
      skipAuth: true,
      method: 'POST',
      body: JSON.stringify({ email, password, deviceFingerprint: fp }),
    });
  } catch (e) {
    if (/invalid credentials/i.test(e.message || '')) {
      throw new Error(
        'Invalid email or password.\n\n' +
          '• Use the email + password your manager set in Admin → Members\n' +
          '• Not your personal Gmail unless that exact email was added\n' +
          '• Ask admin to click Reset password on your name if unsure\n' +
          `• API URL must be: https://api.liftbrandfulfillment.com (yours: ${base})`,
      );
    }
    if (/too many/i.test(e.message || '')) {
      throw new Error('Too many login attempts — wait 15 minutes, then try again once.');
    }
    throw e;
  }

  await blobPut({
    [LS.access]: payload.accessToken,
    [LS.refresh]: payload.refreshToken,
    [LS.savedEmail]: email,
  });

  await applyIdleThresholds();
  qs('authView').classList.add('hidden');
  qs('appView').classList.remove('hidden');
  await refreshEverything();
}

let clockStatus = null;
let meProfile = null;
let pendingDayChoice = null;
let calYear = new Date().getUTCFullYear();
let calMonth = new Date().getUTCMonth();
let calRecords = [];
let monthlyReport = null;

function openNightChoiceModal(info) {
  const prev = info?.previousDayLabel || 'previous day';
  const today = info?.todayLabel || 'new day';
  qs('shiftModalMsg').textContent = 'You are clocking in after midnight. Which day is this work for?';
  qs('shiftPrevDayBtn').textContent = `Previous day — ${prev}`;
  qs('shiftNewDayBtn').textContent = `New day — ${today}`;
  hideModal('earlyModal');
  hideModal('lateModal');
  showModal('shiftModal');
}

async function clockInNow(lateNote, earlyNote, dayChoice) {
  const fp = await getDeviceFingerprint();
  const body = { deviceFingerprint: fp };
  if (lateNote) body.lateNote = lateNote;
  if (earlyNote) body.earlyNote = earlyNote;
  if (dayChoice) body.dayChoice = dayChoice;

  const s = await apiFetch('/api/sessions/clock-in', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  if (s?.needsWorkShiftChoice) {
    openNightChoiceModal(s);
    return;
  }
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

  if (clockStatus.windowClosed && !clockStatus.hasActiveSession && !clockStatus.nightShift?.active && !clockStatus.isResume) {
    const desc = describeClockWindows(clockStatus);
    alert(
      desc
        ? `Clock-in is closed right now.\n\nToday's windows (${desc.tz}):\n` +
          `• Early (note → admin): ${desc.earlyFrom} – ${desc.earlyTo}\n` +
          `• Normal: ${desc.normalFrom} – ${desc.normalTo}`
        : 'Clock-in window is closed for today.',
    );
    return;
  }

  if (clockStatus.isResume) {
    await clockInNow();
    return;
  }

  if (clockStatus.nightShift?.needsChoice) {
    openNightChoiceModal(clockStatus.nightShift);
    return;
  }

  if (clockStatus.isLate) {
    const start = clockStatus.window?.scheduledFormatted || 'scheduled time';
    const now = clockStatus.nowLocal?.timeShort || clockStatus.nowLocal?.time || 'now';
    qs('lateModalMsg').textContent =
      `You are ${clockStatus.lateMinutes} minutes late (now ${now}, start was ${start}). Add a note (min 20 chars) to continue.`;
    showModal('lateModal');
    return;
  }

  if (clockStatus.earlyStart?.noteRequired) {
    openEarlyNoteModal();
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
  await blobPut({
    [LS.sessionStatus]: 'ON_BREAK',
    [LS.paused]: false,
    [LS.lastActivity]: Date.now(),
    [LS.l1Sent]: false,
    [LS.l2Sent]: false,
    [LS.l3Reached]: false,
  });
  toast('Break started — this time is NOT ghost time');
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
  let id = await blobGet(LS.sessionId);
  if (!id) {
    const active = await apiFetch('/api/sessions/active');
    id = active?.session?.id;
    if (!id) throw new Error('No active session — try clocking out and in again.');
  }

  await apiFetch('/api/sessions/reminder/ack', {
    method: 'POST',
    body: JSON.stringify({ sessionId: id, level: 'L3' }),
  }).catch(() => {});

  const result = await apiFetch('/api/sessions/state/resume-focus', {
    method: 'POST',
    body: JSON.stringify({ sessionId: id }),
  });
  if (result?.error) throw new Error(result.error);

  const session = result.session ?? result;
  await blobPut({
    [LS.sessionId]: session.id || id,
    [LS.lastActivity]: Date.now(),
    [LS.l1Sent]: false,
    [LS.l2Sent]: false,
    [LS.l3Reached]: false,
    [LS.paused]: false,
    [LS.sessionStatus]: session.status || 'WORKING',
  });

  try {
    chrome.runtime.sendMessage({ type: 'ACTIVITY' });
  } catch {
    /* popup may be detached */
  }

  toast('Focus resumed — active time counting again');
  await refreshEverything();
}

function showModal(id) {
  qs(id)?.classList.remove('hidden');
}
function hideModal(id) {
  qs(id)?.classList.add('hidden');
}

function scheduleTz(status) {
  return status?.window?.timezone || status?.nowLocal?.timezone || status?.schedule?.timezone || 'Asia/Karachi';
}

function wallTime(w, key, fallbackMins) {
  const formatted = w?.[`${key}Formatted`] || w?.[key];
  if (typeof formatted === 'string' && formatted.includes('M')) return formatted;
  if (typeof formatted === 'string' && formatted.length > 0) return formatted;
  return formatLocalScheduleMin(fallbackMins);
}

function formatLocalScheduleMin(mins) {
  if (mins == null || Number.isNaN(Number(mins))) return '—';
  const tz = scheduleTz(clockStatus);
  const h = Math.floor(Number(mins) / 60) % 24;
  const m = Number(mins) % 60;
  try {
    const probe = new Date();
    const nowMins = probe.getHours() * 60 + probe.getMinutes();
    probe.setMinutes(probe.getMinutes() + (h * 60 + m - nowMins));
    return probe.toLocaleTimeString('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true });
  } catch {
    const d = new Date();
    d.setHours(h, m, 0, 0);
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
}

function describeClockWindows(status) {
  const w = status?.window;
  if (!w) return null;
  const tz = scheduleTz(status);
  const req = status.requiredHours ?? 8;
  const earlyFrom = wallTime(w, 'earliest', w.earliest);
  const earlyTo = wallTime(w, 'normalEarliest', w.normalEarliest);
  const normalTo = wallTime(w, 'latest', w.latest);
  const scheduled = wallTime(w, 'scheduled', w.scheduled ?? w.normalEarliest);
  const nowLine = status.nowLocal
    ? `<strong>Right now:</strong> ${status.nowLocal.timeShort || status.nowLocal.time} · ${status.nowLocal.date}<br/>`
    : '';
  return {
    tz,
    earlyFrom,
    earlyTo,
    normalFrom: earlyTo,
    normalTo,
    scheduled,
    req,
    html:
      nowLine +
      `<strong>Early start</strong> (note → admin): ${earlyFrom} – ${earlyTo}<br/>` +
      `<strong>Normal clock-in</strong>: ${earlyTo} – ${normalTo}<br/>` +
      `<strong>Scheduled start</strong>: ${scheduled} · <strong>Required</strong>: ${req}h · ${tz}`,
  };
}

let liveClockHandle = null;

function updateLiveClockPanel() {
  const panel = qs('liveClockPanel');
  if (!panel || !clockStatus) {
    panel?.classList.add('hidden');
    return;
  }
  panel.classList.remove('hidden');
  const tz = scheduleTz(clockStatus);
  const now = new Date();
  const timeEl = qs('liveClockTime');
  const dateEl = qs('liveClockDate');
  const cmpEl = qs('liveClockCompare');
  try {
    if (timeEl) {
      timeEl.textContent = now.toLocaleTimeString('en-US', {
        timeZone: tz,
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit',
        hour12: true,
      });
    }
    if (dateEl) {
      dateEl.textContent =
        now.toLocaleDateString('en-US', {
          timeZone: tz,
          weekday: 'short',
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        }) + ` · ${tz}`;
    }
  } catch {
    if (timeEl) timeEl.textContent = now.toLocaleTimeString();
    if (dateEl) dateEl.textContent = now.toLocaleDateString();
  }

  const w = clockStatus.window;
  const start = w?.scheduledFormatted || '—';
  if (!cmpEl) return;

  if (clockStatus.isLate) {
    cmpEl.className = 'live-clock-compare late';
    cmpEl.innerHTML =
      `⚠ <strong>${clockStatus.lateMinutes} min late</strong><br/>` +
      `Now is past scheduled start <strong>${start}</strong>`;
  } else if (clockStatus.earlyStart?.noteRequired) {
    cmpEl.className = 'live-clock-compare early';
    cmpEl.innerHTML =
      `Early window — <strong>${clockStatus.earlyStart.minutesEarly} min</strong> before <strong>${start}</strong>`;
  } else if (clockStatus.nowLocal?.comparisonLabel) {
    cmpEl.className = 'live-clock-compare';
    cmpEl.textContent = clockStatus.nowLocal.comparisonLabel;
  } else {
    cmpEl.className = 'live-clock-compare';
    cmpEl.textContent = `Scheduled start: ${start}`;
  }
}

function startLiveClock() {
  if (liveClockHandle) clearInterval(liveClockHandle);
  updateLiveClockPanel();
  liveClockHandle = setInterval(updateLiveClockPanel, 1000);
}

function stopLiveClock() {
  if (liveClockHandle) clearInterval(liveClockHandle);
  liveClockHandle = null;
}

function openEarlyNoteModal() {
  if (!clockStatus?.earlyStart?.noteRequired) {
    alert('Early start is not available right now. Check the clock-in times below.');
    return;
  }
  const mins = clockStatus.earlyStart.minutesEarly ?? 0;
  const req = clockStatus.requiredHours ?? 8;
  qs('earlyModalMsg').textContent =
    `You are ${mins} minutes before normal start. Explain why you need to start early (min 20 characters). ` +
    `Your note is saved and sent to admin. Your timer starts now — you must still complete ${req} hours today.`;
  qs('earlyNote').value = '';
  showModal('earlyModal');
}

function updateScheduleInfoPanel() {
  const panel = qs('scheduleInfoPanel');
  const text = qs('scheduleInfoText');
  if (!panel || !text || !clockStatus) return;

  if (clockStatus.hasActiveSession) {
    panel.classList.add('hidden');
    return;
  }

  const desc = describeClockWindows(clockStatus);
  if (!desc) {
    panel.classList.add('hidden');
    return;
  }

  panel.classList.remove('hidden');
  text.innerHTML = desc.html;
}

function updateEarlyStartPanel() {
  const panel = qs('earlyStartPanel');
  const msg = qs('earlyStartMsg');
  const earlyBtn = qs('clockInEarlyBtn');
  if (!panel || !clockStatus?.earlyStart) return;

  if (clockStatus.hasActiveSession || clockStatus.nightShift?.needsChoice || clockStatus.isResume) {
    panel.classList.add('hidden');
    earlyBtn?.classList.add('hidden');
    return;
  }

  const es = clockStatus.earlyStart;
  const desc = describeClockWindows(clockStatus);
  if (es.noteRequired && !clockStatus.isLate) {
    panel.classList.remove('hidden');
    const now = clockStatus.nowLocal?.timeShort || '—';
    msg.innerHTML =
      `Now: <strong>${now}</strong> · Start: <strong>${desc?.scheduled ?? '—'}</strong><br/>` +
      `You are <strong>${es.minutesEarly ?? 0} min</strong> before normal start. ` +
      `Tap below, write your reason — <strong>${desc?.req ?? 8}h</strong> tracker starts immediately.`;
    earlyBtn?.classList.remove('hidden');
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
  } else if (clockStatus.earlyStart?.noteRequired && !clockStatus.nightShift?.needsChoice && !clockStatus.isResume) {
    el.classList.remove('hidden');
    el.classList.remove('complete');
    el.textContent = `If you clock in now: ${req}h required · finish by ${clockStatus.expectedClockOutFormatted ?? '—'}`;
  } else {
    el.classList.add('hidden');
  }
}

function updateWorkDateLabel() {
  const el = qs('workDateLabel');
  if (!el) return;
  if (clockStatus?.workDateLabel) {
    el.textContent = clockStatus.workDateLabel;
  } else {
    el.textContent = formatLocalDate(new Date());
  }
}

function updateClockButtons() {
  const inBtn = qs('clockInBtn');
  const lateBtn = qs('clockInLateBtn');
  if (!inBtn || !clockStatus) return;

  updateLiveClockPanel();
  updateEarlyStartPanel();
  updateHoursDueHint();
  updateScheduleInfoPanel();
  updateWorkDateLabel();

  if (clockStatus.hasActiveSession) {
    inBtn.classList.add('hidden');
    lateBtn?.classList.add('hidden');
    return;
  }

  if (clockStatus.windowClosed && !clockStatus.isResume) {
    inBtn.classList.add('hidden');
    lateBtn?.classList.add('hidden');
    qs('clockInEarlyBtn')?.classList.add('hidden');
    const hint = qs('scheduleHint');
    const desc = describeClockWindows(clockStatus);
    if (hint) {
      hint.innerHTML = desc
        ? `<strong>Clock-in closed right now.</strong> Come back during one of today's windows (${desc.tz}):<br/>` +
          `Early (note → admin): ${desc.earlyFrom} – ${desc.earlyTo} · Normal: ${desc.normalFrom} – ${desc.normalTo}`
        : 'Clock-in window closed for today';
      hint.classList.remove('hidden');
    }
    return;
  }

  if (clockStatus.isResume) {
    inBtn.classList.remove('hidden');
    lateBtn?.classList.add('hidden');
    qs('clockInEarlyBtn')?.classList.add('hidden');
    qs('earlyStartPanel')?.classList.add('hidden');
    inBtn.textContent = 'Clock In (resume today)';
  } else if (clockStatus.nightShift?.needsChoice) {
    inBtn.classList.remove('hidden');
    lateBtn?.classList.add('hidden');
    qs('clockInEarlyBtn')?.classList.add('hidden');
    qs('earlyStartPanel')?.classList.add('hidden');
    inBtn.textContent = 'Clock In';
  } else if (clockStatus.isLate) {
    inBtn.classList.add('hidden');
    lateBtn?.classList.remove('hidden');
    qs('earlyStartPanel')?.classList.add('hidden');
  } else if (clockStatus.earlyStart?.noteRequired) {
    inBtn.classList.remove('hidden');
    lateBtn?.classList.add('hidden');
    inBtn.textContent = 'Clock in (early — note required)';
  } else {
    inBtn.classList.remove('hidden');
    lateBtn?.classList.add('hidden');
    inBtn.textContent = 'Clock In';
  }

  const hint = qs('scheduleHint');
  if (hint && clockStatus.isResume) {
    hint.textContent = 'You already started today — tap Clock In to resume. Your earlier time is kept.';
    hint.classList.remove('hidden');
  } else if (hint && clockStatus.nightShift?.needsChoice) {
    hint.textContent = 'After midnight — tap Clock In and choose which day this work is for.';
    hint.classList.remove('hidden');
  } else if (hint && clockStatus.isLate && !clockStatus.hasActiveSession) {
    hint.textContent = `⚠ You are ${clockStatus.lateMinutes} min late (grace: ${clockStatus.graceMinutes} min)`;
    hint.classList.remove('hidden');
  } else if (hint && clockStatus.earlyStart?.noteRequired && !clockStatus.isLate) {
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
  if (reason.length < 30) return alert('Reason must be at least 30 characters — explain in detail.');
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
  } catch (e) {
    qs('pointsHistory').textContent = e.message || 'Could not load points.';
  }
  try {
    const rules = await apiFetch('/api/points/rules');
    renderPointsRules(rules);
    await blobPut({ [LS.pointRulesHash]: JSON.stringify(rules) });
  } catch {
    const el = qs('pointsRules');
    if (el) el.textContent = 'Could not load rules — check API is online.';
  }
}

function renderPointsRules(rules) {
  const el = qs('pointsRules');
  if (!el || !rules) return;
  const earn = [
    ['On-time clock-in', rules.onTimeClockIn],
    ['Full required hours', rules.fullHours],
    ['Each overtime hour', rules.overtimeHour],
    ['20-day streak bonus', rules.streakBonus],
  ];
  const deduct = [
    ['Unexcused absent', rules.unexcusedAbsent],
    ['Late without note', rules.lateWithoutNote],
    ['Challenge failed', rules.challengeFailed],
    ['Anomaly confirmed', rules.anomalyConfirmed],
  ];
  const custom = (rules.customTasks ?? []).filter((t) => t.active !== false && t.name);
  el.innerHTML =
    earn.map(([l, v]) => `<div class="point-item pos">+${v} — ${l}</div>`).join('') +
    deduct.map(([l, v]) => `<div class="point-item neg">${v} — ${l}</div>`).join('') +
    (custom.length
      ? `<div class="sum-title mt-2">Bonus tasks</div>` +
        custom.map((t) => `<div class="point-item pos">+${t.points} — ${t.name}</div>`).join('')
      : '');
}

async function refreshPointsIfNeeded() {
  if (qs('tabPoints')?.classList.contains('hidden')) return;
  try {
    await loadPointsTab();
  } catch {}
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

function recordDayKey(date) {
  const d = new Date(date);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function dayKey(d) {
  return recordDayKey(d);
}

async function loadRecordTab() {
  if (!meProfile?.id) return;

  const monthStr = `${calYear}-${String(calMonth + 1).padStart(2, '0')}`;
  const from = new Date(Date.UTC(calYear, calMonth, 1)).toISOString();
  const to = new Date(Date.UTC(calYear, calMonth + 1, 1)).toISOString();

  try {
    monthlyReport = await apiFetch(`/api/attendance/monthly/${meProfile.id}?month=${monthStr}`);
    calRecords = monthlyReport.records ?? [];
  } catch (e) {
    monthlyReport = null;
    try {
      calRecords = await apiFetch(`/api/attendance/history/${meProfile.id}?from=${from}&to=${to}&limit=35`);
    } catch {
      calRecords = [];
      const stats = qs('calStats');
      if (stats) stats.textContent = e.message || 'Could not load records — API may be down.';
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
  const modal = qs('dayDetailModal');
  const body = qs('dayDetailBody');
  if (!modal || !body) return;

  if (!rec || (!rec.status && !rec.clockInTime)) {
    const d = formatLocalDate(rec?.date || new Date());
    body.innerHTML = `<h3>${d}</h3><p>No attendance recorded for this day.</p><p class="hint hint-small">Times use ${localTz}</p>`;
    showModal('dayDetailModal');
    return;
  }

  const d = formatLocalDate(rec.date);
  const inT = rec.clockInTime ? formatLocalTime(rec.clockInTime) : '—';
  const outT = rec.clockOutTime ? formatLocalTime(rec.clockOutTime) : '—';

  body.innerHTML = `
    <h3>${d}</h3>
    <p><strong>Status:</strong> ${(rec.status || '—').replace(/_/g, ' ')}</p>
    <p><strong>Clock in:</strong> ${inT}${rec.lateMinutes > 0 ? ` (+${rec.lateMinutes}m late)` : ''}${rec.earlyMinutes > 0 ? ` (${rec.earlyMinutes}m early)` : ''}</p>
    <p><strong>Clock out:</strong> ${outT}${rec.autoClockOut ? ' <em>(auto 11:59 PM)</em>' : ''}</p>
    <p><strong>Day hours:</strong> ${(rec.totalHoursWorked ?? 0).toFixed(1)}h / ${rec.requiredHours ?? 8}h ${rec.isComplete ? '✓ complete' : rec.totalHoursWorked > 0 ? '(incomplete)' : ''}</p>
    ${(rec.overtimeHours ?? 0) > 0 ? `<p><strong>Overtime:</strong> +${rec.overtimeHours.toFixed(1)}h (beyond required)</p>` : ''}
    <p class="hint hint-small">Each calendar day closes at 11:59 PM. After midnight, clock in again for the new day.</p>
    <p class="hint hint-small">Times shown in ${localTz}</p>
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

  const recordMap = new Map(calRecords.map((r) => [recordDayKey(r.date), r]));

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
    html += `<div class="${cls.join(' ')}"${tip} data-day-key="${key}" role="button" tabindex="0">${d}</div>`;
  }
  grid.innerHTML = html;

  grid.querySelectorAll('[data-day-key]').forEach((cell) => {
    const open = () => {
      const key = cell.dataset.dayKey;
      showDayDetail(recordMap.get(key) || { date: `${key}T00:00:00.000Z` });
    };
    cell.addEventListener('click', open);
    cell.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        open();
      }
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

function capLiveMs(session, liveMs) {
  if (!session?.clockIn) return liveMs;
  const wallMs = Math.max(0, Date.now() - new Date(session.clockIn).getTime());
  return Math.min(liveMs, wallMs);
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
    hint.textContent = 'Active time paused — use mouse/keyboard on this PC';
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
  hint.textContent = 'Auto-pause after 15 min with no activity on this computer';
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
  liveActiveBase = capLiveMs(session, liveMs);
  liveActiveAnchor = frozen ? 0 : Date.now();

  const tick = () => {
    const extra = frozen ? 0 : Date.now() - liveActiveAnchor;
    const total = capLiveMs(session, liveActiveBase + extra);
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
  pollHandle = setInterval(() => refreshEverything().catch(() => {}), 45_000);
}

async function syncLiveFromServer(activePayload) {
  const session = activePayload?.session ?? activePayload;
  let liveMs = activePayload?.liveActiveMs ?? session?.totalActiveMs ?? 0;
  if (session?.id) liveMs = capLiveMs(session, liveMs);
  if (session?.id) {
    const patch = {
      [LS.liveActiveMs]: liveMs,
      [LS.liveAnchorAt]: Date.now(),
      [LS.sessionStatus]: session.status,
    };
    if (session.clockIn) patch[LS.clockInAt] = session.clockIn;
    await blobPut(patch);
  }
  return { session, liveMs };
}

function updateSessionTimes(session) {
  const el = qs('sessionTimes');
  if (!el) return;
  if (!session?.clockIn) {
    el.classList.add('hidden');
    el.textContent = '';
    return;
  }
  el.classList.remove('hidden');
  const inT = formatLocalTime(session.clockIn, true);
  const outT = session.clockOut ? formatLocalTime(session.clockOut, true) : 'Still clocked in';
  el.innerHTML =
    `<span><strong>Clock in:</strong> ${inT}</span> · ` +
    `<span><strong>Clock out:</strong> ${outT}</span><br/>` +
    `<span class="muted-inline">Times in your timezone (${localTz})</span>`;
}

async function refreshEverything() {
  const token = await blobGet(LS.access);
  if (!token) {
    qs('authView').classList.remove('hidden');
    qs('appView').classList.add('hidden');
    qs('apiBase').value = (await blobGet(LS.apiBase)) || 'https://api.liftbrandfulfillment.com';
    stopTicker();
    stopPoll();
    stopLiveClock();
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
    startLiveClock();
    if (
      clockStatus?.dayClosed &&
      clockStatus?.autoClockOut &&
      !clockStatus?.hasActiveSession
    ) {
      const prev = await blobGet('pulsetrack_eod_toast_date');
      if (prev !== clockStatus.workDate) {
        await blobPut({ pulsetrack_eod_toast_date: clockStatus.workDate });
        const h = clockStatus.hoursWorked ?? 0;
        const ot = clockStatus.overtimeHours ?? 0;
        toast(
          `Day closed at 11:59 PM — you worked ${h.toFixed(1)}h` +
            (ot > 0 ? ` (+${ot.toFixed(1)}h overtime)` : '') +
            '. Clock in again when you start the next day.',
        );
      }
    }
  } catch {
    stopLiveClock();
  }

  const { session: serverSession, liveMs } = await syncLiveFromServer(activePayload);

  if (serverSession?.id && serverSession.clockOut === null) {
    await blobPut({
      [LS.sessionId]: serverSession.id,
      [LS.paused]: serverSession.status === 'PAUSED_MANUAL',
      [LS.sessionStatus]: serverSession.status,
    });
    hydrateControls(serverSession);
    updateSessionTimes(serverSession);
    setTimerHint(serverSession);
    startTicker(serverSession, liveMs);
    updateProgress(liveMs);
    startPoll();
  } else {
    const hadSession = await blobGet(LS.sessionId);
    await logoutSessionLocal();
    if (hadSession && clockStatus?.autoClockOut) {
      toast('Session ended — day closed at 11:59 PM. Clock in again for the new day.');
    }
    hydrateControlsClosed();
    updateSessionTimes(null);
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
      `<span class="muted-inline">${sum.sessions} session(s) today · tracked in hours/minutes · ${localTz}</span>`;
    qs('quote').textContent = motivational[(sum?.sessions ?? 0) % motivational.length];
  } catch (e) {
    const msg = e?.message || '';
    if (/too many/i.test(msg)) {
      qs('todaySummary').textContent = 'Server busy — wait 1 minute. Your clock-in is still saved.';
    } else {
      qs('todaySummary').textContent = 'Could not load today — check API URL or wait and reopen';
    }
  }

  qs('apiBase').value = (await blobGet(LS.apiBase)) || 'https://api.liftbrandfulfillment.com';

  await refreshPointsIfNeeded();
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
  qs('clockInEarlyBtn')?.addEventListener('click', () => openEarlyNoteModal());
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
  qs('shiftCancelBtn')?.addEventListener('click', () => {
    pendingDayChoice = null;
    hideModal('shiftModal');
  });
  qs('shiftPrevDayBtn')?.addEventListener('click', () => {
    pendingDayChoice = 'PREVIOUS_DAY';
    hideModal('shiftModal');
    qs('earlyNote').value = '';
    qs('earlyModalMsg').textContent =
      'Add a short note (min 20 characters): you are continuing the previous day\u2019s work after midnight.';
    showModal('earlyModal');
  });
  qs('shiftNewDayBtn')?.addEventListener('click', () => {
    pendingDayChoice = 'TODAY';
    hideModal('shiftModal');
    qs('earlyNote').value = '';
    qs('earlyModalMsg').textContent =
      'Add a short note (min 20 characters): you are starting the new day after midnight.';
    showModal('earlyModal');
  });
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
    const choice = pendingDayChoice;
    pendingDayChoice = null;
    clockInNow(null, note, choice).catch((e) => alert(e.message));
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
  const savedEmail = await blobGet(LS.savedEmail);
  if (savedEmail && qs('email')) qs('email').value = savedEmail;
  wireAuth();
  wireWork();
  await refreshEverything();
})();
