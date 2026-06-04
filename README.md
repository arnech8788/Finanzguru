# Finanzguru

PWA, um die **Rückzahlungen für einen gemeinsamen Telekom-Mobilfunkvertrag** (PlusKarten /
MultiSIM) zu verfolgen und mit dem **DKB-Kontoauszug** abzugleichen.

## Funktionen

- **Übersicht** – Wer hat diesen Monat noch nicht gezahlt? Summen Soll/Erhalten/Offen.
- **Personen** – Beitragszahler mit erwartetem Betrag, Rhythmus (monatlich / alle 2 Monate /
  vierteljährlich im Voraus / jährlich), IBAN(s) und Karten-/SIM-Inventar. Alles editierbar.
- **Soll/Ist** – Matrix erwartet vs. erhalten über mehrere Monate.
- **Import** – DKB-Auszug als **PDF** oder **CSV** laden; automatischer Abgleich per IBAN/
  Name/Betrag. Sichere Treffer übernehmen, unbekannte Eingänge (z. B. PayPal) selbst zuordnen.
- **Kosten** – Vertragskosten gegen Einnahmen (Marge), inkl. Varianten-Aufschlag je SIM.
- **Mehr** – Theme, Daten sichern/wiederherstellen (JSON), Bootstrap-Import (JSON/CSV).

## Datenschutz

**Alle Daten bleiben lokal** im Browser (`localStorage`). Es gibt keinen Server und keinen
Cloud-Sync; hochgeladene PDFs/CSVs werden nur im Browser ausgewertet, nichts wird übertragen.

Da GitHub Pages **öffentlich** ist, sind **keine echten Daten** im Repository enthalten.
Empfehlung: Repository auf **privat** stellen. Eine Sicherung exportierst du über
*Mehr → Daten → Sicherung exportieren* und bewahrst sie sicher auf.

## Entwicklung

```bash
npm install
npm run dev       # Dev-Server
npm run build     # Build nach dist/
npm run preview   # Build lokal prüfen
```

Vite + `vite-plugin-pwa` (offline-fähig). PDF-Parsing über `pdfjs-dist` (nur bei Bedarf geladen).

## Bootstrap-/Import-Format

*Mehr → Daten importieren* akzeptiert:
- eine **JSON-Sicherung** (volles Datenmodell `{ people, ledger, costs, settings }`) – ersetzt die Daten, oder
- ein einfaches **Personen-CSV** (wird hinzugefügt), Kopfzeile:
  `name;ibans;paymentMethod;schedule;dayOfMonth;expectedAmount;cardType;phone;simNr;notes`
  (mehrere IBANs in einer Zelle mit Komma trennen).
