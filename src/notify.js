// Push-/Erinnerungs-Anbindung: Permission, Web-Push-Abo (optionaler Server),
// Server-Sync und lokale Benachrichtigungen. Reine Berechnung liegt in remind.js.
import { state, save } from './main.js';
import { toast } from './ui.js';
import { NOTIF_DEFAULTS, ensureNotifDefaults, computeReminders } from './remind.js';

export { NOTIF_DEFAULTS, ensureNotifDefaults, computeReminders } from './remind.js';

// ---- Web-Push-Abo & Server-Sync -------------------------------------------
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

let currentSub = null;

async function getRegistration() {
  if (!('serviceWorker' in navigator)) return null;
  try { return await navigator.serviceWorker.ready; } catch { return null; }
}

async function subscribePush() {
  const n = state.notifications;
  if (!n.server || !n.server.url || !n.server.vapidPublicKey) return false;
  const reg = await getRegistration();
  if (!reg || !reg.pushManager) return false;
  try {
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(n.server.vapidPublicKey) });
    currentSub = sub;
    n.push.subscribed = true;
    return true;
  } catch (e) {
    console.warn('push subscribe failed', e);
    n.push.subscribed = false;
    return false;
  }
}

let syncTimer = null;
export function requestSync() {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => { syncReminders().catch(() => {}); }, 1500);
}

export async function syncReminders() {
  const n = state.notifications;
  if (!n || !n.enabled) return;
  const reminders = computeReminders(state).filter((r) => new Date(r.at).getTime() > Date.now());
  const url = n.server && n.server.url;
  if (!url) return; // ohne Server nur lokale Erinnerungen
  if (!currentSub) { if (!(await subscribePush())) return; }
  try {
    await fetch(url.replace(/\/$/, '') + '/subscribe', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ subscription: currentSub, reminders, tz: Intl.DateTimeFormat().resolvedOptions().timeZone })
    });
  } catch (e) { console.warn('sync failed', e); }
}

// ---- Lokale Benachrichtigungen (Fallback / Desktop) -----------------------
async function showLocal(r) {
  const reg = await getRegistration();
  if (reg && reg.showNotification) {
    try { await reg.showNotification(r.title, { body: r.body, tag: r.tag, icon: '/icon.svg', badge: '/icon.svg', data: { url: '/' } }); return; } catch {}
  }
  try { new Notification(r.title, { body: r.body, tag: r.tag, icon: '/icon.svg' }); } catch {}
}

export function checkLocalReminders() {
  const n = state.notifications;
  if (!n || !n.enabled) return;
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  const now = Date.now();
  const due = computeReminders(state).filter((r) => {
    const t = new Date(r.at).getTime();
    return t <= now && t >= now - 7 * 864e5 && !n._shown[r.tag];
  });
  if (!due.length) return;
  for (const r of due) { n._shown[r.tag] = now; showLocal(r); }
  // _shown aufräumen (älter als 90 Tage)
  for (const k of Object.keys(n._shown)) if (now - n._shown[k] > 90 * 864e5) delete n._shown[k];
  save();
}

// ---- Öffentliche Aktionen (Einstellungen) ---------------------------------
export async function toggleNotifications() {
  const n = ensureNotifDefaults(state);
  if (n.enabled) { await disableNotifications(); return; }
  if (typeof Notification === 'undefined') { toast('Benachrichtigungen werden hier nicht unterstützt', 'err'); return; }
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') { toast('Keine Erlaubnis für Benachrichtigungen', 'err'); window.renderMore && window.renderMore(); return; }
  n.enabled = true;
  save();
  await subscribePush();
  await syncReminders();
  checkLocalReminders();
  window.renderMore && window.renderMore();
  toast(n.server && n.server.url ? 'Erinnerungen aktiv (Push)' : 'Erinnerungen aktiv (lokal)', 'ok');
}

export async function disableNotifications() {
  const n = state.notifications;
  n.enabled = false;
  n.push.subscribed = false;
  save();
  try {
    const reg = await getRegistration();
    const sub = reg && reg.pushManager && await reg.pushManager.getSubscription();
    if (sub) {
      if (n.server && n.server.url) {
        try { await fetch(n.server.url.replace(/\/$/, '') + '/unsubscribe', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ endpoint: sub.endpoint }) }); } catch {}
      }
      await sub.unsubscribe();
    }
  } catch {}
  currentSub = null;
  window.renderMore && window.renderMore();
  toast('Erinnerungen deaktiviert');
}

// Setzt eine Einstellung (dotted path) und synchronisiert.
export function setNotif(path, value) {
  const n = ensureNotifDefaults(state);
  const parts = path.split('.');
  let obj = n;
  for (let i = 0; i < parts.length - 1; i++) obj = obj[parts[i]] = obj[parts[i]] || {};
  const key = parts[parts.length - 1];
  if (['exportDay', 'overdueCheckDay'].includes(key)) value = Math.max(1, Math.min(28, parseInt(value, 10) || 1));
  else if (parts[0] === 'leadDays') value = Math.max(0, Math.min(60, parseInt(value, 10) || 0));
  else if (key === 'overdueEnabled') value = !!value;
  obj[key] = value;
  save();
  if (parts[0] === 'server') { currentSub = null; subscribePush().then(() => requestSync()); }
  else requestSync();
}

export async function sendTestNotification() {
  if (typeof Notification === 'undefined') { toast('Nicht unterstützt', 'err'); return; }
  if (Notification.permission !== 'granted') { const p = await Notification.requestPermission(); if (p !== 'granted') { toast('Keine Erlaubnis', 'err'); return; } }
  await showLocal({ title: 'Finanzguru – Test', body: 'So sieht eine Erinnerung aus 👍', tag: 'test-' + Date.now() });
  toast('Testbenachrichtigung gesendet', 'ok');
}

// Echter Test-Push über den Worker nach delaySec Sekunden – funktioniert auch bei
// geschlossener App (Browser-Push-Dienst stellt zu). Erfordert konfigurierten Server.
export async function sendPushTest(delaySec) {
  const n = state.notifications;
  const url = n && n.server && n.server.url;
  if (!url) { toast('Erst Push-Server unter „Erweitert" konfigurieren', 'err'); return; }
  if (typeof Notification === 'undefined') { toast('Push hier nicht unterstützt', 'err'); return; }
  if (Notification.permission !== 'granted') {
    const p = await Notification.requestPermission();
    if (p !== 'granted') { toast('Keine Erlaubnis für Benachrichtigungen', 'err'); return; }
  }
  if (!currentSub) { if (!(await subscribePush())) { toast('Push-Abo fehlgeschlagen (VAPID-Key korrekt?)', 'err'); return; } }
  const sec = Math.max(3, Math.min(30, parseInt(delaySec, 10) || 15));
  try {
    const res = await fetch(url.replace(/\/$/, '') + '/test', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ subscription: currentSub, delaySec: sec })
    });
    if (!res.ok) throw new Error('http ' + res.status);
    toast(`Test-Push in ${sec}s geplant – App jetzt schließen 📲`, 'ok');
  } catch (e) {
    toast('Test-Push fehlgeschlagen – Server erreichbar?', 'err');
  }
}

// Beim App-Start: Abo sicherstellen, Fälliges lokal zeigen, Server-Sync anstoßen.
export async function initNotify() {
  ensureNotifDefaults(state);
  if (!state.notifications.enabled) return;
  try {
    const reg = await getRegistration();
    if (reg && reg.pushManager) { currentSub = await reg.pushManager.getSubscription(); }
    if (!currentSub) await subscribePush();
  } catch {}
  checkLocalReminders();
  requestSync();
  // Bei Rückkehr in die App erneut prüfen.
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { checkLocalReminders(); requestSync(); } });
}

Object.assign(window, { toggleNotifications, disableNotifications, setNotif, sendTestNotification, sendPushTest });
