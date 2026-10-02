# F8 Mahnwesen mit Mahnbelegen — Design

Stand: 2026-10-01. Bezug: `FEATURE_ANALYSE.md` F8, Befund Z5.

## Ziel

Eine Mahnung ist heute das normale Rechnungs-PDF mit Titel „Rechnung“ (QR-Betrag = Restbetrag). F8 liefert einen eigenen Mahnbeleg je Stufe, mit optionaler Mahngebühr und optionalem Verzugszins (beide standardmässig aus).

## Nicht im Umfang

- Status „Betreibung/Inkasso“ und Export der Forderungsdaten (eigener späterer Schritt).
- Verrechnung von Gebühr und Zins als offene Forderung: Rechnungsbetrag, `Payment` und OP-Liste bleiben unverändert. Gebühr und Zins stehen nur auf dem Beleg, im QR-Betrag und in `SentDocument`. Zahlt der Kunde mehr als den Rest, entsteht im bestehenden Abgleich eine Überzahlung; diese Zahlung erscheint als `Payment.amount` im Journal und in den Einnahmen (die Gebühr wird nicht separat ausgewiesen).
- Rechtliche Klärung (Zulässigkeit und Höhe von Gebühr und Zins) liegt beim Betreiber; die Einstellungen weisen darauf hin.

## Stufen

| Level | Beleg-Titel | Gebühr |
|---|---|---|
| 1 | Zahlungserinnerung | keine |
| 2 | 1. Mahnung | `reminderFeeLevel2Rappen` |
| 3 | 2. Mahnung | `reminderFeeLevel3Rappen` |
| 4 | 3. Mahnung | `reminderFeeLevel4Rappen` |

Nach Level 4 gibt es keine weitere Stufe: `sendReminder` erhöht `PendingReminder.reminderLevel` nicht über 4 und die Mahnliste zeigt „Letzte Stufe erreicht“ ohne Versandbutton (Ignorieren bleibt möglich). „Letzte Stufe versendet“ gilt, wenn `reminderLevel >= 4` und seit `PendingReminder.createdAt` ein `SentDocument` mit `kind = "Reminder"` und `reminderLevel = 4` existiert (Helper `isLastReminderLevelSent` in `lib/reminders.ts`, von Action und Liste gemeinsam genutzt). Wird die Mahnung zurückgesetzt (Zahlung gelöscht, Status zurück), beginnt sie mit einer neuen `PendingReminder`-Zeile wieder bei Level 1. Die Migration setzt bestehende `reminderLevel > 4` auf 4.

## Datenmodell (keine neue Migration)

`ApplicationSettings`:
- `reminderFeeLevel2Rappen`, `reminderFeeLevel3Rappen`, `reminderFeeLevel4Rappen`: `Int @default(0)`.
- `reminderInterestPercent`: `Decimal @default(0)` (p.a.; 0 = Zins aus).

`SentDocument` (nur für `kind = "Reminder"` befüllt, sonst `null`):
- `openRappen`, `feeRappen`, `interestRappen`: `Int?`.
- `interestPercent`: `Decimal?`.
- `dunningDate`: `DateTime?` (Mahndatum, Stichtag der Zinsberechnung).

Keine neue Tabelle: Level, Empfänger, Betreff und Archivpfad liegen bereits in `SentDocument`.

Es wird **keine neue Migration angelegt**. Die nötigen SQL-Befehle werden an die letzte, noch unveröffentlichte Migration `20261001120000_invoicing_and_banking` angehängt (Projektpraxis, siehe Squash #125). Falls diese Migration bereits in einem Release steckt, ist das nicht zulässig und es muss neu entschieden werden. Eine lokale DB, die die Migration schon angewendet hat, muss danach zurückgesetzt werden (geänderte Prüfsumme).

Die angehängte SQL setzt ausserdem `PendingReminder.reminderLevel` auf höchstens 4 (`UPDATE … SET reminderLevel = 4 WHERE reminderLevel > 4`).

## Berechnung (`lib/reminder-charges.ts`)

Reine Funktion `computeReminderCharges({ level, openRappen, dueDate, dunningDate, settings })` (`settings` liefert die drei Gebühren und den Zinssatz):
- `interest = round(open × percent/100 × days / 365)` mit `days` = Kalendertage von `dueDate` bis `dunningDate` (aus den UTC-Datumsteilen, damit Uhrzeit und Zeitumstellung nichts verschieben), mindestens 0. Bei Satz 0, `days = 0` oder Level 1 ist der Zins 0: die Zahlungserinnerung ist eine reine Erinnerung ohne Gebühr und ohne Zins.
- `fee` = Gebühr der Stufe (Level 1: 0).
- `total = open + fee + interest`.

Der Restbetrag stammt aus `getPaymentSummary(...).remainingRappen` (berücksichtigt Teilzahlungen und Gutschriften). Ist er 0 (z. B. durch eine Gutschrift voll gedeckt), versendet `sendReminder` nichts und meldet „Die Rechnung ist bereits beglichen.“. Eine Teilzahlung entfernt die Mahnung (`lib/payments.ts`), und `PartiallyPaid` wird nicht wieder `Overdue`; ein reduzierter Rest entsteht im Mahnfluss daher praktisch nur durch Gutschriften. Alle Beträge in Rappen (`Int`), CHF nur an der Darstellungsgrenze.

## Mahnbeleg-PDF (`lib/pdf/reminder-pdf.ts`)

`generateReminderPdf(invoice, settings, charges)`, gleiche Bausteine wie `invoice-pdf.ts` (`theme.ts`, `qrbill-helpers.ts`):
- Titel nach Stufe, Mahndatum, Bezug auf Rechnungsnummer, Rechnungsdatum, Fälligkeit und, falls überfällig, die Tage im Verzug.
- Betragstabelle: Restbetrag; Mahngebühr und Verzugszins (inkl. Satz) nur bei Betrag > 0; Total.
- Zahlungsfrist auf dem Beleg: `reminderCooldownDays`.
- QR-Zahlteil über das Total. Keine Positionen der Originalrechnung.

## Versand

- `lib/invoice-dispatch.ts`: `renderArchiveAndSend` erhält eine Reminder-Variante, die `generateReminderPdf` aufruft; sonst unverändert (einmal rendern, Bytes archivieren, dieselben Bytes anhängen; Archivfehler = kein Versand).
- `sentDocumentData` übernimmt die Betragsspalten und das Mahndatum.
- `lib/email.ts`: `sendInvoiceEmail` nimmt optional `attachmentName`; die Mahnung heisst `mahnung-<Rechnungsnummer>-stufe<level>.pdf` statt `rechnung-<Nummer>.pdf`.
- `app/(app)/invoices/reminders/actions.ts` (`sendReminder`): berechnet die Beträge serverseitig neu (nie aus Formulardaten), Level-Deckel 4, Audit wie bisher (`SEND Reminder`, `CREATE SentDocument`), im Audit-Detail zusätzlich Gebühr und Zins.
- `ReminderRow.tsx` und `page.tsx`: Stufe 4 im Label, Vorschau von Gebühr, Zins und Total, „Letzte Stufe erreicht“ nach Level 4.

## Einstellungen

Neuer Abschnitt „Mahnwesen“ neben `reminderCooldownDays` in Einstellungen: drei Gebührenfelder (CHF, intern Rappen), Zinssatz (%), Hinweis zur rechtlichen Klärung. Validierung: Beträge ≥ 0 (ungültige Eingabe: „Ungültiger Betrag.“), Zinssatz 0–100. `saveSettings` schreibt einen Audit-Eintrag `UPDATE Settings` (`entityRef` „Mahnwesen“, Details mit den neuen Werten), wenn sich Gebühren oder Zinssatz ändern.

## Bekannte Grenzen

- Das Mahndatum ist die Serverzeit (Container in UTC); kurz nach Mitternacht Schweizer Zeit liegt es auf dem Vortag, Zinstage und gedrucktes Datum sind dann um einen Tag niedriger.
- Eine Mahnung mit „Letzte Stufe erreicht“ bleibt in der Liste (Ignorieren setzt nur den Cooldown) und kann über `notifyRepeatIntervalDays` weiter gemeldet werden, bis die Rechnung bezahlt oder die Mahnung zurückgesetzt ist.
- Gleichzeitiger Doppelversand derselben Mahnung (zwei Tabs) ist nicht gesperrt, wie schon heute.
- Bestehende Nicht-Release-Datenbanken, die `20261001120000_invoicing_and_banking` schon angewendet haben, bekommen die neuen Spalten nicht und müssen neu aufgebaut werden (`scripts/startup.js` und `migrate deploy` vergleichen nur den Migrationsnamen).

## Bankabgleich

`OpenInvoice` (`lib/import/matching.ts`) erhält optional `reminderTotal` (CHF: Offen + Gebühr + Zins der zuletzt versendeten Mahnung; nur gesetzt, wenn deren `openRappen` dem aktuellen Rest entspricht und der Total über dem Rest liegt, damit eine nach Teilzahlung oder Gutschrift veraltete Mahnung nicht mehr zählt). `matchStatementToInvoices` akzeptiert einen Betrag, der dem offenen Betrag oder dem `reminderTotal` entspricht, als Betragstreffer. `loadOpenInvoices` füllt das Feld aus der neuesten `SentDocument`-Zeile mit `kind = "Reminder"`. Die Zahlung wird über `recordPayment` gebucht; der Überschuss gegenüber dem Rest erscheint als Überzahlung.

## Tests

- Unit `reminder-charges`: Satz 0, Rundung, Teilzahlung (kleinerer Rest), `days = 0`, Gebühr je Stufe.
- Unit PDF: Titel je Stufe, Zeilen für Gebühr und Zins nur bei > 0, QR-Betrag = Total.
- Integration `sendReminder`: `SentDocument` enthält Beträge und Mahndatum, Archiv-Hash stimmt, Level-Deckel bei 4, Archivfehler sendet nicht und belässt die Stufe.
- Settings-Action: Validierung der neuen Felder, Audit bei Änderung.
- `isLastReminderLevelSent` (inkl. Neustart der Mahnung nach Reset), Rest 0, Anhangname, Bankabgleich mit Mahn-Total.

## Doku

`CLAUDE.md` (Abschnitt Business document workflow), `FEATURE_ANALYSE.md` (F8 und Z5 als umgesetzt markieren) und README-Zeile zum Mahnwesen.
