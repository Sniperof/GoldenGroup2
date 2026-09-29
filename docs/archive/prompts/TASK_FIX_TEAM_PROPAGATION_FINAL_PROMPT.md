# تصحيح انتقال الفريق بعد إعادة الإسناد

> **الهدف:** لما يتغيّر الفريق بزيارة، لازم ينتقل للكيانات المرتبطة.
>
> **مشكلتين:**
> 1. `PATCH /field-visits/:id/team` → ما بيحدّث `open_tasks` المرتبطة.
> 2. `PATCH /marketing-visits/:id/team` → ما بيحدّث `field_visits` المرتبطة (bridge).

---

## الملفات المرجعية

| الملف | السطر | اللي فيه |
|-------|-------|---------|
| `packages/api/routes/fieldVisits.ts` | 676–772 | `PATCH /:id/team` endpoint |
| `packages/api/routes/fieldVisits.ts` | 747–753 | `task_activity_log` INSERT |
| `packages/api/routes/marketingVisits.ts` | 1057–1134 | `PATCH /:id/team` endpoint |
| `packages/api/routes/marketingVisits.ts` | 1119–1130 | `task_activity_log` INSERT |

---

## التعديل ١ — fieldVisits.ts

### المكان

بعد هاد الـ block (بعد `task_activity_log` INSERT، قبل `return res.json`):

```ts
    // Audit log
    const oldSnapshot = { ... };
    await pool.query(
      `INSERT INTO task_activity_log (task_id, event_type, performed_by, old_value, new_value, reason)
       SELECT source_open_task_id, 'team_changed', $1, $2, $3, 'إعادة إسناد الزيارة'
         FROM visit_tasks
        WHERE field_visit_id = $4 AND source_open_task_id IS NOT NULL`,
      [performedBy, JSON.stringify(oldSnapshot), JSON.stringify(newSnapshot), visitId],
    );
```

### الإضافة المطلوبة

```ts
    // Propagate new team to linked open_tasks
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

> **ملاحظة:** `newSnapshot` هو الـ effective team (بعد الـ merge)، مش `reassigned_team_snapshot` وحده.

---

## التعديل ٢ — marketingVisits.ts

### المكان

بعد هاد الـ block (بعد `task_activity_log` INSERT، قبل `return res.json`):

```ts
  // Audit log
  await pool.query(
    `INSERT INTO task_activity_log (task_id, event_type, performed_by, old_value, new_value, reason)
     SELECT source_open_task_id, 'team_changed', $1, $2, $3, 'إعادة إسناد الزيارة'
       FROM marketing_visit_tasks
      WHERE visit_id = $4 AND source_open_task_id IS NOT NULL`,
    [
      performedBy,
      JSON.stringify({ supervisorEmployeeId: visit.supervisorEmployeeId, technicianEmployeeId: visit.technicianEmployeeId }),
      JSON.stringify(newSnapshot),
      visit.id,
    ],
  );
```

### الإضافة المطلوبة

```ts
    // Sync reassigned team to field_visits bridge record
    await pool.query(
      `UPDATE field_visits
       SET reassigned_supervisor_id = CASE WHEN $1::boolean THEN $2 ELSE reassigned_supervisor_id END,
           reassigned_technician_id = CASE WHEN $3::boolean THEN $4 ELSE reassigned_technician_id END,
           reassigned_trainee_id    = CASE WHEN $5::boolean THEN $6 ELSE reassigned_trainee_id    END,
           reassigned_team_snapshot = $7::jsonb,
           reassigned_at            = NOW(),
           reassigned_by            = $8,
           updated_at               = NOW()
       WHERE source_legacy_type = 'marketing_visit'
         AND source_legacy_id   = $9`,
      [
        supervisorEmployeeId !== undefined, supervisorEmployeeId ?? null,
        technicianEmployeeId !== undefined, technicianEmployeeId ?? null,
        traineeEmployeeId    !== undefined, traineeEmployeeId    ?? null,
        JSON.stringify(newSnapshot),
        performedBy,
        visit.id,
      ],
    );
```

> **ملاحظة:** باستخدام نفس `CASE WHEN` pattern تبع الـ `marketing_visits` update — بس على `field_visits`.

---

## Acceptance Criteria

- [ ] `PATCH /field-visits/:id/team` → يحدّث `field_visits` + `task_activity_log` + **`open_tasks.team_snapshot`**
- [ ] `PATCH /marketing-visits/:id/team` → يحدّث `marketing_visits` + `task_activity_log` + **`field_visits.reassigned_*`**
- [ ] `GET /open-tasks` بيرجع الفريق الجديد بعد الاستبدال
- [ ] `GET /field-visits/:id` بيرجع `effectiveTeamSnapshot` صحيح بعد استبدال `marketing_visits`

---

**تاريخ الكتابة:** 2026-05-23
**المنفّذ:** (Codex / Claude Code)
