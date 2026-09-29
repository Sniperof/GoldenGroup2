# مهمة: اختيار فترات الكفالة — كفالة العقد والكفالة الذهبية

> **الأولوية:** متوسطة
> **النوع:** تحسين بنيوي + واجهة مستخدم
> **يتطلب:** إصلاح بنية بيانات + تعديل ContractForm + تعديل نتيجة مهمة التسليم

---

## المشكلة الحالية

### كفالة العقد (`contract_warranty_end_date`)
- الحقل موجود بـ DB لكن لا يوجد حقل اختيار فترة في ContractForm
- التاريخ لا يُحسب تلقائياً — يبقى فارغاً دائماً

### الكفالة الذهبية (`golden_warranty_end_date`)
- الفترات مخزونة على `device_models.golden_warranty_periods` كنص حر: `["12 شهرًا"]`
- النص لا يمكن احتسابه رياضياً على تاريخ اكتمال المهمة
- لا يوجد واجهة لاختيار الفترة عند اكتمال مهمة التسليم

### المنطق الحالي في `customerCalls.ts`
- نظام إما/أو — الذهبية تلغي كفالة العقد كلياً:
  ```sql
  WHEN c.is_golden_warranty = TRUE THEN 'golden_warranty'
  ELSE 'contract_warranty'
  ```

---

## الإصلاح المطلوب — خطوات

### الخطوة 1: إصلاح بنية `golden_warranty_periods` في `device_models`

**Migration جديد:**
```sql
-- تحويل القيم النصية إلى objects قابلة للحساب
-- المطلوب تنفيذه يدوياً بعد مراجعة البيانات الحالية
-- البنية الجديدة: [{ "months": 12, "label": "12 شهرًا" }]
```

**API — `deviceModels.ts`:**
- تعديل `normalizeDevicePayload()` لقبول الشكل الجديد
- الـ UI يعرض `label`، الحساب يستخدم `months`

### الخطوة 2: إضافة اختيار فترة كفالة العقد في `ContractForm`

```tsx
// بعد حقل تاريخ العقد — في قسم تفاصيل البيع
<select> // فترة كفالة العقد
  <option value="">بدون كفالة</option>
  <option value="6">6 أشهر</option>
  <option value="12">12 شهرًا</option>
  <option value="24">24 شهرًا</option>
  <option value="36">36 شهرًا</option>
</select>

// حساب تلقائي:
// contract_warranty_end_date = contract_date + selectedMonths
```

**API — `contracts.ts`:**
- قبول `warrantyPeriodMonths` من الـ payload
- حساب `contract_warranty_end_date = contract_date + warrantyPeriodMonths months`
- حفظه بـ DB

### الخطوة 3: اختيار فترة الكفالة الذهبية عند اكتمال مهمة التسليم

- في نتيجة مهمة التسليم الذهبي: عرض `device_models.golden_warranty_periods` كـ dropdown
- عند الاختيار: حساب `golden_warranty_end_date = task_completion_date + selectedMonths`
- كتابة `is_golden_warranty = true` و `golden_warranty_end_date` على العقد

---

## الملفات المتأثرة

| الملف | التعديل |
|-------|---------|
| `migrations/186_fix_golden_warranty_periods.sql` | تحويل بنية JSONB |
| `packages/api/routes/deviceModels.ts` | normalizeDevicePayload |
| `packages/api/routes/contracts.ts` | حساب contract_warranty_end_date |
| `packages/web/src/pages/contracts/ContractForm.tsx` | dropdown فترة الكفالة |
| صفحة نتيجة مهمة التسليم الذهبي | dropdown فترة الكفالة الذهبية |

---

## ملاحظات

- كفالة العقد: مصدرها العقد، تُضبط عند الإنشاء
- الكفالة الذهبية: مصدرها إيصال مهمة التسليم، تُضبط عند اكتمال المهمة
- المنطق في `customerCalls.ts` يحتاج مراجعة: هل الذهبية تلغي العقد أم تُضاف فوقها؟
