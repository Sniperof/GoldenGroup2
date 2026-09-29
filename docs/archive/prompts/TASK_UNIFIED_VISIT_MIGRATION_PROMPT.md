# TASK: Migration كامل — من `marketing_visits` (legacy) إلى `field_visits` (canonical)

> الهدف النهائي: كل نظام الزيارات بيكون `field_visits` فقط. `marketing_visits` يُحذف بالكامل.
> الحالة: بعد تنظيف test data، الجداول legacy فاضية بس الكود لسا بيستخدمها.

---

## الخلفية المعمارية

`field_visits` هو الكيان الوحيد للزيارة. `marketing_visits` كان legacy wrapper لزيارات "التلي ماركتينج" (عرض الجهاز). هلأ إن كل المهام متساوية (عرض = تسليم = تركيب = تفعيل)، فما في داعي لـ "نوع زيارة" منفصل.

```
Before:
  marketing_visits ──► marketing_visit_tasks ──► عرض الجهاز فقط
  field_visits ──────► visit_tasks ─────────────► كل المهام التانية

After:
  field_visits ──────► visit_tasks ─────────────► كل المهام (عرض + تسليم + تركيب + تفعيل + ...)
```

---

## المرحلة 1: تجهيز `field_visits` API ليستوعب بيانات التسويق (يوم 1)

### الملف: `packages/api/routes/fieldVisits.ts`

#### 1.1 GET `/field-visits` — قائمة الزيارات

**المطلوب:** يدعم فلتر `visit_type` (marketing / post_sale / emergency) ويرجّع كلshي.

```ts
router.get('/', requirePermission('marketing_visits.view'), async (req, res) => {
  const { date, clientId, visitType } = req.query;
  // ... existing logic but extended
  // If visitType = 'marketing', include visits where source_legacy_type = 'marketing_visit'
  // or visit_type = 'marketing'
});
```

#### 1.2 GET `/field-visits/:id` — تفاصيل الزيارة

**المطلوب:** يرجّع كل البيانات يلي كانت بـ `marketingVisit`:

| البيانة | المصدر الجديد |
|---------|--------------|
| `requestedDeviceModelId` | `visit_tasks` يلي `task_type = 'device_demo'` → نقرأ `requested_device_model_id` من `open_tasks` عبر `source_open_task_id` |
| `requestedDeviceName` | نفس الطريقة أو نحط snapshot بالـ visit |
| `waterSource` | `clients.water_source` أو `visit_tasks` metadata |
| `offers` (عروض الكاش/تقسيط) | `visit_task_results.offers` (JSONB) أو جدول `visit_task_offers` جديد |
| `preOffers` | نفس الطريقة |

**Implementation:**
- جيب الـ `field_visit` بـ id
- جيب `visit_tasks` المرتبطة
- لكل `device_demo` task، جيب العروض من `visit_task_device_demo_results` أو `visit_task_results.details`
- ادمجن كلن بـ response موحد

#### 1.3 POST `/field-visits/:id/complete` — إنهاء الزيارة

**المطلوب:** لما الزيارة `completed`، يحدّث `visit_tasks` + ينقل `open_tasks` لـ `completed` (نفس منطق `marketingVisits.ts`).

---

## المرحلة 2: تجهيز `fieldVisits` API client بالـ frontend (يوم 1)

### الملف: `packages/web/src/lib/api.ts`

**المطلوب:** نضيف دوال يلي كانت بـ `marketingVisits` لـ `fieldVisits`:

```ts
fieldVisits: {
  ...existing...
  // NEW — formerly in marketingVisits
  updateResult: (visitId: number, taskId: number, data: any) =>
    request(`/field-visits/${visitId}/tasks/${taskId}/result`, { method: 'POST', body: JSON.stringify(data) }),
  updateStatus: (id: number, status: string, gps?: any) =>
    request(`/field-visits/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status, gps }) }),
  reschedule: (id: number, data: any) =>
    request(`/field-visits/${id}/reschedule`, { method: 'POST', body: JSON.stringify(data) }),
  cancel: (id: number, data: any) =>
    request(`/field-visits/${id}/cancel`, { method: 'POST', body: JSON.stringify(data) }),
  updateTeam: (id: number, data: any) =>
    request(`/field-visits/${id}/team`, { method: 'PATCH', body: JSON.stringify(data) }),
}
```

---

## المرحلة 3: نقل صفحة قائمة الزيارات (يوم 2)

### الملف: `packages/web/src/pages/MarketingVisitsPage.tsx` → `packages/web/src/pages/VisitsListPage.tsx`

**التعديلات:**
- غيّر كل `api.marketingVisits.list` لـ `api.fieldVisits.list`
- الـ response بيكون `FieldVisit[]` مش `MarketingVisit[]`
- حدّث الأعمدة:
  - `visitType` بيصير string (marketing/post_sale/emergency)
  - `customerName` من `client.name`
  - `scheduledDate` / `scheduledTime` نفس الطريقة
- احتفظ بالـ filters (date, clientId, teamKey)
- احذف أي reference لـ `marketing_visit` exclusive data

---

## المرحلة 4: نقل صفحة تفاصيل الزيارة (يوم 2-3)

### الملف: `packages/web/src/pages/MarketingVisitDetailsPage.tsx` → `packages/web/src/pages/VisitDetailPage.tsx`

**التعديلات:**

#### 4.1 Data Loading
```ts
// BEFORE
const visit = await api.marketingVisits.get(id);

// AFTER  
const visit = await api.fieldVisits.get(id);
// visit has: visitType, tasks[], taskResults[], customerName, ...
```

#### 4.2 Task Rendering
كل مهمة يلي كانت `MarketingVisitTask` صارت `VisitTask`:
```ts
interface VisitTask {
  id: number;
  taskType: string;           // 'device_demo' | 'device_delivery' | ...
  taskFamily: string;         // 'marketing' | 'post_sale' | 'emergency'
  status: string;
  result?: any;
  // ...
}
```

#### 4.3 Result Recording
- `device_demo` → `api.fieldVisits.updateResult(visitId, taskId, { result: 'cash_offer_closed', ... })`
- `device_delivery` → نفس الـ endpoint بس payload مختلف (serialNumber, deliveryCondition, ...)
- `device_installation` → نفس الـ endpoint بس payload مختلف
- `device_activation` → نفس الـ endpoint بس payload مختلف

#### 4.4 Emergency Maintenance
- كان بيستخدم `EmergencyResultWizard` → نفس الواحد بس الـ taskId بيكون `visitTaskId` مش `sourceOpenTaskId`

#### 4.5 Visit Lifecycle (Reschedule / Cancel / Start / End / Complete)
```ts
// BEFORE
await api.marketingVisits.reschedule(visit.id, payload);
await api.marketingVisits.cancel(visit.id, payload);

// AFTER
await api.fieldVisits.reschedule(visit.id, payload);
await api.fieldVisits.cancel(visit.id, payload);
```

---

## المرحلة 5: نقل الواجهات التفاعلية (يوم 3)

### الملفات:

| الملف | التعديل |
|-------|---------|
| `PostSaleStepper.tsx` | الـ click handler يروح ع `api.fieldVisits.saveTaskResult` |
| `TelemarketerWorkspace.tsx` | تفاصيل الموعد تفتح `VisitDetailPage` |
| `PlanOverview.tsx` / `PlanningContactTargets.tsx` | روابط الزيارات تروح ع `/field-visits/:id` |
| `App.tsx` | Route `/field-visits/:id` يشير لـ `VisitDetailPage` |

---

## المرحلة 6: نقل الأذونات (Permissions) (يوم 3)

### الملف: أي مكان فيه permission check

**BEFORE:**
```ts
requirePermission('marketing_visits.view')
requirePermission('marketing_visits.update_result')
```

**AFTER:**
```ts
requirePermission('field_visits.view')       // أو نحتفظ بنفس الاسم بس نربطه ع field_visits
requirePermission('field_visits.update_result')
```

> ملاحظة: ممكن نخلي الأسماء القديمة بس نربطن بـ `fieldVisits.ts`. الأفضل نعمل migration للـ permissions كمان.

---

## المرحلة 7: حذف `marketingVisits` API بالكامل (يوم 4)

### الملف: `packages/api/routes/marketingVisits.ts`

**بعد ما كلshي يهاجر:**
1. احذف الملف
2. احذف imports من `packages/api/index.ts`
3. احذف routes من الـ app

### الملف: `packages/web/src/lib/api.ts`

**احذف:**
```ts
// DELETE:
marketingVisits: {
  list: ...
  get: ...
  updateResult: ...
  updateTaskOutcome: ...
  updateStatus: ...
  reschedule: ...
  cancel: ...
  close: ...
  updateTeam: ...
  assignScope: ...
}
```

---

## المرحلة 8: حذف Shared Types Legacy (يوم 4)

### الملف: `packages/shared/types.ts`

**احذف:**
- `MarketingVisit` interface
- `MarketingVisitTask` interface  
- `MarketingVisitResultUpdateRequest`
- `MarketingVisitRescheduleRequest`
- `MarketingVisitCancelRequest`
- `MarketingVisitLifecycleTaskUpdate`
- `MarketingVisitTaskOfferInput`
- `MarketingVisitTeamSnapshot`
- `MarketingVisitType`, `MarketingVisitStage`, `MarketingVisitStatus`, etc.

> **احتفظ بس:** إذا في types مستخدمة بـ `open_tasks` legacy (مثلاً `DeliveryResultPayload`) — احتفظ فيها لحد ما نهاجر الـ open_tasks كمان.

---

## المرحلة 9: حذف الجداول Legacy من DB (يوم 5)

### Migration:

```sql
-- After confirming ALL frontend code is migrated:
DROP TABLE IF EXISTS marketing_visit_task_offers CASCADE;
DROP TABLE IF EXISTS marketing_visit_tasks CASCADE;
DROP TABLE IF EXISTS marketing_visits CASCADE;

-- Also drop legacy result tables if not already dropped:
DROP TABLE IF EXISTS open_task_device_delivery_results CASCADE;
DROP TABLE IF EXISTS open_task_device_installation_results CASCADE;
DROP TABLE IF EXISTS open_task_device_activation_results CASCADE;

-- Drop any legacy functions/triggers:
DROP FUNCTION IF EXISTS sync_marketing_visit_to_field_visit() CASCADE;
```

---

## المرحلة 10: Verification (يوم 5)

### Checklist:

- [ ] `/field-visits` returns marketing visits ✅
- [ ] `/field-visits/:id` returns post-sale visits with tasks ✅
- [ ] `/field-visits/:id` returns emergency visits with tasks ✅
- [ ] Recording result on `device_demo` works ✅
- [ ] Recording result on `device_delivery` works ✅
- [ ] Recording result on `device_installation` works ✅
- [ ] Recording result on `device_activation` works ✅
- [ ] Recording result on `emergency_maintenance` works ✅
- [ ] UI: Visit list page shows all visit types ✅
- [ ] UI: Visit detail page shows all tasks ✅
- [ ] UI: Reschedule / Cancel / Start / End / Complete work for all types ✅
- [ ] No references to `marketingVisits` in codebase ✅
- [ ] No references to `MarketingVisit` types in codebase ✅
- [ ] Tables `marketing_visits`, `marketing_visit_tasks` dropped ✅

---

## ملاحظات تقنية

### `visit_type` values:
- `'marketing'` — للعرض/التسويق
- `'post_sale'` — للتسليم/التركيب/التفعيل
- `'emergency'` — للصيانة الطارئة

### `task_family` values:
- `'marketing'` — device_demo
- `'post_sale'` — device_delivery, device_installation, device_activation
- `'emergency'` — emergency_maintenance

### Payload للـ `saveTaskResult`:
```ts
{
  status: 'completed' | 'not_completed',
  result?: string,        // حسب task_type
  details?: object,       // بيانات نوعية (serialNumber, deliveryCondition, etc.)
  notes?: string,
}
```

> الـ `details` بيكون JSONB بـ `visit_task_results.details` أو بيتوزع على جداول جانبية (`visit_task_device_demo_results`, `visit_task_device_delivery_results`, ...).

---

## قيود وأمان

- **لا تحذف أي ملف** قبل ما نتأكد إن replacement شغال.
- **لا تعدّل الـ permissions** قبل ما الـ UI يهاجر.
- **لا تحذف الجداول** قبل ما الـ API يهاجر.
- **احتفظ بـ backup** قبل كل مرحلة.
- **جرب على staging** قبل production.
