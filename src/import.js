// DKB-Import: Datei (PDF/CSV) einlesen, mit erwarteten Zahlungen abgleichen,
// Eingänge buchen und unbekannte Eingänge manuell zuordnen.
import { ICO, escapeHtml, openModal, closeModal, updateModalBody, toast } from './ui.js';
import { state, save, rerenderDashboard, showScreen } from './main.js';
import { fmtEUR, parseEUR, fmtDate, monthLabel, monthKey, currentMonth, shiftMonth, todayISO } from './money.js';
import { expectedForMonth, SCHEDULES } from './data/schedules.js';
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
let txnQuery = '';            // Suche in „Alle Eingänge"
let txnFilter = 'unassigned'; // 'all' | 'unassigned' | 'assigned'

// Eingänge (amount > 0) dauerhaft speichern, damit sie später einseh-/zuordenbar sind.
function persistTxns(txns) {
  if (!state.transactions || typeof state.transactions !== 'object') state.transactions = {};
  for (const t of txns) {
    if (!(t.amount > 0)) continue;
    state.transactions[t.id] = { id: t.id, date: t.date, name: t.name || '', iban: t.iban || '', purpose: t.purpose || '', amount: t.amount };
  }
}

// Map: txnId -> [{ personId, month }] aus dem Ledger (matchedTxnId = aus Import gebucht).
function assignedMap() {
  const map = {};
  for (const [pid, months] of Object.entries(state.ledger || {})) {
    for (const [m, e] of Object.entries(months || {})) {
      if (e && e.matchedTxnId) (map[e.matchedTxnId] = map[e.matchedTxnId] || []).push({ personId: pid, month: m });
    }
  }
  return map;
}
function findAnyTxn(id) {
  return (parsed && parsed.txns.find((t) => t.id === id)) || (state.transactions && state.transactions[id]) || null;
}
function personName(pid) {
  const p = state.people.find((x) => x.id === pid);
  return p ? (p.name || '(ohne Name)') + (p.category ? ' · ' + p.category : '') : '?';
}

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

      <button class="btn btn-ghost full" style="margin-top:10px" onclick="openManualPayment()">${ICO.plus} PayPal-/manuelle Zahlung buchen</button>

      ${lastDkbBookingLine()}
      ${latestInvoiceLine()}
      ${parsed ? resultsHtml() : hintHtml()}
      ${storedIncomeHtml()}
    </div>`;
}

// Dauerhafte, durchsuchbare Liste aller importierten Eingänge (zuordnen/aufteilen).
function storedIncomeHtml() {
  const all = Object.values(state.transactions || {});
  if (!all.length) return '';
  const amap = assignedMap();
  const q = txnQuery.trim().toLowerCase();
  const list = all.filter((t) => {
    const isAssigned = !!amap[t.id];
    if (txnFilter === 'unassigned' && isAssigned) return false;
    if (txnFilter === 'assigned' && !isAssigned) return false;
    if (q) {
      const hay = `${t.name} ${t.purpose} ${fmtEUR(t.amount)} ${fmtDate(t.date)} ${t.date}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  }).sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const total = all.length;
  const unassigned = all.filter((t) => !amap[t.id]).length;
  const shown = list.slice(0, 200);
  const chip = (f, label, n) => `<button class="catchip ${txnFilter === f ? 'catchip-active' : ''}" onclick="setTxnFilter('${f}')">${label} <span class="cc-count">${n}</span></button>`;
  const rows = shown.map((t) => {
    const tgt = amap[t.id];
    const right = tgt
      ? `<span class="muted small">→ ${tgt.map((x) => escapeHtml(personName(x.personId)) + ' (' + escapeHtml(monthLabel(x.month)) + ')').join(', ')}</span>`
      : `<div class="imp-btns">
          <button class="btn btn-sm btn-primary" onclick="assignStored('${t.id}')">Zuordnen</button>
          <button class="btn btn-sm btn-ghost" onclick="splitStored('${t.id}')">Aufteilen</button>
        </div>`;
    return `<div class="imp-row">
      <span class="dash-dot" style="--sc:${tgt ? '#2fb86b' : '#5b6270'}"></span>
      <div class="dash-meta"><b>${fmtEUR(t.amount)}</b>
        <small>${escapeHtml(fmtDate(t.date))} · ${escapeHtml(t.name || '—')}${t.purpose ? ' · ' + escapeHtml(t.purpose) : ''}</small></div>
      <div class="imp-right">${right}</div>
    </div>`;
  }).join('');
  return `
    <div class="section-label">Alle Eingänge (${total}${unassigned ? ` · ${unassigned} offen` : ''})</div>
    <div class="card">
      <div class="search-wrap">${ICO.search}
        <input id="txnSearch" type="search" placeholder="Name, Zweck, Betrag, Datum…" value="${escapeHtml(txnQuery)}" oninput="setTxnQuery(this.value)" autocomplete="off"></div>
      <div class="cat-chips" style="margin-top:10px">
        ${chip('all', 'Alle', total)}
        ${chip('unassigned', 'Nicht zugeordnet', unassigned)}
        ${chip('assigned', 'Zugeordnet', total - unassigned)}
      </div>
    </div>
    <div class="imp-list">
      ${rows || '<p class="muted small">Keine passenden Eingänge.</p>'}
      ${list.length > shown.length ? `<p class="muted small" style="margin-top:8px">… ${list.length - shown.length} weitere – Suche eingrenzen.</p>` : ''}
    </div>`;
}

// ---- Manuelle Zahlung (z. B. PayPal) buchen & zuordnen --------------------
export function openManualPayment() {
  const people = [...state.people].sort((a, b) => (a.name || '').localeCompare(b.name || '', 'de'));
  if (!people.length) { toast('Erst Personen anlegen', 'err'); return; }
  openModal('Zahlung manuell buchen', `
    <form id="manualPayForm" onsubmit="return false">
      <label class="fld"><span>Person</span>
        <select name="person">${people.map((p) => `<option value="${p.id}">${escapeHtml(p.name || '(ohne Name)')}</option>`).join('')}</select></label>
      <div class="fld-row">
        <label class="fld"><span>Monat</span><input name="month" type="month" value="${escapeHtml(importMonth)}"></label>
        <label class="fld"><span>Betrag (€)</span><input name="amount" type="text" inputmode="decimal" placeholder="z. B. 7,00"></label>
      </div>
      <div class="fld-row">
        <label class="fld"><span>Zahlart</span>
          <select name="method">
            <option value="PayPal">PayPal</option>
            <option value="Überweisung">Überweisung</option>
            <option value="Bar">Bar</option>
            <option value="Netflix-Guthaben">Netflix-Guthaben</option>
            <option value="Sonstige">Sonstige</option>
          </select></label>
        <label class="fld"><span>am</span><input name="date" type="date" value="${escapeHtml(todayISO())}"></label>
      </div>
      <label class="fld"><span>Notiz (optional)</span><input name="note" type="text" placeholder="optional"></label>
      <p class="muted small" style="margin:2px 0 0">Wird zum bereits erhaltenen Betrag dieses Monats addiert.</p>
      <div class="modal-actions" style="margin-top:12px">
        <button type="button" class="btn btn-ghost" onclick="closeModal()">Abbrechen</button>
        <button type="button" class="btn btn-primary" onclick="saveManualPayment()">Buchen</button>
      </div>
    </form>`);
}

export function saveManualPayment() {
  const form = document.getElementById('manualPayForm');
  if (!form) return;
  const fd = new FormData(form);
  const personId = (fd.get('person') || '').toString();
  const month = (fd.get('month') || '').toString() || importMonth;
  const amount = parseEUR((fd.get('amount') || '').toString());
  if (!personId) { toast('Bitte eine Person wählen', 'err'); return; }
  if (!Number.isFinite(amount) || amount <= 0) { toast('Bitte einen gültigen Betrag eingeben', 'err'); return; }
  const date = (fd.get('date') || '').toString();
  const method = (fd.get('method') || 'PayPal').toString();
  const extra = (fd.get('note') || '').toString().trim();
  const prev = getReceived(personId, month) || {};
  const newReceived = (Number(prev.received) || 0) + amount;
  const noteBits = [prev.note, `${method} ${fmtEUR(amount)}`, extra].filter(Boolean);
  setReceived(personId, month, {
    received: newReceived,
    receivedDate: (date && (!prev.receivedDate || date > prev.receivedDate)) ? date : (prev.receivedDate || date),
    note: noteBits.join(' · ')
  });
  save();
  closeModal();
  afterChange();
  toast('Zahlung gebucht', 'ok');
}

// Zeigt das Datum der zuletzt aus einem DKB-Auszug gebuchten Buchung (max
// receivedDate über Ledger-Einträge MIT matchedTxnId = aus Import übernommen;
// manuelle Einträge zählen nicht), damit klar ist, ab wann der nächste Auszug
// importiert werden muss. Leer, wenn noch nichts importiert/gebucht wurde.
function lastDkbBookingLine() {
  let latest = '';
  for (const months of Object.values(state.ledger || {})) {
    for (const e of Object.values(months || {})) {
      if (e && e.matchedTxnId && e.receivedDate && e.receivedDate > latest) latest = e.receivedDate;
    }
  }
  if (!latest) return '';
  return `<div class="card">
    <div class="cost-row static"><span>DKB-Eingänge importiert bis</span>
      <b>${escapeHtml(fmtDate(latest))}</b></div>
    <p class="muted small" style="margin:6px 0 0">${ICO.info} Letzte aus einem Kontoauszug übernommene Buchung –
      ab hier mit dem nächsten Auszug weitermachen.</p>
  </div>`;
}

// Zeigt bis zu welchem Monat bereits Telekom-Rechnungen importiert wurden
// (höchster Leistungsmonat + Rechnungsdatum dieser Rechnung). Leer, wenn keine.
function latestInvoiceLine() {
  const list = state.invoices || [];
  if (!list.length) return '';
  const latest = list.reduce((a, b) =>
    String(b.month || '').localeCompare(String(a.month || '')) > 0 ? b : a);
  const dateStr = latest.date ? ` · Rechnungsdatum ${escapeHtml(fmtDate(latest.date))}` : '';
  return `<div class="card">
    <div class="cost-row static"><span>Rechnungen importiert bis</span>
      <b>${escapeHtml(monthLabel(latest.month))}</b></div>
    <p class="muted small" style="margin:6px 0 0">${ICO.info} ${list.length} Rechnung(en) gesamt${dateStr}.
      Verwaltung unter <b>Kosten → Rechnungen</b>.</p>
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
      <small>${p.category ? escapeHtml(p.category) + ' · ' : ''}Soll ${exp > 0 ? fmtEUR(exp) : '–'}${a && !booked ? ` · erkannt: ${escapeHtml(a.txn.name || a.txn.purpose || 'Eingang')}` : ''}</small></div>
    <div class="imp-right">${right}</div>
  </div>`;
}

function unmatchedRow(txn) {
  return `<div class="imp-row">
    <span class="dash-dot" style="--sc:#5b6270"></span>
    <div class="dash-meta"><b>${fmtEUR(txn.amount)}</b>
      <small>${escapeHtml(fmtDate(txn.date))} · ${escapeHtml(txn.name || '—')}${txn.purpose ? ' · ' + escapeHtml(txn.purpose) : ''}</small></div>
    <div class="imp-right" style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end">
      <button class="btn btn-sm btn-ghost" onclick="assignUnmatched('${txn.id}')">Zuordnen</button>
      <button class="btn btn-sm btn-ghost" onclick="splitUnmatched('${txn.id}')" title="Auf mehrere Kategorien aufteilen">Aufteilen</button>
      <button class="btn btn-sm btn-ghost" onclick="declareIncome('${txn.id}')" title="Als regelmäßige Einnahme anlegen">+ Einnahme</button>
    </div>
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
      persistTxns(txns);
      save();
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
        ${escapeHtml(p.name || '(ohne Name)')}${p.category ? ` · ${escapeHtml(p.category)}` : ''}<span class="muted small">${fmtEUR(expectedForMonth(p, importMonth))}</span></button>`).join('')
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

// Einen (nicht zugeordneten) Eingang als neue, wiederkehrende Einnahme deklarieren
// (z. B. Spotify/Netflix). Legt eine Person ohne Karten an, bucht die Zahlung und
// lernt die IBAN, damit künftige Monate automatisch geprüft werden.
export function declareIncome(txnId) {
  const txn = (result && result.unmatched.find((t) => t.id === txnId)) || parsed.txns.find((t) => t.id === txnId);
  if (!txn) return;
  const nm = txn.name || txn.purpose || '';
  // Auswahl = bereits vergebene Kategorien + Standardvorschläge (dedupe, Reihenfolge erhalten).
  const catOpts = [...new Set([...state.people.map((p) => p.category).filter(Boolean), 'Mobilfunk', 'Spotify', 'Netflix', 'Sonstiges'])];
  const hay = `${txn.name || ''} ${txn.purpose || ''}`.toLowerCase();
  const guess = catOpts.find((c) => hay.includes(c.toLowerCase())) || '';
  openModal('Als regelmäßige Einnahme anlegen', `
    <p class="muted small" style="margin:0 0 12px">${escapeHtml(fmtDate(txn.date))} · ${escapeHtml(txn.name || '—')}${txn.purpose ? ' · ' + escapeHtml(txn.purpose) : ''} · <b>${fmtEUR(txn.amount)}</b></p>
    <form id="incomeForm" onsubmit="return false">
      <label class="fld"><span>Name / Bezeichnung</span><input name="name" type="text" value="${escapeHtml(nm)}" placeholder="z. B. Spotify – Max"></label>
      <div class="fld-row">
        <label class="fld"><span>Kategorie</span><input name="category" type="text" list="incCatList" value="${escapeHtml(guess)}" placeholder="z. B. Spotify"></label>
        <label class="fld"><span>Erwartet (€)</span><input name="amount" type="text" inputmode="decimal" value="${String(txn.amount).replace('.', ',')}"></label>
      </div>
      <datalist id="incCatList">${catOpts.map((c) => `<option value="${escapeHtml(c)}"></option>`).join('')}</datalist>
      <label class="fld"><span>Rhythmus</span><select name="schedule">${SCHEDULES.filter((s) => s.id !== 'none').map((s) => `<option value="${s.id}" ${s.id === 'monthly' ? 'selected' : ''}>${escapeHtml(s.label)}</option>`).join('')}</select></label>
      <p class="muted small" style="margin:2px 0 0">Wird als Einnahme ab ${escapeHtml(monthLabel(importMonth))} angelegt, die Zahlung diesem Monat gutgeschrieben und die IBAN für künftige Monate gelernt. Karten/SIM sind nicht nötig.</p>
      <div class="modal-actions" style="margin-top:12px">
        <button type="button" class="btn btn-ghost" onclick="closeModal()">Abbrechen</button>
        <button type="button" class="btn btn-primary" onclick="saveIncome('${txn.id}')">Anlegen &amp; buchen</button>
      </div>
    </form>`);
}

export function saveIncome(txnId) {
  const form = document.getElementById('incomeForm');
  const txn = parsed && parsed.txns.find((t) => t.id === txnId);
  if (!form || !txn) return;
  const fd = new FormData(form);
  const name = (fd.get('name') || '').toString().trim();
  if (!name) { toast('Bitte einen Namen angeben', 'err'); return; }
  const amount = parseEUR((fd.get('amount') || '0').toString()) || 0;
  const category = (fd.get('category') || '').toString().trim();
  const schedule = (fd.get('schedule') || 'monthly').toString();
  const iban = normalizeIban(txn.iban);
  const person = {
    id: 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name, category, ibans: (iban && !isSharedIban(iban)) ? [txn.iban] : [],
    paymentMethod: 'ueberweisung', schedule, dayOfMonth: 1, anchorMonth: '',
    startMonth: importMonth, expectedAmount: amount, amountChanges: [], cards: [], notes: ''
  };
  // Anonyme Sammel-IBAN (PayPal/Netflix) als Hinweis lernen statt als feste IBAN.
  if (iban && isSharedIban(iban)) person.payAliases = [{ iban: txn.iban, amount: txn.amount }];
  state.people.push(person);
  setReceived(person.id, importMonth, { received: txn.amount, receivedDate: txn.date, matchedTxnId: txn.id });
  save();
  closeModal();
  recompute();
  afterChange();
  toast('Einnahme angelegt & gebucht', 'ok');
}

// ---- Eingang auf mehrere Kategorien/Einträge aufteilen --------------------
let splitState = null;

function splitTxn() {
  return splitState && findAnyTxn(splitState.txnId);
}
function splitPeopleOptions(sel) {
  const people = [...state.people].sort((a, b) => (a.name || '').localeCompare(b.name || '', 'de'));
  return `<option value="">— Person / Kategorie —</option>` + people.map((p) =>
    `<option value="${p.id}" ${sel === p.id ? 'selected' : ''}>${escapeHtml((p.name || '(ohne Name)') + (p.category ? ' · ' + p.category : ''))}</option>`).join('');
}
function splitModalHtml(txn) {
  const m = splitState.month || importMonth;
  const rows = splitState.rows.map((r, i) => `
    <div class="fld-row" style="align-items:flex-end">
      <label class="fld" style="flex:2"><span>Person / Kategorie</span><select name="split_${i}_person">${splitPeopleOptions(r.personId)}</select></label>
      <label class="fld"><span>Betrag (€)</span><input name="split_${i}_amount" type="text" inputmode="decimal" value="${r.amount ? String(r.amount).replace('.', ',') : ''}"></label>
      <button type="button" class="icon-btn danger" onclick="removeSplitRow(${i})" aria-label="Zeile entfernen">${ICO.trash}</button>
    </div>`).join('');
  return `
    <p class="muted small" style="margin:0 0 10px">${escapeHtml(fmtDate(txn.date))} · ${escapeHtml(txn.name || '—')}${txn.purpose ? ' · ' + escapeHtml(txn.purpose) : ''} · gesamt <b>${fmtEUR(txn.amount)}</b> · Monat ${escapeHtml(monthLabel(m))}</p>
    <form id="splitForm" onsubmit="return false">
      ${rows}
      <button type="button" class="btn btn-ghost btn-sm" onclick="addSplitRow()">${ICO.plus} Zeile</button>
      <p class="muted small" style="margin:8px 0 0">Jede Zeile wird dem gewählten Eintrag (Person + Kategorie) im Monat ${escapeHtml(monthLabel(m))} gutgeschrieben.</p>
      <div class="modal-actions" style="margin-top:12px">
        <button type="button" class="btn btn-ghost" onclick="closeModal()">Abbrechen</button>
        <button type="button" class="btn btn-primary" onclick="saveSplit()">Buchen</button>
      </div>
    </form>`;
}
function readSplitDom() {
  const f = document.getElementById('splitForm');
  if (!f || !splitState) return;
  const fd = new FormData(f);
  splitState.rows.forEach((r, i) => {
    r.personId = (fd.get(`split_${i}_person`) || '').toString();
    r.amount = parseEUR((fd.get(`split_${i}_amount`) || '0').toString()) || 0;
  });
}
export function splitUnmatched(txnId) {
  const txn = (result && result.unmatched.find((t) => t.id === txnId)) || parsed.txns.find((t) => t.id === txnId);
  if (!txn) return;
  splitState = { txnId, month: importMonth, rows: [{ personId: '', amount: 0 }, { personId: '', amount: 0 }] };
  openModal('Eingang aufteilen', splitModalHtml(txn), { onClose: () => { splitState = null; } });
}
export function addSplitRow() {
  readSplitDom();
  splitState.rows.push({ personId: '', amount: 0 });
  updateModalBody(splitModalHtml(splitTxn()));
}
export function removeSplitRow(i) {
  readSplitDom();
  splitState.rows.splice(i, 1);
  if (!splitState.rows.length) splitState.rows.push({ personId: '', amount: 0 });
  updateModalBody(splitModalHtml(splitTxn()));
}
export function saveSplit() {
  readSplitDom();
  const txn = splitTxn();
  if (!txn) { closeModal(); return; }
  const month = splitState.month || importMonth;
  let n = 0;
  for (const r of splitState.rows) {
    if (r.personId && r.amount > 0) {
      const prev = getReceived(r.personId, month) || {};
      setReceived(r.personId, month, { received: (Number(prev.received) || 0) + r.amount, receivedDate: txn.date, matchedTxnId: txn.id });
      n++;
    }
  }
  if (!n) { toast('Keine Aufteilung eingetragen', 'err'); return; }
  save();
  if (result) result.unmatched = result.unmatched.filter((t) => t.id !== txn.id);
  splitState = null;
  closeModal();
  afterChange();
  toast(`Auf ${n} Einträge gebucht`, 'ok');
}

// ---- „Alle Eingänge"-Liste: Suche/Filter/Zuordnen -------------------------
export function setTxnQuery(v) {
  txnQuery = v;
  renderImport();
  const el = document.getElementById('txnSearch');
  if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
}
export function setTxnFilter(f) { txnFilter = f; renderImport(); }

export function assignStored(id) {
  const txn = findAnyTxn(id);
  if (!txn) return;
  const m = monthKey(txn.date);
  const people = [...state.people].sort((a, b) => (a.name || '').localeCompare(b.name || '', 'de'));
  openModal(`${fmtEUR(txn.amount)} zuordnen`, `
    <p class="muted small" style="margin:0 0 12px">${escapeHtml(fmtDate(txn.date))} · ${escapeHtml(txn.name || '—')}${txn.purpose ? ' · ' + escapeHtml(txn.purpose) : ''} · Monat ${escapeHtml(monthLabel(m))}</p>
    <div class="pick-list">
      ${people.map((p) => `<button class="pick-row" onclick="assignStoredTo('${txn.id}','${p.id}')">${escapeHtml(p.name || '(ohne Name)')}${p.category ? ` · ${escapeHtml(p.category)}` : ''}<span class="muted small">${fmtEUR(expectedForMonth(p, m))}</span></button>`).join('') || '<p class="muted small">Keine Personen vorhanden.</p>'}
    </div>`);
}
export function assignStoredTo(id, personId) {
  const txn = findAnyTxn(id);
  const person = state.people.find((p) => p.id === personId);
  if (!txn || !person) return;
  const m = monthKey(txn.date);
  const prev = getReceived(personId, m) || {};
  if (prev.matchedTxnId === txn.id) { toast('Dieser Eingang ist hier bereits gebucht', ''); closeModal(); return; }
  setReceived(personId, m, { received: (Number(prev.received) || 0) + txn.amount, receivedDate: txn.date, matchedTxnId: txn.id });
  learnFromAssignment(person, txn);
  save();
  closeModal();
  if (result) result.unmatched = result.unmatched.filter((t) => t.id !== id);
  afterChange();
  toast(`Zugeordnet · ${monthLabel(m)}`, 'ok');
}
export function splitStored(id) {
  const txn = findAnyTxn(id);
  if (!txn) return;
  splitState = { txnId: id, month: monthKey(txn.date), rows: [{ personId: '', amount: 0 }, { personId: '', amount: 0 }] };
  openModal('Eingang aufteilen', splitModalHtml(txn), { onClose: () => { splitState = null; } });
}

function afterChange() {
  renderImport();
  rerenderDashboard();
  renderLedger();
}

Object.assign(window, {
  renderImport, setImportMonth, pickImportFile, bookAssignment, bookAll,
  rejectAssignment, assignUnmatched, assignUnmatchedTo,
  openManualPayment, saveManualPayment, declareIncome, saveIncome,
  splitUnmatched, addSplitRow, removeSplitRow, saveSplit,
  setTxnQuery, setTxnFilter, assignStored, assignStoredTo, splitStored
});
