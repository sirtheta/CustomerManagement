# F4 Teil C: Automatisches nächtliches Backup — Design

Datum: 2026-09-30

F4 (Belegarchiv und Backup) wird in drei unabhängigen Teilen umgesetzt, jeweils mit eigenem Design, Tests und PR:
**C Backup** (dieses Dokument), danach **A PDF-Archiv mit Hash**, danach **B Hash-Kette im Audit-Log**.

## Ziel

Schutz vor Datenverlust auf dem Raspberry Pi (SD-Karte). Die App erstellt jede Nacht einen konsistenten Snapshot der SQLite-Datenbank, hält ihn eine konfigurierbare Zeit vor und meldet dem Admin, wenn ein Backup fehlschlägt.

Nicht Teil dieses Designs (YAGNI): Verschlüsselung, Cloud-Upload (S3/WebDAV/SFTP), Restore-UI. Die Off-Site-Kopie läuft ausserhalb der App (rsync/rclone auf `BACKUP_DIR`). Die Wiederherstellung ist ein Datei-Austausch und wird in der Doku beschrieben. `data/archive/` aus Teil A wird erst dort ins Backup aufgenommen.

## Komponenten

### `lib/backup.ts` (neu, Struktur wie `lib/logs.ts`)

- `createBackup(options?)`: öffnet die DB read-only mit `better-sqlite3` (Pfad via `getDbPath()`), führt `VACUUM INTO <dir>/db-YYYY-MM-DD.db.tmp` aus und benennt danach atomar in `db-YYYY-MM-DD.db` um. Ein Backup am selben Tag überschreibt das vorherige. Ein `.tmp`-Rest gilt nie als gültiges Backup. Gleiche Technik wie `app/api/export/database/route.ts`.
- `listBackups(dir?)`: liefert Name, Grösse, Datum der gültigen Dateien (Regex `^db-(\d{4}-\d{2}-\d{2})\.db$`), neueste zuerst.
- `pruneBackups(dir, keepDays, now?)`: löscht Backups älter als `keepDays` (`0` = alles behalten) sowie verwaiste `.tmp`-Dateien. Es bleibt immer mindestens das neueste Backup erhalten.
- `resolveBackupFilePath(filename, dir?)`: validiert den Namen strikt gegen die Regex, bevor das Dateisystem berührt wird (wie `resolveLogFilePath`). Gibt sonst `null` zurück.
- `startBackupScheduler()`: node-cron, Job = `createBackup` → `pruneBackups`. Ungültiger Cron-String wird geloggt, der Scheduler startet dann nicht (wie bei der Log-Rotation).

Start in [instrumentation.ts](../../../instrumentation.ts) direkt nach `startLogRotationScheduler()`, also nach `startLogCapture()`.

### Konfiguration (alle optional)

| Variable | Standard | Bedeutung |
|---|---|---|
| `BACKUP_DIR` | `<Verzeichnis der DB-Datei>/backups` | Zielordner, z. B. gemountetes Laufwerk oder NAS |
| `BACKUP_CRON_SCHEDULE` | `15 2 * * *` | Zeitplan (Server-Zeit); Log-Rotation läuft um 02:35, deshalb versetzt |
| `BACKUP_KEEP_DAYS` | `30` | Aufbewahrung in Tagen, `0` = alles behalten |
| `DISABLE_BACKUP` | – | `true` schaltet den Job ab |

Dokumentation in CLAUDE.md (Env-Tabelle) und README.

### Fehlerbenachrichtigung

- Jeder Fehler wird mit `log.error` geloggt.
- Bei einem Fehler geht eine Mail an die Admins, über die bestehende SMTP-Infrastruktur (`sendAccountMail` in `lib/email.ts`, Empfängerermittlung analog `sendAdminNotifications`). Höchstens eine Mail pro Kalendertag: der Zeitpunkt der letzten Fehlermail wird im Prozess gemerkt (In-Memory reicht, ein Neustart darf eine weitere Mail auslösen).
- Fehlt SMTP oder scheitert der Mailversand, wird nur geloggt. Die Benachrichtigung darf nie das Backup oder den Scheduler beeinträchtigen.

### UI und API

- `GET /api/backups/[filename]`: Admin-only (`auth()` und Rolle `Admin`, wie `export/database`), Dateiname über `resolveBackupFilePath` validiert, `Cache-Control: no-store`. Streamt die Datei als `application/vnd.sqlite3`.
- Einstellungen → Logs: neuer Abschnitt „Backups“ mit Tabelle (Datum, Grösse, Download). Nur für Admins sichtbar, Muster wie die bestehende Log-Liste.

## Fehlerfälle

- `BACKUP_DIR` nicht vorhanden: wird mit `mkdir -p` angelegt. Nicht beschreibbar: Fehler, Log und Admin-Mail.
- Datenträger voll: `VACUUM INTO` schlägt fehl, `.tmp` wird entfernt, Fehlerpfad wie oben.
- Pruning läuft nur nach einem erfolgreichen Backup, damit ein defekter Job nie alle alten Backups löscht.

## Tests

Unit (`tests/unit/backup.test.ts`):
- Dateiname- und Regex-Validierung, inkl. Pfad-Traversal (`../`, absolute Pfade, falsche Endung).
- `pruneBackups`: Aufbewahrungsgrenze, `keepDays = 0`, neuestes bleibt immer, `.tmp`-Reste werden entfernt.
- Fehlermail-Drossel: höchstens eine pro Tag.

Integration (`tests/integration/backup.test.ts`):
- `createBackup` gegen eine Temp-DB erzeugt eine gültige SQLite-Datei mit denselben Zeilen.
- Ein zweiter Lauf am selben Tag ersetzt die Datei; es bleibt kein `.tmp` zurück.
- Nicht beschreibbares Ziel liefert einen Fehler und löscht nichts.

Route-Test für `/api/backups/[filename]`: 401 ohne Session, 403 für Nicht-Admin, 404/400 bei ungültigem Namen, 200 für ein vorhandenes Backup.
