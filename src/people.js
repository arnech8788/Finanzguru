// Personen/Beitragszahler: anlegen, bearbeiten, Karten/SIM-Inventar pflegen.
import { ICO, escapeHtml, highlight, openModal, closeModal, updateModalBody, confirmDialog, toast } from './ui.js';
import { state, save, rerenderDashboard } from './main.js';
import { fmtEUR, parseEUR, fmtDate, currentMonth } from './money.js';
import { PAYMENT_METHODS, paymentMethodLabel } from './data/paymentMethods.js';
import { SCHEDULES, scheduleLabel, expectedForMonth } from './data/schedules.js';
import { CARD_TYPES, cardTypeLabel, SIM_KINDS, simKindLabel } from './data/cardTypes.js';
import { statusFor, STATUS, renderLedger } from './ledger.js';

let filter = { query: '' };
let draft = null; // aktuell bearbeitete Person (Arbeitskopie)

function uid() {
  return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}
function newCard() {
  return { type: 'multisim', phone: '', simNr: '', auftragsNr: '', owner: '', simKind: 'sim', activeSince: '', runtimeUntil: '', idDoc: '', notes: '' };
}
function blankPerson() {
  return { id: uid(), name: '', ibans: [], paymentMethod: 'ueberweisung', schedule: 'monthly', dayOfMonth: 1, anchorMonth: '', expectedAmount: 0, cards: [], notes: '' };
}

export function setPeopleSearch(q) {
  filter.query = q;
  renderPeople({ keepFocus: true });
}

export function renderPeople(opts = {}) {
  const el = document.getElementById('screen-people');
  if (!el) return;
  const q = filter.query.trim().toLowerCase();
  let people = [...state.people].sort((a, b) => (a.name || '').localeCompare(b.name || '', 'de'));
  if (q) {
    people = people.filter((p) =>
      ((p.name || '') + ' ' + (p.notes || '') + ' ' + (p.ibans || []).join(' ') + ' ' +
        (p.cards || []).map((c) => `${c.phone} ${c.simNr} ${c.auftragsNr} ${c.owner}`).join(' ')).toLowerCase().includes(q));
  }
  const month = currentMonth();
  el.innerHTML = `
    <header class="topbar"><h1>Personen</h1></header>
    <div class="pad">
      <div class="search-wrap">
        ${ICO.search}
        <input id="peopleSearch" type="search" placeholder="Name, IBAN, Telefon, SIM…"
               value="${escapeHtml(filter.query)}" oninput="setPeopleSearch(this.value)" autocomplete="off">
      </div>
      ${people.length ? people.map((p) => personCard(p, q, month)).join('') : emptyPeople()}
    </div>
    <button class="fab" onclick="newPerson()" aria-label="Neue Person">${ICO.plus}</button>`;
  if (opts.keepFocus) {
    const inp = document.getElementById('peopleSearch');
    if (inp) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
  }
}

function personCard(p, q, month) {
  const st = statusFor(p, month);
  const meta = STATUS[st];
  const cards = (p.cards || []);
  const cardSummary = cards.length
    ? cards.map((c) => cardTypeLabel(c.type)).join(', ')
    : 'keine Karte';
  const amt = Number(p.expectedAmount) || 0;
  return `
    <div class="person-card" onclick="openPerson('${p.id}')" style="--sc:${meta.color}">
      <span class="dash-dot" title="${escapeHtml(meta.label)}"></span>
      <div class="pc-main">
        <div class="pc-title">${highlight(escapeHtml(p.name || '(ohne Name)'), q)}</div>
        <div class="pc-sub">${amt ? fmtEUR(amt) + ' · ' : ''}${escapeHtml(scheduleLabel(p.schedule))} · ${escapeHtml(paymentMethodLabel(p.paymentMethod))}</div>
        <div class="pc-meta">${ICO.sim} ${escapeHtml(cardSummary)}</div>
      </div>
    </div>`;
}

function emptyPeople() {
  return `<div class="empty">${ICO.users}<p>Noch keine Personen angelegt.</p>
    <p class="muted small">Lege Beitragszahler an oder importiere deine vorbereiteten Daten unter „Mehr → Daten".</p></div>`;
}

// ---- Detailansicht --------------------------------------------------------
export function openPerson(id) {
  const p = state.people.find((x) => x.id === id);
  if (!p) return;
  openModal(p.name || 'Person', personViewHtml(p));
}

function refreshPersonView(id) {
  const p = state.people.find((x) => x.id === id);
  if (p) updateModalBody(personViewHtml(p), p.name || 'Person');
}

function personViewHtml(p) {
  const amt = Number(p.expectedAmount) || 0;
  const exp = expectedForMonth(p, currentMonth());
  const cards = (p.cards || []);
  return `
    <div class="person-view">
      <div class="pv-grid">
        <div><span class="muted small">Monatlicher Anteil</span><b>${amt ? fmtEUR(amt) : '–'}</b></div>
        <div><span class="muted small">Rhythmus</span><b>${escapeHtml(scheduleLabel(p.schedule))}</b></div>
        <div><span class="muted small">Zahlart</span><b>${escapeHtml(paymentMethodLabel(p.paymentMethod))}</b></div>
        <div><span class="muted small">Soll diesen Monat</span><b>${exp > 0 ? fmtEUR(exp) : '–'}</b></div>
      </div>
      ${p.notes ? `<div class="pv-block"><span class="muted small">Notiz</span><p style="white-space:pre-wrap;margin:4px 0 0">${escapeHtml(p.notes)}</p></div>` : ''}
      <div class="pv-block">
        <span class="muted small">Karten / SIM (${cards.length})</span>
        ${cards.length ? cards.map(cardView).join('') : '<p class="muted small" style="margin:6px 0 0">Keine Karten hinterlegt.</p>'}
      </div>
      ${learnedSection(p)}
      <div class="modal-actions" style="margin-top:18px">
        <button class="btn btn-danger" onclick="deletePerson('${p.id}')">${ICO.trash} Löschen</button>
        <button class="btn btn-primary" onclick="editPerson('${p.id}')">${ICO.edit} Bearbeiten</button>
      </div>
    </div>`;
}

// Gelernte Abgleich-Daten anzeigen + einzeln/komplett entfernbar machen.
function learnedSection(p) {
  const ibans = p.ibans || [];
  const na = p.nameAliases || [];
  const pa = p.payAliases || [];
  if (!ibans.length && !na.length && !pa.length) {
    return `<div class="pv-block"><span class="muted small">Gelernt für den Abgleich</span>
      <p class="muted small" style="margin:4px 0 0">Noch nichts gelernt. Beim Zuordnen von DKB-Eingängen merkt sich die App IBAN, Namensvarianten und PayPal-Hinweise.</p></div>`;
  }
  const chip = (label, handler) => `<span class="learn-chip">${escapeHtml(label)}<button type="button" aria-label="entfernen" onclick="${handler}">${ICO.x}</button></span>`;
  const parts = [];
  if (ibans.length) parts.push(`<div class="learn-row"><span class="learn-k">IBAN</span><div class="learn-chips">${ibans.map((ib, i) => chip(ib, `removePersonIban('${p.id}',${i})`)).join('')}</div></div>`);
  if (na.length) parts.push(`<div class="learn-row"><span class="learn-k">Namensvarianten</span><div class="learn-chips">${na.map((n, i) => chip(n, `removeNameAlias('${p.id}',${i})`)).join('')}</div></div>`);
  if (pa.length) parts.push(`<div class="learn-row"><span class="learn-k">PayPal-/Anonym-Hinweise</span><div class="learn-chips">${pa.map((a, i) => chip(`${fmtEUR(a.amount)}`, `removePayAlias('${p.id}',${i})`)).join('')}</div></div>`);
  return `<div class="pv-block">
    <span class="muted small">Gelernt für den Abgleich</span>
    ${parts.join('')}
    <button class="link-reset" onclick="resetLearned('${p.id}')">${ICO.trash} Alle gelernten Zuordnungen zurücksetzen</button>
  </div>`;
}

export function removePersonIban(id, i) {
  const p = state.people.find((x) => x.id === id);
  if (!p || !Array.isArray(p.ibans)) return;
  p.ibans.splice(i, 1);
  save();
  refreshPersonView(id);
  toast('IBAN entfernt');
}
export function removeNameAlias(id, i) {
  const p = state.people.find((x) => x.id === id);
  if (!p || !Array.isArray(p.nameAliases)) return;
  p.nameAliases.splice(i, 1);
  save();
  refreshPersonView(id);
  toast('Namensvariante entfernt');
}
export function removePayAlias(id, i) {
  const p = state.people.find((x) => x.id === id);
  if (!p || !Array.isArray(p.payAliases)) return;
  p.payAliases.splice(i, 1);
  save();
  refreshPersonView(id);
  toast('Hinweis entfernt');
}
export async function resetLearned(id) {
  const p = state.people.find((x) => x.id === id);
  if (!p) return;
  const ok = await confirmDialog('Alle gelernten Zuordnungen dieser Person zurücksetzen? (IBANs, Namensvarianten und PayPal-Hinweise – die Person und ihre Zahlungen bleiben erhalten.)', { okLabel: 'Zurücksetzen', danger: true });
  if (!ok) return;
  p.ibans = [];
  p.nameAliases = [];
  p.payAliases = [];
  save();
  refreshPersonView(id);
  toast('Gelernte Daten zurückgesetzt');
}

function cardView(c) {
  const lines = [];
  if (c.phone) lines.push(`Tel: ${escapeHtml(c.phone)}`);
  if (c.owner) lines.push(`Besitzer: ${escapeHtml(c.owner)}`);
  if (c.simNr) lines.push(`SIM: ${escapeHtml(c.simNr)}`);
  if (c.auftragsNr) lines.push(`Auftrag: ${escapeHtml(c.auftragsNr)}`);
  if (c.activeSince) lines.push(`aktiv seit ${escapeHtml(fmtDate(c.activeSince))}`);
  if (c.runtimeUntil) lines.push(`Laufzeit bis ${escapeHtml(c.runtimeUntil)}`);
  if (c.idDoc) lines.push(`Ausweis: ${escapeHtml(c.idDoc)}`);
  return `<div class="card-chip">
    <div class="cc-head">${ICO.card}<b>${escapeHtml(cardTypeLabel(c.type))}</b><span class="muted small">${escapeHtml(simKindLabel(c.simKind))}</span></div>
    ${lines.length ? `<div class="cc-lines muted small">${lines.join(' · ')}</div>` : ''}
    ${c.notes ? `<div class="cc-lines small">${escapeHtml(c.notes)}</div>` : ''}
  </div>`;
}

// ---- Editor (Arbeitskopie + Re-Render) ------------------------------------
export function newPerson() {
  draft = blankPerson();
  openModal('Neue Person', editorHtml());
}
export function editPerson(id) {
  const p = state.people.find((x) => x.id === id);
  if (!p) return;
  draft = JSON.parse(JSON.stringify(p));
  if (!Array.isArray(draft.ibans)) draft.ibans = [];
  if (!Array.isArray(draft.cards)) draft.cards = [];
  openModal('Person bearbeiten', editorHtml());
}

// Liest die aktuellen Formularwerte in den Entwurf (vor Re-Render / Speichern).
function readDraft() {
  const form = document.getElementById('personForm');
  if (!form || !draft) return;
  const fd = new FormData(form);
  draft.name = (fd.get('name') || '').toString().trim();
  draft.ibans = (fd.get('ibans') || '').toString().split(/\n+/).map((s) => s.trim()).filter(Boolean);
  draft.paymentMethod = (fd.get('paymentMethod') || 'ueberweisung').toString();
  draft.schedule = (fd.get('schedule') || 'monthly').toString();
  draft.dayOfMonth = parseInt((fd.get('dayOfMonth') || '1').toString(), 10) || 1;
  draft.anchorMonth = (fd.get('anchorMonth') || '').toString();
  draft.expectedAmount = parseEUR((fd.get('expectedAmount') || '0').toString()) || 0;
  draft.notes = (fd.get('notes') || '').toString();
  (draft.cards || []).forEach((c, i) => {
    const g = (k) => (fd.get(`card_${i}_${k}`) || '').toString();
    c.type = g('type') || 'multisim';
    c.simKind = g('simKind') || 'sim';
    c.phone = g('phone').trim();
    c.owner = g('owner').trim();
    c.simNr = g('simNr').trim();
    c.auftragsNr = g('auftragsNr').trim();
    c.activeSince = g('activeSince');
    c.runtimeUntil = g('runtimeUntil').trim();
    c.idDoc = g('idDoc').trim();
    c.notes = g('notes').trim();
  });
}

function editorHtml() {
  const p = draft;
  const opts = (list, val, lbl = 'label', id = 'id') => list.map((o) =>
    `<option value="${o[id]}" ${p && val === o[id] ? 'selected' : ''}>${escapeHtml(o[lbl])}</option>`).join('');
  return `
    <form id="personForm" onsubmit="return false">
      <label class="fld"><span>Name</span>
        <input name="name" type="text" value="${escapeHtml(p.name || '')}" placeholder="Vor- und Nachname" required></label>
      <div class="fld-row">
        <label class="fld"><span>Monatlicher Anteil (€)</span>
          <input name="expectedAmount" type="text" inputmode="decimal" value="${p.expectedAmount ? String(p.expectedAmount).replace('.', ',') : ''}" placeholder="z. B. 7"></label>
        <label class="fld"><span>Zahltag</span>
          <input name="dayOfMonth" type="number" min="1" max="31" value="${escapeHtml(String(p.dayOfMonth || 1))}"></label>
      </div>
      <div class="fld-row">
        <label class="fld"><span>Rhythmus</span><select name="schedule">${opts(SCHEDULES, p.schedule)}</select></label>
        <label class="fld"><span>Zahlart</span><select name="paymentMethod">${opts(PAYMENT_METHODS, p.paymentMethod)}</select></label>
      </div>
      <label class="fld"><span>Zyklus-Start (nur bei vierteljährlich/jährlich)</span>
        <input name="anchorMonth" type="month" value="${escapeHtml(p.anchorMonth || '')}"></label>
      <label class="fld"><span>IBAN(s) – eine pro Zeile (für Abgleich)</span>
        <textarea name="ibans" rows="2" placeholder="DE.. (mehrere möglich)">${escapeHtml((p.ibans || []).join('\n'))}</textarea></label>
      <label class="fld"><span>Notiz</span>
        <textarea name="notes" rows="2" placeholder="optional">${escapeHtml(p.notes || '')}</textarea></label>

      <div class="editor-section">
        <div class="es-head"><span>Karten / SIM (${(p.cards || []).length})</span>
          <button type="button" class="btn btn-ghost btn-sm" onclick="addCard()">${ICO.plus} Karte</button></div>
        ${(p.cards || []).map((c, i) => cardEditor(c, i, opts)).join('') || '<p class="muted small">Noch keine Karte. Optional – nur falls du das Inventar mitführen willst.</p>'}
      </div>

      <div class="modal-actions" style="margin-top:18px">
        <button type="button" class="btn btn-ghost" onclick="closePersonModal()">Abbrechen</button>
        <button type="button" class="btn btn-primary" onclick="savePerson()">Speichern</button>
      </div>
    </form>`;
}

function cardEditor(c, i, opts) {
  return `<div class="card-edit">
    <div class="ce-top">
      <select name="card_${i}_type">${opts(CARD_TYPES, c.type)}</select>
      <select name="card_${i}_simKind">${opts(SIM_KINDS, c.simKind)}</select>
      <button type="button" class="icon-btn danger" onclick="removeCard(${i})" aria-label="Karte entfernen">${ICO.trash}</button>
    </div>
    <div class="fld-row">
      <label class="fld"><span>Telefonnummer</span><input name="card_${i}_phone" type="text" value="${escapeHtml(c.phone || '')}"></label>
      <label class="fld"><span>Besitzer</span><input name="card_${i}_owner" type="text" value="${escapeHtml(c.owner || '')}"></label>
    </div>
    <div class="fld-row">
      <label class="fld"><span>SIM-Nummer</span><input name="card_${i}_simNr" type="text" value="${escapeHtml(c.simNr || '')}"></label>
      <label class="fld"><span>Auftragsnummer</span><input name="card_${i}_auftragsNr" type="text" value="${escapeHtml(c.auftragsNr || '')}"></label>
    </div>
    <div class="fld-row">
      <label class="fld"><span>Aktiv seit</span><input name="card_${i}_activeSince" type="date" value="${escapeHtml(c.activeSince || '')}"></label>
      <label class="fld"><span>Laufzeit bis</span><input name="card_${i}_runtimeUntil" type="text" value="${escapeHtml(c.runtimeUntil || '')}" placeholder="z. B. 28.12.2027"></label>
    </div>
    <div class="fld-row">
      <label class="fld"><span>Ausweisdokument</span><input name="card_${i}_idDoc" type="text" value="${escapeHtml(c.idDoc || '')}"></label>
      <label class="fld"><span>Notiz</span><input name="card_${i}_notes" type="text" value="${escapeHtml(c.notes || '')}"></label>
    </div>
  </div>`;
}

export function addCard() {
  readDraft();
  draft.cards.push(newCard());
  updateModalBody(editorHtml());
}
export function removeCard(i) {
  readDraft();
  draft.cards.splice(i, 1);
  updateModalBody(editorHtml());
}

export function savePerson() {
  readDraft();
  if (!draft.name) { toast('Bitte einen Namen eingeben', 'err'); return; }
  const existing = state.people.find((x) => x.id === draft.id);
  if (existing) Object.assign(existing, draft);
  else state.people.push(draft);
  save();
  draft = null;
  closeModal();
  renderPeople();
  rerenderDashboard();
  renderLedger();
  toast(existing ? 'Gespeichert' : 'Person angelegt', 'ok');
}

export async function deletePerson(id) {
  const p = state.people.find((x) => x.id === id);
  const ok = await confirmDialog(`„${p ? p.name : 'Person'}" wirklich löschen? Die Zahlungshistorie dieser Person geht verloren.`, { okLabel: 'Löschen', danger: true });
  if (!ok) return;
  const i = state.people.findIndex((x) => x.id === id);
  if (i >= 0) state.people.splice(i, 1);
  if (state.ledger[id]) delete state.ledger[id];
  save();
  closeModal();
  renderPeople();
  rerenderDashboard();
  renderLedger();
  toast('Gelöscht');
}

export function closePersonModal() { draft = null; closeModal(); }

Object.assign(window, {
  renderPeople, setPeopleSearch, newPerson, editPerson, openPerson,
  addCard, removeCard, savePerson, deletePerson, closePersonModal,
  removePersonIban, removeNameAlias, removePayAlias, resetLearned
});
