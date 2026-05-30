# Resolved Decisions

## الهدف

هذا الملف هو مرجع موحّد للقرارات المحسومة في مسار توثيق العقود.
كل قرار هنا اعتُمد عبر حوار مباشر مع صاحب المنتج، ويجب أن تعكسه الملفات المرجعية الأخرى (`01d`, `02`, `02b`, `03`, `04a`, ...) والباك لوج التنفيذي (`07`).

> أي تعارض بين هذا الملف وملف مرجعي آخر يُحسم بإحالة هذا الملف إلى الحوار المرجعي، ثم تصحيح الملف الآخر.

---

## DEC-CT-01: حالات العقد الموحدة

**الحالات المعتمدة:**

| الحالة | المعنى | الانتقال |
|---|---|---|
| `draft` | عقد منشأ بدون `closing_employee_id` بعد | تلقائي عند الإنشاء |
| `active` | عقد معتمد بتعيين `closing_employee_id` | عند تعبئة موظف الإغلاق |
| `completed` | جميع الأقساط مستوفاة (إغلاق مالي) | تلقائي عند سداد آخر قسط |
| `cancelled` | كان `active` ثم أُلغي صراحةً | إجراء صريح |
| `discarded` | كان `draft` ورُفض / أُسقط دون تفعيل | إجراء صريح على المسودة |

**ملاحظات:**

- `temporary` **ليست حالة عقد بعد اليوم**. تنتقل إلى `sale_type` / `sale_subtype` كنوع عقد.
- `archived` (في صياغة الدستور القديم) كان مضلِّلاً. الاسم الدلالي الصحيح هو `discarded` = "مسودة مرفوضة".
- `completed` لا يعني انتهاء الكفالة. الكفالة قد تبقى سارية بعد `completed`.

---

## DEC-CT-02: فصل عقد الصيانة عن العقود

- `maintenance_contract` كنوع داخل `contracts` يُلغى.
- يُبنى كيان مستقل `service_agreements` للجهاز الخارجي.
- migration يُحوّل كل العقود ذات `contractType = 'maintenance_contract'` إلى `service_agreements`.
- بعد الفصل، `contracts` تتعامل فقط مع بيع/هدية/مؤقت.

---

## DEC-CT-03: قاموس حالات الجهاز

**المعتمد:**

```
registered → pending_delivery → delivered → installed → active
                                                         ↓
                                  faulty / in_workshop / ready / out_of_service / retrieved
```

**migration للحالات القديمة:**

| القديم | الجديد |
|---|---|
| `under_maintenance` | `in_workshop` |
| `disconnected` | `out_of_service` |

**إضافات جديدة:** `registered`, `in_workshop`, `ready`.

---

## DEC-CT-04: تفعيل كفالة العقد

- **الحدث المُفعِّل:** نتيجة "مهمة تشغيل الجهاز" (الانتقال إلى `device.active`).
- **التخزين المزدوج:**
  - `installed_devices.activated_at` — الأصل التشغيلي (يتغير لو صُحّح).
  - `device_warranties.activated_at` — snapshot يثبت حساب `end_date` ولا يتغير.
- `end_date` يُحسب من `device_warranties.activated_at` لا من `contract_date`.
- `contract_date` يبقى مرجعاً قانونياً للحقّ، لا لبداية السريان.

---

## DEC-CT-05: نموذج حالة الكفالة

**الكفالة تنتقل إلى enum حالة بدل `is_active`:**

| الحالة | المعنى |
|---|---|
| `pending` | الكفالة منشأة قانونياً لكن لم تُفعّل (الجهاز لم يُشغّل بعد) |
| `active` | الجهاز تم تشغيله، السريان قائم |
| `cancelled` | أُلغيت قبل انتهائها الطبيعي |
| `expired` | بلغت `end_date` |

**حقول إضافية:**

- `cancellation_reason` enum: `contract_cancelled`, `device_retrieved`, `manual`
- `cancelled_at`, `cancelled_by`

**قواعد التلقائية:**

- عند `contract.cancelled` + الجهاز `active` + ذمم غير مستوفاة → الكفالة `cancelled` بسبب `contract_cancelled`.
- عند `device.retrieved` → الكفالة `cancelled` حكماً بسبب `device_retrieved`.

---

## DEC-CT-06: إلغاء `dues` ككيان

- `dues` كجدول مستقل **يُلغى**.
- الرصيد المتبقي يُحسب على `contract_installments`: `remaining_balance = amount - SUM(payments.allocated)`.
- كل واجهة كانت تعرض "الذمم" تتحول إلى استعلام على `contract_installments` ذات `remaining_balance > 0`.

---

## DEC-CT-07: سجل التحصيل عبر المهام

- لا كيان `collection_attempts` جديد.
- محاولات التحصيل تُسجَّل عبر `tasks` بنوع `task_type = collection` مرتبطة بـ `installment_id`.
- نتيجة المهمة (نجاح/فشل/وعد) + الدفعة المنبثقة (إن وُجدت) هي السجل التشغيلي.

---

## DEC-CT-08: تمثيل دفعة الإرتجاع

- في `contract_payment_entries` يُضاف `entry_type = 'refund'`.
- المبلغ يُمثَّل سالباً (أو موجباً مع `direction` صريح — التنفيذ يحسم).
- يربط بسبب الإرتجاع وبالعقد الذي أُلغي.

---

## DEC-CT-09: سجل الحيازة

**جدول جديد `device_possession_log`:**

| الحقل | النوع | الملاحظات |
|---|---|---|
| `device_id` | FK | إلى `installed_devices` |
| `holder_type` | enum | `warehouse / technician / customer / workshop / supplier` |
| `holder_id` | FK | حسب النوع |
| `start_at` | timestamp | بداية الحيازة |
| `end_at` | timestamp NULL | ينغلق عند التحويل التالي |
| `reason` | enum | `sale_delivery / repair_pickup / temporary_swap / retrieval / cancellation / transfer` |

- الصف المفتوح (`end_at IS NULL`) هو الحائز الحالي.
- التحويلات تُغلق الصف القديم وتفتح صفاً جديداً (transactional).

---

## DEC-CT-10: كشف حساب الزبون

- **لا** يُبنى `financial_ledger` موحَّد (لا double-entry).
- `contract_installments` + `contract_payment_entries` يبقيان الأصل.
- يُبنى `customer_statement` كـ view / endpoint مشتقّ يدمج الحركات للعرض فقط.

---

## DEC-CT-11: صاحب البيعة

- يُضاف `contracts.sale_owner_id` كحقل مستقل عن `closing_employee_id`.
- يمثّل من أتى بالصفقة (عروض / بحث) بشكل منفصل عن من أتمها قانونياً.

---

## DEC-CT-12: مالك التحصيل

- يُضاف `contract_installments.collection_owner_id`.
- على مستوى القسط لا العقد، ليسمح بتوزيع التحصيل بين موظفين عبر أقساط مختلفة.

---

## DEC-CT-13: snapshot فريق العرض

- يُضاف `contracts.offer_team_snapshot` (JSON) يُجمَّد لحظة إنشاء العقد.
- يحتوي الأعضاء والأدوار، فلا يتأثر بتغييرات HR اللاحقة.

---

## DEC-CT-14: العقد القابل للطباعة

- **القوالب:** في الكود (`packages/api/templates/contracts/`), versioned.
- **النسخ المولَّدة:** جدول `contract_documents` يخزن المُخرج النهائي + `hash` + `template_version` + `frozen_at`.
- **توليد PDF:** عند الطلب أول مرة، ثم يُستعاد المخزَّن.

---

## DEC-CT-15: لحظة تجميد النسخة القانونية

- النسخة الرسمية تُجمَّد **لحظة الانتقال من `draft` إلى `active`** (عند تعيين `closing_employee_id`).
- أي تعديل لاحق يُسجَّل كـ `amendment` بنسخة جديدة في `contract_documents` بـ hash مختلف.
- إذا طُلب PDF لمسودة (`draft`)، يجب أن يظهر صراحةً "مسودة غير معتمدة" دون تجميد.

---

## مرجعية

- نقاش جامع: جلسة مقابلة صاحب المنتج (21 سؤالاً)
- ملف الفجوات السابق: [`06-gaps-and-questions.md`](./06-gaps-and-questions.md)
- ملف الجرد التنفيذي: [`06a-current-implementation-audit.md`](./06a-current-implementation-audit.md)
- باك لوج التنفيذ: [`07-task-backlog.md`](./07-task-backlog.md)
