# Golden CRM — Post-Deploy Operations Guide

> This document covers the tasks that come **after** the initial deployment is confirmed
> working. For first-time setup, see [SERVER-DEPLOY.md](./SERVER-DEPLOY.md).

---

## Current Confirmed State (as of 2026-04-08)

- PM2 process `golden-crm` is online.
- Nginx is reverse-proxying to Express on port 3000.
- Health endpoint responds: `GET /api/health → {"status":"ok"}`.
- Production secrets live at `/etc/golden-crm/production.env` (outside the repo).
- Uploads land at `/opt/golden-crm/app/GoldenGroup2/uploads/` (repo root — see note below).

---

## IMMEDIATE — Do Before End of Day

### 1. Rotate / Clear the `.env` in the Repo Directory  ⚠️ CRITICAL

**Why:** `/opt/golden-crm/app/GoldenGroup2/.env` contains a real database password.
The file is gitignored but sits on the server filesystem and is read by the production
process on every startup (via `packages/api/config/env.ts` which loads `.env` in
production mode). PM2's `env_file` vars take precedence over dotenv when both are set,
but the password is still readable on disk by anyone with filesystem access.

```bash
# Confirm the file exists and what it contains (read-only check):
cat /opt/golden-crm/app/GoldenGroup2/.env

# Replace its contents with non-secret placeholders only:
cat > /opt/golden-crm/app/GoldenGroup2/.env << 'EOF'
# This file is intentionally cleared on the server.
# Real credentials are in /etc/golden-crm/production.env — loaded by PM2.
# Do not put real secrets here.
DATABASE_URL=
JWT_SECRET=
NODE_ENV=production
EOF

# If the database password was also used elsewhere, rotate it in PostgreSQL
# and update /etc/golden-crm/production.env accordingly.
```

### 2. Verify JWT_SECRET Is Set and Strong  ⚠️ CRITICAL

**Why:** `packages/api/config/env.ts` line 22 falls back to a hardcoded dev secret
(`golden-crm-dev-secret-2026`) if `JWT_SECRET` is not set. Any token signed with the
fallback secret can be forged by anyone who reads the source code.

```bash
# Confirm the variable is set in production.env:
grep JWT_SECRET /etc/golden-crm/production.env

# It must be a long random string (≥ 64 chars), NOT the placeholder
# "your_super_secret_key_here". Generate one if needed:
openssl rand -base64 64

# After updating production.env, reload the process:
pm2 reload golden-crm
curl http://127.0.0.1:3000/api/health
```

### 3. Verify PM2 Survives Reboots

**Why:** If `pm2 startup` was never run, a server reboot kills the process permanently.

```bash
# Check if a PM2 systemd unit exists:
systemctl status pm2-root   # or pm2-<your-user>

# If the service is missing, create it:
pm2 startup                 # prints a command — run the printed command
pm2 save                    # saves current process list

# Test: simulate reboot (safe dry-run)
pm2 kill
pm2 resurrect
pm2 status                  # golden-crm should be back online
```

### 4. Confirm Actual Uploads Location

**Why:** `SERVER-DEPLOY.md` documents uploads at `/var/lib/golden-crm/uploads`, but
`packages/api/storage/uploader.ts` hardcodes the path to the repo root's `uploads/`
directory. Know where files actually live before planning backups.

```bash
# Check where uploads are landing right now:
ls -la /opt/golden-crm/app/GoldenGroup2/uploads/
ls -la /var/lib/golden-crm/uploads/ 2>/dev/null || echo "path does not exist"

# Confirm which path has real user files (larger size, recent mtime).
# Use that path as your backup target.
```

---

## THIS WEEK

### 5. Enable HTTPS via Let's Encrypt

**Why:** HTTP exposes session tokens and credentials in transit. Most browsers warn on
HTTP. CORS preflight and cookie `Secure` flags require HTTPS.

```bash
# Install certbot if not present:
apt install -y certbot python3-certbot-nginx

# Obtain a certificate for your domain:
certbot --nginx -d your-domain.com

# Certbot will modify the Nginx config automatically and add auto-renewal.
# Verify renewal is scheduled:
systemctl status certbot.timer
# or:
certbot renew --dry-run

# After HTTPS is live, update CORS_ORIGINS in /etc/golden-crm/production.env:
# CORS_ORIGINS=https://your-domain.com
# Then reload:
pm2 reload golden-crm
```

### 6. Restrict CORS to Production Domain

**Why:** `app.use(cors())` with no options allows requests from any origin. This should
be locked to the actual production domain once HTTPS is live.

The app already reads `CORS_ORIGINS` from env (it appears in `.env.example`). Verify
that `CORS_ORIGINS` is set in `/etc/golden-crm/production.env` and that the app actually
uses it in CORS middleware — if it does not yet, note it as a future hardening item.

```bash
grep CORS_ORIGINS /etc/golden-crm/production.env
```

### 7. Set Up Log Rotation

**Why:** PM2 writes to `/var/log/golden-crm/out.log` and `error.log` indefinitely.
Without rotation these files grow until disk is full, which kills the process.

Create `/etc/logrotate.d/golden-crm`:

```
/var/log/golden-crm/*.log {
    daily
    missingok
    rotate 14
    compress
    delaycompress
    notifempty
    copytruncate
}
```

```bash
# Write the config:
cat > /etc/logrotate.d/golden-crm << 'EOF'
/var/log/golden-crm/*.log {
    daily
    missingok
    rotate 14
    compress
    delaycompress
    notifempty
    copytruncate
}
EOF

# Test it immediately:
logrotate -d /etc/logrotate.d/golden-crm   # dry run
logrotate -f /etc/logrotate.d/golden-crm   # force rotate once to confirm

# Verify log dir after:
ls -lh /var/log/golden-crm/
```

### 8. Set Up Database Backups

**Why:** PostgreSQL data is the hardest thing to recover. A single `pg_dump` cron is
the minimum viable backup strategy.

```bash
# Create backup dir:
mkdir -p /var/backups/golden-crm
chmod 700 /var/backups/golden-crm

# Test a manual dump first (replace with your real DB connection values):
pg_dump "$(grep DATABASE_URL /etc/golden-crm/production.env | cut -d= -f2-)" \
  -Fc -f /var/backups/golden-crm/manual-test.dump

ls -lh /var/backups/golden-crm/

# Add a daily cron (as root):
crontab -e
# Add this line — runs at 02:00 daily, keeps 14 dumps:
# 0 2 * * * pg_dump "$(grep DATABASE_URL /etc/golden-crm/production.env | cut -d= -f2-)" -Fc -f /var/backups/golden-crm/$(date +\%Y\%m\%d).dump && find /var/backups/golden-crm -name "*.dump" -mtime +14 -delete
```

### 9. Back Up the Uploads Directory

**Why:** User-uploaded files (photos, CVs, documents) are not in the database and not in
Git. Losing this directory means losing all uploaded user content with no recovery path.

```bash
# Create backup dir:
mkdir -p /var/backups/golden-crm-uploads

# Identify real uploads path first (see task 4 above), then:
# Example for repo-root uploads:
rsync -a --delete \
  /opt/golden-crm/app/GoldenGroup2/uploads/ \
  /var/backups/golden-crm-uploads/

# Schedule as a daily cron (adjust path to actual uploads location):
# 30 2 * * * rsync -a --delete /opt/golden-crm/app/GoldenGroup2/uploads/ /var/backups/golden-crm-uploads/
```

### 10. Verify No Secrets in Git History

**Why:** Even if files are gitignored now, they may have been committed in the past.

```bash
cd /opt/golden-crm/app/GoldenGroup2

# Check if any env files were ever committed:
git log --all --oneline -- .env
git log --all --oneline -- .env.development
git log --all --oneline -- production.env
git log --all --oneline -- "*.pem" "*.key"

# Scan for common secret patterns across all commits (grep-based):
git log --all -p | grep -E "(DATABASE_URL|JWT_SECRET|PASSWORD|SECRET)" | head -40

# If any secrets are found in history, rotate all affected credentials
# and consider using git-filter-repo to scrub history (only if the repo
# is not yet shared broadly, as history rewrite affects all clones).
```

---

## LATER (Next Sprint or When Appropriate)

### 11. Add memory limit to PM2

**Why:** A memory leak in the app will consume RAM until the OS OOM-kills the process.
PM2 can restart before that happens.

In `ecosystem.config.cjs`, add under the app entry:
```js
max_memory_restart: '500M',
```
Then: `pm2 reload golden-crm`

### 12. Set Up External Health Monitoring

**Why:** PM2 autorestart handles crashes locally, but does not alert you. An external
check detects Nginx/DNS/network-level failures that PM2 cannot see.

Options:
- [UptimeRobot](https://uptimerobot.com) — free tier, pings `/api/health` every 5 min.
- [Better Uptime](https://betteruptime.com) — includes on-call alerts.

Monitor URL: `https://your-domain.com/api/health`  
Expected response: `{"status":"ok"}`

### 13. Remove JWT_SECRET Fallback from env.ts

**Why:** `packages/api/config/env.ts` line 22 falls back to a hardcoded dev secret.
This should eventually be removed so a missing `JWT_SECRET` causes a hard startup
failure rather than silently using a known secret.

This is a small, safe one-line change — but schedule it with a code review cycle,
not as an emergency hotfix, since it changes startup behavior.

### 14. Restrict Uploads Directory Permissions

**Why:** The uploads directory is served publicly via `/uploads`. Ensure the directory
is not world-writable and only the Node.js process user can write to it.

```bash
# Check current permissions:
ls -la /opt/golden-crm/app/GoldenGroup2/uploads/

# Tighten if needed (adjust user to match the PM2 process user):
chown -R www-data:www-data /opt/golden-crm/app/GoldenGroup2/uploads/
chmod -R 755 /opt/golden-crm/app/GoldenGroup2/uploads/
```

---

## Rollback Procedure (Reference)

```bash
cd /opt/golden-crm/app/GoldenGroup2

# 1. Find the last known-good commit:
git log --oneline -10

# 2. Reset to it:
git reset --hard <commit-hash>

# 3. Rebuild:
pnpm install && pnpm build

# 4. Restart and verify:
pm2 restart golden-crm
curl http://127.0.0.1:3000/api/health
```

---

## Quick Health Verification (Run Anytime)

```bash
# Process status:
pm2 status

# Live logs (last 50 lines):
pm2 logs golden-crm --lines 50

# Direct health check:
curl -s http://127.0.0.1:3000/api/health

# Through Nginx:
curl -s http://127.0.0.1/api/health

# Disk space:
df -h /var/log /opt /var/backups

# Check log file sizes:
ls -lh /var/log/golden-crm/

# Verify secrets file is locked down:
ls -la /etc/golden-crm/production.env
# Expected: -rw------- root root
```
