// Reine Parser: DKB-Kontoauszug (PDF) und DKB-Umsätze (CSV) -> Transaction[].
// Transaction = { id, date:'YYYY-MM-DD', name, iban, purpose, amount, raw }
import { parseEUR, parseGermanDate } from './money.js';

let seq = 0;
function txnId() {
  seq += 1;
  return 't' + Date.now().toString(36) + '_' + seq.toString(36);
}

const DATE_AT_START = /^(\d{1,2})\.(\d{1,2})\.(\d{2,4})\b/;
// Betrag am Zeilenende: 118.20 · -1.280,14 · 7,00 · -33.95
const AMOUNT_AT_END = /(-?\d[\d.\s]*[.,]\d{2})\s*$/;
// IBAN inkl. evtl. Leerzeichen-Gruppen (werden danach entfernt).
const IBAN_TOKEN = /([A-Z]{2}\d{2}(?:\s?[\dA-Z]){6,34})/;

const FOOTER_HINTS = [
  'Deutsche Kreditbank', 'Taubenstra', 'BIC:', 'USt-ID', 'Handelsregister',
  'Bayerischen Landesbank', 'Landesbank', 'info@dkb.de', 'www.dkb.de', 'Vorsitzender',
  'Vorstand', 'Aufsichtsrat', 'Winkelmeier', 'Deglow', 'Walther', 'Keese', 'Trink',
  'Ein Unternehmen', 'Tilo Hacke', 'Charlo',
  'Seite', 'Anzahl der Transaktionen', 'Zeitraum', 'Auszug'
];
function isFooter(line) {
  return FOOTER_HINTS.some((h) => line.includes(h));
}
function isHeaderRow(line) {
  return /Datum/.test(line) && /Erl(ä|a)uterung/.test(line) && /Betrag/.test(line);
}

// Baut aus rekonstruierten Textzeilen (eine pro visueller Zeile) Transaktionen.
export function transactionsFromLines(lines) {
  const txns = [];
  let cur = null;
  const flush = () => {
    if (!cur) return;
    const descLines = cur.desc.filter(Boolean);
    let iban = '';
    const purposeLines = [];
    for (const dl of descLines) {
      const m = dl.match(IBAN_TOKEN);
      if (m && !iban) {
        iban = m[1].replace(/\s/g, '');
        const rest = dl.replace(/IBAN/i, '').replace(m[1], '').trim();
        if (rest) purposeLines.push(rest);
      } else {
        purposeLines.push(dl);
      }
    }
    txns.push({
      id: txnId(),
      date: cur.date,
      name: cur.name.trim(),
      iban,
      purpose: purposeLines.join(' ').replace(/\s+/g, ' ').trim(),
      amount: cur.amount,
      raw: [cur.name, ...descLines].join(' | ')
    });
    cur = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+/g, ' ').trim();
    if (!line) continue;
    if (isFooter(line) || isHeaderRow(line)) continue;
    const dm = line.match(DATE_AT_START);
    if (dm) {
      flush();
      const date = parseGermanDate(dm[0]);
      let rest = line.slice(dm[0].length).trim();
      let amount = NaN;
      const am = rest.match(AMOUNT_AT_END);
      if (am) {
        amount = parseEUR(am[1]);
        rest = rest.slice(0, am.index).trim();
      }
      cur = { date, amount, name: rest, desc: [] };
    } else if (cur) {
      // Betrag steht evtl. erst in einer eigenen Zeile rechts.
      if (Number.isNaN(cur.amount)) {
        const am = line.match(AMOUNT_AT_END);
        if (am && line.replace(am[1], '').trim() === '') { cur.amount = parseEUR(am[1]); continue; }
      }
      cur.desc.push(line);
    }
  }
  flush();
  return txns.filter((t) => t.date && Number.isFinite(t.amount));
}

// PDF -> Transaction[]. pdf.js wird nur hier (lazy) geladen.
export async function parseDkbPdf(file) {
  const pdfjs = await import('pdfjs-dist');
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

  const buf = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: buf }).promise;
  const allLines = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const items = content.items
      .filter((it) => it.str && it.str.trim() !== '')
      .map((it) => ({ str: it.str, x: it.transform[4], y: it.transform[5] }));
    items.sort((a, b) => (b.y - a.y) || (a.x - b.x));
    let lineY = null;
    let buffer = [];
    const pushLine = () => {
      if (!buffer.length) return;
      buffer.sort((a, b) => a.x - b.x);
      allLines.push(buffer.map((i) => i.str).join(' '));
      buffer = [];
    };
    for (const it of items) {
      if (lineY === null || Math.abs(it.y - lineY) <= 3) {
        buffer.push(it);
        lineY = lineY === null ? it.y : (lineY + it.y) / 2;
      } else {
        pushLine();
        buffer.push(it);
        lineY = it.y;
      }
    }
    pushLine();
  }
  return transactionsFromLines(allLines);
}

// ---- CSV (DKB-Umsätze) ----------------------------------------------------

function splitCsvLine(line, sep) {
  const out = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQ = false;
      } else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === sep) { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function findHeader(lines) {
  for (let i = 0; i < lines.length; i++) {
    if (/Betrag/i.test(lines[i]) && /(Verwendungszweck|Buchungs|Wertstellung|Auftraggeber|Zahlungs)/i.test(lines[i])) {
      return i;
    }
  }
  return -1;
}

function colIndex(headers, patterns) {
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i].toLowerCase();
    if (patterns.some((p) => h.includes(p))) return i;
  }
  return -1;
}

export function parseDkbCsv(text) {
  const clean = String(text).replace(/^﻿/, '');
  const lines = clean.split(/\r?\n/);
  const sep = (clean.match(/;/g) || []).length >= (clean.match(/,/g) || []).length ? ';' : ',';
  const hIdx = findHeader(lines);
  if (hIdx < 0) return [];
  const headers = splitCsvLine(lines[hIdx], sep);
  const ci = {
    date: colIndex(headers, ['buchungsdatum', 'buchungstag', 'wertstellung', 'datum']),
    name: colIndex(headers, ['zahlungspflichtig', 'auftraggeber', 'beg', 'zahlungsempf', 'name']),
    iban: colIndex(headers, ['iban', 'kontonummer']),
    purpose: colIndex(headers, ['verwendungszweck', 'beschreibung']),
    amount: colIndex(headers, ['betrag'])
  };
  const txns = [];
  for (let i = hIdx + 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const cols = splitCsvLine(lines[i], sep);
    if (cols.length < 2) continue;
    const amount = parseEUR(ci.amount >= 0 ? cols[ci.amount] : '');
    if (!Number.isFinite(amount)) continue;
    let date = parseGermanDate(ci.date >= 0 ? cols[ci.date] : '');
    if (!date && ci.date >= 0 && /^\d{4}-\d{2}-\d{2}/.test(cols[ci.date])) date = cols[ci.date].slice(0, 10);
    txns.push({
      id: txnId(),
      date,
      name: ci.name >= 0 ? cols[ci.name] : '',
      iban: ci.iban >= 0 ? cols[ci.iban].replace(/\s+/g, '') : '',
      purpose: ci.purpose >= 0 ? cols[ci.purpose] : '',
      amount,
      raw: lines[i]
    });
  }
  return txns.filter((t) => t.date);
}

// Einstiegspunkt: anhand Dateiendung/Typ den passenden Parser wählen.
export async function parseFile(file) {
  const name = (file.name || '').toLowerCase();
  if (name.endsWith('.pdf') || file.type === 'application/pdf') {
    return parseDkbPdf(file);
  }
  const text = await file.text();
  return parseDkbCsv(text);
}
