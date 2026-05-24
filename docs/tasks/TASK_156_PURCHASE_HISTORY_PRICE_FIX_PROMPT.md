# TASK: إصلاح التكرار بسعر الجهاز — عرض السعر الصحيح + معلومات الحسم

## المشكلة

1. **سعر الجهاز = `contracts.final_price`** — هاد الإجمالي كامل للعقد (جهاز + قطع + اكسسوارات)
2. **القطع = `contract_line_items.total_price`** — سعر القطعة لحالها
3. **النتيجة:** التوتال = `final_price` (800+2) + `line_items` (2) = 804 بدل 802

## السبب الجذري

`contracts.final_price` = سعر الجهاز + القطع + اكسسوارات + خدمات (الإجمالي المدفوع).
`contract_line_items.total_price` = إجمالي كل line item.

لو جمعناهم = تكرار!

## الحل

### للأجهزة (Source 1):
- **سعر الجهاز** = `contracts.base_price` (سعر الجهاز وحده، بدون قطع)
- **نضيف** `discountInfo` يوضح الحسم المطبق

### للقطع/الاكسسوارات (Source 2):
- **السعر** = `contract_line_items.total_price` (سعر القطعة لحالها)
- **ما نضيف** `discountInfo` (لأن الحسم عادةً على الجهاز فقط)

---

## التعديلات المطلوبة

### 1. `packages/api/routes/customerCalls.ts` — Source 1 (الجهاز)

**النص الحالي (~سطر 443):**
```sql
c.base_price                       AS unit_price,
c.final_price                      AS total_price,
```

**النص الجديد:**
```sql
c.base_price                       AS unit_price,
c.base_price                       AS total_price,  -- << سعر الجهاز وحده، مش إجمالي العقد
```

**وإضافة حقل الحسم:**
```sql
CASE
  WHEN c.discount_id IS NOT NULL OR c.base_price > c.final_price
    THEN jsonb_build_object(
      'originalPrice', c.base_price,
      'discountAmount', c.base_price - c.final_price,
      'finalContractPrice', c.final_price,
      'discountSource', COALESCE(dd.label, 'حسم من العقد')
    )
  ELSE NULL
END                               AS discount_info,
```

**ملاحظة:** `dd.label` من `device_discounts` (إذا فيه `discount_id`). لو ما فيه، نستخدم `'حسم تلقائي'`.

**التعديل الكامل لـ Source 1:**
```sql
-- Source 1: Device from contract (UPDATED)
SELECT
  'contract_device_' || c.id::text  AS id,
  c.customer_id,
  c.branch_id,
  c.contract_date::text              AS purchase_date,
  'contract'                         AS source_type,
  c.id::text                         AS source_id,
  'عقد #' || COALESCE(c.contract_number, c.id::text) AS source_label,
  'device'                           AS item_type,
  c.device_model_id                  AS item_id,
  c.device_model_name                AS item_name,
  NULL::varchar                      AS item_code,
  1                                  AS quantity,
  c.base_price                       AS unit_price,
  c.base_price                       AS total_price,  -- سعر الجهاز وحده
  'SYP'                              AS currency,
  c.payment_type,
  TRUE                               AS is_installed,
  NULL::boolean                      AS old_part_removed,
  CASE
    WHEN c.is_golden_warranty AND c.golden_warranty_end_date IS NOT NULL
      THEN 'golden_warranty'
    ELSE 'contract_warranty'
  END                               AS warranty_context,
  CASE
    WHEN c.is_golden_warranty AND c.golden_warranty_end_date IS NOT NULL
      THEN c.golden_warranty_end_date
    ELSE c.contract_warranty_end_date
  END                               AS warranty_until,
  c.id                              AS device_context_id,
  c.device_model_name               AS device_context_name,
  -- حسم الجهاز:
  CASE
    WHEN c.base_price > c.final_price
      THEN jsonb_build_object(
        'originalPrice', c.base_price,
        'discountAmount', c.base_price - c.final_price,
        'finalContractPrice', c.final_price
      )
    ELSE NULL
  END                               AS discount_info,
  NULL::text                        AS notes
FROM contracts c
WHERE c.customer_id = $1
  AND c.device_model_id IS NOT NULL
```

### 2. `packages/web/src/pages/ClientProfile.tsx` — عرض الحسم

**التعديل على البطاقة (~سطر 1452):**

```jsx
{/* السعر */}
<div className="text-right">
    <div className="text-sm font-black text-slate-800">
        {r.totalPrice > 0
            ? r.totalPrice.toLocaleString('ar-SY') + ' ل.س'
            : r.warrantyContext ? 'مجاني' : '—'}
    </div>
    {/* عرض الحسم إذا موجود */}
    {r.discountInfo && (
        <div className="text-[10px] text-emerald-600 mt-0.5">
            <span className="line-through text-slate-400 mr-1">
                {r.discountInfo.originalPrice.toLocaleString('ar-SY')} ل.س
            </span>
            <span className="font-medium">
                حسم: {r.discountInfo.discountAmount.toLocaleString('ar-SY')} ل.س
            </span>
        </div>
    )}
    {r.purchaseDate && (
        <div className="text-xs text-slate-400 mt-0.5">{r.purchaseDate}</div>
    )}
</div>
```

### 3. الـ Summary

**النص الحالي (~سطر 615):**
```javascript
const totalSpent = records.reduce((sum, r) => sum + r.totalPrice, 0);
```

**المطلوب:** نحسب التوتال بشكل صحيح — لكل عقد: `device.base_price + sum(line_items.total_price)`.

**بس** — هاد صعب بالـ reduce لأنه بيعتمد على تجميع حسب `source_id`.

**اقتراح أبسط:** نحسب `totalSpent` من الـ backend query مباشرة:
```sql
-- بـ backend: نجيب totaPrice فعلي لكل عقد
SELECT 
  c.id,
  c.base_price + COALESCE(SUM(cli.total_price), 0) AS contract_total
FROM contracts c
LEFT JOIN contract_line_items cli ON cli.contract_id = c.id AND cli.item_type = 'accessory'
WHERE c.customer_id = $1
GROUP BY c.id, c.base_price
```

**أو** — نترك الـ `totalSpent` بـ frontend بس نضيف `discountInfo` لكل عقد:
```javascript
const totalSpent = records.reduce((sum, r) => {
  // إذا عقد (source_type = 'contract') والجهاز = نجمع base_price + line_items
  // إذا صيانة = نجمع totalPrice عادي
  return sum + r.totalPrice;
}, 0);
```

**أبسط حل بدون تعديل backend كبير:**
```javascript
// نجمع uniq contracts فقط (الجهاز + line items)
const contractIds = new Set();
const contractTotals = new Map();

records.forEach(r => {
  if (r.sourceType === 'contract') {
    if (!contractTotals.has(r.sourceId)) {
      contractTotals.set(r.sourceId, { devicePrice: 0, itemsPrice: 0 });
    }
    const curr = contractTotals.get(r.sourceId);
    if (r.itemType === 'device') {
      curr.devicePrice = r.totalPrice; // base_price
    } else {
      curr.itemsPrice += r.totalPrice;
    }
  }
});

const totalSpent = Array.from(contractTotals.values()).reduce(
  (sum, c) => sum + c.devicePrice + c.itemsPrice, 0
) + records.filter(r => r.sourceType !== 'contract').reduce((sum, r) => sum + r.totalPrice, 0);
```

→ هاد كتير معقد للـ frontend.

**القرار:** نعدّل الـ backend ليرجّع `contract_total` لكل عقد، أو نترك `totalSpent` حالياً ونصلحو بـ batch لاحقاً.

**أبسط إصلاح فوري:**
```javascript
// بدل ما نجمع كل الـ totalPrice، نجمع فقط الـ device و line items منفصل
const totalSpent = records.reduce((sum, r) => {
  // لو جهاز = ناخد base_price (totalPrice الحالي)
  // لو line item = ناخد totalPrice
  // لو emergency = ناخد totalPrice
  return sum + (r.totalPrice || 0);
}, 0);
```

→ هاد ما رح يصلح التكرار لأنه `totalPrice` للجهاز بس = base_price (بدون line items)، والـ line items = totalPrice.
**هاد صح!** لأنه:
- `device.totalPrice` = `base_price` = 800,000
- `accessory.totalPrice` = 2,000
- المجموع = 802,000 ✅

يعني: **التعديل الوحيد المطلوب = تغيير `final_price` لـ `base_price` بـ Source 1.**

---

## Deliverables النهائية

### Backend (`customerCalls.ts`):
- [ ] Source 1: `total_price` = `base_price` (بدل `final_price`)
- [ ] Source 1: إضافة `discount_info` JSONB (originalPrice, discountAmount, finalContractPrice)

### Frontend (`ClientProfile.tsx`):
- [ ] عرض `discountInfo` تحت السعر (السعر الأصلي مشطوب + قيمة الحسم)
- [ ] الـ `totalSpent` بيصير صحيح تلقائياً (base_price + line_items)

### Test:
- [ ] /customers/21/purchase-history
- [ ] الجهاز = 800,000 (base_price)
- [ ] القطعة = 2,000
- [ ] الإجمالي = 802,000
- [ ] عرض الحسم إذا موجود
