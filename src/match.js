// Reine Abgleich-Logik (kein DOM). Ordnet Kontoauszug-Transaktionen den
// erwarteten Zahlungen einer Person/eines Monats zu.
import { monthIndex } from './money.js';
import { expectedForMonth } from './data/schedules.js';

// Name normalisieren: Kleinschreibung, Diakritika & Satzzeichen weg, Spaces kollabiert.
export function normalizeName(s) {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeIban(s) {
  return String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

// Erkennt anonyme Sammel-IBANs (PayPal Luxemburg etc.), die nicht zum Lernen taugen.
export function isSharedIban(iban) {
  const n = normalizeIban(iban);
  return n.startsWith('LU'); // PayPal & viele Zahlungsdienstleister
}

const NOISE_NAMES = ['paypal', 'instant transfer', 'netflix'];

export function looksAnonymous(txn) {
  const n = normalizeName(txn.name);
  if (!n) return true;
  return NOISE_NAMES.some((x) => n.includes(x));
}

// Bewertet, wie gut eine Transaktion zu einer Person + erwartetem Betrag passt.
// Rückgabe: { score, confidence, reasons }
export function scoreMatch(person, txn, expected, settings = {}) {
  const tol = settings.amountTolerance != null ? settings.amountTolerance : 0.5;
  const reasons = [];
  let score = 0;
  const txnIban = normalizeIban(txn.iban);
  const personIbans = (person.ibans || []).map(normalizeIban).filter(Boolean);

  if (txnIban && personIbans.includes(txnIban) && !isSharedIban(txnIban)) {
    score += 100; reasons.push('IBAN');
  }
  const pName = normalizeName(person.name);
  const tName = normalizeName(txn.name);
  if (pName && tName && (tName.includes(pName) || pName.includes(tName))) {
    score += 60; reasons.push('Name');
  }
  if (expected > 0 && Math.abs(txn.amount - expected) <= tol) {
    score += 25; reasons.push('Betrag');
  } else if (expected > 0 && Math.abs(txn.amount - expected) <= expected) {
    // Teilzahlung/Mehrzahlung – schwacher Hinweis
    score += 5;
  }

  let confidence = 'low';
  if (reasons.includes('IBAN')) confidence = 'high';
  else if (reasons.includes('Name')) confidence = 'medium';
  return { score, confidence, reasons };
}

function inWindow(txnDateIso, month, graceDays) {
  if (!txnDateIso) return false;
  const tIdx = monthIndex(txnDateIso.slice(0, 7));
  const mIdx = monthIndex(month);
  if (tIdx === mIdx) return true;
  // Toleranz über Monatsgrenzen: Anfang Folgemonat / Ende Vormonat.
  const d = Number(txnDateIso.slice(8, 10));
  if (tIdx === mIdx + 1 && d <= graceDays) return true;
  if (tIdx === mIdx - 1 && d >= 28) return true;
  return false;
}

// Ordnet die Transaktionen den Personen für den gegebenen Monat zu.
//  people: Array · txns: Transaction[] · month: 'YYYY-MM'
// Rückgabe: { assignments: [{personId, txn, expected, confidence, reasons}],
//             unmatched: Transaction[] }
export function matchMonth(people, txns, month, settings = {}) {
  const grace = settings.dateGraceDays != null ? settings.dateGraceDays : 5;
  const incoming = (txns || []).filter((t) => t.amount > 0 && inWindow(t.date, month, grace));

  // Alle möglichen Paare bewerten.
  const pairs = [];
  for (const person of people) {
    const expected = expectedForMonth(person, month);
    for (const txn of incoming) {
      const { score, confidence, reasons } = scoreMatch(person, txn, expected, settings);
      if (score > 0) pairs.push({ person, txn, expected, score, confidence, reasons });
    }
  }
  pairs.sort((a, b) => b.score - a.score);

  const usedTxn = new Set();
  const usedPerson = new Set();
  const assignments = [];
  for (const p of pairs) {
    if (usedTxn.has(p.txn.id) || usedPerson.has(p.person.id)) continue;
    // Mindestschwelle: reiner Betragstreffer ohne Name/IBAN reicht nicht.
    if (!p.reasons.includes('IBAN') && !p.reasons.includes('Name')) continue;
    usedTxn.add(p.txn.id);
    usedPerson.add(p.person.id);
    assignments.push({ personId: p.person.id, txn: p.txn, expected: p.expected, confidence: p.confidence, reasons: p.reasons });
  }

  const unmatched = incoming.filter((t) => !usedTxn.has(t.id));
  return { assignments, unmatched };
}
