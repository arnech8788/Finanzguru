// Zahlungsrhythmen (Enum + Berechnung von Soll-Beträgen je Monat).
// `expectedAmount` einer Person ist der MONATLICHE Anteil. Der Rhythmus bestimmt,
// in welchen Monaten gezahlt wird und welcher Gesamtbetrag dann fällig ist.
import { monthIndex, shiftMonth } from '../money.js';

export const SCHEDULES = [
  { id: 'monthly', label: 'Monatlich', period: 1 },
  { id: 'bimonthly', label: 'Alle 2 Monate', period: 2 },
  { id: 'quarterly', label: 'Vierteljährlich (im Voraus)', period: 3 },
  { id: 'yearly', label: 'Jährlich', period: 12 }
];

export function scheduleLabel(id) {
  return (SCHEDULES.find((s) => s.id === id) || {}).label || id || '';
}

export function schedulePeriod(id) {
  return (SCHEDULES.find((s) => s.id === id) || { period: 1 }).period;
}

// Letzter Fälligkeitsmonat ≤ ym innerhalb des Zyklus (für Vorauszahlungs-Logik).
export function governingDueMonth(person, ym) {
  const p = schedulePeriod(person.schedule);
  if (p <= 1) return ym;
  const anchor = person.anchorMonth || ym;
  const diff = monthIndex(ym) - monthIndex(anchor);
  const back = ((diff % p) + p) % p; // Monate seit der letzten Fälligkeit
  return shiftMonth(ym, -back);
}

// Ist `ym` ein Fälligkeitsmonat für diese Person?
export function isDueMonth(person, ym) {
  return governingDueMonth(person, ym) === ym;
}

// Soll-Betrag, der in diesem Monat fällig ist (0 in „Voraus-abgedeckten" Monaten).
export function expectedForMonth(person, ym) {
  const amt = Number(person.expectedAmount) || 0;
  if (!amt) return 0;
  const p = schedulePeriod(person.schedule);
  return isDueMonth(person, ym) ? amt * p : 0;
}

// Anzahl Monate, die eine Fälligkeit abdeckt (für Anzeige „deckt N Monate ab").
export function coverageMonths(person) {
  return schedulePeriod(person.schedule);
}
