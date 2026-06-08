# TASK: بناء السجل التاريخي للمشتريات (Customer Purchase History) — V2

## ملاحظة تحديث

هاد التحديث V2 بناءً على توضيحات المستخدم:
1. `item_type` بحدد نوع القطعة بدقة (دورية/طارئة/اكسسوار)
2. إضافة `warranty_context` — هل القطعة مشتراة ضمن كفالة العقد أو الكفالة الذهبية؟

---

## هيكل الريكورد (Purchase History Record)

```sql
-- id                    BIGSERIAL   -- معرف فريد للريكورد
-- customer_id           INTEGER     -- رقم الزبون
-- branch_id             INTEGER     -- الفرع
-- purchase_date         DATE        -- تاريخ الشراء/الاستبدال
-- source_type           VARCHAR(50) -- 'contract' | 'emergency_maintenance' | 'periodic_maintenance'
-- source_id             VARCHAR(100)-- رقم المصدر (contract_id أو visit_task_id)
-- source_label          VARCHAR(255)-- "عقد #448" أو "صيانة طارئة #892"

-- item_type             VARCHAR(50) -- النوع الدقيق:
                                      -- 'device' = جهاز
                                      -- 'periodic_part' = قطعة صيانة دورية
                                      -- 'emergency_part' = قطعة صيانة طارئة
                                      -- 'accessory' = اكسسوار/ملحق

-- item_id               INTEGER     -- device_model_id أو spare_part_id
-- item_name             VARCHAR(255)-- اسم الموديل/القطعة (snapshot)
-- item_code             VARCHAR(100)-- رمز القطعة (للقطع)

-- quantity              INTEGER     -- الكمية
-- unit_price            NUMERIC     -- السعر للوحدة (snapshot وقت الشراء)
-- total_price           NUMERIC     -- الإجمالي
-- currency              VARCHAR(10) -- العملة (SYP)

-- payment_type          VARCHAR(50) -- 'cash' | 'installment' | 'maintenance_paid' | 'warranty_free'

-- is_installed          BOOLEAN     -- هل مركّب؟ (للقطع)
-- old_part_removed      BOOLEAN     -- هل سُحبت القطعة القديمة؟ (للقطع بس)

-- warranty_context      VARCHAR(50) -- سياق الكفالة:
                                      -- 'contract_warranty' = ضمن كفالة العقد
                                      -- 'golden_warranty' = ضمن الكفالة الذهبية
                                      -- 'no_warranty' = بدون كفالة (زبون دفع كامل)
                                      -- NULL = مش relevant (للأجهزة بس)

-- warranty_until        DATE        -- نهاية الكفالة (للأجهزة والقطع المكفولة)
-- device_context_id     INTEGER     -- لأي جهاز تابع؟ (contract_id)
-- device_context_name   VARCHAR(255)-- اسم الجهاز التابع
-- notes                 TEXT        -- ملاحظات
```

---

## تفاصيل كل item_type

| item_type | الوصف | المصدر | أمثلة |
|-----------|-------|--------|-------|
| **device** | الجهاز الرئيسي | `contracts` | "RO 7 مراحل" |
| **periodic_part** | قطع الصيانة الدورية | `contract_line_items` (item_type='part' + maintenance_type='Periodic') أو `visit_task_periodic_parts_used` | "فلتر كربون"، " membran" |
| **emergency_part** | قطع الصيانة الطارئة | `visit_task_emergency_parts_used` | "مضخة طوارئ"، "sensor" |
| **accessory** | ملحقات/اكسسوارات | `contract_line_items` (item_type='accessory') | "طقم تركيب"، "خزان إضافي" |

---

## تفاصيل warranty_context

### كيف بنحدد الكفالة؟

**للأجهزة:**
- `warranty_context = 'contract_warranty'` — الجهاز تلقائياً بيكون ضمن كفالة العقد
- `warranty_context = 'golden_warranty'` — إذا العقد/الجهاز بيحمل كفالة ذهبية
- `warranty_until` = تاريخ انتهاء الكفالة

**للقطع:**
- القطع المشتراة مع الجهاز (عقد) → `contract_warranty`
- القطع المُستبدلة ضمن فترة الكفالة الذهبية → `golden_warranty`
- القطع المُستبدلة بعد انتهاء الكفالة → `no_warranty` (الزبون دفع)
- القطع المُستبدلة ضمن كفالة العقد العادية → `contract_warranty`

### القاعدة الحاسمة:

> **قطعة الصيانة (periodic أو emergency) = إذا تم شراؤها ضمن فترة الكفالة (عقد أو ذهبية) → warranty_context = الكفالة المطبقة**
> **إذا بعد انتهاء الكفالة → warranty_context = 'no_warranty'**

---

## أمثلة من الواقع

| التاريخ | item_type | item_name | warranty_context | total_price | ملاحظة |
|---------|-----------|-----------|------------------|-------------|--------|
| 2026/05/15 | device | RO 7 مراحل | contract_warranty | 1,250,000 | الجهاز تلقائياً بكفالة |
| 2026/05/15 | accessory | فلتر كربون | contract_warranty | 90,000 | مع الجهاز = ضمن كفالة |
| 2026/11/20 | emergency_part | مضخة طوارئ | golden_warranty | 0 | استبدال مجاني ضمن كفالة ذهبية |
| 2027/08/10 | periodic_part | membran | no_warranty | 200,000 | انتهت الكفالة، الزبون دفع |
| 2027/09/05 | emergency_part | sensor | golden_warranty | 50,000 | كفالة ذهبية سارية |

---

## المصادر بالتفصيل

### 1. من العقود (`contract_line_items`)

```sql
SELECT
  c.customer_id,
  c.branch_id,
  c.contract_date AS purchase_date,
  'contract' AS source_type,
  c.id AS source_id,
  -- item_type: 'device' للجهاز الرئيسي، 'accessory' للـ line_items
  CASE
    WHEN c.device_model_id IS NOT NULL THEN 'device'
    ELSE 'accessory'
  END AS item_type,
  c.device_model_id AS item_id,
  c.device_model_name AS item_name,
  1 AS quantity,
  c.base_price AS unit_price,
  c.final_price AS total_price,
  'SYP' AS currency,
  c.payment_type,
  TRUE AS is_installed,  -- الجهاز تلقائياً مركّب
  NULL AS old_part_removed,  -- مش relevant
  -- warranty:
  CASE
    WHEN c.device_status = 'active' AND c.maintenance_plan IS NOT NULL
      THEN 'contract_warranty'
    WHEN c.is_golden_warranty = TRUE  -- إذا موجود هالحقل
      THEN 'golden_warranty'
    ELSE 'contract_warranty'
  END AS warranty_context,
  -- warranty_until: حسب نوع الكفالة
  CASE
    WHEN c.is_golden_warranty THEN c.golden_warranty_end_date
    ELSE c.contract_warranty_end_date
  END AS warranty_until,
  c.id AS device_context_id,
  c.device_model_name AS device_context_name
FROM contracts c
WHERE c.status = 'active'

UNION ALL

SELECT
  c.customer_id,
  c.branch_id,
  c.contract_date AS purchase_date,
  'contract' AS source_type,
  c.id AS source_id,
  'accessory' AS item_type,  -- أو 'periodic_part' حسب spare_part.maintenance_type
  cli.spare_part_id AS item_id,
  cli.description AS item_name,
  cli.quantity,
  cli.unit_price,
  cli.total_price,
  'SYP' AS currency,
  c.payment_type,
  cli.is_installed,
  NULL AS old_part_removed,
  -- القطع مع العقد = ضمن كفالة العقد
  'contract_warranty' AS warranty_context,
  c.contract_warranty_end_date AS warranty_until,
  c.id AS device_context_id,
  c.device_model_name AS device_context_name
FROM contract_line_items cli
JOIN contracts c ON c.id = cli.contract_id
WHERE cli.item_type IN ('accessory', 'part')
```

### 2. من الصيانة الطارئة (`visit_task_emergency_parts_used`)

```sql
SELECT
  fv.client_id AS customer_id,
  fv.branch_id,
  COALESCE(fv.scheduled_date, DATE(vtr.closed_at)) AS purchase_date,
  'emergency_maintenance' AS source_type,
  vt.id AS source_id,
  'emergency_part' AS item_type,
  vtepu.spare_part_id AS item_id,
  vtepu.part_name_snapshot AS item_name,
  sp.code AS item_code,
  vtepu.quantity,
  vtepu.unit_price,
  (vtepu.quantity * COALESCE(vtepu.unit_price, 0)) AS total_price,
  'SYP' AS currency,
  COALESCE(vtef.payment_method, 'maintenance_paid') AS payment_type,
  TRUE AS is_installed,  -- القطع بـ emergency_parts_used = استُخدمت
  vtepu.old_part_removed,
  -- تحديد الكفالة:
  CASE
    -- إذا تاريخ الصيانة ضمن فترة الكفالة الذهبية
    WHEN c.is_golden_warranty = TRUE
      AND fv.scheduled_date <= c.golden_warranty_end_date
      THEN 'golden_warranty'
    -- إذا ضمن فترة كفالة العقد العادية
    WHEN fv.scheduled_date <= c.contract_warranty_end_date
      THEN 'contract_warranty'
    ELSE 'no_warranty'
  END AS warranty_context,
  CASE
    WHEN c.is_golden_warranty = TRUE
      AND fv.scheduled_date <= c.golden_warranty_end_date
      THEN c.golden_warranty_end_date
    WHEN fv.scheduled_date <= c.contract_warranty_end_date
      THEN c.contract_warranty_end_date
    ELSE NULL
  END AS warranty_until,
  c.id AS device_context_id,
  c.device_model_name AS device_context_name
FROM visit_task_emergency_parts_used vtepu
JOIN visit_tasks vt ON vt.id = vtepu.visit_task_id
JOIN field_visits fv ON fv.id = vt.field_visit_id
LEFT JOIN visit_task_results vtr ON vtr.visit_task_id = vt.id
LEFT JOIN visit_task_emergency_financials vtef ON vtef.visit_task_id = vt.id
LEFT JOIN spare_parts sp ON sp.id = vtepu.spare_part_id
LEFT JOIN contracts c ON c.id = vt.contract_id  -- FK جديد من Task 155
```

---

## التعديلات المطلوبة على DB

### 1. `visit_task_emergency_parts_used` — إضافة `old_part_removed`

```sql
ALTER TABLE visit_task_emergency_parts_used
  ADD COLUMN IF NOT EXISTS old_part_removed BOOLEAN DEFAULT FALSE;
```

### 2. `contracts` — إضافة حقول الكفالة (إذا مش موجودة)

```sql
-- التأكد من وجود حقول الكفالة
ALTER TABLE contracts
  ADD COLUMN IF NOT EXISTS is_golden_warranty BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS golden_warranty_end_date DATE,
  ADD COLUMN IF NOT EXISTS contract_warranty_end_date DATE;
```

**ملاحظة:** `contract_warranty_end_date` ممكن نحسبه من `contract_date + maintenance_plan (أشهر)`.

---

## API Endpoint

### `GET /api/customers/:id/purchase-history`

```json
{
  "customerId": 1523,
  "summary": {
    "totalDevices": 2,
    "totalParts": 5,
    "totalAccessories": 3,
    "totalSpent": 1850000,
    "warrantySavings": 450000  -- قيمة القطع المجانية ضمن الكفالة
  },
  "records": [
    {
      "id": "ch_1",
      "purchaseDate": "2026-05-15",
      "sourceType": "contract",
      "sourceId": "448",
      "sourceLabel": "عقد #448",
      "itemType": "device",
      "itemTypeLabel": "جهاز",
      "itemName": "RO 7 مراحل",
      "quantity": 1,
      "unitPrice": 1250000,
      "totalPrice": 1250000,
      "currency": "SYP",
      "paymentType": "installment",
      "paymentTypeLabel": "تقسيط",
      "isInstalled": true,
      "oldPartRemoved": null,
      "warrantyContext": "contract_warranty",
      "warrantyContextLabel": "كفالة العقد",
      "warrantyUntil": "2027-05-15",
      "deviceContext": {
        "contractId": 448,
        "deviceModelName": "RO 7 مراحل"
      }
    },
    {
      "id": "ch_5",
      "purchaseDate": "2026-11-20",
      "sourceType": "emergency_maintenance",
      "sourceId": "892",
      "sourceLabel": "صيانة طارئة #892",
      "itemType": "emergency_part",
      "itemTypeLabel": "قطعة طوارئ",
      "itemName": "مضخة طوارئ",
      "itemCode": "PMP-001",
      "quantity": 1,
      "unitPrice": 350000,
      "totalPrice": 0,
      "currency": "SYP",
      "paymentType": "warranty_free",
      "paymentTypeLabel": "مجاني (كفالة)",
      "isInstalled": true,
      "oldPartRemoved": true,
      "warrantyContext": "golden_warranty",
      "warrantyContextLabel": "كفالة ذهبية",
      "warrantyUntil": "2028-05-15",
      "deviceContext": {
        "contractId": 448,
        "deviceModelName": "RO 7 مراحل"
      },
      "notes": "استبدال مجاني ضمن الكفالة الذهبية"
    }
  ]
}
```

---

## Deliverables

- [ ] Migration: `visit_task_emergency_parts_used` يضيف `old_part_removed`
- [ ] Migration: `contracts` يضيف `is_golden_warranty`, `golden_warranty_end_date`, `contract_warranty_end_date` (إذا مش موجودين)
- [ ] API endpoint: `GET /customers/:id/purchase-history`
- [ ] Frontend tab: "السجل التاريخي" ضمن ClientProfile
- [ ] Test: verify warranty context calculation for emergency parts
