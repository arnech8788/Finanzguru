// Reiner Parser: Telekom-Mobilfunk-Rechnung (PDF) -> Invoice.
// DOM-frei. Nutzt extractPdfLines (parse.js) und Geld-/Datumshelfer (money.js).
// NICHT zu verwechseln mit parseTable.js (das ist der Zahlungs-Log / „Mobilfunk-Tabelle").
//
// Invoice = {
//   id, invoiceNumber, month:'YYYY-MM', date:'YYYY-MM-DD',
//   total, grundpreise, gutschriften|null, fileName, importedAt,
//   positions: [{ simNr, phone, items:[{label, amount}], charges, credits, subtotal }]
// }
import { parseEUR, parseGermanDate } from './money.js';
import { extractPdfLines } from './parse.js';

const MONTHS = {
  januar: 1, februar: 2, 'märz': 3, maerz: 3, april: 4, mai: 5, juni: 6,
  juli: 7, august: 8, september: 9, oktober: 10, november: 11, dezember: 12
};

const SIM_RE = /Mobilfunk-Karten-\/Profilnummer:\s*([\d-]+)/;
const PHONE_RE = /Mobilfunk-Rufnummer:\s*([\d ]+?)\s+[A-Za-zÄÖÜ]/;
const ITEM_RE = /^(\d+)\.\s+(.+?)\s+(-?\d[\d.]*,\d{2})\s*€?\s*$/;
const AMOUNT_ONLY = /^(-?\d[\d.]*,\d{2})\s*€?$/;

// Erkennt eine Telekom-Mobilfunk-Rechnung anhand eindeutiger Marker.
// (DKB-Auszüge und der Zahlungs-Log enthalten diese Tokens nicht.)
export function detectTelekomInvoice(lines) {
  const text = (lines || []).join('\n');
  return /Mobilfunk-Rechnung für/i.test(text) && /Rechnungsnummer/i.test(text);
}

export async function parseTelekomInvoiceFile(file) {
  return parseTelekomInvoice(await extractPdfLines(file), file.name);
}

function monthFrom(name, year) {
  const m = MONTHS[String(name).toLowerCase()];
  return m ? `${year}-${String(m).padStart(2, '0')}` : '';
}

// Entfernt Zeitraum (DD.MM.YY - DD.MM.YY) und „19 %" aus dem Posten-Label.
function cleanLabel(s) {
  return String(s)
    .replace(/\s+\d{1,2}\.\d{1,2}\.\d{2}\s*-\s*\d{1,2}\.\d{1,2}\.\d{2}.*$/, '')
    .replace(/\s+\d+\s*%$/, '')
    .replace(/\s+-$/, '')
    .trim();
}

export function parseTelekomInvoice(lines, fileName = '') {
  let date = '', invoiceNumber = '', month = '';
  let grundpreise = NaN, gutschriften = null, total = NaN;
  const positions = [];
  const bySim = new Map();
  let cur = null;

  for (const raw of (lines || [])) {
    const line = String(raw).replace(/\s+/g, ' ').trim();
    if (!line) continue;

    // ---- Kopfdaten (Seite 1) ----
    if (!date) { const m = line.match(/^Datum\s+(\d{1,2}\.\d{1,2}\.\d{4})/); if (m) date = parseGermanDate(m[1]); }
    if (!invoiceNumber) { const m = line.match(/^Rechnungsnummer\s+([\d ]{6,})/); if (m) invoiceNumber = m[1].trim(); }
    if (!month) { const m = line.match(/Mobilfunk-Rechnung für\s+([A-Za-zÄÖÜäöüß]+)\s+(\d{4})/); if (m) month = monthFrom(m[1], m[2]); }
    if (Number.isNaN(grundpreise)) { const m = line.match(/^Grundpreise\b.*?(-?\d[\d.]*,\d{2})\s*€/); if (m) grundpreise = parseEUR(m[1]); }
    if (gutschriften === null) { const m = line.match(/^Gutschriften\b.*?(-?\d[\d.]*,\d{2})\s*€/); if (m) gutschriften = parseEUR(m[1]); }
    if (Number.isNaN(total)) { const m = line.match(/^Rechnungsbetrag\s+(-?\d[\d.]*,\d{2})/); if (m) total = parseEUR(m[1]); }

    // ---- Block-Start (je Rufnummer/SIM) ----
    const simM = line.match(SIM_RE);
    if (simM) {
      const sim = simM[1];
      if (/Fortsetzung/i.test(line) && bySim.has(sim)) {
        cur = bySim.get(sim);                 // Seitenumbruch: bestehende Position fortsetzen
      } else {
        cur = { simNr: sim, phone: '', items: [], charges: 0, credits: 0, subtotal: NaN };
        bySim.set(sim, cur);
        positions.push(cur);
      }
      continue;
    }
    if (!cur) continue;

    const phoneM = line.match(PHONE_RE);
    if (phoneM && !cur.phone) { cur.phone = phoneM[1].trim(); continue; }

    const itemM = line.match(ITEM_RE);
    if (itemM) {
      const amount = parseEUR(itemM[3]);
      if (Number.isFinite(amount)) {
        cur.items.push({ label: cleanLabel(itemM[2]), amount });
        if (amount >= 0) cur.charges += amount; else cur.credits += amount;
      }
      continue;
    }

    // Alleinstehende Betragszeile = Anzeige-Zwischensumme. Bewusst NICHT als Netto
    // verwenden: bei „Fortsetzung"-Blöcken (Gutschrift auf Folgeseite) gibt es mehrere
    // solcher Zeilen, die sich gegenseitig überschreiben würden. Das Netto je Position
    // wird zuverlässig aus den nummerierten Posten (charges + credits) berechnet.
    if (AMOUNT_ONLY.test(line)) continue;
  }

  // Netto je Position aus den Posten (Grundpreise + interne Gutschriften).
  for (const p of positions) {
    p.charges = Math.round(p.charges * 100) / 100;
    p.credits = Math.round(p.credits * 100) / 100;
    p.subtotal = Math.round((p.charges + p.credits) * 100) / 100;
  }

  const idDigits = invoiceNumber.replace(/\D/g, '');
  return {
    id: idDigits || ('inv' + Date.now().toString(36)),
    invoiceNumber,
    month,
    date,
    total: Number.isFinite(total) ? total : NaN,
    grundpreise: Number.isFinite(grundpreise) ? grundpreise : 0,
    gutschriften,
    fileName,
    importedAt: Date.now(),
    positions
  };
}
