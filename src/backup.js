// Daten sichern/wiederherstellen (JSON) + Bootstrap-Import (JSON oder CSV).
import { ICO, escapeHtml, openModal, closeModal, confirmDialog, toast } from './ui.js';
import { state, save, applyImportedState } from './main.js';
import { parseEUR, fmtEUR } from './money.js';
import { scheduleLabel } from './data/schedules.js';
import { parseMobilfunkPdf, buildImportFromLog } from './parseTable.js';

export function exportBackup() {
  const data = JSON.stringify({
    schema: state.schema,
    people: state.people,
    ledger: state.ledger,
    costs: state.costs,
    settings: state.settings,
    exported: Date.now()
  }, null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `finanzguru-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  toast('Sicherung gestartet', 'ok');
}

function uid() {
  return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// Einfaches Personen-CSV -> Personen-Objekte.
function parsePeopleCsv(text) {
  const lines = String(text).replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const sep = (lines[0].match(/;/g) || []).length >= (lines[0].match(/,/g) || []).length ? ';' : ',';
  const header = lines[0].split(sep).map((h) => h.trim().toLowerCase());
  const idx = (name) => header.indexOf(name);
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(sep);
    const get = (n) => { const j = idx(n); return j >= 0 ? (cols[j] || '').trim() : ''; };
    const name = get('name');
    if (!name) continue;
    const cardType = get('cardtype');
    out.push({
      id: uid(),
      name,
      ibans: get('ibans').split(/[,|]/).map((s) => s.trim()).filter(Boolean),
      paymentMethod: get('paymentmethod') || 'ueberweisung',
      schedule: get('schedule') || 'monthly',
      dayOfMonth: parseInt(get('dayofmonth'), 10) || 1,
      anchorMonth: get('anchormonth') || '',
      expectedAmount: parseEUR(get('expectedamount')) || 0,
      cards: cardType ? [{ type: cardType, phone: get('phone'), simNr: get('simnr'), auftragsNr: '', owner: '', simKind: 'sim', activeSince: '', runtimeUntil: '', idDoc: '', notes: '' }] : [],
      notes: get('notes')
    });
  }
  return out;
}

export function importData() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,.csv,application/json,text/csv';
  input.onchange = async () => {
    const file = input.files && input.files[0];
    if (!file) return;
    const text = await file.text();
    const isJson = file.name.toLowerCase().endsWith('.json') || text.trim().startsWith('{');
    try {
      if (isJson) {
        const obj = JSON.parse(text);
        if (!Array.isArray(obj.people)) { toast('Keine Personen in der Datei', 'err'); return; }
        const ok = await confirmDialog(
          `Import enthält ${obj.people.length} Personen. Vorhandene Daten ersetzen?`,
          { okLabel: 'Ersetzen', danger: true });
        if (!ok) return;
        applyImportedState({
          people: obj.people,
          ledger: obj.ledger && typeof obj.ledger === 'object' ? obj.ledger : {},
          costs: obj.costs && typeof obj.costs === 'object' ? obj.costs : state.costs,
          settings: obj.settings && typeof obj.settings === 'object' ? obj.settings : state.settings
        });
        toast('Import erfolgreich', 'ok');
      } else {
        const people = parsePeopleCsv(text);
        if (!people.length) { toast('Keine Personen erkannt', 'err'); return; }
        const ok = await confirmDialog(
          `${people.length} Personen aus CSV gefunden. Zu den vorhandenen hinzufügen?`,
          { okLabel: 'Hinzufügen' });
        if (!ok) return;
        state.people.push(...people);
        save();
        applyImportedState({ people: state.people, ledger: state.ledger });
        toast(`${people.length} Personen importiert`, 'ok');
      }
    } catch (e) {
      console.warn('import failed', e);
      toast('Datei ungültig', 'err');
    }
  };
  input.click();
}

// ---- Mobilfunk-Tabellen-PDF importieren -----------------------------------
export function importTablePdf() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.pdf,application/pdf';
  input.onchange = async () => {
    const file = input.files && input.files[0];
    if (!file) return;
    toast('PDF wird gelesen…');
    try {
      const { entries, costs } = await parseMobilfunkPdf(file);
      if (!entries.length) { toast('Keine Tabellen-Zeilen erkannt. Ist es der Tabellen-Export?', 'err'); return; }
      const built = buildImportFromLog(entries, costs, state.people, state.ledger);
      if (!built.summary.length) { toast('Keine Personen im Zahlungs-Log gefunden', 'err'); return; }
      showTablePreview(built);
    } catch (e) {
      console.warn('table import failed', e);
      toast('PDF konnte nicht gelesen werden', 'err');
    }
  };
  input.click();
}

let pendingTableImport = null;

function showTablePreview(built) {
  pendingTableImport = built;
  const { summary, costs } = built;
  const neu = summary.filter((s) => s.isNew).length;
  const upd = summary.length - neu;
  const rows = summary.map((s) => `
    <div class="imp-row">
      <div class="dash-meta"><b>${escapeHtml(s.name)}</b>
        <small>${fmtEUR(s.expectedAmount)} · ${escapeHtml(scheduleLabel(s.schedule))} · ${s.cards} Karte(n) · ${s.payments} Zahlung(en)</small></div>
      <span class="status-badge" style="--sc:${s.isNew ? '#2fb86b' : '#2d9cdb'}">${s.isNew ? 'neu' : 'Update'}</span>
    </div>`).join('');
  const costKeys = Object.keys(costs);
  const costStr = costKeys.length
    ? `<p class="muted small" style="margin:6px 0 0">Kosten erkannt: ${costKeys.map((k) => fmtEUR(costs[k])).join(' · ')}</p>` : '';
  openModal('Tabelle importieren', `
    <p class="small" style="margin:0 0 8px">${summary.length} Personen erkannt (${neu} neu, ${upd} aktualisiert). Beträge & Rhythmus sind Startwerte – in „Personen" jederzeit editierbar.</p>
    ${costStr}
    <div class="imp-list" style="margin:12px 0">${rows}</div>
    <p class="muted small">${ICO.shield} Hinweis: SIM-/Telefonnummern (Seite 3) und IBANs sind in dieser PDF nicht enthalten. IBANs lernt die App automatisch beim DKB-Import.</p>
    <div class="modal-actions" style="margin-top:8px">
      <button class="btn btn-ghost" onclick="closeModal()">Abbrechen</button>
      <button class="btn btn-primary" onclick="applyTableImport()">${summary.length} importieren</button>
    </div>`, { onClose: () => { pendingTableImport = null; } });
}

export function applyTableImport() {
  const built = pendingTableImport;
  pendingTableImport = null;
  if (!built) { closeModal(); return; }
  applyImportedState({ people: built.people, ledger: built.ledger, costs: built.costs });
  closeModal();
  toast(`${built.summary.length} Personen importiert`, 'ok');
}

Object.assign(window, { exportBackup, importData, importTablePdf, applyTableImport });
