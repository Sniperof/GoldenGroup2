# خطة إصلاح فجوات دومين "نتيجة مهمة عرض الجهاز"

> تاريخ الإنشاء: 2026-05-21
> المرجع: مراجعة شاملة لـ Device Demo Result domain
> الحالة: قيد التطبيق
> الملفات المرجعية: packages/api/routes/marketingVisits.ts · packages/api/routes/openTasks.ts · packages/shared/types.ts · migrations/070, 088, 089

---

## 1. خلفية المراجعة

أجرينا مراجعة كاملة لدومين "نتيجة مهمة عرض الجهاز" شملت:
- دستور المهام (`docs/constitution/domains/tasks.md`)
- الـ Types (`packages/shared/types.ts`)
- Backend routes: `openTasks.ts`, `marketingVisits.ts`
- migrations: 070, 088, 089
- Frontend: `MarketingVisitOutcomeModal.tsx`, `OutcomeRecorderModal.tsx`

كشفت المراجعة عن **8 فجوات** مصنفة بالأولوية أدناه.

---

## 2. الفجوات المكتشفة (مرتبة بالأولوية)

### 🔴 F1 — `visit_task_device_demo_results` ناقصة (حرجة)

**المشكلة**: جدول النواة `visit_task_device_demo_results` (migration 070 + 088 + 089) لا يحفظ الحقول التالية الموجودة في `marketing_visit_tasks`:
- `contract_id` — رابط العقد
- `currency` — العملة
- `sold_device_model_id` — الجهاز المباع (عند device_sold)
- `offered_device_model_id` — الجهاز المعروض
- `no_closing_reason` — سبب عدم الإغلاق
- `outcome` — النتيجة الجديدة (offer_presented / device_sold / rescheduled / cancelled)
- `cancellation_reason_id` — سبب الإلغاء
- `reschedule_reason_id` — سبب إعادة الجدولة

**التأثير**: الـ Strangler Bridge يكتب بيانات منقوصة — عند الانتقال الكامل للنظام الجديد ستُفقد هذه الحقول.

**الحل**: migration جديد يضيف الأعمدة الناقصة + تحديث `applyTaskOutcome()` لكتابتها.

---

### 🔴 F2 — لا إنشاء تلقائي للعقد عند البيع (حرجة)

**المشكلة**: عند تسجيل `device_sold` أو `offer_presented` مع رد `accepted`، لا توجد آلية تلقائية لإنشاء العقد. `marketing_visit_tasks.contract_id` يبقى NULL.

**التأثير**: المشرف يجب أن يُنشئ العقد يدوياً ويربطه — خطر فقدان الربط بين البيع والعقد.

**الحل المقترح**: ليس بالضرورة إنشاء تلقائي كامل (معقد)، لكن على الأقل:
- إضافة **رابط مباشر** من نتيجة المهمة لصفحة إنشاء العقد مع تعبئة مسبقة للحقول
- أو رفع تنبيه للمشرف بأن هذه الزيارة تحتاج عقداً

---

### 🔴 F3 — `device_sold` لا يُعطي `legacyResult` (حرجة عملياً)

**المشكلة**: في `applyTaskOutcome()`:
```typescript
// outcome = 'offer_presented' + cash  → legacyResult = 'cash_offer_not_closed'
// outcome = 'offer_presented' + inst  → legacyResult = 'installment_offer_not_closed'
// outcome = 'device_sold'             → legacyResult = null  ← المشكلة
// outcome = 'rescheduled'             → legacyResult = null
// outcome = 'cancelled'               → legacyResult = null
```

`marketing_visit_tasks.result` يبقى NULL لمهام البيع المباشر.

**التأثير**: أي كود أو تقرير يعتمد على حقل `result` لمعرفة نتيجة البيع سيجد NULL.

**الحل**: تعيين `legacyResult = 'cash_offer_closed'` أو `'installment_offer_closed'` عند `device_sold`، أو توثيق صريح بأن `result` يُهمل عند وجود `outcome`.

---

### 🟡 F4 — `rescheduled` يضع المهمة الأصلية كـ `completed` (مهمة)

**المشكلة**: في `applyTaskOutcome()` (السطر 1711-1714):
```typescript
const newOpenTaskStatus =
  outcome === 'cancelled'
    ? 'cancelled'
    : 'completed';  // rescheduled + offer_presented + device_sold كلها → completed
```

عند `rescheduled`، المهمة الأصلية تُحدَّث إلى `completed` ثم تُنشأ مهمة جديدة بـ `needs_follow_up`.

**هذا تصميم متعمد** (Close-and-Create pattern)، لكن:
- يُشوّه تقارير نسب النجاح: مهام `rescheduled` تُحسب ضمن `completed`
- يختلف عن Legacy `applyTaskResult` الذي كان يُعيد المهمة نفسها إلى `needs_follow_up`

**الحل**: إما:
1. إضافة `closeReason` إلى `open_tasks` لتمييز `completed-by-rescheduling` من `completed-by-sale`
2. أو قبول التصميم الحالي + توثيقه في الدستور + تصحيح التقارير لتستثني المهام ذات `origin_ref_id IS NOT NULL` (المهام الناتجة عن reschedule)

---

### 🟡 F5 — Frontend يرسل `needs_reschedule` بينما API يقبل `rescheduled` (مهمة)

**المشكلة**: في `MarketingVisitOutcomeModal.tsx`:
```typescript
value: 'needs_reschedule'  // القيمة في الـ OUTCOME_OPTIONS
```

بينما `applyTaskOutcome()`:
```typescript
const VALID_OUTCOMES = new Set(['offer_presented', 'device_sold', 'rescheduled', 'cancelled'])
```

**يحتاج تحقق**: هل يوجد mapping في api call قبل الإرسال؟ إذا لم يكن، الـ API سيرفض الطلب.

**الحل**: مواءمة القيم — إما Frontend يرسل `rescheduled` أو Backend يقبل كليهما.

---

### 🟡 F6 — `REJECTION_REASON_OPTIONS` ثابتة في الكود (مهمة)

**المشكلة**: في `MarketingVisitOutcomeModal.tsx`:
```typescript
const REJECTION_REASON_OPTIONS: PlaceholderReasonOption[] = [
  { id: 1, label: 'السعر مرتفع' },
  { id: 2, label: 'الجودة غير مرضية' },
  { id: 3, label: 'الزبون غير مهتم' },
  { id: 4, label: 'سبب آخر' },
];
```

أسباب الرفض hardcoded، لا تُجلب من `system_lists`.

**التأثير**: المدير لا يستطيع إدارة أسباب الرفض من الإدارة.

**الحل**: جلب الأسباب من `system_lists` بـ category = `device_demo_rejection_reason` (تُنشأ عبر seed migration).

---

### 🟠 F7 — صلاحية واحدة تُغطي كل العمليات (تحسينية)

**المشكلة**: `marketing_visits.update_result` تُغطي:
- تسجيل النتيجة (`PATCH /outcome`)
- الإقفال النهائي (`POST /close`)
- تعيين الفريق (`PATCH /team`)
- تحديث الحالة (`PATCH /status`)

**التأثير**: لا يمكن إعطاء الموظف الميداني صلاحية تسجيل نتيجة دون إعطائه صلاحية الإقفال.

**الحل**: فصل `marketing_visits.close` كصلاحية مستقلة على المدى البعيد.

---

### 🟠 F8 — `applyTaskResult()` deprecated لكن endpoint لا يزال فعّالاً (تحسينية)

**المشكلة**:
```typescript
/** @deprecated Use applyTaskOutcome and the /outcome endpoint for new clients. */
async function applyTaskResult(req, res, visit, task) { ... }

router.patch('/:id/result', ...) // يستدعي applyTaskResult
router.patch('/:visitId/tasks/:taskId/result', ...) // يستدعي applyTaskResult
```

Endpoint قديم لا يزال يعمل ويُكتب البيانات بالطريقة القديمة.

**الحل**: وضع خطة إيقاف تدريجي + التأكد من أن كل الـ clients انتقلوا لـ `/outcome`.

---

## 3. خطة التطبيق

### المرحلة الأولى — إصلاحات حرجة (يجب تطبيقها معاً)

**T1. Migration: إكمال `visit_task_device_demo_results`**

ملف: `migrations/XXX_complete_device_demo_results.sql`

```sql
ALTER TABLE visit_task_device_demo_results
  ADD COLUMN IF NOT EXISTS contract_id INTEGER REFERENCES contracts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS currency VARCHAR(10) DEFAULT 'SYP',
  ADD COLUMN IF NOT EXISTS sold_device_model_id INTEGER REFERENCES device_models(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS offered_device_model_id INTEGER REFERENCES device_models(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS no_closing_reason TEXT,
  ADD COLUMN IF NOT EXISTS outcome VARCHAR(20)
    CHECK (outcome IN ('offer_presented', 'device_sold', 'rescheduled', 'cancelled')),
  ADD COLUMN IF NOT EXISTS cancellation_reason_id INTEGER REFERENCES system_lists(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reschedule_reason_id INTEGER REFERENCES system_lists(id) ON DELETE SET NULL;
```

**T2. Backend: تحديث `applyTaskOutcome()` لكتابة الحقول الجديدة في `visit_task_device_demo_results`**

ملف: `packages/api/routes/marketingVisits.ts`

في الجزء المسؤول عن `visit_task_device_demo_results` (السطر ~870+)، إضافة:
- `outcome`
- `currency`
- `sold_device_model_id` (عند device_sold)
- `offered_device_model_id` (عند offer_presented)
- `no_closing_reason` (من primaryOffer)
- `cancellation_reason_id` (عند cancelled)
- `reschedule_reason_id` (عند rescheduled)

**T3. Backend: إصلاح `legacyResult` لـ `device_sold`**

ملف: `packages/api/routes/marketingVisits.ts`، الجزء (السطر ~1527-1531):

```typescript
// قبل:
if (outcome === 'offer_presented' && legacyOfferType === 'cash') legacyResult = 'cash_offer_not_closed';
else if (outcome === 'offer_presented' && legacyOfferType === 'installment') legacyResult = 'installment_offer_not_closed';

// بعد: إضافة mapping لـ device_sold
if (outcome === 'device_sold') legacyResult = 'cash_offer_closed'; // أو تحديد بناءً على offer type
else if (outcome === 'offer_presented' && legacyOfferType === 'cash') legacyResult = 'cash_offer_not_closed';
else if (outcome === 'offer_presented' && legacyOfferType === 'installment') legacyResult = 'installment_offer_not_closed';
```

---

### المرحلة الثانية — إصلاحات مهمة

**T4. Frontend: مواءمة `needs_reschedule` ↔ `rescheduled`**

ملف: `packages/web/src/components/marketing-visits/MarketingVisitOutcomeModal.tsx`

تحقق من الـ api call وتأكيد أن القيمة المُرسلة `rescheduled` (وليس `needs_reschedule`).
إذا كانت المشكلة في `OUTCOME_OPTIONS`، تصحيح القيمة:
```typescript
value: 'rescheduled',  // بدل 'needs_reschedule'
```

**T5. Frontend: جلب أسباب الرفض من system_lists**

ملف: `packages/web/src/components/marketing-visits/MarketingVisitOutcomeModal.tsx`

استبدال `REJECTION_REASON_OPTIONS` الثابتة بـ `useSystemList('device_demo_rejection_reason')`.
مطلوب أيضاً: seed migration لإضافة الأسباب الأولية في `system_lists`.

**T6. توثيق سلوك `rescheduled` في الدستور**

ملف: `docs/constitution/domains/tasks.md`

إضافة قسم يوضح:
- Close-and-Create pattern عند `rescheduled`
- المهمة الأصلية → `completed` (مُغلقة بنتيجة "إعادة جدولة")
- مهمة جديدة تُنشأ بـ `needs_follow_up` مع `origin_ref_id` يشير للمهمة الأصلية
- في التقارير: التمييز بين `completed` الحقيقي و`completed` الناتج عن reschedule

---

### المرحلة الثالثة — تحسينات

**T7. UX: رابط إنشاء عقد من نتيجة المهمة**

بعد تسجيل `device_sold` أو `offer_presented` مع قبول، إضافة:
- زر "إنشاء عقد" يفتح `ContractForm` مع تعبئة مسبقة من بيانات الزيارة
- أو تنبيه مرئي للمشرف أن هذه المهمة تحتاج عقداً

**T8. توثيق خطة إيقاف `applyTaskResult()`**

- تأكيد أن كل الـ clients انتقلوا لـ `/outcome`
- إضافة warning log عند استدعاء `/result` endpoint
- تحديد موعد لإيقافه

---

## 4. الملفات المتأثرة

| الملف | العمليات المطلوبة |
|-------|-----------------|
| `migrations/XXX_complete_device_demo_results.sql` | ✏️ إنشاء جديد (T1) |
| `packages/api/routes/marketingVisits.ts` | ✏️ تحديث applyTaskOutcome (T2, T3) |
| `packages/web/src/components/marketing-visits/MarketingVisitOutcomeModal.tsx` | ✏️ مواءمة outcome value + system_lists (T4, T5) |
| `docs/constitution/domains/tasks.md` | ✏️ توثيق Close-and-Create (T6) |
| `packages/web/src/pages/MarketingVisitDetailsPage.tsx` | ✏️ رابط إنشاء عقد (T7) |

---

## 5. ترتيب التطبيق المقترح

```
T3 → T2 → T1   (backend أولاً — إصلاح البيانات)
         ↓
T4 → T5         (frontend)
         ↓
T6              (توثيق)
         ↓
T7 → T8         (تحسينات UX وإيقاف legacy)
```

لكل T: قراءة الملف أولاً، التعديل، اختبار على staging، commit منفصل.

---

## 6. الحالة الحالية لكل مهمة

| المهمة | الحالة | ملاحظات |
|--------|--------|---------|
| T1 | ⬜ لم تبدأ | migration ناقص |
| T2 | ⬜ لم تبدأ | يعتمد على T1 |
| T3 | ⬜ لم تبدأ | مستقل |
| T4 | ⬜ لم تبدأ | يحتاج تحقق أولاً |
| T5 | ⬜ لم تبدأ | يحتاج seed migration |
| T6 | ⬜ لم تبدأ | توثيق فقط |
| T7 | ⬜ لم تبدأ | يعتمد على T1, T2 |
| T8 | ⬜ لم تبدأ | تحسين |

---

## 7. سجل التغييرات

| التاريخ | الإجراء | من |
|---------|---------|-----|
| 2026-05-21 | إنشاء الخطة بعد مراجعة domain كاملة | Ibrahim + Claude |
