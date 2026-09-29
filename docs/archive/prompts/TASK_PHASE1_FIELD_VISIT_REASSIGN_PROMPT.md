# المرحلة ١: إضافة إعادة إسناد الفريق لـ `field_visits`

> **الهدف:** `field_visits` هو الكيان الوحيد للزيارة. يجب أن يدعم إعادة إسناد الفريق (team reassignment) قبل بدء الزيارة، بنفس آلية `marketing_visits` الموجودة حالياً.
>
> **السياق المعماري:** النظام الحالي يملك `reassigned_*` فقط على `marketing_visits`. عند تغيير الفريق هناك، الـ `field_visit` المُولّد منها يحتفظ بالفريق **الأصلي** (الخطأ). هذه المرحلة تضع الأساس لتوحيد الزيارة.

---

## ٠) الملفات المرجعية (اقرأها أولاً)

| الملف | السطر | اللي فيه |
|-------|-------|---------|
| `packages/api/routes/marketingVisits.ts` | 1057–1134 | endpoint إعادة الإسناد الموجود على `marketing_visits` — انسخ المنطق منه |
| `packages/api/routes/marketingVisits.ts` | 755–792 | bridge sync: كيف بيكتب `marketing_visit` على `field_visits` — **لاحظ السطر 787 بيستخدم `visit.teamSnapshot` بدون `reassigned`** |
| `packages/api/routes/fieldVisits.ts` | كامل | الـ route الحالي للزيارات الميدانية — ضيف الـ endpoint هون |
| `migrations/070_visit_core_schema.sql` | كامل | schema `field_visits` الأصلي |
| `migrations/112_marketing_visits_team_reassignment.sql` | كامل | نموذج إضافة `reassigned_*` — اعمل نفس الشي على `field_visits` |
| `docs/constitution/features/team-scheduling.md` | كامل | دستور تشكيل الفريق — عدّله |

---

## ١) Migration: إضافة أعمدة `reassigned_*` على `field_visits`

أنشئ migration جديد بالرقم التالي المتاح (مثلاً `146_field_visit_reassignment.sql`):

```sql
-- Migration: Add team reassignment columns to field_visits
BEGIN;

ALTER TABLE field_visits
  ADD COLUMN IF NOT EXISTS reassigned_supervisor_id  INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reassigned_technician_id  INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reassigned_trainee_id     INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reassigned_team_snapshot  JSONB,
  ADD COLUMN IF NOT EXISTS reassigned_at             TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reassigned_by             INTEGER REFERENCES hr_users(id) ON DELETE SET NULL;

COMMIT;
```

> **ملاحظة:** لا تحذف الأعمدة الأصلية (`supervisor_employee_id` إن وُجدت أو `team_snapshot`). الأصلي يبقى للـ audit، والـ `reassigned_*` للفريق الفعلي.

---

## ٢) Backend: Endpoint إعادة الإسناد على `field_visits`

في ملف `packages/api/routes/fieldVisits.ts` أضف:

### ٢.١ دالة مساعدة: `loadFieldVisitById`

إذا ما موجودة، أنشئ دالة ترجع بيانات `field_visit` كاملة (مثل `loadVisitById` بـ `marketingVisits.ts`).

### ٢.٢ الـ endpoint

```
PATCH /field-visits/:id/team
```

**القواعد (انسخها بالظبط من `marketingVisits.ts:1060-1068`):**

1. التبديل مسموح **فقط** لما `status = 'scheduled'`.
2. إذا `status != 'scheduled'` → رد `400` مع رسالة:
   ```
   لا يمكن تبديل الفريق بعد بدء الزيارة — التبديل مسموح فقط قبل بدء الزيارة
   ```
3. الـ body يقبل:
   - `supervisorEmployeeId`
   - `technicianEmployeeId`
   - `traineeEmployeeId`
   - `telemarketerEmployeeIds`
4. لازم يُرسل حقل واحد على الأقل.
5. `reassigned_team_snapshot` يُبنى بـ merge:
   ```ts
   const base = visit.reassignedTeamSnapshot ?? visit.teamSnapshot ?? {};
   const newSnapshot = {
     ...base,
     ...(supervisorEmployeeId !== undefined ? { supervisorEmployeeId: supervisorEmployeeId ?? null } : {}),
     ...(technicianEmployeeId !== undefined ? { technicianEmployeeId: technicianEmployeeId ?? null } : {}),
     ...(traineeEmployeeId !== undefined    ? { traineeEmployeeId: traineeEmployeeId ?? null }    : {}),
     ...(Array.isArray(telemarketerEmployeeIds) ? { telemarketerEmployeeIds } : {}),
   };
   ```
6. اكتب `task_activity_log` event_type = `'team_changed'` مع `old_value` = الفريق القديم و `new_value` = الفريق الجديد.
7. الصلاحية: `marketing_visits.update_result` (لحتى ما نضيف صلاحية جديدة هلأ).

### ٢.٣ الـ GET response لـ `field_visits`

عند قراءة `field_visit` (أي GET endpoint)، يجب أن يُرجع:
- `teamSnapshot` (الأصلي)
- `reassignedTeamSnapshot` (الجديد)
- `effectiveTeamSnapshot` = `reassignedTeamSnapshot ?? teamSnapshot`

---

## ٣) Backend: تعديل الـ bridge sync

في `packages/api/routes/marketingVisits.ts` السطر 766–788:

```ts
// BEFORE (خطأ):
team_snapshot: visit.teamSnapshot != null ? JSON.stringify(visit.teamSnapshot) : null,

// AFTER (صح):
const effectiveTeamSnapshot = (visit as any).reassignedTeamSnapshot ?? (visit as any).teamSnapshot ?? null;
team_snapshot: effectiveTeamSnapshot != null ? JSON.stringify(effectiveTeamSnapshot) : null,
```

> **الهدف:** لما `marketing_visit` بتتزامن لـ `field_visit`، لازم ينسخ **الفريق الفعلي** (المُعاد إسناده) مو الأصلي.

---

## ٤) Frontend: عرض "الفريق الفعلي" في صفحات `field_visit`

في أي صفحة بتعرض فريق `field_visit` (مثل `DeliveryTaskDetail.tsx` أو صفحات الطوارئ):

**المنطق:**
```ts
const effectiveTeam = fieldVisit.reassignedTeamSnapshot ?? fieldVisit.teamSnapshot;
const supervisorName = effectiveTeam?.supervisor?.name ?? '—';
const technicianName = effectiveTeam?.technician?.name ?? '—';
```

إذا كان `reassignedTeamSnapshot != null`، اعرض شارة: "⚡ فريق مُعاد الإسناد".

---

## ٥) Constitution: تحديث `team-scheduling.md`

في `docs/constitution/features/team-scheduling.md` أضف:

### قسم ٢.٧ — إعادة إسناد الفريق (Team Reassignment)

- إعادة الإسناد مسموحة **فقط** لما الزيارة `scheduled`.
- بعد `in_progress` → ممنوع التبديل.
- الفريق الفعلي = `reassigned_team_snapshot ?? team_snapshot`.
- الأصلي يُحفظ للـ audit.
- التغيير يُسجّل بـ `task_activity_log`.

### قسم ٢.٨ — توحيد الزيارة

> الزيارة كيان واحد فقط: `field_visits`. `marketing_visits` هو legacy wrapper. كل الزيارات — سواء تلي ماركتينج أو تسليم أو تركيب — تُمثّل بـ `field_visit` + `visit_task`.

---

## ٦) Acceptance Criteria

- [ ] Migration تنفّذ بدون error.
- [ ] `PATCH /field-visits/:id/team` بيشتغل وبيرجع `field_visit` المُحدّث.
- [ ] التبديل مرفوض لما `status != 'scheduled'`.
- [ ] `marketing_visit` لما بتتزامن لـ `field_visit`، بتستخدم `reassignedTeamSnapshot`.
- [ ] `task_activity_log` فيه event `'team_changed'`.
- [ ] دستور `team-scheduling.md` مُحدّث.

---

## ٧) ما يُغيّر (Non-goals)

- لا تحذف `marketing_visits`.
- لا تضيف صلاحيات جديدة — استخدم `marketing_visits.update_result`.
- لا تُنقل `marketing_visit_tasks` → `visit_tasks` — هاد المرحلة ٢.
- لا تلمس `open_tasks` — ربط الفريق بالمهام المفتوحة بيصير لاحقاً.

---

**تاريخ الكتابة:** 2026-05-22
**الكتاب:** Hermes (manager/analyst)
**المنفّذ:** (Codex / Claude Code)
