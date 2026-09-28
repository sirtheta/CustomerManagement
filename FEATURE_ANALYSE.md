# Feature-Analyse CustomerManagement

Stand: 28.09.2026 · Basis: Branch `ccr-742559e2-jlc1nl` (= Release 1.5.0, Commit `661bb5e`)
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
5. **Heute vorhanden:** Kunden (mit Notizen und Dateien), Offerten, Umwandlung Offerte → Rechnung, Rechnungen mit Positions- und Gesamtrabatt, PDF mit QR-Zahlteil, E-Mail-Versand, jährlich wiederkehrende Rechnungen (als leerer Entwurf), Mahnliste mit Stufen, CAMT.053-Import mit Zuordnung zu Rechnungen, externe Zahlungs-API für eine „Budget-App“, Ausgaben, Einnahmen/Ausgaben-Übersicht mit CSV, Auswertungen, Audit-Log, Rollen Admin/Editor/Viewer, Logs, DB-Export.
6. **Zielgruppe:** [Annahme] Einzelunternehmer oder sehr kleine Firmen (1–3 Nutzer) in der Deutschschweiz, nur Inlandskunden in CHF, die selbst hosten. Dafür spricht: nur CHF, Schuldnerland fest auf „CH“, nur deutsche Oberfläche, Rechnungsversand erst nach Prüfung, Hosting auf dem Raspberry Pi. Für **Vereine** gibt es keine besonderen Funktionen (z. B. Mitglieder, Beiträge).
9. **MWST:** Die App enthält **bewusst keine MWST**, da sie höchstens für kleine Geschäfte gedacht ist (Entscheid des Entwicklers). Dieses Dokument schlägt deshalb keine MWST-Funktionen vor.
7. **Qualität:** 67 Unit-/Integrationstest-Dateien, E2E nur für den Login (`tests/e2e/login.spec.ts`). CI mit Lint, Tests, Build und E2E (`.github/workflows/`). Keine TODO/FIXME-Kommentare (Suche nach `TODO|FIXME|HACK|XXX`).
8. **Zuletzt bearbeitet:** laut Git-Historie CAMT.053-Import (#96), DB-Export (#94), Fixes aus Code-Reviews (#98, #100) und das eingebaute Benutzerhandbuch (`public/benutzerhandbuch.html`).

---

## 2. Lücken und Risiken

### 2.1 Rechnung und Beträge

| # | Befund | Beleg / Suche | Einstufung |
|---|---|---|---|
| R1 | **Keine MWST – bewusster Entscheid.** Kein Steuersatz, kein MWST-Ausweis. | [Code] Suche `mwst\|vat\|mehrwert\|steuer\|tax` in `app lib components prisma scripts`: nur Treffer in `Cache-Control` und einem Marketingtext. | Kein Handlungsbedarf, sondern eine Abgrenzung des Einsatzbereichs: Die App eignet sich damit nur für nicht MWST-pflichtige Betriebe. Ab welcher Umsatzgrenze die Pflicht beginnt, regelt Art. 10 MWSTG [bitte prüfen]. |
| R2 | **Keine 5-Rappen-Rundung.** Gerundet wird nur auf 0.01. | [Code] `lib/calculations.ts` (`roundCents`). Suche `rappen\|0\.05\|round`: keine Rundung auf 5 Rappen. | Ob man auf 5 Rappen runden muss, hängt von der Praxis ab (beim QR-Zahlteil ist sie nicht zwingend) [bitte prüfen]. Als Einstellung wäre sie nützlich. |
| R3 | **Nur CHF.** Die Währung ist im QR-Code und im PDF fest „CHF“. | [Code] `lib/pdf/qrbill-helpers.ts` (`currency: "CHF"`), `lib/pdf/document-pdf.ts` (`CHF ${fmt…}`) | Rechnungen in EUR sind nicht möglich. Die QR-Rechnung erlaubt CHF und EUR [Quelle: SIX IG QR-Rechnung, bitte prüfen]. |
| R4 | **Keine Auslandskunden.** Das Schuldnerland ist fest „CH“, das Kundenmodell hat kein Feld für das Land. | [Code] `qrbill-helpers.ts` Z. 84 (`country: "CH"`), `Customer` in `schema.prisma` | Ein Kunde in DE/AT/FL erhält einen falschen QR-Zahlteil. |
| R5 | **Rechnungsnummer ist hart formatiert.** Aufbau: Präfix + JJMM (Erstelldatum, nicht Rechnungsdatum) + 4 Ziffern. Die Nummer wird schon beim **Entwurf** vergeben. | [Code] `lib/document-number.ts` (`generateNumber` nutzt `new Date()`), `lib/document-actions.ts` | Gelöschte Entwürfe hinterlassen Lücken. Ob lückenlose Nummern verlangt sind: bitte mit Treuhänder klären. |
| R6 | **Die Logik für Nummern ist doppelt vorhanden.** Die Jahresrechnung hat eine eigene Kopie. | [Code] `lib/yearly-invoices.ts` Z. 4–21 vs. `lib/document-number.ts` | Wartungsrisiko: eine Änderung muss an zwei Stellen gemacht werden. |

### 2.2 QR-Rechnung

| # | Befund | Beleg | Einstufung |
|---|---|---|---|
| Q1 | **Nur Referenztyp „ohne Referenz“ (NON).** Die Rechnungsnummer steht als unstrukturierte Mitteilung im QR-Code. Es gibt keine QR-Referenz (QRR) und keine Creditor Reference (SCOR, ISO 11649). | [Code] `qrbill-helpers.ts` (`message: invoice.documentNumber`, kein `reference`). Suche `QRR\|SCOR\|reference\|qr-?iban`: keine Treffer in der QR-Erzeugung. | Der Zahlungsabgleich hängt davon ab, dass die Bank die Mitteilung unverändert weitergibt. Mit einer QR-IBAN ist zwingend eine QR-Referenz nötig [Quelle: SIX Implementation Guidelines QR-Rechnung v2.3, bitte prüfen]. Die App unterstützt heute also **keine QR-IBAN**. |
| Q2 | **Die Adresse ist ein einziges Feld.** Strasse und Hausnummer stehen zusammen in `address`, `buildingNumber` wird nicht übergeben. | [Code] `Customer.address`, `CompanyInformation.companyAddress`, `qrbill-helpers.ts` | Seit dem **21.11.2025** sind im QR-Code nur noch strukturierte Adressen zulässig [Quelle: [timesafe.ch](https://timesafe.ch/neue-vorgaben-fuer-qr-rechnungen-ab-november-2025-alles-was-du-wissen-musst/), [KMU Partner Group](https://www.kmupartnergroup.ch/newsroom/aenderungen-bei-qr-rechnungen-in-der-schweiz-ab-21-november-2025)]. swissqrbill schreibt Adresstyp „S“ [Quelle: [swissqrbill `src/shared/qr-code.ts`](https://github.com/schoero/swissqrbill)]. **Ob „Strasse + Nr.“ im Strassenfeld ohne eigenes Feld für die Hausnummer die Vorgaben erfüllt, ist unklar.** Bitte mit dem Validator der Bank bzw. von SIX prüfen. Getrennte Felder wären die sichere Lösung. |
| Q3 | **Die IBAN wird serverseitig nicht geprüft.** | [Code] `app/(app)/settings/actions.ts` Z. 47 speichert den Rohwert. Der Test `tests/unit/iban-validation.test.ts` prüft ein Schema, das **im Test selbst** definiert ist, nicht App-Code. | Eine falsche IBAN fällt erst auf, wenn das PDF erzeugt wird oder der Kunde zahlt. |
| Q4 | **Die Sprache des QR-Zahlteils ist nicht gesetzt.** | [Code] `document-pdf.ts`: `new SwissQRBill(doc.qr)` ohne `language` | swissqrbill unterstützt DE/FR/IT/EN [Quelle: swissqrbill README]. Welche Sprache ohne Angabe verwendet wird, habe ich nicht geprüft. |
| Q5 | Die alten Einzahlungsscheine werden nirgends verwendet. | [Code] Es gibt nur swissqrbill. | In Ordnung. |

### 2.3 Unveränderbarkeit und Nachvollziehbarkeit

| # | Befund | Beleg |
|---|---|---|
| U1 | **Versendete und bezahlte Rechnungen lassen sich frei bearbeiten.** Die Positionen werden gelöscht und neu angelegt, `version` wird hochgezählt. Die alte Fassung wird aber nicht gespeichert. | [Code] `lib/document-actions.ts` `updateDocumentWithItems`. `app/(app)/invoices/[id]/page.tsx` zeigt „Bearbeiten“ in jedem Status. `app/(app)/invoices/[id]/edit/page.tsx` prüft keinen Status. |
| U2 | **Admins können Rechnungen in jedem Status löschen.** | [Code] `app/(app)/invoices/actions.ts` `deleteInvoice` (nur `requireAdmin`) |
| U3 | **Wird ein Kunde gelöscht, werden alle seine Rechnungen per Cascade mitgelöscht.** | [Code] `schema.prisma` `Invoice.customer … onDelete: Cascade`, `app/(app)/customers/actions.ts` Z. 132–136 |
| U4 | **Storno ist nur ein Statuswert.** Es gibt keine Gutschrift und keinen Stornobeleg. Der Status lässt sich beliebig zurücksetzen, auch von „Bezahlt“ auf „Entwurf“. | [Code] `updateInvoiceStatus` in `invoices/actions.ts`, `InvoiceStatusSelect.tsx` |
| U5 | **Das versendete PDF wird nicht archiviert.** Es wird bei jedem Abruf neu aus den aktuellen Daten erzeugt. | [Code] `lib/pdf/invoice-pdf.ts`, `app/api/invoices/[id]/pdf/route.ts`. `InvoiceSentLog` speichert nur Empfänger und Betreff. |
| U6 | **Das Audit-Log ist eine normale, veränderbare Tabelle.** Fehler beim Schreiben werden abgefangen (dann fehlt der Eintrag). Einige Aktionen werden gar nicht protokolliert: `approvePendingEmail`, `discardPendingEmail`. | [Code] `lib/audit.ts` (try/catch), Suche `logAudit` in `app/(app)/invoices/pending/`: keine Treffer |

**Einordnung:** Geschäftsbücher und Buchungsbelege sind 10 Jahre aufzubewahren (Art. 958f OR). Die Geschäftsbücherverordnung (GeBüV, SR 221.431) verlangt Integrität und Nachvollziehbarkeit [bitte prüfen, ob die App im konkreten Fall als „Geschäftsbuch“ gilt]. Mit U1–U5 lässt sich kaum belegen, *welche* Rechnung dem Kunden tatsächlich zugestellt wurde.

### 2.4 Zahlungen, Bank und Mahnwesen

| # | Befund | Beleg |
|---|---|---|
| Z1 | **Es gibt kein Modell für Zahlungen.** „Bezahlt“ ist nur ein Status mit `paidDate`. Teilzahlungen, Überzahlungen, Skonto und Debitorenverluste lassen sich nicht abbilden. | [Code] `schema.prisma` (kein `Payment`), `lib/payment-matching.ts` `markInvoicePaid` |
| Z2 | **Im CAMT-Import gilt nur ein Treffer auf den Rappen genau.** Die Rechnungsnummer wird per Regex (`<Präfix>\d{8}`) im Text gesucht. Ein Teilbetrag erscheint als Kandidat, markiert die Rechnung aber als vollständig „Bezahlt“. | [Code] `lib/import/matching.ts`, `lib/import/document-reference.ts` |
| Z3 | **Beim Import werden Währung und IBAN des Auszugs nicht geprüft.** `parseCamt053` liefert zwar `currency` und `iban`, `parseStatement` verwendet sie aber nicht. | [Code] `app/(app)/invoices/import/actions.ts` |
| Z4 | **camt.054 wird nicht unterstützt.** Das ist bewusst so entschieden (siehe Kommentar). Bankbewegungen werden nicht gespeichert: Es gibt keine Historie und keinen Kontoabgleich. | [Code] `lib/import/camt.ts` Kopfkommentar, `lib/import/matching.ts` Kopfkommentar |
| Z5 | **Die Mahnung ist das normale Rechnungs-PDF mit Titel „Rechnung“.** Es gibt keine Mahngebühren, keinen Verzugszins, keinen eigenen Mahnbeleg und keinen Übergang zu Betreibung oder Inkasso. | [Code] `app/(app)/invoices/reminders/actions.ts` (`generateInvoicePdf`). Suche `mahngeb\|verzugszins\|zins\|betreibung\|inkasso`: keine Treffer |
| Z6 | **Kein pain.001, kein eBill, keine E-Rechnung, keine Online-Zahlung.** | [Code] Suche `pain\|ebill\|twint\|stripe\|payrexx\|postfinance\|peppol\|zugferd`: keine Treffer |
| Z7 | **Die Jahresrechnung wird als leerer Entwurf (CHF 0.00) angelegt.** Wird die E-Mail verworfen, bleibt eine nummerierte Rechnung über 0 CHF bestehen. | [Code] `lib/yearly-invoices.ts` (`totalAmount: 0`, keine Positionen), `invoices/pending/actions.ts` `discardPendingEmail` löscht nur die E-Mail |

Zur Einordnung: Verzug durch Mahnung (Art. 102 OR), Verzugszins 5 % (Art. 104 OR), Mahngebühren nur bei Vereinbarung [alles bitte prüfen]. Die Bundesverwaltung verlangt E-Rechnungen ab CHF 5'000 Vertragswert (seit 2016) [Quelle: [Bundeskanzlei E-Rechnung](https://www.bk.admin.ch/bk/de/home/digitale-transformation-ikt-lenkung/e-services-bund/services/e-rechnung.html), [verband-e-rechnung.org](https://www.verband-e-rechnung.org/schweiz-macht-e-invoicing-fuer-bundeslieferanten-zur-pflicht/)].

### 2.5 Kundenmodell, Sprachen, CRM

- **Das Kundenmodell ist minimal:** eine Kontaktperson, eine Adresszeile, PLZ, Ort, eine E-Mail, Telefon. Es fehlen: Land, Kanton, UID, Korrespondenzsprache, abweichende Rechnungsadresse, mehrere Ansprechpartner, Zahlungsfrist pro Kunde, Kundennummer. [Code] `schema.prisma` `Customer`, `CustomerForm.tsx`
- **Nur Deutsch.** Die Texte sind fest im Code, es gibt kein i18n-Framework. Datumsformate sind fest `de-CH`. [Code] Suche `i18n\|locale\|language`. Nur `numberFormat` ist einstellbar (`ApplicationSettings.numberFormat`).
- **Keine Aufgaben, Wiedervorlagen, Pipeline oder Aktivitätsverlauf.** [Code] Suche `task\|aufgabe` in `schema.prisma`: keine Treffer. Vorhanden sind nur Notizen (`CustomerNote`) und Dateien (`Document`).

### 2.6 Buchhaltung

Siehe **Abschnitt 7**.

### 2.7 Technik, die neue Features bremsen könnte

- **Ein Mandant.** `findFirst()` wird für Einstellungen und Firmendaten verwendet. Mehrere Firmen oder Vereine in einer Instanz gehen nicht. Für self-hosted ist das kein Problem, für ein Hosting-Angebot schon. [Code]
- **Beträge sind teils Decimal, teils number.** Gespeichert wird als Prisma `Decimal`, gerechnet aber mit JS-`number` (`toNumber()`, `lib/calculations.ts`). Mit Teilzahlungen, Rabatten und Rundungen steigt das Risiko für Rappendifferenzen. [Code]
- **Dateien als BLOB in SQLite** (`Document.content`). Mit Belegen und archivierten PDFs wächst die DB schnell. Backups und der Export (`app/api/export/database/route.ts`) werden entsprechend grösser. [Code]
- **Jahresgrenzen folgen der Server-Zeitzone** (`new Date(year, 0, 1)`), siehe `income-statement-queries.ts`. In `Dockerfile`, `docker-compose.yml` und `.env.example` wird kein `TZ` gesetzt (Suche `TZ`). [Annahme] Der Container läuft daher in UTC. Buchungen um Mitternacht können so ins falsche Jahr oder in den falschen Monat fallen.
- **Keine allgemeine API.** Es gibt nur `/api/external/payments` mit einem statischen API-Key. [Code] `app/api/external/payments/route.ts`
- **Backups sind manuell.** `cp` gemäss Anleitung (`DEPLOYMENT.md`) oder DB-Export. Es gibt keine automatische, verschlüsselte Sicherung ausser Haus. [Code/Doku]
- **Das Audit-Log** ist vorhanden, siehe U6.

### 2.8 Datenschutz (revDSG)

- **Belegt:** Hosting im eigenen Betrieb. Secrets werden verschlüsselt gespeichert (`lib/crypto.ts`, `migrateSecretsAtRest`). 2FA, Rollen, Rate-Limit beim Login, CSP-Header (`proxy.ts`), Audit-Log.
- **Nicht gefunden** (Suche `anonym\|retention\|dsg\|datenschutz` in `app lib`; einziger fachlicher Treffer ist die Log-Aufbewahrung in `lib/logs.ts`): kein Löschkonzept und keine Aufbewahrungsfristen pro Datentyp, kein Auskunfts-Export pro Person. Das Löschen von Kunden löscht Buchungsbelege mit (siehe U3). Das widerspricht der Aufbewahrungspflicht. Das revDSG ist seit 1.9.2023 in Kraft. Ob ein Bearbeitungsverzeichnis Pflicht ist, hängt u. a. von der Unternehmensgrösse ab [bitte prüfen, Quelle: EDÖB].

---

## 3. Priorisierte Feature-Ideen

Aufwand ist gemessen an der bestehenden Architektur: **gering** = wenige Tage, **mittel** = 1–3 Wochen, **hoch** = mehr als 3 Wochen (für eine Person). Das ist eine grobe Schätzung.

### F1 · QR-Rechnung nach aktuellem Standard — **Muss**
- **Beschreibung:** Strasse und Hausnummer getrennt, Land für Kunde und Firma. Referenzart wählbar: QRR (mit QR-IBAN) oder SCOR (mit normaler IBAN), die Rechnungsnummer bleibt als Mitteilung. Serverseitige Prüfung der IBAN/QR-IBAN (Prüfsumme). Sprache des Zahlteils pro Kunde.
- **Nutzen:** Zahlungen lassen sich zuverlässig zuordnen (die Referenz ist maschinenlesbar und hat eine Prüfziffer), und das Risiko fällt weg, nach 21.11.2025 nicht konforme Rechnungen zu verschicken (siehe Q2).
- **Aufwand:** mittel
- **Code:** `lib/pdf/qrbill-helpers.ts`, `lib/pdf/document-pdf.ts`, `schema.prisma` (`Customer`, `CompanyInformation`, `Invoice.paymentReference`), `app/(app)/settings/actions.ts`, `CustomerForm.tsx`, `lib/import/matching.ts`
- **Ansatz:** Die Referenz beim Versand erzeugen und in `Invoice` speichern, damit sie unveränderlich ist. Die bestehende Adresse per Migration aufteilen (Heuristik: letzte Zahl = Hausnummer) und dem Nutzer zur Kontrolle anzeigen. Mit dem Validator von SIX bzw. der Bank testen.

### F2 · Rechnungen festschreiben, Gutschrift und Storno — **Muss**
- **Beschreibung:** Ab Status „Versendet“ ist eine Rechnung nicht mehr änderbar. Korrekturen laufen über eine **Gutschrift** (eigener Belegtyp mit Bezug zur Originalrechnung) oder einen Storno mit neuer Rechnung. Nicht-Entwürfe können nicht gelöscht werden. Kunden mit Rechnungen können nur archiviert, nicht gelöscht werden. Statuswechsel nur entlang erlaubter Übergänge.
- **Nutzen:** Nachvollziehbarkeit gegenüber Kunden, Treuhänder und Behörden. Das ist die Voraussetzung für jeden Buchhaltungsexport.
- **Aufwand:** mittel
- **Code:** `lib/document-actions.ts`, `app/(app)/invoices/actions.ts`, `invoices/[id]/page.tsx`, `invoices/[id]/edit/page.tsx`, `InvoiceStatusSelect.tsx`, `customers/actions.ts`, `schema.prisma` (`onDelete: Restrict`, `Invoice.kind` bzw. `creditNoteForId`), `lib/state-manager.ts`
- **Ansatz:** Eine Zustandsmaschine in `lib/state-manager.ts` mit einer Tabelle erlaubter Übergänge. Serverseitig prüfen in `updateDocumentWithItems`. Die Gutschrift als `Invoice` mit negativem Betrag oder als eigenes Modell: **bitte mit Treuhänder klären**, wie sie im Export erscheinen soll.

### F3 · Revisionssicheres Belegarchiv und automatisches Backup — **Muss**
- **Beschreibung:** Beim Versand wird das exakte PDF gespeichert, mit SHA-256-Hash. Das Audit-Log bekommt eine Hash-Kette (jeder Eintrag enthält den Hash des vorherigen). Dazu ein automatisches nächtliches Backup (SQLite-Backup-API) mit Aufbewahrungsregel und optional verschlüsseltem Ziel ausser Haus.
- **Nutzen:** Man kann belegen, was verschickt wurde, und hat Schutz vor Datenverlust auf dem Raspberry Pi (SD-Karte!).
- **Aufwand:** mittel
- **Code:** `lib/document-actions.ts` `sendDocument`, `invoices/reminders/actions.ts`, `invoices/pending/actions.ts`, `lib/audit.ts`, `schema.prisma` (`SentDocument`), `lib/notifications.ts` (Cron), `app/api/export/database/route.ts`
- **Ansatz:** PDFs besser im Dateisystem unter `data/archive/JJJJ/` ablegen als als BLOB, den Hash in der DB speichern. Den Backup-Job an den bestehenden node-cron-Scheduler anhängen (Muster wie `startLogRotationScheduler`). Ob das GeBüV-konform ist: **bitte prüfen lassen**.

### F4 · Zahlungen und offene Posten (Debitoren) — **Muss**
- **Beschreibung:** Neues Modell `Payment` (Rechnung, Datum, Betrag, Quelle, Bankreferenz). Rechnungsstatus „Teilbezahlt“, Restbetrag, Überzahlung als Guthaben, Skonto und Debitorenverlust (Ausbuchung) als eigene Zahlungsart. Offene-Posten-Liste per Stichtag (z. B. 31.12.) mit Altersstruktur (0–30/31–60/61–90/>90 Tage).
- **Nutzen:** Die Debitorenliste zum Jahresende ist genau das, was der Treuhänder braucht. Teilzahlungen sind im Alltag häufig.
- **Aufwand:** mittel
- **Code:** `schema.prisma`, `lib/payment-matching.ts`, `lib/import/matching.ts`, `app/(app)/invoices/actions.ts`, `accounting/lib/income-statement-queries.ts`, `analytics-queries.ts`, neue Seite `app/(app)/accounting/receivables/`
- **Ansatz:** `markInvoicePaid` wird zu `recordPayment`. Der Status ergibt sich aus der Summe der Zahlungen. Bestehende `Paid`-Rechnungen per Migration in je eine Zahlung über den Gesamtbetrag umwandeln.

### F5 · Buchhaltungsexport für den Treuhänder — **Muss**
- **Beschreibung:** Kontierung einrichten: Ertragskonto pro Kategorie/Leistung, Aufwandkonto pro Ausgabenkategorie, Debitorenkonto, Bankkonto. Die Kontonummern **gibt der Treuhänder vor**, die App liefert keine. Export als Buchungsjournal (Datum, Beleg-Nr., Soll, Haben, Text, Betrag) als CSV. Dazu ein Jahrespaket als ZIP (Journal, OP-Liste, alle Rechnungs-PDFs, Belege).
- **Nutzen:** Weniger Aufwand beim Treuhänder. Genau diese Übergabe fehlt heute, der CSV-Export `app/api/export/accounting/route.ts` enthält nur Einnahmen/Ausgaben ohne Konten.
- **Aufwand:** mittel (generisches CSV), danach mittel pro Zielsoftware
- **Code:** `schema.prisma` (`Account`, Kontierung an `Category`/`Service`), `app/api/export/accounting/route.ts`, `lib/csv-export.ts`, Einstellungen
- **Ansatz:** Zuerst ein konfigurierbares, generisches Journal-CSV. Danach gezielt das Format der Software, die die Nutzer tatsächlich haben (siehe Abschnitt 7, Fragen). **Welche Importformate Banana, bexio oder Abacus genau erwarten, habe ich nicht geprüft.** Das ist vor der Umsetzung anhand der Hersteller-Dokumentation zu klären.

### F6 · Besserer Bankabgleich — **Sollte**
- **Beschreibung:** Abgleich über die QR-Referenz (nach F1). Teilzahlungen (nach F4). Die importierten Bewegungen werden gespeichert (Duplikatschutz per Bankreferenz, Saldovergleich Anfangs-/Endsaldo). Warnung, wenn Währung oder IBAN nicht passen (Z3). Optional camt.054 als zweiter Parser. Die Ausgabenseite des Auszugs kann direkt als `Expense` übernommen werden.
- **Nutzen:** Das Verbuchen der Zahlungseingänge geht fast automatisch. Die Ausgaben müssen nicht mehr doppelt erfasst werden.
- **Aufwand:** mittel
- **Code:** `lib/import/camt.ts`, `lib/import/matching.ts`, `app/(app)/invoices/import/*`, `schema.prisma` (`BankTransaction`)

### F7 · Mahnwesen nach Schweizer Praxis — **Sollte**
- **Beschreibung:** Eigener Mahnbeleg (PDF „1./2./3. Mahnung“ mit Bezug auf die Originalrechnung und aktualisiertem QR-Zahlteil über den offenen Betrag). Mahngebühr und Verzugszins sind konfigurierbar und standardmässig aus. Nach der letzten Stufe: Status „Betreibung/Inkasso“ und Export der Forderungsdaten für das Betreibungsbegehren.
- **Nutzen:** Eine Mahnung sieht heute aus wie eine erneute Rechnung (Z5). Mit dem Mahnbeleg ist für den Kunden klar, dass gemahnt wird.
- **Aufwand:** mittel
- **Code:** `app/(app)/invoices/reminders/*`, `lib/reminders.ts`, `lib/pdf/invoice-pdf.ts` (neuer `generateReminderPdf`), `schema.prisma` (`ReminderLog`, Gebühren in `ApplicationSettings`)
- **Rechtliches:** Ob Gebühren und Zinsen erlaubt sind und wie hoch, bitte mit Treuhänder bzw. Jurist klären. Die elektronische Übermittlung von Betreibungsbegehren (eSchKG) habe ich nicht geprüft.

### F8 · Ausgaben mit Belegen — **Sollte**
- **Beschreibung:** Beleg (PDF oder Foto) zu jeder Ausgabe, Lieferant, Status bezahlt/offen, Fälligkeit. Optional: Eingangs-QR-Rechnung einlesen (QR-Code aus PDF oder Bild auslesen) und daraus pain.001 für den Zahlungsauftrag erzeugen.
- **Nutzen:** Die Belegsammlung für den Treuhänder ist vollständig, und offene Lieferantenrechnungen sind sichtbar.
- **Aufwand:** mittel (Belege), hoch (pain.001)
- **Code:** `schema.prisma` `Expense`, `app/(app)/accounting/ExpenseForm.tsx`, `accounting/actions.ts`, `lib/file-validation.ts`, Dateiablage wie bei `customers/document-actions.ts`

### F9 · Kundenmodell und mehrsprachige Dokumente — **Sollte**
- **Beschreibung:** Land, UID, Kundennummer, Korrespondenzsprache (DE/FR/IT/EN), abweichende Rechnungsadresse und -E-Mail, Zahlungsfrist pro Kunde, mehrere Kontakte. PDF, E-Mail-Texte und QR-Zahlteil in der Sprache des Kunden. Die Oberfläche bleibt Deutsch.
- **Nutzen:** Für Kunden in der Romandie und im Tessin wichtig und in der Schweiz ein häufiges Auswahlkriterium.
- **Aufwand:** mittel (nur Dokumente); Oberfläche mehrsprachig: hoch, bewusst ausgeklammert
- **Code:** `schema.prisma` `Customer`, `CustomerForm.tsx`, `lib/pdf/invoice-pdf.ts` (Labels), `lib/pdf/document-pdf.ts` (`UNIT_LABELS`), `lib/email.ts`, `lib/yearly-invoices.ts` (Vorlagen)

### F10 · Flexible Abos statt leerer Jahresrechnung — **Sollte**
- **Beschreibung:** Intervall pro Kunde (monatlich, quartalsweise, jährlich) mit hinterlegter Vorlage (`InvoiceTemplate`). Die Rechnung wird dadurch **mit Positionen** erzeugt, nicht mit CHF 0. Optional mit automatischem Versand.
- **Nutzen:** Weniger manuelle Arbeit. Das 0-CHF-Risiko fällt weg (Z7). Für Vereine eignet sich das für Mitgliederbeiträge.
- **Aufwand:** gering–mittel
- **Code:** `lib/yearly-invoices.ts`, `schema.prisma` (`Customer.yearlyInvoice` wird zu `Subscription`), `invoices/templates/*`, `invoices/pending/*`. Dabei `generateInvoiceNumberTx` durch `lib/document-number.ts` ersetzen (R6).

### F11 · Kundenverlauf, Aufgaben und Wiedervorlagen — **Kann**
- **Beschreibung:** Chronologischer Verlauf pro Kunde aus bestehenden Daten (Offerten, Rechnungen, `InvoiceSentLog`, Zahlungen, Notizen, Audit-Log). Dazu Aufgaben mit Fälligkeit und Zuständigem, z. B. automatisch „Offerte nachfassen“ 7 Tage nach dem Versand.
- **Nutzen:** Einfache CRM-Funktion ohne eigene Vertriebs-Pipeline.
- **Aufwand:** gering (Verlauf), mittel (Aufgaben)
- **Code:** `app/(app)/customers/[id]/page.tsx`, `schema.prisma` (`Task`), `lib/notifications.ts` (Erinnerungen an die bestehenden E-Mail/Telegram-Kanäle)

### F12 · Online-Bezahlung (TWINT/Karte) per Link — **Kann**
- **Beschreibung:** Optionaler Zahlungslink auf Rechnung und E-Mail über einen Schweizer Payment-Service-Provider. Der Zahlungseingang kommt per Webhook als `Payment` (nach F4).
- **Nutzen:** Schnellere Zahlung bei Privatkunden.
- **Aufwand:** mittel
- **Differenzierung:** gering
- **Code:** neuer Webhook `app/api/external/…` (Muster: `payments/route.ts`), `lib/email.ts`, PDF
- **Hinweis:** Welcher Anbieter und zu welchen Gebühren: bitte selbst vergleichen, hier nicht geprüft. Eine öffentlich erreichbare Webhook-URL passt schlecht zum Raspberry Pi im Heimnetz.

### F13 · KI-Belegerfassung (lokal oder opt-in) — **Kann**
- **Beschreibung:** Ein hochgeladener Beleg (F8) wird ausgelesen und Datum, Betrag, Lieferant und Kategorie werden vorgeschlagen. Der Nutzer bestätigt.
- **Nutzen:** Spart Tipparbeit bei vielen Ausgaben.
- **Aufwand:** mittel
- **Differenzierung:** mittel
- **Code:** `accounting/actions.ts`, `ExpenseForm.tsx`
- **Risiko:** Belege gehen an einen Drittanbieter (revDSG, Auftragsbearbeitung). Deshalb opt-in, sichtbar gekennzeichnet und abschaltbar. Die Kategorie-Vorschläge lassen sich zuerst auch ohne KI umsetzen, z. B. aus der letzten Buchung beim gleichen Lieferanten.

---

## 4. Roadmap

**Phase 1: kurzfristig (0–3 Monate) – Korrektheit und Vertrauen**
1. F2 Festschreiben, Gutschrift, keine Cascade-Löschung von Rechnungen
2. F1 QR-Rechnung (strukturierte Adresse, Land, SCOR/QRR, IBAN-Prüfung)
3. F3 Belegarchiv und automatisches Backup
4. Kleine Fixes: Import prüft Währung und IBAN (Z3), Audit-Log für Pending-E-Mails (U6), Nummernlogik zusammenführen (R6), Entwürfe ohne Nummer oder mit Nummer erst beim Versand (R5; vorher mit Treuhänder klären)

**Phase 2: mittelfristig (3–9 Monate) – Buchhaltungsfähigkeit**
5. F4 Zahlungen und offene Posten
6. F5 Treuhänder-Export (generisch, danach 1 Zielsoftware)
7. F6 Bankabgleich 2.0
8. F10 flexible Abos

**Phase 3: langfristig (9–18 Monate) – Komfort und Reichweite**
9. F7 Mahnwesen mit Mahnbelegen
10. F8 Belege zu Ausgaben
11. F9 mehrsprachige Dokumente
12. F11 Verlauf und Aufgaben
13. Optional: F12 Online-Bezahlung, F13 KI-Belegerfassung, eBill (erst nach Abklärung der Teilnahmebedingungen)

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
3. **Bank:** Hast du eine QR-IBAN bzw. willst du eine? Welche Bank? (Bestimmt QRR vs. SCOR und das CAMT-Format.)
4. **Kunden:** Gibt es Kunden im Ausland oder Rechnungen in EUR? Kunden in der Romandie oder im Tessin?
5. **„Budget-App“:** Was ist das genau (`app/api/external/payments/route.ts`)? Soll sie bleiben oder durch F6 ersetzt werden?
6. **Volumen:** Wie viele Rechnungen, Ausgaben und Belege pro Jahr? (Relevant für BLOB-Speicherung in SQLite und Backups.)
7. **Nummernlücken:** Sind Lücken durch gelöschte Entwürfe für dich ein Problem? Soll das Format (Präfix + JJMM + 4 Ziffern) konfigurierbar werden?
8. **Betrieb:** Läuft die Instanz aus dem Internet erreichbar oder nur im LAN? (Relevant für Online-Zahlungs-Webhooks und die Backup-Strategie.) Welche Zeitzone hat der Container?
9. **Bearbeitete Rechnungen:** Gibt es heute schon versendete Rechnungen, die nachträglich geändert wurden? Das wäre vor F2 per Audit-Log zu prüfen.

---

## 7. Buchhaltung

### 7.1 Ist-Zustand (im Code belegt)

| Bereich | Stand | Beleg |
|---|---|---|
| Konten/Kontenplan | **Nicht vorhanden** | Suche `account\|konto\|soll\|haben\|ledger\|journal` in `schema.prisma`: keine Modelle |
| Buchungssätze | **Nicht vorhanden** | wie oben. Kommentar in `lib/import/matching.ts`: „without a bookkeeping ledger“, „the CRM has no accounts“ |
| Einnahmen | = bezahlte Rechnungen, gezählt nach `paidDate` (Geldfluss-Prinzip), Betrag = `totalAmount` | `app/(app)/accounting/lib/income-statement-queries.ts` |
| Ausgaben | `Expense`: Datum, Text, Betrag, Kategorie, Notiz. Kein Beleg, kein Lieferant, kein Zahlstatus | `schema.prisma`, `accounting/actions.ts` |
| „GuV“ | Einnahmen − Ausgaben pro Monat/Jahr (keine Abgrenzungen, keine Bestände) | `accounting/page.tsx`, `profit-loss-chart.tsx` |
| Kontierung | Kategorien (`Category`) gemeinsam für Positionen, Leistungen und Ausgaben. Keine Kontonummern | `schema.prisma` |
| Debitoren/OP | nur implizit über den Status `Sent`/`Overdue`. Keine OP-Liste per Stichtag, keine Teilzahlungen | `schema.prisma`, `invoices/page.tsx` |
| Zahlungseingang | Status → `Paid` manuell, über CAMT.053-Import oder über die Budget-API | `lib/payment-matching.ts` |
| Gutschrift/Storno/Debitorenverlust | nur Status `Canceled` | `InvoiceStatusSelect.tsx` |
| Periodenabschluss | **Nicht vorhanden.** Vergangene Perioden sind beliebig änderbar | U1–U4 |
| Export | CSV (Datum, Typ, Bezeichnung, Kategorie, Betrag) sowie Rechnungs-, Offerten- und Kunden-CSV und die SQLite-Datei | `app/api/export/*` |
| MWST | **Bewusst nicht vorgesehen** | R1 |

**Einordnung [bitte mit Treuhänder klären]:** Einzelunternehmen und Personengesellschaften mit weniger als CHF 500'000 Umsatz dürfen gemäss Art. 957 Abs. 2 OR nur über Einnahmen, Ausgaben und Vermögenslage Buch führen. Der heutige Stand kommt dem *teilweise* nahe. Es fehlen aber mindestens die Vermögenslage (Bank, Debitoren, Kreditoren), die unveränderbaren Belege und die 10-jährige Aufbewahrung (Art. 958f OR). Für eine GmbH/AG reicht der Stand nicht.

### 7.2 Lücken (Zusammenfassung)
- Keine Debitorenbuchhaltung: keine Zahlungen, Teilzahlungen, Skonto, Gutschriften oder Debitorenverluste (Z1, U4)
- Keine Kreditorenseite (offene Lieferantenrechnungen, pain.001) (Z6)
- Kein unveränderbarer Beleg- und Periodenstand (U1–U6)
- Keine Kontierung und kein Export in einem Format, das eine Buchhaltungssoftware direkt übernimmt (7.1)
- Bankbewegungen werden nicht gespeichert, deshalb kein Kontoabgleich (Z4)

### 7.3 Strategie: A (eigene Buchhaltung) vs. B (Anbindung)

| Kriterium | A – selbst bauen | B – sauber anbinden |
|---|---|---|
| Aufwand | Hoch: Hauptbuch, Kontenplan, Abschluss, Bilanz, Abgrenzungen, Mehrjahresbetrieb | Mittel: Kontierung, Journal-Export, 1–2 Zielformate, Datenqualität (F2, F4) |
| Fach- und Haftungsrisiko | Hoch: Fehler landen direkt im Abschluss und in der Steuererklärung | Tief: Verbucht und abgeschlossen wird im Fachprogramm unter Kontrolle des Treuhänders |
| Wartung bei Gesetzesänderungen | Dauernd (Rechnungslegung, Kontenrahmen) | Gering: nur Exportformate |
| Abhängigkeit von Dritten | Keine | Von Import-Schnittstellen und -Formaten (können sich ändern) |
| Akzeptanz beim Treuhänder | Tief: der Treuhänder muss sich in eine unbekannte Software einarbeiten | Hoch: der Treuhänder arbeitet in seiner gewohnten Software |
| Differenzierung | Keine gegenüber bexio, Banana, Abacus usw. | Mittel: „Rechnungswesen mit sauberem Treuhänder-Export, selbst gehostet“ |

**Empfehlung: B**, mit einer bewusst gebauten **Debitoren-Nebenbuchhaltung** in der App.

Begründung:
1. Die Architektur (eine Firma, SQLite, self-hosted, Einzelentwickler) und die angenommene Zielgruppe passen zu einer schlanken Fakturierung, nicht zu einer vollen Finanzbuchhaltung.
2. Treuhänder geben in der Praxis oft die Software vor. Eine eigene Buchhaltung würde dann doppelt geführt.
3. Die Teile, die *nur* die App gut kann, bleiben in der App: Rechnungen, QR-Referenz, Zahlungsabgleich, offene Posten, Mahnwesen, Belegarchiv. Genau diese Daten braucht der Treuhänder sauber.
4. Die Grenze liegt beim **Journal-Export**. Alles, was Konten, Abschluss und Bilanz betrifft, bleibt im Fachprogramm.

Umsetzung in dieser Reihenfolge: F2 → F4 → F5, danach F6/F8. Kontonummern und Buchungslogik (z. B. ob pro Rechnung oder pro Zahlung gebucht wird) **legt der Treuhänder fest**. Die App bietet dafür eine Konfiguration an und enthält keine eingebauten Konten.

**Offener Punkt:** Direkte API-Anbindungen (z. B. bexio) und genaue Importformate (Banana, Abacus) habe ich **nicht geprüft**. Vor F5 bitte die Hersteller-Dokumentation lesen und die Machbarkeit bestätigen.

### 7.4 Fragen an einen Treuhänder

1. Welche Software verwendest du, und welches Importformat (Datei oder API) akzeptierst du am liebsten?
2. Wie willst du die Rechnungen verbucht haben: bei Rechnungsstellung (Debitoren) oder erst bei Zahlungseingang? Einzeln oder als Sammelbuchung?
3. Welcher Kontenplan (z. B. Kontenrahmen KMU) und welche Konten für Ertrag, Debitoren, Bank und Aufwand pro Kategorie?
4. Wie runde ich das Rechnungstotal korrekt (5-Rappen-Rundung ja/nein)?
5. Wie sollen Gutschriften, Stornos, Skonti und Debitorenverluste im Export aussehen?
6. Sind Lücken in der Rechnungsnummerierung (gelöschte Entwürfe) ein Problem?
7. Was brauchst du zum Jahresende: OP-Liste per 31.12., Belege als PDF, Kontoauszüge? In welcher Struktur?
8. Erfüllt ein PDF-Archiv mit Hash-Werten und Audit-Log die Anforderungen der GeBüV an Integrität und Aufbewahrung, oder braucht es mehr (z. B. externe Zeitstempel, WORM-Speicher)?
9. Für Vereine: Welche Besonderheiten (Mitgliederbeiträge, Spenden) müsste die App abbilden?

---

### Verwendete externe Quellen
- Strukturierte Adressen QR-Rechnung ab 21.11.2025: https://timesafe.ch/neue-vorgaben-fuer-qr-rechnungen-ab-november-2025-alles-was-du-wissen-musst/ · https://www.kmupartnergroup.ch/newsroom/aenderungen-bei-qr-rechnungen-in-der-schweiz-ab-21-november-2025 · Primärquelle: SIX Implementation Guidelines QR-Rechnung v2.3 (https://www.six-group.com/dam/download/banking-services/standardization/qr-bill/ig-qr-bill-v2.3-en.pdf)
- swissqrbill (Adresstyp „S“, Sprachen): https://github.com/schoero/swissqrbill
- E-Rechnung Bund (ab CHF 5'000): https://www.bk.admin.ch/bk/de/home/digitale-transformation-ikt-lenkung/e-services-bund/services/e-rechnung.html · https://www.verband-e-rechnung.org/schweiz-macht-e-invoicing-fuer-bundeslieferanten-zur-pflicht/
- Gesetzesartikel (MWSTG Art. 10; OR Art. 102, 104, 957, 958f; GeBüV SR 221.431) nenne ich aus Fachwissen. **Den genauen Wortlaut bitte auf fedlex.admin.ch prüfen.**
