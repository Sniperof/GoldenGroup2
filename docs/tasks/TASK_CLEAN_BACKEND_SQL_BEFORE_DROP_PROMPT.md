# TASK: تنظيف backend SQL من `marketing_visits` references قبل DB drop

> السياق: مراحل 1-12 منفذة. الكود كامل بيستخدم `field_visits` (canonical). بس 2 ملفات backend لسا بيستخدمو `marketing_visits`:
>   1. `telemarketing.ts` — `INSERT INTO marketing_visits` عند حجز موعد
>   2. `openTasks.ts` — `JOIN marketing_visits` و `FROM marketing_visits` بـ 5 مواضع
> الهدف: نحذف/نعوّض كل references لـ `marketing_visits` بـ `field_visits` + bridge logic.
> بعديها بس: Phase 13 (DB drop) آمن.

---

## الملف 1: `packages/api/routes/telemarketing.ts`

### المشكلة: سطر 369 — `INSERT INTO marketing_visits`

**ابحث عن:**
```bash
grep -n "INSERT INTO marketing_visits" packages/api/routes/telemarketing.ts
```

**الحل:** هذا الـ INSERT redundant لأن `field_visits` bridge record بيتخلق من نفس الكود (أو بده يتخلق). بدنا نحذف الـ `INSERT INTO marketing_visits` block.

**التعديل المطلوب:**

```ts
// BEFORE (around line 369):
await pgClient.query(
  `INSERT INTO marketing_visits (
    id, branch_id, client_id, scheduled_date, scheduled_time,
    status, team_key, source_type, source_id, contact_target_id,
    requested_device_model_id, water_source, created_at, updated_at
  ) VALUES ($1, $2, $3, $4, $5, 'scheduled', $6, 'telemarketing_appointment', $7, $8, $9, $10, NOW(), NOW())
  ON CONFLICT (id) DO UPDATE SET ...`,
  [...]
);

// AFTER: DELETE this entire block.
// The field_visits bridge is already created in the same function (or should be created instead).
```

> ملاحظة: إذا كان الـ `marketing_visit` ID بيُستخدم لاحقاً بنفس الـ function (مثلاً `mvt.visit_id = marketingVisitId`) → لازم نغيّر لـ `fieldVisitId`.

---

## الملف 2: `packages/api/routes/openTasks.ts`

### المشكلة: 5 SQL references لـ `marketing_visits`

**ابحث عن:**
```bash
grep -n "marketing_visits" packages/api/routes/openTasks.ts
```

**التعديلات المطلوبة (5 مواضع):**

#### موقع ١: سطر 74 — `JOIN marketing_visits mv ON mv.id = mvt.visit_id`

**السياق:** استعلام بيجيب مهام مع معلومات الزيارة.

**التعديل:**
```sql
-- BEFORE:
JOIN marketing_visits mv ON mv.id = mvt.visit_id

-- AFTER:
JOIN field_visits fv ON fv.source_legacy_type = 'marketing_visit' AND fv.source_legacy_id = mvt.visit_id
```

> وغيّر `mv.scheduled_date` → `fv.scheduled_date`، `mv.team_key` → `fv.team_key`، إلخ.

#### موقع ٢: سطر 586 — `JOIN marketing_visits mv ON mv.id = mvt.visit_id`

نفس التعديل.

#### موقع ٣: سطر 749 — `LEFT JOIN marketing_visits mv ON mv.id = mvt.visit_id`

```sql
-- BEFORE:
LEFT JOIN marketing_visits mv ON mv.id = mvt.visit_id

-- AFTER:
LEFT JOIN field_visits fv ON fv.source_legacy_type = 'marketing_visit' AND fv.source_legacy_id = mvt.visit_id
```

#### موقع ٤: سطر 902 — `LEFT JOIN marketing_visits mv ON mv.id = mvt.visit_id`

نفس التعديل.

#### موقع ٥: سطر 2113-2120 — `FROM marketing_visits mv` (Fallback query)

```ts
// BEFORE:
// Fallback 2: marketing_visits device name via marketing_visit_tasks link
const { rows: fallbackRows } = await db.query(
  `SELECT device_name_snapshot
   FROM marketing_visits mv
   JOIN marketing_visit_tasks mvt ON mvt.visit_id = mv.id
   WHERE mvt.source_open_task_id = $1
   LIMIT 1`,
  [taskId]
);

// AFTER: Use field_visits + visit_tasks bridge
const { rows: fallbackRows } = await db.query(
  `SELECT fv.details->>'deviceName' as device_name_snapshot
   FROM field_visits fv
   JOIN visit_tasks vt ON vt.field_visit_id = fv.id
     AND vt.source_legacy_type = 'marketing_visit_task'
     AND vt.source_open_task_id = $1
   WHERE fv.source_legacy_type = 'marketing_visit'
   LIMIT 1`,
  [taskId]
);
```

> إذا `device_name_snapshot` مش موجود بـ `field_visits` → لازم نجيب من `clients` أو `visit_task_results`.

---

## Verify بعد التعديل

```bash
# No more marketing_visits references in backend:
grep -rn "marketing_visits" packages/api/routes/telemarketing.ts packages/api/routes/openTasks.ts
# Expected: 0 results (or only in comments)

# Type check:
pnpm --filter @golden-crm/api exec tsc --noEmit
# Expected: 0 new errors (4 pre-existing unrelated errors allowed)

# Restart server:
pm2 restart golden-crm-staging

# Test: Book an appointment → should work (no "relation does not exist" error)
# Test: Load open tasks list → should work
```

---

## بعد ما ينتهي هاد البرومptz

نفّذ Phase 13 (DB drop) من `TASK_UNIFIED_VISIT_MIGRATION_PHASES_9_10_VERIFY_PROMPT.md`.
