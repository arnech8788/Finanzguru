// Reine Reminder-Berechnung (kein DOM, keine Seiteneffekte) – testbar.
import { monthKey, monthIndex, shiftMonth } from './money.js';
import { schedulePeriod, governingDueMonth, expectedForMonth, monthlyAmount } from './data/schedules.js';

const RHYTHM_WORD = { quarterly: 'vierteljährliche', yearly: 'jährliche', bimonthly: 'zweimonatliche' };

export const NOTIF_DEFAULTS = {
  enabled: false,
  exportDay: 5,
  time: '09:00',
  overdueEnabled: true,
  overdueCheckDay: 8,
  leadDays: { quarterly: 7, yearly: 7, bimonthly: 7 },
  server: { url: '', vapidPublicKey: '' },
  push: { subscribed: false },
  _shown: {}
};

export function ensureNotifDefaults(s) {
  const n = s.notifications && typeof s.notifications === 'object' ? s.notifications : {};
  s.notifications = {
    ...NOTIF_DEFAULTS, ...n,
    leadDays: { ...NOTIF_DEFAULTS.leadDays, ...(n.leadDays || {}) },
    server: { ...NOTIF_DEFAULTS.server, ...(n.server || {}) },
    push: { ...NOTIF_DEFAULTS.push, ...(n.push || {}) },
    _shown: n._shown && typeof n._shown === 'object' ? n._shown : {}
  };
  return s.notifications;
}

function daysInMonth(y, m) { return new Date(y, m, 0).getDate(); }
function atDate(ym, day, hh, mm) {
  const [y, mo] = ym.split('-').map(Number);
  const d = Math.min(day || 1, daysInMonth(y, mo));
  return new Date(y, mo - 1, d, hh, mm, 0, 0);
}
// Monatlich offen? (ohne ledger.js – liest direkt aus s.ledger)
function hasOpenMonthly(s, ym) {
  return (s.people || []).some((p) => {
    if (p.schedule === 'prepaid') return false; // Guthaben-Personen separat behandeln
    if (schedulePeriod(p.schedule) !== 1) return false;
    const exp = expectedForMonth(p, ym);
    if (!(exp > 0)) return false;
    const rec = ((s.ledger && s.ledger[p.id] && s.ledger[p.id][ym]) || {}).received || 0;
    return rec + 0.01 < exp;
  });
}

// Liste der Erinnerungen im Fenster [now-35d, now+horizon].
export function computeReminders(s, now = new Date(), horizonDays = 120) {
  const n = ensureNotifDefaults(s);
  const out = [];
  if (!n.enabled) return out;
  const startMs = now.getTime() - 35 * 864e5;
  const endMs = now.getTime() + horizonDays * 864e5;
  const [hh, mm] = String(n.time || '09:00').split(':').map(Number);
  const within = (d) => d.getTime() >= startMs && d.getTime() <= endMs;

  let m = monthKey(new Date(startMs));
  const endMonth = monthKey(new Date(endMs));
  const nowMonth = monthKey(now);
  while (monthIndex(m) <= monthIndex(endMonth)) {
    const eAt = atDate(m, n.exportDay || 5, hh, mm);
    if (within(eAt)) out.push({ at: eAt.toISOString(), type: 'export', title: 'Finanzguru', body: 'Zeit für den DKB-Export – lade ihn in der App hoch.', tag: `exp-${m}` });
    if (n.overdueEnabled !== false) {
      const include = monthIndex(m) > monthIndex(nowMonth) || hasOpenMonthly(s, m);
      if (include) {
        const oAt = atDate(m, n.overdueCheckDay || 8, hh, mm);
        if (within(oAt)) out.push({ at: oAt.toISOString(), type: 'overdue', title: 'Finanzguru', body: 'Offene Mobilfunk-Zahlungen prüfen.', tag: `due-${m}` });
      }
    }
    m = shiftMonth(m, 1);
  }

  for (const p of s.people || []) {
    const per = schedulePeriod(p.schedule);
    if (per <= 1 || !(Number(p.expectedAmount) > 0)) continue;
    const lead = (n.leadDays && n.leadDays[p.schedule] != null) ? n.leadDays[p.schedule] : 7;
    let dm = governingDueMonth(p, nowMonth);
    for (let k = 0; k < 30; k++) {
      const dueDate = atDate(dm, p.dayOfMonth || 1, hh, mm);
      const remAt = new Date(dueDate.getTime() - lead * 864e5);
      if (remAt.getTime() > endMs) break;
      if (within(remAt) && dueDate.getTime() >= now.getTime() - 3 * 864e5) {
        out.push({ at: remAt.toISOString(), type: 'lead', title: 'Finanzguru', body: `Bald fällig: ${RHYTHM_WORD[p.schedule] || ''} Mobilfunk-Zahlung.`.replace('  ', ' '), tag: `lead-${p.id}-${dm}` });
      }
      dm = shiftMonth(dm, per);
    }
  }

  // Guthaben-Personen (Prepaid): erinnern, wenn das Guthaben (bald) aufgebraucht ist.
  // Generischer Text ohne Namen – wird ggf. an den Push-Server synchronisiert.
  for (const p of s.people || []) {
    if (p.schedule !== 'prepaid') continue;
    const r = monthlyAmount(p, nowMonth);
    if (!(r > 0)) continue;
    const b = (s.ledger && s.ledger[p.id]) || {};
    const start = p.startMonth || Object.keys(b).filter((k) => (Number(b[k] && b[k].received) || 0) > 0).sort()[0] || nowMonth;
    let recv = 0;
    for (const k of Object.keys(b)) if (monthIndex(k) <= monthIndex(nowMonth)) recv += Number(b[k].received) || 0;
    let cons = 0;
    for (let cur = start; monthIndex(cur) <= monthIndex(nowMonth); cur = shiftMonth(cur, 1)) cons += monthlyAmount(p, cur);
    const bal = recv - cons;
    const ahead = bal >= 0 ? Math.floor((bal + 0.005) / r) : -1;
    const firstUncovered = shiftMonth(nowMonth, ahead + 1); // erster nicht gedeckter Monat
    const remAt = atDate(firstUncovered, 1, hh, mm);
    if (within(remAt)) {
      out.push({ at: remAt.toISOString(), type: 'prepaid', title: 'Finanzguru', body: 'Ein Guthaben-Beitrag ist aufgebraucht – neue Zahlung/Gutschein anfragen.', tag: `prepaid-${p.id}-${firstUncovered}` });
    }
  }

  out.sort((a, b) => a.at.localeCompare(b.at));
  return out;
}
