// Kategorie-Übersicht: Mobilfunk je Telefonnummer (Anschluss) mit allen SIMs
// (um freie MultiSIM-Plätze zu sehen) + Abos (Netflix/Spotify/YouTube …) mit Nutzern.
import { ICO, escapeHtml } from './ui.js';
import { state } from './main.js';
import { fmtEUR, currentMonth } from './money.js';
import { cardTypeLabel, simKindLabel } from './data/cardTypes.js';
import { monthlyAmount } from './data/schedules.js';

const normPhone = (s) => String(s || '').replace(/\D/g, '');
const shortSim = (s) => { const d = String(s || '').replace(/\s/g, ''); return d ? '…' + d.slice(-6) : ''; };

// Alle Karten aller Personen nach Telefonnummer (= Anschluss) gruppieren.
function mobileGroups() {
  const groups = new Map();
  for (const p of state.people) {
    for (const c of (p.cards || [])) {
      const key = normPhone(c.phone) || 'none';
      if (!groups.has(key)) groups.set(key, { key, phone: c.phone || '', cards: [] });
      const g = groups.get(key);
      if (!g.phone && c.phone) g.phone = c.phone;
      g.cards.push({ c, person: p });
    }
  }
  const list = [...groups.values()];
  // Karten je Gruppe: PlusKarte zuerst, dann MultiSIM.
  for (const g of list) {
    g.cards.sort((a, b) => (a.c.type === 'pluskarte' ? 0 : 1) - (b.c.type === 'pluskarte' ? 0 : 1));
    g.multi = g.cards.filter((x) => x.c.type === 'multisim').length;
    g.plus = g.cards.filter((x) => x.c.type === 'pluskarte').length;
    g.main = (g.cards.find((x) => x.c.type === 'pluskarte') || g.cards[0]).c.owner || '';
  }
  // Wenigste SIMs zuerst (dort ist am meisten Platz für weitere MultiSIM).
  list.sort((a, b) => a.cards.length - b.cards.length || String(a.main).localeCompare(String(b.main), 'de'));
  return list;
}

function cardRow({ c, person }) {
  const bits = [cardTypeLabel(c.type), simKindLabel(c.simKind)];
  if (c.owner) bits.push(escapeHtml(c.owner));
  if (c.simNr) bits.push(escapeHtml(shortSim(c.simNr)));
  const dot = c.type === 'pluskarte' ? '#2fb86b' : '#2d9cdb';
  return `<button class="imp-row" style="width:100%;text-align:left;border:none;background:none;cursor:pointer" onclick="openPerson('${person.id}')">
    <span class="dash-dot" style="--sc:${dot}"></span>
    <div class="dash-meta"><b>${escapeHtml(cardTypeLabel(c.type))}${c.owner ? ' · ' + escapeHtml(c.owner) : ''}</b>
      <small>${escapeHtml(simKindLabel(c.simKind))}${c.simNr ? ' · SIM ' + escapeHtml(shortSim(c.simNr)) : ''}${c.notes ? ' · ' + escapeHtml(c.notes) : ''}</small></div>
  </button>`;
}

function mobileSection() {
  const groups = mobileGroups();
  if (!groups.length) return '';
  const totalSims = groups.reduce((a, g) => a + g.cards.length, 0);
  const anschluesse = groups.filter((g) => g.key !== 'none').length;
  const cards = groups.map((g) => {
    const title = g.key === 'none' ? 'Ohne Nummer' : escapeHtml(g.phone || g.key);
    return `<div class="card">
      <div class="cost-row static"><span><b>📱 ${title}</b></span>
        <b>${g.cards.length} SIM${g.cards.length === 1 ? '' : 's'}</b></div>
      <div class="muted small" style="margin:2px 0 8px">${g.main ? 'Hauptkarte: ' + escapeHtml(g.main) + ' · ' : ''}${g.plus} PlusKarte · ${g.multi} MultiSIM</div>
      <div class="imp-list">${g.cards.map(cardRow).join('')}</div>
    </div>`;
  }).join('');
  return `
    <div class="section-label">Mobilfunk – ${anschluesse} Anschlüsse · ${totalSims} SIMs</div>
    <p class="muted small" style="margin:0 0 10px">Sortiert nach Anzahl SIMs (oben = am meisten Platz für weitere MultiSIM). Tippe eine Karte, um die Person zu öffnen.</p>
    ${cards}`;
}

function subsSection() {
  const month = currentMonth();
  // Personen ohne Mobilfunk-Kategorie nach Kategorie gruppieren.
  const byCat = new Map();
  for (const p of state.people) {
    if (p.category === 'Mobilfunk') continue;
    if ((p.cards || []).some((c) => c.type === 'pluskarte' || c.type === 'multisim') && !p.category) continue; // reine Karten-Personen
    const cat = p.category || 'Ohne Kategorie';
    if (!byCat.has(cat)) byCat.set(cat, []);
    byCat.get(cat).push(p);
  }
  if (!byCat.size) return '';
  const cats = [...byCat.keys()].sort((a, b) => (a === 'Ohne Kategorie' ? 1 : b === 'Ohne Kategorie' ? -1 : a.localeCompare(b, 'de')));
  const blocks = cats.map((cat) => {
    const list = byCat.get(cat).sort((a, b) => (a.name || '').localeCompare(b.name || '', 'de'));
    const rows = list.map((p) => `<button class="imp-row" style="width:100%;text-align:left;border:none;background:none;cursor:pointer" onclick="openPerson('${p.id}')">
      <div class="dash-meta"><b>${escapeHtml(p.name || '(ohne Name)')}</b>
        <small>${fmtEUR(monthlyAmount(p, month))} / Monat</small></div>
    </button>`).join('');
    return `<div class="card"><div class="cost-row static"><span><b>${escapeHtml(cat)}</b></span><b>${list.length}</b></div>
      <div class="imp-list">${rows}</div></div>`;
  }).join('');
  return `<div class="section-label">Abos & Sonstiges</div>${blocks}`;
}

export function renderCategories() {
  const el = document.getElementById('screen-categories');
  if (!el) return;
  const mob = mobileSection();
  const subs = subsSection();
  el.innerHTML = `
    <header class="topbar">
      <button class="icon-btn" onclick="navBack()" aria-label="Zurück">${ICO.chevL}</button>
      <h1>Kategorien</h1>
    </header>
    <div class="pad">
      ${mob || ''}
      ${subs || ''}
      ${!mob && !subs ? `<div class="empty">${ICO.users}<p>Noch keine Karten oder Kategorien.</p></div>` : ''}
    </div>`;
}

Object.assign(window, { renderCategories });
