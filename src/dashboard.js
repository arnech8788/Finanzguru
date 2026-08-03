// Übersicht: Zahlungsstatus des gewählten Monats – wer ist offen, wer hat gezahlt.
import { ICO, escapeHtml } from './ui.js';
import { state } from './main.js';
import { fmtEUR, monthLabel, currentMonth, shiftMonth } from './money.js';
import { scheduleLabel } from './data/schedules.js';
import { statusFor, getReceived, STATUS, openLedgerCell, markCellPaid, effectiveExpected } from './ledger.js';

let dashMonth = currentMonth();
let onlyOpen = false;
let dashCategory = '';   // '' = alle Kategorien
let lastCats = [];       // im Render gefüllt, für index-basierte Auswahl

const ORDER = { open: 0, partial: 1, none: 2, advance: 3, paid: 4 };
const catOf = (p) => p.category || 'Ohne Kategorie';

export function setDashMonth(delta) {
  dashMonth = shiftMonth(dashMonth, delta);
  renderDashboard();
}
export function setDashFilter(open) {
  onlyOpen = open;
  renderDashboard();
}
export function setDashCategory(i) {
  dashCategory = (i < 0 || i >= lastCats.length) ? '' : lastCats[i];
  renderDashboard();
}

export function renderDashboard() {
  const el = document.getElementById('screen-dashboard');
  if (!el) return;
  const month = dashMonth;
  // Kategorien aus allen Personen (für die Filter-Chips); 'Ohne Kategorie' ans Ende.
  const cats = [...new Set(state.people.map(catOf))]
    .sort((a, b) => (a === 'Ohne Kategorie' ? 1 : b === 'Ohne Kategorie' ? -1 : a.localeCompare(b, 'de')));
  lastCats = cats;
  if (dashCategory && !cats.includes(dashCategory)) dashCategory = '';
  const people = dashCategory ? state.people.filter((p) => catOf(p) === dashCategory) : [...state.people];

  let sollSum = 0, istSum = 0, offenSum = 0, offenCount = 0, paidCount = 0;
  const rows = [];
  for (const person of people) {
    const exp = effectiveExpected(person, month);
    const entry = getReceived(person.id, month);
    const rec = entry ? Number(entry.received) || 0 : 0;
    const st = statusFor(person, month);
    sollSum += exp;
    istSum += rec;
    if (st === 'open' || st === 'partial') { offenSum += Math.max(0, exp - rec); offenCount++; }
    if (st === 'paid' || st === 'advance') paidCount++;
    rows.push({ person, exp, rec, st });
  }
  rows.sort((a, b) => (ORDER[a.st] - ORDER[b.st]) || (a.person.name || '').localeCompare(b.person.name || '', 'de'));
  const shown = onlyOpen ? rows.filter((r) => r.st === 'open' || r.st === 'partial') : rows;

  el.innerHTML = `
    <header class="topbar"><h1>Übersicht</h1></header>
    <div class="pad">
      <div class="month-switch">
        <button class="icon-btn" onclick="setDashMonth(-1)" aria-label="Vormonat">${ICO.chevL}</button>
        <span class="month-label">${escapeHtml(monthLabel(month))}</span>
        <button class="icon-btn" onclick="setDashMonth(1)" aria-label="Folgemonat">${ICO.chevR}</button>
      </div>

      ${cats.length > 1 ? `<div class="cat-chips" style="margin-bottom:10px">
        <button class="catchip ${!dashCategory ? 'catchip-active' : ''}" onclick="setDashCategory(-1)">Alle Kategorien</button>
        ${cats.map((c, i) => `<button class="catchip ${dashCategory === c ? 'catchip-active' : ''}" onclick="setDashCategory(${i})">${escapeHtml(c)}</button>`).join('')}
      </div>` : ''}

      <div class="tiles">
        <div class="tile"><span class="tile-k">Soll</span><span class="tile-v">${fmtEUR(sollSum)}</span></div>
        <div class="tile tile-ok"><span class="tile-k">Erhalten</span><span class="tile-v">${fmtEUR(istSum)}</span></div>
        <div class="tile ${offenSum > 0.009 ? 'tile-warn' : ''}"><span class="tile-k">Offen</span><span class="tile-v">${fmtEUR(offenSum)}</span></div>
      </div>

      ${people.length === 0 ? emptyDash() : `
      <div class="cat-chips">
        <button class="catchip ${!onlyOpen ? 'catchip-active' : ''}" onclick="setDashFilter(false)">Alle <span class="cc-count">${rows.length}</span></button>
        <button class="catchip ${onlyOpen ? 'catchip-active' : ''}" style="--cc:${STATUS.open.color}" onclick="setDashFilter(true)">Offen <span class="cc-count">${offenCount}</span></button>
        <span class="chip-spacer"></span>
        <button class="catchip" style="--cc:${STATUS.paid.color}" onclick="showScreen('import')">${ICO.upload} Import</button>
      </div>
      <div class="dash-list">
        ${shown.length ? shown.map(dashRow).join('') : `<div class="empty"><p class="muted">Nichts offen 🎉</p></div>`}
      </div>`}
    </div>`;
}

function dashRow({ person, exp, rec, st }) {
  const meta = STATUS[st];
  const sub = exp > 0
    ? `Soll ${fmtEUR(exp)}${rec > 0 ? ` · erhalten ${fmtEUR(rec)}` : ''}`
    : (st === 'advance' ? 'im Voraus abgedeckt' : (rec > 0 ? `erhalten ${fmtEUR(rec)}` : 'in diesem Monat nicht fällig'));
  const canQuickPay = st === 'open' || st === 'partial';
  return `
    <div class="dash-row" style="--sc:${meta.color}">
      <button class="dash-main" onclick="openLedgerCell('${person.id}','${dashMonth}')">
        <span class="dash-dot"></span>
        <span class="dash-meta">
          <b>${escapeHtml(person.name || '(ohne Name)')}</b>
          <small>${escapeHtml(sub)} · ${escapeHtml(scheduleLabel(person.schedule))}</small>
        </span>
        <span class="status-badge" style="--sc:${meta.color}">${escapeHtml(meta.label)}</span>
      </button>
      ${canQuickPay ? `<button class="dash-pay" title="Soll als erhalten buchen" onclick="markCellPaid('${person.id}','${dashMonth}')">${ICO.check}</button>` : ''}
    </div>`;
}

function emptyDash() {
  return `<div class="empty">${ICO.users}<p>Noch keine Personen.</p>
    <p class="muted small">Lege unter „Personen" Beitragszahler an – oder importiere deine vorbereiteten Daten unter „Mehr → Daten".</p>
    <button class="btn btn-primary" style="margin-top:14px" onclick="showScreen('people')">${ICO.plus} Person anlegen</button></div>`;
}

// Erlaubt anderen Modulen, die Übersicht neu zu zeichnen, wenn sie sichtbar ist.
export function dashboardMonth() { return dashMonth; }

Object.assign(window, { renderDashboard, setDashMonth, setDashFilter, setDashCategory });
