/* global chrome */

const ALARM = 'pulsetrack-inactivity';
const HEARTBEAT_ALARM = 'pulsetrack-heartbeat';
const TOKEN_REFRESH_ALARM = 'pulsetrack-token-refresh';

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
  liveActiveMs: 'pulsetrack_live_active_ms',
  liveAnchorAt: 'pulsetrack_live_anchor_at',
  sessionStatus: 'pulsetrack_session_status',
  clockInAt: 'pulsetrack_clock_in_at',
};

/** L1 nudge → L2 idle segment → L3 ghost (stops active billing). */
const DEFAULT_THRESHOLDS = { l1: 5, l2: 10, l3: 15 };

/** OS idle threshold (seconds). Chrome minimum is 15 — detects keyboard/mouse anywhere on the PC. */
const SYSTEM_IDLE_SEC = 15;

async function get(key) {
  const o = await chrome.storage.local.get(key);
  return o[key];
}

async function put(obj) {
  await chrome.storage.local.set(obj);
}

async function ensureThresholds() {
  const o = await chrome.storage.local.get([LS.l1Min, LS.l2Min, LS.l3Min]);
  const patch = {};
  if (!o[LS.l1Min]) patch[LS.l1Min] = DEFAULT_THRESHOLDS.l1;
  if (!o[LS.l2Min]) patch[LS.l2Min] = DEFAULT_THRESHOLDS.l2;
  if (!o[LS.l3Min] || Number(o[LS.l3Min]) > 15) patch[LS.l3Min] = DEFAULT_THRESHOLDS.l3;
  if (Object.keys(patch).length) await put(patch);
}

function querySystemIdleState() {
  if (!chrome.idle?.queryState) return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      chrome.idle.queryState(SYSTEM_IDLE_SEC, (state) => resolve(state ?? null));
    } catch {
      resolve(null);
    }
  });
}

/** Whole-computer activity: any keyboard/mouse on the PC (all Chrome profiles, apps, browsers). */
async function syncSystemActivity() {
  const state = await querySystemIdleState();
  if (state === 'active') await markUserActive();
}

async function isTrackingFrozen() {
  const paused = await get(LS.paused);
  if (paused) return true;
  const status = await get(LS.sessionStatus);
  return isFrozenStatus(status);
}

async function markUserActive() {
  const sessionId = await get(LS.sessionId);
  if (!sessionId) return;

  const status = await get(LS.sessionStatus);

  if (status === 'IDLE' || status === 'GHOST') {
    await syncFromApi('/api/sessions/state/resume-focus', {
      method: 'POST',
      body: JSON.stringify({ sessionId }),
    });
    await put({
      [LS.sessionStatus]: 'WORKING',
      [LS.paused]: false,
      [LS.l1Sent]: false,
      [LS.l2Sent]: false,
      [LS.l3Reached]: false,
      [LS.lastActivity]: Date.now(),
    });
    await runHeartbeat();
    return;
  }

  if (await isTrackingFrozen()) return;

  await put({
    [LS.lastActivity]: Date.now(),
    [LS.l1Sent]: false,
    [LS.l2Sent]: false,
    [LS.l3Reached]: false,
  });
}

async function bumpActivityFromBridge() {
  await markUserActive();
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'ACTIVITY') {
    bumpActivityFromBridge();
    sendResponse({ ok: true });
  }
});

async function thresholds() {
  await ensureThresholds();
  const o = await chrome.storage.local.get([LS.l1Min, LS.l2Min, LS.l3Min]);
  return {
    l1Ms: Number(o[LS.l1Min] ?? DEFAULT_THRESHOLDS.l1) * 60_000,
    l2Ms: Number(o[LS.l2Min] ?? DEFAULT_THRESHOLDS.l2) * 60_000,
    l3Ms: Number(o[LS.l3Min] ?? DEFAULT_THRESHOLDS.l3) * 60_000,
  };
}

async function refreshAccessToken() {
  const refresh = await get(LS.refresh);
  if (!refresh) return false;
  const base = (
    ((await chrome.storage.local.get([LS.apiBase]))[LS.apiBase] || 'https://api.liftbrandfulfillment.com') ??
    'https://api.liftbrandfulfillment.com'
  ).replace(/\/$/, '');
  try {
    const res = await fetch(`${base}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ refreshToken: refresh }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.accessToken) return false;
    await put({
      [LS.access]: data.accessToken,
      [LS.refresh]: data.refreshToken,
    });
    return true;
  } catch {
    return false;
  }
}

async function syncFromApi(path, opts, retried = false) {
  const base = (
    ((await chrome.storage.local.get([LS.apiBase]))[LS.apiBase] || 'https://api.liftbrandfulfillment.com') ??
    'https://api.liftbrandfulfillment.com'
  ).replace(/\/$/, '');

  const token = await get(LS.access);
  if (!token) return null;

  try {
    const res = await fetch(`${base}${path}`, {
      ...opts,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...(opts?.headers || {}),
      },
    });
    const text = await res.text();
    let data;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    if (res.status === 401 && !retried) {
      const ok = await refreshAccessToken();
      if (ok) return syncFromApi(path, opts, true);
    }
    if (!res.ok) throw new Error(data?.error || text || res.statusText);
    return data;
  } catch {
    return null;
  }
}

async function persistSessionSnapshot(payload) {
  const session = payload?.session ?? payload;
  if (!session?.id) return;
  const live =
    typeof payload?.liveActiveMs === 'number'
      ? payload.liveActiveMs
      : session.totalActiveMs ?? 0;
  const patch = {
    [LS.liveActiveMs]: live,
    [LS.liveAnchorAt]: Date.now(),
    [LS.sessionStatus]: session.status,
  };
  if (session.clockIn) patch[LS.clockInAt] = session.clockIn;
  await put(patch);
}

function isFrozenStatus(status) {
  return status === 'GHOST' || status === 'IDLE' || status === 'PAUSED_MANUAL' || status === 'ON_BREAK';
}

async function computeDisplayMs() {
  const sessionId = await get(LS.sessionId);
  const status = await get(LS.sessionStatus);
  const clockInAt = await get(LS.clockInAt);
  const base = Number((await get(LS.liveActiveMs)) || 0);
  const anchor = Number((await get(LS.liveAnchorAt)) || 0);
  let ms = base;
  if (!isFrozenStatus(status) && anchor) ms = base + Math.max(0, Date.now() - anchor);
  if (clockInAt) {
    const wallMs = Math.max(0, Date.now() - new Date(clockInAt).getTime());
    ms = Math.min(ms, wallMs);
  }
  return ms;
}

function formatClock(ms) {
  const sec = Math.max(0, Math.floor(ms / 1000));
  const hh = Math.floor(sec / 3600);
  const mm = Math.floor((sec % 3600) / 60);
  const ss = sec % 60;
  return [hh, mm, ss].map((n) => String(n).padStart(2, '0')).join(':');
}

function formatBadgeText(ms, status) {
  if (status === 'PAUSED_MANUAL') return 'PAUS';
  if (status === 'ON_BREAK') return 'BRK';
  if (status === 'GHOST') return 'GHST';
  if (status === 'IDLE') return 'IDLE';
  const sec = Math.max(0, Math.floor(ms / 1000));
  const hh = Math.floor(sec / 3600);
  const mm = Math.floor((sec % 3600) / 60);
  const ss = sec % 60;
  if (hh > 0) return `${hh}:${String(mm).padStart(2, '0')}`;
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

function statusLabel(status) {
  if (status === 'PAUSED_MANUAL') return 'Paused';
  if (status === 'ON_BREAK') return 'On break';
  if (status === 'GHOST') return 'Ghost — paused';
  if (status === 'IDLE') return 'Idle — paused';
  return 'Working';
}

async function runHeartbeat() {
  const sessionId = await get(LS.sessionId);
  if (!sessionId) return;

  const data = await syncFromApi('/api/sessions/heartbeat', {
    method: 'POST',
    body: JSON.stringify({ sessionId }),
  });
  if (data) await persistSessionSnapshot(data);
  refreshToolbarBadge();
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === HEARTBEAT_ALARM) {
    await syncSystemActivity();
    await runHeartbeat();
    return;
  }
  if (alarm.name === TOKEN_REFRESH_ALARM) {
    const refresh = await get(LS.refresh);
    if (refresh) await refreshAccessToken();
    return;
  }
  if (alarm.name !== ALARM) return;

  const sessionId = await get(LS.sessionId);
  if (!sessionId || (await isTrackingFrozen())) return;

  await syncSystemActivity();

  const lastRaw = await get(LS.lastActivity);
  const started = await get(LS.clockStarted);

  const last =
    typeof lastRaw === 'number' && lastRaw > 0
      ? lastRaw
      : typeof started === 'number'
        ? started
        : 0;

  if (!last) return;

  const { l1Ms, l2Ms, l3Ms } = await thresholds();
  const idleFor = Date.now() - last;

  const hitL3 = idleFor >= l3Ms && !(await get(LS.l3Reached));
  const hitL2 = idleFor >= l2Ms && !(await get(LS.l2Sent));
  const hitL1 = idleFor >= l1Ms && !(await get(LS.l1Sent));

  try {
    if (hitL3) {
      await syncFromApi('/api/sessions/reminder', {
        method: 'POST',
        body: JSON.stringify({ sessionId, level: 'L3' }),
      });
      await syncFromApi('/api/sessions/state/ghost', {
        method: 'POST',
        body: JSON.stringify({ sessionId }),
      });
      await put({
        [LS.l3Reached]: true,
        [LS.l1Sent]: true,
        [LS.l2Sent]: true,
        [LS.sessionStatus]: 'GHOST',
      });
      await runHeartbeat();

      chrome.notifications.create('pulsetrack-l3', {
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: 'Liftbrand PulseTrack',
        message: 'No computer activity for 15 min — timer paused. Ghost time is recording.',
      });
      toastPage('Timer paused: no keyboard/mouse on this computer for 15 minutes. Tap Resume focus when you return.');
      refreshToolbarBadge();
      return;
    }

    if (hitL2) {
      await syncFromApi('/api/sessions/reminder', {
        method: 'POST',
        body: JSON.stringify({ sessionId, level: 'L2' }),
      });
      await put({ [LS.l2Sent]: true, [LS.l1Sent]: true });
      chrome.notifications.create('pulsetrack-l2', {
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: 'Still there?',
        message: 'No computer activity for 10 min — timer pauses at 15 min without input.',
      });
      toastPage('Still no activity on this computer — move mouse or keyboard before 15 min.');
      return;
    }

    if (hitL1) {
      await syncFromApi('/api/sessions/reminder', {
        method: 'POST',
        body: JSON.stringify({ sessionId, level: 'L1' }),
      });
      await put({ [LS.l1Sent]: true });
      chrome.notifications.create('pulsetrack-l1', {
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: 'Quick check-in',
        message: 'Still working? Use mouse or keyboard anywhere on this PC to keep tracking.',
      });
      toastPage('Gentle nudge — use this computer to keep active time running.');
      return;
    }
  } catch {
    /* offline */
  }
});

async function toastPage(text) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;
    chrome.tabs.sendMessage(tab.id, { type: 'TOAST', text });
  } catch {}
}

chrome.runtime.onStartup.addListener(() => reschedule());
chrome.runtime.onInstalled.addListener(() => {
  put({
    [LS.l1Min]: DEFAULT_THRESHOLDS.l1,
    [LS.l2Min]: DEFAULT_THRESHOLDS.l2,
    [LS.l3Min]: DEFAULT_THRESHOLDS.l3,
  });
  reschedule();
});

async function reschedule() {
  await chrome.alarms.clear(ALARM);
  await chrome.alarms.clear(HEARTBEAT_ALARM);
  await chrome.alarms.create(ALARM, { periodInMinutes: 1 });
  const refresh = await get(LS.refresh);
  if (refresh) {
    await chrome.alarms.clear(TOKEN_REFRESH_ALARM);
    await chrome.alarms.create(TOKEN_REFRESH_ALARM, { periodInMinutes: 10 });
  }
  const sessionId = await get(LS.sessionId);
  if (sessionId) {
    await chrome.alarms.create(HEARTBEAT_ALARM, { periodInMinutes: 2 });
  }
}

chrome.storage.onChanged.addListener((chg, area) => {
  if (area !== 'local') return;
  if (
    LS.sessionId in chg ||
    LS.paused in chg ||
    LS.l1Min in chg ||
    LS.l2Min in chg ||
    LS.l3Min in chg ||
    LS.access in chg ||
    LS.refresh in chg ||
    LS.clockStarted in chg ||
    LS.liveActiveMs in chg ||
    LS.liveAnchorAt in chg ||
    LS.sessionStatus in chg ||
    LS.clockInAt in chg
  ) {
    reschedule();
    refreshToolbarBadge();
  }
});

async function refreshToolbarBadge() {
  const sessionId = await get(LS.sessionId);
  const paused = await get(LS.paused);
  const status = await get(LS.sessionStatus);
  const liveMs = await computeDisplayMs();

  if (!sessionId) {
    chrome.action.setBadgeText({ text: '' });
    chrome.action.setTitle({ title: 'Liftbrand PulseTrack — signed out' });
    chrome.action.setBadgeBackgroundColor({ color: '#5c4033' });
    return;
  }

  if (paused || status === 'PAUSED_MANUAL') {
    chrome.action.setBadgeText({ text: 'PAUS' });
    chrome.action.setBadgeBackgroundColor({ color: '#64748b' });
    chrome.action.setTitle({ title: `${formatClock(liveMs)} — Paused manually` });
    return;
  }

  const text = formatBadgeText(liveMs, status);
  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({
    color:
      status === 'GHOST' ? '#b45309' :
      status === 'IDLE' ? '#d97706' :
      status === 'ON_BREAK' ? '#2563eb' :
      '#5c4033',
  });
  chrome.action.setTitle({
    title: `${formatClock(liveMs)} — ${statusLabel(status)} | Liftbrand PulseTrack`,
  });
}

if (chrome.idle?.setDetectionInterval) {
  chrome.idle.setDetectionInterval(SYSTEM_IDLE_SEC);
  chrome.idle.onStateChanged.addListener(async (state) => {
    if (state === 'active') {
      await markUserActive();
      return;
    }
    if (state === 'idle' || state === 'locked') {
      const sessionId = await get(LS.sessionId);
      if (sessionId) await runHeartbeat();
    }
  });
}

setInterval(refreshToolbarBadge, 1000);
setInterval(async () => {
  const sessionId = await get(LS.sessionId);
  if (sessionId && !(await isTrackingFrozen())) await syncSystemActivity();
}, 30_000);
refreshToolbarBadge();
reschedule();
