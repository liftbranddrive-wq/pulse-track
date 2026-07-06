/* global chrome */

export async function getDeviceFingerprint() {
  const stored = await chrome.storage.local.get('pulsetrack_device_fp');
  if (stored.pulsetrack_device_fp) return stored.pulsetrack_device_fp;

  const ua = navigator.userAgent;
  const screenRes = `${screen.width}x${screen.height}x${screen.colorDepth}`;
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const platform = navigator.platform;
  const lang = navigator.language;

  let canvasHash = 'na';
  try {
    const c = document.createElement('canvas');
    c.width = 200;
    c.height = 50;
    const ctx = c.getContext('2d');
    ctx.textBaseline = 'top';
    ctx.font = '14px Arial';
    ctx.fillStyle = '#f60';
    ctx.fillRect(0, 0, 200, 50);
    ctx.fillStyle = '#069';
    ctx.fillText('PulseTrack FP', 2, 15);
    const data = c.toDataURL();
    canvasHash = String(hashCode(data));
  } catch {
    canvasHash = 'blocked';
  }

  const raw = [ua, screenRes, tz, platform, lang, canvasHash].join('|');
  const fp = `pt_${hashCode(raw)}`;

  await chrome.storage.local.set({ pulsetrack_device_fp: fp });
  return fp;
}

function hashCode(str) {
  let h = 0;
  for (let i = 0; i < str.length; i += 1) {
    h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(16);
}
