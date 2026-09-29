# المرحلة ٢: دمج الزيارة التسويقية ضمن `field_visits` + `visit_tasks`

> **الهدف:** `marketing_visits` + `marketing_visit_tasks` هما legacy tables. كل الزيارات يجب أن تُمثّل بـ `field_visits` + `visit_tasks`. هذه المرحلة تُبنى على المرحلة ١ (reassigned_* على field_visits) وتُكمل توحيد الزيارة.
>
> **السياق المعماري:** النظام يملك كيانين متوازيين:
> - **Legacy:** `marketing_visits` ← `marketing_visit_tasks` ← `marketing_visit_task_offers`
> - **Modern (Target):** `field_visits` ← `visit_tasks` ← `visit_task_results` ← `visit_task_device_demo_results`
>
> الـ bridge sync الموجود حالياً يكتب `marketing_visit` → `field_visit` بس بشكل سطحي (بدون عروض الجهاز). هذه المرحلة تُعمّق الدمج.

---

## ٠) الملفات المرجعية (اقرأها أولاً)

| الملف | السطر | اللي فيه |
|-------|-------|---------|
| `migrations/051_marketing_visits_mvp.sql` | كامل | schema `marketing_visits` + `marketing_visit_tasks` الأصلي |
| `migrations/091_marketing_visit_task_offers.sql` | كامل | schema `marketing_visit_task_offers` |
| `migrations/070_visit_core_schema.sql` | كامل | schema `field_visits` + `visit_tasks` + `visit_task_results` + `visit_task_device_demo_results` |
| `migrations/146_field_visit_reassignment.sql` | كامل | المرحلة ١ (foundation) |
| `packages/api/routes/marketingVisits.ts` | 750–830 | bridge sync: كيف بيكتب `marketing_visit` على `field_visits` + `visit_tasks` |
| `packages/api/routes/fieldVisits.ts` | 330–370 | كيف بيقرأ `visit_tasks` من `field_visits` |
| `docs/constitution/features/team-scheduling.md` | كامل | دستور تشكيل الفريق + توحيد الزيارة |

---

## ١) Migration: توسيع `visit_tasks` ليقبل `device_demo`

أنشئ migration جديد (`147_visit_tasks_device_demo.sql`):

### ١.١ توسيع `task_type` و `task_family`

```sql
-- BEFORE: task_type IN ('device_demo', 'emergency_maintenance')
-- AFTER:  task_type IN ('device_demo', 'emergency_maintenance')
--         (device_demo موجود فعلاً — لكن task_family لازم يتوسع)

-- توسيع task_family إذا لازم
ALTER TABLE visit_tasks
  DROP CONSTRAINT IF EXISTS visit_tasks_task_family_check;

ALTER TABLE visit_tasks
  ADD CONSTRAINT visit_tasks_task_family_check
  CHECK (task_family IN ('marketing', 'service'));
```

> **ملاحظة:** `device_demo` موجود فعلاً في constraint تبع migration 070. التحقق من أنه شغال.

### ١.٢ إضافة أعمدة legacy bridge

```sql
ALTER TABLE visit_tasks
  ADD COLUMN IF NOT EXISTS source_legacy_type  VARCHAR(50),  -- 'marketing_visit_task'
  ADD COLUMN IF NOT EXISTS source_legacy_id    VARCHAR(100);

-- إضافة index للـ lookup السريع
CREATE INDEX IF NOT EXISTS idx_visit_tasks_legacy
  ON visit_tasks(source_legacy_type, source_legacy_id);
```

### ١.٣ إضافة `result` مؤقت على `visit_tasks`

```sql
-- لحتى ننقل البيانات بسهولة — ممكن يُحذف بعد التحقق
ALTER TABLE visit_tasks
  ADD COLUMN IF NOT EXISTS legacy_result VARCHAR(50);
```

---

## ٢) Backend: تعديل bridge sync في `marketingVisits.ts`

### ٢.١ الهدف

عند كل `UPDATE` لـ `marketing_visit` (خاصة لما status بيتغير لـ `completed` أو `not_completed`)، الـ bridge sync لازم:

1. يكتب/يحدّث `field_visits`
2. يكتب/يحدّث `visit_tasks` (واحد لكل `marketing_visit_task`)
3. يكتب/يحدّث `visit_task_results`
4. يكتب/يحدّث `visit_task_device_demo_results` (للعروض)

### ٢.٢ المسار الحالي (marketing_visit → field_visit)

الـ sync موجود بـ `marketingVisits.ts` حوالي السطر 756–828. بس هو:
- بيكتب `field_visit` بـ `visit_type = 'marketing'`
- بيكتب `visit_task` واحد بـ `task_type = 'device_demo'`
- **ما بينقل العروض** (`marketing_visit_task_offers` → `visit_task_device_demo_results`)

### ٢.٣ التعديل المطلوب

#### (أ) نقل العروض

بعد إنشاء/تحديث `visit_task` (بتحصل `coreTaskId`)، انسخ العروض من `marketing_visit_task_offers`:

```sql
INSERT INTO visit_task_device_demo_results (
  visit_task_result_id,
  offer_type, offer_amount, installment_months,
  closed_by_employee_id, contract_id
)
SELECT
  $1,  -- coreTaskId (بس هاد غلط — لازم يكون visit_task_result_id مش visit_task_id)
  mvo.offer_type,
  CASE WHEN mvo.offer_type = 'cash' THEN mvo.total_amount ELSE NULL END,
  CASE WHEN mvo.offer_type = 'installment' THEN mvo.installment_months ELSE NULL END,
  mvo.closed_by_employee_id,
  NULL  -- contract_id من وين؟
FROM marketing_visit_task_offers mvo
WHERE mvo.task_id = $2;  -- marketing_visit_task.id
```

> ⚠️ **مشكلة معمارية:** `visit_task_device_demo_results` بيربط بـ `visit_task_result_id` مش `visit_task_id`. يعني لازم:
> 1. ننشئ `visit_task_result` أولاً
> 2. نستخدم `visit_task_result.id` كـ FK

#### (ب) تسلسل العمليات المُعدّل

```
1. Upsert field_visit (موجود — لا تغيّره)
2. Upsert visit_task (موجود — أضف source_legacy_type = 'marketing_visit_task')
3. NEW: Upsert visit_task_result
   - final_decision = mapping[marketing_visit_task.result]
   - reason_code = mapping[marketing_visit.status]
   - closing_notes = marketing_visit_task.result_notes
4. NEW: Upsert visit_task_device_demo_results
   - نسخ العروض من marketing_visit_task_offers
5. NEW: ربط visit_task.source_open_task_id بـ open_tasks (إذا موجود)
```

### ٢.٤ mapping الجداول

| `marketing_visit.status` | `field_visit.status` |
|--------------------------|---------------------|
| scheduled | scheduled |
| completed | completed |
| not_completed | not_completed |
| postponed_by_company | postponed_by_company |
| postponed_by_customer | postponed_by_customer |
| cancelled | cancelled |
| needs_reschedule | needs_reschedule |
| in_visit | in_progress |
| ended | ended |

| `marketing_visit_task.result` | `visit_task_result.final_decision` |
|------------------------------|-----------------------------------|
| cash_offer_closed | offer_accepted_cash |
| installment_offer_closed | offer_accepted_installment |
| cash_offer_not_closed | offer_declined |
| installment_offer_not_closed | offer_declined |
| demo_not_completed | not_completed |

> **ملاحظة:** `visit_task_result.final_decision` CHECK constraint بـ migration 070 مقبول يتوسّع. لازم تضيف القيم الجديدة.

---

## ٣) Backend: تعديل `fieldVisits.ts` ليقرأ `device_demo`

### ٣.١ التعديل على `GET /field-visits/:id`

حالياً الـ query بـ `fieldVisits.ts:336` بيقرأ:
```sql
SELECT vt.*, vtr.id AS result_id, vtr.final_decision, ...
FROM visit_tasks vt
LEFT JOIN visit_task_results vtr ON vtr.visit_task_id = vt.id
LEFT JOIN visit_name_collections vnc ON vnc.visit_task_id = vt.id
```

لازم نضيف:
```sql
LEFT JOIN visit_task_device_demo_results vtddr ON vtddr.visit_task_result_id = vtr.id
```

وبالـ response نضيف:
```ts
deviceDemoResult: {
  offerType: vtddr.offer_type,
  offerAmount: vtddr.offer_amount,
  installmentMonths: vtddr.installment_months,
  contractId: vtddr.contract_id,
}
```

### ٣.٢ التعديل على `POST /field-visits/:id/complete`

حالياً بيتحقق إن كل `visit_tasks` عنده `visit_task_results`. التحقق صحيح — بس لازم نتأكد إنه بيشتغل مع `device_demo` كمان.

---

## ٤) Frontend: `MarketingVisitDetailsPage.tsx`

### ٤.١ تعديل الـ GET

حالياً الصفحة بتقرأ `marketing_visits` مباشرة. لازم:
- إذا الزيارة مربوطة بـ `field_visit` (عن طريق `source_legacy_type = 'marketing_visit'` + `source_legacy_id`)، اقرأ `field_visit` واعرض بياناته.
- إذا ما في `field_visit`، اقرأ `marketing_visit` (legacy fallback).

### ٤.٢ تعديل حفظ النتيجة

حالياً النتيجة بتحفظ بـ `marketing_visit_tasks` + `marketing_visit_task_offers`. المفروض:
- تحفظ بنفس المكان (legacy) — بس الـ bridge sync ينقلها لـ `visit_task_results` + `visit_task_device_demo_results`
- أو: تحفظ مباشرة بـ `visit_task_results` (أكبر تغيير — يمكن لاحقاً)

> **القرار:** المرحلة ٢ تحافظ على `marketing_visits` كـ writable legacy. الـ bridge sync بس ينقل للقراءة. الكتابة لسّا ع legacy.

---

## ٥) Data Migration: نقل البيانات القديمة

### ٥.١ Migration (`148_migrate_marketing_visits.sql`)

```sql
-- نقل كل marketing_visit_tasks → visit_tasks (يلي ما عندن visit_task مطابق)
INSERT INTO visit_tasks (
  field_visit_id, source_open_task_id, task_type, task_family, sequence_no,
  status, execution_notes, source_legacy_type, source_legacy_id
)
SELECT
  fv.id,                          -- field_visit_id (من bridge sync الموجود)
  NULL,                           -- source_open_task_id (نحاول نربطه)
  'device_demo', 'marketing', 1,
  CASE WHEN mvt.status = 'completed' THEN 'completed'
       WHEN mvt.status = 'not_completed' THEN 'not_completed'
       ELSE 'pending' END,
  mvt.result_notes,
  'marketing_visit_task',
  mvt.id
FROM marketing_visit_tasks mvt
JOIN marketing_visits mv ON mv.id = mvt.visit_id
JOIN field_visits fv ON fv.source_legacy_type = 'marketing_visit'
                      AND fv.source_legacy_id = mv.id
LEFT JOIN visit_tasks vt ON vt.source_legacy_type = 'marketing_visit_task'
                         AND vt.source_legacy_id = mvt.id
WHERE vt.id IS NULL;

-- نتيجة: الـ bridge sync المستقبلي رح يستخدم visit_tasks مش marketing_visit_tasks
```

> **تحذير:** هاد migration كبير. اختبره على staging DB backup أولاً.

---

## ٦) Constitution: تحديث `team-scheduling.md`

أضف قسم ٢.٩:

### ٢.٩ — دمج الزيارة التسويقية (Phase 2)

- `marketing_visit_tasks` → `visit_tasks` (task_type = 'device_demo', task_family = 'marketing').
- `marketing_visit_task_offers` → `visit_task_device_demo_results`.
- `marketing_visit_task.result` → `visit_task_result.final_decision`.
- الـ bridge sync ينقل البيانات تلقائياً عند كل update.
- الـ frontend يقرأ من `field_visits` أولاً، ويلجأ لـ `marketing_visits` fallback.

---

## ٧) Acceptance Criteria

- [ ] `visit_tasks` بيقبل `device_demo` مع `task_family = 'marketing'`.
- [ ] `visit_task_device_demo_results` بيحتوي على عروض من `marketing_visit_task_offers`.
- [ ] `visit_task_result.final_decision` بيحتوي على القيم الجديدة (`offer_accepted_cash`, `offer_accepted_installment`, `offer_declined`).
- [ ] `GET /field-visits/:id` بيرجع `deviceDemoResult` ضمن `tasks`.
- [ ] Bridge sync بيستخدم `effectiveTeamSnapshot` (من المرحلة ١).
- [ ] Data migration بيشتغل بدون فقدان بيانات.
- [ ] `marketingVisits.ts` لسّا شغال (legacy write) — ما انكسر.
- [ ] دستور مُحدّث.

---

## ٨) ما يُغيّر (Non-goals)

- لا تحذف `marketing_visits`, `marketing_visit_tasks`, أو `marketing_visit_task_offers`.
- لا تغيّر API routes تبع `marketingVisits.ts` — الـ frontend لسّا بيستخدمن.
- لا تلمس `open_tasks` أو `telemarketing`.
- لا تغيّر `field_visit` statuses — استخدم الموجود.

---

**تاريخ الكتابة:** 2026-05-22
**الكتاب:** Hermes (manager/analyst)
**المنفّذ:** (Codex / Claude Code)
**Dependencies:** المرحلة ١ (Migration 146) يجب أن تكون منفّذة.
