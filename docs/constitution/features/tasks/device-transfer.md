# مهمة نقل الجهاز — `device_transfer`

> **القالب المرجعي:** [`features/unified-task-template.md`](../unified-task-template.md)
> **الحالة:** Draft — توثيق دستوري مفاهيمي
> **تاريخ الحسم الأولي:** 2026-06-23
> **الـ display_group:** `after_sale_services`

---

## مدخل مفاهيمي

`device_transfer` هي مهمة نقل جهاز من مكان إلى مكان آخر.

هذه المهمة:
- تعالج الحركة المكانية الفعلية للجهاز
- قد تكون داخل نفس الحيازة أو بين حائزين مختلفين
- هي المهمة التي يمكن أن تؤثر على `device_possession_log` عندما يتغير الحائز
- لا تعني فك الجهاز
- لا تعني سحب الجهاز للصيانة أو التبديل بحد ذاتها
- لا تعني تشغيل الجهاز في المكان الجديد

> **قرار دستوري:** الفك والسحب لا يغيران الحيازة في النموذج الحالي. نقل الجهاز هو المسار الذي قد يغير الحيازة إذا تغير الحائز.

---

## أ — الهوية

| البيان | القيمة |
|---|---|
| `task_type` | `device_transfer` |
| الاسم العربي | نقل الجهاز |
| الاسم الإنجليزي | Device Transfer |
| الوصف | نقل الجهاز من موقع حالي إلى موقع آخر، مع احتمال تغيير الحيازة إذا تغير الحائز |

### `task_family`

`service`

### `visit_family`

`service`

---

## ب — أنواع النقل

```ts
type DeviceTransferKind =
  | 'location_only'
  | 'possession_transfer';
```

| القيمة | المعنى | أثر الحيازة |
|---|---|---|
| `location_only` | نقل الجهاز إلى عنوان أو مكان آخر مع بقاء نفس الحائز | لا يغير `device_possession_log` |
| `possession_transfer` | نقل الجهاز إلى جهة أو شخص آخر يصبح حائزاً للجهاز | يغير `device_possession_log` |

أمثلة:
- نقل الجهاز من منزل الزبون إلى منزل آخر لنفس الزبون: `location_only`
- نقل الجهاز من الزبون إلى الورشة أو المستودع: `possession_transfer`
- نقل الجهاز من فني إلى فني آخر: `possession_transfer`
- نقل الجهاز من الورشة إلى الزبون بعد الصيانة: `possession_transfer`

---

## ج — الإنشاء

مودل الإنشاء المفهومي:

```ts
interface CreateDeviceTransferTask {
  taskType: 'device_transfer';
  installedDeviceId: string;
  transferKind: 'location_only' | 'possession_transfer';
  dueDate: string;

  fromLocationId?: string;
  fromAddressSnapshot?: string;

  toLocationId?: string;
  toAddressSnapshot?: string;

  fromHolderType?: 'customer' | 'technician' | 'warehouse' | 'workshop' | 'supplier';
  fromHolderId?: string;

  toHolderType?: 'customer' | 'technician' | 'warehouse' | 'workshop' | 'supplier';
  toHolderId?: string;

  reasonCode?: string;
  notes?: string;
}
```

قواعد الإنشاء:
- يجب وجود `installedDeviceId`
- يجب تحديد `transferKind`
- يجب تحديد مكان الانطلاق أو لقطة كافية عنه
- يجب تحديد المكان الجديد أو لقطة كافية عنه
- عند `possession_transfer` يجب تحديد الحائز الحالي والحائز الجديد
- لا يجوز وجود مهمة نقل نشطة لنفس الجهاز في الوقت نفسه
- لا يجوز استخدام النقل كبديل عن فك جهاز ما زال يحتاج فكا

---

## د — شروط العلاقة مع الفك والسحب

### بعد الفك

إذا كان الجهاز `active` أو مركباً ويحتاج نقلاً، فيجب أن يكون قابلاً للنقل أولاً.

المسار المرجعي:

```text
device_disconnection -> device_retrieval? -> device_transfer
```

حيث:
- `device_disconnection` يوقف الجهاز أو يفصله
- `device_retrieval` يوثق نية أو محاولة السحب للصيانة أو التبديل
- `device_transfer` ينقل الجهاز فعلياً إلى مكان آخر وقد يغير الحيازة

### من حالة `delivered`

إذا كان الجهاز في حالة `delivered` ولم يركب بعد، يمكن إنشاء نقل مباشرة عندما يكون المطلوب تغيير مكانه أو حائزه.

---

## هـ — النتيجة

قيم `final_decision` المقترحة:

```ts
type DeviceTransferFinalDecision =
  | 'transferred_successfully'
  | 'customer_refused_transfer'
  | 'reschedule';
```

| القيمة | المعنى | الأثر |
|---|---|---|
| `transferred_successfully` | تم نقل الجهاز إلى المكان المحدد | يطبق أثر المكان، وقد يطبق أثر الحيازة |
| `customer_refused_transfer` | رفض الطرف المعني إتمام النقل | لا تغيير تلقائي |
| `reschedule` | لم يتم النقل ويجب إعادة جدولته | لا تغيير تلقائي |

### أسباب الرفض

`device_transfer_refusal_reasons`

أمثلة:
- `customer_refused_access`
- `customer_refused_handover`
- `receiver_refused_receipt`
- `address_dispute`
- `other`

### أسباب إعادة الجدولة

`device_transfer_reschedule_reasons`

أمثلة:
- `customer_not_available`
- `receiver_not_available`
- `transport_issue`
- `wrong_or_incomplete_address`
- `safety_or_access_issue`
- `other`

---

## و — Side Table المخصصة

مقترح التنفيذ:

`visit_task_device_transfer_results`

حقول مفهومية:
- `visit_task_result_id`
- `final_decision`
- `transfer_kind`
- `from_location_snapshot`
- `to_location_snapshot`
- `from_holder_type`
- `from_holder_id`
- `to_holder_type`
- `to_holder_id`
- `refusal_reason_code`
- `reschedule_reason_code`
- `rescheduled_at`
- `device_condition_before`
- `device_condition_after`
- `customer_acknowledged`
- `receiver_acknowledged`
- `transferred_by_employee_id`
- `technical_notes`
- `closing_notes`

---

## ز — الأثر الجانبي

### عند `location_only`

إذا كانت النتيجة `transferred_successfully` و`transfer_kind = location_only`:
- يحدث موقع الجهاز أو موقع التركيب حسب القاعدة المعتمدة
- لا يغلق سجل الحيازة الحالي
- لا يفتح سجل حيازة جديد
- يبقى الحائز نفسه

### عند `possession_transfer`

إذا كانت النتيجة `transferred_successfully` و`transfer_kind = possession_transfer`:
- يغلق سجل الحيازة الحالي في `device_possession_log`
- يفتح سجل حيازة جديد للحائز الجديد
- يسجل سبب النقل ومرجع المهمة
- يراجع أثر الحالة التشغيلية بحسب الحائز الجديد

أمثلة أثر الحالة:

| الحائز الجديد | حالة الجهاز المحتملة |
|---|---|
| `workshop` | `in_workshop` |
| `warehouse` | `ready` أو حالة مخزون مناسبة حسب مسار الجهاز |
| `customer` | لا يعني `active` تلقائياً؛ التشغيل يحتاج مهمة مستقلة إذا لزم |
| `technician` | حالة انتقالية لا تكفي وحدها لإغلاق المسار التشغيلي |

> **قرار دستوري:** نقل الجهاز إلى حائز جديد هو ما قد يغير الحيازة. أما تغيير الحالة التشغيلية فيجب أن يبقى تابعاً للمعنى التشغيلي، لا لمجرد وجود حركة نقل.

---

## ح — العلاقة مع المهام الأخرى

### مع `device_disconnection`

- لا ينقل الفك الجهاز.
- إذا كان الجهاز يحتاج فكا قبل النقل، يجب إنهاء الفك أولاً.

### مع `device_retrieval`

- لا يغير السحب الحيازة.
- السحب قد يسبق النقل عندما يكون سبب النقل صيانة أو تبديل.
- النقل هو الذي يوثق الحركة المكانية والحيازة عند الحاجة.

### مع `device_delivery` و`device_return`

- التسليم والإرجاع يمكن اعتبارهما مسارات نقل متخصصة باتجاه الزبون.
- `device_transfer` يبقى النوع العام عندما يكون النقل بين أماكن أو حائزين خارج سيناريو التسليم القياسي.

---

## قائمة فحص الإصدار

- [x] تثبيت أن النقل هو المسار الذي قد يغير الحيازة.
- [x] فصل `location_only` عن `possession_transfer`.
- [x] تثبيت أن الفك والسحب لا يكتبان في `device_possession_log`.
- [ ] حسم قيم `reason_code` النهائية.
- [ ] تنفيذ migration لجدول النتيجة.
- [ ] تنفيذ reflection logic.
- [ ] تنفيذ واجهة تسجيل النتيجة.
- [ ] إضافة اختبارات نقل المكان فقط ونقل الحيازة.

---

## مراجع

- [مهمة فك الجهاز](./device-disconnection.md)
- [مهمة سحب الجهاز](./device-retrieval.md)
- [Device Possession Ledger](../../contracts/01e-device-possession-ledger.md)
- [Unified Device & Contract States](../../contracts/01d-unified-device-contract-states.md)
