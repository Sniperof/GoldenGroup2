# مهمة سحب الجهاز — `device_retrieval`

> **القالب المرجعي:** [`features/unified-task-template.md`](../unified-task-template.md)
> **الحالة:** Draft — توثيق دستوري مفاهيمي
> **تاريخ الحسم الأولي:** 2026-06-23
> **الـ display_group:** `after_sale_services`

---

## مدخل مفاهيمي

`device_retrieval` هي مهمة توثق قرار أو محاولة سحب الجهاز من موقعه الحالي إلى **فرع خدمة الجهاز حصراً** بهدف الصيانة داخل الشركة أو التبديل بجهاز آخر.

هذه المهمة:
- لا تعني إلغاء العقد
- لا تقررها حالة العقد
- تعتمد على حالة الجهاز ومساره التشغيلي
- تختلف عن `device_disconnection`، لأن الفك يوقف الجهاز في موقعه، أما السحب فيوثق الحاجة أو المحاولة اللاحقة للسحب
- تختلف عن `device_transfer`، لأن السحب هنا اتجاهه الوحيد إلى فرع الخدمة، أما النقل فهو حركة جهاز من نقطة إلى أخرى مع تغيير حيازة أو إبقائها حسب نوع النقل

---

## أ — الهوية

| البيان | القيمة |
|---|---|
| `task_type` | `device_retrieval` |
| الاسم العربي | سحب الجهاز |
| الاسم الإنجليزي | Device Retrieval |
| الوصف | توثيق سحب الجهاز أو محاولة سحبه إلى فرع الخدمة للصيانة أو التبديل |

### `task_family`

`service`

### `visit_family`

`service`

---

## ب — غرض السحب

يجب تحديد غرض السحب عند إنشاء المهمة.

```ts
type DeviceRetrievalPurpose =
  | 'maintenance'
  | 'replacement';
```

| القيمة | المعنى |
|---|---|
| `maintenance` | سحب الجهاز إلى الشركة أو الورشة بهدف الفحص أو الصيانة |
| `replacement` | سحب الجهاز القديم تمهيداً أو ضمن مسار تبديله بجهاز آخر |

> **قرار دستوري:** لا يوجد غرض `contract_cancellation` ضمن مهمة السحب. العقد لا يقرر هذه المهمة؛ حالة الجهاز ومساره التشغيلي هما المرجع.

---

## ج — شروط إنشاء المهمة

### الحالات التي تحتاج مهمة فك قبل السحب

| حالة الجهاز | الحكم | السبب |
|---|---|---|
| `delivered` | يحتاج فكاً ناجحاً سابقاً حسب القرار التشغيلي المعتمد | السحب لا يفتح إلا بعد تطبيق مسار الفك وتحوّل الجهاز إلى `out_of_service` |
| `installed` | يحتاج تحقق من الفك أو مسار فك سابق | الجهاز مركب في الموقع |
| `active` | يحتاج مهمة فك ناجحة أولاً | الجهاز يعمل فعلياً ولا يجوز سحبه قبل إيقافه |
| `faulty` | يحتاج تحقق من كونه مفصولاً أو مهمة فك ناجحة إذا كان ما زال مركباً | العطل لا يعني أن الجهاز مفكوك |
| `out_of_service` | يسمح فقط إذا كان خارج الخدمة بسبب فك ناجح موثق ومؤهل للسحب | الحالة وحدها لا تكفي بدون سياق الفك |

### الحالات التي لا تحتاج مهمة سحب

| حالة الجهاز | الحكم | السبب |
|---|---|---|
| `registered` | مرفوض | الجهاز ليس عند الزبون |
| `pending_delivery` | مرفوض | لم يصل الجهاز إلى موقع يحتاج سحباً |
| `in_workshop` | مرفوض | الجهاز موجود أصلاً ضمن مسار الشركة أو الورشة |
| `ready` | مرفوض | الجهاز جاهز داخل مسار الشركة أو الورشة |
| `retrieved` | مرفوض | السحب النهائي أو السابق موثق بالفعل |

---

## د — التعاون مع مهمة الفك

لا يجوز سحب جهاز مركب أو مشغل أو فعال دون تحقق من أن الجهاز أصبح قابلاً للسحب.

الشرط الدستوري لإنشاء `device_retrieval` بعد الفك:

```ts
device.status === 'out_of_service'
&& hasSuccessfulDeviceDisconnection === true
```

حيث:
- `lastSuccessfulDisconnection` هي آخر نتيجة فك ناجحة للجهاز
- النجاح يعني `final_decision = disconnected_successfully` أو مسار فك ناجح مكافئ في البيانات التاريخية
- `requires_retrieval_task = true` تعني وجود نية أو توقع سحب لاحق
- هذا الشرط لا يعني أن السحب تم، بل يعني أن إنشاء مهمة السحب أصبح مسموحاً

> **قرار دستوري:** `requires_retrieval_task` ينتمي إلى نتيجة `device_disconnection` كـ flag إرشادي/تشغيلي فقط، وليس شرط سماح لإنشاء السحب، وليس قيمة من قيم `final_decision` الخاص بالسحب.

---

## هـ — الإنشاء

مودل الإنشاء المفهومي:

```ts
interface CreateDeviceRetrievalTask {
  taskType: 'device_retrieval';
  installedDeviceId: string;
  retrievalPurpose: 'maintenance' | 'replacement';
  serviceBranchId: string;
  dueDate: string;
  reasonCode?: string;
  notes?: string;
}
```

قواعد الإنشاء:
- يجب وجود `installedDeviceId`
- يجب تحديد `retrievalPurpose`
- يجب تحديد `serviceBranchId`
- يجب أن تكون حالة الجهاز `out_of_service`
- يجب وجود مهمة فك ناجحة سابقة
- يجب وجود موقع حالي يمكن تنفيذ السحب منه وفرع خدمة يتم السحب إليه
- لا يجوز وجود مهمة سحب نشطة لنفس الجهاز
- `requires_retrieval_task` لا يمنع ولا يسمح وحده؛ هو فقط يساعد النظام على الاقتراح والتنبيه

---

## و — النتيجة

قيم `final_decision` المعتمدة:

```ts
type DeviceRetrievalFinalDecision =
  | 'retrieved_successfully'
  | 'customer_refused_retrieval'
  | 'reschedule';
```

| القيمة | المعنى | أثر المهمة |
|---|---|---|
| `retrieved_successfully` | تم قبول/تنفيذ خطوة السحب التشغيلية المطلوبة | نجاح دون تغيير حيازة مباشر |
| `customer_refused_retrieval` | رفض الزبون تسليم الجهاز أو السماح بسحبه | إغلاق أو تصعيد حسب السياسة |
| `reschedule` | لم يتم السحب ويجب إعادة الجدولة | متابعة بدون تغيير حيازة |

### أسباب الرفض

عند `customer_refused_retrieval` يجب تسجيل سبب من قائمة مستقلة مثل:

`device_retrieval_refusal_reasons`

أمثلة:
- `customer_denied_access`
- `customer_denied_handover`
- `customer_requires_manager_approval`
- `dispute_on_device_or_accessories`
- `other`

### أسباب إعادة الجدولة

عند `reschedule` يجب تسجيل سبب من قائمة مستقلة مثل:

`device_retrieval_reschedule_reasons`

أمثلة:
- `customer_not_available`
- `technician_not_available`
- `vehicle_or_transport_issue`
- `access_blocked`
- `weather_or_safety_issue`
- `other`

---

## ز — Side Table المخصصة

مقترح التنفيذ:

`visit_task_device_retrieval_results`

حقول مفهومية:
- `visit_task_result_id`
- `final_decision`
- `retrieval_purpose`
- `service_branch_id`
- `refusal_reason_code`
- `reschedule_reason_code`
- `rescheduled_at`
- `customer_acknowledged`
- `technical_notes`
- `closing_notes`

> الصور ليست جزءاً إلزامياً من مودل النتيجة.

---

## ح — الأثر الجانبي

### عند النجاح

إذا كانت النتيجة:

```ts
final_decision = 'retrieved_successfully'
```

فيجب:
- إغلاق مهمة السحب بنجاح
- نقل موقع الجهاز التشغيلي إلى موقع فرع الخدمة
- تطبيق أثر مختلف حسب غرض السحب

الأثر التشغيلي المعتمد:

| `retrieval_purpose` | أثر النجاح |
|---|---|
| `maintenance` | يصبح الجهاز `in_workshop` داخل فرع الخدمة، ولا تتغير ملكية الجهاز |
| `replacement` | يصبح الجهاز `retrieved` وخارج خدمة الزبون وملكاً للشركة، ويصبح موقع التركيب هو موقع فرع الخدمة، وتلغى كل المهام المفتوحة الخاصة به |

> **قرار دستوري:** السحب للصيانة لا يساوي استرجاعاً نهائياً. أما السحب للتبديل فيخرج الجهاز القديم من خدمة الزبون مباشرة ويجعله `retrieved`.

### عند الرفض أو إعادة الجدولة

| `final_decision` | أثر الجهاز | أثر الحيازة |
|---|---|---|
| `retrieved_successfully` | `in_workshop` أو `retrieved` حسب `retrieval_purpose` | حسب المسار |
| `customer_refused_retrieval` | لا تغيير تلقائي | لا تغيير |
| `reschedule` | لا تغيير | لا تغيير |

---

## ط — العلاقة مع المهام الأخرى

### مع `device_disconnection`

- السحب يحتاج فكاً ناجحاً قبله.
- يجب أن تكون حالة الجهاز `out_of_service`.
- `requires_retrieval_task` داخل نتيجة الفك هو flag اقتراح/توقع فقط، وليس شرط سماح.

### مع `device_transfer`

- السحب لا يغير الحيازة ولا الموقع وحده.
- السحب اتجاهه الوحيد إلى فرع خدمة الجهاز.
- `device_transfer` يعالج لاحقاً أي نقل آخر من نقطة إلى أخرى، مع تغيير حيازة أو إبقائها حسب قواعد النقل.

### مع `device_delivery` أو `device_return`

- السحب لا ينشئ تسليماً تلقائياً.
- إذا كان الغرض `replacement`، فمهمة تسليم الجهاز البديل تبقى مهمة مستقلة.
- إذا كان الغرض `maintenance`، فإعادة الجهاز بعد الصيانة تكون مهمة مستقلة لاحقة.

---

## قائمة فحص الإصدار

- [x] تثبيت أن السحب للصيانة أو التبديل فقط.
- [x] تثبيت أن العقد لا يقرر مهمة السحب.
- [x] اعتماد ثلاث قيم فقط لـ `final_decision`.
- [x] فصل أسباب الرفض عن أسباب إعادة الجدولة.
- [x] ربط السحب بنجاح مهمة الفك وحالة `out_of_service`.
- [x] تثبيت أن `requires_retrieval_task` flag فقط وليس شرطاً.
- [x] تثبيت أثر `maintenance -> in_workshop` و`replacement -> retrieved`.
- [x] تنفيذ migration لجدول النتيجة.
- [x] تنفيذ reflection logic.
- [x] تنفيذ واجهة تسجيل النتيجة.
- [ ] إضافة اختبارات شروط الإنشاء وعدم تغيير الحيازة.

---

## مراجع

- [مهمة فك الجهاز](./device-disconnection.md)
- [مهمة نقل الجهاز](./device-transfer.md)
- [Unified Device & Contract States](../../contracts/01d-unified-device-contract-states.md)
- [Device Delivery](./device-delivery.md)
