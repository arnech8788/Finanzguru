# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Project Overview

**Finanzguru** ist eine PWA, um die **Rückzahlungen für einen gemeinsamen Telekom-
„Unlimited"-Mobilfunkvertrag** zu verfolgen. Mehrere Personen nutzen je eine PlusKarte
oder MultiSIM und zahlen monatlich (manche vierteljährlich/jährlich, per Überweisung/
PayPal/Netflix-Guthaben) ihren Anteil zurück. Die App zeigt **wer wann wie viel und wie
oft** zahlen muss (Soll/Ist-Matrix), gleicht hochgeladene **DKB-Kontoauszüge (PDF/CSV)**
automatisch mit den erwarteten Zahlungen ab und führt ein **Karten-/SIM-Inventar** sowie
eine **Kostenrechnung**. Läuft komplett im Browser, offline-fähig, mit **Vite**
(+ `vite-plugin-pwa`) gebaut. **Alle Daten bleiben lokal** (`localStorage`).

## Build & Entwicklung

- `npm install`
- `npm run dev` – Dev-Server mit Hot Reload
- `npm run build` – Production-Build nach `dist/`
- `npm run preview` – Build-Vorschau

Service Worker via `vite-plugin-pwa` (Workbox, `generateSW`); kein manuelles `sw.js`.
Update-Toast via `registerSW({ onNeedRefresh })` in `src/main.js`. PDF-Parsing nutzt
`pdfjs-dist`, das **nur bei Bedarf** (lazy `import()`) geladen wird.

## Deployment

Push auf `main` → GitHub Action (`.github/workflows/firebase-hosting-merge.yml`) baut mit
Vite und deployt `dist/` auf den **Live-Channel** von **Firebase Hosting**. Jeder Pull
Request erzeugt zusätzlich über `firebase-hosting-pull-request.yml` einen temporären
**Preview-Channel** mit eigener URL (als PR-Kommentar). Hosting-Konfiguration in
`firebase.json` (SPA-Rewrite auf `/index.html`, Cache-Header: `index.html`/Service-Worker
`no-cache`, gehashte `/assets/**` `immutable`), Projekt-ID in `.firebaserc`. Custom Domain
(`finanzguru.arne-chudobba.de`) wird in der Firebase-Console verbunden. Base ist `/`.
CI-Login per Service-Account im GitHub-Secret `FIREBASE_SERVICE_ACCOUNT`.

## Architektur

Statische Hülle (`index.html`) + `styles.css`, App-Logik in ES-Modulen unter `src/`:

- **`src/main.js`** – Entry Point: globaler `state`, `save()`/`load()`, Navigation
  (`showScreen`, History/`popstate`), Theme, „Mehr"-Screen, PWA-Registrierung,
  `applyImportedState`, `rerenderDashboard`. Registriert onclick-Funktionen per
  `Object.assign(window, …)`.
- **`src/ui.js`** – Toast, Modal (`openModal`/`updateModalBody`/`closeModal`), Confirm,
  `escapeHtml`, `highlight`, Icons (`ICO`).
- **`src/dashboard.js`** – Übersicht: Status des gewählten Monats (offen/teilweise/
  bezahlt/voraus), Summen, Schnell-Buchung.
- **`src/people.js`** – Personen-CRUD + Karten/SIM-Inventar (Editor mit Arbeitskopie
  `draft` + `updateModalBody`-Re-Render für dynamische Kartenliste).
- **`src/ledger.js`** – Soll/Ist-Buch: `state.ledger[personId][month]` (erhaltene
  Beträge), `statusFor()`, Matrix-Ansicht, Zell-Editor. Soll-Beträge werden **nicht**
  gespeichert, sondern live aus dem Rhythmus berechnet.
- **`src/import.js`** – DKB-Import-UI: Datei wählen → `parse.js` → `match.js` →
  Checkliste + Unmatched-Bucket; bucht in `ledger`, lernt IBANs.
- **`src/parse.js`** – reine Parser: `parseDkbPdf` (lazy pdf.js, Zeilen per y-Cluster),
  `parseDkbCsv` → einheitliche `Transaction`.
- **`src/match.js`** – reine Abgleich-Logik: Normalisierung, Scoring (IBAN > Name >
  Betrag), `matchMonth()` mit Confidence + Unmatched.
- **`src/costs.js`** – Kostenrechnung (Vertragskosten editierbar vs. Summe Einnahmen).
- **`src/backup.js`** – JSON-Sicherung Export/Import + Bootstrap-Import (JSON/CSV).
- **`src/money.js`** – `fmtEUR`/`parseEUR`/Datums- & Monatshelfer.
- **`src/data/`** – reine Enums/Labels (KEINE personenbezogenen Daten):
  `cardTypes.js`, `paymentMethods.js`, `schedules.js` (Rhythmus → Soll je Monat).

### Konventionen

- **onclick-Handler**: jede in `innerHTML` referenzierte Funktion muss `export`iert und
  in einem `Object.assign(window, …)` registriert sein.
- **Geteilter State**: `export let state` in `main.js` (live binding). Nach Änderungen
  `save()` aufrufen.
- **Rendering**: jede `render*`-Funktion schreibt `innerHTML` ihres Screens.
- **Navigation/History**: zentral in `main.js`; Modals pushen via `window.__navModalOpen`
  einen History-Eintrag, Zurück schließt erst Modal, dann verlässt an der Wurzel die App.

## Datenschutz (wichtig)

Das Hosting (Firebase Hosting) ist **öffentlich**. Es dürfen **niemals** echte Personendaten (Namen, IBANs,
Telefon-/SIM-Nummern, Kontodaten, Adressen) in committete Dateien gelangen – auch nicht in
`src/data/*` oder Test-Fixtures. Alle echten Daten leben nur im `localStorage`. Die App
überträgt nichts an Server; PDF/CSV werden ausschließlich im Browser ausgewertet.
`.gitignore` blockt zusätzlich `*.pdf`, `*.csv`, `*-backup*.json`, `*-bootstrap*.json`.
Für Tests **synthetische** Fixtures mit Fantasienamen/IBANs verwenden.
