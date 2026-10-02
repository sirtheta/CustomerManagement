# Feature-Analyse CustomerManagement

Stand: 02.10.2026 · Basis: Release 1.5.0 plus die danach in `main` gemergten PRs bis #136
Methode: Nur lesende Code-Analyse (Schema, Server Actions, `lib/`, Tests, Git-Historie) plus Web-Recherche für rechtliche/technische Standards.

**Legende**
- **[Code]** = im Code belegt (mit Pfad)
- **[Annahme]** = aus dem Code abgeleitet, nicht bewiesen
- **[Empfehlung]** = mein Vorschlag
- **[Quelle]** = externe Quelle verlinkt
- **[bitte prüfen]** = rechtliche oder fachliche Aussage, die ich nicht verbindlich belegen kann. Bitte mit Treuhänder, Bank oder Behörde klären.

---

## 1. Ist-Zustand in Kürze

1. **Was:** Eine selbst gehostete Kundenverwaltung mit Offerten, Rechnungen (Schweizer QR-Rechnung), Mahnliste, Ausgabenerfassung und einer einfachen Einnahmen-/Ausgaben-Rechnung. [Code] `README.md`, `prisma/schema.prisma`
2. **Stack:** Next.js 16 (App Router, Server Actions), React 19, Prisma 7 mit SQLite (better-sqlite3), NextAuth v5 (Login mit Passwort, optional TOTP), pdfkit + swissqrbill 4.4.1, Nodemailer, node-cron, Recharts. [Code] `package.json`, `package-lock.json`
3. **Betrieb:** Docker-Image für amd64/arm64. Zielplattform ist u. a. ein Raspberry Pi 5. Die Daten liegen lokal in `./data` (SQLite; auch hochgeladene Dateien als BLOB). [Code] `DEPLOYMENT.md`, `docker-compose.yml`, `schema.prisma` (`Document.content Bytes`)
4. **Ein Mandant:** Es gibt genau eine Firma. Alle Zugriffe laufen über `companyInformation`/`applicationSettings.findFirst()`. [Code] z. B. `lib/document-actions.ts`, `lib/yearly-invoices.ts`
5. **Heute vorhanden:** Kunden (mit Notizen, Dateien, Kundennummer, UID, abweichender Rechnungsadresse, Zahlungsfrist und Kontakten), Kundenverlauf und Aufgaben mit Wiedervorlage, Offerten, Umwandlung Offerte → Rechnung, Rechnungen mit Positions- und Gesamtrabatt, Festschreiben und Gutschriften, PDF mit QR-Zahlteil, E-Mail-Versand mit PDF-Archiv, flexible Abos mit Vorlage, Zahlungen mit Teilzahlungen und Offene-Posten-Liste, Mahnwesen mit vier Stufen und eigenem Mahnbeleg (optional mit Gebühr und Verzugszins), CAMT.053-Import mit gespeicherten Bewegungen, externe Zahlungs-API für eine „Budget-App“, Ausgaben mit Beleg, Einnahmen/Ausgaben-Übersicht, Jahresabschluss-Paket (ZIP), Auswertungen, Audit-Log mit Hash-Kette, nächtliches Backup, Rollen Admin/Editor/Viewer, Logs, DB-Export. Optionale Funktionen lassen sich unter Einstellungen → Module abschalten (#131).
6. **Zielgruppe:** [Annahme] Einzelunternehmer oder sehr kleine Firmen (1–3 Nutzer) in der Deutschschweiz, nur Inlandskunden in CHF, die selbst hosten. Dafür spricht: nur CHF, Schuldnerland fest auf „CH“, nur deutsche Oberfläche, Rechnungsversand erst nach Prüfung, Hosting auf dem Raspberry Pi. Für **Vereine** gibt es keine besonderen Funktionen (z. B. Mitglieder, Beiträge).
7. **Qualität:** 126 Unit-/Integrationstest-Dateien, E2E nur für den Login (`tests/e2e/login.spec.ts`). CI mit Lint, Tests, Build und E2E (`.github/workflows/`). Keine TODO/FIXME-Kommentare (Suche nach `TODO|FIXME|HACK|XXX`).
8. **Zuletzt bearbeitet:** laut Git-Historie Mahnwesen mit Mahnbelegen (F8, #126), Aufgaben und Kundenverlauf (F12, #128), erweitertes Kundenmodell (F10, #129), abschaltbare Module (#131) sowie kleine Fixes (#127 Rabattfelder, #130 Benutzerdialoge). Das eingebaute Benutzerhandbuch (`public/benutzerhandbuch.html`) wird mit den Features mitgeführt.
9. **MWST:** Die App enthält **bewusst keine MWST**, da sie höchstens für kleine Geschäfte gedacht ist (Entscheid des Entwicklers). Dieses Dokument schlägt deshalb keine MWST-Funktionen vor.

---

## 2. Lücken und Risiken

### 2.1 Rechnung und Beträge

| # | Befund | Beleg / Suche | Einstufung |
|---|---|---|---|
| R1 | **Keine MWST – bewusster Entscheid.** Kein Steuersatz, kein MWST-Ausweis. | [Code] Suche `mwst\|vat\|mehrwert\|steuer\|tax` in `app lib components prisma scripts`: nur Treffer in `Cache-Control` und einem Marketingtext. | Kein Handlungsbedarf, sondern eine Abgrenzung des Einsatzbereichs: Die App eignet sich damit nur für nicht MWST-pflichtige Betriebe. Ab welcher Umsatzgrenze die Pflicht beginnt, regelt Art. 10 MWSTG [bitte prüfen]. |
| R2 | ~~Keine 5-Rappen-Rundung.~~ **Erledigt (opt-in).** Einstellung «Rechnungsbetrag auf 5 Rappen runden» (`ApplicationSettings.roundTotalTo5Rappen`, Standard aus). Gerundet wird nur das Gesamttotal von Rechnungen und Offerten (nach dem Gesamtrabatt), nicht die Positionen. Das gerundete Total ist das gespeicherte `totalAmount`, damit QR-Betrag, Zahlungen und OP-Liste unverändert damit rechnen. Das PDF zeigt die Differenz als Zeile «Rundung». Gutschriften runden gespiegelt. | [Code] `lib/calculations.ts` (`roundTo5Rappen`, `splitTotals`), `lib/total-options.ts`, `lib/form-parsers.ts`, `lib/subscriptions.ts`, `lib/pdf/document-pdf.ts` | Ob und wann gerundet werden muss, ist Praxis, beim QR-Zahlteil nicht zwingend [bitte prüfen]. Mahngebühr und Verzugszins im Mahnbeleg werden nicht gerundet. |
| R3 | **Nur CHF.** Die Währung ist im QR-Code und im PDF fest „CHF“. | [Code] `lib/pdf/qrbill-helpers.ts` (`currency: "CHF"`), `lib/pdf/document-pdf.ts` (`CHF ${fmt…}`) | Rechnungen in EUR sind nicht möglich. Die QR-Rechnung erlaubt CHF und EUR [Quelle: SIX IG QR-Rechnung, bitte prüfen]. **Bewusst verworfen (Entscheid des Entwicklers):** kein Bedarf. |
| R4 | ~~Keine Auslandskunden~~ **Erledigt mit #111.** `Customer.country` und `CompanyInformation.companyCountry` (ISO-Code, Standard „CH“) werden im QR-Zahlteil und im PDF verwendet. Offen bleibt nur die Währung (R3). | [Code] `schema.prisma`, `lib/pdf/qrbill-helpers.ts`, `lib/pdf/document-pdf.ts` | – |
| R5 | ~~Die Nummer wird schon beim Entwurf vergeben.~~ **Erledigt mit F2.** Entwürfe haben `documentNumber = null` (Anzeige „Entwurf“). Die Nummer wird beim ersten Versand bzw. beim Verlassen von „Entwurf“ vergeben (`assignDocumentNumber`). Aufbau: Präfix + JJMM + 4 Ziffern. | [Code] `lib/document-number.ts`, `lib/document-actions.ts` | – |
| R6 | ~~Die Logik für Nummern ist doppelt vorhanden~~ **Erledigt mit #110.** Die Jahresrechnung nutzt jetzt `generateInvoiceNumber` aus `lib/document-number.ts`. | [Code] `lib/yearly-invoices.ts` | – |

### 2.2 QR-Rechnung

| # | Befund | Beleg | Einstufung |
|---|---|---|---|
| Q1 | **Ohne Referenz (NON) – bewusster Entscheid.** Die Rechnungsnummer steht als Mitteilung im QR-Code. QR-Referenz (QRR), QR-IBAN und Creditor Reference (SCOR) werden bewusst nicht verwendet (Entscheid des Entwicklers, derzeit kein Bedarf). | [Code] `qrbill-helpers.ts` (`message: invoice.documentNumber`, kein `reference`) | Kein Handlungsbedarf. Folge: Der Zahlungsabgleich hängt davon ab, dass die Bank die Mitteilung unverändert im Kontoauszug weitergibt. |
| Q2 | ~~Die Adresse ist ein einziges Feld~~ **Erledigt mit #111.** Strasse, Hausnummer und Land sind getrennte Felder (`street`, `houseNumber`, `country` bzw. `companyStreet`, `companyHouseNumber`, `companyCountry`). Sie werden als `address`/`buildingNumber`/`country` an swissqrbill übergeben. Bestehende Adressen wurden per Migration aufgeteilt und mit `addressNeedsReview` markiert, bis sie gespeichert werden. | [Code] `schema.prisma`, `lib/address.ts`, `lib/pdf/qrbill-helpers.ts`, `tests/unit/qrbill-data.test.ts`, `tests/integration/structured-addresses-migration.test.ts` | Hintergrund: Seit dem **21.11.2025** sind im QR-Code nur noch strukturierte Adressen zulässig [Quelle: [timesafe.ch](https://timesafe.ch/neue-vorgaben-fuer-qr-rechnungen-ab-november-2025-alles-was-du-wissen-musst/), [KMU Partner Group](https://www.kmupartnergroup.ch/newsroom/aenderungen-bei-qr-rechnungen-in-der-schweiz-ab-21-november-2025)]. Empfehlung: einmal ein PDF mit dem Validator der Bank bzw. von SIX prüfen und die markierten Adressen durchgehen. |
| Q3 | ~~Die IBAN wird serverseitig nicht geprüft.~~ **Erledigt mit F1 (#113).** `saveSettings` prüft die IBAN mit `validateIban` (Länge, Prüfsumme). | [Code] `lib/iban.ts`, `app/(app)/settings/actions.ts` | – |
| Q4 | **Nur Deutsch – bewusster Entscheid.** Die Sprache des QR-Zahlteils wird nicht gesetzt, Rechnungen und Offerten sind deutsch. | [Code] `document-pdf.ts`: `new SwissQRBill(doc.qr)` ohne `language` | Kein Handlungsbedarf. |
| Q5 | Die alten Einzahlungsscheine werden nirgends verwendet. | [Code] Es gibt nur swissqrbill. | In Ordnung. |

### 2.3 Unveränderbarkeit und Nachvollziehbarkeit

| # | Befund | Beleg |
|---|---|---|
| U1 | ~~Versendete und bezahlte Rechnungen lassen sich frei bearbeiten.~~ **Erledigt mit F3.** Nur Entwürfe sind bearbeitbar, `updateDocumentWithItems` wirft `DocumentLockedError`. Korrekturen laufen über Gutschriften. | [Code] `lib/document-actions.ts`, `lib/credit-notes.ts` |
| U2 | ~~Admins können Rechnungen in jedem Status löschen.~~ **Erledigt mit F3.** `deleteInvoice` löscht nur Entwürfe ohne Zahlungen. | [Code] `app/(app)/invoices/actions.ts` |
| U3 | ~~Wird ein Kunde gelöscht, werden alle seine Rechnungen per Cascade mitgelöscht.~~ **Erledigt mit F3.** `Invoice.customer` ist `onDelete: Restrict`, Kunden mit Rechnungen werden archiviert (`Customer.archivedAt`). | [Code] `schema.prisma`, `lib/customer-archive.ts` |
| U4 | ~~Storno ist nur ein Statuswert.~~ **Erledigt mit F3.** Gutschrift als `Invoice` mit `creditNoteForId` und negativen Beträgen, Statuswechsel nur entlang erlaubter Übergänge (`canTransitionInvoice`), `Canceled` ist kein manuelles Ziel. | [Code] `lib/credit-notes.ts`, `lib/state-manager.ts` |
| U5 | ~~Das versendete PDF wird nicht archiviert.~~ **Erledigt mit F4 A.** Das exakte PDF wird einmal gerendert, unter `data/archive/<Jahr>/` schreibgeschützt abgelegt und angehängt. `SentDocument` hält Pfad, SHA-256 und Grösse. Der Abruf prüft den Hash (409 bei Abweichung). Offerten werden nicht archiviert. | [Code] `lib/document-archive.ts`, `lib/invoice-dispatch.ts` |
| U6 | ~~Das Audit-Log ist eine normale, veränderbare Tabelle.~~ **Weitgehend erledigt mit F4 B.** Hash-Kette über alle neuen Einträge, Prüfung unter Einstellungen → Aktivitätsprotokoll. Änderungen und Löschungen einzelner Einträge sind erkennbar, eine vollständige Neuberechnung durch Personen mit Dateizugriff nicht (Hash ohne Schlüssel). Pending-E-Mails werden protokolliert. Schreibfehler werden weiterhin abgefangen (dann fehlt der Eintrag). | [Code] `lib/audit.ts`, `lib/audit-chain.ts` |

**Einordnung:** Geschäftsbücher und Buchungsbelege sind 10 Jahre aufzubewahren (Art. 958f OR). Die Geschäftsbücherverordnung (GeBüV, SR 221.431) verlangt Integrität und Nachvollziehbarkeit [bitte prüfen, ob die App im konkreten Fall als „Geschäftsbuch“ gilt]. Mit dem Stand vor F3/F4 liess sich kaum belegen, *welche* Rechnung dem Kunden tatsächlich zugestellt wurde. Heute sind versendete Rechnungen festgeschrieben und das gesendete PDF ist mit Hash archiviert. Ob das die GeBüV erfüllt, ist weiterhin zu klären (Frage 8 in 7.4).

### 2.4 Zahlungen, Bank und Mahnwesen

| # | Befund | Beleg |
|---|---|---|
| Z1 | ~~Es gibt kein Modell für Zahlungen.~~ **Erledigt mit F5.** `Payment` ist die Quelle der Wahrheit; Status (`PartiallyPaid`, `Paid`) und `paidDate` ergeben sich aus den Zahlungen. Teilzahlungen und Überzahlungen sind abgebildet. Skonto und Debitorenverlust als eigene Zahlungsart sind bewusst verworfen (Entscheid des Entwicklers). | [Code] `lib/payments.ts`, `schema.prisma` |
| Z2 | ~~Im CAMT-Import gilt nur ein Treffer auf den Rappen genau.~~ **Erledigt mit F7 (#123).** Die Nummernerkennung toleriert Leerzeichen, Trennzeichen und fehlendes Präfix, Teilzahlungen werden über `recordPayment` gebucht, der Kundenname dient nur als Vorschlag. | [Code] `lib/import/matching.ts`, `lib/import/document-reference.ts` |
| Z3 | ~~Beim Import werden Währung und IBAN des Auszugs nicht geprüft.~~ **Erledigt mit F7.** Konto-, Währungs- und Saldoprüfung warnen und werden in `BankStatementImport.balanceWarning` festgehalten. | [Code] `lib/import/statement-checks.ts` |
| Z4 | **camt.054 wird nicht unterstützt (bewusst, camt.053 deckt es ab).** Bankbewegungen werden seit F7 gespeichert (`BankStatementImport`, `BankTransaction`, Duplikatschutz über `fingerprint`, Importverlauf mit „Rückgängig“). | [Code] `lib/import/bank-import.ts`, `lib/import/dedupe.ts` |
| Z5 | ~~Die Mahnung ist das normale Rechnungs-PDF~~ **Weitgehend erledigt mit F8 (#126).** Eigener Mahnbeleg (`generateReminderPdf`), konfigurierbare Mahngebühr pro Stufe und Verzugszins (standardmässig aus), vier Stufen. Der Übergang zu Betreibung oder Inkasso (Status, Export) ist bewusst verworfen (Entscheid des Entwicklers). | [Code] `lib/pdf/reminder-pdf.ts`, `lib/reminder-charges.ts`, `lib/reminders.ts`, `app/(app)/invoices/reminders/actions.ts` |
| Z6 | **Kein pain.001, kein eBill, keine E-Rechnung, keine Online-Zahlung – bewusst verworfen (Entscheid des Entwicklers).** | [Code] Suche `pain\|ebill\|twint\|stripe\|payrexx\|postfinance\|peppol\|zugferd`: keine Treffer |
| Z7 | **Erledigt mit F11 (#122): Der Abo-Job legt den Entwurf mit den Positionen der Vorlage an; ohne Vorlage bleibt es ein leerer Entwurf, wird aber nie automatisch versendet.** Ursprünglich: Die Jahresrechnung wird als leerer Entwurf (CHF 0.00) angelegt. Wird die E-Mail verworfen, bleibt eine nummerierte Rechnung über 0 CHF bestehen. | [Code] `lib/yearly-invoices.ts` (`totalAmount: 0`, keine Positionen), `invoices/pending/actions.ts` `discardPendingEmail` löscht nur die E-Mail |

Zur Einordnung: Verzug durch Mahnung (Art. 102 OR), Verzugszins 5 % (Art. 104 OR), Mahngebühren nur bei Vereinbarung [alles bitte prüfen]. Die Bundesverwaltung verlangt E-Rechnungen ab CHF 5'000 Vertragswert (seit 2016) [Quelle: [Bundeskanzlei E-Rechnung](https://www.bk.admin.ch/bk/de/home/digitale-transformation-ikt-lenkung/e-services-bund/services/e-rechnung.html), [verband-e-rechnung.org](https://www.verband-e-rechnung.org/schweiz-macht-e-invoicing-fuer-bundeslieferanten-zur-pflicht/)].

### 2.5 Kundenmodell, CRM

- ~~Das Kundenmodell ist minimal~~ **Erledigt mit F10 (#129).** Zusätzlich zu Kontaktperson, Adresse, Land, E-Mail und Telefon gibt es Kundennummer, UID (mit Prüfziffer), abweichende Rechnungsadresse und -E-Mail, Zahlungsfrist pro Kunde und mehrere Kontakte (nur informativ, kein Versandverteiler). Der Kanton fehlt, bewusst verworfen (Entscheid des Entwicklers). [Code] `schema.prisma` `Customer`/`CustomerContact`, `lib/customer-billing.ts`, `lib/customer-uid.ts`, `lib/customer-number.ts`
- **Nur Deutsch – bewusster Entscheid.** Oberfläche und Dokumente sind deutsch, Mehrsprachigkeit ist nicht vorgesehen. [Code] kein i18n-Framework, Datumsformate fest `de-CH`.
- ~~Keine Aufgaben, Wiedervorlagen oder Aktivitätsverlauf~~ **Erledigt mit F12 (#128).** Aufgaben (`Task`) und Kundenverlauf (`lib/customer-history.ts`) sind vorhanden. Eine Vertriebs-Pipeline gibt es weiterhin nicht (bewusst). [Code] `schema.prisma` `Task`, `lib/tasks.ts`

### 2.6 Buchhaltung

Siehe **Abschnitt 7**.

### 2.7 Technik, die neue Features bremsen könnte

- **Ein Mandant.** `findFirst()` wird für Einstellungen und Firmendaten verwendet. Mehrere Firmen oder Vereine in einer Instanz gehen nicht. Für self-hosted ist das kein Problem, für ein Hosting-Angebot schon. [Code]
- **Beträge sind teils Decimal, teils number.** Gespeichert wird als Prisma `Decimal`, gerechnet aber mit JS-`number` (`toNumber()`, `lib/calculations.ts`). Mit Teilzahlungen, Rabatten und Rundungen steigt das Risiko für Rappendifferenzen. [Code]
- **Dateien als BLOB in SQLite** (`Document.content`, `ExpenseReceipt.content`). Archivierte Rechnungs-PDFs liegen dagegen im Dateisystem (`data/archive`), das Backup der DB deckt sie nicht ab. [Code]
- **Jahresgrenzen folgen der Server-Zeitzone (bewusst verworfen (Entscheid des Entwicklers), kein `TZ` gesetzt)** (`new Date(year, 0, 1)`), siehe `income-statement-queries.ts`. In `Dockerfile`, `docker-compose.yml` und `.env.example` wird kein `TZ` gesetzt (Suche `TZ`). [Annahme] Der Container läuft daher in UTC. Buchungen um Mitternacht können so ins falsche Jahr oder in den falschen Monat fallen.
- **Keine allgemeine API.** Es gibt nur `/api/external/payments` mit einem statischen API-Key. [Code] `app/api/external/payments/route.ts`
- ~~Backups sind manuell.~~ **Erledigt mit F4 C.** Nächtlicher SQLite-Snapshot nach `data/backups/` mit Aufbewahrung (Standard 30 Tage), Fehler gehen an die Admin-Kanäle (`lib/backup.ts`). Kopien ausser Haus sind bewusst nicht Teil der App (rsync/rclone auf `BACKUP_DIR`, siehe `DEPLOYMENT.md`).
- **Das Audit-Log** ist vorhanden, siehe U6.

### 2.8 Datenschutz (revDSG)

- **Belegt:** Hosting im eigenen Betrieb. Secrets werden verschlüsselt gespeichert (`lib/crypto.ts`, `migrateSecretsAtRest`). 2FA, Rollen, Rate-Limit beim Login, CSP-Header (`proxy.ts`), Audit-Log.
- **Nicht gefunden** (Suche `anonym\|retention\|dsg\|datenschutz` in `app lib`; einziger fachlicher Treffer ist die Log-Aufbewahrung in `lib/logs.ts`): kein Löschkonzept und keine Aufbewahrungsfristen pro Datentyp, kein Auskunfts-Export pro Person. Kunden mit Rechnungen werden seit F3 archiviert statt gelöscht (siehe U3), das widerspricht der Aufbewahrungspflicht nicht mehr. Das revDSG ist seit 1.9.2023 in Kraft. Ob ein Bearbeitungsverzeichnis Pflicht ist, hängt u. a. von der Unternehmensgrösse ab [bitte prüfen, Quelle: EDÖB].

---

## 3. Priorisierte Feature-Ideen

Aufwand ist gemessen an der bestehenden Architektur: **gering** = wenige Tage, **mittel** = 1–3 Wochen, **hoch** = mehr als 3 Wochen (für eine Person). Das ist eine grobe Schätzung.

### F1 · IBAN-Prüfung — **Muss**
- **Beschreibung:** *(Strukturierte Adressen und Land sind mit #111 erledigt. Zahlungsreferenz und Mehrsprachigkeit sind bewusst ausgeklammert.)* Serverseitige Prüfung der IBAN beim Speichern der Einstellungen (Länge, Prüfsumme).
- **Nutzen:** Eine falsche IBAN fällt beim Speichern auf und nicht erst, wenn Zahlungen ausbleiben (Q3).
- **Aufwand:** gering
- **Code:** `app/(app)/settings/actions.ts`, `tests/unit/iban-validation.test.ts`
- **Ansatz:** IBAN-Prüfung in `saveSettings` (Prüfsumme nach ISO 13616) und den bisherigen Test auf den echten App-Code umstellen.
- **Umgesetzt (#113):** `lib/iban.ts` (`validateIban`), genutzt in `settings/actions.ts`.

### F2 · Nummer erst beim Versand bzw. bei der PDF-Erzeugung — **Muss**
- **Beschreibung:** Entwürfe (Rechnungen und Offerten) haben keine Nummer. Die Nummer wird beim ersten Versand oder bei der ersten PDF-Erzeugung vergeben und ändert sich danach nicht mehr. Bis dahin zeigt die App „Entwurf“ statt einer Nummer.
- **Nutzen:** Keine Lücken mehr durch gelöschte oder verworfene Entwürfe (R5, Z7). Die Nummern entsprechen der Reihenfolge, in der Dokumente tatsächlich hinausgehen.
- **Aufwand:** gering–mittel
- **Code:** `prisma/schema.prisma` (`documentNumber String?` bei `Invoice` und `Quote`; `@unique` bleibt, SQLite erlaubt mehrere `NULL`), `lib/document-number.ts`, `lib/document-actions.ts` (`createDocumentWithItems` ohne Nummer, `sendDocument` vergibt sie), `app/api/invoices/[id]/pdf/route.ts`, `app/api/quotes/[id]/pdf/route.ts`, `app/(app)/quotes/actions.ts` (`convertQuoteToInvoice`), `lib/yearly-invoices.ts`, `app/(app)/invoices/pending/*`, alle Listen, Suche (`lib/search.ts`) und Exporte, die `documentNumber` anzeigen
- **Ansatz:**
  - Eine Funktion `assignDocumentNumber(tx, kind, id)`: vergibt die Nummer nur, wenn noch keine gesetzt ist, in derselben Transaktion wie die Nummernberechnung (wie heute in `createDocumentWithItems`, inkl. Retry bei Kollision). Aufgerufen von `sendDocument`, `approvePendingEmail`, `sendReminder` und den PDF-Routen.
  - Die PDF-Routen sind `GET`-Anfragen. Wenn dort eine Nummer vergeben wird, darf das nicht versehentlich passieren (z. B. durch Link-Vorschau oder Prefetch). Empfehlung: den Download-Button für Entwürfe als Aktion „Nummer vergeben und PDF erzeugen“ mit Bestätigung umsetzen (Server Action oder `POST`); eine reine Vorschau ohne Nummer zeigt „ENTWURF“.
  - Die Jahresrechnung speichert Betreff und Text der E-Mail heute schon beim Anlegen, mit eingesetzter Nummer (`lib/yearly-invoices.ts`). Die Platzhalter müssen deshalb erst beim Versand ersetzt werden.
  - Für JJMM in der Nummer das Vergabedatum (oder Rechnungsdatum) statt des Erstelldatums verwenden.
  - Migration: bestehende Entwürfe behalten ihre Nummer (einfachste Variante), oder man setzt sie auf `NULL`, wenn sie noch nie versendet wurden (`InvoiceSentLog` leer). Bitte entscheiden.
  - Passt zu F3: sobald eine Nummer vergeben ist, gilt das Dokument als festgeschrieben.
- **Umgesetzt:** `documentNumber` ist nullable, Entwürfe zeigen „Entwurf“, `assignDocumentNumber` in `lib/document-number.ts` vergibt die Nummer beim ersten Versand bzw. Statuswechsel aus „Entwurf“. Spec: `docs/superpowers/specs/2026-09-29-f2-nummer-beim-versand-design.md`.

### F3 · Rechnungen festschreiben, Gutschrift und Storno — **Muss**
- **Beschreibung:** Ab Status „Versendet“ ist eine Rechnung nicht mehr änderbar. Korrekturen laufen über eine **Gutschrift** (eigener Belegtyp mit Bezug zur Originalrechnung) oder einen Storno mit neuer Rechnung. Nicht-Entwürfe können nicht gelöscht werden. Kunden mit Rechnungen können nur archiviert, nicht gelöscht werden. Statuswechsel nur entlang erlaubter Übergänge.
- **Nutzen:** Nachvollziehbarkeit gegenüber Kunden und Behörden (und einem späteren Treuhänder). Das ist die Voraussetzung für jeden Buchhaltungsexport.
- **Aufwand:** mittel
- **Code:** `lib/document-actions.ts`, `app/(app)/invoices/actions.ts`, `invoices/[id]/page.tsx`, `invoices/[id]/edit/page.tsx`, `InvoiceStatusSelect.tsx`, `customers/actions.ts`, `schema.prisma` (`onDelete: Restrict`, `Invoice.kind` bzw. `creditNoteForId`), `lib/state-manager.ts`
- **Ansatz:** Eine Zustandsmaschine in `lib/state-manager.ts` mit einer Tabelle erlaubter Übergänge. Serverseitig prüfen in `updateDocumentWithItems`. Die Gutschrift als `Invoice` mit negativem Betrag oder als eigenes Modell: **bitte mit Treuhänder klären**, wie sie im Export erscheinen soll.
- **Umgesetzt:** Nur Entwürfe sind bearbeit- und löschbar. Zustandsmaschine in `lib/state-manager.ts` (`canTransitionInvoice`). Gutschrift als `Invoice` mit `creditNoteForId` und negativen Beträgen (`lib/credit-notes.ts`); versendete Gutschriften mindern den offenen Betrag des Originals (`lib/payments.ts`, `lib/receivables.ts`) und sind von Mahnwesen, Zahlungen und Auswertungen ausgenommen. `Invoice.customer` ist `onDelete: Restrict`, Kunden mit Rechnungen werden archiviert. Spec: `docs/superpowers/specs/2026-09-30-f3-rechnungen-festschreiben-design.md`.

### F4 · Revisionssicheres Belegarchiv und automatisches Backup — **Muss**
- **Beschreibung:** Beim Versand wird das exakte PDF gespeichert, mit SHA-256-Hash. Das Audit-Log bekommt eine Hash-Kette (jeder Eintrag enthält den Hash des vorherigen). Dazu ein automatisches nächtliches Backup (SQLite-Backup-API) mit Aufbewahrungsregel und optional verschlüsseltem Ziel ausser Haus.
- **Nutzen:** Man kann belegen, was verschickt wurde, und hat Schutz vor Datenverlust auf dem Raspberry Pi (SD-Karte!).
- **Aufwand:** mittel
- **Code:** `lib/document-actions.ts` `sendDocument`, `invoices/reminders/actions.ts`, `invoices/pending/actions.ts`, `lib/audit.ts`, `schema.prisma` (`SentDocument`), `lib/notifications.ts` (Cron), `app/api/export/database/route.ts`
- **Ansatz:** PDFs besser im Dateisystem unter `data/archive/JJJJ/` ablegen als als BLOB, den Hash in der DB speichern. Den Backup-Job an den bestehenden node-cron-Scheduler anhängen (Muster wie `startLogRotationScheduler`). Ob das GeBüV-konform ist: **bitte prüfen lassen**.
- **Umgesetzt:** A PDF-Archiv (`lib/document-archive.ts`, `SentDocument` mit SHA-256, Ablage unter `data/archive/<Jahr>/`), B Hash-Kette im Audit-Log (`lib/audit-chain.ts`, Prüfung in den Einstellungen), C nächtliches Backup (`lib/backup.ts`, Aufbewahrung, Admin-Benachrichtigung bei Fehler). Nicht umgesetzt: verschlüsseltes Ziel ausser Haus (Sache von rsync/rclone). Specs: `docs/superpowers/specs/2026-09-30-f4a-pdf-archiv-design.md`, `…f4c-automatisches-backup-design.md`.

### F5 · Zahlungen und offene Posten (Debitoren) — **Muss**
- **Beschreibung:** Neues Modell `Payment` (Rechnung, Datum, Betrag, Quelle, Bankreferenz). Rechnungsstatus „Teilbezahlt“, Restbetrag, Überzahlung als Guthaben, Skonto und Debitorenverlust (Ausbuchung) als eigene Zahlungsart. Offene-Posten-Liste per Stichtag (z. B. 31.12.) mit Altersstruktur (0–30/31–60/61–90/>90 Tage).
- **Nutzen:** Die Debitorenliste zum Jahresende ist genau das, was der Treuhänder braucht. Teilzahlungen sind im Alltag häufig.
- **Aufwand:** mittel
- **Code:** `schema.prisma`, `lib/payment-matching.ts`, `lib/import/matching.ts`, `app/(app)/invoices/actions.ts`, `accounting/lib/income-statement-queries.ts`, `analytics-queries.ts`, neue Seite `app/(app)/accounting/receivables/`
- **Ansatz:** `markInvoicePaid` wird zu `recordPayment`. Der Status ergibt sich aus der Summe der Zahlungen. Bestehende `Paid`-Rechnungen per Migration in je eine Zahlung über den Gesamtbetrag umwandeln.
- **Umgesetzt:** `Payment` (Datum, Betrag, Quelle `manual | camt-import | budget-import | migration`, Bankreferenz). `recordPayment`, `recordRemainingPayment` und `deletePayment` in `lib/payments.ts` führen Status und `paidDate` nach. Einnahmen in GuV, Auswertungen und Export folgen `Payment.date`. Offene-Posten-Liste mit Altersstruktur und CSV unter `accounting/receivables` (`lib/receivables.ts`). **Bewusst nicht umgesetzt:** Skonto und Debitorenverlust (Ausbuchung) als eigene Zahlungsart. Spec: `docs/superpowers/specs/2026-09-30-f5-zahlungen-offene-posten-design.md`.

### F6 · Jahresabschluss-Paket für die Selbstveranlagung — **Muss**
- **Beschreibung:** Kein Treuhänder, keine Zielsoftware, kein Kontenplan. Die App liefert pro Jahr ein **ZIP**: Journal-CSV (Datum, Beleg-Nr., Typ Einnahme/Ausgabe, Kategorie, Text, Betrag), Einnahmen-/Ausgabenrechnung als PDF und CSV (Ausgaben nach Kategorie, damit man sie in die Steuererklärung übertragen kann), Debitorenliste per 31.12. (aus F5) sowie alle Rechnungs-PDFs und Belege.
- **Nutzen:** Ein Ort für Steuererklärung und Aufbewahrung, und ein Nachweis bei einer Prüfung durch die Steuerbehörde. Grundlage ist das Belegarchiv aus F4. Ob und wie die Debitorenliste im Inventar zum Jahresende verlangt wird, **bitte bei der Steuerverwaltung des Kantons prüfen**.
- **Aufwand:** klein bis mittel
- **Code:** `app/api/export/accounting/route.ts` (heute nur Einnahmen/Ausgaben), `app/api/export/receivables/route.ts` (aus F5), `lib/csv-export.ts`, neuer ZIP-Export, `accounting/lib/income-statement-queries.ts`
- **Ansatz:** Zuerst das ZIP mit dem bestehenden CSV, der GuV und der Debitorenliste. Danach Rechnungs-PDFs und Belege. Kontierung (`Account`) und Zielformate für Banana, bexio oder Abacus sind **bewusst nicht Teil davon**. Wenn später ein Treuhänder dazukommt, lassen sich Konten und ein Format nachrüsten.
- **Umgesetzt (#121):** `GET /api/export/year-package?year=YYYY` (Admin/Editor) streamt ein ZIP mit Journal (Zahlungen nach `Payment.date`, Ausgaben), Jahresübersicht, offenen Posten per 31.12. des Vorjahres und des Jahres, den archivierten PDFs (gesendet, bezahlt oder offen im Jahr), `pruefsummen.csv` und `LIESMICH.txt`. Fehlende oder veränderte PDFs werden weggelassen und gemeldet, nie neu erzeugt. Der Export wird im Audit-Log festgehalten. Spec: `docs/superpowers/specs/2026-09-30-f6-jahrespaket-design.md`.

### F7 · Besserer Bankabgleich — **Sollte**
- **Beschreibung:** Treffersuche robuster machen (z. B. Rechnungsnummer auch mit Leerzeichen oder ohne Präfix erkennen, Kundenname als Zusatzsignal). Teilzahlungen (nach F5). Die importierten Bewegungen werden gespeichert (Duplikatschutz per Bankreferenz, Saldovergleich Anfangs-/Endsaldo). Warnung, wenn Währung oder IBAN nicht passen (Z3). Optional camt.054 als zweiter Parser. Die Ausgabenseite des Auszugs kann direkt als `Expense` übernommen werden.
- **Nutzen:** Das Verbuchen der Zahlungseingänge geht fast automatisch. Die Ausgaben müssen nicht mehr doppelt erfasst werden.
- **Aufwand:** mittel
- **Code:** `lib/import/camt.ts`, `lib/import/matching.ts`, `app/(app)/invoices/import/*`, `schema.prisma` (`BankTransaction`)
- **Umgesetzt (PR #123):** gespeicherte Bewegungen mit Duplikatschutz und Saldoprüfung, tolerantere Nummernerkennung, Kundenname als Vorschlag, Ausgaben nur nach ausdrücklichem Ankreuzen als `Expense`, Importverlauf mit „Rückgängig“. camt.054 ist bewusst nicht umgesetzt (camt.053 deckt es ab). Spec: `docs/superpowers/specs/2026-09-30-f7-bankabgleich-design.md`.

### F8 · Mahnwesen nach Schweizer Praxis — **Sollte**
- **Beschreibung:** Eigener Mahnbeleg (PDF „1./2./3. Mahnung“ mit Bezug auf die Originalrechnung und aktualisiertem QR-Zahlteil über den offenen Betrag). Mahngebühr und Verzugszins sind konfigurierbar und standardmässig aus. Nach der letzten Stufe: Status „Betreibung/Inkasso“ und Export der Forderungsdaten für das Betreibungsbegehren.
- **Nutzen:** Eine Mahnung sieht heute aus wie eine erneute Rechnung (Z5). Mit dem Mahnbeleg ist für den Kunden klar, dass gemahnt wird.
- **Aufwand:** mittel
- **Code:** `app/(app)/invoices/reminders/*`, `lib/reminders.ts`, `lib/pdf/invoice-pdf.ts` (neuer `generateReminderPdf`), `schema.prisma` (`ReminderLog`, Gebühren in `ApplicationSettings`)
- **Umgesetzt (PR #126):** vier Stufen (1 Zahlungserinnerung, 2–4 = 1.–3. Mahnung, `MAX_REMINDER_LEVEL = 4`). `sendReminder` berechnet die Beträge serverseitig (`computeReminderCharges`): offener Rest aus den Zahlungen, Gebühr pro Stufe 2–4 (`reminderFeeLevel{2,3,4}Rappen`), Zins = offen × `reminderInterestPercent` × Verzugstage / 365, alles standardmässig 0. Eigener Mahnbeleg (`lib/pdf/reminder-pdf.ts`) mit QR-Zahlteil über offen + Gebühr + Zins (Stufe 1 ohne Gebühr und Zins), archiviert wie jede Rechnungsmail. Gebühr und Zins werden nicht gebucht, sondern nur auf der `SentDocument`-Zeile festgehalten. Nach Stufe 4 wird nichts mehr versendet. Der Bankimport akzeptiert auch den letzten Mahnbetrag als Treffer. **Bewusst nicht umgesetzt (Entscheid des Entwicklers):** Status „Betreibung/Inkasso“ und Export für das Betreibungsbegehren. Spec: `docs/superpowers/specs/2026-10-01-f8-mahnwesen-design.md`.
- **Rechtliches:** Ob Gebühren und Zinsen erlaubt sind und wie hoch, bitte mit Treuhänder bzw. Jurist klären. Die elektronische Übermittlung von Betreibungsbegehren (eSchKG) habe ich nicht geprüft.

### F9 · Ausgaben mit Belegen — **Sollte**
- **Beschreibung:** Beleg (PDF oder Foto) zu jeder Ausgabe, Lieferant, Status bezahlt/offen, Fälligkeit. Optional: Eingangs-QR-Rechnung einlesen (QR-Code aus PDF oder Bild auslesen) und daraus pain.001 für den Zahlungsauftrag erzeugen.
- **Nutzen:** Die Belegsammlung für den Treuhänder ist vollständig, und offene Lieferantenrechnungen sind sichtbar.
- **Aufwand:** mittel (Belege), hoch (pain.001)
- **Code:** `schema.prisma` `Expense`, `app/(app)/accounting/ExpenseForm.tsx`, `accounting/actions.ts`, `lib/file-validation.ts`, Dateiablage wie bei `customers/document-actions.ts`
- **Umgesetzt (#124):** `Expense` mit `supplier`, `dueDate` und `paidDate` (leer = offene Lieferantenrechnung) sowie `ExpenseReceipt` (PDF, JPG oder PNG, höchstens 5 MB, als BLOB; `lib/expense-receipts.ts`). **Bewusst nicht umgesetzt (Entscheid des Entwicklers):** Einlesen von Eingangs-QR-Rechnungen und pain.001.

### F10 · Erweitertes Kundenmodell — **Sollte**
- **Beschreibung:** UID, Kundennummer, abweichende Rechnungsadresse und -E-Mail, Zahlungsfrist pro Kunde, mehrere Kontakte.
- **Nutzen:** Firmenkunden mit Buchhaltungsabteilung (eigene Rechnungsadresse/-E-Mail) und individuelle Zahlungsfristen lassen sich ohne Umwege abbilden.
- **Aufwand:** mittel
- **Code:** `schema.prisma` `Customer`, `CustomerForm.tsx`, `customers/actions.ts`, `lib/pdf/invoice-pdf.ts`, `lib/document-actions.ts` (Empfänger), `app/api/export/customers/route.ts`
- **Umgesetzt (PR #129):** `customerNumber` (automatisch ab 1001, nach dem Anlegen fest, weil archivierte PDFs sie tragen), `uid` (normalisiert `CHE-123.456.789`, Prüfziffer Modulo 11), abweichende Rechnungsadresse (nur wenn Strasse, PLZ und Ort gesetzt sind; Name höchstens 70 Zeichen wegen QR-Zahlungspflichtigem), `billingEmail`, `paymentTermDays` (leer = globale Frist) und `CustomerContact` (nur informativ). Alle Rechnungs-, Mahnungs- und Abo-Wege laufen über `lib/customer-billing.ts`; Offerten gehen weiter an die Kundenadresse. Bereits archivierte PDFs bleiben unverändert. Spec: `docs/superpowers/specs/2026-10-01-f10-erweitertes-kundenmodell-design.md`.

### F11 · Flexible Abos statt leerer Jahresrechnung — **Sollte**
- **Beschreibung:** Intervall pro Kunde (monatlich, quartalsweise, jährlich) mit hinterlegter Vorlage (`InvoiceTemplate`). Die Rechnung wird dadurch **mit Positionen** erzeugt, nicht mit CHF 0. Optional mit automatischem Versand.
- **Nutzen:** Weniger manuelle Arbeit. Das 0-CHF-Risiko fällt weg (Z7). Für Vereine eignet sich das für Mitgliederbeiträge.
- **Aufwand:** gering–mittel
- **Code:** `lib/yearly-invoices.ts`, `schema.prisma` (`Customer.yearlyInvoice` wird zu `Subscription`), `invoices/templates/*`, `invoices/pending/*`.
- **Umsetzung (#122):** Erledigt. Mehrere Abos pro Kunde (`Subscription`: Intervall, Vorlage, nächstes Datum, `autoSend`, `active`). Der Job `checkSubscriptions` (`lib/subscriptions.ts`) ersetzt `lib/yearly-invoices.ts` und erzeugt den Entwurf mit den Positionen der Vorlage. Pro Lauf entsteht höchstens eine Rechnung pro Abo. Nach einem Ausfall wird das Datum nachgeführt (kein Rückstau). `autoSend` gibt es nur für Vorlagen mit mindestens einer Position und nutzt `lib/pending-email-send.ts`; bei einem Fehler bleiben Entwurf und Pending-E-Mail bestehen und die Admins werden benachrichtigt. Bestehende Jahreskunden wurden als `Yearly`-Abo ohne Vorlage übernommen. Verwaltung: Sektion «Abos» auf der Kundenseite (`customers/subscription-actions.ts`, `SubscriptionsSection.tsx`).

### F12 · Kundenverlauf, Aufgaben und Wiedervorlagen — **Kann**
- **Beschreibung:** Chronologischer Verlauf pro Kunde aus bestehenden Daten (Offerten, Rechnungen, `InvoiceSentLog`, Zahlungen, Notizen, Audit-Log). Dazu Aufgaben mit Fälligkeit und Zuständigem, z. B. automatisch „Offerte nachfassen“ 7 Tage nach dem Versand.
- **Nutzen:** Einfache CRM-Funktion ohne eigene Vertriebs-Pipeline.
- **Aufwand:** gering (Verlauf), mittel (Aufgaben)
- **Code:** `app/(app)/customers/[id]/page.tsx`, `schema.prisma` (`Task`), `lib/notifications.ts` (Erinnerungen an die bestehenden E-Mail/Telegram-Kanäle)
- **Umgesetzt (PR #128):** `Task` pro Kunde (Titel, Fälligkeit, Zuständiger, erledigt, benachrichtigt, optional Offerte). Beim Offertenversand entsteht automatisch „Offerte nachfassen“ in 7 Tagen (`createQuoteFollowUp`, höchstens eine offene Aufgabe pro Offerte). Der Tagesjob schliesst Nachfass-Aufgaben, deren Offerte nicht mehr „Versendet“ ist, und meldet fällige Aufgaben einmal an die Admins. Der Verlauf (`loadCustomerHistory`) entsteht aus bestehenden Daten; von Notizen erscheint nur der Titel, weil der Inhalt verschlüsselt ist. Offene Aufgaben stehen auch im Dashboard. Editoren verwalten Aufgaben, Viewer lesen sie.

### F13 · Online-Bezahlung (TWINT/Karte) per Link — **Kann**
- **Beschreibung:** Optionaler Zahlungslink auf Rechnung und E-Mail über einen Schweizer Payment-Service-Provider. Der Zahlungseingang kommt per Webhook als `Payment` (nach F5).
- **Nutzen:** Schnellere Zahlung bei Privatkunden.
- **Aufwand:** mittel
- **Differenzierung:** gering
- **Code:** neuer Webhook `app/api/external/…` (Muster: `payments/route.ts`), `lib/email.ts`, PDF
- **Hinweis:** Welcher Anbieter und zu welchen Gebühren: bitte selbst vergleichen, hier nicht geprüft. Eine öffentlich erreichbare Webhook-URL passt schlecht zum Raspberry Pi im Heimnetz.

### F14 · KI-Belegerfassung (lokal oder opt-in) — **Kann**
- **Beschreibung:** Ein hochgeladener Beleg (F9) wird ausgelesen und Datum, Betrag, Lieferant und Kategorie werden vorgeschlagen. Der Nutzer bestätigt.
- **Nutzen:** Spart Tipparbeit bei vielen Ausgaben.
- **Aufwand:** mittel
- **Differenzierung:** mittel
- **Code:** `accounting/actions.ts`, `ExpenseForm.tsx`
- **Risiko:** Belege gehen an einen Drittanbieter (revDSG, Auftragsbearbeitung). Deshalb opt-in, sichtbar gekennzeichnet und abschaltbar. Die Kategorie-Vorschläge lassen sich zuerst auch ohne KI umsetzen, z. B. aus der letzten Buchung beim gleichen Lieferanten.

---

## 4. Roadmap

**Phase 1: kurzfristig (0–3 Monate) – Korrektheit und Vertrauen**

- [x] 1. F2 Nummer erst beim Versand bzw. bei der PDF-Erzeugung
- [x] 2. F3 Festschreiben, Gutschrift, keine Cascade-Löschung von Rechnungen- [x] 3. F1 IBAN-Prüfung (#113, `lib/iban.ts`, genutzt in `settings/actions.ts`)
- [x] 4. F4 Belegarchiv und automatisches Backup (Teil A PDF-Archiv, Teil B Hash-Kette und Teil C Backup erledigt)
  - [x] C Automatisches nächtliches Backup (`lib/backup.ts`)
  - [x] A PDF-Archiv mit SHA-256-Hash (`lib/document-archive.ts`, `SentDocument`)
  - [x] B Hash-Kette im Audit-Log
- [x] 5. Kleine Fixes
  - [x] Import prüft Währung und IBAN (Z3)
  - [x] Audit-Log für Pending-E-Mails (U6)
  - [x] 5-Rappen-Rundung des Rechnungstotals als Einstellung (R2)

**Phase 2: mittelfristig (3–9 Monate) – Buchhaltungsfähigkeit**
- [x] 6. F5 Zahlungen und offene Posten
- [x] 7. F6 Jahresabschluss-Paket (ZIP mit Journal, GuV, Debitorenliste, PDFs)
- [x] 8. F7 Bankabgleich 2.0
- [x] 9. F11 flexible Abos

**Phase 3: langfristig (9–18 Monate) – Komfort und Reichweite**
- [x] 10. F8 Mahnwesen mit Mahnbelegen (#126; Betreibung/Inkasso bewusst verworfen)
- [x] 11. F9 Belege zu Ausgaben
- [x] 12. F10 erweitertes Kundenmodell (#129)
- [x] 13. F12 Verlauf und Aufgaben (#128)
- [x] Zusatz: Optionale Module abschaltbar (#131, Einstellungen → Module: Aufgaben, Abos, Offerten, Mahnwesen, Bankimport, Buchhaltung, Auswertungen). Abschalten blendet nur aus, die Daten bleiben. Abos lassen sich nicht abschalten, solange aktive Abos oder wartende Entwürfe bestehen.
- [ ] 14. Optional: F13 Online-Bezahlung, F14 KI-Belegerfassung, eBill (erst nach Abklärung der Teilnahmebedingungen)

---

## 5. Drei Features, die du bewusst **nicht** bauen solltest

1. **Eigenes Hauptbuch mit Bilanz und Jahresabschluss.** Das bedeutet hohe fachliche Verantwortung und dauernden Aufwand bei Gesetzesänderungen. Es konkurriert mit etablierten Produkten, die der Treuhänder ohnehin nutzt. Die App gewinnt mehr, wenn sie saubere Daten *liefert* (siehe Abschnitt 7).
2. **Steuererklärung oder andere Behörden-Einreichungen.** Dafür braucht es Anbindungen an die Behörden, und bei falschen Zahlen trägt der Nutzer das Haftungsrisiko. Die App liefert die Zahlen (Export), eingereicht wird durch Nutzer oder Treuhänder.
3. **Mandantenfähigkeit bzw. Betrieb als SaaS-Plattform.** Die Architektur ist auf *eine* Firma pro Instanz ausgelegt (SQLite, `findFirst()` überall, Hosting auf dem Raspberry Pi, AGPL). Ein Umbau auf Mandantentrennung betrifft praktisch jede Abfrage und bringt Betriebs-, Datenschutz- und Supportpflichten mit sich. Für mehrere Firmen oder Vereine sind mehrere Container die einfachere Lösung.

*(Knapp dahinter: Lohnbuchhaltung. Sie ist fachlich weit weg vom Kern und hat viele Sozialversicherungsregeln. MWST ist bereits bewusst ausgeklammert.)*

---

## 6. Offene Fragen an dich

1. **Zielgruppe:** Nur du bzw. dein Betrieb, oder sollen auch andere die App einsetzen? Einzelfirmen, GmbH/AG, Vereine?
2. **Treuhänder:** Mit welcher Software arbeitet dein Treuhänder bzw. arbeiten die Treuhänder deiner Nutzer (Banana, bexio, Abacus, Run my Accounts, andere)?
3. **Bank:** Welche Bank nutzt du? Gibt sie die Mitteilung aus dem QR-Code im CAMT.053 zuverlässig und unverändert zurück? (Bestimmt, wie der Abgleich in F7 gebaut wird.)
4. **Kunden:** Brauchst du Rechnungen in EUR (Auslandsadressen gehen seit #111)? *Beantwortet: nein, EUR ist bewusst verworfen.*
5. **„Budget-App“:** Was ist das genau (`app/api/external/payments/route.ts`)? Soll sie bleiben oder durch F7 ersetzt werden? *Beantwortet: Haushaltsbudget-App des Nutzers, die nach ihrem Import Zahlungseingänge an diese Schnittstelle schickt. Das CRM muss auch ohne sie funktionieren. Seit F7 hat es einen eigenen Bankimport, die Schnittstelle bleibt optional (neu: optionales `bankReference`).*
6. **Volumen:** Wie viele Rechnungen, Ausgaben und Belege pro Jahr? (Relevant für BLOB-Speicherung in SQLite und Backups.)
7. **Betrieb:** Läuft die Instanz aus dem Internet erreichbar oder nur im LAN? (Relevant für Online-Zahlungs-Webhooks und die Backup-Strategie.) Welche Zeitzone hat der Container?

---

## 7. Buchhaltung

### 7.1 Ist-Zustand (im Code belegt)

| Bereich | Stand | Beleg |
|---|---|---|
| Konten/Kontenplan | **Nicht vorhanden** | Suche `account\|konto\|soll\|haben\|ledger\|journal` in `schema.prisma`: keine Modelle |
| Buchungssätze | **Nicht vorhanden** | wie oben. Kommentar in `lib/import/matching.ts`: „without a bookkeeping ledger“, „the CRM has no accounts“ |
| Einnahmen | = erfasste Zahlungen, gezählt nach `Payment.date` (Geldfluss-Prinzip) | `app/(app)/accounting/lib/income-statement-queries.ts`, `lib/payments.ts` |
| Ausgaben | `Expense`: Datum, Text, Betrag, Kategorie, Notiz, Lieferant, Fälligkeit, Zahlstatus (`paidDate`) und Belege (`ExpenseReceipt`) | `schema.prisma`, `accounting/actions.ts` |
| „GuV“ | Einnahmen − Ausgaben pro Monat/Jahr (keine Abgrenzungen, keine Bestände) | `accounting/page.tsx`, `profit-loss-chart.tsx` |
| Kontierung | Kategorien (`Category`) gemeinsam für Positionen, Leistungen und Ausgaben. Keine Kontonummern | `schema.prisma` |
| Debitoren/OP | `Payment`-Modell mit Teilzahlungen, Offene-Posten-Liste per Stichtag mit Altersstruktur und CSV. Kein Skonto, keine Ausbuchung (bewusst) | `lib/receivables.ts`, `accounting/receivables/` |
| Zahlungseingang | Manuell, über den CAMT.053-Import (gespeicherte Bewegungen) oder über die Budget-API, alles über `recordPayment` | `lib/payments.ts`, `lib/import/` |
| Gutschrift/Storno/Debitorenverlust | Gutschrift als `Invoice` mit negativen Beträgen. Debitorenverlust nicht abgebildet | `lib/credit-notes.ts` |
| Periodenabschluss | **Nicht vorhanden**, aber versendete Rechnungen sind festgeschrieben (U1–U4) und das gesendete PDF ist mit Hash archiviert | `lib/document-archive.ts` |
| Export | Journal-/GuV-CSV, Rechnungs-, Offerten-, Kunden- und Offene-Posten-CSV, **Jahresabschluss-Paket (ZIP)** und die SQLite-Datei | `app/api/export/*` |
| MWST | **Bewusst nicht vorgesehen** | R1 |

**Einordnung [bitte mit Treuhänder klären]:** Einzelunternehmen und Personengesellschaften mit weniger als CHF 500'000 Umsatz dürfen gemäss Art. 957 Abs. 2 OR nur über Einnahmen, Ausgaben und Vermögenslage Buch führen. Der heutige Stand kommt dem *teilweise* nahe. Debitoren (OP-Liste) und archivierte, mit Hash gesicherte Rechnungs-PDFs sind vorhanden. Es fehlen aber mindestens die Vermögenslage (Bank, Kreditoren) und ein Nachweis für die 10-jährige Aufbewahrung (Art. 958f OR). Für eine GmbH/AG reicht der Stand nicht.

### 7.2 Lücken (Zusammenfassung)
- ~~Keine Debitorenbuchhaltung~~ Zahlungen, Teilzahlungen, Gutschriften und OP-Liste sind vorhanden (F3, F5). Skonto und Debitorenverluste sind bewusst verworfen
- Kreditorenseite nur teilweise: offene Lieferantenrechnungen sind erfassbar (F9), pain.001 ist bewusst verworfen (Z6)
- ~~Kein unveränderbarer Beleg- und Periodenstand~~ Festschreiben, PDF-Archiv und Hash-Kette sind vorhanden (U1–U6). Einen formalen Periodenabschluss gibt es nicht
- Keine Kontierung und kein Export in einem Format, das eine Buchhaltungssoftware direkt übernimmt (7.1)
- ~~Bankbewegungen werden nicht gespeichert~~ Seit F7 gespeichert, mit Saldoprüfung (Z4)

### 7.3 Strategie: A (eigene Buchhaltung) vs. B (Anbindung)

| Kriterium | A – selbst bauen | B – sauber anbinden |
|---|---|---|
| Aufwand | Hoch: Hauptbuch, Kontenplan, Abschluss, Bilanz, Abgrenzungen, Mehrjahresbetrieb | Mittel: Kontierung, Journal-Export, 1–2 Zielformate, Datenqualität (F3, F5) |
| Fach- und Haftungsrisiko | Hoch: Fehler landen direkt im Abschluss und in der Steuererklärung | Tief: Verbucht und abgeschlossen wird im Fachprogramm unter Kontrolle des Treuhänders |
| Wartung bei Gesetzesänderungen | Dauernd (Rechnungslegung, Kontenrahmen) | Gering: nur Exportformate |
| Abhängigkeit von Dritten | Keine | Von Import-Schnittstellen und -Formaten (können sich ändern) |
| Akzeptanz beim Treuhänder | Tief: der Treuhänder muss sich in eine unbekannte Software einarbeiten | Hoch: der Treuhänder arbeitet in seiner gewohnten Software |
| Differenzierung | Keine gegenüber bexio, Banana, Abacus usw. | Mittel: „Rechnungswesen mit sauberem Treuhänder-Export, selbst gehostet“ |

**Empfehlung: B**, mit einer bewusst gebauten **Debitoren-Nebenbuchhaltung** in der App.

Begründung:
1. Die Architektur (eine Firma, SQLite, self-hosted, Einzelentwickler) und die angenommene Zielgruppe passen zu einer schlanken Fakturierung, nicht zu einer vollen Finanzbuchhaltung.
2. Treuhänder geben in der Praxis oft die Software vor. Eine eigene Buchhaltung würde dann doppelt geführt.
3. Die Teile, die *nur* die App gut kann, bleiben in der App: Rechnungen, QR-Zahlteil, Zahlungsabgleich, offene Posten, Mahnwesen, Belegarchiv. Genau diese Daten braucht der Treuhänder sauber.
4. Die Grenze liegt beim **Journal-Export**. Alles, was Konten, Abschluss und Bilanz betrifft, bleibt im Fachprogramm.

Umsetzung in dieser Reihenfolge: F3 → F5 → F6, danach F7/F9. **Aktueller Stand:** Es gibt keinen Treuhänder und keinen vorgesehenen. F6 ist deshalb ein Jahresabschluss-Paket für die Selbstveranlagung (ZIP mit Journal-CSV, GuV, Debitorenliste, PDFs) ohne Kontenplan und ohne Zielsoftware. Kontierung und ein Importformat (Banana, bexio, Abacus) werden erst gebaut, wenn ein Treuhänder dazukommt. Dann **legt er Kontonummern und Buchungslogik fest** (z. B. ob pro Rechnung oder pro Zahlung gebucht wird), und die App bietet dafür eine Konfiguration an, ohne eingebaute Konten.

**Offener Punkt (nur relevant bei späterem Treuhänder):** Direkte API-Anbindungen (z. B. bexio) und genaue Importformate (Banana, Abacus) habe ich **nicht geprüft**. Vor einer solchen Erweiterung bitte die Hersteller-Dokumentation lesen und die Machbarkeit bestätigen.

### 7.4 Fragen an einen Treuhänder (nur falls einer dazukommt)

1. Welche Software verwendest du, und welches Importformat (Datei oder API) akzeptierst du am liebsten?
2. Wie willst du die Rechnungen verbucht haben: bei Rechnungsstellung (Debitoren) oder erst bei Zahlungseingang? Einzeln oder als Sammelbuchung?
3. Welcher Kontenplan (z. B. Kontenrahmen KMU) und welche Konten für Ertrag, Debitoren, Bank und Aufwand pro Kategorie?
4. Wie runde ich das Rechnungstotal korrekt (5-Rappen-Rundung ja/nein)?
5. Wie sollen Gutschriften, Stornos, Skonti und Debitorenverluste im Export aussehen?
6. Reicht es, wenn Rechnungsnummern erst beim Versand vergeben werden und dadurch lückenlos sind, oder gibt es weitere Anforderungen an die Nummerierung?
7. Was brauchst du zum Jahresende: OP-Liste per 31.12., Belege als PDF, Kontoauszüge? In welcher Struktur?
8. Erfüllt ein PDF-Archiv mit Hash-Werten und Audit-Log die Anforderungen der GeBüV an Integrität und Aufbewahrung, oder braucht es mehr (z. B. externe Zeitstempel, WORM-Speicher)?
9. Für Vereine: Welche Besonderheiten (Mitgliederbeiträge, Spenden) müsste die App abbilden?

---

### Verwendete externe Quellen
- Strukturierte Adressen QR-Rechnung ab 21.11.2025: https://timesafe.ch/neue-vorgaben-fuer-qr-rechnungen-ab-november-2025-alles-was-du-wissen-musst/ · https://www.kmupartnergroup.ch/newsroom/aenderungen-bei-qr-rechnungen-in-der-schweiz-ab-21-november-2025 · Primärquelle: SIX Implementation Guidelines QR-Rechnung v2.3 (https://www.six-group.com/dam/download/banking-services/standardization/qr-bill/ig-qr-bill-v2.3-en.pdf)
- swissqrbill (Adresstyp „S“): https://github.com/schoero/swissqrbill
- E-Rechnung Bund (ab CHF 5'000): https://www.bk.admin.ch/bk/de/home/digitale-transformation-ikt-lenkung/e-services-bund/services/e-rechnung.html · https://www.verband-e-rechnung.org/schweiz-macht-e-invoicing-fuer-bundeslieferanten-zur-pflicht/
- Gesetzesartikel (MWSTG Art. 10; OR Art. 102, 104, 957, 958f; GeBüV SR 221.431) nenne ich aus Fachwissen. **Den genauen Wortlaut bitte auf fedlex.admin.ch prüfen.**
