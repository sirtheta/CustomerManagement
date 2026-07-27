#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WEB_DIR="$(dirname "$SCRIPT_DIR")"
COMPOSE_FILE="$WEB_DIR/docker-compose.test.yml"
DATA_DIR="$WEB_DIR/data-test"

echo "[reset] $(date): Starte nächtliches Reset der Test-Umgebung..."

echo "[reset] Stoppe Test-Container..."
docker compose -f "$COMPOSE_FILE" down

echo "[reset] Lösche Datenbank..."
rm -f "$DATA_DIR/customermanagement.db"

echo "[reset] Starte Test-Container neu..."
docker compose -f "$COMPOSE_FILE" up -d

echo "[reset] Warte auf Start (40s)..."
sleep 40

echo "[reset] Seede Datenbank..."
docker exec customer-management-test npx prisma db seed

echo "[reset] Fertig: $(date)"
