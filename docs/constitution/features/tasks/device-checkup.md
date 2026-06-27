# مهمة تشييك الجهاز — `device_checkup`

## التعريف

`device_checkup` هي مهمة خدمة خفيفة هدفها تسجيل الحالة الفنية الحالية للجهاز عند الزبون.

لا تشمل المهمة:

- بيع أو عرض.
- تركيب أو تشغيل.
- فك أو سحب أو نقل.
- تبديل حيازة أو تغيير ملكية.
- تغيير حالة الجهاز آليا.

## شروط الإنشاء

يسمح بإنشاء المهمة فقط عندما:

- يوجد `installedDeviceId`.
- الجهاز موجود عند الزبون بحالة:
  - `delivered`
  - `installed`
  - `active`
- لا توجد مهمة تشييك نشطة لنفس الجهاز.
- يوجد تاريخ للمهمة.

## مودل الإنشاء

```ts
interface CreateDeviceCheckupTask {
  taskType: 'device_checkup';
  clientId: number;
  installedDeviceId: number;
  dueDate: string;
  priority?: 'high' | 'medium' | 'low';
  notes?: string | null;
}
```

## نتائج المهمة

```ts
type DeviceCheckupFinalDecision =
  | 'checked_successfully'
  | 'reschedule'
  | 'customer_refused_checkup';
```

### تم التشييك

```ts
interface DeviceCheckupSuccessResult {
  final_decision: 'checked_successfully';
  technical_state: Record<string, unknown>;
  technical_notes?: string | null;
}
```

- `technical_state` مطلوب، ويجب أن يحتوي قراءة فنية واحدة على الأقل.
- يكتب صفا في `device_technical_states`.
- `task_type_snapshot = device_checkup`.
- `phase = diagnostic`.
- تغلق المهمة كـ `completed`.
- لا يغير `installed_devices.status`.
- لا يغير العنوان.
- لا يكتب في `device_possession_log`.

### إعادة جدولة

```ts
interface DeviceCheckupRescheduleResult {
  final_decision: 'reschedule';
  reschedule_reason_id: number;
  expected_date: string;
  expected_time?: string | null;
  technical_notes?: string | null;
}
```

- السبب من قائمة `device_checkup_reschedule_reasons`.
- تنقل المهمة المفتوحة إلى `needs_follow_up`.
- لا تنشئ قراءة فنية.

### رفض التشييك

```ts
interface DeviceCheckupRefusalResult {
  final_decision: 'customer_refused_checkup';
  refusal_reason_id: number;
  technical_notes?: string | null;
}
```

- السبب من قائمة `device_checkup_refusal_reasons`.
- تلغى المهمة المفتوحة كـ `cancelled`.
- لا تنشئ قراءة فنية.

## جدول النتيجة

`visit_task_device_checkup_results`

- `visit_task_result_id`
- `final_decision`
- `technical_state_id`
- `refusal_reason_id`
- `reschedule_reason_id`
- `rescheduled_at`
- `technical_notes`

## قرار مثبت

تشييك الجهاز يسجل الحالة الفنية فقط عند النجاح. إعادة الجدولة والرفض هما نتائج مهمة مستقلة ولا ينتجان قراءة فنية.
