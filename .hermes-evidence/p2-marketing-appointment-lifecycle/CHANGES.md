# CHANGES — P2 Marketing Appointment Lifecycle

## الملفات التي راجعتها

| الملف | الغرض |
|-------|--------|
| `packages/shared/types.ts` | تعريف الأنواع الكاملة |
| `packages/shared/telemarketingOutcomes.ts` | OUTCOME_MAP و opensAppointment و itemStatusAfterSave |
| `packages/api/routes/contactTargets.ts` | دورة contact_target |
| `packages/api/routes/telemarketing.ts` | generate-from-plan + POST /appointments |
| `packages/api/routes/marketingVisits.ts` | تسجيل النتيجة (legacy + canonical) |
| `packages/api/services/planningMarketingTargets.ts` | استعلام التخطيط |
| `packages/web/src/components/telemarketing/AppointmentSchedulerModal.tsx` | UI الحجز |
| `packages/web/src/components/telemarketing/OutcomeRecorderModal.tsx` | UI تسجيل المكالمة |
| `packages/web/src/hooks/useTelemarketingStore.ts` | Store الحجز |
| `packages/web/src/pages/TelemarketerWorkspace.tsx` | الـ orchestration الكامل في الواجهة |
| `packages/web/src/pages/planning/PlanningContactTargets.tsx` | عرض حالة جهات الاتصال |

---

## التعديلات الفعلية

### 1. `packages/shared/types.ts` — إضافة `ContactTargetStatus` type

**السبب:** `contact_targets.status` كانت تُكتَب وتُقرأ بـ `string` خام في كل مكان. لا يوجد نوع TypeScript يجمعها.

```typescript
// مضاف
export type ContactTargetStatus =
  | 'new'       // created, not yet added to a call list
  | 'queued'    // added to today's call list via generate-from-plan
  | 'contacted' // call made, no appointment booked
  | 'booked'    // appointment created — terminal for telemarketing flow
  | 'closed';   // not interested / service request / no action needed
```

مع comment يوضّح أن `'in_call_list'` هو legacy alias لـ `'queued'`، و`'cancelled'` لا يوجد له مسار كتابة.

**لا يُغيّر أي سلوك** — type declaration خالصة.

---

### 2. `packages/web/src/pages/planning/PlanningContactTargets.tsx` — تنظيف labels

**السبب:**  
- `'cancelled'` كان في labels لكن **لا يوجد أي كود يكتب هذه القيمة** في `contact_targets.status`. إزالته تمنع ظهور تعليق وهمي في الواجهة.  
- `'in_call_list'` أُبقي مع comment يوضّح أنه legacy لسجلات قديمة.

```diff
  const contactTargetStatusLabels: Record<string, string> = {
      new: 'جديد',
      queued: 'بالانتظار',
-     in_call_list: 'ضمن قائمة اتصال',
+     in_call_list: 'ضمن قائمة اتصال', // legacy alias for 'queued' — kept for old DB records
      contacted: 'تم الاتصال',
      booked: 'تم حجز موعد',
      closed: 'مغلق',
-     cancelled: 'ملغى',
  };
```

---

## التوصيات (بدون تعديل كود)

### أ) `contact_targets.status` لا يتحدث بعد 'booked'
لا يوجد كود يُحدّث `contact_target.status` بعد إنشاء `marketing_visit`. حتى لو انتهت الزيارة بـ `completed` أو `cancelled`، يبقى `'booked'`.

**التوصية:** إضافة تحديث لـ `contact_target.status` في نهاية `applyTaskOutcome` و`applyTaskResult`:
```typescript
// في نهاية applyTaskOutcome (إذا كانت النتيجة نهائية)
if (outcome === 'device_sold' || outcome === 'offer_presented') {
  await pgClient.query(`UPDATE contact_targets SET status = 'closed' WHERE id = $1`, [contactTargetId]);
}
```
**لم يُنفَّذ** — يحتاج تحليل أثر أعمق على صفحات التخطيط.

### ب) `'assigned'` في `ACTIVE_OPEN_TASK_STATUSES` — ghost status
```typescript
// contactTargets.ts:9
const ACTIVE_OPEN_TASK_STATUSES = ['open', 'assigned', 'scheduled', ...];
//                                          ^^^^^^^^ — لا يوجد في OpenTaskStatus type
//                                                     وصفر سجل في DB
```
**التوصية:** إزالة `'assigned'` أو إضافته لـ `OpenTaskStatus` إذا كان مقصوداً.

### ج) `marketing_visit.status = 'ended'` — transition غير مُنفَّذ عملياً
الـ `/status` endpoint يدعم `in_visit → ended`، لكن لا يوجد سجل واحد بحالة `'ended'` في DB. الفرق الميداني يستخدم legacy `/result` مباشرة (يقفز من `in_visit` → `completed`).

**التوصية:** إذا كان المسار الجديد (`ended → /outcome`) هو الـ canonical، يجب إضافة guard على legacy `/result` يمنع الوصول بدون المرور بـ `ended`.
