// Entry Point: globaler State, Persistenz, Navigation, Theme, PWA, "Mehr"-Screen.
import { registerSW } from 'virtual:pwa-register';
import { ICO, escapeHtml, openModal, closeModal, isModalOpen, removeModalDOM } from './ui.js';
import { renderDashboard } from './dashboard.js';
import { renderPeople } from './people.js';
import { renderLedger } from './ledger.js';
import { renderImport } from './import.js';
import { renderCosts } from './costs.js';
import { exportBackup, importData } from './backup.js';
import { ensureNotifDefaults, initNotify, requestSync } from './notify.js';

const STORE_KEY = 'finanzguru-v1';
const THEME_KEY = 'finanzguru-theme';

// ---- State ----------------------------------------------------------------
export let state = {
  schema: 1,
  people: [],
  ledger: {},
  costs: { grundgebuehr: 0, plusKarteMonatlich: 0, multiSimMonatlich: 0, sonstige: 0, aufschlagJeSim: 0 },
  settings: { amountTolerance: 0.5, dateGraceDays: 5 },
  invoices: [],     // importierte Telekom-Mobilfunk-Rechnungen
  invoiceMap: {}    // gelernte Position->Person Zuordnung ('sim:'+… / 'tel:'+…)
};

export let currentScreen = 'dashboard';

// ---- Persistenz -----------------------------------------------------------
export function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  } catch (e) {
    console.warn('save failed', e);
  }
  // Erinnerungen nach Datenänderungen neu an den Server synchronisieren (debounced).
  requestSync();
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
  if (!Array.isArray(state.invoices)) state.invoices = [];
  if (!state.invoiceMap || typeof state.invoiceMap !== 'object') state.invoiceMap = {};
  ensureNotifDefaults(state);
  state.schema = 1;
}

// Wird vom Backup-/Bootstrap-Import aufgerufen.
export function applyImportedState(partial) {
  if (Array.isArray(partial.people)) state.people = partial.people;
  if (partial.ledger && typeof partial.ledger === 'object') state.ledger = partial.ledger;
  if (partial.costs && typeof partial.costs === 'object') state.costs = { ...state.costs, ...partial.costs };
  if (partial.settings && typeof partial.settings === 'object') state.settings = { ...state.settings, ...partial.settings };
  if (Array.isArray(partial.invoices)) state.invoices = partial.invoices;
  if (partial.invoiceMap && typeof partial.invoiceMap === 'object') state.invoiceMap = { ...state.invoiceMap, ...partial.invoiceMap };
  if (partial.notifications && typeof partial.notifications === 'object') { state.notifications = partial.notifications; ensureNotifDefaults(state); }
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
const APP_VERSION = '1.15.0';
const CHANGELOG = [
  ['1.15.0', 'Status „Voraus" manuell setzbar: Im Zahlungs-Editor (Soll/Ist-Zelle) gibt es jetzt den Schalter „Als vorausbezahlt markieren". Damit lässt sich ein Monat als bereits abgedeckt kennzeichnen (zeigt „Voraus" statt „offen"), auch ohne Betrag – praktisch, wenn jemand mehrere Monate im Voraus bezahlt hat und die automatische Voraus-Erkennung (Quartal/Guthaben) nicht greift.'],
  ['1.14.0', 'Zwei Verbesserungen: (1) In der Soll/Ist-Matrix bleiben jetzt die Monats-Kopfzeile und die Namensspalte beim Scrollen sichtbar (fixierte Überschriften). (2) Im Zahlungs-Editor kannst du über „Zahlung gilt für Monat" einstellen, für welchen Monat eine Zahlung zählt – ideal bei Vorauszahlungen (z. B. im Mai für das Quartal ab Juni gezahlt); der Eintrag wird dann im Zielmonat verbucht.'],
  ['1.13.0', 'Guthaben-Modell (bei Bedarf, kein fester Rhythmus): Neuer Rhythmus „Guthaben" für Personen, die unregelmäßig per Gutschein zahlen (z. B. 50€-Netflix-/Spotify-Guthaben). Der Betrag wird als Guthaben verbucht und Monat für Monat mit dem eingestellten Anteil „verbraucht". Die App berechnet automatisch, bis wann das Guthaben reicht und ab wann wieder eine Zahlung nötig ist (in der Personen-Ansicht sichtbar), zeigt gedeckte Monate nicht mehr als „offen" an und erinnert rechtzeitig, wenn das Guthaben aufgebraucht ist.'],
  ['1.12.1', 'Kategorie-Auswahl: Beim Anlegen einer Einnahme und im Personen-Editor werden jetzt auch deine bereits vergebenen Kategorien zur Auswahl angeboten (nicht nur die Standardvorschläge). Der Einnahme-Dialog rät die Kategorie zudem aus dem Verwendungszweck.'],
  ['1.12.0', 'Übersicht nach Kategorie: Wenn du mehrere Kategorien nutzt (z. B. Mobilfunk, Spotify, Netflix), erscheinen oben in der Übersicht Filter-Chips. Damit siehst du Soll/Erhalten/Offen und die Liste wahlweise für „Alle Kategorien" oder eine einzelne Kategorie – jeweils mit eigenen Summen.'],
  ['1.11.0', 'Andere wiederkehrende Einnahmen tracken: Im Import kannst du einen nicht zugeordneten DKB-Eingang jetzt per „+ Einnahme" als regelmäßige Einnahme anlegen (z. B. Spotify, Netflix) – mit editierbarem Namen, Kategorie, Betrag und Rhythmus. Die Zahlung wird gebucht und die IBAN gelernt, damit künftige Monate automatisch geprüft werden. Personen haben zudem ein optionales Feld „Kategorie" (Mobilfunk/Spotify/Netflix/…); Karten/SIM bleiben optional.'],
  ['1.10.0', 'Beitritt später möglich: Bei einer Person lässt sich jetzt „Beitrag ab Monat" setzen. Für Monate davor wird nichts erwartet – sie erscheinen nicht mehr fälschlich als „offen" (rot/Minus), sondern als „nicht fällig". Ideal für Personen, die erst später dazugekommen sind.'],
  ['1.9.0', 'Zeitlich gestaffelte Beiträge: Der monatliche Anteil einer Person lässt sich jetzt „ab einem Monat" ändern (z. B. wenn zusätzliche SIM-Karten dazukommen). Im Personen-Editor unter „Beitragsänderungen (ab Monat)" den neuen Betrag ab dem passenden Monat eintragen – frühere Monate bleiben beim bisherigen Betrag, das Soll/Ist wird nicht mehr rückwirkend verändert (kein fälschliches „teilweise" mehr bei bereits bezahlten Monaten).'],
  ['1.8.0', 'Mehr Flexibilität: (1) Neuer Rhythmus „Keine Rückzahlung (zahlt selbst)" – für dich selbst als Person, ohne dass ein Soll entsteht oder etwas als offen erscheint. (2) Bei „Laufzeit bis" lässt sich jetzt zusätzlich ein Datum per Auswahl einfügen (Freitext wie „monatlich kündbar" bleibt möglich). (3) Im Zahlungs-Editor (Soll/Ist-Zelle) gibt es einen einmaligen „Zusatz-Soll" für Sonderkosten wie Bereitstellung, Versand oder zusätzliche SIM-Karten – so wird eine Sammelzahlung korrekt als bezahlt gewertet und nicht als Vorauszahlung verbucht. Den dauerhaft höheren Monatsbeitrag stellst du weiterhin direkt bei der Person ein.'],
  ['1.7.0', 'Karten-Details-Import & manuelle Zahlungen: Unter „Mehr → Daten → Karten-Details importieren" kannst du deine Karten-Tabelle (aus Excel kopieren und einfügen) einlesen – Auftragsnummer, SIM-Nr, Telefonnummer, Besitzer, Ausweisdokument, Verwendung, Aktiv seit, Laufzeit bis und Notizen werden den passenden Personen/Karten zugeordnet (Zuordnung über den Besitzer; leere Felder werden befüllt, vorhandene bleiben erhalten). Außerdem lassen sich im Import-Tab PayPal-/Bar-/sonstige Zahlungen manuell buchen und einer Person/einem Monat zuordnen.'],
  ['1.6.0', 'Push-Test: Unter „Mehr → Erinnerungen → Erweitert" kannst du jetzt einen echten Test-Push über den Push-Server auslösen – mit einstellbarer Verzögerung in Sekunden. So lässt sich prüfen, ob Benachrichtigungen auch bei geschlossener App ankommen (App nach dem Auslösen schließen oder Bildschirm sperren). Voraussetzung: konfigurierter Push-Server.'],
  ['1.5.0', 'Telekom-Rechnungen: Lade eine Mobilfunk-Rechnung (PDF) einfach im Import-Tab – sie wird automatisch erkannt und unter „Kosten → Rechnungen" gespeichert. Dort siehst du alle Rechnungen und einen Abgleich pro Person: Was kostet die Karte laut Rechnung vs. was hat die Person zurückgezahlt (über-/unterdeckt). Positionen ohne passende Karte lassen sich einmalig zuordnen (wird für künftige Rechnungen gelernt). Rechnungen bleiben rein lokal und ändern das Soll/Ist-Buch nicht.'],
  ['1.4.0', 'Erinnerungen: Die App erinnert an den monatlichen DKB-Export (z. B. am 5.), an überfällige monatliche Zahlungen und rechtzeitig vor vierteljährlichen/jährlichen Zahlungen (Vorlauf einstellbar). Lokale Hinweise funktionieren sofort; für echte Push bei geschlossener App lässt sich optional ein kleiner Push-Server (siehe server/) hinterlegen. Alles unter „Mehr → Erinnerungen" konfigurierbar.'],
  ['1.3.0', 'Gelernte Zuordnungen sind jetzt einseh- und löschbar: In der Personen-Ansicht zeigt der Bereich „Gelernt für den Abgleich" IBANs, Namensvarianten und PayPal-/Anonym-Hinweise – einzeln entfernbar oder komplett zurücksetzbar. Im Import lässt sich ein (z. B. falsch gelernter) Vorschlag per „✗" verwerfen und der Eingang landet wieder unter „nicht zugeordnet".'],
  ['1.2.0', 'Der DKB-Import lernt jetzt aus manuellen Zuordnungen: einmal zugeordnete Eingänge werden künftig automatisch erkannt – über die IBAN, über gelernte Namensvarianten (z. B. Ligaturen/Tippfehler/Gemeinschaftskonten) und für anonyme Zahlungen wie PayPal/Netflix über einen gelernten Hinweis (Sammel-IBAN + Betrag).'],
  ['1.1.0', 'Neuer Import der Mobilfunk-Tabelle (PDF): legt Personen, Zahlungshistorie, Zahlart und Kartentypen automatisch aus dem Zahlungs-Log an und übernimmt die Vertragskosten – mit Vorschau und Merge (keine Duplikate). Erreichbar über „Mehr → Daten".'],
  ['1.0.0', 'Erste Version: Übersicht (wer ist diesen Monat offen?), Personen mit Karten/SIM-Inventar, Soll/Ist-Matrix über Monate, DKB-Import (PDF & CSV) mit automatischem Abgleich, Kostenrechnung und Daten-Sicherung. Alle Daten bleiben lokal im Browser.']
];

function notifCard() {
  const n = state.notifications || {};
  const on = !!n.enabled;
  const serverOn = !!(n.server && n.server.url);
  const leadRow = (key, label) => `
    <label class="cost-row"><span>Vorlauf ${escapeHtml(label)} (Tage)</span>
      <input type="number" min="0" max="60" value="${escapeHtml(String((n.leadDays && n.leadDays[key]) != null ? n.leadDays[key] : 7))}" onchange="setNotif('leadDays.${key}', this.value)" ${on ? '' : 'disabled'}></label>`;
  return `
    <div class="card">
      <div class="card-title">Erinnerungen</div>
      <button class="row-btn" onclick="toggleNotifications()">
        <span class="row-ic">${ICO.clock}</span>
        <span>Push-Erinnerungen: ${on ? 'An' : 'Aus'}</span>
        <span class="row-arrow">${on ? (serverOn ? 'Push' : 'lokal') : 'aktivieren'}</span>
      </button>
      ${on ? `
      <div class="notif-settings">
        <label class="cost-row"><span>DKB-Export-Erinnerung am Tag</span>
          <input type="number" min="1" max="28" value="${escapeHtml(String(n.exportDay || 5))}" onchange="setNotif('exportDay', this.value)"></label>
        <label class="cost-row"><span>Uhrzeit</span>
          <input type="time" value="${escapeHtml(n.time || '09:00')}" onchange="setNotif('time', this.value)"></label>
        <label class="cost-row"><span>Überfällig-Erinnerung (monatlich)</span>
          <input type="checkbox" ${n.overdueEnabled !== false ? 'checked' : ''} onchange="setNotif('overdueEnabled', this.checked)"></label>
        <label class="cost-row"><span>… prüfen ab Tag</span>
          <input type="number" min="1" max="28" value="${escapeHtml(String(n.overdueCheckDay || 8))}" onchange="setNotif('overdueCheckDay', this.value)"></label>
        ${leadRow('quarterly', 'vierteljährlich')}
        ${leadRow('yearly', 'jährlich')}
        ${leadRow('bimonthly', 'alle 2 Monate')}
        <button class="row-btn" onclick="sendTestNotification()"><span class="row-ic">${ICO.info}</span><span>Testbenachrichtigung senden</span><span class="row-arrow">Test</span></button>
        <details class="advanced">
          <summary>Erweitert: Push-Server</summary>
          <p class="muted small" style="margin:8px 0">Für Push bei geschlossener App: URL deines Push-Workers + VAPID-Public-Key (siehe server/README.md). Leer = nur lokale Erinnerungen.</p>
          <label class="fld"><span>Server-URL</span><input type="url" value="${escapeHtml((n.server && n.server.url) || '')}" placeholder="https://…workers.dev" onchange="setNotif('server.url', this.value.trim())"></label>
          <label class="fld"><span>VAPID Public Key</span><input type="text" value="${escapeHtml((n.server && n.server.vapidPublicKey) || '')}" placeholder="BNc…" onchange="setNotif('server.vapidPublicKey', this.value.trim())"></label>
          <div class="muted small">Status: ${serverOn ? (n.push && n.push.subscribed ? 'abonniert ✓' : 'konfiguriert, noch nicht abonniert') : 'kein Server (nur lokal)'}</div>
          ${serverOn ? `
          <label class="cost-row" style="margin-top:8px"><span>Test-Push in (Sek.)</span>
            <input type="number" id="pushTestSec" min="3" max="30" value="15"></label>
          <button class="row-btn" onclick="sendPushTest(document.getElementById('pushTestSec').value)"><span class="row-ic">${ICO.clock}</span><span>Test-Push planen &amp; App schließen</span><span class="row-arrow">Push</span></button>
          <p class="muted small" style="margin:6px 0 0">Plant einen echten Push über den Worker. App danach schließen/Bildschirm sperren – die Benachrichtigung kommt nach Ablauf der Zeit.</p>` : ''}
        </details>
      </div>` : `<p class="muted small" style="margin:6px 0 0">Erinnert dich an den DKB-Export, an überfällige monatliche Zahlungen und rechtzeitig vor vierteljährlichen/jährlichen Zahlungen.</p>`}
    </div>`;
}

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

      ${notifCard()}

      <div class="card">
        <div class="card-title">Daten</div>
        <div class="muted small" style="margin-bottom:10px">${state.people.length} Personen gespeichert. Alles liegt nur auf diesem Gerät.</div>
        <button class="row-btn" onclick="exportBackup()"><span class="row-ic">${ICO.download}</span><span>Sicherung exportieren (JSON)</span><span class="row-arrow">Download</span></button>
        <button class="row-btn" onclick="importData()"><span class="row-ic">${ICO.upload}</span><span>Daten importieren (JSON / CSV)</span><span class="row-arrow">Datei</span></button>
        <button class="row-btn" onclick="importTablePdf()"><span class="row-ic">${ICO.card}</span><span>Mobilfunk-Tabelle (PDF) importieren</span><span class="row-arrow">PDF</span></button>
        <button class="row-btn" onclick="openCardImport()"><span class="row-ic">${ICO.sim}</span><span>Karten-Details importieren (Tabelle einfügen)</span><span class="row-arrow">Einfügen</span></button>
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
  initNotify().catch(() => {});
}

Object.assign(window, {
  showScreen, navBack, toggleTheme, closeModal,
  renderMore, openChangelog, exportBackup, importData
});

document.addEventListener('DOMContentLoaded', init);
