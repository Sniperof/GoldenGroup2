# Feature: مهمة تسليم الجهاز (device_delivery)

> النوع: `device_delivery`
> العائلة: `delivery`
> إلزامية العقد: نعم (`contract_required = TRUE`)
> تاريخ الاستحقاق: لا (`has_due_date = FALSE`) — نستخدم `expected_date` فقط
> `due_date` مخصص للذمم والتحصيل فقط

---

## 1. إنشاء المهمة (Task Creation)

### 1.1 مصادر الإنشاء

| المصدر | متى | من |
|--------|-----|-----|
| **تلقائي من العقد** | عند حفظ عقد بيع جديد (`sale_contract`) | النظام |
| **يدوي** | من صفحة الزبون → العقود → تتبع الجهاز | أي موظف بصلاحية |

### 1.2 شروط إظهار زر الإنشاء

- العقد `status = 'active'`
- العقد `device_status = 'pending_delivery'`
- ما في `device_delivery` task نشطة (`open`, `needs_follow_up`, `assigned`, `in_scheduling`, `scheduled`) مرتبطة بهاد العقد

### 1.3 حقول الإنشاء (الموظف بيملاهن)

| # | الحقل | إلزامي | مصدره | الوصف |
|---|-------|--------|-------|-------|
| 1 | **العقد** | ✅ | Dropdown — عقود نشطة `pending_delivery` | بيحدد الزبون والجهاز تلقائياً |
| 2 | **الزبون** | ✅ | تلقائي من العقد | غير قابل للتعديل |
| 3 | **الجهاز** | ✅ | تلقائي من العقد (model name) | غير قابل للتعديل |
| 4 | **عنوان التسليم** | ✅ | افتراضي = `installationAddress` من العقد | **قابل للتعديل** — الزبون ممكن يستلم بمكان تاني |
| 5 | **التاريخ المتوقع** (`expected_date`) | ✅ | الموظف بيحدده مع الزبون | متى الزبون بده التسليم؟ |
| 6 | **السبب** (`reason`) | ✅ | Dropdown من `system_lists` (نوع `task_reason`) | الأدمن بيضبط القائمة |
| 7 | **الأولوية** | ❌ | `high` / `medium` / `low` | للتنظيم الداخلي |
| 8 | **ملاحظات** | ❌ | نص حر | أي ملاحظات إضافية |

### 1.4 ما بنسجل بإنشاء المهمة

| ما نسجله | السبب |
|----------|-------|
| `due_date` | ❌ — مخصص للذمم فقط |
| فريق التنفيذ | ❌ — بيتعين بمرحلة الجدولة |
| الرقم التسلسلي | ❌ — الفني بيقرأه عند التسليم |
| صور | ❌ — عند التسليم |

---

## 2. تبويب تتبع الجهاز (ClientProfile → العقود)

### 2.1 حالة `pending_delivery`

```
┌────────────────────────────────────────┐
│  العقد #1234 — Aqua Pro 7 مراحل        │
│                                        │
│  [تسليم] [تركيب] [تشغيل]              │
│   ⏳active   ○hidden    ○hidden         │
│                                        │
│  [إضافة مهمة تسليم] ← زر ظاهر         │
└────────────────────────────────────────┘
```

### 2.2 بعد التسليم الناجح (`delivered`)

```
┌────────────────────────────────────────┐
│  العقد #1234 — Aqua Pro 7 مراحل        │
│                                        │
│  [تسليم] [تركيب] [تشغيل]              │
│   ✅done     ⏳active   ○hidden         │
│                                        │
│  [إضافة مهمة تركيب] ← زر ظاهر         │
└────────────────────────────────────────┘
```

---

## 3. نتيجة المهمة (Task Result)

### 3.1 الحقول اللي بيسجلها الفني بالزيارة

| # | الحقل | إلزامي | الوصف |
|---|-------|--------|-------|
| 1 | **النتيجة** (`outcome`) | ✅ | `delivered_successfully` / `customer_not_available` / `wrong_address` / `refused_delivery` |
| 2 | **الرقم التسلسلي** | ✅ بس إذا `delivered_successfully` | الفني بيقرأه من الجهاز |
| 3 | **حالة الجهاز** (`delivery_condition`) | ✅ بس إذا `delivered_successfully` | `perfect` / `minor_damage` / `missing_accessories` |
| 4 | **عنوان التسليم الفعلي** | ❌ | إذا اختلف عن العنوان المسجل |
| 5 | **تاريخ التسليم الفعلي** | ❌ | افتراضي = اليوم |
| 6 | **مين سلّم؟** | ❌ | الفني المسجل بالزيارة |
| 7 | **إقرار الزبون** | ❌ | توقيع أو checkbox |
| 8 | **صور** (`delivery_photos`) | ❌ | مصفوفة URLs |
| 9 | **ملاحظات النتيجة** | ❌ | سبب الرفض، ملاحظات إضافية |

### 3.2 تأثير كل نتيجة

| النتيجة | حالة المهمة | حالة الجهاز (`device_status`) | اللي بيصير بعدها |
|---------|------------|-------------------------------|------------------|
| `delivered_successfully` | `completed` | `delivered` | ➕ يتولد تلقائياً `device_installation` task |
| `customer_not_available` | `completed` | `pending_delivery` | ➕ يتولد `device_delivery` task جديدة (متابعة) |
| `wrong_address` | `completed` | `pending_delivery` | ➕ يتولد `device_delivery` task جديدة + تحديث العنوان |
| `refused_delivery` | `completed` | `pending_delivery` | ➕ قرار المشرف: إلغاء أو متابعة |

> **ملاحظة:** المهمة الأولى بتصير `completed` بغض النظر عن النتيجة. النتيجة = سجل محاولة. إذا المحاولة فاشلة، بننشئ مهمة جديدة.

---

## 4. DB Schema

### 4.1 الجدول الأساسي (`open_tasks`)

```sql
client_id       → من العقد
branch_id       → من العقد أو المستخدم
contract_id     → من العقد

task_type       = 'device_delivery'
task_family     = 'delivery'
reason          → من system_lists (task_reason)
status          = 'open'

expected_date   → من المستخدم (التاريخ المتوقع)
due_date        = NULL  ← لا يُستخدم للتسليم

priority        → من المستخدم
notes           → من المستخدم

source          = 'manual' أو 'system'
created_by      = hr_users.id
```

### 4.2 جدول نتيجة التسليم (`visit_task_device_delivery_results`)

```sql
visit_task_result_id  → FK visit_task_results
serial_number         → الفني بيقرأه
device_model_id       → تأكيد

delivery_address      → ممكن يختلف عن العقد
actual_delivery_date  → تاريخ التنفيذ

delivered_by_employee_id → من جلسة الزيارة
customer_acknowledged    → checkbox

delivery_condition    = 'perfect' | 'minor_damage' | 'missing_accessories'
delivery_photos       → JSONB [] URLs
```

---

## 5. ملاحظات تنفيذية

- `allow_multiple` لـ `device_delivery` لازم يكون `TRUE` — لأنه ممكن يكون في عدة محاولات تسليم لنفس الزبون.
- السبب (`reason`) لازم يصير قائمة ديناميكية من `system_lists` (نوع `task_reason`)، مش ثابت `service_request`.
- أي موظف عنده صلاحية `tasks.create` بيقدر ينشئ المهمة يدوياً.

---

## 6. المشاكل المعروفة (Known Issues / Gaps)

### `DD-G001` — تسجيل النتيجة يفشل عبر `marketingVisits.submitDeliveryResult`
**الحالة: gap فني — يلزم تعديل endpoint النتيجة**

المشكلة: `PostSaleStepper.tsx` بيستدعي:
```ts
api.marketingVisits.submitDeliveryResult(String(visitId), String(deliveryTask.id), {...})
```

لكن هاد الـ endpoint يربط بالـ `marketing_visit_tasks` + `visit_task_results` يلي كان مخصص حصرياً لـ `device_demo` (MVP أولي). لما نوع المهمة `device_delivery` — النظام ما بيلاقي `task_type` متطابق → **يفرش أو يرفض الحفظ**.

**السبب الجذري:**
الـ backend (`marketingVisits.ts`) بيحفظ النتيجة بشرط:
```ts
// legacy endpoint: PATCH /marketing-visits/:id/result
// بيفحص task_type = 'device_demo' فقط
```

`device_delivery` مش `device_demo` → 404 أو فشل صامت.

**الحل المطلوب:**
إما:
- **الخيار أ:** نفصل `device_delivery` عن زنجيلة `marketing_visit_tasks` — نتيجتها تُحفظ مباشرة بجدول خاص (`open_task_delivery_results`)
- **الخيار ب:** نعمّم endpoint النتيجة (`PATCH /marketing-visits/:visitId/tasks/:taskId/outcome`) ليقبل أي `task_type` مش بس `device_demo`

**القرار المنتج لازم:** أي endpoint بيصير الـ canonical لتسجيل نتائج post-sale tasks.

### `DD-G002` — مهمة عقدية مربوطة بـ `marketing_visit` legacy
**الحالة: gap معماري**

`device_delivery` مهمة عقدية (`source = 'system'` من العقد). بس النظام بيحاول يربطها بـ `marketing_visit` (تلي ماركتينج) لتسجيل النتيجة. هاد اختلاط كيانات.

المفروض:
- `marketing_visit` = زيارة تسويقية (تلي ماركتينج → عرض جهاز)
- `device_delivery` = زيارة تشغيلية (خدمة ما بعد البيع → تسليم جهاز)

**الحل:** تسجيل نتيجة `device_delivery` مباشرة على `open_task` بدون المرور بـ `marketing_visit`.

---

## 7. العلاقة بالزيارة (Visit Model)

### 7.1 الوضع الحالي (Legacy)
```
marketing_visit (زيارة تسويقية)
  └── marketing_visit_task (مهمة ضمن الزيارة)
        └── visit_task_result (نتيجة المهمة)
              └── visit_task_device_delivery_results (تفاصيل التسليم)
```

### 7.2 الوضع المطلوب (Target)
```
open_task (device_delivery)
  └── open_task_delivery_results (نتيجة مباشرة)
        │
        │  أو (إن وجدت زيارة ميدانية)
        │
        └── مربوطة بـ visit إن تمت جدولة
```

**الفرق:** النتيجة أساساً على `open_task`، والزيارة (إن وجدت) مجرد حاوية تنفيذية.

---