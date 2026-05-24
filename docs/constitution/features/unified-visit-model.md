# دستور الفيتشر — نموذج الزيارة الموحدة (Unified Visit Model)

> الحالة: معتمد كمرجع دستوري
> اللغة: عربية موحّدة
> النطاق: Visit Architecture — زيارة واحدة لكلshي
> الغرض: توثيق قرار الجعل `field_visits` هو الكيان الوحيد للزيارة، وإهمال `marketing_visits` كـ legacy wrapper.

---

## 0) الملخّص التنفيذي

هذا الدستور يثبّت قرار المنتج والهندسة بأن **الزيارة كيان واحد (`field_visits`)** يحتوي مهام متعددة (`visit_tasks`) من أي نوع. لا وجود لـ "زيارة تسويقية" منفصلة عن "زيارة تسليم" أو "زيارة صيانة".

`marketing_visits` (و `marketing_visit_tasks`) هو **legacy** تماماً. بدأ كـ wrapper لزيارات عرض الجهاز (التلي ماركتينج) لكن التعميم أثبت أن كل المهام متساوية: **الزبون + الموعد + الفريق + المهمة = زيارة واحدة**.

---

## 1) لماذا "زيارة واحدة"؟

### 1.1 المشكلة القديمة

| | `marketing_visits` | `field_visits` |
|---|---|---|
| **الغرض** | عرض الجهاز فقط | كل المهام التانية |
| **الجدول** | marketing_visits | field_visits |
| **المهام** | marketing_visit_tasks | visit_tasks |
| **النتائج** | marketing_visit_task_offers | visit_task_results + side tables |

معناه: نفس الأحمد بيحتاج **زيارتين** بالنظام إذا عنده عرض + تسليم:
```
marketing_visit: "عرض جهاز"  ← زيارة منفصلة
field_visit: "تسليم جهاز"    ← زيارة منفصلة
```

### 1.2 المشكلة العملية

- **الفني بيروح مرة واحدة** — بس النظام بيسجّل "زيارتين"
- **الزبون شايف فريق واحد** — بس الـ CRM بيعطي 2 reports مختلفة
- **التقارير بتضل غلط** — "عدد الزيارات" = ضعف الحقيقة
- **إضافة مهمة جديدة = صداع** — وين بروح؟ marketing ولا field؟

### 1.3 الحل

> **كل موعد مع الزبون = زيارة واحدة (`field_visits`).**
> **كل عمل ضمن الموعد = مهمة (`visit_task`).**

```
field_visit: "الأحمد — يوم الاثنين الساعة 3"
├── visit_task: عرض الجهاز (device_demo)
├── visit_task: تسليم الجهاز (device_delivery)
└── visit_task: تركيب الجهاز (device_installation)

نفس الفريق، نفس الزبون، نفس الموعد، 3 مهام، زيارة واحدة.
```

---

## 2) العقد التقني

### 2.1 الكيان الوحيد: `field_visits`

| العمود | المعنى |
|--------|--------|
| `id` | مفتاح الزيارة |
| `visit_type` | نوع الزيارة (`'marketing'`, `'emergency'`) |
| `visit_family` | عائلة الزيارة (`'marketing'`, `'service'`) |
| `status` | حالة الزيارة (`scheduled`, `in_progress`, `completed`, `cancelled`, ...) |
| `client_id` | الزبون |
| `branch_id` | الفرع |
| `scheduled_date` / `scheduled_time` | الموعد |
| `team_snapshot` | snapshot الفريق وقت التخطيط |
| `source_legacy_type` | لو كانت من migration (`'marketing_visit'`) |
| `source_legacy_id` | الـ ID القديم |

> **لا يوجد `marketing_visit_id`.** الـ `source_legacy_*` بس للـ migration/audit.

### 2.2 المهام: `visit_tasks`

| العمود | المعنى |
|--------|--------|
| `id` | مفتاح المهمة |
| `field_visit_id` | ربط بالزيارة |
| `task_type` | نوع المهمة (`device_demo`, `device_delivery`, `device_installation`, `device_activation`, `emergency_maintenance`, ...) |
| `task_family` | عائلة المهمة (`marketing`, `post_sale`, `emergency`) |
| `sequence_no` | ترتيب المهمة بالزيارة |
| `status` | حالة المهمة (`pending`, `completed`, `not_completed`, ...) |
| `source_open_task_id` | ربط بـ `open_tasks` (لو فيه) |
| `source_legacy_type` | لو من migration |
| `source_legacy_id` | الـ ID القديم |

### 2.3 النتائج: `visit_task_results` + side tables

| الجدول | للمهمة |
|--------|--------|
| `visit_task_results` | النتيجة العامة (status, notes, closed_by, closed_at) |
| `visit_task_device_demo_results` | تفاصيل عرض الجهاز (offers, cash_offer_amount, ...) |
| `visit_task_device_delivery_results` | تفاصيل التسليم (serial_number, delivery_condition, ...) |
| `visit_task_device_installation_results` | تفاصيل التركيب |
| `visit_task_device_activation_results` | تفاصيل التفعيل |

> **مبدأ عدم التكرار:** `visit_task_results` جدول أم. كل مهمة لها صف واحد. البيانات النوعية (مختلفة حسب task_type) بروح للـ side table. ما في أعمدة فارغة.

### 2.4 Endpoint الموحد

```
GET    /field-visits                    ← قائمة الزيارات
GET    /field-visits/:id                ← تفاصيل الزيارة
POST   /field-visits/:id/start          ← بدء الزيارة
POST   /field-visits/:id/end            ← إنهاء الزيارة
POST   /field-visits/:id/complete       ← إغلاق الزيارة
PATCH  /field-visits/:id/team           ← إعادة إسناد الفريق
POST   /field-visits/:id/tasks/:id/result ← تسجيل نتيجة مهمة
GET    /field-visits/:id/tasks/:id/result ← قراءة نتيجة مهمة
```

> **لا يوجد `/marketing-visits/*`.** هذا الـ prefix legacy تماماً.

---

## 3) العقد التشغيلي

### 3.1 مسار الزيارة

```
planning (التخطيط)
    │
    ├── syncAssignedTasks → open_tasks.status = 'assigned'
    │
    ├── generate-from-plan → telemarketing_task_list_items
    │
    ├── telemarketer books appointment → telemarketing_appointments
    │
    └── field_visit created (visit_type = 'marketing' | 'post_sale' | 'emergency')
            │
            ├── visit_tasks created (one per open_task)
            │
            ├── scheduled_date = appointment date
            │
            └── team_snapshot = day_schedule team
                    │
                    ├── day of visit → field_visit.status = 'in_progress'
                    │
                    ├── technician executes tasks
                    │
                    ├── records results → visit_task_results + side tables
                    │
                    └── all done → field_visit.status = 'completed'
```

### 3.2 قاعدة "الوعاء" (Container Rule)

> الزيارة هي **وعاء** (`container`) للمهام.
>
> - تعديل مسموح طول ما الزيارة `scheduled`.
> - إلغاء مسموح قبل `in_progress`.
> - إعادة جدولة مسموحة لـ `scheduled` أو `needs_reschedule`.
> - إضافة مهمة جديدة لزيارة `scheduled` = مسموح (بس بشرط).
> - إزالة مهمة = مسموح إذا ما بدّتش.

### 3.3 كلshي متساوٍ

| المهمة | عائلة | visit_type | معاملة |
|--------|-------|------------|--------|
| `device_demo` | marketing | marketing | = تسليم |
| `device_delivery` | post_sale | post_sale | = عرض |
| `device_installation` | post_sale | post_sale | = عرض |
| `device_activation` | post_sale | post_sale | = عرض |
| `emergency_maintenance` | emergency | emergency | = عرض |

> **لا يوجد مهمة "أهم" من مهمة.** كلن بنفس الـ endpoint، بنفس الـ response format، بنفس الـ lifecycle.

---

## 4) القواعد التشغيلية

### `UV-R001` — زيارة واحدة لكل موعد
لكل موعد (`appointment`) ينشأ `field_visit` واحد فقط. لا يجوز إنشاء زيارتين لنفس الموعد.

### `UV-R002` — المهمة متساوية التعامل
`visit_task` من نوع `device_demo` يُعامل بنفس الآلية يلي `device_delivery` يُعامل بها: نفس الـ endpoint، نفس الـ lifecycle، نفس الـ result recording.

### `UV-R003` — لا تكرار للـ side tables
كل `visit_task` لها `visit_task_results` واحد. إذا بيانات إضافية (مثل offers للـ demo) → side table. ما في `visit_task_results` تانية.

### `UV-R004` — الـ legacy wrapper يُهمل
`marketing_visits` (legacy wrapper) لا يُستخدم بعد اكتمال migration. أي كود جديد يُكتب لـ `field_visits` فقط.

### `UV-R005` — source_legacy للـ audit بس
أعمدة `source_legacy_type` و `source_legacy_id` موجودة بس للـ backward compatibility والـ audit. ما بيُستخدموا بالـ business logic.

### `UV-R006` — `open_tasks` مستقل عن `visit_tasks`
`open_tasks` كيان "الوعد" (promise) منفصل عن `visit_tasks` كيان "التنفيذ" (execution). الربط بس عن طريق `visit_tasks.source_open_task_id`. لا يجوز دمج الجدولين.

---

## 5) سلوك الواجهة

### 5.1 شاشة قائمة الزيارات (`VisitsListPage`)
تعرض:
- كل الزيارات (marketing + post_sale + emergency)
- فلتر حسب `visit_type`
- تاريخ، فريق، زبون، عدد المهام، الحالة
- رابط لـ تفاصيل الزيارة الموحدة

### 5.2 شاشة تفاصيل الزيارة (`VisitDetailPage`)
تعرض:
- معلومات الزيارة (زبون، موعد، فريق)
- قائمة المهام (كلshي — عرض + تسليم + تركيب + صيانة)
- كل مهمة: حالة، نتيجة، زر "تسجيل نتيجة"
- أزرار lifecycle (بدء، إنهاء، إلغاء، إعادة جدولة)

### 5.3 مودال تسجيل النتيجة (`VisitTaskResultModal`)
- يفتح لأي نوع مهمة
- الـ fields بتختلف حسب `task_type` (conditional rendering)
- الـ submit بيروح لـ `POST /field-visits/:id/tasks/:id/result`

---

## 6) الفجوات والـ Legacy

### `UV-G001` — `marketing_visits` Legacy Migration
**الحالة: ✅ Migration مكتمل 100% — كل المراحل منفذة**

| المرحلة | الشغل | الحالة |
|---------|-------|--------|
| ١ | Backend: `GET /field-visits/` list + `POST reschedule` + `POST cancel` + demo result handler | ✅ منفذ |
| ٢ | API Client: `api.fieldVisits.list/reschedule/cancel` | ✅ منفذ |
| ٣ | قائمة الزيارات: `VisitsListPage.tsx` → `/field-visits` | ✅ منفذ |
| ٤ | تفاصيل الزيارة: `VisitDetailPage.tsx` مع demo result + lifecycle | ✅ منفذ |
| ٥ | Nav + Routes + Bridge UPSERT عند الجدولة | ✅ منفذ |
| ٦ | نقل الـ Permissions (`marketing_visits.*` → `field_visits.*`) | ✅ منفذ |
| ٧ | حذف `marketingVisits.ts` backend + components + pages | ✅ منفذ |
| ٨ | حذف `MarketingVisit` types | ✅ منفذ |
| ٨.٥ | نهigrate `ContractForm.tsx` لـ `fieldVisits` | ✅ منفذ |
| ٩ | حذف آخر methods من `api.ts` | ✅ منفذ |
| ١٠ | حذف الباقي من `types.ts` | ✅ منفذ |
| ١١ | Verify build + clean remaining refs | ✅ منفذ |
| ١٢ | تنظيف `telemarketing.ts` + `openTasks.ts` SQL | ✅ منفذ |
| **١٣** | **حذف جداول `marketing_visits` + `marketing_visit_tasks` + `marketing_visit_task_offers` من DB** | **✅ DONE** |

**النتيجة:**
- `marketing_visits` ❌ محذوف (جدول + API + types + components)
- `field_visits` ✅ الكيان الوحيد والـ Canonical
- `visit_tasks` ✅ الكيان الوحيد للمهام
- `visit_task_results` ✅ النتائج الموحدة

### `UV-G002` — `open_tasks` لسا independent
**الحالة: مغلق ✅ — قرار المنتج: يبقى independent**

`open_tasks` (مهام مفتوحة) بيضلّ كيان منفصل عن `visit_tasks`. `open_tasks` = "الوعد" (promise)، `visit_tasks` = "التنفيذ" (execution). الربط بس عن طريق `visit_tasks.source_open_task_id`. انظر: `domains/visits.md` القاعدة `V-R006`.

### `UV-G003` — `telemarketing_appointments` لسا منفصلة
**الحالة: decision pending**

المواعيد (`telemarketing_appointments`) لسا جدول منفصل. هل الموعد = جزء من الزيارة؟ ولا كيان مستقل؟

> **رأي المنتج:** الموعد كيان مستقل — ممكن يكون بدون زيارة (مثلاً موعد مُلغى). بس الزيارة **لازم** تكون مربوطة بموعد (أو تولد منه).

### `UV-G004` — `visit_type` و `visit_family` لا يفرّقا `post_sale` عن `emergency`
**الحالة: فجوة مفتوحة — decision pending**

`field_visits.visit_type` الحالي = `'marketing'` أو `'emergency'` فقط.
`field_visits.visit_family` الحالي = `'marketing'` أو `'service'` فقط.

المشكلة: زيارة "تسليم جهاز" (post-sale) و "صيانة طارئة" (emergency) لكلتن `visit_type='emergency'` و `visit_family='service'`. التمييز بس عن طريق `visit_tasks.task_type`.

هل بدنا نوسّع `visit_type` ليشمل `'post_sale'`؟ ولا التمييز بـ `task_type` كافي؟ القرار بانتظار تعريف المهام الجديد.

---

## 7) التوافق الخلفي

- `PlanOverview` يقرأ من `field_visits` (عبر `workScopes` أو `planningMarketingTargets`)
- `PlanningContactTargets` تولد `field_visit` + `visit_tasks`
- `TelemarketerWorkspace` يخلق موعد → يولد `field_visit`
- `PostSaleStepper` يربط `open_task` بـ `visit_task` ضمن `field_visit`
- `EmergencyResultWizard` يسجل نتيجة على `visit_task` ضمن `field_visit`

---

## 8) الخلاصة

> **الزيارة = كيان واحد (`field_visits`).**
> **المهمة = جزء من الزيارة (`visit_tasks`).**
> **النوع = مجرد label (`task_type`)، مش كيان منفصل.**
> **النتيجة = موحدة (`visit_task_results`) + تخصيص (`side tables`).**
> **الـ Legacy (`marketing_visits`) = يُهمل ويُحذف.**
