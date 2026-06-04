// Entry Point: globaler State, Persistenz, Navigation, Theme, PWA, "Mehr"-Screen.
import { registerSW } from 'virtual:pwa-register';
import { ICO, escapeHtml, openModal, closeModal, isModalOpen, removeModalDOM } from './ui.js';
import { renderDashboard } from './dashboard.js';
import { renderPeople } from './people.js';
import { renderLedger } from './ledger.js';
import { renderImport } from './import.js';
import { renderCosts } from './costs.js';
import { exportBackup, importData } from './backup.js';

const STORE_KEY = 'finanzguru-v1';
const THEME_KEY = 'finanzguru-theme';

// ---- State ----------------------------------------------------------------
export let state = {
  schema: 1,
  people: [],
  ledger: {},
  costs: { grundgebuehr: 0, plusKarteMonatlich: 0, multiSimMonatlich: 0, sonstige: 0, aufschlagJeSim: 0 },
  settings: { amountTolerance: 0.5, dateGraceDays: 5 }
};

export let currentScreen = 'dashboard';

// ---- Persistenz -----------------------------------------------------------
export function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  } catch (e) {
    console.warn('save failed', e);
  }
}

export function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      state = { ...state, ...parsed };
    }
  } catch (e) {
    console.warn('load failed', e);
  }
  // Defensive Defaults / Migration
  if (!Array.isArray(state.people)) state.people = [];
  if (!state.ledger || typeof state.ledger !== 'object') state.ledger = {};
  if (!state.costs || typeof state.costs !== 'object') state.costs = {};
  if (!state.settings || typeof state.settings !== 'object') state.settings = {};
  if (state.settings.amountTolerance == null) state.settings.amountTolerance = 0.5;
  if (state.settings.dateGraceDays == null) state.settings.dateGraceDays = 5;
  state.schema = 1;
}

// Wird vom Backup-/Bootstrap-Import aufgerufen.
export function applyImportedState(partial) {
  if (Array.isArray(partial.people)) state.people = partial.people;
  if (partial.ledger && typeof partial.ledger === 'object') state.ledger = partial.ledger;
  if (partial.costs && typeof partial.costs === 'object') state.costs = { ...state.costs, ...partial.costs };
  if (partial.settings && typeof partial.settings === 'object') state.settings = { ...state.settings, ...partial.settings };
  save();
  renderActive(currentScreen);
}

// Übersicht neu zeichnen, wenn sie das aktive Screen ist (von anderen Modulen genutzt).
export function rerenderDashboard() {
  if (currentScreen === 'dashboard') renderDashboard();
}

// ---- Navigation (History-gesteuert) ---------------------------------------
function updateScreenVisibility(name) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
  document.querySelectorAll('.nav button').forEach((b) => b.classList.remove('active'));
  document.getElementById('screen-' + name)?.classList.add('active');
  document.getElementById('nav-' + name)?.classList.add('active');
  window.scrollTo(0, 0);
}

function renderActive(name) {
  if (name === 'dashboard') renderDashboard();
  else if (name === 'people') renderPeople();
  else if (name === 'ledger') renderLedger();
  else if (name === 'import') renderImport();
  else if (name === 'costs') renderCosts();
  else if (name === 'more') renderMore();
}

function applyScreen(name) {
  currentScreen = name;
  updateScreenVisibility(name);
  renderActive(name);
}

function pushNav(stateObj) {
  history.pushState(stateObj, '');
}

function applyNav(st) {
  const s = st || { screen: 'dashboard', modal: false };
  if (isModalOpen() && !s.modal) removeModalDOM();
  applyScreen(s.screen || 'dashboard');
}

export function showScreen(name) {
  const sameRoot = name === currentScreen && !isModalOpen();
  if (!sameRoot) pushNav({ app: true, screen: name, modal: false });
  applyScreen(name);
}

export function navBack() {
  history.back();
}

// ---- Theme ----------------------------------------------------------------
export function getTheme() {
  return document.documentElement.getAttribute('data-theme') || 'dark';
}
export function toggleTheme() {
  const next = getTheme() === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem(THEME_KEY, next);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', next === 'dark' ? '#13161c' : '#2fb86b');
  if (currentScreen === 'more') renderMore();
}
function initTheme() {
  const saved = localStorage.getItem(THEME_KEY) || 'dark';
  document.documentElement.setAttribute('data-theme', saved);
}

// ---- "Mehr" / Einstellungen ----------------------------------------------
const APP_VERSION = '1.2.0';
const CHANGELOG = [
  ['1.2.0', 'Der DKB-Import lernt jetzt aus manuellen Zuordnungen: einmal zugeordnete Eingänge werden künftig automatisch erkannt – über die IBAN, über gelernte Namensvarianten (z. B. Ligaturen/Tippfehler/Gemeinschaftskonten) und für anonyme Zahlungen wie PayPal/Netflix über einen gelernten Hinweis (Sammel-IBAN + Betrag).'],
  ['1.1.0', 'Neuer Import der Mobilfunk-Tabelle (PDF): legt Personen, Zahlungshistorie, Zahlart und Kartentypen automatisch aus dem Zahlungs-Log an und übernimmt die Vertragskosten – mit Vorschau und Merge (keine Duplikate). Erreichbar über „Mehr → Daten".'],
  ['1.0.0', 'Erste Version: Übersicht (wer ist diesen Monat offen?), Personen mit Karten/SIM-Inventar, Soll/Ist-Matrix über Monate, DKB-Import (PDF & CSV) mit automatischem Abgleich, Kostenrechnung und Daten-Sicherung. Alle Daten bleiben lokal im Browser.']
];

export function renderMore() {
  const el = document.getElementById('screen-more');
  if (!el) return;
  const theme = getTheme();
  el.innerHTML = `
    <header class="topbar"><h1>Mehr</h1></header>
    <div class="pad">
      <div class="card">
        <div class="card-title">Darstellung</div>
        <button class="row-btn" onclick="toggleTheme()">
          <span class="row-ic">${theme === 'dark' ? ICO.moon : ICO.sun}</span>
          <span>Theme: ${theme === 'dark' ? 'Dunkel' : 'Hell'}</span>
          <span class="row-arrow">wechseln</span>
        </button>
      </div>

      <div class="card">
        <div class="card-title">Daten</div>
        <div class="muted small" style="margin-bottom:10px">${state.people.length} Personen gespeichert. Alles liegt nur auf diesem Gerät.</div>
        <button class="row-btn" onclick="exportBackup()"><span class="row-ic">${ICO.download}</span><span>Sicherung exportieren (JSON)</span><span class="row-arrow">Download</span></button>
        <button class="row-btn" onclick="importData()"><span class="row-ic">${ICO.upload}</span><span>Daten importieren (JSON / CSV)</span><span class="row-arrow">Datei</span></button>
        <button class="row-btn" onclick="importTablePdf()"><span class="row-ic">${ICO.card}</span><span>Mobilfunk-Tabelle (PDF) importieren</span><span class="row-arrow">PDF</span></button>
      </div>

      <div class="card">
        <div class="card-title title-warn">Datenschutz</div>
        <p class="muted small" style="margin:0">Alle Daten (Namen, IBANs, Telefon-/SIM-Nummern, Zahlungen) bleiben <b>ausschließlich lokal</b> in diesem Browser. Es findet keine Übertragung an Server statt. Eine Sicherung kannst du oben als Datei exportieren und sicher aufbewahren.</p>
      </div>

      <div class="card">
        <div class="card-title">Info</div>
        <div class="muted small">Finanzguru · v${APP_VERSION}</div>
        <div class="muted small" style="margin-top:6px">Tracking der Mobilfunk-Rückzahlungen (Telekom PlusKarten/MultiSIM) und Abgleich mit dem DKB-Kontoauszug. Ohne Gewähr.</div>
        <button class="row-btn" style="margin-top:10px" onclick="openChangelog()"><span class="row-ic">${ICO.info}</span><span>Changelog</span><span class="row-arrow">v${APP_VERSION}</span></button>
      </div>
    </div>`;
}

export function openChangelog() {
  openModal('Changelog', CHANGELOG.map(([v, t]) => `<div style="margin-bottom:12px"><b>v${escapeHtml(v)}</b><div class="muted small">${escapeHtml(t)}</div></div>`).join(''));
}

// ---- PWA Update-Toast -----------------------------------------------------
function initPWA() {
  const updateSW = registerSW({
    onNeedRefresh() {
      const el = document.createElement('div');
      el.className = 'update-toast';
      el.innerHTML = `<span>Neue Version verfügbar</span><button class="btn btn-sm btn-primary">Aktualisieren</button>`;
      el.querySelector('button').onclick = () => updateSW(true);
      document.body.appendChild(el);
    }
  });
}

// ---- History-Verdrahtung --------------------------------------------------
function initHistory() {
  history.replaceState({ app: true, screen: 'dashboard', modal: false }, '');
  window.__navModalOpen = () => pushNav({ app: true, screen: currentScreen, modal: true });
  window.addEventListener('popstate', (e) => {
    applyNav(e.state || { screen: 'dashboard', modal: false });
  });
}

// ---- Init -----------------------------------------------------------------
function init() {
  initTheme();
  load();
  initHistory();
  applyScreen('dashboard');
  initPWA();
}

Object.assign(window, {
  showScreen, navBack, toggleTheme, closeModal,
  renderMore, openChangelog, exportBackup, importData
});

document.addEventListener('DOMContentLoaded', init);
