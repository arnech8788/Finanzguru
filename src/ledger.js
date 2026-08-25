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

export function setReceived(personId, month, { received, receivedDate, matchedTxnId, note, extraDue, extraNote, covered } = {}) {
  const b = bucket(personId);
  const entry = b[month] || {};
  if (received != null) entry.received = Number(received) || 0;
  if (receivedDate !== undefined) entry.receivedDate = receivedDate || '';
  if (matchedTxnId !== undefined) entry.matchedTxnId = matchedTxnId || '';
  if (note !== undefined) entry.note = note || '';
  if (extraDue !== undefined) entry.extraDue = Number(extraDue) || 0;
  if (extraNote !== undefined) entry.extraNote = extraNote || '';
  if (covered !== undefined) entry.covered = !!covered;
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

// ---- Reparatur: doppelt gezählte Buchungen ---------------------------------
// Findet Zellen, deren „Erhalten" exakt das 2-fache der zugeordneten (gespeicherten)
// Transaktion ist – entstanden durch erneutes Zuordnen nach dem ID-Wechsel.
// Aufteilungen (eine Transaktion auf mehrere Zellen) werden bewusst ausgelassen.
export function findDoubledBookings() {
  const store = state.transactions || {};
  const refs = {};
  for (const months of Object.values(state.ledger || {})) {
    for (const e of Object.values(months || {})) {
      if (e && e.matchedTxnId) refs[e.matchedTxnId] = (refs[e.matchedTxnId] || 0) + 1;
    }
  }
  const hits = [];
  for (const [pid, months] of Object.entries(state.ledger || {})) {
    for (const [m, e] of Object.entries(months || {})) {
      const id = e && e.matchedTxnId;
      if (!id || !store[id] || refs[id] !== 1) continue;
      const amt = Number(store[id].amount) || 0;
      const rec = Number(e.received) || 0;
      if (amt > 0 && Math.abs(rec - 2 * amt) < 0.011) hits.push({ pid, m, from: rec, to: amt });
    }
  }
  return hits;
}
export function applyDedupe(hits) {
  for (const h of hits) {
    const e = state.ledger[h.pid] && state.ledger[h.pid][h.m];
    if (e) e.received = h.to;
  }
  save();
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
  const start = prepaidStart(person);
  const si = monthIndex(start), mi = monthIndex(month);
  // Nur Zahlungen ab dem Startmonat zählen (frühere Historie ignorieren).
  let recv = 0;
  for (const m of Object.keys(b)) { const k = monthIndex(m); if (k >= si && k <= mi) recv += Number(b[m].received) || 0; }
  let cons = 0;
  for (let m = start; monthIndex(m) <= mi; m = shiftMonth(m, 1)) cons += monthlyAmount(person, m);
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
// Kennzahlen für Intervall-/Guthaben-Zahler (krumme Summen über mehrere Monate):
// Gesamt gezahlt, wie viele volle Monate gedeckt, Rest-Guthaben, was fürs
// nächste (Teil-)Monat noch fehlt. Reines „Topf"-Modell (Summe / Monatsrate).
export function prepaidStats(person) {
  const start = prepaidStart(person);
  const r = monthlyAmount(person, currentMonth()) || 0;
  const b = state.ledger[person.id] || {};
  const si = monthIndex(start);
  let totalPaid = 0;
  for (const m of Object.keys(b)) if (monthIndex(m) >= si) totalPaid += Number(b[m].received) || 0;
  if (!(r > 0)) return { rate: 0, totalPaid, coveredMonths: 0, coveredUntil: null, next: start, leftover: totalPaid, neededForNext: 0 };
  const coveredMonths = Math.max(0, Math.floor((totalPaid + 0.005) / r));
  const leftover = Math.max(0, totalPaid - coveredMonths * r);
  const coveredUntil = coveredMonths > 0 ? shiftMonth(start, coveredMonths - 1) : null;
  const next = shiftMonth(start, coveredMonths);
  const neededForNext = Math.max(0, r - leftover);
  return { rate: r, totalPaid, coveredMonths, coveredUntil, next, leftover, neededForNext };
}

// Topf-Prinzip: Gesamte Einnahmen ab Startmonat werden Monat für Monat mit der
// Rate „verbraucht" – egal, in welchem Monat die einzelne Zahlung gebucht ist.
function prepaidCellStatus(person, month) {
  const start = prepaidStart(person);
  const entry = getReceived(person.id, month) || {};
  const recvThis = entry.received || 0;
  if (monthIndex(month) < monthIndex(start)) return recvThis > 0 ? 'paid' : (entry.covered ? 'advance' : 'none');
  const s = prepaidStats(person);
  if (s.rate <= 0) return recvThis > 0 ? 'paid' : 'none';
  const idx = monthIndex(month) - monthIndex(start);
  if (idx < s.coveredMonths) return recvThis > 0 ? 'paid' : 'advance';       // voll gedeckt
  if (idx === s.coveredMonths && s.leftover > 0.005) return recvThis > 0 ? 'paid' : 'partial'; // Rest-Guthaben
  if (entry.covered) return 'advance';
  return recvThis > 0 ? 'paid' : 'open';
}

// ---- Status ---------------------------------------------------------------
export function statusFor(person, month) {
  if (person.schedule === 'prepaid') return prepaidCellStatus(person, month);
  const exp = effectiveExpected(person, month);
  const entry = getReceived(person.id, month);
  const rec = entry ? Number(entry.received) || 0 : 0;
  if (exp > 0) {
    if (rec + 0.01 >= exp) return 'paid';
    if (rec > 0) return 'partial';
    return (entry && entry.covered) ? 'advance' : 'open'; // manuell als vorausbezahlt markiert
  }
  if (rec > 0) return 'paid';
  if (entry && entry.covered) return 'advance';
  const due = governingDueMonth(person, month);
  if (due !== month) {
    const dueExp = expectedForMonth(person, due);
    const dueRec = (getReceived(person.id, due) || {}).received || 0;
    if (dueExp > 0 && dueRec + 0.01 >= dueExp) return 'advance';
  }
  return 'none';
}

// Bis zu welchem Monat ist die Person (ab `from`) durchgehend gedeckt
// (bezahlt/voraus)? Stoppt beim ersten offenen/teilweisen Monat. null = jetzt offen.
export function coveredUntil(person, from) {
  let last = null, none = 0, m = from;
  for (let i = 0; i < 24; i++) {
    const st = statusFor(person, m);
    if (st === 'open' || st === 'partial') break;
    if (st === 'paid' || st === 'advance') { last = m; none = 0; }
    else if (++none >= 3) break; // mehrere Monate ohne Fälligkeit -> Ende
    m = shiftMonth(m, 1);
  }
  return last;
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
    const cu = coveredUntil(person, currentMonth());
    const cov = cu ? 'bis ' + monthShort(cu) : (person.schedule === 'prepaid' ? 'Guthaben leer' : '');
    const subTxt = [person.category, cov].filter(Boolean).join(' · ');
    const sub = subTxt ? `<div style="font-weight:400;font-size:10px;color:var(--tx3);margin-top:2px">${escapeHtml(subTxt)}</div>` : '';
    return `<tr><th class="lg-name" onclick="openPerson('${person.id}')">${escapeHtml(person.name || '(ohne Name)')}${sub}</th>${cells}</tr>`;
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
      ${person.schedule === 'prepaid'
        ? `<p class="muted small" style="margin:2px 0 8px">Guthaben-Modell: Trag einfach den erhaltenen Betrag im Zahlungsmonat ein – die App addiert alle Zahlungen und verteilt sie automatisch auf die Folgemonate. Kein „gilt für Monat" oder „Voraus" nötig.</p>`
        : `<label class="fld"><span>Zahlung gilt für Monat</span><input name="applyMonth" type="month" value="${escapeHtml(month)}"></label>
      <p class="muted small" style="margin:2px 0 8px">Standard: dieser Monat. Bei einer Vorauszahlung für einen späteren Monat hier den Zielmonat wählen (z. B. Beginn des im Voraus bezahlten Quartals) – der Eintrag wird dann dort verbucht.</p>
      <label class="cost-row" style="margin:2px 0 8px"><span>Als vorausbezahlt („Voraus") markieren</span>
        <input type="checkbox" name="covered" ${entry.covered ? 'checked' : ''}></label>
      <p class="muted small" style="margin:0 0 8px">Für Monate, die durch eine frühere Zahlung bereits abgedeckt sind – zeigt „Voraus" statt „offen", ohne dass hier ein Betrag stehen muss.</p>`}
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
  const target = (fd.get('applyMonth') || month).toString() || month;
  const payload = {
    received,
    receivedDate: (fd.get('date') || '').toString(),
    note: (fd.get('note') || '').toString().trim(),
    extraDue: extraRaw ? parseEUR(extraRaw) : 0,
    extraNote: (fd.get('extraNote') || '').toString().trim(),
    covered: !!fd.get('covered')
  };
  if (target !== month) {
    // Eintrag in den gewählten Zielmonat verschieben, Ursprungsmonat leeren.
    payload.matchedTxnId = (getReceived(personId, month) || {}).matchedTxnId || '';
    setReceived(personId, target, payload);
    clearReceived(personId, month);
  } else {
    setReceived(personId, month, payload);
  }
  save();
  closeModal();
  renderLedger();
  rerenderDashboard();
  toast(target !== month ? `Gebucht für ${monthLabel(target)}` : 'Gespeichert', 'ok');
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
