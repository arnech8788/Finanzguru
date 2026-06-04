// Geld- und Monats-Helfer (rein, ohne DOM).

// Formatiert eine Zahl als EUR-Betrag, z. B. 7 -> "7,00 €".
export function fmtEUR(n) {
  const v = Number(n) || 0;
  return v.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
}

// Parst deutsche/englische Betragsschreibweisen robust:
//  "1.234,56" -> 1234.56 · "1234.56" -> 1234.56 · "-45,97 €" -> -45.97 · "7,00" -> 7
export function parseEUR(input) {
  if (typeof input === 'number') return input;
  let s = String(input ?? '').replace(/[^\d.,-]/g, '').trim();
  if (!s) return NaN;
  const hasComma = s.includes(',');
  const hasDot = s.includes('.');
  if (hasComma && hasDot) {
    // Das zuletzt stehende Trennzeichen ist das Dezimaltrennzeichen.
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (hasComma) {
    s = s.replace(/\./g, '').replace(',', '.');
  }
  // nur Punkt oder gar kein Trenner: Punkt gilt als Dezimaltrennzeichen
  const v = parseFloat(s);
  return Number.isFinite(v) ? v : NaN;
}

// "DD.MM.YYYY" oder "DD.MM.YY" -> "YYYY-MM-DD" (sonst '').
export function parseGermanDate(input) {
  const m = String(input ?? '').match(/(\d{1,2})\.(\d{1,2})\.(\d{2,4})/);
  if (!m) return '';
  let [, d, mo, y] = m;
  if (y.length === 2) y = '20' + y;
  return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

// ISO-Datum (YYYY-MM-DD) -> "DD.MM.YYYY".
export function fmtDate(iso) {
  if (!iso) return '';
  const m = String(iso).match(/(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : iso;
}

export function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

// Monatsschlüssel 'YYYY-MM' aus Date oder ISO-String (Default: heute).
export function monthKey(d) {
  if (!d) return new Date().toISOString().slice(0, 7);
  if (typeof d === 'string') return d.slice(0, 7);
  return d.toISOString().slice(0, 7);
}

export function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}

// Laufende Monatszahl seit Jahr 0 für einfache Differenz-/Modulo-Rechnung.
export function monthIndex(ym) {
  const [y, m] = String(ym).split('-').map(Number);
  return y * 12 + (m - 1);
}

// Verschiebt 'YYYY-MM' um delta Monate.
export function shiftMonth(ym, delta) {
  const idx = monthIndex(ym) + delta;
  const y = Math.floor(idx / 12);
  const m = (idx % 12 + 12) % 12;
  return `${y}-${String(m + 1).padStart(2, '0')}`;
}

const MONTH_NAMES = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

// 'YYYY-MM' -> "Juni 2026".
export function monthLabel(ym) {
  const [y, m] = String(ym).split('-').map(Number);
  return `${MONTH_NAMES[(m - 1 + 12) % 12]} ${y}`;
}

// Kurzform 'YYYY-MM' -> "Jun 26".
export function monthShort(ym) {
  const [y, m] = String(ym).split('-').map(Number);
  return `${MONTH_NAMES[(m - 1 + 12) % 12].slice(0, 3)} ${String(y).slice(2)}`;
}

// Liste der letzten n Monate (aufsteigend), endend im Bezugsmonat (Default heute).
export function lastMonths(n, end) {
  const e = end || currentMonth();
  const out = [];
  for (let i = n - 1; i >= 0; i--) out.push(shiftMonth(e, -i));
  return out;
}
