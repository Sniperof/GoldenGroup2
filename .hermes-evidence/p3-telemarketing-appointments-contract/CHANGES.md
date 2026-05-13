# CHANGES — P3 Telemarketing Appointments Contract

## الملفات التي راجعتها

| الملف | ما تم فحصه |
|-------|-----------|
| `packages/api/routes/telemarketing.ts` | POST /appointments كاملاً: validation، task linkage، silent fails، bypass paths |
| `packages/api/routes/marketingVisits.ts` | applyTaskResult (legacy) + applyTaskOutcome (canonical) — task_type filtering |
| `packages/web/src/components/telemarketing/AppointmentSchedulerModal.tsx` | isValid condition، waterSource gate، selectedTasks logic |
| `packages/web/src/pages/TelemarketerWorkspace.tsx` | handleSaveAppointment، UI gating، opensAppointment check |
| `packages/web/src/hooks/useTelemarketingStore.ts` | addAppointment، payload building |
| `packages/shared/telemarketingOutcomes.ts` | opensAppointment flag في OUTCOME_MAP |
| `packages/api/services/planningMarketingTargets.ts` | استعلام التخطيط وشرط device_demo |

---

## تعديلات الكود في هذه الجلسة

**لا تعديلات** — هذه جلسة تدقيق وتوثيق.

جميع الـ gaps الموثَّقة هي مشاكل تصميمية تحتاج قراراً قبل الإصلاح، ليست أخطاء يُمكن إصلاحها بتغيير سطر.

---

## التوصيات

### أ) توثيق العقد رسمياً في الكود

```typescript
// telemarketing.ts — عند بداية POST /appointments handler
// Contract: Booking requires a valid task list item and no time conflict.
// open_task linkage is OPTIONAL — booking succeeds without it.
// task_type is NOT validated — any value is accepted.
// Silent behaviors:
//   - open_task status update skipped if not 'in_contact_list'
//   - marketing_visit not created if entity_type !== 'client' or branchId === null
```

### ب) إضافة validation على task_type (اختياري حسب القرار)

```typescript
// اقتراح إذا تقرّر تقييد الحجز بـ device_demo:
const BOOKABLE_TASK_TYPES = new Set(['device_demo']);
for (const task of rawSelectedTasks) {
  if (task.taskType && !BOOKABLE_TASK_TYPES.has(task.taskType)) {
    return res.status(400).json({
      error: `task_type '${task.taskType}' cannot be booked as a marketing appointment`
    });
  }
}
```

**لم يُنفَّذ** — يحتاج قرار نهائي حول emergency_maintenance في مسار التلمارك.

### ج) إصلاح legacy applyTaskResult لدعم non-device_demo

```typescript
// marketingVisits.ts:432-436 — بدلاً من البحث عن device_demo فقط:
const legacyTask = (visit.tasks || []).find((t: any) => t.taskType === 'device_demo')
                ?? (visit.tasks || [])[0]; // fallback للمهمة الأولى

// أو: تمرير taskId صريح من الـ request body
```

**لم يُنفَّذ** — endpoint مُعلَّم @deprecated ومن المقرر استبداله بـ /outcome.

### د) توثيق legacy upsert كـ deprecated path

```typescript
// telemarketing.ts:797
// LEGACY: this endpoint does NOT set open_task_id on items.
// All items created here will have open_task_id=NULL.
// Appointments from these items will have no open_task linkage.
// Use generate-from-plan instead.
```

---

## ملاحظة: لا تعديل على production

كل التحليل تم على staging. لم يُلمَس production.
