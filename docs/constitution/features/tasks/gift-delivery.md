# مهمة تسليم الهدية — `gift_delivery`

> **القالب المرجعي:** [`features/unified-task-template.md`](../unified-task-template.md)  
> **الحالة:** معتمد دستوريا — آخر تسوية منتج 2026-07-26، والتنفيذ البرمجي قيد المطابقة
> **الـ display_group:** `gift_delivery`

---

## مدخل مفاهيمي

`gift_delivery` هي مهمة ميدانية لتسليم سجل هدية معتمد أو مجموعة سجلات معتمدة من نظام `gift_records`.

هذه المهمة:
- لا تنشئ الوعد.
- لا تقرر تحقق الشرط.
- لا تقرر كمية جديدة.
- لا تدعم التسليم الجزئي في V1.
- تنفذ كامل `approved_quantity` المجمدة لكل سجل مرتبط.
- تطبق نتيجة جماعية واحدة على كل السجلات المرتبطة، دون نتيجة جزئية لكل سجل.

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

### عقد الاتساق مع النموذج العام

`gift_delivery` نوع مهمة داخل النظام الموحد، وليس workflow موازيا له. لذلك تلتزم حرفيا بالبنية العامة التالية:

- تستخدم حالات ومراحل `open_tasks` العامة دون إضافة حالة خاصة بالهدايا.
- تستخدم الإسناد والتخطيط والجدولة وإنشاء `field_visit` و`visit_task` نفسها المستخدمة لبقية المهام.
- إلغاء ما قبل الجدولة يمر حصرا عبر `POST /open-tasks/:id/cancel` وسياسة الإلغاء المشتركة.
- تسجيل النتيجة أو تعديلها يمر حصرا عبر `POST /field-visits/:visitId/tasks/:taskId/result`.
- نتيجة المهمة الأساسية تحفظ في `visit_task_results`; الجدول `visit_task_gift_delivery_results` امتداد نوعي للحمولة واللقطات فقط.
- إكمال الزيارة وإقفالها وإعادة فتحها للتصحيح يخضع لدورة الزيارة العامة وصلاحياتها.
- صفحة تفاصيل المهمة تستخدم `TaskDetailLayout` العام لعرض الحالة والنتيجة والمحاولات، ولا تسجل نتيجة منها.
- لا تكتب أي واجهة حالة `open_task` أو `visit_task` مباشرة لتجاوز services المشتركة.

الامتدادات الوحيدة المسموحة لهذا النوع:

- التحقق من أهلية `gift_records` قبل إنشاء المهمة.
- جدول الربط بين المهمة وسجلات الهدايا.
- قوائم أسباب الرفض وإعادة الجدولة وإلغاء محاولة التنفيذ.
- side table الخاصة بلقطات سجلات الهدايا.
- reflection ذري على سجلات الهدايا بعد أن يسجل المسار الموحد النتيجة.

أي endpoint مستقل للنتيجة، أو حالات مهمة خاصة بالهدايا، أو زر نتيجة خارج الزيارة يعد تعارضا دستوريا.

---

## العلاقة بين `gift_records` و`open_task`

`gift_records` هو مصدر الحقيقة للهدية.  
`open_task` من نوع `gift_delivery` هو التزام ميداني حي لتسليم سجل هدية محدد أو مجموعة سجلات متجانسة.

قاعدة أساسية:

> **لا يجوز إنشاء `gift_delivery` عامة بلا علاقة صريحة بسجل هدية واحد على الأقل.**

يجوز أن ترتبط مهمة تسليم واحدة بأكثر من `gift_record` عندما تكون كل السجلات لنفس الزبون المستفيد ونفس فرع المسؤولية. يختار المستخدم التجميع صراحة، وتغلق النتيجة كل السجلات دفعة واحدة.

تحفظ العلاقة في جدول ربط صريح بين `open_tasks` و`gift_records`. لا يجوز تمثيل المجموعة بوضع معرف أول سجل فقط في `source_context_id` أو `delivery_task_id` واعتباره ممثلا للبقية.

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
- كل السجلات المختارة تملك نفس `beneficiary_client_id` ونفس `responsible_branch_id`.
- المستفيد قابل لمهمة ميدانية، أي زبون معروف.
- لا توجد مهمة `gift_delivery` نشطة لأي سجل مختار.
- اختيار التجميع صريح وليس اقتراحا تلقائيا ملزما.
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

لا يجوز وجود أكثر من مهمة `gift_delivery` نشطة لأي `gift_record_id`. يفرض ذلك على جدول الربط، لا على معرف مصدر واحد في `open_tasks`.

الحالات النشطة:

```text
open, needs_follow_up, assigned, in_scheduling, scheduled,
waiting_execution, in_execution, ended
```

---

## ج — الحقول المطلوبة عند إنشاء المهمة

| الحقل | القاعدة |
|---|---|
| `gift_record_ids` | قائمة غير فارغة، ويجوز تعدد السجلات لنفس الزبون المستفيد والفرع |
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

قبل الإنشاء تعرض الواجهة السجلات المختارة وتوضح أن المهمة ذات نتيجة واحدة جماعية: نجاح الكل أو رفض الكل أو إعادة جدولة الكل.

---

## د — التنفيذ والنتيجة

### قيم `final_decision`

```ts
type GiftDeliveryFinalDecision =
  | 'delivered_successfully'
  | 'refused_gift'
  | 'rescheduled';
```

هذه قائمة مغلقة. يرفض الخادم أي قيمة رابعة، وبخاصة `partially_delivered`, `partial`, `pending_delivery` أو أي نتيجة محلية لا يعرفها سجل النتائج الموحد.

| القيمة | المعنى |
|---|---|
| `delivered_successfully` | تم تسليم كامل الكمية المعتمدة |
| `refused_gift` | المستفيد رفض الهدية |
| `rescheduled` | لم يتم التسليم الآن وتم تحديد تاريخ متابعة جديد |

إذا كانت المهمة مرتبطة بعدة سجلات، فإن `final_decision` واحدة للمجموعة كلها:
- `delivered_successfully`: كل السجلات سلمت بالكامل.
- `refused_gift`: المستفيد رفض كامل المجموعة.
- `rescheduled`: كامل المجموعة باقية للمتابعة.

لا توجد نتيجة مختلفة لكل سجل داخل المهمة الواحدة.

### لا يوجد تسليم جزئي

لا تقبل نتيجة `gift_delivery` أي كمية مسلمة جزئيا.

نموذج النتيجة لا يعرض:
- كمية مسلمة.
- كمية متبقية.
- اختيار نتيجة منفصلة لكل `gift_record`.
- إبقاء بعض سجلات المجموعة مفتوحة وإغلاق بعضها.

عند النجاح:

```text
delivered_quantity = approved_quantity
```

لكن لا نحتاج حفظ `delivered_quantity` في V1 لأن النجاح يعني الكمية كاملة.

### إقرار التسليم

لا تعتبر المهمة ناجحة إلا مع إقرار تسليم:

```text
customer_acknowledged = true
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
| `visit_task_result_id` | FK إلى `visit_task_results` |
| `gift_record_id` | FK إلى `gift_records` |
| `gift_definition_id` | لقطة FK للتعريف |
| `approved_quantity_snapshot` | الكمية المجمدة وقت إنشاء/تنفيذ المهمة |
| `unit_label_snapshot` | لقطة وحدة العرض |
| `final_decision` | إحدى القيم المعتمدة |
| `customer_acknowledged` | إلزامي عند النجاح |
| `refusal_reason_id` | إلزامي عند `refused_gift` من فئة `gift_delivery_refusal_reasons` |
| `reschedule_reason_id` | إلزامي عند `rescheduled` من فئة `gift_delivery_reschedule_reasons` |
| `next_expected_date` | إلزامي عند `rescheduled` |
| `notes` | ملاحظات النتيجة |

المفتاح الفريد هو `(visit_task_result_id, gift_record_id)` لأن النتيجة الواحدة قد تحمل عدة صفوف، صفا لكل سجل هدية مرتبط. تحفظ كل الصفوف نفس `final_decision` الجماعية مع لقطة كمية وتعريف كل سجل.

---

### قوائم الأسباب

تستخدم مهمة تسليم الهدية ثلاث قوائم مستقلة من `system_lists`:

| الفئة | متى تستخدم؟ |
|---|---|
| `gift_delivery_refusal_reasons` | إلزامية عند `refused_gift` |
| `gift_delivery_reschedule_reasons` | إلزامية عند `rescheduled` |
| `gift_delivery_task_cancellation_reasons` | إلزامية عند إلغاء المهمة قبل زيارة فعالة |

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

### إلغاء المهمة قبل زيارة فعالة

يستخدم endpoint إلغاء المهام العام وسياسة الحالات العامة. المعنى هنا إلغاء محاولة التنفيذ، وليس رفض المستفيد:

- يمنع الإلغاء إذا وجدت زيارة فعالة.
- تتحول `open_task.status` إلى `cancelled`.
- تعود كل سجلات الهدية المرتبطة إلى `approved_for_delivery`.
- تصبح السجلات قابلة لإنشاء مهمة أخرى.
- تبقى علاقة المهمة الملغاة محفوظة تاريخيا، مع إزالة صفة الرابط النشط فقط.
- لا تستخدم `gift_delivery_refusal_reasons` ولا تتحول السجلات إلى `refused`.
- ينطبق ذلك أيضا على `needs_follow_up` بعد إعادة جدولة سابقة ما دام لم تسجل نتيجة رفض.

---

## و — انعكاس النتيجة

### على `open_task.status`

| `final_decision` | `open_task.status` بعد |
|---|---|
| `delivered_successfully` | `completed` |
| `refused_gift` | `cancelled` |
| `rescheduled` | `needs_follow_up` |

### على `gift_records.status`

| `final_decision` | حالة كل `gift_record` مرتبط بعد النتيجة |
|---|---|
| `delivered_successfully` | `delivered` |
| `refused_gift` | `refused` |
| `rescheduled` | يبقى `delivery_task_created` |

### حالات المتابعة

`rescheduled` لا تنشئ سجل هدية جديدا ولا مهمة جديدة. تبقى نفس `open_task` للمتابعة عبر `visit_task` جديد، ويصبح `next_expected_date` هو تاريخ المتابعة المرجعي.

### تصحيح نتيجة المهمة

تتبع `gift_delivery` النموذج العام للمهام والزيارات:

1. إذا كانت الزيارة `closed`، تعاد إلى `ended` عبر `POST /field-visits/:id/reopen`.
2. يلزم `field_visits.reopen_closed` وسبب مكتوب.
3. تعدل نتيجة نفس `visit_task` من داخل الزيارة عبر endpoint النتائج الموحد.
4. يعاد احتساب انعكاس النتيجة على نفس `open_task` وكل سجلات الهدايا المرتبطة داخل معاملة واحدة.
5. تستكمل الزيارة وتقفل مجددا.

قواعد الانعكاس العكسي:
- يجب تحميل السجلات من علاقة المهمة التاريخية، لا بشرط أن تكون حالتها الحالية `delivery_task_created`.
- تصحيح `delivered` أو `refused` إلى `rescheduled` يعيد كل السجلات إلى `delivery_task_created` ويعيد المهمة إلى `needs_follow_up`.
- تصحيح النتيجة إلى `delivered_successfully` أو `refused_gift` يطبق الحالة النهائية الجديدة على المجموعة كلها.
- لا ينشأ `gift_record` أو `open_task` جديد للتصحيح.
- لا يوجد زر تصحيح نتيجة من صفحة تفاصيل المهمة أو صفحة الهدايا؛ سياق التسجيل والتعديل المرجعي هو الزيارة.

---

## ز — العلاقة بالتأكيد اليدوي

التأكيد اليدوي لا يستخدم `gift_delivery`، لكنه ليس محصورا بنوع مستفيد. يستخدم عندما يتم التنفيذ دون زيارة، مثل استلام زبون من الشركة، تسليم مباشر، عقد هدية، وسيط موظف، أو وسيط شخصي.

عند التأكيد اليدوي:
- يجب أن يكون السجل `approved_for_delivery`.
- يجب ألا توجد مهمة تسليم نشطة؛ وإذا وجدت مهمة قابلة للإلغاء، تلغى أولا عبر المسار العام.
- `gift_records.status = 'delivered_manually'`.
- تحفظ الطريقة والمستخدم والوقت والفرع والملاحظات.
- يلزم إقرار بتنفيذ كامل الكمية.
- تغلق كامل الكمية المعتمدة.
- لا يلزم توقيع أو صورة أو مرفق.

إعادة فتح `delivered_manually` ليست تصحيح نتيجة مهمة لأنها بلا زيارة. تستخدم فعلا إداريا مماثلا يتطلب `contract_gifts.reopen_manual_delivery` وسببا إلزاميا، ويعيد السجل إلى `approved_for_delivery` مع حفظ الأثر السابق.

---

## ح — الصلاحيات

| الفعل | الصلاحية |
|---|---|
| عرض جدول مهام تسليم الهدايا | `tasks.gifts.view` |
| إنشاء مهمة تسليم من سجل معتمد | `contract_gifts.create_delivery_task` |
| تسجيل أو تعديل نتيجة مهمة التسليم من الزيارة | `tasks.results.record` مع قواعد مرحلة الزيارة D11 |
| تأكيد تسليم يدوي بدون مهمة | `contract_gifts.manual_delivery` |
| إعادة فتح تسليم يدوي | `contract_gifts.reopen_manual_delivery` |
| عرض سجل الهدية المرتبط بالمهمة | `contract_gifts.view` |

قواعد:
- إنشاء المهمة يجب أن يحمل subject من `gift_records.responsible_branch_id`.
- تسجيل النتيجة يخضع لصلاحيات الزيارات، ثم يطبق reflection على سجل الهدية داخل transaction واحدة.
- تعديل نتيجة بعد انتهاء الزيارة يخضع لقاعدة D11، وإعادة فتح `closed` تتطلب `field_visits.reopen_closed`.
- لا يكفي إخفاء زر إنشاء المهمة في الواجهة.

---

## ط — قائمة فحص الإصدار

- [ ] `task_type_config` يحتوي `gift_delivery` مع `task_family='delivery'`, `location_basis='client'`, `planning_window_days=7`.
- [ ] لا توجد حالات أو phases أو مسارات جدولة خاصة بـ `gift_delivery` خارج النموذج الموحد.
- [ ] إنشاء جدول ربط صريح يدعم عدة `gift_records` لكل مهمة ويحفظ الروابط الملغاة تاريخيا.
- [ ] منع أكثر من مهمة نشطة لكل `gift_record_id` على جدول الربط.
- [ ] إنشاء side table `visit_task_gift_delivery_results`.
- [ ] endpoint موحد لتسجيل نتيجة `gift_delivery`.
- [ ] قائمة `final_decision` مغلقة على `delivered_successfully`, `refused_gift`, `rescheduled` فقط، والخادم يرفض أي partial.
- [ ] reflection يحدّث `open_task.status` و`gift_records.status` في transaction واحدة.
- [ ] زر إنشاء المهمة يدعم اختيار عدة سجلات معتمدة لنفس المستفيد والفرع ويحذر من النتيجة الجماعية.
- [ ] نتيجة النجاح تتطلب `customer_acknowledged=true`.
- [ ] لا يوجد تسليم جزئي.
- [ ] الرفض يغلق السجل كـ `refused`.
- [ ] `rescheduled` يتطلب سبب إعادة جدولة وتاريخ متابعة فقط، ويبقى على نفس `open_task`.
- [ ] إلغاء المهمة دون زيارة فعالة يعيد جميع السجلات إلى `approved_for_delivery` ولا يسجل رفضا.
- [ ] تصحيح النتيجة بعد إعادة فتح الزيارة يعكس الحالات النهائية السابقة بصورة صحيحة.
- [ ] لا يوجد مسار تسجيل أو تعديل نتيجة من صفحة تفاصيل المهمة.
- [ ] اختبارات تعاقد تثبت استخدام endpoint الإلغاء العام، endpoint النتيجة الموحد، وإعادة فتح الزيارة العامة.

---

## المراجع

- [نظام الهدايا](../gifts.md)
- [Open Tasks Domain](../../domains/open-tasks.md)
- [Field Visits Domain](../../domains/field-visits.md)
- [Visits Domain](../../domains/visits.md)
- [Device Delivery](./device-delivery.md)
