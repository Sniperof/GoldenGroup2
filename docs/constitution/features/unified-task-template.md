# القالب الموحَّد لتعريف نوع المهمة (Unified Task-Type Template)

> **الحالة:** Active / Authoritative — اعتُمد بتاريخ 2026-06-01
> **الغرض:** كل `task_type` في `task_type_config` يجب أن يجيب على المحاور الأربعة عشر التالية **قبل** أن يدخل النظام أو يُعرَض في الواجهة.
> **النطاق:** يُكمِّل `domains/tasks.md` (دورة الحياة الموحَّدة بـ 11 حالة) و `domains/visits.md` (الزيارة الموحَّدة) بدون إعادة تعريفهما.
> **العلاقة بالملفات السابقة:**
> - يُلغي ضمناً `features/task-definition-constitution.md` (الـ 15-axis القديم) ويستبدله بـ 14-axis متماسك مع DEC-003 → DEC-007.
> - يبقى `features/task-reference-template.md` كرفيق business-side (شرح للمالك غير التقني).

---

## 0) المبدأ الحاكم

كل `task_type` في النظام = صف واحد في `task_type_config` + ملف دستوري واحد تحت `features/tasks/<task-type>.md`. **مهمة بلا ملف دستوري = مهمة محظورة من الإنشاء.**

ملف الـ task يجب أن يحوي **14 محوراً** موزعة على **5 أقسام**:

| القسم | المحاور |
|---|---|
| **أ — الهوية** | 1. الكود والاسم · 2. `task_family` · 3. `display_group` · 4. `visit_family` |
| **ب — الإنشاء** | 5. `creation_origin` المسموحة · 6. `location_basis` · 7. `lead_window_days` (N) · 8. التفرّد (Uniqueness) |
| **ج — التنفيذ والنتيجة** | 9. قيم `final_decision` · 10. قيم `reason_code` · 11. الـ side table المخصصة |
| **د — التأثير الجانبي** | 12. انعكاس النتيجة على `open_task.status` · 13. Cascading effects |
| **هـ — الصلاحيات** | 14. من يُنشئ / يُنفّذ / يُغلق |

---

## أ — الهوية

### المحور 1: الكود والاسم
| البيان | القيمة |
|---|---|
| `task_type` (DB code) | `<snake_case>` — يجب أن يطابق `task_type_config.task_type` |
| الاسم العربي | `<…>` |
| الاسم الإنجليزي | `<…>` |
| الوصف المختصر | جملة واحدة تشرح الغرض التشغيلي |

### المحور 2: `task_family`
قيمة واحدة من: `marketing` · `sales` · `delivery` · `maintenance` · `emergency` · `collection` · `service` · `warranty`
> هذا الحقل يحكم منطق الـ backend (RLS، routing، fallback queries). لا يُغيَّر إلا بـ DEC.

### المحور 3: `display_group` (جديد — يُضاف لـ `task_type_config`)
قيمة واحدة من **الأقسام الستة المعتمدة 2026-06-01**:

| `display_group` | الاسم العربي |
|---|---|
| `device_demo` | مهام عرض الجهاز |
| `maintenance` | مهام الصيانة |
| `collection` | مهام تحصيل الأقساط |
| `after_sale_services` | مهام خدمات ما بعد البيع |
| `gift_delivery` | مهام تسليم الهدايا |
| `warranty_services` | مهام خدمات الكفالة |

> طبقة عرض فقط. لا يُستخدم لأي قرار منطقي.

### المحور 4: `visit_family`
قيمة واحدة من: `marketing` · `service` · `mixed`
> يحكم نوع الزيارة التي تنفّذ المهمة (يطابق `visit_tasks.task_family`).

---

## ب — الإنشاء

### المحور 5: `creation_origin` المسموحة
قائمة فرعية من القيم السبعة المعتمدة (DEC-004 D13):
- `branch_plan` — مسندة من خطة مدير الفرع
- `service_request_call` — نتيجة مكالمة طلب خدمة
- `telemarketing_inline_booking` — أُنشئت من التيليماركتر داخل حجز
- `cascading_during_visit` — من الفريق داخل زيارة `in_progress`
- `manual_creation` — يدوي
- `emergency_request` — من بلاغ طارئ
- `system_trigger` — side effect لإغلاق مهمة أخرى

> يجب أن يحدّد الملف أيها مسموح وأيها ممنوع لهذا النوع. مثال: `device_demo` لا يُنشَأ بـ `emergency_request`.

### المحور 6: `location_basis`
قيمة واحدة من: `client` · `device` (DEC-005)
- `client` = عنوان الزبون (`clients.geo_unit_id`).
- `device` = عنوان الجهاز (`installed_devices.installation_geo_unit_id`).

### المحور 7: `lead_window_days` (N)
عدد الأيام **قبل** `required_date` / `expected_date` التي تظهر فيها المهمة في `contact_targets`.
- للحالة `open` → قيمة N من `task_type_config`.
- للحالة `needs_follow_up` → **ثابتة يوم واحد** بغض النظر عن N (DEC-006 D36).

### المحور 8: التفرّد (Uniqueness)
هل يُسمح بأكثر من `open_task` نشطة من هذا النوع لنفس `client_id`؟
- **Default:** لا (يفرضه `idx_open_tasks_unique_active`).
- **استثناءات معروفة:** `emergency_maintenance` فقط.
- يجب التصريح بأي استثناء صراحةً + سبب.

---

## ج — التنفيذ والنتيجة

### المحور 9: قيم `final_decision` المسموحة
قائمة مغلقة من القيم التي يقبلها `visit_task_results.final_decision` لهذا النوع. مثال:
- `offer_accepted_cash`
- `offer_accepted_installment`
- `customer_refused`
- `customer_requested_followup`
- `not_executed`

كل قيمة يجب أن يُذكَر بجانبها:
- **التفسير التشغيلي** (سطر واحد).
- **هل تُعتبر نجاحاً أم فشلاً** (يحكم انعكاس الحالة على `open_task`).

### المحور 10: قيم `reason_code` المسموحة
مرتبطة بـ `system_lists` فئة معيّنة. يجب أن يحدّد الملف:
- اسم فئة `system_lists` المرجعية.
- متى تكون إلزامية ومتى اختيارية.

### المحور 11: الـ side table المخصصة
اسم الجدول الفرعي الذي يحفظ تفاصيل النتيجة (مثل `visit_task_device_demo_results`).
- إن لم تكن هناك side table، يُذكَر صراحةً: "لا side table — `visit_task_results` كافٍ".
- يجب نسخ schema الحقول من ملف الـ migration المرجعي (لا تُعاد كتابتها).

---

## د — التأثير الجانبي

### المحور 12: انعكاس النتيجة على `open_task.status`
جدول يربط كل قيمة `final_decision` بحالة الـ `open_task` الناتجة:

| `final_decision` | `open_task.status` بعد الانعكاس |
|---|---|
| `<قيمة>` | `completed` / `needs_follow_up` / `closed` / … |

### المحور 13: Cascading Effects
عند إغلاق `visit_task` بنتيجة معيّنة، هل ينشأ:
- **مهام `open_task` جديدة آلياً؟** (مثل: `device_demo` ناجحة → تنشئ `device_delivery` + `device_installation` + `device_activation`).
- **سجلات في كيانات أخرى؟** (مثل: عقد، تركيب جهاز، ذمة مالية، تنبيه).

كل effect يجب أن يحدّد:
- المُطلِق (trigger) — أي `final_decision`.
- المُولَّد (artifact) — اسم الكيان والحقول المعبَّأة آلياً.
- مالك الفعل (الكود/الـ service الذي ينفّذ الـ side effect).

---

## هـ — الصلاحيات

### المحور 14: من يُنشئ / يُنفّذ / يُغلق
| الفعل | الصلاحية | الدور المرجعي |
|---|---|---|
| الإنشاء (`POST /open-tasks`) | `open_tasks.edit` | مدير الفرع / تيليماركتر / …  |
| التنفيذ (`visit_tasks`) | `field_visits.execute` | المسؤول في الفريق المسؤول (D11) |
| الإغلاق النهائي (`closed`) | `field_visits.update_result` | مشرف / مدير |
| الفتح بعد `closed` | `field_visits.reopen_closed` | إدارة عليا فقط |

> إن احتاج النوع صلاحية خاصة (مثلاً تسوية مالية لطوارئ)، تُسجَّل صراحةً.

---

## قائمة فحص الإصدار (Release Checklist)

قبل اعتبار النوع جاهزاً للتشغيل، يجب التحقق من:

- [ ] صف في `task_type_config` بقيم: `task_type`, `task_family`, `display_group`, `visit_family`, `location_basis`, `lead_window_days`, `is_active`.
- [ ] CHECK constraint على `visit_tasks.task_type` يشمل الكود.
- [ ] side table موجودة (إن وُجدت) مع `visit_task_result_id UNIQUE`.
- [ ] قيم `final_decision` و `reason_code` معرَّفة (CHECK أو enum أو system_lists).
- [ ] الـ reflection logic مكتوبة في `services/visitTaskResultReflection.ts` (المحور 12).
- [ ] الـ cascading effects مكتوبة في service مخصص (المحور 13).
- [ ] الصلاحيات مزروعة (المحور 14).
- [ ] ملف `features/tasks/<task-type>.md` مكتمل ومراجَع.

---

## أنواع المهام المعتمدة حتى 2026-06-01

| `display_group` | الأنواع المغطّاة | بانتظار |
|---|---|---|
| `device_demo` | `device_demo` | — |
| `maintenance` | `periodic_maintenance`, `emergency_maintenance` | — |
| `collection` | `collection` | — |
| `after_sale_services` | `device_delivery`, `device_installation`, `device_activation`, `device_transfer` | — |
| `gift_delivery` | `gift_delivery` | — |
| `warranty_services` | `golden_warranty`, `warranty_reactivation`, `warranty_cancellation` | — |
| (غير محدد بعد) | — | البقايا من الـ 20 نوع — تُحسَم لاحقاً |

---

## المراجع
- `domains/tasks.md` — دورة الحياة الموحَّدة بـ 11 حالة (المرجع الأعلى)
- `domains/visits.md` — الزيارة الموحَّدة والشقّان الدائمان
- `domains/open-tasks.md` — schema تفصيلي
- `decisions/DEC-004-visit-task-lifecycle-refinement.md` — D13 (`creation_origin`)
- `decisions/DEC-005-contact-targets-filter.md` — D27 (`location_basis`, N)
- `features/task-reference-template.md` — رفيق business-side
