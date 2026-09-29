# TASK PART B: حذف جداول `marketing_visits` من DB + Verification النهائي

> السياق: جزء A خلص (permissions + code deleted). هلأ بدنا نحذف الجداول legacy من DB ونتأكد إن كلشي ناجح.
> الخطورة: عالية جداً — أي خطأ هون بيضيع بيانات.
> القاعدة: verify قبل حذف، backup قبل حذف، verify بعد حذف.

---

## المرحلة 9: حذف الجداول Legacy من DB

### 9.0 MANDATORY — Pre-flight checks (لازم تتنفذ قبل أي حذف)

**Check 1: Confirm Part A completed successfully**
```bash
cd /opt/golden-crm/apps/staging

# No references in code:
grep -r "marketing_visits\|marketingVisit\|MarketingVisit" packages/api/ packages/web/ packages/shared/ --include="*.ts" --include="*.tsx" | grep -v "node_modules" | grep -v ".hermes"
# Expected: 0 results (or only in migration/backup files)
```

**Check 2: Confirm bridge data exists**
```bash
# Connect to DB:
psql "postgresql://golden_crm_staging:ASMA2026@localhost:5432/golden_crm_staging" -c "
SELECT 
  (SELECT COUNT(*) FROM marketing_visits) as mv_count,
  (SELECT COUNT(*) FROM field_visits WHERE source_legacy_type = 'marketing_visit') as fv_bridge_count,
  (SELECT COUNT(*) FROM marketing_visit_tasks) as mvt_count,
  (SELECT COUNT(*) FROM visit_tasks WHERE source_legacy_type = 'marketing_visit_task') as vt_bridge_count;
"
```

**Expected:**
- `mv_count` = 0 (if test data was cleaned) OR some number (if real data exists)
- `fv_bridge_count` ≥ `mv_count` (all marketing visits have bridge records)
- `mvt_count` = 0 OR some number
- `vt_bridge_count` ≥ `mvt_count` (all marketing tasks have bridge records)

> **If `fv_bridge_count` < `mv_count` → STOP.** Do NOT proceed. Data loss risk.

**Check 3: Backup**
```bash
# Full DB backup:
pg_dump "postgresql://golden_crm_staging:ASMA2026@localhost:5432/golden_crm_staging" > /tmp/golden_crm_staging_full_backup_$(date +%F_%H-%M).sql

# Legacy tables only:
pg_dump "postgresql://golden_crm_staging:ASMA2026@localhost:5432/golden_crm_staging" \
  --table=marketing_visits \
  --table=marketing_visit_tasks \
  --table=marketing_visit_task_offers \
  > /tmp/marketing_visits_backup_$(date +%F_%H-%M).sql
```

**Check 4: Server stopped (or in maintenance mode)**
```bash
# Option 1: Stop server during migration
pm2 stop golden-crm-staging

# Option 2: Or just ensure no one is creating new marketing visits during migration
```

### 9.1 Migration SQL

**الملف:** `migrations/XXX_drop_marketing_visits_legacy.sql`

```sql
-- ============================================================
-- Migration XXX: Drop marketing_visits legacy tables
-- Prerequisites (ALL must pass):
--   1. Code fully migrated (no references to marketing_visits)
--   2. Bridge data exists in field_visits / visit_tasks
--   3. Full DB backup taken
--   4. Server in maintenance mode or stopped
-- ============================================================

-- Step 1: Verify bridge data (defensive check)
DO $$
DECLARE
  mv_count INT;
  fv_count INT;
  mvt_count INT;
  vt_count INT;
BEGIN
  SELECT COUNT(*) INTO mv_count FROM marketing_visits;
  SELECT COUNT(*) INTO fv_count FROM field_visits WHERE source_legacy_type = 'marketing_visit';
  SELECT COUNT(*) INTO mvt_count FROM marketing_visit_tasks;
  SELECT COUNT(*) INTO vt_count FROM visit_tasks WHERE source_legacy_type = 'marketing_visit_task';
  
  -- If there are marketing visits but no bridge, abort
  IF mv_count > 0 AND fv_count < mv_count THEN
    RAISE EXCEPTION 'ABORT: % marketing_visits found but only % bridge records in field_visits. Run bridge backfill first.', mv_count, fv_count;
  END IF;
  
  IF mvt_count > 0 AND vt_count < mvt_count THEN
    RAISE EXCEPTION 'ABORT: % marketing_visit_tasks found but only % bridge records in visit_tasks. Run bridge backfill first.', mvt_count, vt_count;
  END IF;
END $$;

-- Step 2: Drop child tables first
DROP TABLE IF EXISTS marketing_visit_task_offers CASCADE;

-- Step 3: Drop middle tables
DROP TABLE IF EXISTS marketing_visit_tasks CASCADE;

-- Step 4: Drop parent table
DROP TABLE IF EXISTS marketing_visits CASCADE;

-- Step 5: Drop legacy functions (if any exist)
DROP FUNCTION IF EXISTS sync_marketing_visit_to_field_visit() CASCADE;
DROP FUNCTION IF EXISTS apply_marketing_visit_result() CASCADE;

-- Step 6: Log migration
INSERT INTO schema_migrations (version) VALUES (XXX) ON CONFLICT DO NOTHING;
```

> ملاحظة: `XXX` = next migration number (e.g., 152). Replace with actual number.

### 9.2 Run the migration

```bash
cd /opt/golden-crm/apps/staging

# Run the migration file:
psql "postgresql://golden_crm_staging:ASMA2026@localhost:5432/golden_crm_staging" -f migrations/XXX_drop_marketing_visits_legacy.sql

# Or if using knex/node migration runner:
# pnpm run migrate
```

### 9.3 Verify tables dropped

```bash
psql "postgresql://golden_crm_staging:ASMA2026@localhost:5432/golden_crm_staging" -c "
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
  AND table_name IN ('marketing_visits', 'marketing_visit_tasks', 'marketing_visit_task_offers');
"
```

**Expected:** empty result (0 rows)

---

## المرحلة 10: Verification النهائي

### 10.1 Code verification (grep)

```bash
cd /opt/golden-crm/apps/staging

# Backend: no marketing_visits references
grep -r "marketing_visits\|marketingVisit\|MarketingVisit" packages/api/ --include="*.ts" | grep -v "node_modules"
# Expected: 0 results

# Frontend: no marketingVisits references
grep -r "marketingVisits\|marketing_visit\|MarketingVisit" packages/web/src/ --include="*.tsx" --include="*.ts" | grep -v "node_modules"
# Expected: 0 results

# Shared: no MarketingVisit types
grep -r "MarketingVisit" packages/shared/ --include="*.ts" | grep -v "node_modules"
# Expected: 0 results
```

### 10.2 Build verification

```bash
# Backend type check:
pnpm --filter @golden-crm/api exec tsc --noEmit
# Expected: 0 errors

# Frontend type check:
pnpm --filter @golden-crm/web exec tsc -p tsconfig.typecheck.json --noEmit
# Expected: 0 errors

# Frontend build:
pnpm --filter @golden-crm/web build
# Expected: success
```

### 10.3 Restart server

```bash
pm2 restart golden-crm-staging

# Check logs:
pm2 logs golden-crm-staging --lines 20
# Expected: no errors, clean startup
```

### 10.4 Functional verification (manual test list)

**Test each scenario and mark ✅:**

- [ ] **زيارة marketing (عرض جهاز):**
  - [ ] افتح `/field-visits` → الزيارة موجودة بالقائمة
  - [ ] افتح تفاصيل الزيارة → بتشتغل
  - [ ] سجل نتيجة عرض (cash offer / installment) → بتشتغل
  - [ ] النتيجة بتتحفظ بـ `visit_task_device_demo_results`
  - [ ] إعادة جدولة الزيارة → بتشتغل
  - [ ] إلغاء الزيارة → بتشتغل

- [ ] **زيارة post-sale (تسليم جهاز):**
  - [ ] افتح `/field-visits` → الزيارة موجودة بالقائمة
  - [ ] افتح تفاصيل الزيارة → بتشتغل
  - [ ] سجل نتيجة تسليم (serial number, delivery condition) → بتشتغل
  - [ ] النتيجة بتتحفظ بـ `visit_task_device_delivery_results`

- [ ] **زيارة post-sale (تركيب جهاز):**
  - [ ] افتح `/field-visits` → الزيارة موجودة بالقائمة
  - [ ] افتح تفاصيل الزيارة → بتشتغل
  - [ ] سجل نتيجة تركيب → بتشتغل
  - [ ] النتيجة بتتحفظ بـ `visit_task_device_installation_results`

- [ ] **Telemarketer workspace:**
  - [ ] حجز موعد جديد → بيخلق `field_visit` + `visit_tasks`
  - [ ] الزيارة الجديدة بتظهر بـ `/field-visits`

- [ ] **Planning / generate-from-plan:**
  - [ ] sync assigned tasks → بتشتغل
  - [ ] generate task list → بتشتغل
  - [ ] الزيارات بتظهر بـ `/field-visits`

### 10.5 DB verification

```bash
# Tables should NOT exist:
psql "postgresql://golden_crm_staging:ASMA2026@localhost:5432/golden_crm_staging" -c "SELECT * FROM marketing_visits LIMIT 1;"
# Expected: ERROR: relation "marketing_visits" does not exist

psql "postgresql://golden_crm_staging:ASMA2026@localhost:5432/golden_crm_staging" -c "SELECT * FROM marketing_visit_tasks LIMIT 1;"
# Expected: ERROR

psql "postgresql://golden_crm_staging:ASMA2026@localhost:5432/golden_crm_staging" -c "SELECT * FROM marketing_visit_task_offers LIMIT 1;"
# Expected: ERROR

# Tables SHOULD exist and have data:
psql "postgresql://golden_crm_staging:ASMA2026@localhost:5432/golden_crm_staging" -c "SELECT COUNT(*) FROM field_visits;"
# Expected: > 0

psql "postgresql://golden_crm_staging:ASMA2026@localhost:5432/golden_crm_staging" -c "SELECT COUNT(*) FROM visit_tasks;"
# Expected: > 0

psql "postgresql://golden_crm_staging:ASMA2026@localhost:5432/golden_crm_staging" -c "SELECT COUNT(*) FROM visit_task_results;"
# Expected: > 0
```

### 10.6 Final sanity check

```bash
# No "marketing" in routes or tables:
psql "postgresql://golden_crm_staging:ASMA2026@localhost:5432/golden_crm_staging" -c "
SELECT table_name FROM information_schema.tables 
WHERE table_schema = 'public' 
  AND table_name LIKE '%marketing%';
"
# Expected: empty (or only telemarketing tables which are separate)
```

---

## ملاحظات أمان

1. **جزء B ما ينفذش إلا بعد ما جزء A يكون ناجح 100%.**
2. **Migration DB لازم يكون فيها defensive checks (DO $$ RAISE EXCEPTION).**
3. **Backup قبل أي شيء.**
4. **إذا أي check فشل → STOP immediately. ما تكمل.**
5. **Part B لازم ينفذ بوقت قليل الحركة (low traffic).**
