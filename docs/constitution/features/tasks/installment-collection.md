# مهمة تسديد الذمم — `installment_collection`

> **القالب المرجعي:** [`features/unified-task-template.md`](../unified-task-template.md)
> **الحالة:** Draft — مبني على نقاش المنتج بتاريخ 2026-06-22
> **الـ display_group:** `collection`

---

## مدخل مفاهيمي — ما هي مهمة تسديد الذمم؟

> **`installment_collection` هي مهمة تحصيل ذمة مرتبطة بقسط واحد فقط، بغض النظر عن مصدر هذه الذمة.**

الاسم التقني `installment_collection` يبقى هو النوع المعتمد في النظام. لا ننشئ `task_type` جديداً لتسديد الذمم، بل نوسع الدلالة التشغيلية لهذا النوع من "تحصيل قسط جهاز" إلى **تسديد ذمة قسط** ضمن فئة التحصيل.

هذه المهمة:
- ترتبط دائماً بقسط واحد في `contract_installments` عبر `installment_id`
- تمثل محاولة تشغيلية لتحصيل الرصيد المفتوح على هذا القسط
- قد يكون مصدر الذمة عقداً، أو مهمة صيانة، أو كفالة ذهبية
- لا تنشئ ذمة مالية جديدة
- لا تنشئ قسطاً جديداً عند الإغلاق
- قد تنشئ مهمة تحصيل جديدة لنفس القسط إذا بقي رصيد بعد دفعة جزئية أو بعد إعادة جدولة
- تسجل الدفعة الفعلية، إن وجدت، في `contract_payment_entries`

### الفصل الحاكم بين القسط والذمة والمهمة

- **القسط** = سجل الاستحقاق المالي في `contract_installments`
- **الذمة** = الرصيد المتبقي المفتوح على القسط (`remaining_balance > 0`)
- **مهمة تسديد الذمة** = محاولة تشغيلية لتحصيل هذا الرصيد أو توثيق سبب عدم تحصيله
- **الدفعة** = حركة قبض فعلية في `contract_payment_entries`

لذلك لا يجوز إنشاء جدول ذمم جديد أو سجل `collection_attempts` موازٍ. سجل التحصيل هو سلسلة مهام `installment_collection` ونتائجها.

### العلاقة بين `open_task` و `visit_task`

> **`open_task` من نوع `installment_collection` = التزام تحصيل ذمة قسط محدد.**
> **`visit_task` = محاولة تنفيذ واحدة لهذا الالتزام ضمن زيارة مجدولة.**

- كل محاولة ميدانية تسجل كـ `visit_task` جديد
- كل `visit_task` له نتيجة واحدة في `visit_task_results`
- المهمة الحالية تنتهي عند تسجيل النتيجة ولا تبقى مفتوحة كمسار متابعة غامض
- المتابعة اللاحقة تتم بإنشاء `open_task` جديد لنفس `installment_id` عند الحاجة

---

## أ — الهوية

### المحور 1

| البيان | القيمة |
|---|---|
| `task_type` | `installment_collection` |
| الاسم العربي | تسديد ذمة |
| الاسم الإنجليزي | Receivable Installment Collection |
| الوصف | تحصيل أو معالجة ذمة مفتوحة مرتبطة بقسط واحد، مع توثيق مصدر الذمة ونتيجة التحصيل داخل الزيارة |

### المحور 2 — `task_family`

`collection`

### المحور 3 — `display_group`

`collection`

### المحور 4 — `visit_family`

`collection`

> **فجوة دستورية يجب حسمها عند التنفيذ:** القالب العام القديم يحصر `visit_family` في `marketing/service/mixed`، بينما الإعدادات والتنفيذ الحاليان يستعملان مفهوم `collection` في التحصيل. لهذه المهمة نعتمد `collection` منطقياً، وعلى التنفيذ أن يوائم CHECK constraints والواجهات مع هذا القرار أو يثبت أن زيارات التحصيل تظهر كـ `service` مع بقاء `task_family='collection'`.

---

## ب — الإنشاء

### المحور 5 — `creation_origin` المسموحة

| القيمة | مسموح؟ | السيناريو |
|---|:---:|---|
| `branch_plan` | ✅ | المدير ينشئ مهمة يدوية لقسط مفتوح غير مرتبط بمهمة نشطة |
| `service_request_call` | ❌ | ليست نتيجة طلب خدمة مباشر |
| `telemarketing_inline_booking` | ❌ | الحجز الهاتفي ينشئ زيارة لمحاولة قائمة، لا ينشئ أصل الذمة |
| `cascading_during_visit` | ❌ | لا تنشأ مهمة تحصيل جديدة من الفريق لحظياً إلا عبر نتائج التحصيل المعتمدة |
| `manual_creation` | ✅ | إنشاء إداري بعد إلغاء مهمة سابقة أو لإعادة تفعيل التحصيل |
| `emergency_request` | ❌ | ليست بلاغ طوارئ |
| `system_trigger` | ✅ | عند تثبيت جدول الأقساط، أو نتيجة `paid_partial`، أو نتيجة `rescheduled` |

### المحور 5.1 — قاعدة إنشاء الأقساط ومهامها

عند تثبيت جدول الأقساط لأي مصدر مالي مقسّط:

1. تنشأ سجلات الأقساط في `contract_installments`.
2. لكل قسط مؤكد وله رصيد متوقع، تنشأ مهمة `installment_collection` واحدة.
3. كل مهمة ترتبط بقسط واحد فقط عبر `installment_id`.
4. لا تظهر كل المهام فوراً للعمل؛ أهلية الظهور والتخطيط يحكمها `lead_window_days` / `planning_window_days` من `task_type_config`.

> **القاعدة:** تنشأ مهام تسديد الذمم دفعة واحدة مقابل الأقساط، لكن التحكم في أهلية العمل يتم عبر N-window، لا عبر تأخير إنشاء المهمة.

### المحور 5.2 — مودل الإنشاء

الحقول المطلوبة لإنشاء مهمة تسديد ذمة:

| الحقل | القاعدة |
|---|---|
| `client_id` | إلزامي، يشتق من القسط/مصدر الذمة عند الإنشاء الآلي |
| `branch_id` | إلزامي، من الفرع المسؤول عن الذمة |
| `task_type` | ثابت: `installment_collection` |
| `task_family` | ثابت: `collection` |
| `installment_id` | إلزامي دائماً |
| `contract_id` | إلزامي عند مصدر عقد، واختياري/مشتق عند مصادر أخرى حسب نموذجها المالي |
| `due_date` | تاريخ استحقاق المهمة، غالباً `contract_installments.due_date` أو تاريخ متابعة جديد |
| `priority` | إلزامي |
| `creation_origin` | إحدى القيم المسموحة في المحور 5 |
| `reason` | سبب إنشاء المهمة من قائمة معتمدة |
| `notes` | اختياري |

الحقول النوعية المطلوبة لهذه المهمة:

| الحقل | القاعدة |
|---|---|
| `receivable_source_type` | `contract` أو `maintenance_task` أو `golden_warranty` |
| `receivable_source_id` | معرف المصدر التشغيلي للذمة |
| `receivable_source_label` | نص ثابت للعرض، مثل رقم العقد أو رقم مهمة الصيانة |
| `expected_amount_syp` | لقطة الرصيد المطلوب وقت إنشاء المهمة |
| `collection_owner_id` | يشتق من `contract_installments.collection_owner_id` إن وجد |
| `source_context_type` | يستخدم عند توليد مهمة من نتيجة سابقة |
| `source_context_id` | معرف النتيجة/المهمة السابقة عند التوليد |

مثال:

```ts
{
  taskType: 'installment_collection',
  clientId: 120,
  branchId: 3,
  installmentId: 4401,
  contractId: 900,
  receivableSourceType: 'contract',
  receivableSourceId: 900,
  receivableSourceLabel: 'عقد رقم C-2026-000900',
  dueDate: '2026-07-01',
  priority: 'medium',
  expectedAmountSyp: 250000,
  creationOrigin: 'system_trigger',
  reason: 'contract_installment_due'
}
```

### المحور 5.3 — أسباب الإنشاء

| `reason` | متى يستخدم؟ |
|---|---|
| `contract_installment_due` | قسط ناتج عن عقد |
| `maintenance_receivable_due` | ذمة ناتجة عن مهمة صيانة |
| `golden_warranty_receivable_due` | ذمة ناتجة عن كفالة ذهبية |
| `remaining_installment_balance` | مهمة جديدة بعد `paid_partial` |
| `rescheduled_collection` | مهمة جديدة بعد `rescheduled` |
| `previous_task_cancelled` | إنشاء يدوي بعد إلغاء مهمة سابقة |
| `manager_followup` | متابعة إدارية |
| `data_correction` | تصحيح تشغيلي موثق |
| `other` | سبب آخر مع ملاحظات إلزامية |

### المحور 5.4 — الإنشاء اليدوي بعد إلغاء مهمة

عند اختيار الزبون في نموذج الإنشاء اليدوي، يعرض النظام فقط الأقساط التي تحقق:

```text
remaining_balance > 0
AND لا توجد مهمة installment_collection نشطة لنفس installment_id
```

المهمة النشطة تعني إحدى الحالات:

```text
open, needs_follow_up, assigned, in_scheduling, scheduled, waiting_execution, in_execution, ended
```

إذا كانت مهمة سابقة لنفس القسط بحالة `completed` أو `cancelled` أو `closed`، وبقي رصيد على القسط، يصبح القسط قابلاً للاختيار مجدداً.

المدخلات اليدوية:
- الزبون
- القسط المختار من قائمة الأقساط القابلة للربط
- التاريخ المطلوب `due_date`
- الأولوية
- سبب الإنشاء
- ملاحظات اختيارية

والنظام يشتق مصدر الذمة والرصيد والفرع والعقد من `installment_id`.

### المحور 6 — `location_basis`

`client`

> تسديد الذمة مهمة تواصل/تحصيل مع الزبون، وليست مهمة مرتبطة بموقع جهاز بالضرورة. حتى لو كان مصدر الذمة عقداً أو صيانة، فإن وجهة التخطيط الأساسية هي الزبون ومعلومات التواصل معه. إذا قرر التنفيذ استخدام موقع العقد الحالي لأغراض التحصيل الميداني، يجب توثيق ذلك كتعديل على `location_basis` أو كحقل موقع تنفيذ منفصل دون تغيير هوية المهمة.

### المحور 7 — منطق التاريخ والنافذة

| حالة المهمة | التاريخ المرجعي | النافذة |
|---|---|---|
| `open` | `due_date` | `task_type_config.planning_window_days` / `lead_window_days` |
| مهمة مولدة بعد `paid_partial` | `next_expected_date` المحفوظ كـ `due_date` | نفس N-window |
| مهمة مولدة بعد `rescheduled` | `next_expected_date` المحفوظ كـ `due_date` | نفس N-window |

لا يعني إنشاء كل مهام الأقساط دفعة واحدة أنها مؤهلة كلها فوراً. الأهلية للتخطيط والظهور في `contact_targets` يحكمها دخول `due_date` ضمن N-window.

### المحور 8 — التفرّد

هذا النوع يكسر القاعدة العامة "مهمة نشطة واحدة لنفس الزبون ونفس النوع"، لأن الزبون الواحد قد يملك عدة أقساط مفتوحة وكل قسط يحتاج مهمة مستقلة.

القاعدة الخاصة:

> **يسمح بوجود عدة مهام `installment_collection` نشطة لنفس `client_id` أو `contract_id`، لكن لا يجوز وجود أكثر من مهمة نشطة واحدة لنفس `installment_id`.**

قيد التفرد المطلوب:

```text
unique active installment_collection by installment_id
```

والمقصود بالنشطة:

```text
open, needs_follow_up, assigned, in_scheduling, scheduled, waiting_execution, in_execution, ended
```

---

## ب.1 — تفاصيل المهمة في الواجهة

كل مهمة تسديد ذمة يجب أن تعرض البنية العامة لصفحة تفاصيل المهمة، إضافة إلى تبويب/قسم مالي خاص.

### الحقول العامة الإلزامية

- الحالة والمرحلة
- الأولوية
- عداد المحاولات
- التاريخ المطلوب `due_date`
- الموعد المتوقع إن وجد `expected_date`
- سبب الإنشاء
- سبب الإلغاء عند وجوده
- مصدر الإنشاء `creation_origin`
- المهمة الأم/السياق عند وجوده
- سجل النشاط
- المكالمات المرتبطة

### الحقول المالية الخاصة

| الحقل | الوصف |
|---|---|
| مصدر الذمة | عقد / مهمة صيانة / كفالة ذهبية |
| رقم المصدر | رقم العقد أو رقم مهمة الصيانة أو رقم الكفالة |
| `installment_id` | القسط المرتبط |
| رقم القسط | `installment_number` |
| تاريخ استحقاق القسط | من `contract_installments.due_date` |
| قيمة القسط الأصلية | `amount_syp` |
| الرصيد المتبقي الحالي | `remaining_balance` |
| المبلغ المتوقع عند إنشاء المهمة | `expected_amount_syp` |
| مالك التحصيل | `collection_owner_id` إن وجد |
| آخر نتيجة تحصيل | آخر نتيجة مسجلة لنفس `installment_id` |

يجب عرض مصدر الذمة بصيغة مفهومة:

- `عقد رقم C-2026-000900`
- `مهمة صيانة رقم M-884`
- `كفالة ذهبية رقم GW-310`

---

## ج — التنفيذ والنتيجة

### المحور 9 — قيم `final_decision` المسموحة

| القيمة | المعنى | نجاح؟ | `open_task.status` |
|---|---|:---:|---|
| `paid_full` | تم تسديد كامل رصيد القسط | ✅ | `completed` |
| `paid_partial` | تم تسديد جزء من رصيد القسط | ✅ | `completed` |
| `rescheduled` | لم يتم الدفع الآن وتم تحديد متابعة جديدة | ✅ تشغيلياً | `completed` |
| `refused_to_pay` | رفض الزبون الدفع | ❌ | `cancelled` |

> `customer_unavailable` ليس نتيجة مستقلة. يستخدم كسبب ضمن `rescheduled` أو ضمن رفض/تعذر التحصيل حسب السياق.

### المحور 10 — قيم `reason_code`

تستخدم ثلاث قوائم أسباب من `system_lists`:

| القائمة | متى تكون إلزامية؟ |
|---|---|
| `collection_partial_payment_reasons` | إلزامية عند `paid_partial` |
| `collection_reschedule_reasons` | إلزامية عند `rescheduled` |
| `collection_refusal_reasons` | إلزامية عند `refused_to_pay` |

أمثلة `collection_partial_payment_reasons`:
- `customer_cash_shortage`
- `salary_or_income_delay`
- `requested_split_payment`
- `disputed_remaining_amount`
- `temporary_financial_hardship`
- `other`

أمثلة `collection_reschedule_reasons`:
- `customer_unavailable`
- `customer_requested_later_date`
- `wrong_address`
- `wrong_contact_info`
- `payment_not_ready`
- `other`

أمثلة `collection_refusal_reasons`:
- `financial_dispute`
- `service_dispute`
- `claims_already_paid`
- `cannot_afford`
- `contract_dispute`
- `refuses_company_followup`
- `other`

### المحور 11 — Side Tables المخصصة

تسجل النتيجة عبر:

1. `visit_task_results`
2. `visit_task_installment_collection_results`

لا يكفي `visit_task_results` وحده لأن نتيجة التحصيل تحتاج حقولاً مالية وحقول متابعة.

الحقول الجوهرية في `visit_task_installment_collection_results`:

| الحقل | القاعدة |
|---|---|
| `visit_task_result_id` | FK فريد إلى `visit_task_results` |
| `installment_id` | القسط المحصل |
| `receivable_source_type` | لقطة نوع مصدر الذمة |
| `receivable_source_id` | لقطة معرف المصدر |
| `amount_before_syp` | الرصيد قبل تسجيل النتيجة |
| `paid_amount_syp` | إلزامي عند `paid_full` و`paid_partial` |
| `remaining_after_syp` | الرصيد بعد النتيجة |
| `payment_entry_id` | الدفعة المنشأة إن وجدت |
| `payment_method` | إلزامي عند وجود دفعة |
| `payment_reference` | اختياري حسب الطريقة |
| `received_by_employee_id` | من استلم الدفعة |
| `partial_payment_reason_id` | إلزامي عند `paid_partial` |
| `reschedule_reason_id` | إلزامي عند `rescheduled` |
| `refusal_reason_id` | إلزامي عند `refused_to_pay` |
| `next_expected_date` | إلزامي عند `paid_partial` و`rescheduled` |
| `next_priority` | إلزامي عند `paid_partial` و`rescheduled` |
| `notes` | ملاحظات النتيجة |

---

## ج.1 — قواعد تسجيل النتيجة داخل الزيارة

تسجيل نتيجة مهمة تسديد الذمة يتم من داخل الزيارة عبر المسار الموحد لنتائج `visit_task`.

### `paid_full`

إلزامي:
- قيمة الدفعة
- طريقة الدفع
- مستلم الدفعة
- ملاحظات اختيارية

الأثر:
- إنشاء `contract_payment_entries` بقيمة الدفعة
- ربط الدفعة بـ `installment_id`
- إعادة حساب القسط
- إذا أصبح `remaining_balance = 0` يصبح القسط `paid`
- إغلاق المهمة الحالية `completed`

### `paid_partial`

إلزامي:
- قيمة الدفعة
- طريقة الدفع
- سبب الدفعة الجزئية
- `next_expected_date`
- `next_priority`

الأثر:
- إنشاء `contract_payment_entries`
- إعادة حساب القسط
- يبقى القسط `partial` إذا بقي `remaining_balance > 0`
- إغلاق المهمة الحالية `completed`
- إنشاء مهمة `installment_collection` جديدة لنفس `installment_id` بقيمة الرصيد المتبقي

### `rescheduled`

إلزامي:
- سبب إعادة الجدولة
- `next_expected_date`
- `next_priority`

الأثر:
- لا تنشأ دفعة
- لا يتغير رصيد القسط
- إغلاق المهمة الحالية `completed`
- إنشاء مهمة `installment_collection` جديدة لنفس `installment_id`

### `refused_to_pay`

إلزامي:
- سبب الرفض
- ملاحظات الرفض عند `other`

الأثر:
- لا تنشأ دفعة
- لا تنشأ مهمة جديدة تلقائياً
- تصبح المهمة الحالية `cancelled`
- يمكن للمدير لاحقاً إنشاء مهمة جديدة يدوياً لنفس القسط إذا بقي الرصيد مفتوحاً

---

## د — التأثير الجانبي

### المحور 12 — انعكاس النتيجة على `open_task.status`

| `final_decision` | `open_task.status` بعد | أثر القسط |
|---|---|---|
| `paid_full` | `completed` | `paid` إذا أصبح الرصيد صفراً |
| `paid_partial` | `completed` | `partial` مع رصيد متبقٍ |
| `rescheduled` | `completed` | بلا تغيير مالي |
| `refused_to_pay` | `cancelled` | بلا تغيير مالي |

كل انعكاس يجب أن يكتب `status_change` في `task_activity_log`.

### المحور 13 — Cascading Effects

| المطلق | الأثر |
|---|---|
| إنشاء/تثبيت جدول الأقساط | إنشاء مهمة `installment_collection` لكل قسط |
| `paid_full` | إنشاء دفعة، إعادة حساب القسط، لا مهمة متابعة لنفس القسط |
| `paid_partial` | إنشاء دفعة، إعادة حساب القسط، إنشاء مهمة جديدة لنفس القسط بالرصيد المتبقي |
| `rescheduled` | إنشاء مهمة جديدة لنفس القسط بتاريخ وأولوية جديدين |
| `refused_to_pay` | لا مهمة جديدة تلقائياً؛ إنشاء جديد لاحق يكون يدوياً من المدير |

قواعد عامة:
- كل الآثار المالية يجب أن تتم في transaction واحدة مع نتيجة الزيارة
- لا يجوز أن تنجح نتيجة المهمة وتفشل كتابة الدفعة
- لا يجوز أن تنشأ مهمة متابعة إذا ظهرت مهمة نشطة أخرى لنفس `installment_id`
- مهمة المتبقي تستخدم `source_context_type='collection_result'` و`source_context_id=visit_task_result_id`

---

## هـ — الصلاحيات

### المحور 14

| الفعل | الصلاحية | الدور المرجعي |
|---|---|---|
| إنشاء مهام الأقساط آلياً | خدمة النظام داخل transaction العقد/المصدر | النظام |
| إنشاء يدوي لمهمة تسديد ذمة | `open_tasks.edit` | مدير الفرع / إدارة مخولة |
| قراءة تفاصيل المهمة | `open_tasks.view` | مستخدم مخول ضمن النطاق |
| جدولة زيارة للمهمة | صلاحيات الجدولة/الزيارات المعتمدة | تيليماركتر / مدير / مشرف حسب المسار |
| تنفيذ المهمة داخل الزيارة | `field_visits.execute` | الفريق المسؤول |
| تسجيل النتيجة | `field_visits.execute` أو صلاحية إغلاق النتائج المعتمدة | المسؤول عن التنفيذ |
| اعتماد/تعديل نتيجة مالية بعد الزيارة | صلاحية إدارية مالية عند الحاجة | مدير / إدارة |

> أي تغيير فعلي في الصلاحيات أو نطاقاتها يجب أن يلتزم بدستور الصلاحيات، وأن لا يعتمد على النصوص أو أسماء الأدوار وحدها.

---

## قائمة فحص الإصدار (Release Checklist)

- [ ] ملف دستوري نهائي تحت `features/tasks/installment-collection.md`.
- [ ] صف `task_type_config` يستخدم `task_type='installment_collection'`, `task_family='collection'`, `display_group='collection'`.
- [ ] حسم `visit_family`: `collection` صريح أو mapping واضح إلى `service`.
- [ ] تحديث التسمية العربية من "تحصيل قسط جهاز" إلى "تسديد ذمة" أو "تسديد ذمة قسط".
- [ ] إضافة/تحديث حقول مصدر الذمة: `receivable_source_type`, `receivable_source_id`, `receivable_source_label`.
- [ ] إضافة `expected_amount_syp` كمبلغ متوقع وقت إنشاء المهمة أو توفير snapshot مكافئ.
- [ ] كسر قيد التفرد العام لهذا النوع، واستبداله بقيد فريد نشط على `installment_id`.
- [ ] إنشاء كل مهام الأقساط عند تثبيت جدول الأقساط.
- [ ] أهلية الظهور والتخطيط تعتمد على N-window من `task_type_config`.
- [ ] نموذج الإنشاء اليدوي يعرض فقط الأقساط ذات رصيد مفتوح ودون مهمة نشطة.
- [ ] `visit_task_installment_collection_results` موجود مع `visit_task_result_id UNIQUE`.
- [ ] قيم `final_decision` الأربع مدعومة: `paid_full`, `paid_partial`, `rescheduled`, `refused_to_pay`.
- [ ] قوائم الأسباب الثلاث في `system_lists` موجودة ومستخدمة.
- [ ] `paid_partial` يلزم سبباً وتاريخ متابعة وأولوية وينشئ مهمة جديدة للمتبقي.
- [ ] `rescheduled` يلزم سبباً وتاريخ متابعة وأولوية وينشئ مهمة جديدة لنفس القسط.
- [ ] `refused_to_pay` يلزم سبب رفض ويلغي المهمة ولا ينشئ مهمة تلقائية.
- [ ] تسجيل الدفعة وتحديث القسط وانعكاس المهمة يتم في transaction واحدة.
- [ ] صفحة تفاصيل المهمة تعرض مصدر الذمة، رقم المصدر، القسط، الرصيد، وسجل المحاولات.
- [ ] كل انعكاس نتيجة يكتب في `task_activity_log`.
- [ ] الصلاحيات مزروعة ومختبرة حسب النطاق.

---

## المراجع

- [القالب الموحَّد](../unified-task-template.md)
- [Financial Obligations](../../contracts/03-financial-obligations.md)
- [Resolved Contract Decisions](../../contracts/08-resolved-decisions.md)
- [Open Tasks Domain](../../domains/open-tasks.md)
- [Visits Domain](../../domains/visits.md)
- [Field Visits Domain](../../domains/field-visits.md)
- [Task Detail Page](../../components/task-detail-page.md)
