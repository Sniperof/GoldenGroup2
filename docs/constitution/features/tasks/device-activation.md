# مهمة تشغيل الجهاز — `device_activation`

> **القالب المرجعي:** [`features/unified-task-template.md`](../unified-task-template.md)
> **الحالة:** Active — معتمد 2026-06-06
> **الـ display_group:** `after_sale_services`

---

## مدخل مفاهيمي — ما هي مهمة تشغيل الجهاز؟

> **`device_activation` هي المهمة التقنية التي تُحوّل الجهاز المُسلَّم والمُركَّب إلى جهاز فعّال يُنتج مياهَ صالحة للشرب.**

هذه المهمة:
- تبدأ بعد انتهاء `device_delivery` + `device_installation` (أو تُنفّذ في نفس الزيارة)
- ترتبط دائماً بجهاز فعلي في `installed_devices`
- تُجرى في موقع التركيب النهائي (عنوان العقد)
- لا تُنشأ إلّا إذا كان الجهاز مُركَّباً فعلياً (installation successfully أو external device)
- لا تُنشأ تلقائياً — إما cascading من installation result أو يدوياً

### الفصل الحاكم بين التركيب والتشغيل

- **التركيب** = تثبيت الجهاز مكانياً + ربطه بالمياه والكهرباء
- **التشغيل** = تشغيل الجهاز تقنياً + معايرة الضغط + فحص جودة المياه + تدريب الزبون
- يمكن أن تتم المهمتان في **نفس الزيارة** أو في **زيارتين منفصلتين**
- **التشغيل لا يُنجَز إلّا بعد التركيب** (مباشرةً أو لاحقاً)

### العلاقة بين `open_task` و `visit_task`

> **`open_task` من نوع `device_activation` = التزام تقني حي لتفعيل جهاز مُركَّب.**
> **`visit_task` = محاولة ميدانية واحدة لتنفيذ هذا التفعيل.**

- تبقى نفس `open_task` حية عند المتابعة
- كل محاولة ميدانية فاشلة تُسجَّل كـ `visit_task` جديدة
- لا نُولّد `open_task` جديدة لكل محاولة فاشلة
- إذا أُلغيت المهمة، يمكن إنشاء `device_activation` جديدة لاحقاً

---

## أ — الهوية

### المحور 1
| البيان | القيمة |
|---|---|
| `task_type` | `device_activation` |
| الاسم العربي | تشغيل الجهاز |
| الاسم الإنجليزي | Device Activation |
| الوصف | تفعيل جهاز مُركَّب تقنياً، معايرة ضغط و TDS، تدريب الزبون، وتوثيق حالة الجهاز التشغيلية |

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
|---|---|:---:|---|
| `branch_plan` | ❌ | ليست مهمة تخطيط أصلية من خطة الفرع |
| `service_request_call` | ❌ | ليست مهمة intake خدمية |
| `telemarketing_inline_booking` | ❌ | ليست مهمة تيليماركتينغ |
| `cascading_during_visit` | ✅ | نتيجة ناجحة من `device_installation` تُولّد تشغيلاً تلقائياً |
| `manual_creation` | ✅ | إنشاء يدوي من موظف مخول (لجهاز مُركَّب سابقاً أو خارجي) |
| `emergency_request` | ❌ | ليست طوارئ |
| `system_trigger` | ✅ | نادرة — إذا احتاج النظام تفعيل دوري لجهاز غير مُفعل |

### المحور 6 — `location_basis`
`contract` — التشغيل يحدث في عنوان العقد/التركيب النهائي.

### المحور 7 — منطق التاريخ والنافذة
| `open_task.status` | التاريخ المرجعي | النافذة |
|---|---|---|
| `open` وأي حالة غير `needs_follow_up` | `due_date` | `planning_window_days` = **3 أيام** |
| `needs_follow_up` | `expected_date` | **يوم واحد ثابت** |

### المحور 8 — التفرّد
**لا يجوز وجود أكثر من `open_task` نشطة من نوع `device_activation` لنفس `installed_device_id` في الوقت نفسه.**

---

## ج — التنفيذ والنتيجة

### المحور 9 — قيم `final_decision` المسموحة

| القيمة | المعنى | `open_task.status` بعد |
|---|---|---|
| `activated_successfully` | تم التشغيل والمعايرة بنجاح | `completed` |
| `activation_failed` | تعذّر التشغيل لسبب تقني (ضغط، كهرباء، عطل) | `needs_follow_up` |
| `device_issue` | الجهاز يحتاج صيانة/استبدال قبل التشغيل | `needs_follow_up` أو `cancelled` |

### المحور 10 — قيم `reason_code`

| `final_decision` | الحاجة إلى `reason_code` |
|---|---|
| `activated_successfully` | غير إلزامي |
| `activation_failed` | يُفضَّل — يوضّح السبب التقني |
| `device_issue` | يُفضَّل — يوضّح نوع العطل |

### المحور 11 — Side Tables المخصصة

| الجدول | الغرض | متى يُكتب؟ |
|---|---|---|
| `visit_task_results` | السجل العام (final_decision + reason + notes + closed_by) | دائماً |
| `visit_task_device_activation_results` | تفاصيل التفعيل التقنية (TDS, ضغط, UV, تدريب) | دائماً |

### الحقول الجوهرية في نتيجة التشغيل

| الحقل | ملاحظات |
|---|---|
| `outcome` | إحدى القيم الثلاث المعتمدة |
| `tds_before` | TDS المياه الداخلة |
| `tds_after` | TDS المياه الخارجة |
| `pump_pressure` | ضغط المضخة |
| `membrane_output` | حالة الممبرين |
| `tank_pressure` | ضغط الخزان |
| `uv_status` | حالة UV |
| `customer_trained` | هل تم تدريب الزبون؟ |
| `training_notes` | ملاحظات التدريب |
| `activation_photos` | صور التفعيل |
| `activated_by_employee_id` | الفني المُفعل |

---

## د — التأثير الجانبي

### المحور 12 — انعكاس النتيجة على `open_task.status`

| `final_decision` | `open_task.status` بعد | `installed_device.status` بعد |
|---|---|---|
| `activated_successfully` | `completed` | `active` |
| `activation_failed` | `needs_follow_up` | `installed` (لم يُفعل) |
| `device_issue` | `needs_follow_up` أو `cancelled` | حسب الحالة |

### المحور 13 — Cascading Effects

| المُطلِق | الأثر |
|---|---|
| `activated_successfully` | لا cascading — الجهاز صار `active` |
| `activation_failed` | متابعة لاحقة ضمن نفس `open_task` |
| `device_issue` | قد تُولّد `emergency_maintenance` أو `device_replacement` |

---

## هـ — الصلاحيات

### المحور 14
| الفعل | الصلاحية | الدور المرجعي |
|---|---|---|
| إنشاء `open_task` | `open_tasks.edit` | موظف مخول / مشرف / مدير |
| تنفيذ `visit_task` ميدانياً | `field_visits.execute` | الفريق القياسي المسؤول |
| تسجيل النتيجة | `field_visits.execute` | المسؤول عن التنفيذ |
| الإغلاق النهائي | `field_visits.update_result` | مشرف / مدير |

---

## قائمة فحص الإصدار (Release Checklist)

- [x] صف في `task_type_config` بقيم: `task_type='device_activation'`, `task_family='delivery'`, `display_group='after_sale_services'`, `visit_family='service'`.
- [x] `location_basis` = `contract`.
- [x] `planning_window_days` = 3.
- [x] CHECK على `visit_tasks.task_type` يشمل `device_activation`.
- [x] `visit_task_device_activation_results` موجود وشغال (GAP-057 ✅).
- [x] endpoint الموحّد `POST /field-visits/:visitId/tasks/:taskId/result` يدعم `device_activation`.
- [x] منطق reflection على `open_task.status` و `installed_device.status` يغطي القيم الثلاث.
- [x] `task_group` في `TaskGroupPage.tsx` يضم `device_activation` تحت `after-sale-services`.

---

## المراجع

- [القالب الموحَّد](../unified-task-template.md)
- [Field Visits Domain](../../domains/field-visits.md)
- [Visits Domain](../../domains/visits.md)
- [Device Delivery](./device-delivery.md)
- [Device Installation](./device-installation.md) — إن وُجد
- [Unified Device & Contract States](../../contracts/01d-unified-device-contract-states.md)
