# CustomerManagement

[![CI/CD](https://github.com/sirtheta/CustomerManagement/actions/workflows/release.yml/badge.svg)](https://github.com/sirtheta/CustomerManagement/actions/workflows/release.yml)

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](LICENSE)

Eine selbst gehostete **Kundenverwaltung für Schweizer Kleinunternehmen**. Verwalte
Kunden, schreibe Offerten und Rechnungen mit korrektem **Schweizer QR-Zahlteil**,
versende sie per E-Mail und behalte offene Zahlungen, Mahnungen und deinen Umsatz im Blick
— alles in einer einzigen, datenschutzfreundlichen Web-Anwendung auf deinem eigenen Server.

> Die Benutzeroberfläche ist vollständig **auf Deutsch**.

---

## Funktionen

- 👥 **Kundenverwaltung** mit Firmen-/Kontaktdaten und Datei-Uploads pro Kunde
- 📄 **Offerten & Rechnungen** mit klarem Status-Workflow (Entwurf → Versendet → Bezahlt …)
- 🇨🇭 **Schweizer QR-Rechnung** als fertiges PDF inkl. IBAN und Firmenlogo
- 🔁 **Wiederkehrende Jahresrechnungen** werden automatisch erstellt
- ⏰ **Zahlungserinnerungen / Mahnwesen** mit mehreren Stufen
- ✉️ **E-Mail-Versand** von Rechnungen direkt aus der App (eigener SMTP-Server)
- 🔔 **Benachrichtigungen** über überfällige Posten per E-Mail oder Telegram
- 💰 **Buchhaltung & GuV** mit Ausgaben-Erfassung und visualisierter Gewinn-/Verlust-Rechnung (Einnahmen − Ausgaben pro Monat)
- 📊 **Auswertungen** zu Umsatz, Rechnungsstatus, Kategorien und Top-Kunden
- 🗂️ **Vorlagen & Dienstleistungen** für schnelles Erstellen wiederkehrender Positionen
- 🔍 **Volltextsuche** über Kunden, Rechnungen und Offerten
- 👤 **Benutzer & Rollen** (Admin, Editor, Viewer) mit optionaler **2-Faktor-Authentifizierung**
- 📝 **Audit-Log** protokolliert alle wichtigen Änderungen
- 📤 **CSV-Export** von Kunden, Rechnungen und Offerten

---

## Schnellstart (Docker)

Du brauchst nur [Docker](https://docs.docker.com/get-docker/) mit Compose. Ein fertiges
Image wird automatisch bereitgestellt — kein eigener Build nötig.

```bash
# 1. compose-Datei und Beispiel-Konfiguration holen
mkdir customer-management && cd customer-management
curl -O https://raw.githubusercontent.com/sirtheta/CustomerManagement/main/docker-compose.yml
curl -o .env https://raw.githubusercontent.com/sirtheta/CustomerManagement/main/.env.example

# 2. .env anpassen — mindestens AUTH_SECRET und AUTH_URL setzen
#    Secret erzeugen:
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

# 3. Starten
docker compose up -d
```

Die App läuft anschliessend unter `http://localhost:3000` (bzw. deiner `AUTH_URL`).
Beim ersten Start wird automatisch ein Admin-Konto angelegt; ist kein Passwort gesetzt,
wird ein einmaliges Passwort ins Log geschrieben — nach dem ersten Login sofort ändern.

Deine Daten (SQLite-Datenbank, hochgeladene Dokumente) liegen persistent im Ordner `./data`.

---

## Konfiguration

Die wichtigsten Umgebungsvariablen in der `.env`:

| Variable | Beschreibung |
| --- | --- |
| `AUTH_SECRET` | Zufälliger Schlüssel zum Signieren der Sessions (min. 32 Zeichen) |
| `AUTH_URL` | Öffentliche URL der Anwendung (z. B. `https://kunden.meine-firma.ch`) |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | Zugangsdaten des ersten Admin-Kontos (optional) |
| `NOTIFY_CRON_SCHEDULE` | Zeitplan für Benachrichtigungen (Standard: täglich 08:00) |

Firmendaten, Logo, SMTP-Zugang, Nummern-Präfixe und Benachrichtigungen werden bequem
in der App unter **Einstellungen** verwaltet — nicht über Umgebungsvariablen.

---

## Technologie

Next.js 16 · React 19 · TypeScript · Tailwind CSS 4 · Prisma + SQLite · NextAuth.
Das Image läuft auf `amd64` und `arm64` (z. B. Raspberry Pi 5).

Entwickler:innen finden die Anleitung zum lokalen Aufsetzen, zur Architektur und zum
Datenmodell in [CLAUDE.md](CLAUDE.md).

---

## Lizenz

Diese Software steht unter der [GNU Affero General Public License v3.0](LICENSE) (AGPL-3.0).
Das bedeutet: Du darfst den Code frei nutzen, verändern und weitergeben. Wer jedoch eine
(auch modifizierte) Version über ein Netzwerk als Dienst anbietet, muss den Quellcode
dieser Version ebenfalls unter der AGPL-3.0 offenlegen.
