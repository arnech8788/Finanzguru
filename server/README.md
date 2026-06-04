# Finanzguru Push-Server (Cloudflare Worker)

Kleiner, datensparsamer **Web-Push-Verteiler**. Er speichert **nur** das Push-Abo deines
Geräts und die von der App vorberechneten Erinnerungen (Zeitpunkt + generischer Text wie
„DKB-Export hochladen"). **Keine** Namen, Beträge oder IBANs. Ein Cron-Trigger sendet
fällige Erinnerungen – so kommen Push auch an, wenn die App geschlossen ist.

## Voraussetzungen
- Cloudflare-Account (kostenloser Plan genügt)
- Node.js + npm

## Einrichtung (einmalig)

```bash
cd server
npm install

# 1) VAPID-Schlüssel erzeugen (Public + Private)
npx web-push generate-vapid-keys
#  -> Public Key  : kommt in wrangler.toml (VAPID_PUBLIC_KEY) UND in die App
#  -> Private Key : NICHT in die Datei! -> als Secret (siehe unten)

# 2) KV-Namespace anlegen und die ausgegebene id in wrangler.toml eintragen
npx wrangler kv namespace create SUBS

# 3) wrangler.toml anpassen:
#    - kv_namespaces.id            = <die KV-id aus Schritt 2>
#    - VAPID_SUBJECT               = "mailto:deine@mail.de"
#    - VAPID_PUBLIC_KEY            = <Public Key aus Schritt 1>

# 4) Private VAPID-Key als Secret hinterlegen
npx wrangler secret put VAPID_PRIVATE_KEY   # Private Key aus Schritt 1 einfügen

# 5) Deployen
npx wrangler deploy
#  -> liefert die URL, z. B. https://finanzguru-push.<dein-subdomain>.workers.dev
```

## In der App eintragen
**Mehr → Erinnerungen → Erweitert: Push-Server**
- **Server-URL**: die `…workers.dev`-URL aus Schritt 5
- **VAPID Public Key**: der Public Key aus Schritt 1

Danach „Push-Erinnerungen" aktivieren und die Benachrichtigungserlaubnis erteilen. Die App
abonniert Push und schickt dem Worker ihre Erinnerungen; bei jeder Datenänderung wird neu
synchronisiert.

## Endpunkte
- `POST /subscribe` – `{ subscription, reminders:[{at,title,body,tag}], tz }` (ersetzt das
  gespeicherte Abo). Erlaubt CORS von überall.
- `POST /unsubscribe` – `{ endpoint }`
- **Cron** (alle 15 Min, in `wrangler.toml` änderbar): sendet Erinnerungen, deren Zeitpunkt
  erreicht ist (mit Dedupe per `tag`), und entfernt abgemeldete Endpunkte (HTTP 410/404).

## Hinweise
- Web-Push/VAPID-Verschlüsselung übernimmt `@block65/webcrypto-web-push` (Web-Crypto-tauglich
  für Worker). `web-push` ist nur als Dev-Abhängigkeit für die Key-Erzeugung enthalten.
- Der Worker kennt keine Finanzdaten; die konkreten offenen Posten zeigt ausschließlich die
  App lokal beim Öffnen.
