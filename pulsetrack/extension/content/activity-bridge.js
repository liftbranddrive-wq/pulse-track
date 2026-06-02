/**
 * Anonymous activity pulses — mouse, keyboard, scroll, click (no key content).
 */

let throttleUntil = 0;

function ping() {
  const now = Date.now();
  if (now < throttleUntil) return;
  throttleUntil = now + 1500;
  chrome.runtime.sendMessage({ type: 'ACTIVITY' }).catch(() => {});
}

const events = ['mousemove', 'mousedown', 'keydown', 'scroll', 'wheel', 'touchstart', 'click'];

for (const ev of events) {
  document.addEventListener(ev, ping, { passive: true, capture: true });
}

window.addEventListener('focus', ping, { passive: true });

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type !== 'TOAST') return;

  let el = document.getElementById('pulsetrack-toast-root');
  if (!el) {
    el = document.createElement('div');
    el.id = 'pulsetrack-toast-root';
    Object.assign(el.style, {
      position: 'fixed',
      right: '16px',
      bottom: '16px',
      zIndex: '2147483647',
      maxWidth: '340px',
    });
    document.documentElement.appendChild(el);
  }

  const t = document.createElement('div');
  t.textContent = msg.text;
  Object.assign(t.style, {
    marginTop: '8px',
    padding: '12px 14px',
    borderRadius: '12px',
    background: 'linear-gradient(135deg, #3d2b1f 0%, #5c4033 100%)',
    color: '#faf7f2',
    fontFamily: 'Segoe UI, system-ui, sans-serif',
    fontSize: '13px',
    lineHeight: '1.4',
    boxShadow: '0 12px 30px rgba(61,43,31,.45)',
    border: '1px solid rgba(245,240,232,.25)',
  });

  el.appendChild(t);
  setTimeout(() => t.remove(), 5500);
});
