# البرومت — إنشاء نظام device_delivery + صفحة "خدمات ما بعد البيع"

> **Target:** Staging branch (`/opt/golden-crm/apps/staging`)
> **Goal:** إنشاء قسم "خدمات ما بعد البيع" يلي بيغطي `device_delivery` → `device_installation` → `device_activation` بشكل stepper حسب العقد/الجهاز.
> **Never touch production.**

---

## الجزء 1: قاعدة البيانات

### 1.1 Migration جديد: `migrations/143_device_delivery_results.sql`

أنشئ جدول نتائج تسليم الجهاز:

```sql
CREATE TABLE IF NOT EXISTS visit_task_device_delivery_results (
  id                    BIGSERIAL   PRIMARY KEY,
  visit_task_result_id  BIGINT      NOT NULL REFERENCES visit_task_results(id) ON DELETE CASCADE,
  CONSTRAINT uq_vtddr_result UNIQUE (visit_task_result_id),

  -- البيانات المحددة للتسليم
  serial_number         VARCHAR(100),          -- الرقم التسلسلي للجهاز المسلّم
  device_model_id      INTEGER REFERENCES device_models(id) ON DELETE SET NULL,
  delivery_address      TEXT,                   -- عنوان التسليم (من العقد أو يدوي)
  actual_delivery_date  DATE,                   -- تاريخ التسليم الفعلي
  delivered_by_employee_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  customer_acknowledged  BOOLEAN DEFAULT FALSE, -- توقيع/إقرار الزبون
  delivery_photos       JSONB DEFAULT '[]',     -- مصفوفة URLs للصور

  -- الحالة التشغيلية
  delivery_condition    VARCHAR(50) CHECK (delivery_condition IN ('perfect', 'minor_damage', 'missing_accessories')),

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### 1.2 تحديث `packages/shared/types.ts`

أضف:

```ts
export interface VisitTaskDeviceDeliveryResult {
  id: number;
  visitTaskResultId: number;
  serialNumber?: string | null;
  deviceModelId?: number | null;
  deliveryAddress?: string | null;
  actualDeliveryDate?: string | null;
  deliveredByEmployeeId?: number | null;
  customerAcknowledged?: boolean | null;
  deliveryPhotos?: string[];
  deliveryCondition?: 'perfect' | 'minor_damage' | 'missing_accessories' | null;
  createdAt: string;
  updatedAt: string;
}

export type DeviceDeliveryResultOutcome =
  | 'delivered_successfully'
  | 'customer_not_available'
  | 'wrong_address'
  | 'refused_delivery';
```

---

## الجزء 2: الـ Backend API

### 2.1 تعديل `packages/api/routes/openTasks.ts`

- أضف فلتر `taskFamily` للـ `GET /` endpoint:
  - `?taskFamily=delivery` → بيرجع `device_delivery`, `device_installation`, `device_activation`
  - `?taskTypes=device_delivery` → فلتر حسب نوع محدد
- عدّل الـ `SELECT` query ليدعم `ARRAY` من `taskFamily` أو `taskTypes`.

### 2.2 إنشاء endpoint جديد: `POST /api/marketing-visits/:visitId/tasks/:taskId/delivery-result`

(أو استخدم نفس نمط `marketingVisits.ts` الحالي — المهم نضيف منطق حفظ `visit_task_device_delivery_results`)

المنطق المطلوب:
1. إنشاء/تحديث `visit_task_results` (general result).
2. إنشاء سجل بـ `visit_task_device_delivery_results`.
3. إذا النتيجة = `delivered_successfully`:
   - `UPDATE contracts SET device_status = 'delivered' WHERE id = $contractId`
   - إنشاء `open_task` جديدة من نوع `device_installation` مرتبطة بنفس العقد.

---

## الجزء 3: الواجهة الأمامية

### 3.1 إنشاء صفحة جديدة: `packages/web/src/pages/tasks/PostSaleTasksPage.tsx`

**الـ UI المطلوب:**

```
┌─────────────────────────────────────────────┐
│  خدمات ما بعد البيع  (Post-Sale Services)    │
├─────────────────────────────────────────────┤
│                                               │
│  [فلتر: الكل] [قيد التسليم] [مُركّب] [نشط]   │
│                                               │
│  ┌─────────────────────────────────────┐    │
│  │  العقد #1234 - أحمد العلي           │    │
│  │  موديل: Aqua Pro 7 مراحل            │    │
│  │                                     │    │
│  │    [تسليم] → [تركيب] → [تشغيل]     │    │
│  │      ✅        ⏳        ○           │    │
│  │                                     │    │
│  │    تم التسليم 2026-05-21            │    │
│  │    بانتظار التركيب — زر "إضافة مهمة │    │
│  │    تركيب"                           │    │
│  └─────────────────────────────────────┘    │
│                                               │
│  ┌─────────────────────────────────────┐    │
│  │  العقد #1235 - سارة محمد           │    │
│  │  موديل: Compact 5 مراحل            │    │
│  │                                     │    │
│  │    [تسليم] → [تركيب] → [تشغيل]     │    │
│  │      ⏳        ○        ○           │    │
│  │                                     │    │
│  │    قيد التسليم — موعد: 2026-05-23  │    │
│  └─────────────────────────────────────┘    │
│                                               │
└─────────────────────────────────────────────┘
```

**الـ Stepper Component:**
- `packages/web/src/components/tasks/PostSaleStepper.tsx`
- يقبل مصفوفة من `{ step: 'delivery'|'installation'|'activation', status: 'completed'|'current'|'pending', taskId?: number }`
- الخطوة `current` فيها زر "تسجيل النتيجة" أو "إنشاء مهمة".

### 3.2 تعديل الـ Sidebar (`MainLayout.tsx`)

استبدال `operationsChildren` — استخدم القائمة الجديدة:

```ts
const operationsChildren = [
    { path: '/tasks/post-sale', label: 'خدمات ما بعد البيع', icon: Truck },
    { path: '/tasks/maintenance', label: 'خدمات الصيانة', icon: Wrench },
    { path: '/tasks/retrieval', label: 'سحب وإرجاع الأجهزة', icon: RotateCcw },
    { path: '/tasks/dues', label: 'الذمم المستحقة', icon: DollarSign },
    { path: '/tasks/device-demo', label: 'عروض الأجهزة', icon: Monitor },
    { path: '/tasks/open', label: 'جميع المهام المفتوحة', icon: ListChecks },
];
```

### 3.3 إضافة Route بـ `App.tsx`

```tsx
<Route path="/tasks/post-sale" element={<PostSaleTasksPage />} />
```

---

## الجزء 4: Consistency مع العقد

### 4.1 عند إنشاء عقد بيع جديد (`contracts.ts`):

```ts
// موجود حالياً — تأكد إنه بيخلق device_delivery task تلقائياً
if (contract.contractType === 'sale_contract' && contract.deviceStatus === 'pending_delivery') {
  // إنشاء open_task من نوع device_delivery
}
```

### 4.2 عند إكمال `device_delivery`:

```ts
// updateContractDeviceStatusOnTaskCompletion موجود حالياً
// تأكد إنه بيتحقق من taskType === 'device_delivery' → device_status = 'delivered'
// وبيخلق device_installation task تلقائياً
```

---

## الجزء 5: الملفات اللي لازم تتعدّل/تُنشأ

| # | المسار | العمل |
|---|--------|-------|
| 1 | `migrations/143_device_delivery_results.sql` | إنشاء |
| 2 | `packages/shared/types.ts` | تعديل |
| 3 | `packages/api/routes/openTasks.ts` | تعديل |
| 4 | `packages/api/routes/marketingVisits.ts` | تعديل (أو route جديد) |
| 5 | `packages/web/src/pages/tasks/PostSaleTasksPage.tsx` | إنشاء |
| 6 | `packages/web/src/components/tasks/PostSaleStepper.tsx` | إنشاء |
| 7 | `packages/web/src/layout/MainLayout.tsx` | تعديل |
| 8 | `packages/web/src/App.tsx` | تعديل |
| 9 | `packages/web/src/lib/api.ts` | تعديل (إضافة endpoints جديدة) |

---

## القيود والتحذيرات

- **لا تحذف** `device_demo` أو `emergency_maintenance` — فقط أضف جديد.
- **لا تعدل** `contract.status` — عدّل `contract.device_status` فقط.
- **لا تغير** أنماط الـ DB الحالية — نفس نمط `visit_task_*_results`.
- **Staging only** — لا production.

---

## التحقق بعد التنفيذ

1. إنشاء عقد بيع جديد → بيتولد `device_delivery` task تلقائياً.
2. فتح صفحة "خدمات ما بعد البيع" → بيظهر العقد مع الـ stepper.
3. تسجيل نتيجة تسليم ناجحة → `device_status = delivered` + بتظهر مهمة تركيب جديدة بالـ stepper.
4. `pnpm build` → 0 errors.
