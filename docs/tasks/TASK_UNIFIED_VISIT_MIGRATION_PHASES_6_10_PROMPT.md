# TASK: إنهاء migration الزيارة الموحدة — المراحل 6-10 (الحذف النهائي)

> السياق: مراحل 1-5 منفذة بالكامل. `field_visits` صار الكيان الأساسي والـ UI كامل بيستخدمو.
> الهدف: ننهي المراحل 6-10 — نحذف `marketing_visits` (backend + frontend + DB) بالكامل.
> الخطورة: عالية — أي خطأ هون بيخربshي. لازم دقة + verify.

---

## المرحلة 6: نقل الـ Permissions (يوم 1)

### 6.1 Backend — `packages/api/routes/fieldVisits.ts`

**المطلوب:** تأكد إن كلshي uses `field_visits.*` permissions.

**Checklist:**
- [ ] `GET /field-visits/` → `requirePermission('field_visits.view')` (أو `marketing_visits.view` إذا بدّنا نحتفظ بالاسم)
- [ ] `GET /field-visits/:id` → `requirePermission('field_visits.view')`
- [ ] `POST /field-visits/:id/start` → `requirePermission('field_visits.update_status')`
- [ ] `POST /field-visits/:id/end` → `requirePermission('field_visits.update_status')`
- [ ] `POST /field-visits/:id/complete` → `requirePermission('field_visits.update_status')`
- [ ] `POST /field-visits/:id/reschedule` → `requirePermission('field_visits.reschedule')`
- [ ] `POST /field-visits/:id/cancel` → `requirePermission('field_visits.cancel')`
- [ ] `PATCH /field-visits/:id/team` → `requirePermission('field_visits.update_team')`
- [ ] `POST /field-visits/:id/tasks/:id/result` → `requirePermission('field_visits.update_result')`

**ملاحظة:** إذا الـ admin panel ما بيدعم `field_visits.*` permissions حالياً → لازم نضيفن.

### 6.2 Backend — `packages/api/routes/*.ts` (كل الملفات)

**المطلوب:** ابحث عن أي `requirePermission('marketing_visits.*')` وغيّره لـ `field_visits.*`.

```bash
# Command للبحث:
grep -r "requirePermission('marketing_visits" packages/api/routes/
```

### 6.3 Frontend — `packages/web/src/`

**المطلوب:** ابحث عن أي `<PermissionGate permission="marketing_visits.*">` وغيّرها.

```bash
# Command للبحث:
grep -r "marketing_visits\." packages/web/src/ --include="*.tsx" --include="*.ts"
```

### 6.4 Admin / Role Settings

**الملفات:**
- `packages/web/src/pages/admin/PermissionSettings.tsx`
- `packages/web/src/pages/admin/RolePermissions.tsx`

**المطلوب:** أضف `field_visits.*` permissions وعلّم `marketing_visits.*` بـ "legacy — don't use".

---

## المرحلة 7: حذف `marketingVisits.ts` API (يوم 1)

### 7.1 احذف الملف

```bash
rm packages/api/routes/marketingVisits.ts
```

### 7.2 احذف الـ import من index

**الملف:** `packages/api/index.ts` (أو يلي بيسجل الـ routes)

**ابحث عن:**
```ts
import marketingVisitsRouter from './routes/marketingVisits.js';
// أو أي reference لـ marketingVisits
```

**احذفو + احذف أي `app.use('/marketing-visits', ...)`**

### 7.3 احذف من `api.ts`

**الملف:** `packages/web/src/lib/api.ts`

**احذف كل الـ `marketingVisits:` block:**
```ts
// DELETE ALL OF THIS:
marketingVisits: {
  list: (date, branchId?) => ...,
  get: (id) => ...,
  updateResult: ...,
  updateTaskOutcome: ...,
  updateStatus: ...,
  reschedule: ...,
  cancel: ...,
  close: ...,
  updateTeam: ...,
  assignScope: ...,
}
```

### 7.4 احذف components legacy

**الملفات يلي لازم تُحذف:**
- `packages/web/src/components/marketing-visits/MarketingVisitResultModal.tsx`
- `packages/web/src/components/marketing-visits/MarketingVisitOutcomeModal.tsx`
- أي component تاني تحت `marketing-visits/` ما بيُستخدم

> **تحذير:** تأكد ما حدا بيستدعيهن قبل الحذف:
```bash
grep -r "MarketingVisitResultModal\|MarketingVisitOutcomeModal" packages/web/src/
```

### 7.5 احذف pages legacy

**الملفات يلي لازم تُحذف:**
- `packages/web/src/pages/MarketingVisitDetailsPage.tsx` (if fully replaced by VisitDetailPage)
- `packages/web/src/pages/MarketingVisitsPage.tsx` (if fully replaced by VisitsListPage)

> **تحذير:** تأكد ما حدا بيستدعيهن:
```bash
grep -r "MarketingVisitDetailsPage\|MarketingVisitsPage" packages/web/src/
```

---

## المرحلة 8: حذف Shared Types Legacy (يوم 1)

### 8.1 `packages/shared/types.ts`

**احذف كل types يلي بتبدأ بـ `Marketing` (إذا ما عاد حدا بيستخدمن):**

```bash
# Search first:
grep -n "MarketingVisit\|MarketingVisitTask\|MarketingVisitResult" packages/shared/types.ts
```

**الtypes يلي لازم تُحذف:**
- `MarketingVisit` interface
- `MarketingVisitTask` interface
- `MarketingVisitResultUpdateRequest`
- `MarketingVisitRescheduleRequest`
- `MarketingVisitCancelRequest`
- `MarketingVisitLifecycleTaskUpdate`
- `MarketingVisitTaskOfferInput`
- `MarketingVisitTeamSnapshot`
- `MarketingVisitType`
- `MarketingVisitStage`
- `MarketingVisitStatus`
- `MarketingVisitCompletionState`
- `MarketingVisitTaskType`
- `MarketingVisitTaskStatus`
- `MarketingVisitTaskResult`
- `MarketingVisitTaskOutcome`
- `MarketingVisitSourceType`
- `MarketingVisitNonCompletionReason`

**ملاحظة:** `MARKETING_VISIT_TASK_OUTCOME_LABELS` ممكن نحتفظ فيها لو بيستخدمها `open_tasks` لسا. ابحث قبل الحذف.

### 8.2 Verify no references

```bash
# After deleting, build and check:
pnpm --filter @golden-crm/web typecheck
pnpm --filter @golden-crm/api typecheck:api
```

> أي error = في reference لسا موجود. دور عليه وحلّه.

---

## المرحلة 9: حذف الجداول Legacy من DB (يوم 2)

### 9.1 Migration SQL

**الملف:** `migrations/XXX_drop_marketing_visits.sql`

```sql
-- IMPORTANT: Run this ONLY after confirming:
-- 1. No code references marketing_visits anywhere
-- 2. All data is in field_visits (bridge records exist)
-- 3. Backup taken

-- Step 1: Drop child tables first
DROP TABLE IF EXISTS marketing_visit_task_offers CASCADE;
DROP TABLE IF EXISTS marketing_visit_tasks CASCADE;

-- Step 2: Drop parent table
DROP TABLE IF EXISTS marketing_visits CASCADE;

-- Step 3: Drop any legacy functions/triggers
DROP FUNCTION IF EXISTS sync_marketing_visit_to_field_visit() CASCADE;
DROP FUNCTION IF EXISTS apply_marketing_visit_result() CASCADE;

-- Step 4: Clean up enum types if no longer used (check first!)
-- DROP TYPE IF EXISTS marketing_visit_status CASCADE;
-- DROP TYPE IF EXISTS marketing_visit_task_status CASCADE;

-- Step 5: Log the migration
INSERT INTO migrations (id, name, applied_at)
VALUES (XXX, 'drop_marketing_visits_legacy', NOW());
```

### 9.2 Before running — MANDATORY checks

```sql
-- Verify field_visits has all the data:
SELECT 
  (SELECT COUNT(*) FROM marketing_visits) as mv_count,
  (SELECT COUNT(*) FROM field_visits WHERE source_legacy_type = 'marketing_visit') as fv_bridge_count;

-- These should be equal (or fv_bridge >= mv_count)
-- If not, STOP and investigate.
```

```sql
-- Verify visit_tasks has all marketing tasks:
SELECT 
  (SELECT COUNT(*) FROM marketing_visit_tasks) as mvt_count,
  (SELECT COUNT(*) FROM visit_tasks WHERE source_legacy_type = 'marketing_visit_task') as vt_bridge_count;
```

### 9.3 Backup before drop

```bash
pg_dump "postgresql://golden_crm_staging:ASMA2026@localhost:5432/golden_crm_staging" \
  --table=marketing_visits \
  --table=marketing_visit_tasks \
  --table=marketing_visit_task_offers \
  > /tmp/marketing_visits_backup_$(date +%F).sql
```

---

## المرحلة 10: Verification النهائي (يوم 2)

### 10.1 Code verification

```bash
# No references to marketing_visits in backend:
grep -r "marketing_visits\|marketingVisit" packages/api/ --include="*.ts"
# Expected: 0 results (or only in migration files / comments)

# No references in frontend:
grep -r "marketingVisits\|marketing_visit\|MarketingVisit" packages/web/src/ --include="*.tsx" --include="*.ts"
# Expected: 0 results

# No references in shared:
grep -r "MarketingVisit" packages/shared/ --include="*.ts"
# Expected: 0 results
```

### 10.2 Build verification

```bash
# Type checking:
pnpm --filter @golden-crm/api typecheck:api
pnpm --filter @golden-crm/web typecheck

# Build:
pnpm --filter @golden-crm/web build
```

### 10.3 Runtime verification

```bash
# Restart server:
pm2 restart golden-crm-staging

# Check logs:
pm2 logs golden-crm-staging --lines 20
# Expected: no errors, no "marketingVisits" references
```

### 10.4 Functional verification (manual test)

- [ ] افتح `/field-visits` → قائمة الزيارات بتشتغل ✅
- [ ] افتح تفاصيل زيارة (marketing) → بتشتغل ✅
- [ ] افتح تفاصيل زيارة (post-sale) → بتشتغل ✅
- [ ] سجل نتيجة `device_demo` → بتشتغل ✅
- [ ] سجل نتيجة `device_delivery` → بتشتغل ✅
- [ ] إعادة جدولة زيارة → بتشتغل ✅
- [ ] إلغاء زيارة → بتشتغل ✅
- [ ] جدول موعد جديد (telemarketing) → الزيارة بتتخلق بـ `field_visits` ✅
- [ ] planning + generate-from-plan → الزيارات بتظهر بالقائمة ✅

### 10.5 Database verification

```sql
-- Tables should NOT exist:
SELECT * FROM marketing_visits LIMIT 1;
-- Expected: ERROR: relation "marketing_visits" does not exist

SELECT * FROM marketing_visit_tasks LIMIT 1;
-- Expected: ERROR

SELECT * FROM marketing_visit_task_offers LIMIT 1;
-- Expected: ERROR

-- Tables SHOULD exist and have data:
SELECT COUNT(*) FROM field_visits;
-- Expected: > 0

SELECT COUNT(*) FROM visit_tasks;
-- Expected: > 0

SELECT COUNT(*) FROM visit_task_results;
-- Expected: > 0
```

---

## قيود وتحذيرات

1. **لا تحذف أي ملف قبل ما تتأكد من عدم وجود references.**
2. **لا تُنفذ migration DB قبل backup.**
3. **إذا `field_visits` bridge records ناقصة → STOP.** رجّع وعوّض.
4. **Type check (`pnpm typecheck`) هو gatekeeper.** أي error = لا تنفذ DB migration.
5. **Testing on staging أولاً.** Production لاحقاً بعد تأكيد staging.
