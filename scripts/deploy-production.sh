#!/usr/bin/env bash
# =============================================================================
# Golden CRM - Production Deploy
# Run with:
#   bash /opt/golden-crm/app/GoldenGroup2/scripts/deploy-production.sh
#
# Target:
#   127.0.0.1:3000
#
# Notes:
# - Uses production env file only
# - Keeps migrations manual for safety
# - Safe for repeated deploys
# =============================================================================

set -euo pipefail

REPO_DIR="/opt/golden-crm/app/GoldenGroup2"
ENV_FILE="/etc/golden-crm/production.env"
APP_NAME="golden-crm"
PORT=3000
HEALTH_URL="http://127.0.0.1:${PORT}/api/health"

log() { echo "[production-deploy] $*"; }
err() { echo "[production-deploy] ERROR: $*" >&2; exit 1; }

# 0. Basic prerequisites
[[ -d "$REPO_DIR" ]] || err "Missing repo directory: $REPO_DIR"
[[ -f "$ENV_FILE" ]] || err "Missing env file: $ENV_FILE"

command -v git  >/dev/null 2>&1 || err "git is not available in PATH"
command -v pnpm >/dev/null 2>&1 || err "pnpm is not available in PATH"
command -v pm2  >/dev/null 2>&1 || err "pm2 is not available in PATH"
command -v curl >/dev/null 2>&1 || err "curl is not available in PATH"

cd "$REPO_DIR"

# 1. Fetch latest changes
log "Fetching from origin..."
git fetch origin

# 2. Checkout main explicitly
TARGET_BRANCH="main"
log "Using branch: origin/$TARGET_BRANCH"
git checkout -B "$TARGET_BRANCH" "origin/$TARGET_BRANCH"

# 3. Remove local env files immediately after checkout
log "Removing local .env files..."
rm -f .env .env.development .env.production .env.local

# 4. Load production environment variables
log "Loading environment from $ENV_FILE ..."
set -a
# shellcheck source=/dev/null
source "$ENV_FILE"
set +a

# 5. Install dependencies
log "Installing dependencies..."
pnpm install --frozen-lockfile

# 6. Build the application
log "Building application..."
pnpm build

# 7. Migrations are intentionally manual on production
log "Skipping automatic migrations on production."
log "If a migration is required, run it manually after verification."

# 8. Restart PM2 app
log "Restarting PM2 app: $APP_NAME ..."
pm2 restart "$APP_NAME"
pm2 save

# 9. Health check with retries
log "Running health check..."
MAX_RETRIES=15
SLEEP_SECONDS=2

for i in $(seq 1 "$MAX_RETRIES"); do
  if curl -sf "$HEALTH_URL" >/dev/null; then
    log "Health check passed on attempt $i."
    log "================================================"
    log "Production deploy completed successfully."
    log "Application is running at: http://127.0.0.1:${PORT}"
    log "Health endpoint: $HEALTH_URL"
    log "================================================"
    exit 0
  fi

  log "Health check not ready yet (attempt $i/$MAX_RETRIES), waiting ${SLEEP_SECONDS}s..."
  sleep "$SLEEP_SECONDS"
done

err "Health check failed after ${MAX_RETRIES} attempts on port $PORT"