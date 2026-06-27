# مهمة نقل الجهاز — `device_transfer`

## التعريف

`device_transfer` هي مهمة نقل جهاز موجود عند الزبون إلى عنوان مبدئي جديد، من دون تركيب أو تشغيل.

المهمة لها مساران فقط:

1. نقل الجهاز إلى عنوان جديد لنفس الزبون.
2. نقل الجهاز إلى زبون آخر موجود مسبقاً.

النقل لا يشمل السحب إلى الشركة، ولا الإرجاع من الورشة، ولا النقل إلى فني أو مستودع أو فرع خدمة.

## الفرق عن المهام الأخرى

- `device_retrieval`: سحب الجهاز باتجاه الشركة أو فرع الخدمة.
- `device_return`: إرجاع جهاز كان في الورشة بعد صيانة.
- `device_transfer`: نقل الجهاز بين موقع زبون وموقع زبون، مع إبقاء الحيازة أو نقلها لزبون آخر.
- `device_installation`: يؤكد عنوان التركيب النهائي لاحقاً.

## شروط إنشاء المهمة

يسمح بإنشاء `device_transfer` فقط عندما:

- الجهاز موجود ومربوط بسجل `installed_devices`.
- حالة الجهاز واحدة من:
  - `delivered`
  - `installed`
  - `active`
- لا توجد مهمة نقل نشطة لنفس الجهاز.
- يوجد عنوان مبدئي جديد.
- العنوان المبدئي يحدد حيّاً من `geo_units` بمستوى `level = 4`.
- الحي المختار فعّال وليس `inactive`.
- عند النقل إلى زبون آخر يجب تحديد زبون موجود مسبقاً ومختلف عن الزبون الحالي.

العقد لا يدخل في قرار إنشاء المهمة.

## مودل الإنشاء

```ts
interface CreateDeviceTransferTask {
  taskType: 'device_transfer';
  clientId: number;              // الزبون الحالي
  installedDeviceId: number;
  transferKind: 'same_customer_new_address' | 'another_customer';
  targetClientId?: number | null; // مطلوب فقط عند another_customer
  plannedTransferGeoUnitId: number; // حي level 4
  plannedTransferAddressText: string;
  plannedTransferLat?: number | null;
  plannedTransferLng?: number | null;
  dueDate: string;
  priority?: 'high' | 'medium' | 'low';
  notes?: string | null;
}
```

## العنوان المبدئي الجديد

يستخدم نفس منطق عناوين التركيب في المشروع:

- `geo_units` عبر `GeoSmartSearch`.
- يجب اختيار الحي النهائي `level = 4`.
- العنوان التفصيلي مطلوب.
- الإحداثيات اختيارية.

العنوان هنا مبدئي. مهمة التركيب اللاحقة تؤكد العنوان النهائي.

## نتائج المهمة

```ts
type DeviceTransferFinalDecision =
  | 'transferred_successfully'
  | 'reschedule'
  | 'customer_refused_transfer';
```

### تم النقل

عند `transferred_successfully`:

- تأكيد الزبون مطلوب.
- عند النقل إلى زبون آخر، تأكيد الزبون الجديد مطلوب أيضاً.
- الجهاز يصبح `delivered`.
- يتم تحديث العنوان المبدئي على الجهاز كي يكون جاهزاً لمسار التركيب.

إذا كان النقل لنفس الزبون:

- لا يتغير `device_possession_log`.
- لا تتغير الملكية.

إذا كان النقل إلى زبون آخر:

- يتم تحديث `installed_devices.customer_id` إلى الزبون الجديد.
- يغلق سجل الحيازة المفتوح للجهاز.
- يفتح سجل حيازة جديد:
  - `holder_type = customer`
  - `holder_id = targetClientId`
  - `reason = transfer`
- يسجل جدول نتيجة النقل `ownership_transferred = true`.
- الزبون الجديد يصبح OP حسب ظهور الجهاز لديه.

إلغاء علاقة الزبون القديم بالجهاز يعبر عنه بسجل الحيازة المغلق ونتيجة النقل، وليس بإلغاء الزبون نفسه.

### إعادة الجدولة

عند `reschedule`:

- سبب إعادة الجدولة مطلوب من:
  - `device_transfer_reschedule_reasons`
- تاريخ الموعد الجديد مطلوب.
- لا يتغير الجهاز ولا سجل الحيازة.

### رفض النقل

عند `customer_refused_transfer`:

- سبب الرفض مطلوب من:
  - `device_transfer_refusal_reasons`
- لا يتغير الجهاز ولا سجل الحيازة.

## جدول النتيجة

`visit_task_device_transfer_results`

الحقول الأساسية:

- `visit_task_result_id`
- `final_decision`
- `transfer_kind`
- `from_client_id`
- `to_client_id`
- `ownership_transferred`
- `planned_geo_unit_id`
- `planned_address_text`
- `planned_lat`
- `planned_lng`
- `refusal_reason_id`
- `reschedule_reason_id`
- `rescheduled_at`
- `customer_acknowledged`
- `target_customer_acknowledged`
- `technical_notes`

## قوائم النظام

- `device_transfer_refusal_reasons`: أسباب رفض نقل الجهاز.
- `device_transfer_reschedule_reasons`: أسباب إعادة جدولة نقل الجهاز.

## قرارات مثبتة

- النقل ليس تركيباً ولا تشغيلاً.
- النقل ليس سحباً إلى الشركة.
- النقل إلى زبون آخر لا ينشئ جهازاً جديداً.
- العقد لا علاقة له بملكية الجهاز في هذا المسار.
- سجل الحيازة يتغير فقط عند `another_customer`.
- العنوان النهائي لا يعتمد من النقل، بل من مهمة التركيب.
