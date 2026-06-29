#!/usr/bin/env bash
# =============================================================================
# Golden CRM — Docker Deploy
# Run from the repo root: bash scripts/docker-deploy.sh
# =============================================================================

set -euo pipefail

COMPOSE="docker compose"
HEALTH_URL="http://localhost:3000/api/health"
MAX_RETRIES=20
SLEEP_SECONDS=3

log() { echo "[docker-deploy] $*"; }
err() { echo "[docker-deploy] ERROR: $*" >&2; exit 1; }

[[ -f ".env" ]] || err "Missing .env — copy .env.example and fill in the values."

# Verify proxy-net exists (created by nginx-server)
docker network inspect proxy-net >/dev/null 2>&1 || \
  err "proxy-net network not found. Start nginx-server first: cd /opt/nginx-server && docker compose up -d"

# 1. Build the image
log "Building Docker image..."
$COMPOSE build --pull

# 2. Start the database and wait for its healthcheck
log "Starting database..."
$COMPOSE up -d db

log "Waiting for database to be healthy (up to 60s)..."
for i in $(seq 1 30); do
  if $COMPOSE ps db 2>/dev/null | grep -q "(healthy)"; then
    log "Database is healthy."
    break
  fi
  if [[ $i -eq 30 ]]; then
    err "Database did not become healthy in time. Check: docker compose logs db"
  fi
  sleep 2
done

# 3. Run migrations
log "Running database migrations..."
$COMPOSE run --rm --no-deps \
  -e NODE_ENV=production \
  app \
  node ./node_modules/tsx/dist/cli.mjs packages/api/migrate.ts

# 4. Start the app
log "Starting application..."
$COMPOSE up -d app

# 5. Health check directly on the container
log "Running health check..."
for i in $(seq 1 "$MAX_RETRIES"); do
  if docker exec golden-crm-app wget -qO- http://localhost:3000/api/health >/dev/null 2>&1; then
    log "================================================"
    log "Deploy completed successfully."
    log "golden-crm-app is live on proxy-net → nginx-server"
    log "================================================"
    exit 0
  fi
  log "Not ready yet (attempt $i/$MAX_RETRIES), waiting ${SLEEP_SECONDS}s..."
  sleep "$SLEEP_SECONDS"
done

err "Health check failed. Check: docker compose logs app"
