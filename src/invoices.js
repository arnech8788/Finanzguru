// Telekom-Rechnungen: Liste & Detail als Unter-Ansicht im Kosten-Screen,
// Pro-Person-Abgleich (Rechnung vs. Rückzahlung) und manuelles Zuordnen (gelernt).
// Import läuft über den Import-Tab (Auto-Erkennung in import.js).
import { ICO, escapeHtml, openModal, updateModalBody, closeModal, confirmDialog, toast } from './ui.js';
import { state, save } from './main.js';
import { fmtEUR, fmtDate, monthLabel } from './money.js';
import { reconcileInvoice, resolvePosition, normSim, normPhone } from './invoiceMatch.js';

const RECON = {
  paid: { label: 'ausgeglichen', color: '#2fb86b' },
  open: { label: 'offen', color: '#e23b3b' },
  partial: { label: 'unterdeckt', color: '#f5a623' },
  advance: { label: 'überdeckt', color: '#2d9cdb' }
};

function tol() {
  return (state.settings && state.settings.amountTolerance != null) ? state.settings.amountTolerance : 0.5;
}
function sortedInvoices() {
  return [...(state.invoices || [])].sort((a, b) => String(b.month || '').localeCompare(String(a.month || '')));
}
function findInv(id) {
  return (state.invoices || []).find((i) => i.id === id) || null;
}

// Import-Pfad: dedupe + speichern.
export function storeInvoice(inv) {
  if (!Array.isArray(state.invoices)) state.invoices = [];
  const idx = state.invoices.findIndex((i) => i.id === inv.id);
  const isNew = idx < 0;
  if (isNew) state.invoices.push(inv); else state.invoices[idx] = inv;
  save();
  return { isNew };
}

// Rendert die Rechnungs-Liste in das übergebene Element (vom Kosten-Screen aufgerufen).
export function renderInvoicesInto(el) {
  if (!el) return;
  const list = sortedInvoices();
  if (!list.length) {
    el.innerHTML = `<div class="card"><div class="card-title">Rechnungen</div>
      <p class="muted small" style="margin:0">Noch keine Rechnung importiert. Lade im <b>Import</b>-Tab eine
      Telekom-Mobilfunk-Rechnung (PDF) – sie wird automatisch erkannt und hier mit den Rückzahlungen abgeglichen.</p></div>`;
    return;
  }
  el.innerHTML = `<div class="card"><div class="card-title">Rechnungen (${list.length})</div>
    <div class="imp-list">${list.map(rowHtml).join('')}</div>
    <p class="muted small" style="margin:10px 0 0">${ICO.shield} Rechnungen liegen nur lokal. Import über den <b>Import</b>-Tab.</p>
  </div>`;
}

function rowHtml(inv) {
  const r = reconcileInvoice(inv, state.people, state.ledger, state.invoiceMap, tol());
  const open = r.rows.filter((x) => x.status === 'open' || x.status === 'partial').length;
  const un = r.unassigned.length;
  const neg = (Number(inv.total) || 0) < 0;
  const sub = [];
  if (open) sub.push(`${open} offen`);
  if (un) sub.push(`${un} unklar`);
  if (!sub.length) sub.push('ausgeglichen');
  return `<div class="imp-row" onclick="openInvoiceDetail('${inv.id}')" style="cursor:pointer">
    <span class="dash-dot" style="--sc:${neg ? '#2d9cdb' : '#2fb86b'}"></span>
    <div class="dash-meta"><b>${escapeHtml(monthLabel(inv.month))}</b>
      <small>${(inv.positions || []).length} Karten · ${escapeHtml(sub.join(' · '))}</small></div>
    <div class="imp-right"><b class="${neg ? 'warn-text' : ''}">${fmtEUR(inv.total)}</b></div>
  </div>`;
}

// ---- Detailansicht (Modal) ------------------------------------------------
export function openInvoiceDetail(id) {
  const inv = findInv(id);
  if (!inv) return;
  openModal(`Rechnung ${monthLabel(inv.month)}`, detailHtml(inv));
}

function detailHtml(inv) {
  const r = reconcileInvoice(inv, state.people, state.ledger, state.invoiceMap, tol());
  const neg = (Number(inv.total) || 0) < 0;

  const overview = `<div class="card" style="margin-top:0">
    <div class="cost-row static"><span>Rechnungsdatum</span><b>${escapeHtml(fmtDate(inv.date)) || '–'}</b></div>
    <div class="cost-row static"><span>Rechnungsnummer</span><b>${escapeHtml(inv.invoiceNumber || '–')}</b></div>
    <div class="cost-row static"><span>Grundpreise</span><b>${fmtEUR(inv.grundpreise)}</b></div>
    ${inv.gutschriften != null ? `<div class="cost-row static"><span>Gutschriften</span><b>${fmtEUR(inv.gutschriften)}</b></div>` : ''}
    <div class="cost-total"><span>Rechnungsbetrag</span><b class="${neg ? 'neg' : ''}">${fmtEUR(inv.total)}</b></div>
  </div>`;

  const reconRows = r.rows.map((x) => {
    const meta = RECON[x.status] || RECON.paid;
    const diffStr = `${x.diff > 0 ? '+' : ''}${fmtEUR(x.diff)}`;
    return `<div class="imp-row" style="--sc:${meta.color}"><span class="dash-dot"></span>
      <div class="dash-meta"><b>${escapeHtml(x.name)}</b><small>Rechnung ${fmtEUR(x.invoiced)} · erhalten ${fmtEUR(x.received)}</small></div>
      <div class="imp-right"><span class="status-badge" style="--sc:${meta.color}">${escapeHtml(meta.label)}</span>
        <small>${escapeHtml(diffStr)}</small></div></div>`;
  }).join('') || '<p class="muted small">Noch keine Position einer Person zugeordnet.</p>';

  const reconSum = `<div class="cost-row static"><span>Σ Rechnung (Karten)</span><b>${fmtEUR(r.sumInvoiced)}</b></div>
    <div class="cost-row static"><span>Σ erhalten (${escapeHtml(monthLabel(inv.month))})</span><b>${fmtEUR(r.sumReceived)}</b></div>`;

  const posRows = (inv.positions || []).map((pos, idx) => {
    const pid = resolvePosition(pos, state.people, state.invoiceMap);
    const person = pid ? state.people.find((p) => p.id === pid) : null;
    const right = person
      ? `<span class="status-badge" style="--sc:#2fb86b">${escapeHtml(person.name || '?')}</span>`
      : `<button class="btn btn-sm btn-ghost" onclick="assignInvoicePos('${inv.id}',${idx})">→ zuordnen</button>`;
    const credits = pos.credits ? ` · Gutschrift ${fmtEUR(pos.credits)}` : '';
    return `<div class="imp-row"><span class="dash-dot" style="--sc:${person ? '#2fb86b' : '#5b6270'}"></span>
      <div class="dash-meta"><b>${escapeHtml(pos.phone || pos.simNr || 'Karte')}</b>
        <small>Grundpreis ${fmtEUR(pos.charges)}${credits} · netto ${fmtEUR(pos.subtotal)}</small></div>
      <div class="imp-right">${right}</div></div>`;
  }).join('');

  const unassignedNote = r.unassigned.length
    ? `<p class="muted small" style="margin:8px 0 0">${ICO.info} ${r.unassigned.length} Position(en) noch ohne Person – oben „→ zuordnen" wählen (wird für nächste Rechnungen gelernt).</p>` : '';

  return `${overview}
    <div class="section-label">Abgleich pro Person</div>
    <div class="imp-list">${reconRows}</div>
    <div class="card">${reconSum}</div>
    <div class="section-label">Positionen (${(inv.positions || []).length})</div>
    <div class="imp-list">${posRows}</div>
    ${unassignedNote}
    <div class="modal-actions" style="margin-top:14px">
      <button class="btn btn-danger" onclick="deleteInvoice('${inv.id}')">${ICO.trash} Rechnung löschen</button>
    </div>`;
}

// ---- Zuordnung (lernt in invoiceMap) --------------------------------------
export function assignInvoicePos(invId, idx) {
  const inv = findInv(invId);
  if (!inv) return;
  const pos = inv.positions[idx];
  if (!pos) return;
  const people = [...state.people].sort((a, b) => (a.name || '').localeCompare(b.name || '', 'de'));
  openModal('Position zuordnen', `
    <p class="muted small" style="margin:0 0 12px">${escapeHtml(pos.phone || '')}${pos.simNr ? ' · ' + escapeHtml(pos.simNr) : ''} · netto ${fmtEUR(pos.subtotal)}</p>
    <div class="pick-list">
      ${people.map((p) => `<button class="pick-row" onclick="assignInvoicePosTo('${invId}',${idx},'${p.id}')">${escapeHtml(p.name || '(ohne Name)')}</button>`).join('')
      || '<p class="muted small">Keine Personen vorhanden. Lege zuerst unter „Personen" jemanden an.</p>'}
    </div>
    <div class="modal-actions" style="margin-top:12px"><button class="btn btn-ghost" onclick="openInvoiceDetail('${invId}')">Zurück</button></div>`);
}

export function assignInvoicePosTo(invId, idx, personId) {
  const inv = findInv(invId);
  if (!inv) return;
  const pos = inv.positions[idx];
  if (!pos) return;
  if (!state.invoiceMap || typeof state.invoiceMap !== 'object') state.invoiceMap = {};
  const ks = normSim(pos.simNr);
  const kp = normPhone(pos.phone);
  if (ks) state.invoiceMap['sim:' + ks] = personId;
  if (kp) state.invoiceMap['tel:' + kp] = personId;
  save();
  toast('Zugeordnet', 'ok');
  updateModalBody(detailHtml(inv), `Rechnung ${monthLabel(inv.month)}`);
  if (window.renderCosts) window.renderCosts();
}

export async function deleteInvoice(id) {
  const inv = findInv(id);
  if (!inv) return;
  const ok = await confirmDialog(
    `Rechnung „${monthLabel(inv.month)}" löschen? Ledger, Personen und gelernte Zuordnungen bleiben unverändert.`,
    { okLabel: 'Löschen', danger: true });
  if (!ok) return;
  state.invoices = (state.invoices || []).filter((i) => i.id !== id);
  save();
  closeModal();
  if (window.renderCosts) window.renderCosts();
  toast('Rechnung gelöscht');
}

Object.assign(window, {
  openInvoiceDetail, assignInvoicePos, assignInvoicePosTo, deleteInvoice
});
