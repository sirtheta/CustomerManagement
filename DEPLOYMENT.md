# Deployment auf Raspberry Pi 5

## Ablauf

```text
Entwicklung (PC)  →  git push  →  GitHub Actions baut ARM64-Image
                                          ↓
Raspberry Pi 5  →  docker compose pull  →  docker compose up -d
```

---

## 1. Einmalige Einrichtung

### Öffentliches Container-Image

Das Image liegt öffentlich in der **GitHub Container Registry (ghcr.io)**. Für den
Download ist keine Anmeldung und kein GitHub-Token erforderlich.

```bash
docker pull ghcr.io/sirtheta/customer-management:latest
```

### Auf dem Pi einrichten

```bash
# 1. Nur die Docker-Dateien klonen (kein ganzes Repo nötig)
mkdir -p ~/customer-management
cd ~/customer-management

# docker-compose.yml und .env.example vom Repo holen:
curl -O https://raw.githubusercontent.com/sirtheta/CustomerManagement/main/docker-compose.yml
curl -O https://raw.githubusercontent.com/sirtheta/CustomerManagement/main/.env.example

# 2. Umgebungsvariablen konfigurieren
cp .env.example .env
nano .env  # Werte setzen (AUTH_SECRET, AUTH_URL, ADMIN_EMAIL, ADMIN_PASSWORD_HASH)
           # 2FA wird nach dem Login unter Einstellungen → Benutzer eingerichtet; TOTP_SECRET
           # liest nur der Dev-Seed (prisma/seed.ts) und hat im Betrieb keine Wirkung

# 3. Datenbankdatei ablegen
mkdir -p data
# Bestehende DB kopieren (z.B. per scp vom PC):
# scp customermanagement.db pi@raspberrypi.local:~/customer-management/data/

# 4. Image pullen und starten
docker compose pull
docker compose up -d

# 5. Status prüfen
docker compose ps
docker compose logs -f
```

App erreichbar unter: `http://raspberrypi.local:3000`

---

## 2. Updates einspielen

Wenn du Code änderst und auf `main` pushst, baut GitHub Actions automatisch ein neues Image.

**Auf dem Pi:**

```bash
cd ~/customer-management
docker compose pull          # Neues Image holen
docker compose up -d         # Container neu starten (Downtime < 5 Sek.)
```

### Automatische Updates (optional)

Watchtower prüft stündlich ob ein neues Image vorhanden ist:

```bash
docker run -d \
  --name watchtower \
  --restart unless-stopped \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -e WATCHTOWER_CLEANUP=true \
  -e WATCHTOWER_POLL_INTERVAL=3600 \
  containrrr/watchtower customer-management
```

---

## 3. Daten & Backup

Die App sichert die Datenbank **automatisch jede Nacht um 02:15 Serverzeit** nach `data/backups/db-JJJJ-MM-TT.db` und behält 30 Tage. Die Dateien lassen sich unter *Einstellungen → Logs & Backups* herunterladen.

| Variable | Standard | Bedeutung |
|---|---|---|
| `BACKUP_DIR` | `data/backups` | Zielordner, z. B. ein gemounteter USB-Stick oder NAS |
| `BACKUP_CRON_SCHEDULE` | `15 2 * * *` | Zeitplan (Serverzeit) |
| `BACKUP_KEEP_DAYS` | `30` | Aufbewahrung in Tagen, `0` = alles behalten |
| `DISABLE_BACKUP` | – | `true` schaltet das automatische Backup ab |

**Zeitzone:** Der Container läuft ohne weitere Angabe in UTC, 02:15 ist dann 03:15 (Winter) bzw. 04:15 (Sommer) Schweizer Zeit, und das Datum im Dateinamen ist ein UTC-Datum. Für Schweizer Zeit in der `.env` `TZ=Europe/Zurich` setzen (gilt auch für die Log-Rotation und die täglichen Benachrichtigungen).

Schlägt ein Backup fehl, geht eine Meldung an die Benachrichtigungs-Kanäle aus den Einstellungen (Benachrichtigungs-E-Mail und/oder Telegram).

**Speicherplatz:** Jedes Backup ist eine vollständige Kopie der Datenbank, inklusive Dateianhängen und Logo. 30 Backups brauchen also rund 30-mal die Grösse von `customermanagement.db`. Grösse prüfen (`du -sh data/customermanagement.db data/backups`) und `BACKUP_KEEP_DAYS` bei Bedarf senken.

**Wichtig:** Liegt `data/backups` auf derselben SD-Karte wie die Datenbank, schützt es nicht vor einem Kartendefekt. Deshalb `BACKUP_DIR` auf ein externes Laufwerk legen oder das Verzeichnis regelmässig ausser Haus kopieren, z. B. per Cron:

```bash
# Täglich um 05:00 auf ein NAS spiegeln (nach dem Backup, auch bei UTC im Container)
# 0 5 * * * rsync -a ~/customer-management/data/backups/ nas:/backups/customer-management/
```

**Eigenes `BACKUP_DIR`:** Ein Pfad ausserhalb des gemounteten `data`-Volumes liegt im Dateisystem des Containers und geht beim Neuanlegen des Containers verloren. Den Ordner deshalb in der `docker-compose.yml` unter `volumes:` einbinden und in der `.env` darauf zeigen:

```yaml
    volumes:
      - ./data:/app/data
      - /mnt/usb/cm-backups:/backups
```

```bash
# .env
BACKUP_DIR=/backups
```

Der Ordner muss für den Container-Benutzer (`nextjs`, UID 1001) beschreibbar sein, z. B. `sudo chown 1001:1001 /mnt/usb/cm-backups`.

Ein Backup enthält alle Daten inklusive Passwort-Hashes und SMTP-Zugang. Nur an vertrauenswürdigen Orten ablegen.

### PDF-Archiv

- Versendete Rechnungs- und Mahnungs-PDFs liegen unter `data/archive/<Jahr>/` im Datenvolume (überschreibbar per `ARCHIVE_DIR`); die Prüfsumme (SHA-256) steht in der Datenbank. Offerten werden nicht archiviert.
- Der Ordner gehört zu den aufzubewahrenden Daten: zusammen mit der Datenbanksicherung auch `data/archive/` ausser Haus sichern, z. B. `rsync -a data/archive/ <Ziel>/archive/`. Die Dateien werden nie verändert, ein inkrementelles Kopieren genügt. Die Datenbank-Backups enthalten das Archiv nicht.
- Ist das Archiv nicht beschreibbar (Platte voll, Rechte), versendet die App keine Rechnungen und Mahnungen mehr; die Fehlermeldung erscheint beim Versand.
- Scheitert ein Versand nach dem Archivieren (z. B. SMTP-Fehler), bleibt die Datei ohne Datenbankeintrag liegen. Solche verwaisten Dateien sind harmlos und können bei Bedarf gelöscht werden.

### Wiederherstellen

```bash
cd ~/customer-management
docker compose down
# Kaputte DB beiseitelegen (als Kopie, damit die Originaldatei mit ihren
# Rechten bestehen bleibt und gleich überschrieben werden kann)
cp data/customermanagement.db data/customermanagement.db.defekt
# Alte WAL-Dateien MÜSSEN weg: SQLite würde sie sonst in das
# wiederhergestellte Backup einspielen und es beschädigen
rm -f data/customermanagement.db-wal data/customermanagement.db-shm
cp data/backups/db-2026-09-30.db data/customermanagement.db
docker compose up -d
```

Beim Start spielt die App fehlende Migrationen automatisch ein, ein Backup einer älteren Version lässt sich also direkt verwenden.

Vor dem Einspielen von Migrationen in eine bestehende Datenbank (Update auf eine neue Version) legt die App zusätzlich einen Snapshot `pre-migration-<Migrationsname>.db` im Backup-Ordner ab. Er wird nicht automatisch gelöscht und lässt sich wie ein normales Backup zurückspielen. Schlägt der Snapshot fehl (z. B. Platte voll), startet die App trotzdem und schreibt nur eine Warnung ins Log.

### Manuelles Backup

Bei laufender App **nicht** die DB-Datei mit `cp` kopieren: ohne die `-wal`-Datei ist die Kopie unvollständig oder inkonsistent. Stattdessen:

- in der App unter *Einstellungen → Datenbank exportieren* (konsistenter Snapshot, gleiche Technik wie das nächtliche Backup), oder
- mit gestoppter App kopieren:

```bash
docker compose down
cp ~/customer-management/data/customermanagement.db \
   ~/customer-management/data/backup-$(date +%Y%m%d-%H%M).db
docker compose up -d
```

---

## 4. Troubleshooting

```bash
# Logs anzeigen
docker compose logs -f

# Container-Shell öffnen
docker compose exec app sh

# Neu starten
docker compose restart

# Komplett neu (bei Problemen)
docker compose down && docker compose pull && docker compose up -d
```

---

## Versionierung

GitHub Actions taggt jedes Image mit:

- `latest` → immer der neueste Stand von `main`
- `<commit-sha>` → für Rollback zu einem bestimmten Stand

**Rollback auf einen alten Stand:**

```bash
# Commit-SHA aus GitHub Actions Logs / GitHub → Packages herauslesen
docker compose down
docker pull ghcr.io/sirtheta/customer-management:<sha>
# docker-compose.yml: image-Tag auf :<sha> ändern
docker compose up -d
```
