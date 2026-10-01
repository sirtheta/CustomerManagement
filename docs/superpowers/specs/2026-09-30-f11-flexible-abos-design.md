# F11 Flexible Abos – Design

Ersetzt die leere Jahresrechnung (`Customer.yearlyInvoice` / `nextInvoiceDate`) durch mehrere Abos pro Kunde mit Intervall und Vorlage. Die erzeugte Rechnung enthält Positionen statt CHF 0 (Z7).

## Ziele
- Mehrere Abos pro Kunde (monatlich, quartalsweise, jährlich), je mit `InvoiceTemplate`.
- Rechnung wird mit Positionen und korrekter Summe als Entwurf erzeugt.
- Optional automatischer Versand pro Abo.
- Bestehende Jahreskunden werden migriert.

## Nicht enthalten
Laufzeit-Ende/Kündigungsdatum, Preisindexierung, pro-rata-Rechnungen, Abo-Verlauf.

## Datenmodell
Neues Modell `Subscription`:
- `id`, `customerId` (`onDelete: Cascade`), `templateId?` (`InvoiceTemplate`, `onDelete: SetNull`)
- `interval` (`Monthly | Quarterly | Yearly`), `nextInvoiceDate`, `autoSend` (Standard `false`), `active` (Standard `true`)
- Indizes: `nextInvoiceDate`, `customerId`.

`Customer.yearlyInvoice` und `Customer.nextInvoiceDate` (samt Index) entfallen.

**Migration** (SQL, läuft auch über `scripts/startup.js`): pro Kunde mit `yearlyInvoice = true` und gesetztem `nextInvoiceDate` ein `Yearly`-Abo ohne Vorlage, `autoSend = false`, `active = true`, mit dem bisherigen Datum. Danach werden die Spalten entfernt.

## Job `checkSubscriptions`
Ersetzt `checkYearlyInvoices` (`lib/yearly-invoices.ts` → `lib/subscriptions.ts`, gleicher Hook in `lib/notifications.ts` und `settings/actions.ts`).

- Auswahl: `active`, `nextInvoiceDate <= heute`, Kunde nicht archiviert.
- Pro Abo eine Transaktion: Rechnung (`Draft`) mit Positionen aus der Vorlage, Summe wie bei manuell erstellten Rechnungen; `PendingEmail`; `nextInvoiceDate` vorrücken. Das Vorrücken ist abgesichert (`updateMany` mit `active` und dem gelesenen `nextInvoiceDate`): Hat jemand das Abo inzwischen pausiert oder geändert, oder läuft ein zweiter Lauf parallel, wird die ganze Transaktion zurückgerollt und das Abo übersprungen.
- Der Betrag in der Pending-E-Mail bleibt der Platzhalter `{totalAmount}` (wie `{documentNumber}`) und wird erst beim Versand aus der tatsächlichen Rechnungssumme eingesetzt (`fillTotalAmount`). So steht auch nach dem Bearbeiten der Positionen auf der Pending-Seite der richtige Betrag in der Mail. Der Standardtext enthält «über {totalAmount}».
- Ein Fehler bei einem Abo wird geloggt und blockiert die übrigen nicht; das Abo wird beim nächsten Lauf erneut versucht.
- Vorrücken ab dem bisherigen Datum um 1/3/12 Monate, Monatsende wird geklemmt (31.1. → 28.2.). Liegt das Ergebnis noch in der Vergangenheit, wird aufgeholt. Es entsteht pro Lauf **eine** Rechnung.
- `autoSend`: nach der Transaktion derselbe Pfad wie beim Freigeben. Der Versandteil von `approvePendingEmail` liegt dafür in `lib/pending-email-send.ts` (`sendPendingInvoice`: Nummer vergeben, `renderArchiveAndSend`, `SentDocument`, Status `Sent`). Der Job ruft ihn als `SYSTEM_ACTOR` auf (User-ID 0, Name «System (Abo)»; es gibt keinen Fremdschlüssel auf `AuditLog.userId` / `SentDocument.createdById`). Es wird nur gesendet, wenn die Vorlage mindestens eine Position hat, nie eine CHF-0-Rechnung. Bei einem Fehler (Rückgabe oder Wurf) bleiben Entwurf und `PendingEmail` bestehen und die Admins werden über `notifyAdmins` (Notify-E-Mail, Telegram) benachrichtigt; `lib/notifications` wird dafür lazy importiert, weil es den Job selbst importiert.
- Ohne Vorlage: leerer Entwurf wie bisher, nie Auto-Versand.
- Datumswerte sind lokale Daten (`lib/date.ts`: `parseDate` / `toDateString`), nie `new Date("YYYY-MM-DD")` oder `toISOString()`. Der Job und `addInterval` rechnen in Lokalzeit.
- `logAudit` ausserhalb der Transaktion.

## UI
- Kundenseite: Sektion «Abos» (Liste mit Vorlage, Intervall, nächstem Datum, Auto-Versand, Badge «Vorlage fehlt», Badge «Pausiert»; Formulare inline zum Anlegen/Bearbeiten, Pausieren/Fortsetzen, Löschen mit Bestätigung).
- `customers/subscription-actions.ts`: `requireEditor()`, Validierung (Intervall, lokales Datum, Vorlage existiert; `autoSend` nur mit einer Vorlage, die mindestens eine Position hat), Audit. Alle Änderungen sind auf `{ id, customerId }` begrenzt (`updateMany` / `deleteMany`); bei 0 Treffern passiert nichts und es gibt keinen Audit-Eintrag.
- Schutz vor veraltetem Formular: Das Bearbeiten-Formular sendet das beim Laden angezeigte Datum (`loadedNextInvoiceDate`) mit. Ist das abgesendete Datum gleich, wird `nextInvoiceDate` nicht geschrieben; sonst könnte ein offener Tab ein vom Job vorgerücktes Datum zurücksetzen und denselben Zeitraum doppelt abrechnen. Die Formular-Komponente wird zusätzlich über Id, Datum, Vorlage, `autoSend` und Intervall neu aufgebaut.
- Kundenformular und `customers/actions.ts` verlieren die Jahresfelder.
- Dashboard: geplante Abos (Kunde, Intervall, Datum).
- Kundenfilter «Geplante Abos» (`?subscription=true`, `subscriptions: { some: { active: true } }`).
- Kunden-Export: Spalte «Abos» statt «Jahresrechnung».
- Seeds (`prisma/seed.ts`, `scripts/seed-manual-demo.ts`), Benutzerhandbuch, CLAUDE.md und `FEATURE_ANALYSE.md` (F11 abhaken) werden angepasst.

## Tests (TDD)
- Unit: Datumsberechnung (Monatsende, Schaltjahr, Aufholen).
- Integration Job: Vorlage → Positionen/Summe; ohne Vorlage → leerer Entwurf; archivierter Kunde und pausiertes Abo übersprungen; kein Doppellauf; Abo, das nach dem Laden pausiert wurde, erzeugt nichts; `autoSend` versendet und archiviert (End-to-End mit echtem Archiv und `SentDocument`); Fehlschlag lässt Entwurf und `PendingEmail` stehen und benachrichtigt die Admins; kein Auto-Versand ohne Vorlage oder mit leerer Vorlage.
- Unit: Abo-Actions (inkl. Kundenbindung, unverändertes Datum wird nicht geschrieben, Vorlage ohne Positionen bei `autoSend`), `fillTotalAmount`.
- Migration: Altkunde → Yearly-Abo ohne Vorlage.
- Bestehende Tests (`yearly-invoices`, `customer-actions`, `notifications`, `settings-actions`, Export) werden angepasst.
