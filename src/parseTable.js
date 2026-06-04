// Import der Mobilfunk-Tabelle (PDF): aus dem Zahlungs-Log (Seite 1-2) Personen +
// Ledger-Historie ableiten, aus der Kostentabelle (Seite 5) die Vertragskosten.
// Rein/DOM-frei. SIM-Inventar (Seite 3) & Soll/Ist-Matrix (Seite 4) sind per Text
// nicht zuverlässig lesbar und werden bewusst NICHT verarbeitet.
import { parseEUR, parseGermanDate, monthKey } from './money.js';
import { normalizeName } from './match.js';
import { extractPdfLines } from './parse.js';

// Mobilfunk-Tabellen-PDF -> { entries, costs }. pdf.js wird (in parse.js) lazy geladen.
export async function parseMobilfunkPdf(file) {
  return parseLogLines(await extractPdfLines(file));
}

const NUM_WORDS = { zwei: 2, drei: 3, vier: 4, 'fünf': 5, sechs: 6, zwölf: 12 };

// Eine Log-Zeile: "DD.MM.YYYY Name Betrag € Bezahlmethode Grund"
const LOG_RE = /^(\d{1,2}\.\d{1,2}\.\d{4})\s+(.+?)\s+(-?\d[\d.]*,\d{2})\s*€\s+(.+)$/;
const METHODS = ['Telekom Multi-Guthaben', 'Telekom Guthaben', 'Netflix Guthaben', 'Überweisung', 'Paypal', 'PayPal', 'Lastschrift'];

function mapMethod(prefix) {
  const p = prefix.toLowerCase();
  if (p.includes('netflix')) return 'netflix';
  if (p.includes('paypal')) return 'paypal';
  if (p.includes('telekom')) return 'sonstige';
  if (p.includes('lastschrift')) return 'sonstige';
  return 'ueberweisung';
}

function firstAmount(line) {
  const m = line.match(/(-?\d[\d.]*,\d{2})/);
  return m ? parseEUR(m[1]) : NaN;
}

// Anzahl Monate, die eine Zahlung laut Grund abdeckt (für Mehrmonats-/Rhythmuserkennung).
function monthsInReason(reason) {
  const m = reason.match(/(\d+|zwei|drei|vier|fünf|sechs|zwölf)\s*Monate?n?/i);
  if (!m) return 1;
  const t = m[1].toLowerCase();
  return NUM_WORDS[t] || parseInt(t, 10) || 1;
}

function isCleanMonthly(reason) {
  return /1\s*Monat\b/i.test(reason) && !/(einmalig|versand|fehlend|zusatz|rücksend|10€|bereitstellung)/i.test(reason);
}

function mode(nums) {
  if (!nums.length) return NaN;
  const cnt = new Map();
  for (const n of nums) { const k = Math.round(n); cnt.set(k, (cnt.get(k) || 0) + 1); }
  let best = nums[0], bc = -1;
  for (const [k, c] of cnt) if (c > bc || (c === bc && k > best)) { best = k; bc = c; }
  return best;
}
function median(nums) {
  if (!nums.length) return NaN;
  const s = [...nums].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

// ---- Log -> Roh-Einträge + Kosten ----------------------------------------
export function parseLogLines(lines) {
  const entries = [];
  const costs = {};
  for (const raw of lines) {
    const line = raw.replace(/\s+/g, ' ').trim();
    if (!line) continue;

    const m = line.match(LOG_RE);
    if (m) {
      const date = parseGermanDate(m[1]);
      const name = m[2].trim();
      const amount = parseEUR(m[3]);
      let rest = m[4].trim();
      let method = 'ueberweisung';
      const hit = METHODS.find((mm) => rest.toLowerCase().startsWith(mm.toLowerCase()));
      if (hit) { method = mapMethod(hit); rest = rest.slice(hit.length).trim(); }
      if (date && Number.isFinite(amount)) entries.push({ date, name, amount, method, reason: rest });
      continue;
    }
    // Kostentabelle (Seite 5)
    if (/^Grundgeb(ü|u)hr/i.test(line)) costs.grundgebuehr = firstAmount(line);
    else if (/^Plus.?Karte monatlich/i.test(line)) costs.plusKarteMonatlich = firstAmount(line);
    else if (/^MultiSim monatlich/i.test(line)) costs.multiSimMonatlich = firstAmount(line);
  }
  return { entries, costs };
}

// ---- Roh-Einträge -> Personen + Ledger (Merge in vorhandene) --------------
export function buildImportFromLog(entries, costs, existingPeople = [], existingLedger = {}) {
  // Gruppieren nach normalisiertem Namen, Telekom & Negativbuchungen ignorieren.
  const groups = new Map();
  for (const e of entries) {
    const nn = normalizeName(e.name);
    if (!nn || nn === 'telekom') continue;
    if (e.amount <= 0) continue; // Rücksendungen/Gutschriften nicht als Eingang werten
    if (!groups.has(nn)) groups.set(nn, { name: e.name, items: [] });
    groups.get(nn).items.push(e);
  }

  const people = existingPeople.map((p) => JSON.parse(JSON.stringify(p)));
  const ledger = JSON.parse(JSON.stringify(existingLedger || {}));
  const byNorm = new Map(people.map((p) => [normalizeName(p.name), p]));
  let seq = 0;
  const uid = () => 'p' + Date.now().toString(36) + (seq++).toString(36);

  const summary = [];

  for (const [nn, g] of groups) {
    const items = g.items;
    // Kartentypen aus den Gründen
    const cardTypes = [];
    const allReasons = items.map((i) => i.reason).join(' ');
    if (/plus.?karte/i.test(allReasons)) cardTypes.push('pluskarte');
    if (/multi.?sim/i.test(allReasons)) cardTypes.push('multisim');

    // Zahlart = häufigste Methode
    const method = mode(items.map((i) => ({ ueberweisung: 0, paypal: 1, netflix: 2, sonstige: 3 }[i.method])));
    const methodId = ['ueberweisung', 'paypal', 'netflix', 'sonstige'][Number.isFinite(method) ? method : 0];

    // Monatsbetrag + Rhythmus. Pro Monat die SUMME der VERSCHIEDENEN sauberen
    // Monatsbeträge (zwei gleiche 7€ = Vorauszahlung -> 7€; 12€+7€ = Kombi -> 19€).
    const perMonthClean = {}; // mk -> Set<amount>
    const multiCands = [];
    let maxN = 1;
    for (const e of items) {
      const n = monthsInReason(e.reason);
      if (n > 1) { multiCands.push(e.amount / n); maxN = Math.max(maxN, n); }
      else if (isCleanMonthly(e.reason)) {
        const mk = monthKey(e.date);
        (perMonthClean[mk] = perMonthClean[mk] || new Set()).add(Math.round(e.amount * 100) / 100);
      }
    }
    const cleanKeys = Object.keys(perMonthClean).sort();
    const monthTotal = (mk) => [...perMonthClean[mk]].reduce((a, b) => a + b, 0);
    let expectedAmount;
    if (cleanKeys.length) expectedAmount = Math.round(monthTotal(cleanKeys[cleanKeys.length - 1]));
    else if (multiCands.length) expectedAmount = Math.round(median(multiCands));
    else expectedAmount = Math.round(median(items.map((i) => i.amount)) || 7);
    const monthlyTotals = cleanKeys.map(monthTotal);

    let schedule = 'monthly';
    let anchorMonth = '';
    const mostlyMulti = multiCands.length > 0 && monthlyTotals.length === 0;
    if (maxN >= 12) { schedule = 'yearly'; }
    else if (maxN === 3 && mostlyMulti) { schedule = 'quarterly'; }
    else if (methodId === 'netflix') { schedule = 'bimonthly'; }
    if (schedule !== 'monthly') {
      const firstMulti = items.find((e) => monthsInReason(e.reason) > 1);
      anchorMonth = firstMulti ? monthKey(firstMulti.date) : monthKey(items[0].date);
    }

    // Person finden/anlegen
    let person = byNorm.get(nn);
    const isNew = !person;
    if (isNew) {
      person = {
        id: uid(), name: g.name, ibans: [], paymentMethod: methodId,
        schedule, dayOfMonth: 1, anchorMonth, expectedAmount,
        cards: cardTypes.map((t) => ({ type: t, phone: '', simNr: '', auftragsNr: '', owner: g.name, simKind: 'sim', activeSince: '', runtimeUntil: '', idDoc: '', notes: '' })),
        notes: 'aus Tabelle importiert'
      };
      people.push(person);
      byNorm.set(nn, person);
    }

    // Ledger: Zahlungen je Monat aufsummieren (überschreibt diesen Monat im Ledger).
    if (!ledger[person.id]) ledger[person.id] = {};
    const monthsTouched = new Set();
    for (const e of items) {
      const mk = monthKey(e.date);
      monthsTouched.add(mk);
      const cell = ledger[person.id][mk] || { received: 0, receivedDate: '', note: 'aus Tabelle' };
      // Falls Zelle bereits aus Tabelle stammt (Re-Import), neu aufbauen statt addieren:
      if (!cell._tab) { cell.received = 0; cell._tab = true; cell.note = 'aus Tabelle'; }
      cell.received += e.amount;
      if (!cell.receivedDate || e.date > cell.receivedDate) cell.receivedDate = e.date;
      ledger[person.id][mk] = cell;
    }
    // internes Flag wieder entfernen
    for (const mk of monthsTouched) delete ledger[person.id][mk]._tab;

    summary.push({ name: person.name, isNew, expectedAmount: person.expectedAmount, schedule: person.schedule, cards: cardTypes.length, payments: items.length });
  }

  const mergedCosts = { ...(costs || {}) };
  // nur tatsächlich erkannte Kostenwerte zurückgeben
  for (const k of Object.keys(mergedCosts)) if (!Number.isFinite(mergedCosts[k])) delete mergedCosts[k];

  summary.sort((a, b) => (b.isNew - a.isNew) || a.name.localeCompare(b.name, 'de'));
  return { people, ledger, costs: mergedCosts, summary };
}
