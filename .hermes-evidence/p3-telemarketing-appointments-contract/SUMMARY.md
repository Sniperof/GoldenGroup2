# P3 — عقد POST /telemarketing/appointments: القيود الفعلية

## ما هو عقد الحجز الفعلي؟

**عقد الباكند (الحد الأدنى المطلوب):**

```
1. taskListId + taskListItemId  → موجودان ومُصرَّح بالوصول إليهما
2. لا تعارض في الوقت (teamKey + date + timeSlot)
3. branch context موجود
```

**ما الذي لا يشترطه الباكند:**
```
✗ وجود open_task — الحجز يعمل حتى بدون task
✗ نوع مهمة محدد — أي taskType مقبول
✗ open_task في حالة 'in_contact_list' — الانتقال صامت ويُهمَل
✗ المرور بـ OutcomeRecorderModal — UI gate فقط، لا مكافئ في الباكند
```

---

## ما هو القيد الحقيقي؟

### من الواجهة (UI gate)

البوابة الوحيدة الفعّالة في الواجهة:

```typescript
// telemarketingOutcomes.ts — OUTCOME_MAP
booked_marketing_appointment: { opensAppointment: true }
booked (legacy):              { opensAppointment: true }
// كل بقية الـ outcomes: opensAppointment: false

// TelemarketerWorkspace.tsx:414
if (meta.opensAppointment) {
    setIsAppointmentModalOpen(true);
}
```

→ **القيد**: يجب تسجيل outcome = `booked_marketing_appointment` أولاً حتى يُفتح الـ modal.

### من الباكند (API gate)

```typescript
// telemarketing.ts:1318-1348
if (!appointment.taskListId || !appointment.taskListItemId)
  → 400 Bad Request

const taskList = await verifyTaskListAccess(req, res, taskListId);
if (!taskList) return;  // 403/404

const conflict = await pool.query(/* teamKey + date + timeSlot */);
if (conflict.rows[0]) → 409 Conflict
```

→ **القيد**: وجود task list item صالح + لا تعارض في الوقت. **لا شيء آخر**.

---

## هل نوع المهمة مهم؟

### في الباكند: **لا**

```typescript
// telemarketing.ts:1368-1371
const rawSelectedTasks =
  Array.isArray(appointment.selectedOpenTasks) && appointment.selectedOpenTasks.length > 0
    ? appointment.selectedOpenTasks          // ← يقبل أي taskType
    : [{ openTaskId: taskListItem.open_task_id ?? null, taskType: 'device_demo', ... }];
//                                                                  ^^^^^^^^^^^^ fallback فقط
```

الباكند يقبل أي `taskType` في `selectedOpenTasks`. لا validation، لا قائمة مسموح بها.

### في الواجهة: جزئياً

```typescript
// AppointmentSchedulerModal.tsx:79-84
const includesDeviceDemo = selectedTasks.some(t => t.openTaskType === 'device_demo');
const isValid = visitTime && selectedTasks.length > 0 && (!includesDeviceDemo || !!waterSource);
```

`waterSource` مطلوب فقط إذا كانت إحدى المهام `device_demo`. لا قيود على نوع المهمة نفسها.

### في الـ DB: **كلها device_demo** (في staging)

```
marketing_visit_tasks.task_type:
  device_demo: 15  ← 100%
  (لا emergency_maintenance, لا غيره)
```

هذا بسبب:
1. الـ fallback الثابت `'device_demo'` في الواجهة والباكند
2. لا `emergency_maintenance` open_tasks مرتبطة بحجوزات حتى الآن

---

## الحالات المثبتة في DB

### حالة 1 — حجز بدون open_task (مؤكَّدة)

```
appointment fcc7ccc9 (2026-05-03, client 2):
  open_task_id = NULL
  → marketing_visit mv_fcc7ccc9: status=completed
  → marketing_visit_task: task_type=device_demo, source_open_task_id=NULL

appointment e688771d (2026-05-07, client 2):
  open_task_id = NULL
  → marketing_visit mv_e688771d: status=scheduled
  → marketing_visit_task: task_type=device_demo, source_open_task_id=NULL
```

**الزيارة اكتملت** (`completed`) رغم غياب أي `open_task` مرتبط.

### حالة 2 — حجز عبر القائمة القديمة (legacy upsert)

```sql
-- legacy upsert لا يُخزّن open_task_id في الـ items
INSERT INTO telemarketing_task_list_items (..., contact_target_id)
VALUES (..., NULL)
-- ← لا حقل open_task_id في الـ INSERT
```

Items من legacy upsert → `open_task_id = NULL` → حجز بدون مهمة.

---

## المسار الكامل للقيود

```
┌─────────────────────────────────────────────────────────────────┐
│                    POST /telemarketing/appointments              │
├─────────────────────────────────────────────────────────────────┤
│ REQUIRED:                                                        │
│   ✅ taskListId + taskListItemId (verified)                      │
│   ✅ no time slot conflict                                       │
│   ✅ branch context                                              │
│                                                                  │
│ NOT REQUIRED:                                                    │
│   ✗  open_task existence                                         │
│   ✗  open_task status = 'in_contact_list'                       │
│   ✗  task_type = 'device_demo'                                   │
│   ✗  passing through OutcomeRecorderModal                        │
│                                                                  │
│ SILENT FAILS:                                                    │
│   ⚠  open_task.status ≠ 'in_contact_list' → UPDATE skipped      │
│   ⚠  entity_type ≠ 'client' → marketing_visit not created       │
│   ⚠  branchId = null → marketing_visit not created              │
└─────────────────────────────────────────────────────────────────┘
```

---

## أخطر gap: الحجز يعمل، تسجيل النتيجة قد يفشل

```typescript
// marketingVisits.ts:432-436 — PATCH /:id/result (legacy)
const legacyTask = (visit.tasks || []).find((t: any) => t.taskType === 'device_demo');
if (!legacyTask) {
    return res.status(404).json({ error: 'No device_demo task found on this visit' });
}
```

إذا تم حجز زيارة بـ `taskType = 'emergency_maintenance'`:
- ✅ الحجز يعمل
- ✅ marketing_visit_task تُنشأ بـ `task_type='emergency_maintenance'`
- ❌ PATCH /:id/result يُعيد 404 — لا يجد device_demo task
- ⚠️ PATCH /:visitId/tasks/:taskId/outcome يقبل — لكن outcomes غير منطقية للصيانة
