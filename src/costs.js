// Kostenrechnung: monatliche Vertragskosten gegen erwartete Einnahmen (Marge).
// Zusätzlich Unter-Tab „Rechnungen" (importierte Telekom-Rechnungen + Abgleich).
import { ICO, escapeHtml, toast } from './ui.js';
import { state, save } from './main.js';
import { fmtEUR, parseEUR } from './money.js';
import { renderInvoicesInto } from './invoices.js';

let costsTab = 'kosten'; // 'kosten' | 'rechnungen'
export function setCostsTab(tab) {
  costsTab = tab === 'rechnungen' ? 'rechnungen' : 'kosten';
  renderCosts();
}

const FIELDS = [
  { key: 'grundgebuehr', label: 'Grundgebühr (gesamt)' },
  { key: 'plusKarteMonatlich', label: 'PlusKarten monatlich (gesamt)' },
  { key: 'multiSimMonatlich', label: 'MultiSIM monatlich (gesamt)' },
  { key: 'sonstige', label: 'Sonstige Kosten' },
  { key: 'aufschlagJeSim', label: 'Aufschlag je SIM (Variante, €)' }
];

function cardCounts() {
  let plus = 0, multi = 0, total = 0;
  for (const p of state.people) for (const c of (p.cards || [])) {
    total++;
    if (c.type === 'pluskarte') plus++; else multi++;
  }
  return { plus, multi, total };
}

function incomeSum() {
  return state.people.reduce((s, p) => s + (Number(p.expectedAmount) || 0), 0);
}

function planCost() {
  const c = state.costs || {};
  const { total } = cardCounts();
  return (Number(c.grundgebuehr) || 0)
    + (Number(c.plusKarteMonatlich) || 0)
    + (Number(c.multiSimMonatlich) || 0)
    + (Number(c.sonstige) || 0)
    + (Number(c.aufschlagJeSim) || 0) * total;
}

export function updateCost(key, value) {
  if (!state.costs) state.costs = {};
  state.costs[key] = parseEUR(value) || 0;
  save();
  renderCosts();
}

export function renderCosts() {
  const el = document.getElementById('screen-costs');
  if (!el) return;
  const c = state.costs || {};
  const counts = cardCounts();
  const income = incomeSum();
  const cost = planCost();
  const margin = income - cost;

  const nInv = (state.invoices || []).length;
  const seg = `<div class="seg">
    <button class="seg-btn ${costsTab === 'kosten' ? 'active' : ''}" onclick="setCostsTab('kosten')">Kosten</button>
    <button class="seg-btn ${costsTab === 'rechnungen' ? 'active' : ''}" onclick="setCostsTab('rechnungen')">Rechnungen${nInv ? ` (${nInv})` : ''}</button>
  </div>`;

  if (costsTab === 'rechnungen') {
    el.innerHTML = `
      <header class="topbar"><h1>Kosten</h1></header>
      <div class="pad">${seg}<div id="costs-invoices"></div></div>`;
    renderInvoicesInto(document.getElementById('costs-invoices'));
    return;
  }

  el.innerHTML = `
    <header class="topbar"><h1>Kosten</h1></header>
    <div class="pad">
      ${seg}
      <div class="tiles">
        <div class="tile"><span class="tile-k">Kosten/Monat</span><span class="tile-v">${fmtEUR(cost)}</span></div>
        <div class="tile tile-ok"><span class="tile-k">Einnahmen/Monat</span><span class="tile-v">${fmtEUR(income)}</span></div>
        <div class="tile ${margin < 0 ? 'tile-warn' : 'tile-ok'}"><span class="tile-k">Saldo/Marge</span><span class="tile-v">${fmtEUR(margin)}</span></div>
      </div>

      <div class="card">
        <div class="card-title">Vertragskosten (editierbar)</div>
        ${FIELDS.map((f) => `
          <label class="cost-row">
            <span>${escapeHtml(f.label)}</span>
            <input type="text" inputmode="decimal" value="${c[f.key] != null ? String(c[f.key]).replace('.', ',') : ''}"
                   placeholder="0" onchange="updateCost('${f.key}', this.value)">
          </label>`).join('')}
        <div class="cost-total"><span>Summe Kosten</span><b>${fmtEUR(cost)}</b></div>
      </div>

      <div class="card">
        <div class="card-title">Einnahmen (automatisch aus „Personen")</div>
        <div class="cost-row static"><span>${state.people.length} Personen · monatlicher Anteil gesamt</span><b>${fmtEUR(income)}</b></div>
        <div class="cost-row static"><span>Karten gesamt</span><b>${counts.total} (${counts.plus} PlusKarte, ${counts.multi} MultiSIM)</b></div>
      </div>

      <div class="card">
        <div class="card-title">Ergebnis</div>
        <div class="cost-total ${margin < 0 ? 'neg' : 'pos'}"><span>Monatlicher Saldo</span><b>${fmtEUR(margin)}</b></div>
        <p class="muted small" style="margin:10px 0 0">${ICO.info} Variante „nach 24 Monaten ohne Cashback": trage den Aufschlag je SIM (z. B. 1 € oder 2 €) oben ein – er wird mit der Kartenzahl (${counts.total}) multipliziert.</p>
      </div>
    </div>`;
}

Object.assign(window, { renderCosts, updateCost, setCostsTab });
