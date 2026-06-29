#!/usr/bin/env bash
# =============================================================================
# Golden CRM — Docker Deploy
#
# Run from the repo root:
#   bash scripts/docker-deploy.sh
#
# Requirements on the server:
#   - docker + docker compose v2
#   - .env file filled (copy from .env.example)
#   - shared nginx-server configured to proxy to localhost:APP_PORT
# =============================================================================

set -euo pipefail

COMPOSE="docker compose"
APP_PORT="${APP_PORT:-3880}"
HEALTH_URL="http://localhost:${APP_PORT}/api/health"
MAX_RETRIES=20
SLEEP_SECONDS=3

log() { echo "[docker-deploy] $*"; }
err() { echo "[docker-deploy] ERROR: $*" >&2; exit 1; }

[[ -f ".env" ]] || err "Missing .env — copy .env.example and fill in the values."

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

# 3. Run migrations inside the app container (--no-deps: db is already up)
log "Running database migrations..."
$COMPOSE run --rm --no-deps \
  -e NODE_ENV=production \
  app \
  node ./node_modules/tsx/dist/cli.mjs packages/api/migrate.ts

# 4. Start the app
log "Starting application..."
$COMPOSE up -d app

# 5. Health check on the exposed host port
log "Running health check on ${HEALTH_URL}..."
for i in $(seq 1 "$MAX_RETRIES"); do
  if curl -sf "$HEALTH_URL" >/dev/null 2>&1; then
    log "================================================"
    log "Deploy completed successfully."
    log "App is running on host port ${APP_PORT}."
    log "Add this to your nginx-server config:"
    log "  proxy_pass http://localhost:${APP_PORT};"
    log "================================================"
    exit 0
  fi
  log "Not ready yet (attempt $i/$MAX_RETRIES), waiting ${SLEEP_SECONDS}s..."
  sleep "$SLEEP_SECONDS"
done

err "Health check failed after ${MAX_RETRIES} attempts. Check: docker compose logs app"
