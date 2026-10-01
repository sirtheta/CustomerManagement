# F8 Mahnwesen mit Mahnbelegen — Design

Stand: 2026-10-01. Bezug: `FEATURE_ANALYSE.md` F8, Befund Z5.

## Ziel

Eine Mahnung ist heute das normale Rechnungs-PDF mit Titel „Rechnung“ (QR-Betrag = Restbetrag). F8 liefert einen eigenen Mahnbeleg je Stufe, mit optionaler Mahngebühr und optionalem Verzugszins (beide standardmässig aus).

## Nicht im Umfang

- Status „Betreibung/Inkasso“ und Export der Forderungsdaten (eigener späterer Schritt).
- Verrechnung von Gebühr und Zins als offene Forderung: Rechnungsbetrag, `Payment`, OP-Liste und GuV bleiben unverändert. Gebühr und Zins stehen nur auf dem Beleg und im QR-Betrag. Zahlt der Kunde mehr als den Rest, entsteht im bestehenden Abgleich eine Überzahlung.
- Rechtliche Klärung (Zulässigkeit und Höhe von Gebühr und Zins) liegt beim Betreiber; die Einstellungen weisen darauf hin.

## Stufen

| Level | Beleg-Titel | Gebühr |
|---|---|---|
| 1 | Zahlungserinnerung | keine |
| 2 | 1. Mahnung | `reminderFeeLevel2Rappen` |
| 3 | 2. Mahnung | `reminderFeeLevel3Rappen` |
| 4 | 3. Mahnung | `reminderFeeLevel4Rappen` |

Nach Level 4 gibt es keine weitere Stufe: `sendReminder` erhöht `PendingReminder.reminderLevel` nicht über 4 und die Mahnliste zeigt „Letzte Stufe erreicht“ ohne Versandbutton (Ignorieren bleibt möglich).

## Datenmodell (eine Migration)

`ApplicationSettings`:
- `reminderFeeLevel2Rappen`, `reminderFeeLevel3Rappen`, `reminderFeeLevel4Rappen`: `Int @default(0)`.
- `reminderInterestPercent`: `Decimal @default(0)` (p.a.; 0 = Zins aus).

`SentDocument` (nur für `kind = "Reminder"` befüllt, sonst `null`):
- `openRappen`, `feeRappen`, `interestRappen`: `Int?`.
- `interestPercent`: `Decimal?`.
- `dunningDate`: `DateTime?` (Mahndatum, Stichtag der Zinsberechnung).

Keine neue Tabelle: Level, Empfänger, Betreff und Archivpfad liegen bereits in `SentDocument`.

## Berechnung (`lib/reminder-charges.ts`)

Reine Funktion `computeReminderCharges({ level, openRappen, dueDate, dunningDate, feeRappen, interestPercent })`:
- `interest = round(open × percent/100 × days / 365)` mit `days = max(0, Tage von dueDate bis dunningDate)`; bei Satz 0 oder `days = 0` ist der Zins 0.
- `fee` = Gebühr der Stufe (Level 1: 0).
- `total = open + fee + interest`.

Der Restbetrag stammt aus `getPaymentSummary(...).remainingRappen` (berücksichtigt Teilzahlungen und Gutschriften). Alle Beträge in Rappen (`Int`), CHF nur an der Darstellungsgrenze.

## Mahnbeleg-PDF (`lib/pdf/reminder-pdf.ts`)

`generateReminderPdf(invoice, settings, charges)`, gleiche Bausteine wie `invoice-pdf.ts` (`theme.ts`, `qrbill-helpers.ts`):
- Titel nach Stufe, Mahndatum, Bezug auf Rechnungsnummer, Rechnungsdatum, Fälligkeit und Tage im Verzug.
- Betragstabelle: Restbetrag; Mahngebühr und Verzugszins (inkl. Satz) nur bei Betrag > 0; Total.
- Zahlungsfrist auf dem Beleg: `reminderCooldownDays`.
- QR-Zahlteil über das Total. Keine Positionen der Originalrechnung.

## Versand

- `lib/invoice-dispatch.ts`: `renderArchiveAndSend` erhält eine Reminder-Variante, die `generateReminderPdf` aufruft; sonst unverändert (einmal rendern, Bytes archivieren, dieselben Bytes anhängen; Archivfehler = kein Versand).
- `sentDocumentData` übernimmt die Betragsspalten und das Mahndatum.
- `app/(app)/invoices/reminders/actions.ts` (`sendReminder`): berechnet die Beträge serverseitig neu (nie aus Formulardaten), Level-Deckel 4, Audit wie bisher (`SEND Reminder`, `CREATE SentDocument`), im Audit-Detail zusätzlich Gebühr und Zins.
- `ReminderRow.tsx` und `page.tsx`: Stufe 4 im Label, Vorschau von Gebühr, Zins und Total, „Letzte Stufe erreicht“ nach Level 4.

## Einstellungen

Neuer Abschnitt „Mahnwesen“ neben `reminderCooldownDays` in Einstellungen: drei Gebührenfelder (CHF, intern Rappen), Zinssatz (%), Hinweis zur rechtlichen Klärung. Validierung: Beträge ≥ 0, Zinssatz 0–100. Änderungen laufen durch die bestehende Settings-Action inkl. Audit.

## Tests

- Unit `reminder-charges`: Satz 0, Rundung, Teilzahlung (kleinerer Rest), `days = 0`, Gebühr je Stufe.
- Unit PDF: Titel je Stufe, Zeilen für Gebühr und Zins nur bei > 0, QR-Betrag = Total.
- Integration `sendReminder`: `SentDocument` enthält Beträge und Mahndatum, Archiv-Hash stimmt, Level-Deckel bei 4, Archivfehler sendet nicht und belässt die Stufe.
- Settings-Action: Validierung der neuen Felder.

## Doku

`CLAUDE.md` (Abschnitt Business document workflow), `FEATURE_ANALYSE.md` (F8 und Z5 als umgesetzt markieren) und README-Zeile zum Mahnwesen.
