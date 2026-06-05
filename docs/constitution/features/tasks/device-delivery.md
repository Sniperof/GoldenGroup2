# مهمة تسليم الجهاز — `device_delivery`

> **القالب المرجعي:** [`features/unified-task-template.md`](../unified-task-template.md)
> **الحالة:** Draft — مبني على حسم مباشر مع صاحب المنتج بتاريخ 2026-06-04
> **الـ display_group:** `after_sale_services`

---

## مدخل مفاهيمي — ما هي مهمة تسليم الجهاز؟

> **`device_delivery` هي مهمة لوجستية بحتة هدفها نقل جهاز فعلي محدد إلى عنوان تسليم محدد.**

هذه المهمة:
- ترتبط دائماً بجهاز فعلي في `installed_devices`
- لا ترتبط بالعقد بالضرورة
- قد تنشأ من عقد بيع، أو من إرجاع بعد صيانة، أو من تبديل مؤقت، أو من استبدال، أو يدوياً
- لا تعني تركيب الجهاز
- لا تعني تشغيل الجهاز
- لا تغيّر عنوان الجهاز التشغيلي الرئيسي تلقائياً

### الفصل الحاكم بين التسليم والتركيب

- **عنوان التسليم** = المكان الذي سُلِّم إليه الجهاز
- **عنوان التركيب** = المكان الذي سيصبح مرجع الجهاز التشغيلي بعد التركيب
- يمكن أن يتطابقا
- ويمكن أن يختلفا
- **عنوان الجهاز الرئيسي لا يتغير بنتيجة التسليم**
- **فقط نتيجة التركيب الناجحة** يجوز أن تغيّر عنوان الجهاز الرئيسي

### العلاقة بين `open_task` و `visit_task`

> **`open_task` من نوع `device_delivery` = التزام لوجستي حي لتسليم جهاز معين.**
> **`visit_task` = محاولة ميدانية واحدة لتنفيذ هذا الالتزام.**

- تبقى نفس `open_task` حية عند المتابعة العادية
- كل محاولة ميدانية لاحقة تُسجَّل كـ `visit_task` جديدة
- لا نولّد `open_task` جديدة لكل محاولة فاشلة عادية
- إذا أُلغيت المهمة بسبب `refused_delivery` ثم تم التفاهم لاحقاً، يمكن إنشاء `device_delivery` جديدة

### المسار المرجعي الوحيد

> **المسار المرجعي الوحيد لمهمة `device_delivery` هو:**
> `open_task` → `field_visit` → `visit_task` → `visit_task_results` + `visit_task_device_delivery_results`

ولا يجوز تثبيت مسار ثانٍ موازٍ لنتيجة نفس المهمة داخل الملف الدستوري المرجعي.

---

## أ — الهوية

### المحور 1
| البيان | القيمة |
|---|---|
| `task_type` | `device_delivery` |
| الاسم العربي | تسليم الجهاز |
| الاسم الإنجليزي | Device Delivery |
| الوصف | نقل جهاز فعلي محدد إلى عنوان تسليم محدد دون افتراض أن عنوان التسليم هو عنوان التركيب النهائي |

### المحور 2 — `task_family`
`delivery`

### المحور 3 — `display_group`
`after_sale_services`

### المحور 4 — `visit_family`
`service`

---

## ب — الإنشاء

### المحور 5 — `creation_origin` المسموحة
| القيمة | مسموح؟ | السيناريو |
|---|:---:|---|
| `branch_plan` | ❌ | ليست مهمة تخطيط أصلية من خطة الفرع |
| `service_request_call` | ❌ | ليست مهمة intake خدمية |
| `telemarketing_inline_booking` | ❌ | ليست مهمة تيليماركتينغ |
| `cascading_during_visit` | ✅ | يمكن إضافتها ضمن زيارة جارية إذا ظهر احتياج تسليم |
| `manual_creation` | ✅ | إنشاء يدوي من موظف مخول |
| `emergency_request` | ❌ | ليست طوارئ |
| `system_trigger` | ✅ | مثل البيع الناجح الذي يولد التزام تسليم |

### المحور 6 — `location_basis`
`device`

> **تفسير خاص لهذا النوع:**  
> `device_delivery` تُنفَّذ عملياً نحو **عنوان تسليم** قد يختلف عن عنوان التركيب،  
> لكن **التخطيط والإسناد الجغرافي ونطاق العمل** يُبنى على **عنوان الجهاز الحالي** في `installed_devices.installation_*`.
>
> لذلك:
> - `location_basis='device'` هو المرجع التخطيطي لهذا النوع
> - `delivery_address` هو عنوان التنفيذ الفعلي للمهمة
> - ولا يعني اختلاف `delivery_address` أن عنوان الجهاز الرئيسي قد تغيّر

### المحور 7 — منطق التاريخ والنافذة

`device_delivery` مهمة قصيرة النافذة وتعتمد على:
- `due_date` كحقل التخطيط المرجعي
- `task_type_config.planning_window_days` لنافذة الظهور والتخطيط
- قاعدة اليوم الواحد العامة عند `needs_follow_up`

| `open_task.status` | التاريخ المرجعي | النافذة |
|---|---|---|
| `open` وأي حالة غير `needs_follow_up` | `due_date` | `planning_window_days` |
| `needs_follow_up` | `expected_date` | يوم واحد ثابت قبل `expected_date` |

### المحور 8 — التفرّد

**لا يجوز وجود أكثر من `open_task` نشطة من نوع `device_delivery` لنفس `installed_device_id` في الوقت نفسه.**

ويسمح تاريخياً بوجود عدة مهام تسليم متعاقبة لنفس الجهاز، لكن:
- واحدة فقط نشطة في الوقت نفسه
- وإذا أُلغيت مهمة وجرى التفاهم لاحقاً، يمكن إنشاء مهمة جديدة

---

## ب.1 — السبب والسياق

### الأسباب الرسمية المعتمدة
- `sale_delivery`
- `post_maintenance_return`
- `temporary_swap_delivery`
- `replacement_delivery`
- `manual_delivery`

### المرجع العام للسياق المسبب
- `source_context_type`
- `source_context_id`

هذا المرجع يشرح **من أين جاءت المهمة**، لكنه لا يغيّر القاعدة الحاكمة:

> **المهمة ترتبط أولاً بالجهاز (`installed_device`) ثم تُوثِّق سياقها المسبب.**

### قاعدة `pending_delivery`

**إنشاء `device_delivery` هو الحدث الذي يُدخل الجهاز إلى `pending_delivery` أو يُبقيه فيها.**

وهذا لا يقتصر على البيع الأول، بل يشمل أي حالة يكون فيها الجهاز بانتظار تسليم فعلي إلى الزبون.

> **بعد الصيانة:**  
> قد يصبح الجهاز `ready` بعد انتهاء المعالجة الفنية، لكن **لا ينتقل إلى `pending_delivery` تلقائياً**.  
> الانتقال من `ready` إلى `pending_delivery` يتم **يدوياً فقط** عند فتح مهمة `device_delivery`.

---

## ب.2 — الحقول عند الإنشاء

### النواة الأساسية الثابتة
- `installed_device_id`
- `reason`
- `delivery_address`
- `due_date`
- `priority`
- `notes`

### الحقول الشرطية
- `source_context_type`
- `source_context_id`
- `contract_id`
- `dispatch_origin_type`
- `dispatch_origin_label`

### قواعد الإلزامية الشرطية

| `reason` | حقول إضافية تصبح إلزامية |
|---|---|
| `sale_delivery` | `contract_id` |
| `post_maintenance_return` | `dispatch_origin_type` + `dispatch_origin_label` |
| `temporary_swap_delivery` | `source_context_type` + `source_context_id` |
| `replacement_delivery` | `source_context_type` + `source_context_id` |
| `manual_delivery` | لا حقول إضافية ثابتة، ويُستكمل حسب الحاجة التشغيلية |

### مصدر `delivery_address`

`delivery_address` إلزامي، لكنه يُملأ افتراضياً بحسب السياق:

- الافتراضي الابتدائي دائماً = **عنوان الجهاز الحالي** من `installed_devices`
- إذا كانت المهمة ناشئة من عقد ويوجد عليه عنوان تسليم معروف:
  - يمكن استخدامه كاقتراح تعبئة أو override أولي
- إذا كانت المهمة ناشئة من صيانة أو من جهاز قائم:
  - يبقى عنوان الجهاز الحالي هو الافتراضي الطبيعي

ويجب أن يبقى:
- قابلاً للتعديل
- منفصلاً عن عنوان الجهاز الرئيسي

> **القاعدة التشغيلية:**  
> نحتاج عنوان الجهاز الحالي كنقطة انطلاق ثابتة للتخطيط ونطاق العمل.  
> لذلك لا يبدأ `device_delivery` من عنوان حر غير مربوط بالجهاز، بل من عنوان الجهاز الحالي ثم يُعدَّل عند الحاجة.

### تعديل `delivery_address`

يتم تعديل `delivery_address` على **نفس `open_task`** مع تسجيل:
- العنوان السابق
- العنوان الجديد
- سبب التعديل
- من عدّل
- متى عدّل

ويجب أن يُوثَّق التعديل في سجل النشاط (`task_activity_log` أو ما يعادله).

---

## ج — التنفيذ والنتيجة

### المحور 9 — قيم `final_decision` المسموحة

| القيمة | المعنى |
|---|---|
| `delivered_successfully` | تم تسليم الجهاز فعلياً |
| `customer_not_available` | لم ينجح التسليم لأن المستلم غير متاح |
| `wrong_address` | عنوان التسليم الحالي غير صحيح أو غير قابل للتنفيذ |
| `refused_delivery` | رُفض استلام الجهاز في هذه المحاولة |

### المحور 10 — قيم `reason_code`

يُعاد استخدام فئات `system_lists` العامة الموجودة قدر الإمكان:

| `final_decision` | الحاجة إلى `reason_code` |
|---|---|
| `delivered_successfully` | غير إلزامي افتراضياً |
| `customer_not_available` | اختياري إذا احتاج الفريق توضيحاً تشغيلياً |
| `wrong_address` | يفضَّل سبب فرعي يوضح نوع الخطأ |
| `refused_delivery` | يفضَّل سبب فرعي يوضح طبيعة الرفض |

> **قاعدة عامة:** لا نخلق منظومة نتائج موازية لمهمة التسليم إذا كانت فئات عامة قائمة تكفي.  
> ويمكن لاحقاً ربط هذه الحالات بفئات `system_lists` محددة عند مراجعة القيم الإدارية الموجودة فعلاً.

### المحور 11 — Side Tables المخصصة

تُكتب النتيجة عبر:
1. `visit_task_results`
2. `visit_task_device_delivery_results`

ولا يُعتمد أي مسار canonical بديل على `open_task_delivery_results`.

### الحقول الجوهرية في نتيجة التسليم

| الحقل | ملاحظات |
|---|---|
| `outcome` | إحدى القيم الأربع المعتمدة |
| `serial_number` | الهوية الفيزيائية للوحدة المسلَّمة |
| `device_model_id` | تأكيد الموديل الفعلي |
| `delivery_address` | عنوان التسليم الفعلي لهذه المحاولة |
| `actual_delivery_date` | تاريخ التسليم الفعلي |
| `delivered_by_employee_id` | من نفذ التسليم |
| `customer_acknowledged` | إقرار/استلام |
| `delivery_condition` | حالة الجهاز عند التسليم |
| `delivery_photos` | صور إثبات التسليم |
| `delivery_lat` / `delivery_lng` | إحداثيات التسليم إن توفرت |
| `notes` | ملاحظات النتيجة |

### `dispatch_origin`

`dispatch_origin` لا يكون إلزامياً دائماً، لكنه يصبح إلزامياً عندما تكون معرفة نقطة انطلاق الجهاز ذات معنى تشغيلي واضح، مثل:
- `post_maintenance_return`

ويُفضَّل تمثيله عبر:
- `dispatch_origin_type`
- `dispatch_origin_label`

### تحديث عنوان الجهاز بعد التسليم

الأصل العام:
- **نتيجة التسليم لا تغيّر عنوان الجهاز الرئيسي**
- لأن عنوان التسليم ليس بالضرورة هو عنوان التركيب أو الموقع التشغيلي النهائي

لكن عند `reason = post_maintenance_return` يمكن أن تتضمن النتيجة الناجحة قراراً صريحاً:

- `update_device_main_address = true/false`

إذا كانت القيمة `true` يصبح إلزامياً توفير بيانات الموقع الرئيسي الجديد للجهاز، ويُحدَّث مباشرة على `installed_devices`:
- `installation_geo_unit_id`
- `installation_address_text`
- `installation_lat/lng` إن توفرت

إذا كانت القيمة `false`:
- يبقى `delivery_address` مجرد عنوان تسليم
- ولا يتغير عنوان الجهاز الرئيسي

---

## ج.1 — ما بعد التسليم الناجح

عند `delivered_successfully` يمكن أن تتضمن النتيجة قسماً إضافياً:

- `after_delivery_action`

القيم المعتمدة:
- `none`
- `create_installation_task`

إذا كانت القيمة `create_installation_task` يصبح إلزامياً تحديد:
- هل عنوان التركيب:
  - نفس عنوان التسليم
  - أو مختلف
- وإذا كان مختلفاً:
  - `installation_address`
- تاريخ التركيب المطلوب

> **القاعدة الزمنية:**  
> التاريخ المحدد هنا يصبح **`required_date` لمهمة `device_installation` الجديدة**.

### العلاقة بين التسليم والتركيب

- `device_delivery` و`device_installation` مهمتان منفصلتان دائماً
- لكن يمكن تنفيذهما في نفس الزيارة
- نجاح التسليم مستقل عن نجاح التركيب
- توليد التركيب بعد التسليم لا يتم تلقائياً لمجرد نجاح التسليم
- بل يتم فقط إذا اختير `after_delivery_action='create_installation_task'`

### أثر هذه الخطوة على عنوان الجهاز الرئيسي

حتى لو حُدد عنوان تركيب ضمن نتيجة التسليم:
- **لا يتغير عنوان الجهاز الرئيسي هنا** كقاعدة عامة
- عنوان الجهاز الرئيسي لا يتغير إلا إذا نجحت مهمة التركيب لاحقاً فعلاً
- **الاستثناء الوحيد المعتمد في هذا الملف:** `post_maintenance_return` مع `update_device_main_address = true`

---

## د — التأثير الجانبي

### المحور 12 — انعكاس النتيجة على `open_task.status`

| `final_decision` | `open_task.status` بعد | `installed_device.status` بعد |
|---|---|---|
| `delivered_successfully` | `completed` | `delivered` |
| `customer_not_available` | `needs_follow_up` | `pending_delivery` |
| `wrong_address` | `needs_follow_up` | `pending_delivery` |
| `refused_delivery` | `cancelled` | `pending_delivery` |

### قاعدة `wrong_address`

عند `wrong_address`:
- تعود المهمة إلى `needs_follow_up`
- يبقى الجهاز `pending_delivery`
- **لا يجوز إعادة الجدولة قبل تحديث `delivery_address`**

### قاعدة `refused_delivery`

عند `refused_delivery`:
- تُعتبر المحاولة فاشلة ونهائية لهذه المهمة
- تصبح `open_task.status = cancelled`
- يبقى الجهاز `pending_delivery`
- وإذا تم الاتفاق لاحقاً يمكن إنشاء مهمة `device_delivery` جديدة للجهاز نفسه

### المحور 13 — Cascading Effects

| المُطلِق | الأثر |
|---|---|
| `delivered_successfully` + `after_delivery_action='create_installation_task'` | إنشاء `open_task` جديدة من نوع `device_installation` |
| `customer_not_available` | متابعة لاحقة ضمن نفس `open_task` عبر `visit_task` جديدة |
| `wrong_address` | لا متابعة قبل تعديل `delivery_address` |
| `refused_delivery` | لا متابعة على نفس المهمة؛ يمكن إنشاء مهمة جديدة لاحقاً إذا تم التفاهم |

---

## هـ — الصلاحيات

### المحور 14
| الفعل | الصلاحية | الدور المرجعي |
|---|---|---|
| إنشاء `open_task` | `open_tasks.edit` | موظف مخول / مشرف / مدير |
| تعديل `delivery_address` | `open_tasks.edit` | موظف مخول / مشرف / مدير |
| تنفيذ `visit_task` ميدانياً | `field_visits.execute` | الفريق القياسي المسؤول |
| تسجيل النتيجة | `field_visits.execute` | المسؤول عن التنفيذ |
| الإغلاق النهائي | `field_visits.update_result` | مشرف / مدير |
| إعادة فتح مسار جديد بعد الإلغاء | `open_tasks.edit` | مشرف / إدارة حسب الصلاحيات |

---

## قائمة فحص الإصدار (Release Checklist)

- [ ] ملف مرجعي نهائي تحت `features/tasks/device-delivery.md`.
- [ ] صف في `task_type_config` بقيم: `task_type='device_delivery'`, `task_family='delivery'`, `display_group='after_sale_services'`, `visit_family='service'`.
- [ ] `location_basis` لهذا النوع = `device`، بينما `delivery_address` يبقى عنوان التنفيذ الفعلي للمهمة.
- [ ] CHECK على `visit_tasks.task_type` يشمل `device_delivery`.
- [ ] اعتماد `visit_task_device_delivery_results` كـ side table المرجعية الوحيدة.
- [ ] endpoint الموحّد `POST /field-visits/:visitId/tasks/:taskId/result` يبقى هو المسار المرجعي لتسجيل النتيجة.
- [ ] منطق reflection على `open_task.status` و `installed_device.status` يغطي القيم الأربع المعتمدة.
- [ ] منطق `after_delivery_action='create_installation_task'` يولّد `device_installation` بـ `required_date` الصحيح.
- [ ] تعديل `delivery_address` على نفس `open_task` موثق auditياً.
- [ ] منع إعادة الجدولة بعد `wrong_address` قبل تحديث `delivery_address`.
- [ ] دعم `update_device_main_address` في `post_maintenance_return` مع الكتابة على `installed_devices.installation_*`.

---

## المراجع
- [القالب الموحَّد](../unified-task-template.md)
- [What Is A Device](../../contracts/01-what-is-a-device.md)
- [Device User Stories](../../contracts/01a-device-user-stories.md)
- [Unified Device & Contract States](../../contracts/01d-unified-device-contract-states.md)
- [Resolved Contract Decisions](../../contracts/08-resolved-decisions.md)
- [Field Visits Domain](../../domains/field-visits.md)
- [Visits Domain](../../domains/visits.md)
- [Planning Domain](../../domains/planning.md)
