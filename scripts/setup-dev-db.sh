#!/usr/bin/env bash
# =============================================================================
# Golden CRM — Dev Database Setup Script
# =============================================================================
# يُنشئ هذا السكريبت قاعدة بيانات تطوير منفصلة تماماً عن الإنتاج،
# ويُطبّق عليها جميع ملفات الـ migrations تلقائياً.
#
# التشغيل (على السيرفر كـ root أو postgres):
#   chmod +x scripts/setup-dev-db.sh
#   sudo -u postgres bash scripts/setup-dev-db.sh
# =============================================================================

set -euo pipefail

# ─── إعدادات قابلة للتعديل ────────────────────────────────────────────────
DEV_DB_NAME="golden_crm_dev"
DEV_DB_USER="crm_dev_user"
DEV_DB_PASS="${DEV_DB_PASS:-}"          # يُمرَّر كمتغير بيئة، أو يُطلب تفاعلياً
DEV_DB_HOST="localhost"
DEV_DB_PORT="5432"
MIGRATIONS_DIR="$(cd "$(dirname "$0")/.." && pwd)/migrations"
# ──────────────────────────────────────────────────────────────────────────────

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'

log()  { echo -e "${GREEN}[✓]${NC} $*"; }
warn() { echo -e "${YELLOW}[!]${NC} $*"; }
err()  { echo -e "${RED}[✗]${NC} $*" >&2; exit 1; }

echo ""
echo "════════════════════════════════════════════════"
echo "   Golden CRM — Dev Database Setup"
echo "════════════════════════════════════════════════"
echo ""

# ─── التحقق من وجود psql ─────────────────────────────────────────────────
command -v psql &>/dev/null || err "psql غير موجود. ثبّت PostgreSQL أولاً."

# ─── طلب كلمة المرور إن لم تُمرَّر ──────────────────────────────────────
if [[ -z "$DEV_DB_PASS" ]]; then
  read -rsp "أدخل كلمة مرور جديدة للمستخدم '$DEV_DB_USER': " DEV_DB_PASS
  echo ""
  read -rsp "أعد كتابة كلمة المرور: " DEV_DB_PASS_CONFIRM
  echo ""
  [[ "$DEV_DB_PASS" == "$DEV_DB_PASS_CONFIRM" ]] || err "كلمتا المرور غير متطابقتين."
fi

[[ -n "$DEV_DB_PASS" ]] || err "كلمة المرور لا يمكن أن تكون فارغة."

# ─── إنشاء المستخدم ───────────────────────────────────────────────────────
echo ""
echo "--- 1/4: إنشاء مستخدم قاعدة البيانات '$DEV_DB_USER' ---"
if psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='$DEV_DB_USER'" | grep -q 1; then
  warn "المستخدم '$DEV_DB_USER' موجود مسبقاً — تحديث كلمة المرور فقط."
  psql -c "ALTER USER $DEV_DB_USER WITH PASSWORD '$DEV_DB_PASS';"
else
  psql -c "CREATE USER $DEV_DB_USER WITH PASSWORD '$DEV_DB_PASS' NOSUPERUSER NOCREATEDB NOCREATEROLE;"
  log "تم إنشاء المستخدم '$DEV_DB_USER'."
fi

# ─── إنشاء قاعدة البيانات ─────────────────────────────────────────────────
echo ""
echo "--- 2/4: إنشاء قاعدة البيانات '$DEV_DB_NAME' ---"
if psql -tAc "SELECT 1 FROM pg_database WHERE datname='$DEV_DB_NAME'" | grep -q 1; then
  warn "قاعدة البيانات '$DEV_DB_NAME' موجودة مسبقاً."
else
  psql -c "CREATE DATABASE $DEV_DB_NAME OWNER $DEV_DB_USER ENCODING 'UTF8' LC_COLLATE 'en_US.UTF-8' LC_CTYPE 'en_US.UTF-8' TEMPLATE template0;"
  log "تم إنشاء قاعدة البيانات '$DEV_DB_NAME'."
fi

# ─── منح الصلاحيات ────────────────────────────────────────────────────────
echo ""
echo "--- 3/4: منح الصلاحيات ---"
psql -d "$DEV_DB_NAME" -c "GRANT ALL PRIVILEGES ON DATABASE $DEV_DB_NAME TO $DEV_DB_USER;"
psql -d "$DEV_DB_NAME" -c "GRANT ALL ON SCHEMA public TO $DEV_DB_USER;"
psql -d "$DEV_DB_NAME" -c "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO $DEV_DB_USER;"
psql -d "$DEV_DB_NAME" -c "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO $DEV_DB_USER;"
log "تم منح الصلاحيات."

# ─── تطبيق الـ Migrations ─────────────────────────────────────────────────
echo ""
echo "--- 4/4: تطبيق ملفات الـ Migrations ---"

export PGPASSWORD="$DEV_DB_PASS"

psql -h "$DEV_DB_HOST" -p "$DEV_DB_PORT" -U "$DEV_DB_USER" -d "$DEV_DB_NAME" -c "
  CREATE TABLE IF NOT EXISTS schema_migrations (
    id         SERIAL PRIMARY KEY,
    filename   VARCHAR(255) NOT NULL UNIQUE,
    applied_at TIMESTAMPTZ DEFAULT NOW()
  );
" &>/dev/null

SQL_FILES=$(find "$MIGRATIONS_DIR" -name '*.sql' | sort)

if [[ -z "$SQL_FILES" ]]; then
  warn "لم يُعثر على ملفات migration في $MIGRATIONS_DIR"
else
  for f in $SQL_FILES; do
    fname=$(basename "$f")
    already=$(psql -h "$DEV_DB_HOST" -p "$DEV_DB_PORT" -U "$DEV_DB_USER" -d "$DEV_DB_NAME" \
      -tAc "SELECT 1 FROM schema_migrations WHERE filename='$fname'" 2>/dev/null || true)
    if [[ "$already" == "1" ]]; then
      echo "  ✓ $fname (مُطبَّق مسبقاً)"
    else
      echo -n "  ○ $fname ... "
      psql -h "$DEV_DB_HOST" -p "$DEV_DB_PORT" -U "$DEV_DB_USER" -d "$DEV_DB_NAME" \
        -v ON_ERROR_STOP=1 -f "$f" &>/dev/null
      psql -h "$DEV_DB_HOST" -p "$DEV_DB_PORT" -U "$DEV_DB_USER" -d "$DEV_DB_NAME" \
        -c "INSERT INTO schema_migrations (filename) VALUES ('$fname');" &>/dev/null
      echo "✓"
    fi
  done
fi

unset PGPASSWORD

# ─── ملخص ─────────────────────────────────────────────────────────────────
echo ""
echo "════════════════════════════════════════════════"
echo "   تم الإعداد بنجاح!"
echo "════════════════════════════════════════════════"
echo ""
echo "  قاعدة البيانات : $DEV_DB_NAME"
echo "  المستخدم       : $DEV_DB_USER"
echo "  المضيف          : $DEV_DB_HOST:$DEV_DB_PORT"
echo ""
echo "  Connection String:"
echo "  postgresql://$DEV_DB_USER:<PASSWORD>@$DEV_DB_HOST:$DEV_DB_PORT/$DEV_DB_NAME"
echo ""
echo "  ⚠  أضف هذا السطر إلى ملف .env.development على جهازك:"
echo "  DATABASE_URL=postgresql://$DEV_DB_USER:<PASSWORD>@<SERVER_IP>:$DEV_DB_PORT/$DEV_DB_NAME"
echo ""
