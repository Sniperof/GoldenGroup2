# تصحيح: استبدال الفريق لا ينتقل للكيانات المرتبطة

> **السياق:** `PATCH /field-visits/:id/team` بيغيّر الفريق بس ما بيحدّث `open_tasks` المرتبطة. و `PATCH /marketing-visits/:id/team` بيغيّر الفريق بس ما بيحدّث `field_visits` المرتبطة.
>
> **الأثر:** المستخدم بيشوف فريق قديم بقوائم المهام (`open_tasks`) حتى لو الفريق تغيّر بالزيارة.

---

## المشكلة ١: `field_visits` → `open_tasks` ما بتتزامن

### الوصف

لما بنستبدل الفريق بزيارة (`PATCH /field-visits/:id/team`)، الـ endpoint بيحدّث:
- ✅ `field_visits.reassigned_team_snapshot`
- ✅ `task_activity_log`
- ❌ `open_tasks.team_snapshot` — لسّا فيها الفريق القديم

### الملف

`packages/api/routes/fieldVisits.ts` — السطر ٦٩٣ تقريباً (بعد `UPDATE field_visits`، قبل `return`)

### الحل المطلوب

بعد كتابة `task_activity_log`، ضيف:

```ts
// Update linked open_tasks with the new effective team
await pool.query(
  `UPDATE open_tasks
   SET team_snapshot = $1::jsonb,
       updated_at = NOW()
   WHERE id IN (
     SELECT source_open_task_id
     FROM visit_tasks
     WHERE field_visit_id = $2
       AND source_open_task_id IS NOT NULL
   )`,
  [JSON.stringify(newSnapshot), visitId],
);
```

> **ملاحظة:** `newSnapshot` هو الـ `effectiveTeam` (بعد الـ merge)، مش `reassigned_team_snapshot` وحده.

---

## المشكلة ٢: `marketing_visits` → `field_visits` ما بتتزامن

### الوصف

لما بنستبدل الفريق بزيارة تلي ماركتينج (`PATCH /marketing-visits/:id/team`)، الـ endpoint بيحدّث:
- ✅ `marketing_visits.reassigned_team_snapshot`
- ❌ `field_visits.reassigned_*` — ما بيتحدّث لأن الـ bridge sync بيشتغل بس عند تغيير الحالة (`status`)

### الملف

`packages/api/routes/marketingVisits.ts` — السطر ١١١٦ تقريباً (بعد `UPDATE marketing_visits`، قبل `return`)

### الحل المطلوب

بعد كتابة `task_activity_log`، ضيف:

```ts
// Sync reassigned team to field_visits bridge record
await pool.query(
  `UPDATE field_visits
   SET reassigned_supervisor_id = $1,
       reassigned_technician_id = $2,
       reassigned_trainee_id = $3,
       reassigned_team_snapshot = $4::jsonb,
       reassigned_at = NOW(),
       reassigned_by = $5,
       updated_at = NOW()
   WHERE source_legacy_type = 'marketing_visit'
     AND source_legacy_id = $6`,
  [
    supervisorEmployeeId ?? null,
    technicianEmployeeId ?? null,
    traineeEmployeeId ?? null,
    JSON.stringify(newSnapshot),
    performedBy,
    visit.id,
  ],
);
```

---

## التحقق (Acceptance Criteria)

- [ ] `PATCH /field-visits/:id/team` بيحدّث `field_visits` + `task_activity_log` + **`open_tasks.team_snapshot`**
- [ ] `PATCH /marketing-visits/:id/team` بيحدّث `marketing_visits` + `task_activity_log` + **`field_visits.reassigned_*`**
- [ ] `GET /open-tasks` بيرجع الفريق الجديد بعد الإستبدال
- [ ] `GET /field-visits/:id` بيرجع `effectiveTeamSnapshot` صحيح بعد الإستبدال من `marketing_visits`
- [ ] الـ `task_activity_log` event_type = `'team_changed'` بيظهر بالسجل

---

## ما يُغيّر

- لا تغيّر على `visit_tasks` — ما في `team_snapshot` عليها، بتورّث من `field_visit`
- لا تغيّر على `marketing_visit_tasks` — نفس الشي
- لا تغيّر على صلاحيات أو validation

---

**تاريخ الكتابة:** 2026-05-23
**الكتاب:** Hermes (manager/analyst)
**المنفّذ:** (Codex / Claude Code)
