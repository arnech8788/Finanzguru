// Reiner Parser für die (aus Excel kopierte) transponierte Karten-Tabelle:
// Spalten = Karten, Zeilen = Attribute (Tab-getrennt). Kein DOM.
import { parseGermanDate } from './money.js';
import { normalizeName } from './match.js';

// Label normalisieren: klein, ohne Spaces/Punkte/Bindestriche (toleriert Tippfehler).
function norm(s) {
  return String(s ?? '').toLowerCase().replace(/[\s.\-_]/g, '');
}

function newCardBase() {
  return { type: 'multisim', phone: '', simNr: '', auftragsNr: '', owner: '', simKind: 'sim', activeSince: '', runtimeUntil: '', idDoc: '', notes: '' };
}

// Tab-getrennten, transponierten Tabellen-Text -> Array Karten.
// Erste Zeile = Kopf (Kartennamen je Spalte); Folgezeilen je Feld, erste Zelle = Label.
export function parseCardsTable(text) {
  const rows = String(text ?? '').replace(/\r\n?/g, '\n').split('\n').map((l) => l.split('\t'));
  if (rows.length < 2) return [];
  const header = rows[0];
  const maxCols = rows.reduce((m, r) => Math.max(m, r.length), 0);

  // Zeilen nach normalisiertem Label indexieren (erste Fundstelle gewinnt).
  const byLabel = {};
  for (let i = 1; i < rows.length; i++) {
    const label = norm(rows[i][0]);
    if (label && !(label in byLabel)) byLabel[label] = rows[i];
  }
  const findRow = (pred) => {
    const key = Object.keys(byLabel).find(pred);
    return key ? byLabel[key] : null;
  };
  const rowAuftrag = findRow((k) => k.startsWith('auftrag'));
  const rowSim = findRow((k) => k.startsWith('simnr') || k === 'sim');
  const rowPhone = findRow((k) => k.startsWith('telefon'));
  const rowOwner = findRow((k) => k.startsWith('besitzer'));
  const rowId = findRow((k) => k.startsWith('ausweis'));
  const rowPurpose = findRow((k) => k.startsWith('verwendungsz')); // Verwendungszweck (auch Tippfehler "Verwendungszeck")
  const rowKind = findRow((k) => k === 'verwendung');
  const rowActive = findRow((k) => k.startsWith('aktiv'));         // "Aktiv seit"/"Aktiv seid"
  const rowRuntime = findRow((k) => k.startsWith('laufzeit'));
  const rowNotes = findRow((k) => k.startsWith('notiz'));
  const rowOptions = findRow((k) => k.startsWith('option'));

  const cell = (row, c) => (row && row[c] != null ? String(row[c]).trim() : '');

  const cards = [];
  for (let c = 1; c < maxCols; c++) {
    const name = cell(header, c);
    const simNr = cell(rowSim, c);
    const phoneRaw = cell(rowPhone, c);
    const owner = cell(rowOwner, c);
    const auftragsNr = cell(rowAuftrag, c);
    // Leere Trenn-/Leerspalten überspringen.
    if (!name && !simNr && !phoneRaw && !owner && !auftragsNr) continue;

    const type = norm(name).includes('multi') ? 'multisim' : 'pluskarte';

    // Telefon kann "(Name der Hauptkarte)" enthalten -> als Hinweis in die Notiz.
    let phone = phoneRaw, parentNote = '';
    const par = phoneRaw.match(/\(([^)]*)\)/);
    if (par) { phone = phoneRaw.replace(/\([^)]*\)/g, '').trim(); parentNote = `MultiSIM zu ${par[1].trim()}`; }

    const simKind = norm(cell(rowKind, c)).includes('esim') ? 'esim' : 'sim';
    const notes = [cell(rowPurpose, c), cell(rowNotes, c), cell(rowOptions, c), parentNote].filter(Boolean).join(' · ');

    cards.push({
      name, type, simKind, phone, owner, simNr, auftragsNr,
      activeSince: parseGermanDate(cell(rowActive, c)),
      runtimeUntil: cell(rowRuntime, c),
      idDoc: cell(rowId, c),
      notes
    });
  }
  return cards;
}

// Karten nach Besitzer gruppieren und je Gruppe eine passende vorhandene Person
// vorschlagen (über Name/Alias). Liefert die Gruppen für die Vorschau/Zuordnung.
export function planCardImport(cards, existingPeople = []) {
  const byNorm = new Map();
  for (const p of existingPeople) {
    byNorm.set(normalizeName(p.name), p.id);
    for (const a of (p.nameAliases || [])) byNorm.set(normalizeName(a), p.id);
  }
  const groups = [];
  const seen = new Map();
  for (const card of cards) {
    const nn = normalizeName(card.owner);
    if (!nn) continue; // ohne Besitzer nicht zuordenbar
    let g = seen.get(nn);
    if (!g) { g = { owner: card.owner, normOwner: nn, suggestedId: byNorm.get(nn) || '', cards: [] }; seen.set(nn, g); groups.push(g); }
    g.cards.push(card);
  }
  return groups;
}

// Gruppen mit gewählter Zuordnung (assignments: normOwner -> personId | '__new__')
// in Kopien der vorhandenen Personen einpflegen. Befüllt leere Platzhalter-Karten,
// ergänzt fehlende; per SIM-Nr idempotent. Fehlt eine Zuordnung, gilt der Vorschlag.
export function buildCardImport(groups, assignments = {}, existingPeople = []) {
  const people = existingPeople.map((p) => JSON.parse(JSON.stringify(p)));
  const byId = new Map(people.map((p) => [p.id, p]));
  let seq = 0;
  const uid = () => 'p' + Date.now().toString(36) + (seq++).toString(36);

  const summary = [];
  for (const g of groups) {
    const choice = assignments[g.normOwner] || g.suggestedId || '__new__';
    let person, isNew = false;
    if (choice === '__new__' || !byId.has(choice)) {
      person = { id: uid(), name: g.owner, ibans: [], paymentMethod: 'ueberweisung', schedule: 'monthly', dayOfMonth: 1, anchorMonth: '', expectedAmount: 0, cards: [], notes: 'aus Karten-Tabelle' };
      people.push(person);
      byId.set(person.id, person);
      isNew = true;
    } else {
      person = byId.get(choice);
    }
    if (!Array.isArray(person.cards)) person.cards = [];

    let filled = 0, added = 0;
    for (const c of g.cards) {
      const fields = {
        type: c.type, simKind: c.simKind, phone: c.phone, owner: c.owner, simNr: c.simNr,
        auftragsNr: c.auftragsNr, activeSince: c.activeSince, runtimeUntil: c.runtimeUntil, idDoc: c.idDoc, notes: c.notes
      };
      // 1) Karte mit gleicher SIM-Nr (idempotenter Re-Import) ...
      let target = c.simNr ? person.cards.find((x) => x.simNr && x.simNr === c.simNr) : null;
      // 2) ... sonst leere Platzhalter-Karte gleichen Typs.
      if (!target) target = person.cards.find((x) => x.type === c.type && !x.simNr && !x.phone && !x.auftragsNr);
      if (target) {
        for (const [k, v] of Object.entries(fields)) if (v) target[k] = v;
        filled++;
      } else {
        person.cards.push({ ...newCardBase(), ...fields });
        added++;
      }
    }
    summary.push({ name: person.name, owner: g.owner, isNew, filled, added });
  }
  summary.sort((a, b) => (b.isNew - a.isNew) || a.name.localeCompare(b.name, 'de'));
  return { people, summary };
}
