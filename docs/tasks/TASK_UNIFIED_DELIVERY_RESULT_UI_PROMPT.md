# TASK: ربط نتيجة التسليم/التركيب بالـ Endpoint الموحد (field-visits)

> المشكلة: `handleSubmitDeliveryResult` بـ `MarketingVisitDetailsPage.tsx` بيستخدم الـ endpoint القديم `api.openTasks.saveDeliveryResult` يلي بيحدّث `open_tasks` بس، وما بيحدّث `visit_tasks` + `field_visits`. النتيجة: زر "تسجيل النتيجة" بيضل موجود لأن الزيارة (visit_tasks) ما اتحدّثت.
>
> الحل: نخلي الـ frontend يستخدم الـ endpoint الموحد `/field-visits/:visitId/tasks/:taskId/result`.

---

## الملفات المطلوبة (3 ملفات)

---

### 1. Backend: `packages/api/routes/marketingVisits.ts` — `loadVisitById`

**المطلوب:** أضف `fieldVisitId` للرد.

**قبل ما يرجع `visit`:**
```ts
// بعد mapVisitRows(rows) وبbefore return visit;
// Query field_visits bridge record
const { rows: fieldVisitRows } = await pool.query(
  `SELECT id FROM field_visits 
   WHERE source_legacy_type = 'marketing_visit' 
     AND source_legacy_id = $1 
   LIMIT 1`,
  [visit.id]
);
visit.fieldVisitId = fieldVisitRows[0]?.id ?? null;

// Also ensure each task has visitTaskId (visit_tasks.id)
if (Array.isArray(visit.tasks)) {
  const taskLegacyIds = visit.tasks.map(t => t.id);
  const { rows: vtRows } = await pool.query(
    `SELECT id, source_legacy_id 
     FROM visit_tasks 
     WHERE source_legacy_type = 'marketing_visit_task' 
       AND source_legacy_id = ANY($1::text[])`
    [taskLegacyIds]
  );
  const visitTaskByLegacy = new Map(vtRows.map(r => [String(r.source_legacy_id), r.id]));
  visit.tasks = visit.tasks.map(t => ({
    ...t,
    visitTaskId: visitTaskByLegacy.get(String(t.id)) ?? null,
  }));
}
```

**ملاحظة:** إذا `fieldVisitId` مش موجود (الزيارة جديدة ولسا ما سجلنلها نتيجة) → لازم نعمل `UPSERT` هون:
```ts
// If no field_visit exists yet, create it
if (!fieldVisitRows[0]) {
  const { rows: newFv } = await pgClient.query(
    `INSERT INTO field_visits (visit_type, visit_family, status, client_id, branch_id, scheduled_date, scheduled_time, source_legacy_type, source_legacy_id, created_at, updated_at)
     VALUES ('marketing', 'marketing', $1, $2, $3, $4::date, $5, 'marketing_visit', $6, NOW(), NOW())
     ON CONFLICT (source_legacy_type, source_legacy_id) DO UPDATE SET updated_at = NOW()
     RETURNING id`,
    [visit.status, visit.clientId, visit.branchId, visit.scheduledDate, visit.scheduledTime, visit.id]
  );
  visit.fieldVisitId = newFv[0]?.id ?? null;
}
```

---

### 2. Shared Types: `packages/shared/types.ts` — `MarketingVisit` + `MarketingVisitTask`

**أضف للـ `MarketingVisit`:**
```ts
export interface MarketingVisit {
  ...existing fields...
  fieldVisitId?: number | null;  // ← NEW
}
```

**أضف للـ `MarketingVisitTask`:**
```ts
export interface MarketingVisitTask {
  id: string;
  visitTaskId?: number | null;  // ← NEW (visit_tasks.id)
  taskType: MarketingVisitTaskType;
  status: MarketingVisitTaskStatus;
  ...
}
```

---

### 3. Frontend: `packages/web/src/pages/MarketingVisitDetailsPage.tsx` — `handleSubmitDeliveryResult`

**الحالي:**
```ts
const handleSubmitDeliveryResult = async () => {
  if (!visit || !deliveryResultTask?.sourceOpenTaskId) return;
  setSavingDelivery(true); setDeliveryError('');
  try {
    await api.openTasks.saveDeliveryResult(
      Number(deliveryResultTask.sourceOpenTaskId),
      {
        outcome: deliveryOutcome,
        serialNumber: deliveryOutcome === 'delivered_successfully' ? deliverySerial || null : null,
        deliveryAddress: deliveryAddress || null,
        actualDeliveryDate: deliveryDate || null,
        deliveryCondition: deliveryOutcome === 'delivered_successfully' ? deliveryCondition : null,
        notes: deliveryNotes.trim() || null,
      }
    );
    ...
  }
};
```

**المطلوب:**
```ts
const handleSubmitDeliveryResult = async () => {
  if (!visit || !deliveryResultTask?.visitTaskId || !visit.fieldVisitId) return;
  setSavingDelivery(true); setDeliveryError('');
  try {
    await api.fieldVisits.saveTaskResult(
      visit.fieldVisitId,           // ← field_visits.id
      deliveryResultTask.visitTaskId, // ← visit_tasks.id
      {
        status: deliveryOutcome === 'delivered_successfully' ? 'completed' : 'not_completed',
        result: deliveryOutcome,      // map legacy outcome to unified result
        // Delivery-specific fields go to visit_task_device_delivery_results
        // via the unified endpoint's side-table handling
        serialNumber: deliveryOutcome === 'delivered_successfully' ? deliverySerial || null : null,
        deliveryAddress: deliveryAddress || null,
        actualDeliveryDate: deliveryDate || null,
        deliveryCondition: deliveryOutcome === 'delivered_successfully' ? deliveryCondition : null,
        notes: deliveryNotes.trim() || null,
      }
    );
    setShowDeliveryResultModal(false);
    setDeliveryResultTask(null);
    await load();
  } catch (err: any) { 
    setDeliveryError(err?.message || 'تعذر حفظ نتيجة التسليم'); 
  }
  finally { setSavingDelivery(false); }
};
```

**ملاحظة:** إذا `visitTaskId` مش موجود (null) → أعرض خطأ: "لم يتم ربط المهمة بـ النظام الموحد بعد".

---

### 4. Frontend (إضافي): أخفّي الزر إذا `!visitTaskId`

بـ JSX يلي بيظهر زر "تسجيل نتيجة التسليم":
```tsx
{task.visitTaskId && (
  <button onClick={() => { setDeliveryResultTask(task); setShowDeliveryResultModal(true); }}>
    تسجيل نتيجة التسليم
  </button>
)}
{!task.visitTaskId && (
  <span className="text-amber-500 text-xs">المهمة غير مربوطة بالنظام الموحد</span>
)}
```

---

## التحقق بعد التعديل

1. افتح زيارة فيها `device_delivery`.
2. اضغط "تسجيل نتيجة تسليم الجهاز".
3. حدد النتيجة → احفظ.
4. تأكد:
   - ✅ `visit_tasks.status` = `completed` (أو `not_completed`)
   - ✅ `field_visits.status` تحدّث (مثلاً `completed` إذا كل المهام خلصت)
   - ✅ الزر بيختفي بعد الحفظ
   - ✅ `visit_task_device_delivery_results` فيه البيانات

---

## قيود
- لا تحذف `api.openTasks.saveDeliveryResult` من `api.ts` — ممكن يُستخدم بأماكن تانية.
- هاد التعديل بس لـ `MarketingVisitDetailsPage.tsx`.
- إذا فيه أماكن تانية بتستخدم `saveDeliveryResult` (مثلاً `PostSaleStepper.tsx`) → هنّي بدهن برومptz منفصل.
