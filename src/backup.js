// Daten sichern/wiederherstellen (JSON) + Bootstrap-Import (JSON oder CSV).
import { escapeHtml, confirmDialog, toast } from './ui.js';
import { state, save, applyImportedState } from './main.js';
import { parseEUR } from './money.js';

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

Object.assign(window, { exportBackup, importData });
