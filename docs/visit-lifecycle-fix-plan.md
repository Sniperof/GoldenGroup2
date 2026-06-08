# خطة تصحيح دورة حياة الزيارة التسويقية

> **الحالة:** مسودة معتمدة
> **تاريخ الإعداد:** 2026-05-11
> **الملف المرجعي:** `docs/visit-lifecycle-contract.md`

---

## 1. النموذج الصحيح المستهدف

### 1.1 مراحل الزيارة (Visit Stage)

| المرحلة | القيمة | كيف تحدث | نهائية؟ |
|---|---|---|---|
| مجدولة | `scheduled` | عند إنشاء الزيارة | لا |
| ضمن الزيارة | `in_visit` | زر "بدء الزيارة" (فقط إذا اليوم = يوم الموعد) | لا |
| انتهت | `ended` | زر "إنهاء الزيارة" | لا |
| ملغاة | `cancelled` | أكشن يدوي — الموعد أُلغي لم يُنفَّذ | ✅ نعم |
| مؤجلة | `rescheduled` | أكشن يدوي — الموعد أُجِّل لم يُنفَّذ | ✅ نعم |

### 1.2 حالة الاكتمال (Completion State)

تُحسب تلقائياً، تنطبق فقط بعد `ended`.

| الحالة | القيمة | متى تُطبَّق |
|---|---|---|
| مكتملة | `completed` | كل المهام لها `outcome` |
| غير مكتملة | `not_completed` | بعض المهام لا تزال `pending` |

### 1.3 نتائج المهام (Task Outcome)

| النتيجة | task.status | تأثير على open_task | تأثير على visit.stage |
|---|---|---|---|
| `offer_presented` | `completed` | `completed` | **لا تغيير** |
| `device_sold` | `completed` | `completed` | **لا تغيير** |
| `rescheduled` | `not_completed` | `needs_reschedule` + open_task جديد | **لا تغيير** |
| `cancelled` | `not_completed` | `cancelled` | **لا تغيير** |

### 1.4 القاعدة الذهبية

```
المرحلة (stage)    ← يغيّرها الإنسان فقط (أزرار بدء / إنهاء / إلغاء / تأجيل)
حالة الاكتمال     ← تُحسب تلقائياً من المهام، لا يغيّرها أحد يدوياً
نتيجة المهمة      ← تغيّر المهمة والـ open_task فقط، لا تلمس stage الزيارة
```

---

## 2. الفرق بين تأجيل الزيارة وتأجيل المهمة

| | تأجيل الزيارة (Visit-level) | تأجيل المهمة (Task-level) |
|---|---|---|
| **السيناريو** | الفريق ما ذهب للموعد أصلاً | الزيارة تمت، المهمة تحتاج متابعة |
| **من يُشغِّله** | أكشن على الزيارة | نتيجة مهمة `rescheduled` |
| **visit.stage** | `rescheduled` (نهائية) | يبقى `ended` |
| **open_task القديم** | `needs_reschedule` | `completed` |
| **open_task جديد** | لا (المهمة ترجع للـ queue) | نعم، بتاريخ المتابعة |

---

## 3. السيناريوهات الكاملة

### سيناريو A — زيارة عادية تمت بنجاح
```
scheduled → in_visit → ended
→ تسجيل نتيجة المهمة: offer_presented أو device_sold
→ كل المهام لها outcome AND visit.stage = ended
→ visit.status AUTO = completed
```

### سيناريو B — تأجيل الزيارة (الفريق ما راح)
```
scheduled (أو in_visit) → rescheduled
→ modal يظهر: سبب + تحديث أولوية وتاريخ كل مهمة
→ open_tasks → needs_reschedule (مع priority و due_date جديدين)
→ visit.stage = rescheduled (نهائية لهذا الموعد)
```

### سيناريو C — إلغاء الزيارة
```
scheduled (أو in_visit) → cancelled
→ modal يظهر: سبب + تحديث أولوية وتاريخ كل مهمة
→ open_tasks → open (ترجع للـ queue العادية)
→ visit.stage = cancelled (نهائية)
```

### سيناريو D — زيارة تمت، مهمة تحتاج متابعة
```
scheduled → in_visit → ended
→ تسجيل نتيجة المهمة: rescheduled
→ task.status = not_completed
→ open_task القديم → completed
→ open_task جديد بتاريخ المتابعة
→ visit.stage يبقى ended
→ completion_state = not_completed (مهمة ناقصة)
```

### سيناريو E — فريق لديه 12 زيارة نفّذ 8 فقط
```
8 زيارات → ended + completed
4 زيارات → rescheduled (تأجيل visit-level)
          → open_tasks الـ 4 → needs_reschedule
          → كل مهمة تأخذ أولوية وتاريخ استحقاق من الـ modal
```

---

## 4. المشاكل الحالية في الكود

| # | المشكلة | الملف | السطر |
|---|---|---|---|
| 1 | `applyTaskOutcome()` تغير `visit.status` مباشرة عند تسجيل نتيجة أي مهمة | `api/routes/marketingVisits.ts` | ~1147 |
| 2 | لا يوجد endpoint لتأجيل أو إلغاء الزيارة كاملة مع تحديث المهام | `api/routes/marketingVisits.ts` | — |
| 3 | `ALLOWED_TRANSITIONS` لا تشمل `cancelled` و `rescheduled` | `api/routes/marketingVisits.ts` | ~763 |
| 4 | `MarketingVisitOutcomeModal` يرسل `status` للزيارة من الـ frontend | `web/components/marketing-visits/MarketingVisitOutcomeModal.tsx` | ~690 |
| 5 | `MarketingVisitResultModal` القديم يخلط حالات الزيارة مع نتائج المهام | `web/components/marketing-visits/MarketingVisitResultModal.tsx` | ~30 |
| 6 | `MarketingVisitStatus` type تخلط المراحل مع حالات الاكتمال | `shared/types.ts` | ~363 |
| 7 | `open_task.priority` لا يُعاد في بيانات الزيارة من الـ API | `api/routes/marketingVisits.ts` | `buildVisitSelect()` |

---

## 5. خطة التنفيذ بالأولويات

---

### 🔴 P1 — حرج، ينفَّذ أولاً

#### P1-A: إصلاح `applyTaskOutcome()` — فصل نتيجة المهمة عن stage الزيارة

**الملف:** `packages/api/routes/marketingVisits.ts`

**التغيير:**
- حذف السطر الذي يُحدِّث `marketing_visits.status` بناءً على `outcome`
- استبداله بمنطق الاكتمال التلقائي:
  - بعد حفظ المهمة: تحقق — هل كل المهام لها `outcome`؟
  - إذا نعم AND `visit.status = 'ended'` → حوِّل الزيارة لـ `completed` تلقائياً
  - إذا لا → لا تغيير على `visit.status`

```typescript
// بعد UPDATE marketing_visit_tasks
const { rows: pending } = await pgClient.query(
  `SELECT COUNT(*) FROM marketing_visit_tasks
   WHERE visit_id = $1 AND outcome IS NULL`,
  [visit.id]
);
const allDone = Number(pending[0].count) === 0;

if (allDone) {
  const { rows: stageRows } = await pgClient.query(
    `SELECT status FROM marketing_visits WHERE id = $1`, [visit.id]
  );
  if (stageRows[0]?.status === 'ended') {
    await pgClient.query(
      `UPDATE marketing_visits
       SET status = 'completed', completed_by = $1, completed_at = NOW(), updated_at = NOW()
       WHERE id = $2`,
      [completedBy, visit.id]
    );
  }
}
```

---

#### P1-B: إضافة `PATCH /:id/reschedule` و `PATCH /:id/cancel`

**الملف:** `packages/api/routes/marketingVisits.ts`

**Request Body المشترك:**
```typescript
{
  // reschedule فقط:
  rescheduleReasonId?: number,
  // cancel فقط:
  cancellationReasonId?: number,
  // مشترك:
  notes?: string,
  taskUpdates: Array<{
    openTaskId: number,
    priority: 'high' | 'medium' | 'low',  // مطلوب، يأتي من القيمة الحالية
    dueDate?: string | null               // اختياري YYYY-MM-DD
  }>
}
```

**Logic الـ Backend:**
```typescript
// 1. تحقق من الانتقال المسموح
// reschedule: scheduled أو in_visit فقط
// cancel: scheduled أو in_visit فقط

// 2. حدّث الزيارة
UPDATE marketing_visits
SET status = 'rescheduled' | 'cancelled', updated_at = NOW()
WHERE id = $1

// 3. لكل مهمة في taskUpdates
UPDATE open_tasks
SET priority   = $1,
    due_date   = COALESCE($2::date, due_date),
    status     = 'needs_reschedule' | 'open',
    updated_at = NOW()
WHERE id = $3

// سجّل في task_activity_log

// 4. إذا reschedule: open_tasks → needs_reschedule
//    إذا cancel:     open_tasks → open
```

---

#### P1-C: إضافة `openTaskPriority` لـ `buildVisitSelect()`

**الملف:** `packages/api/routes/marketingVisits.ts`

نحتاج نرجع أولوية الـ open_task مع بيانات المهمة حتى يعرض الـ frontend القيمة الافتراضية في الـ modal.

```sql
LEFT JOIN open_tasks ot ON ot.id = mvt.source_open_task_id
-- في SELECT:
ot.priority AS "openTaskPriority",
ot.due_date AS "openTaskDueDate"
```

---

### 🟠 P2 — مهم، ينفَّذ بعد P1

#### P2-A: بناء `RescheduleVisitModal` و `CancelVisitModal`

**الملف الجديد:** `packages/web/src/components/marketing-visits/RescheduleVisitModal.tsx`
**الملف الجديد:** `packages/web/src/components/marketing-visits/CancelVisitModal.tsx`

**هيكل الـ Modal:**
1. **خطوة 1:** السبب (dropdown من system_lists)
2. **خطوة 2:** لكل مهمة مرتبطة:
   - اسم المهمة + اسم الزبون (read-only)
   - الأولوية: radio buttons (عالية / متوسطة / منخفضة) — default = القيمة الحالية
   - تاريخ الاستحقاق: date picker — اختياري، فاضي افتراضياً
3. **خطوة 3:** ملاحظات اختيارية + تأكيد

**السلوك الافتراضي:**
- الأولوية تأخذ قيمتها من `task.openTaskPriority` (القادمة من P1-C)
- تاريخ الاستحقاق فاضي، إذا تُرك فاضياً يُحافظ على القيمة القديمة

---

#### P2-B: إضافة أزرار التأجيل والإلغاء في `MarketingVisitDetailsPage`

**الملف:** `packages/web/src/pages/MarketingVisitDetailsPage.tsx`

```typescript
// يظهران عندما:
// visit.status === 'scheduled' || visit.status === 'in_visit'

{canUpdateMarketingVisitResult && ['scheduled', 'in_visit'].includes(visit.status) && (
  <>
    <button onClick={() => setShowRescheduleModal(true)}>
      تأجيل الموعد
    </button>
    <button onClick={() => setShowCancelModal(true)}>
      إلغاء الموعد
    </button>
  </>
)}
```

---

#### P2-C: تنظيف `ALLOWED_TRANSITIONS`

**الملف:** `packages/api/routes/marketingVisits.ts` السطر ~763

```typescript
const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  scheduled: ['in_visit'],           // بدء الزيارة
  in_visit:  ['ended'],              // إنهاء الزيارة
  // cancelled و rescheduled تُعالَج في endpoints مستقلة
};
```

---

#### P2-D: إزالة `status` من payload في `MarketingVisitOutcomeModal`

**الملف:** `packages/web/src/components/marketing-visits/MarketingVisitOutcomeModal.tsx` السطر ~690

```typescript
// ❌ احذف هذا
status: wizardState.overallOutcome === 'device_sold'
  ? 'completed'
  : wizardState.overallOutcome === 'rescheduled'
    ? 'needs_reschedule'
    : 'cancelled',

// ✅ الـ backend يحسب visit.status تلقائياً
```

---

### 🟡 P3 — تنظيف، ينفَّذ بعد استقرار P1 و P2

#### P3-A: تنظيف `MarketingVisitStatus` في shared/types.ts

**الملف:** `packages/shared/types.ts` السطر ~363

```typescript
// المراحل التشغيلية
export type MarketingVisitStage =
  | 'scheduled'
  | 'in_visit'
  | 'ended'
  | 'cancelled'
  | 'rescheduled';

// حالة الاكتمال (بعد ended فقط)
export type MarketingVisitCompletionState =
  | 'completed'
  | 'not_completed'
  | null;

// للتوافق مع الكود الموجود مؤقتاً
export type MarketingVisitStatus =
  | MarketingVisitStage
  | 'completed'
  | 'not_completed';

// تُحذف نهائياً:
// 'postponed_by_company'  → استبدلت بـ rescheduled + reason
// 'postponed_by_customer' → استبدلت بـ rescheduled + reason
// 'needs_reschedule'      → نتيجة مهمة وليست حالة زيارة
```

#### P3-B: إهمال `MarketingVisitResultModal`

**الملف:** `packages/web/src/pages/MarketingVisitDetailsPage.tsx`

- إزالة كل الكود المرتبط بـ `selectedTask` و `MarketingVisitResultModal`
- الـ `MarketingVisitOutcomeModal` هو الوحيد المعتمد
- إهمال `applyTaskResult()` في الـ backend (تركها موجودة لكن غير مستخدمة من الـ UI)

#### P3-C: تحديث `visit-lifecycle-contract.md`

تحديث الوثيقة لتعكس النموذج النهائي المُصحَّح.

---

## 6. ملخص الأولويات

```
🔴 P1  (ينفَّذ أولاً — يحل المشكلة الجوهرية)
   ├── P1-A: إصلاح applyTaskOutcome — فصل نتيجة المهمة عن stage الزيارة
   ├── P1-B: إضافة PATCH /:id/reschedule و /:id/cancel مع taskUpdates
   └── P1-C: إضافة openTaskPriority و openTaskDueDate في buildVisitSelect

🟠 P2  (ينفَّذ بعد P1 — يكمل الـ UI)
   ├── P2-A: بناء RescheduleVisitModal و CancelVisitModal
   ├── P2-B: إضافة أزرار التأجيل والإلغاء في MarketingVisitDetailsPage
   ├── P2-C: تنظيف ALLOWED_TRANSITIONS
   └── P2-D: إزالة status من payload في MarketingVisitOutcomeModal

🟡 P3  (تنظيف — بعد استقرار P1 و P2)
   ├── P3-A: تنظيف MarketingVisitStatus type
   ├── P3-B: إهمال MarketingVisitResultModal
   └── P3-C: تحديث visit-lifecycle-contract.md
```

---

## 7. الملفات المتأثرة

| الملف | نوع التغيير |
|---|---|
| `packages/api/routes/marketingVisits.ts` | تعديل + إضافة endpoints |
| `packages/shared/types.ts` | تعديل types |
| `packages/web/src/pages/MarketingVisitDetailsPage.tsx` | إضافة أزرار + modals |
| `packages/web/src/components/marketing-visits/MarketingVisitOutcomeModal.tsx` | إزالة status من payload |
| `packages/web/src/components/marketing-visits/RescheduleVisitModal.tsx` | ملف جديد |
| `packages/web/src/components/marketing-visits/CancelVisitModal.tsx` | ملف جديد |
| `docs/visit-lifecycle-contract.md` | تحديث التوثيق |
