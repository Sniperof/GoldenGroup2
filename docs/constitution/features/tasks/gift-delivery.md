# مهمة تسليم الهدية — `gift_delivery`

> **القالب المرجعي:** [`features/unified-task-template.md`](../unified-task-template.md)  
> **الحالة:** Draft — مبني على نظام [`gift_records`](../gifts.md)  
> **الـ display_group:** `gift_delivery`

---

## مدخل مفاهيمي

`gift_delivery` هي مهمة ميدانية لتسليم سجل هدية معتمد من نظام `gift_records`.

هذه المهمة:
- لا تنشئ الوعد.
- لا تقرر تحقق الشرط.
- لا تقرر كمية جديدة.
- لا تدعم التسليم الجزئي في V1.
- تنفذ تسليم كامل `approved_quantity` المجمدة على `gift_records`.

المسار المرجعي:

```text
gift_records
→ approved_for_delivery
→ open_task(task_type='gift_delivery')
→ field_visit
→ visit_task
→ visit_task_results + visit_task_gift_delivery_results
→ reflection على gift_records
```

---

## العلاقة بين `gift_records` و`open_task`

`gift_records` هو مصدر الحقيقة للهدية.  
`open_task` من نوع `gift_delivery` هو التزام ميداني حي لتسليم سجل هدية محدد.

قاعدة أساسية:

> **لا يجوز إنشاء `gift_delivery` عامة بلا `gift_record_id`.**

يجوز أن ترتبط مهمة تسليم واحدة بأكثر من `gift_record` في V1 عندما تكون كل السجلات لنفس الزبون المستفيد ونفس فرع المسؤولية. في هذه الحالة تعني المهمة أن التسليم يجب أن يغلق كل السجلات المرتبطة دفعة واحدة، ولا يوجد تسليم جزئي.

---

## أ — الهوية

| البيان | القيمة |
|---|---|
| `task_type` | `gift_delivery` |
| الاسم العربي | تسليم هدية |
| الاسم الإنجليزي | Gift Delivery |
| الوصف | تسليم كامل كمية هدية معتمدة لمستفيد زبون |

### `task_family`

`delivery`

### `display_group`

`gift_delivery`

### `visit_family`

`service`

---

## ب — الإنشاء

### `creation_origin` المسموحة

| القيمة | مسموح؟ | السيناريو |
|---|:---:|---|
| `branch_plan` | ❌ | ليست مهمة أصلية من خطة الفرع |
| `service_request_call` | ❌ | ليست طلب خدمة |
| `telemarketing_inline_booking` | ❌ | ليست حجز تيليماركتينغ |
| `cascading_during_visit` | ❌ | لا تنشأ من زيارة أخرى في V1 |
| `manual_creation` | ✅ | إنشاء يدوي من سجل هدية معتمد |
| `emergency_request` | ❌ | ليست طوارئ |
| `system_trigger` | ❌ | لا إنشاء تلقائي في V1 |

### شروط إنشاء المهمة

يجب تحقق الآتي:
- `gift_records.status = 'approved_for_delivery'`.
- المستفيد قابل لمهمة ميدانية، أي زبون معروف.
- لا توجد مهمة `gift_delivery` نشطة لنفس `gift_record_id`.
- وجود `due_date`.
- وجود `priority`.
- وجود فرع مسؤول.

المستفيد:
- إذا كانت الهدية لوسيط بيعة من نوع زبون، يكون `open_tasks.client_id` هو زبون الوسيط، لا صاحب العقد.
- إذا كان المستفيد صاحب العقد، يكون `open_tasks.client_id` هو صاحب العقد.
- إذا كان المستفيد موظفا أو شخصيا، لا تنشأ مهمة. يستخدم التأكيد اليدوي في نظام الهدايا.

### `location_basis`

`client`

التخطيط الجغرافي مبني على الزبون المستفيد من التسليم، وليس بالضرورة على صاحب العقد المصدر.

### منطق التاريخ والنافذة

`gift_delivery` مهمة قصيرة النافذة.

| `open_task.status` | التاريخ المرجعي | النافذة |
|---|---|---|
| `open` وأي حالة غير `needs_follow_up` | `due_date` | `planning_window_days`، الافتراضي الحالي 7 أيام |
| `needs_follow_up` | `expected_date` | يوم واحد ثابت |

### التفرّد

لا يجوز وجود أكثر من مهمة `gift_delivery` نشطة لنفس `gift_record_id`.

الحالات النشطة:

```text
open, needs_follow_up, assigned, in_scheduling, scheduled,
waiting_execution, in_execution, ended
```

---

## ج — الحقول المطلوبة عند إنشاء المهمة

| الحقل | القاعدة |
|---|---|
| `gift_record_id` / `gift_record_ids` | إلزامي، ويجوز تعدد السجلات لنفس الزبون المستفيد |
| `client_id` | الزبون المستفيد |
| `branch_id` | فرع التنفيذ، غالبا `gift_records.responsible_branch_id` |
| `task_type` | `gift_delivery` |
| `task_family` | `delivery` |
| `reason` | من شرط/سبب الهدية أو قيمة `gift_record_delivery` |
| `due_date` | تاريخ مطلوب للتسليم |
| `priority` | أولوية المهمة |
| `notes` | اختيارية |
| `creation_origin` | `manual_creation` |

لقطات مهمة:
- اسم الهدية من `gift_definitions.name`.
- `default_unit_label`.
- `approved_quantity`.
- المستفيد.
- مصادر السجل للعرض فقط.

---

## د — التنفيذ والنتيجة

### قيم `final_decision`

```ts
type GiftDeliveryFinalDecision =
  | 'delivered_successfully'
  | 'refused_gift'
  | 'rescheduled';
```

| القيمة | المعنى |
|---|---|
| `delivered_successfully` | تم تسليم كامل الكمية المعتمدة |
| `refused_gift` | المستفيد رفض الهدية |
| `rescheduled` | لم يتم التسليم الآن وتم تحديد تاريخ متابعة جديد |

### لا يوجد تسليم جزئي

لا تقبل نتيجة `gift_delivery` أي كمية مسلمة جزئيا.

عند النجاح:

```text
delivered_quantity = approved_quantity
```

لكن لا نحتاج حفظ `delivered_quantity` في V1 لأن النجاح يعني الكمية كاملة.

### إقرار التسليم

لا تعتبر المهمة ناجحة إلا مع إقرار تسليم:

```text
delivery_acknowledged = true
```

الإقرار يعني أن كامل الكمية المعتمدة تم تسليمها.

لا يلزم في V1:
- توقيع.
- صورة.
- رقم تسلسلي.
- اسم مستلم.
- مستند مرفق.
- طريقة تسليم خاصة.

---

## هـ — Side Table

الجدول المقترح:

```text
visit_task_gift_delivery_results
```

الحقول المفهومية:

| الحقل | القاعدة |
|---|---|
| `visit_task_result_id` | FK فريد إلى `visit_task_results` |
| `gift_record_id` | FK إلى `gift_records` |
| `gift_definition_id` | لقطة FK للتعريف |
| `approved_quantity_snapshot` | الكمية المجمدة وقت إنشاء/تنفيذ المهمة |
| `unit_label_snapshot` | لقطة وحدة العرض |
| `final_decision` | إحدى القيم المعتمدة |
| `delivery_acknowledged` | إلزامي عند النجاح |
| `refusal_reason_id` | إلزامي عند `refused_gift` من فئة `gift_delivery_refusal_reasons` |
| `reschedule_reason_id` | إلزامي عند `rescheduled` من فئة `gift_delivery_reschedule_reasons` |
| `next_expected_date` | إلزامي عند `rescheduled` |
| `notes` | ملاحظات النتيجة |

---

### قوائم الأسباب

تستخدم مهمة تسليم الهدية قائمتين خاصتين من `system_lists`:

| الفئة | متى تستخدم؟ |
|---|---|
| `gift_delivery_refusal_reasons` | إلزامية عند `refused_gift` |
| `gift_delivery_reschedule_reasons` | إلزامية عند `rescheduled` |

أمثلة `gift_delivery_refusal_reasons`:
- `beneficiary_does_not_want_gift`
- `gift_type_dispute`
- `claims_already_received`
- `eligibility_dispute`
- `other`

أمثلة `gift_delivery_reschedule_reasons`:
- `beneficiary_not_available`
- `unclear_address`
- `requested_later_date`
- `access_failed`
- `company_postponed`
- `other`

لا يوجد `expected_time` أو `next_expected_time` في نتيجة تسليم الهدية. المتابعة تعتمد على التاريخ فقط.

---

## و — انعكاس النتيجة

### على `open_task.status`

| `final_decision` | `open_task.status` بعد |
|---|---|
| `delivered_successfully` | `completed` |
| `refused_gift` | `cancelled` |
| `rescheduled` | `needs_follow_up` |

### على `gift_records.status`

| `final_decision` | `gift_records.status` بعد |
|---|---|
| `delivered_successfully` | `delivered` |
| `refused_gift` | `refused` |
| `rescheduled` | يبقى `delivery_task_created` |

### حالات المتابعة

`rescheduled` لا تنشئ سجل هدية جديدا ولا مهمة جديدة. تبقى نفس `open_task` للمتابعة عبر `visit_task` جديد، ويصبح `next_expected_date` هو تاريخ المتابعة المرجعي.

---

## ز — العلاقة بالتأكيد اليدوي

التأكيد اليدوي لا يستخدم `gift_delivery`.

يستخدم فقط عندما يكون المستفيد غير قابل لمهمة ميدانية، مثل:
- وسيط موظف.
- وسيط شخصي.

عند التأكيد اليدوي:
- `gift_records.status = 'delivered_manually'`.
- يحفظ المستخدم والوقت والملاحظات.
- تغلق كامل الكمية المعتمدة.

---

## ح — الصلاحيات

| الفعل | الصلاحية |
|---|---|
| عرض جدول مهام تسليم الهدايا | `tasks.gifts.view` |
| إنشاء مهمة تسليم من سجل معتمد | `contract_gifts.create_delivery_task` |
| تسجيل نتيجة مهمة التسليم | صلاحية نتائج الزيارات المعتمدة للمسار الموحد |
| تأكيد تسليم يدوي بدون مهمة | `contract_gifts.manual_delivery` |
| عرض سجل الهدية المرتبط بالمهمة | `contract_gifts.view` |

قواعد:
- إنشاء المهمة يجب أن يحمل subject من `gift_records.responsible_branch_id`.
- تسجيل النتيجة يخضع لصلاحيات الزيارات، ثم يطبق reflection على سجل الهدية داخل transaction واحدة.
- لا يكفي إخفاء زر إنشاء المهمة في الواجهة.

---

## ط — قائمة فحص الإصدار

- [ ] `task_type_config` يحتوي `gift_delivery` مع `task_family='delivery'`, `location_basis='client'`, `planning_window_days=7`.
- [ ] إضافة رابط `gift_record_id` إلى `open_tasks` أو جدول ربط واضح.
- [ ] منع أكثر من مهمة نشطة لنفس `gift_record_id`.
- [ ] إنشاء side table `visit_task_gift_delivery_results`.
- [ ] endpoint موحد لتسجيل نتيجة `gift_delivery`.
- [ ] reflection يحدّث `open_task.status` و`gift_records.status` في transaction واحدة.
- [ ] زر إنشاء المهمة يظهر فقط لسجل `approved_for_delivery` ومستفيد زبون.
- [ ] نتيجة النجاح تتطلب `delivery_acknowledged=true`.
- [ ] لا يوجد تسليم جزئي.
- [ ] الرفض يغلق السجل كـ `refused`.
- [ ] `rescheduled` يتطلب سبب إعادة جدولة وتاريخ متابعة فقط، ويبقى على نفس `open_task`.

---

## المراجع

- [نظام الهدايا](../gifts.md)
- [Open Tasks Domain](../../domains/open-tasks.md)
- [Field Visits Domain](../../domains/field-visits.md)
- [Visits Domain](../../domains/visits.md)
- [Device Delivery](./device-delivery.md)
