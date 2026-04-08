# Golden CRM — Server Deployment Guide

## Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 22 + tsx (TypeScript runner) |
| Process manager | PM2 6.x |
| Reverse proxy | Nginx |
| App port | 3000 (Express — serves API + built frontend) |

---

## Server Paths

| Purpose | Path |
|---------|------|
| App root | `/opt/golden-crm/app/GoldenGroup2` |
| Production env | `/etc/golden-crm/production.env` |
| Uploads storage | `/var/lib/golden-crm/uploads` |
| PM2 logs | `/var/log/golden-crm/` |
| Nginx site config | `/etc/nginx/sites-available/golden-crm` |

---

## Required Environment Variables

Edit `/etc/golden-crm/production.env` before first start:

```env
NODE_ENV=production
PORT=3000
DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/DB_NAME
JWT_SECRET=<long-random-secret>
CORS_ORIGINS=https://your-domain.com
UPLOADS_DIR=/var/lib/golden-crm/uploads
ALLOW_PROD_MIGRATE=0
```

Permissions must be `600` owned by root:

```bash
chmod 600 /etc/golden-crm/production.env
chown root:root /etc/golden-crm/production.env
```

---

## Pre-flight: Build the Frontend

The Express server serves the built frontend from `packages/web/dist`.
Run this after every code update:

```bash
cd /opt/golden-crm/app/GoldenGroup2
pnpm install
pnpm build
```

---

## PM2 — Start / Restart

### First start (or after ecosystem config change)

```bash
cd /opt/golden-crm/app/GoldenGroup2

# Remove any stale PM2 entry
pm2 delete golden-crm || true

# Start using ecosystem config (loads /etc/golden-crm/production.env)
pm2 start ecosystem.config.cjs

# Persist across reboots
pm2 save
pm2 startup   # follow the printed systemd command
```

### Reload after a code/config update (zero-downtime)

```bash
pm2 reload golden-crm
```

### Hard restart

```bash
pm2 restart golden-crm
```

### Alternative: explicit start without ecosystem file

If the ecosystem config is suspected to be the problem, this command exactly
mirrors the working manual invocation:

```bash
NODE_ENV=production \
  $(grep -v '^#' /etc/golden-crm/production.env | xargs) \
  pm2 start ./node_modules/tsx/dist/cli.mjs \
    --name golden-crm \
    --interpreter node \
    -- ./packages/api/index.ts
```

---

## Health Check

```bash
# Direct to Express
curl http://127.0.0.1:3000/api/health
# Expected: {"status":"ok"}

# Through Nginx
curl http://127.0.0.1/api/health
```

---

## PM2 Status & Logs

```bash
pm2 status
pm2 logs golden-crm --lines 50
# or from log files:
tail -f /var/log/golden-crm/out.log
tail -f /var/log/golden-crm/error.log
```

---

## Nginx

Site config lives at `/etc/nginx/sites-available/golden-crm`
and is symlinked to `/etc/nginx/sites-enabled/golden-crm`.

Nginx proxies **all** traffic to Express on port 3000.
Express is responsible for both the API and the built frontend —
Nginx does **not** serve static files directly.

### Test and reload Nginx

```bash
nginx -t
systemctl reload nginx
```

### Create/update the symlink

```bash
ln -sf /etc/nginx/sites-available/golden-crm \
        /etc/nginx/sites-enabled/golden-crm
```

---

## Rollback

```bash
cd /opt/golden-crm/app/GoldenGroup2

# 1. Reset to the previous commit
git log --oneline -5        # find the good commit hash
git reset --hard <hash>

# 2. Reinstall and rebuild
pnpm install
pnpm build

# 3. Restart
pm2 restart golden-crm

# 4. Verify
curl http://127.0.0.1:3000/api/health
```

---

## Full Validation Checklist

Run these in order on the server after any deployment:

```bash
cd /opt/golden-crm/app/GoldenGroup2

# 1. Dependencies
pnpm install

# 2. Type-check
pnpm typecheck
pnpm typecheck:api

# 3. Frontend build
pnpm build

# 4. Manual runtime check (Ctrl-C to stop)
node ./node_modules/tsx/dist/cli.mjs ./packages/api/index.ts

# 5. PM2
pm2 delete golden-crm || true
pm2 start ecosystem.config.cjs
pm2 status
pm2 logs golden-crm --lines 50

# 6. Health check
curl http://127.0.0.1:3000/api/health
# Expected: {"status":"ok"}

# 7. Nginx
nginx -t
systemctl reload nginx
curl http://127.0.0.1/api/health
# Expected: {"status":"ok"}
```
