# مهمة سحب الجهاز — `device_retrieval`

> **القالب المرجعي:** [`features/unified-task-template.md`](../unified-task-template.md)
> **الحالة:** Draft — توثيق دستوري مفاهيمي
> **تاريخ الحسم الأولي:** 2026-06-23
> **الـ display_group:** `after_sale_services`

---

## مدخل مفاهيمي

`device_retrieval` هي مهمة توثق قرار أو محاولة سحب الجهاز من موقعه الحالي بهدف الصيانة أو التبديل، لكنها لا تغير الحيازة بحد ذاتها في النموذج الحالي.

هذه المهمة:
- ليست حركة حيازة
- لا تكتب في `device_possession_log`
- لا تعني إلغاء العقد
- لا تقررها حالة العقد
- تعتمد على حالة الجهاز ومساره التشغيلي
- تختلف عن `device_disconnection`، لأن الفك يوقف الجهاز في موقعه، أما السحب فيوثق الحاجة أو المحاولة اللاحقة للسحب
- تختلف عن `device_transfer`، لأن النقل هو الذي يغير المكان وقد يغير الحيازة

---

## أ — الهوية

| البيان | القيمة |
|---|---|
| `task_type` | `device_retrieval` |
| الاسم العربي | سحب الجهاز |
| الاسم الإنجليزي | Device Retrieval |
| الوصف | توثيق سحب الجهاز أو محاولة سحبه للصيانة أو التبديل دون تغيير حيازة مباشر |

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

### الحالات التي تسمح بالسحب مباشرة

| حالة الجهاز | الحكم | السبب |
|---|---|---|
| `delivered` | مسموح | الجهاز وصل للزبون لكنه ليس مركباً أو مشغلاً، لذلك يمكن سحبه دون مهمة فك |

### الحالات التي تحتاج مهمة فك قبل السحب

| حالة الجهاز | الحكم | السبب |
|---|---|---|
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
&& lastSuccessfulDisconnection.requires_retrieval_task === true
```

حيث:
- `lastSuccessfulDisconnection` هي آخر نتيجة فك ناجحة للجهاز
- النجاح يعني `final_decision = disconnected_successfully`
- `requires_retrieval_task = true` تعني وجود نية سحب لاحقة
- هذا الشرط لا يعني أن السحب تم، بل يعني أن إنشاء مهمة السحب أصبح مسموحاً

> **قرار دستوري:** `requires_retrieval_task` ينتمي إلى نتيجة `device_disconnection`، وليس إلى `final_decision` الخاص بالسحب.

---

## هـ — الإنشاء

مودل الإنشاء المفهومي:

```ts
interface CreateDeviceRetrievalTask {
  taskType: 'device_retrieval';
  installedDeviceId: string;
  retrievalPurpose: 'maintenance' | 'replacement';
  dueDate: string;
  reasonCode?: string;
  notes?: string;
}
```

قواعد الإنشاء:
- يجب وجود `installedDeviceId`
- يجب تحديد `retrievalPurpose`
- يجب وجود موقع حالي يمكن تنفيذ السحب منه
- لا يجوز وجود مهمة سحب نشطة لنفس الجهاز
- لا يجوز إنشاء المهمة من حالة مركبة أو فعالة إلا بعد تحقق شرط الفك أعلاه

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
- `refusal_reason_code`
- `reschedule_reason_code`
- `rescheduled_at`
- `device_condition`
- `device_retrieved`
- `tank_retrieved`
- `faucet_retrieved`
- `accessories_retrieved`
- `customer_acknowledged`
- `received_by_employee_id`
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
- إبقاء الحيازة كما هي
- عدم الكتابة في `device_possession_log`
- عدم اعتبار الجهاز منقولاً إلى مكان آخر إلا عبر مهمة `device_transfer`

الأثر التشغيلي المقترح:

| `retrieval_purpose` | أثر النجاح |
|---|---|
| `maintenance` | يصبح الجهاز مؤهلاً لمسار نقل لاحق إلى الورشة أو مكان الصيانة |
| `replacement` | يصبح الجهاز مؤهلاً لمسار نقل لاحق أو تسليم جهاز بديل حسب القرار |

> **قرار دستوري:** لا يتم تحويل الجهاز إلى `retrieved` أو `in_workshop` بسبب مهمة السحب وحدها. تغيير الحالة المرتبط بالمكان أو الحيازة يحدث في مهمة نقل الجهاز أو إجراء مستقل.

### عند الرفض أو إعادة الجدولة

| `final_decision` | أثر الجهاز | أثر الحيازة |
|---|---|---|
| `retrieved_successfully` | لا تغيير تلقائي في الحالة | لا تغيير |
| `customer_refused_retrieval` | لا تغيير تلقائي | لا تغيير |
| `reschedule` | لا تغيير | لا تغيير |

---

## ط — العلاقة مع المهام الأخرى

### مع `device_disconnection`

- السحب من `delivered` لا يحتاج فكاً.
- السحب من جهاز مركب أو فعال يحتاج فكاً ناجحاً قبله.
- `requires_retrieval_task` داخل نتيجة الفك هو الجسر النظامي الذي يسمح بإنشاء مهمة السحب.

### مع `device_transfer`

- السحب لا يغير الحيازة ولا الموقع وحده.
- إذا تقرر نقل الجهاز فعلياً إلى الورشة أو المستودع أو عنوان آخر، تنشأ مهمة `device_transfer`.
- `device_transfer` هي المهمة التي قد تكتب في `device_possession_log` عندما يتغير الحائز.

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
- [x] ربط السحب من جهاز مركب/فعال بنجاح مهمة الفك و`requires_retrieval_task`.
- [x] تثبيت أن السحب لا يغير الحيازة ولا يكتب في `device_possession_log`.
- [ ] تنفيذ migration لجدول النتيجة.
- [ ] تنفيذ reflection logic.
- [ ] تنفيذ واجهة تسجيل النتيجة.
- [ ] إضافة اختبارات شروط الإنشاء وعدم تغيير الحيازة.

---

## مراجع

- [مهمة فك الجهاز](./device-disconnection.md)
- [مهمة نقل الجهاز](./device-transfer.md)
- [Unified Device & Contract States](../../contracts/01d-unified-device-contract-states.md)
- [Device Delivery](./device-delivery.md)
