// Soll/Ist-Buch: erhaltene Zahlungen je Person & Monat + Matrix-Ansicht.
import { ICO, escapeHtml, openModal, closeModal, toast } from './ui.js';
import { state, save, rerenderDashboard } from './main.js';
import { fmtEUR, parseEUR, fmtDate, monthLabel, monthShort, lastMonths, currentMonth, todayISO, shiftMonth, monthIndex } from './money.js';
import { expectedForMonth, governingDueMonth, scheduleLabel, monthlyAmount } from './data/schedules.js';

export const STATUS = {
  paid: { label: 'Bezahlt', color: '#2fb86b' },
  open: { label: 'Offen', color: '#e23b3b' },
  partial: { label: 'Teilweise', color: '#f5a623' },
  advance: { label: 'Voraus', color: '#2d9cdb' },
  none: { label: 'Nicht fällig', color: '#5b6270' }
};

let viewEnd = currentMonth();
let viewSize = 6;

// ---- Datenzugriff ---------------------------------------------------------
function bucket(personId) {
  if (!state.ledger[personId]) state.ledger[personId] = {};
  return state.ledger[personId];
}

export function getReceived(personId, month) {
  const b = state.ledger[personId];
  return (b && b[month]) || null;
}

export function setReceived(personId, month, { received, receivedDate, matchedTxnId, note, extraDue, extraNote } = {}) {
  const b = bucket(personId);
  const entry = b[month] || {};
  if (received != null) entry.received = Number(received) || 0;
  if (receivedDate !== undefined) entry.receivedDate = receivedDate || '';
  if (matchedTxnId !== undefined) entry.matchedTxnId = matchedTxnId || '';
  if (note !== undefined) entry.note = note || '';
  if (extraDue !== undefined) entry.extraDue = Number(extraDue) || 0;
  if (extraNote !== undefined) entry.extraNote = extraNote || '';
  entry.updated = Date.now();
  b[month] = entry;
}

// Effektives Soll des Monats = Rhythmus-Soll + einmaliger Zusatz-Soll (z. B.
// Bereitstellung/Versand/zusätzliche Karten), damit eine Sammelzahlung korrekt zählt.
export function effectiveExpected(person, month) {
  const base = expectedForMonth(person, month);
  const e = getReceived(person.id, month);
  return base + (e && Number(e.extraDue) ? Number(e.extraDue) : 0);
}

export function addReceived(personId, month, amount, receivedDate, matchedTxnId) {
  const prev = getReceived(personId, month);
  const sum = (prev ? Number(prev.received) || 0 : 0) + (Number(amount) || 0);
  setReceived(personId, month, { received: sum, receivedDate, matchedTxnId });
}

export function clearReceived(personId, month) {
  const b = state.ledger[personId];
  if (b) delete b[month];
}

// ---- Guthaben-Modell (Prepaid) --------------------------------------------
// Erster Monat, ab dem verbraucht wird: startMonth oder frühester Zahlungsmonat.
function prepaidStart(person) {
  if (person.startMonth) return person.startMonth;
  const b = state.ledger[person.id] || {};
  const ms = Object.keys(b).filter((m) => (Number(b[m] && b[m].received) || 0) > 0).sort();
  return ms[0] || currentMonth();
}
// Guthaben-Stand am Ende von `month`: alle Zahlungen bis inkl. month minus
// monatlicher Verbrauch (Anteil) von start bis month.
export function prepaidBalance(person, month) {
  const b = state.ledger[person.id] || {};
  let recv = 0;
  for (const m of Object.keys(b)) if (monthIndex(m) <= monthIndex(month)) recv += Number(b[m].received) || 0;
  const start = prepaidStart(person);
  let cons = 0;
  for (let m = start; monthIndex(m) <= monthIndex(month); m = shiftMonth(m, 1)) cons += monthlyAmount(person, m);
  return recv - cons;
}
// Monat, bis zu dem das aktuelle Guthaben (ab refMonth) reicht (null = bereits überzogen).
export function prepaidCoveredUntil(person, refMonth) {
  const r = monthlyAmount(person, refMonth);
  if (r <= 0) return null;
  const bal = prepaidBalance(person, refMonth);
  if (bal < -0.005) return null;
  return shiftMonth(refMonth, Math.floor((bal + 0.005) / r));
}
function prepaidCellStatus(person, month) {
  const start = prepaidStart(person);
  const r = monthlyAmount(person, month);
  const recvThis = (getReceived(person.id, month) || {}).received || 0;
  if (r <= 0 || monthIndex(month) < monthIndex(start)) return recvThis > 0 ? 'paid' : 'none';
  const after = prepaidBalance(person, month);
  if (after >= -0.005) return recvThis >= r - 0.005 ? 'paid' : 'advance';
  const before = after - recvThis + r; // Guthaben am Ende des Vormonats
  return (before + recvThis) > 0.005 ? 'partial' : 'open';
}

// ---- Status ---------------------------------------------------------------
export function statusFor(person, month) {
  if (person.schedule === 'prepaid') return prepaidCellStatus(person, month);
  const exp = effectiveExpected(person, month);
  const entry = getReceived(person.id, month);
  const rec = entry ? Number(entry.received) || 0 : 0;
  if (exp > 0) {
    if (rec <= 0) return 'open';
    if (rec + 0.01 >= exp) return 'paid';
    return 'partial';
  }
  if (rec > 0) return 'paid';
  const due = governingDueMonth(person, month);
  if (due !== month) {
    const dueExp = expectedForMonth(person, due);
    const dueRec = (getReceived(person.id, due) || {}).received || 0;
    if (dueExp > 0 && dueRec + 0.01 >= dueExp) return 'advance';
  }
  return 'none';
}

// ---- Matrix-Ansicht -------------------------------------------------------
export function setLedgerWindow(deltaMonths) {
  viewEnd = shiftMonth(viewEnd, deltaMonths);
  renderLedger();
}

export function renderLedger() {
  const el = document.getElementById('screen-ledger');
  if (!el) return;
  const months = lastMonths(viewSize, viewEnd);
  const people = [...state.people].sort((a, b) => (a.name || '').localeCompare(b.name || '', 'de'));

  const head = `<th class="lg-name-h">Person</th>` +
    months.map((m) => `<th>${escapeHtml(monthShort(m))}</th>`).join('');

  const rows = people.map((person) => {
    const cells = months.map((m) => {
      const st = statusFor(person, m);
      const meta = STATUS[st];
      const entry = getReceived(person.id, m);
      const rec = entry ? Number(entry.received) || 0 : 0;
      const label = st === 'none' ? '' : (rec > 0 ? fmtEUR(rec).replace(/\s?€/, '') : (st === 'open' ? '–' : ''));
      return `<td><button class="lg-cell lg-${st}" style="--sc:${meta.color}"
        onclick="openLedgerCell('${person.id}','${m}')" title="${escapeHtml(meta.label)}">${escapeHtml(label)}</button></td>`;
    }).join('');
    return `<tr><th class="lg-name" onclick="openPerson('${person.id}')">${escapeHtml(person.name || '(ohne Name)')}</th>${cells}</tr>`;
  }).join('');

  el.innerHTML = `
    <header class="topbar"><h1>Soll/Ist</h1></header>
    <div class="pad">
      ${people.length === 0 ? emptyLedger() : `
      <div class="lg-toolbar">
        <button class="icon-btn" onclick="setLedgerWindow(-${viewSize})" aria-label="früher">${ICO.chevL}</button>
        <span class="lg-range">${escapeHtml(monthLabel(months[0]))} – ${escapeHtml(monthLabel(months[months.length - 1]))}</span>
        <button class="icon-btn" onclick="setLedgerWindow(${viewSize})" aria-label="später">${ICO.chevR}</button>
      </div>
      <div class="lg-scroll">
        <table class="lg-table">
          <thead><tr>${head}</tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div class="lg-legend">
        ${Object.entries(STATUS).filter(([k]) => k !== 'none').map(([k, s]) =>
          `<span class="lg-leg"><i style="background:${s.color}"></i>${escapeHtml(s.label)}</span>`).join('')}
      </div>
      <p class="muted small" style="margin-top:14px">Tippe eine Zelle, um den Zahlungseingang zu bearbeiten. Tippe einen Namen, um die Person zu öffnen.</p>
      `}
    </div>`;
}

function emptyLedger() {
  return `<div class="empty">${ICO.calendar}<p>Noch keine Personen angelegt.</p>
    <p class="muted small">Lege unter „Personen" Beiträge an oder importiere deine Daten unter „Mehr".</p></div>`;
}

// ---- Zell-Editor ----------------------------------------------------------
export function openLedgerCell(personId, month) {
  const person = state.people.find((p) => p.id === personId);
  if (!person) return;
  const base = expectedForMonth(person, month);
  const entry = getReceived(personId, month) || {};
  const extra = Number(entry.extraDue) || 0;
  const target = base + extra;
  const st = statusFor(person, month);
  openModal(`${person.name} · ${monthLabel(month)}`, `
    <form id="cellForm" onsubmit="return false">
      <div class="cell-info">
        <div><span class="muted small">Soll (${escapeHtml(scheduleLabel(person.schedule))})</span><b>${target > 0 ? fmtEUR(target) : '– (vorausbezahlt/kein Fälligkeitsmonat)'}${extra > 0 ? ` <span class="muted small">(inkl. ${fmtEUR(extra)} einmalig)</span>` : ''}</b></div>
        <div><span class="muted small">Status</span><b style="color:${STATUS[st].color}">${STATUS[st].label}</b></div>
      </div>
      <div class="fld-row">
        <label class="fld"><span>Erhalten (€)</span><input name="received" type="text" inputmode="decimal" value="${entry.received != null ? String(entry.received).replace('.', ',') : ''}" placeholder="${target > 0 ? String(target).replace('.', ',') : '0'}"></label>
        <label class="fld"><span>am</span><input name="date" type="date" value="${escapeHtml(entry.receivedDate || '')}"></label>
      </div>
      <label class="fld"><span>Notiz (optional)</span><input name="note" type="text" value="${escapeHtml(entry.note || '')}" placeholder="z. B. per PayPal"></label>
      <details class="advanced"${extra > 0 ? ' open' : ''}>
        <summary>Einmaliger Zusatz-Soll (z. B. Bereitstellung, Versand, neue Karten)</summary>
        <div class="fld-row" style="margin-top:8px">
          <label class="fld"><span>Zusatz-Soll (€)</span><input name="extraDue" type="text" inputmode="decimal" value="${extra ? String(extra).replace('.', ',') : ''}" placeholder="z. B. 80"></label>
          <label class="fld"><span>Wofür?</span><input name="extraNote" type="text" value="${escapeHtml(entry.extraNote || '')}" placeholder="z. B. 3 neue SIM: Bereitstellung + Versand"></label>
        </div>
        <p class="muted small" style="margin:6px 0 0">Wird einmalig zum Soll dieses Monats addiert. Den dauerhaft höheren Monatsbeitrag stellst du in „Personen" ein.</p>
      </details>
      <div class="modal-actions">
        ${entry.received != null ? `<button type="button" class="btn btn-danger" onclick="clearLedgerCell('${personId}','${month}')">${ICO.trash} Leeren</button>` : `<button type="button" class="btn btn-ghost" onclick="markCellPaid('${personId}','${month}')">${ICO.check} Soll erhalten</button>`}
        <button type="button" class="btn btn-primary" onclick="saveLedgerCell('${personId}','${month}')">Speichern</button>
      </div>
    </form>`);
}

export function markCellPaid(personId, month) {
  const person = state.people.find((p) => p.id === personId);
  if (!person) return;
  const exp = effectiveExpected(person, month);
  setReceived(personId, month, { received: exp, receivedDate: todayISO() });
  save();
  closeModal();
  renderLedger();
  rerenderDashboard();
  toast('Als bezahlt markiert', 'ok');
}

export function saveLedgerCell(personId, month) {
  const form = document.getElementById('cellForm');
  if (!form) return;
  const fd = new FormData(form);
  const recRaw = (fd.get('received') || '').toString().trim();
  const received = recRaw ? parseEUR(recRaw) : 0;
  const extraRaw = (fd.get('extraDue') || '').toString().trim();
  setReceived(personId, month, {
    received,
    receivedDate: (fd.get('date') || '').toString(),
    note: (fd.get('note') || '').toString().trim(),
    extraDue: extraRaw ? parseEUR(extraRaw) : 0,
    extraNote: (fd.get('extraNote') || '').toString().trim()
  });
  save();
  closeModal();
  renderLedger();
  rerenderDashboard();
  toast('Gespeichert', 'ok');
}

export function clearLedgerCell(personId, month) {
  clearReceived(personId, month);
  save();
  closeModal();
  renderLedger();
  rerenderDashboard();
  toast('Eintrag geleert');
}

Object.assign(window, {
  renderLedger, setLedgerWindow, openLedgerCell, saveLedgerCell, clearLedgerCell, markCellPaid
});
