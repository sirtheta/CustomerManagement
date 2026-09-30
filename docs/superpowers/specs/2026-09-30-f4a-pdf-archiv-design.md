# F4 Teil A: PDF-Archiv mit SHA-256-Hash — Design

Datum: 2026-09-30

F4 (Belegarchiv und Backup) besteht aus drei unabhängigen Teilen: **C Backup** (erledigt), **A PDF-Archiv mit Hash** (dieses Dokument), danach **B Hash-Kette im Audit-Log**.

## Ziel

Beim Versand einer Rechnung oder Mahnung wird das exakte angehängte PDF unveränderlich abgelegt, mit SHA-256-Hash. So lässt sich später belegen, was wann an wen ging, und ob die Datei seither verändert wurde.

## Entscheidungen

- **Umfang:** Rechnungen und Mahnungen. Offerten werden nicht archiviert (keine Buchungsbelege).
- **Jeder Versand** wird eigenständig archiviert (eigene Datei, eigener Hash), auch bei wiederholtem Versand derselben Rechnung.
- **Speicherort:** Dateisystem unter `data/archive/JJJJ/`, Pfad und Hash in der DB. Keine BLOBs.
- **Fehlerverhalten:** Schlägt das Archivieren fehl, wird nicht gesendet. Es gibt nie einen versendeten Beleg ohne Archivkopie.

Nicht Teil dieses Designs (YAGNI): Massen-Integritätsprüfung, Admin-Übersicht über alle Archivdateien, Archivierung von Offerten, externe Zeitstempel/WORM (offene Frage 8 in FEATURE_ANALYSE.md), Backup-Code für `data/archive/`.

## Komponenten

### Datenmodell (`prisma/schema.prisma`, additive Migration)

Neues Modell `SentDocument`:

| Feld | Typ | Bedeutung |
|---|---|---|
| `id` | Int, autoincrement | |
| `invoiceId` | Int | Relation zu `Invoice`, `onDelete: Restrict` |
| `kind` | String | `Invoice` oder `Reminder` |
| `reminderLevel` | Int? | nur bei `Reminder` (Stufe zum Versandzeitpunkt) |
| `documentNumber` | String | Rechnungsnummer zum Versandzeitpunkt |
| `path` | String | relativ zu `data/archive/`, z. B. `2026/I-2609001_Invoice_20260930T101500Z.pdf` |
| `sha256` | String | Hex, 64 Zeichen |
| `size` | Int | Bytes |
| `sentTo` | String | Empfänger |
| `subject` | String | Betreff |
| `createdAt` | DateTime, default now | |
| `createdById` | Int | Nutzer, der den Versand ausgelöst hat |

Index auf `invoiceId`. `InvoiceSentLog` bleibt unverändert; ein `SentDocument` und der zugehörige Log-Eintrag werden in derselben Transaktion geschrieben. Gelöscht werden dürfen Rechnungen mit Archiv nicht (`Restrict`); F3 sperrt das für Nicht-Entwürfe ohnehin.

`AuditEntity` (`lib/audit.ts`) wird um `"SentDocument"` erweitert.

### `lib/document-archive.ts` (neu)

- `archiveRootDir()`: `data/archive/` neben der DB-Datei (gleiche Ableitung wie `getDbPath()` bzw. Backup-Ordner), Override per `ARCHIVE_DIR` (optional, z. B. für Tests und externe Laufwerke).
- `archivePdf({ invoice, kind, pdf, now? })`: berechnet SHA-256 über die Bytes, die später auch angehängt werden. Der Pfad wird aus Jahr, Dokumentnummer (auf `[A-Za-z0-9_-]` normalisiert), `kind` und UTC-Zeitstempel gebaut, nie aus Nutzereingaben. Schreiben mit `flag: "wx"` (nie überschreiben), danach `chmod 0444`. Liefert `{ path, sha256, size }`. Ordner werden bei Bedarf angelegt.
- `resolveArchivePath(relPath)`: löst gegen das Root auf und liefert `null`, wenn das Ergebnis ausserhalb liegt (Traversal-Schutz beim Lesen).
- `verifyArchived(id)`: liest die Datei, vergleicht Hash und Grösse. Ergebnis `{ ok: true } | { ok: false, reason: "missing" | "mismatch" }`.

### Gemeinsamer Versand-Helfer

Alle drei Rechnungs-Versandpfade rufen denselben Helfer auf: `sendDocument` (Rechnung) in `lib/document-actions.ts`, `approvePendingEmail` in `app/(app)/invoices/pending/actions.ts`, `sendReminder` in `app/(app)/invoices/reminders/actions.ts`. Der Helfer (Datei `lib/invoice-dispatch.ts`) kapselt:

1. PDF erzeugen (`generateInvoicePdf`),
2. `archivePdf`,
3. `sendInvoiceEmail` mit exakt diesen Bytes,
4. Rückgabe von `{ archive }`, den die Aufrufer in ihre bestehende Transaktion einbauen (`sentDocument.create` neben `invoiceSentLog.create`).

Offerten (`sendDocument` mit `kind: "quote"`) bleiben unverändert.

### Fehlerverhalten

- Archivieren scheitert: Abbruch vor dem Versand, Fehlermeldung in der UI, Zustand unverändert. Bei Pending-E-Mail und Mahnung bleibt der Eintrag bestehen.
- Versand scheitert nach dem Archivieren: Die Datei bleibt liegen, es gibt keinen DB-Eintrag. Der nächste Versuch erzeugt eine neue Datei mit neuem Zeitstempel. Solche verwaisten Dateien sind bewusst harmlos und werden in der Doku erwähnt.
- Nach erfolgreichem Versand: `logAudit(SEND, ...)` wie bisher, zusätzlich `logAudit(CREATE, "SentDocument", id, documentNumber, { sha256, path })`.

### UI und API

- Rechnungs-Detailseite: Abschnitt „Versendete Dokumente“ mit Datum, Art (Rechnung/Mahnung Stufe n), Empfänger, Kurz-Hash (erste 12 Zeichen) und Download-Link. Sichtbar für Editor und Admin.
- `GET /api/invoices/[id]/archive/[docId]`: Session erforderlich, Rolle Editor oder Admin (Viewer 403). Prüft, dass `docId` zu `id` gehört, löst den Pfad über `resolveArchivePath` auf, verifiziert den Hash vor dem Ausliefern. Bei Abweichung oder fehlender Datei `409` (mit klarer Meldung), sonst `application/pdf` mit `Cache-Control: no-store` und Dateiname `<Nr>_<Datum>.pdf`.

### Backup

Kein neuer Code. `data/archive/` liegt im Datenvolume; `DEPLOYMENT.md` empfiehlt, diesen Ordner zusammen mit `BACKUP_DIR` off-site zu sichern (z. B. `rsync` auf `data/archive/`). Der Backup-Entwurf (Teil C) hatte diese Aufnahme ausdrücklich für Teil A vorgesehen.

## Dokumentation

- **`public/benutzerhandbuch.html`** (Nutzerhandbuch, enthält base64-Bilder: nie komplett lesen oder umformatieren, nur gezielt mit `grep -n` und `Edit` ändern):
  - Abschnitt „Rechnungen“ (`<h2>Rechnungen</h2>`, ca. Zeile 524): neuer `<h3 class="sub">` „Versendete Dokumente & Archiv“. Inhalt: Jeder Versand einer Rechnung oder Mahnung wird als PDF mit Prüfsumme gespeichert; Liste und Download auf der Rechnungsseite; Meldung 409 bei veränderter Datei bedeutet „Datei stimmt nicht mehr mit der Prüfsumme überein, Admin informieren“; Versand bricht ab, wenn das Archiv nicht schreibbar ist.
  - Abschnitt „Ausstehende E-Mails, Mahnungen & Vorlagen“ (ca. Zeile 573): ein Satz, dass auch Mahnungen und freigegebene E-Mails archiviert werden.
  - Abschnitt „Referenz“ (ca. Zeile 773): falls dort Rechte pro Rolle aufgeführt sind, Zeile für Archiv-Download (Editor/Admin) ergänzen.
  - Screenshot optional per `npm run manual:screenshots` und `npm run manual:splice`; ohne Neuaufnahme im Abschlussbericht vermerken. `git diff --stat` muss zeigen, dass nur die genannten Stellen geändert sind.
- **`CLAUDE.md`**: Abschnitt „Business document workflow“ um `lib/document-archive.ts` und den Versand-Helfer ergänzen; Env-Tabelle um `ARCHIVE_DIR`.
- **`DEPLOYMENT.md`**: Abschnitt „Daten & Backup“: Archivordner, Off-site-Empfehlung, Hinweis zu verwaisten Dateien.
- **`FEATURE_ANALYSE.md`**: F4-Eintrag in „Phase 1“, Punkt A abhaken, Titel-Zeile anpassen.

## Tests

Unit (`tests/unit/document-archive.test.ts`):
- Hash und Grösse stimmen mit den geschriebenen Bytes überein.
- Pfadbau: Normalisierung der Nummer, Jahresordner, kein Ausbrechen aus dem Root.
- `wx`-Schutz: zweites Schreiben auf denselben Pfad schlägt fehl und lässt die Datei unverändert.
- `resolveArchivePath`: Traversal (`../`, absolute Pfade) ergibt `null`.
- `verifyArchived`: `ok`, `missing`, `mismatch` (Datei nach dem Archivieren manipuliert).

Integration (`tests/integration/document-archive.test.ts`, Temp-DB und Temp-Archivordner):
- Für alle drei Versandpfade: Erfolg legt Datei, `SentDocument` und `InvoiceSentLog` an; das gesendete Attachment hat denselben Hash wie das Archiv.
- Archivordner nicht beschreibbar: kein E-Mail-Versand, kein `SentDocument`, Zustand unverändert (Pending-E-Mail bzw. Mahnstufe bleiben).
- Versand scheitert nach Archivierung: kein DB-Eintrag.
- Rechnung mit `SentDocument` lässt sich nicht per Prisma löschen (`Restrict`), auch nicht über das Löschen des Kunden.

Route-Test `GET /api/invoices/[id]/archive/[docId]`: 401 ohne Session, 403 für Viewer, 404 bei fremder `docId`, 409 bei manipulierter oder fehlender Datei, 200 mit `application/pdf` und passendem Hash.
