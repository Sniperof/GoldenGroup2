# مهمة إرجاع الجهاز - `device_return`

> **الحالة:** Draft - توثيق دستوري تشغيلي  
> **المجموعة:** خدمات ما بعد البيع  
> **المسار:** بعد سحب الجهاز للصيانة فقط

---

## المعنى

`device_return` هي مهمة تسليم نفس الجهاز للزبون بعد خروجه للصيانة داخل فرع الخدمة أو الورشة.

هذه المهمة منفصلة عن:
- `device_delivery`: تسليم جهاز ضمن مسار البيع.
- `device_installation`: تركيب الجهاز.
- `device_activation`: تشغيل الجهاز.

قرار دستوري:

```text
device_retrieval / maintenance
        ↓
in_workshop
        ↓
device_return
        ↓
delivered
```

ولا يسمح بها بعد:

```text
device_retrieval / replacement
        ↓
retrieved
```

لأن الجهاز في هذا المسار مسترجع نهائياً ولا يعود للزبون.

---

## شروط الإنشاء

يسمح بإنشاء `device_return` فقط عندما:

- يوجد `installedDeviceId`.
- حالة الجهاز الحالية `in_workshop`.
- يوجد سحب ناجح سابق للجهاز من نوع `device_retrieval` وبغرض `maintenance`.
- لا توجد مهمة إرجاع مفتوحة لنفس الجهاز.
- الجهاز ما زال مرتبطاً بالزبون/العقد.

لا يختار المستخدم `serviceBranchId` عند الإنشاء:
- مصدر الجهاز هو فرعه الحالي وهو داخل الورشة.
- وجهة الإرجاع هي عنوان التركيب الذي كان عليه الجهاز قبل السحب للصيانة.

مودل الإنشاء:

```ts
interface CreateDeviceReturnTask {
  taskType: 'device_return';
  installedDeviceId: string;
  contractId?: string;
  dueDate: string;
  priority?: 'low' | 'medium' | 'high';
  notes?: string;
}
```

---

## لقطة عنوان ما قبل السحب

يجب أن يحفظ مسار السحب للصيانة لقطة من موقع الجهاز قبل نقله إلى الورشة:

- `pre_retrieval_branch_id`
- `pre_retrieval_geo_unit_id`
- `pre_retrieval_address_text`
- `pre_retrieval_lat`
- `pre_retrieval_lng`

وعند نجاح الإرجاع يستخدم النظام هذه اللقطة حصراً.

لا يعتمد الإرجاع على عنوان الزبون الحالي.

---

## النتائج

قيم `final_decision`:

```ts
type DeviceReturnFinalDecision =
  | 'returned_successfully'
  | 'reschedule'
  | 'customer_refused_return';
```

| القرار | المعنى | أثر الجهاز |
|---|---|---|
| `returned_successfully` | تم تسليم الجهاز للزبون بعد الصيانة | `delivered` |
| `reschedule` | لم يتم الإرجاع وتحتاج المهمة لموعد جديد | لا تغيير |
| `customer_refused_return` | رفض الزبون استلام الجهاز | لا تغيير |

حقول نتيجة النجاح:

```ts
{
  final_decision: 'returned_successfully',
  customer_acknowledged: true,
  technical_notes?: string
}
```

حقول إعادة الجدولة:

```ts
{
  final_decision: 'reschedule',
  reschedule_reason_id: number,
  expected_date: string,
  expected_time?: string,
  technical_notes?: string
}
```

حقول رفض الإرجاع:

```ts
{
  final_decision: 'customer_refused_return',
  refusal_reason_id: number,
  technical_notes?: string
}
```

---

## قوائم الأسباب

- `device_return_reschedule_reasons`: أسباب إعادة جدولة إرجاع الجهاز
- `device_return_refusal_reasons`: أسباب رفض إرجاع الجهاز

---

## الأثر عند النجاح

عند `returned_successfully`:

- تغلق مهمة الإرجاع بنجاح.
- تصبح حالة الجهاز `delivered`.
- يرجع موقع الجهاز إلى عنوان التركيب الذي كان عليه قبل السحب.
- لا تتغير الملكية.
- لا يسجل النظام أن الجهاز مركب أو مشغل.
- يمكن لاحقاً إنشاء مهمة تركيب أو تشغيل حسب المسار التشغيلي.
