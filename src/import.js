// DKB-Import: Datei (PDF/CSV) einlesen, mit erwarteten Zahlungen abgleichen,
// Eingänge buchen und unbekannte Eingänge manuell zuordnen.
import { ICO, escapeHtml, openModal, closeModal, toast } from './ui.js';
import { state, save, rerenderDashboard, showScreen } from './main.js';
import { fmtEUR, fmtDate, monthLabel, currentMonth, shiftMonth } from './money.js';
import { expectedForMonth } from './data/schedules.js';
import { isSharedIban, normalizeIban, normalizeName, looksAnonymous } from './match.js';
import { matchMonth } from './match.js';
import { parseFile, extractPdfLines, transactionsFromLines } from './parse.js';
import { detectTelekomInvoice, parseTelekomInvoice } from './parseInvoice.js';
import { storeInvoice, openInvoiceDetail } from './invoices.js';
import { getReceived, setReceived, clearReceived, statusFor, STATUS, renderLedger } from './ledger.js';

let importMonth = currentMonth();
let parsed = null; // { txns, fileName }
let result = null; // { assignments, unmatched }
let busy = false;

export function setImportMonth(delta) {
  importMonth = shiftMonth(importMonth, delta);
  if (parsed) recompute();
  renderImport();
}

function recompute() {
  result = matchMonth(state.people, parsed.txns, importMonth, state.settings);
}

export function renderImport() {
  const el = document.getElementById('screen-import');
  if (!el) return;
  el.innerHTML = `
    <header class="topbar"><h1>Import</h1></header>
    <div class="pad">
      <div class="month-switch">
        <button class="icon-btn" onclick="setImportMonth(-1)" aria-label="Vormonat">${ICO.chevL}</button>
        <span class="month-label">${escapeHtml(monthLabel(importMonth))}</span>
        <button class="icon-btn" onclick="setImportMonth(1)" aria-label="Folgemonat">${ICO.chevR}</button>
      </div>

      <button class="dropzone" onclick="pickImportFile()" ${busy ? 'disabled' : ''}>
        ${ICO.upload}
        <b>${busy ? 'Wird gelesen…' : 'Datei wählen'}</b>
        <span class="muted small">DKB-Auszug (PDF/CSV) oder Telekom-Rechnung (PDF) · wird automatisch erkannt · bleibt lokal</span>
      </button>

      ${parsed ? resultsHtml() : hintHtml()}
    </div>`;
}

function hintHtml() {
  return `<div class="card"><div class="card-title">So funktioniert's</div>
    <ol class="blk-ol">
      <li>Monat oben wählen (Standard: aktueller Monat).</li>
      <li>DKB-Auszug als <b>PDF</b> (oder CSV) laden.</li>
      <li>Die App ordnet Eingänge per IBAN/Name automatisch zu.</li>
      <li>Sichere Treffer übernehmen, unbekannte Eingänge (z. B. PayPal) selbst zuordnen.</li>
    </ol>
    <p class="muted small" style="margin:8px 0 0">${ICO.info} Eine <b>Telekom-Mobilfunk-Rechnung (PDF)</b> wird automatisch erkannt und unter <b>Kosten → Rechnungen</b> einsortiert &amp; pro Person abgeglichen.</p>
    <p class="muted small" style="margin:8px 0 0">${ICO.shield} Die Datei wird nicht hochgeladen – sie wird nur im Browser ausgewertet.</p>
  </div>`;
}

function isBooked(personId, txnId) {
  const e = getReceived(personId, importMonth);
  return !!(e && e.matchedTxnId && e.matchedTxnId === txnId);
}

function resultsHtml() {
  const { assignments, unmatched } = result;
  const byPerson = new Map(assignments.map((a) => [a.personId, a]));

  // Personen mit Soll in diesem Monat + alle mit Zuordnung.
  const rowsPeople = [...state.people]
    .map((p) => ({ p, exp: expectedForMonth(p, importMonth), a: byPerson.get(p.id) }))
    .filter((r) => r.exp > 0 || r.a)
    .sort((a, b) => (statusRank(a) - statusRank(b)) || (a.p.name || '').localeCompare(b.p.name || '', 'de'));

  const openCount = rowsPeople.filter((r) => statusFor(r.p, importMonth) === 'open').length;
  const pendingAssign = assignments.filter((a) => !isBooked(a.personId, a.txn.id));

  return `
    <div class="card">
      <div class="card-title">Eingänge: ${escapeHtml(parsed.fileName || 'Datei')} · ${parsed.txns.length} Buchungen</div>
      <div class="imp-stats">
        <span>${assignments.length} zugeordnet</span>
        <span class="${openCount ? 'warn-text' : ''}">${openCount} offen</span>
        <span>${unmatched.length} unklar</span>
      </div>
      ${pendingAssign.length ? `<button class="btn btn-primary full" onclick="bookAll()">${ICO.check} Alle ${pendingAssign.length} Treffer übernehmen</button>` : ''}
    </div>

    <div class="section-label">Diesen Monat (${escapeHtml(monthLabel(importMonth))})</div>
    <div class="imp-list">
      ${rowsPeople.map(peopleRow).join('') || '<p class="muted small">Keine fälligen Beiträge in diesem Monat.</p>'}
    </div>

    <div class="section-label">Nicht zugeordnete Eingänge (${unmatched.length})</div>
    <div class="imp-list">
      ${unmatched.length ? unmatched.map(unmatchedRow).join('') : '<p class="muted small">Alle Eingänge zugeordnet 🎉</p>'}
    </div>`;
}

function statusRank({ p }) {
  const order = { open: 0, partial: 1, none: 2, advance: 3, paid: 4 };
  return order[statusFor(p, importMonth)] ?? 5;
}

function peopleRow({ p, exp, a }) {
  const st = statusFor(p, importMonth);
  const meta = STATUS[st];
  const booked = a && isBooked(p.id, a.txn.id);
  let right = '';
  if (a && !booked) {
    const conf = a.confidence === 'high' ? 'sicher' : a.confidence === 'medium' ? 'wahrscheinlich' : 'unsicher';
    right = `<div class="imp-btns">
        <button class="btn btn-sm btn-primary" onclick="bookAssignment('${p.id}')">${fmtEUR(a.txn.amount)} übernehmen</button>
        <button class="btn btn-sm btn-ghost imp-reject" title="Vorschlag verwerfen" onclick="rejectAssignment('${p.id}')">${ICO.x}</button>
      </div>
      <span class="conf conf-${a.confidence}">${escapeHtml(conf)} · ${escapeHtml((a.reasons || []).join('+') || '–')}</span>`;
  } else {
    right = `<span class="status-badge" style="--sc:${meta.color}">${escapeHtml(meta.label)}</span>`;
  }
  return `<div class="imp-row" style="--sc:${meta.color}">
    <span class="dash-dot"></span>
    <div class="dash-meta"><b>${escapeHtml(p.name || '(ohne Name)')}</b>
      <small>Soll ${exp > 0 ? fmtEUR(exp) : '–'}${a && !booked ? ` · erkannt: ${escapeHtml(a.txn.name || a.txn.purpose || 'Eingang')}` : ''}</small></div>
    <div class="imp-right">${right}</div>
  </div>`;
}

function unmatchedRow(txn) {
  return `<div class="imp-row">
    <span class="dash-dot" style="--sc:#5b6270"></span>
    <div class="dash-meta"><b>${fmtEUR(txn.amount)}</b>
      <small>${escapeHtml(fmtDate(txn.date))} · ${escapeHtml(txn.name || '—')}${txn.purpose ? ' · ' + escapeHtml(txn.purpose) : ''}</small></div>
    <div class="imp-right"><button class="btn btn-sm btn-ghost" onclick="assignUnmatched('${txn.id}')">Zuordnen</button></div>
  </div>`;
}

// ---- Aktionen -------------------------------------------------------------
export function pickImportFile() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.pdf,.csv,application/pdf,text/csv';
  input.onchange = async () => {
    const file = input.files && input.files[0];
    if (!file) return;
    busy = true; renderImport();
    try {
      const isPdf = (file.name || '').toLowerCase().endsWith('.pdf') || file.type === 'application/pdf';
      let txns;
      if (isPdf) {
        const lines = await extractPdfLines(file);
        // Telekom-Mobilfunk-Rechnung? -> als Rechnung importieren statt als Kontoauszug.
        if (detectTelekomInvoice(lines)) {
          const inv = parseTelekomInvoice(lines, file.name);
          if (!inv.month || !inv.positions.length) {
            toast('Rechnung nicht erkannt. Ist es eine Telekom-Mobilfunk-Rechnung?', 'err');
            busy = false; renderImport(); return;
          }
          const dup = (state.invoices || []).some((i) => i.id === inv.id);
          if (!dup) storeInvoice(inv);
          busy = false; renderImport();
          toast(dup ? 'Rechnung bereits importiert' : `Rechnung ${monthLabel(inv.month)} importiert`, dup ? '' : 'ok');
          showScreen('costs');
          if (window.setCostsTab) window.setCostsTab('rechnungen');
          openInvoiceDetail(inv.id);
          return;
        }
        txns = transactionsFromLines(lines);
      } else {
        txns = await parseFile(file); // CSV (DKB-Umsätze)
      }
      if (!txns.length) {
        toast('Keine Buchungen erkannt. Format prüfen?', 'err');
        busy = false; parsed = null; renderImport(); return;
      }
      parsed = { txns, fileName: file.name };
      recompute();
      toast(`${txns.length} Buchungen gelesen`, 'ok');
    } catch (e) {
      console.warn('parse failed', e);
      toast('Datei konnte nicht gelesen werden', 'err');
      parsed = null;
    } finally {
      busy = false;
      renderImport();
    }
  };
  input.click();
}

function bookOne(a) {
  setReceived(a.personId, importMonth, {
    received: a.txn.amount,
    receivedDate: a.txn.date,
    matchedTxnId: a.txn.id
  });
  // Auch beim Bestätigen eines automatischen Treffers dazulernen (z. B. neue IBAN).
  const person = state.people.find((p) => p.id === a.personId);
  if (person) learnFromAssignment(person, a.txn);
}

export function bookAssignment(personId) {
  const a = result.assignments.find((x) => x.personId === personId);
  if (!a) return;
  bookOne(a);
  save();
  afterChange();
  toast('Übernommen', 'ok');
}

// Vorschlag verwerfen: Zuordnung lösen, Eingang zurück in „nicht zugeordnet".
// (Dauerhaftes Vergessen eines gelernten Hinweises erfolgt in der Personen-Ansicht.)
export function rejectAssignment(personId) {
  const idx = result.assignments.findIndex((x) => x.personId === personId);
  if (idx < 0) return;
  const [a] = result.assignments.splice(idx, 1);
  // Falls bereits gebucht, Buchung dieser Transaktion rückgängig machen.
  const e = getReceived(personId, importMonth);
  if (e && e.matchedTxnId === a.txn.id) clearReceived(personId, importMonth);
  if (!result.unmatched.some((t) => t.id === a.txn.id)) result.unmatched.push(a.txn);
  save();
  afterChange();
  toast('Vorschlag verworfen');
}

export function bookAll() {
  let n = 0;
  for (const a of result.assignments) {
    if (!isBooked(a.personId, a.txn.id)) { bookOne(a); n++; }
  }
  save();
  afterChange();
  toast(`${n} Eingänge übernommen`, 'ok');
}

export function assignUnmatched(txnId) {
  const txn = result.unmatched.find((t) => t.id === txnId) || parsed.txns.find((t) => t.id === txnId);
  if (!txn) return;
  const people = [...state.people].sort((a, b) => (a.name || '').localeCompare(b.name || '', 'de'));
  openModal(`${fmtEUR(txn.amount)} zuordnen`, `
    <p class="muted small" style="margin:0 0 12px">${escapeHtml(fmtDate(txn.date))} · ${escapeHtml(txn.name || '—')}${txn.purpose ? ' · ' + escapeHtml(txn.purpose) : ''}</p>
    <div class="pick-list">
      ${people.map((p) => `<button class="pick-row" onclick="assignUnmatchedTo('${txn.id}','${p.id}')">
        ${escapeHtml(p.name || '(ohne Name)')}<span class="muted small">${fmtEUR(expectedForMonth(p, importMonth))}</span></button>`).join('')
        || '<p class="muted small">Keine Personen vorhanden.</p>'}
    </div>`);
}

// Aus einer manuellen Zuordnung für künftige Importe lernen:
//  - eindeutige IBAN  -> person.ibans (sicherer Auto-Treffer)
//  - Sammel-IBAN/anonyme Zahlung (PayPal/Netflix) -> person.payAliases {iban, amount}
//  - abweichender, nicht-anonymer Name -> person.nameAliases (Ligaturen/Tippfehler/Gemeinschaftskonto)
function learnFromAssignment(person, txn) {
  const iban = normalizeIban(txn.iban);
  if (iban && !isSharedIban(iban)) {
    if (!Array.isArray(person.ibans)) person.ibans = [];
    if (!person.ibans.map(normalizeIban).includes(iban)) person.ibans.push(txn.iban);
  } else if (iban) {
    // anonyme Zahlung: (Sammel-IBAN + Betrag) als Hinweis merken
    if (!Array.isArray(person.payAliases)) person.payAliases = [];
    const exists = person.payAliases.some((a) => normalizeIban(a.iban) === iban && Math.abs((Number(a.amount) || 0) - txn.amount) <= 0.005);
    if (!exists) person.payAliases.push({ iban: txn.iban, amount: txn.amount });
  }
  const nn = normalizeName(txn.name);
  const pn = normalizeName(person.name);
  if (nn && !looksAnonymous(txn) && !(nn.includes(pn) || pn.includes(nn))) {
    if (!Array.isArray(person.nameAliases)) person.nameAliases = [];
    if (!person.nameAliases.map(normalizeName).includes(nn)) person.nameAliases.push(nn);
  }
}

export function assignUnmatchedTo(txnId, personId) {
  const txn = parsed.txns.find((t) => t.id === txnId);
  const person = state.people.find((p) => p.id === personId);
  if (!txn || !person) return;
  setReceived(personId, importMonth, { received: txn.amount, receivedDate: txn.date, matchedTxnId: txn.id });
  learnFromAssignment(person, txn);
  save();
  closeModal();
  // Transaktion aus dem Unmatched-Bucket nehmen.
  result.unmatched = result.unmatched.filter((t) => t.id !== txnId);
  afterChange();
  toast('Zugeordnet', 'ok');
}

function afterChange() {
  renderImport();
  rerenderDashboard();
  renderLedger();
}

Object.assign(window, {
  renderImport, setImportMonth, pickImportFile, bookAssignment, bookAll,
  rejectAssignment, assignUnmatched, assignUnmatchedTo
});
