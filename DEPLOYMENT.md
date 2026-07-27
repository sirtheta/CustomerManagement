# Deployment auf Raspberry Pi 5

## Ablauf

```text
Entwicklung (PC)  →  git push  →  GitHub Actions baut ARM64-Image
                                          ↓
Raspberry Pi 5  →  docker compose pull  →  docker compose up -d
```

---

## 1. Einmalige Einrichtung

### GitHub Container Registry freischalten

Das Image auf **ghcr.io** ist standardmässig privat. Damit der Pi pullen kann:

**Variante A — Image öffentlich machen (einfach):**

1. GitHub → Repo → Packages → `customer-management`
2. Package Settings → "Change visibility" → Public

**Variante B — Privat lassen + Token auf Pi:**

```bash
# Auf GitHub: Settings → Developer Settings → Personal Access Tokens → Fine-grained
# Berechtigung: read:packages
# Token auf dem Pi speichern:
echo "dein-github-token" | docker login ghcr.io -u sirtheta --password-stdin
```

### Auf dem Pi einrichten

```bash
# 1. Nur die Docker-Dateien klonen (kein ganzes Repo nötig)
mkdir -p ~/customer-management
cd ~/customer-management

# docker-compose.yml und .env.example vom Repo holen:
curl -O https://raw.githubusercontent.com/sirtheta/CustomerManagement/main/CustomerManagement.web/docker-compose.yml
curl -O https://raw.githubusercontent.com/sirtheta/CustomerManagement/main/CustomerManagement.web/.env.example

# 2. Umgebungsvariablen konfigurieren
cp .env.example .env
nano .env  # Werte setzen (AUTH_SECRET, ADMIN_PASSWORD_HASH, TOTP_SECRET, AUTH_URL)

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

```bash
# SQLite-Backup
cp ~/customer-management/data/customermanagement.db \
   ~/customer-management/data/backup-$(date +%Y%m%d-%H%M).db

# Oder per Cron täglich sichern:
# 0 2 * * * cp ~/customer-management/data/customermanagement.db ~/backups/cm-$(date +\%Y\%m\%d).db
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
