# TASK: بناء السجل التاريخي للمشتريات (Customer Purchase History)

## الهدف

view/API موحّد بيجمع كل مشتريات الزبون (أجهزة + قطع) من كل المصادر، وبيعرضها بشكل مرتب.

## شروط العميل

1. **القطع من الصيانة الطارئة** = تُحسب "شراء" ✅
2. **معلومة سحب القطعة القديمة مهمة جداً** — لو لم يتم التركيب → لم يتم السحب
3. **الأجهزة فقط** = شراء (بدون حالات lifecycle)
4. **السعر** = السعر وقت الشراء (snapshot)
5. **الخدمات** = غير محسوبة ❌

---

## مصادر البيانات

| المصدر | الجدول | نوع الشي |
|--------|--------|----------|
| عقد البيع | `contracts` + `contract_line_items` | جهاز + قطع + ملحقات |
| صيانة طارئة | `visit_task_emergency_parts_used` | قطع استُبدلت |
| صيانة دورية (مستقبلي) | `visit_task_periodic_parts_used` | قطع صيانة |

---

## هيكل الريكورد (Purchase History Record)

كل ريكورد = عملية شراء/استبدال وحدة:

```sql
CREATE VIEW customer_purchase_history AS
-- Fields:
-- id                    BIGSERIAL   -- معرف فريد للريكورد
-- customer_id           INTEGER     -- رقم الزبون
-- branch_id             INTEGER     -- الفرع
-- purchase_date         DATE        -- تاريخ الشراء/الاستبدال
-- source_type           VARCHAR(50) -- 'contract' | 'emergency_maintenance' | 'periodic_maintenance'
-- source_id             VARCHAR(100)-- رقم المصدر (contract_id أو visit_task_id)
-- item_type             VARCHAR(50) -- 'device' | 'part' | 'accessory'
-- item_id               INTEGER     -- device_model_id أو spare_part_id
-- item_name             VARCHAR(255)-- اسم الموديل/القطعة (snapshot)
-- item_code             VARCHAR(100)-- رمز القطعة (للقطع)
-- quantity              INTEGER     -- الكمية
-- unit_price            NUMERIC     -- السعر للوحدة (snapshot)
-- total_price           NUMERIC     -- الإجمالي
-- currency              VARCHAR(10) -- العملة (SYP)
-- payment_type          VARCHAR(50) -- 'cash' | 'installment' | 'warranty' | 'maintenance_paid'
-- is_installed          BOOLEAN     -- هل مركّب؟ (للقطع)
-- old_part_removed      BOOLEAN     -- هل سُحبت القطعة القديمة؟ (للقطع بس)
-- warranty_until        DATE        -- نهاية الكفالة (للأجهزة)
-- device_context_id     INTEGER     -- لأي جهاز؟ (contract_id التابع للقطعة)
-- notes                 TEXT        -- ملاحظات
```

---

## تفاصيل كل مصدر

### 1. من العقود (`contract_line_items`)

```sql
-- Join: contract_line_items → contracts (للتاريخ والزبون والجهاز)
-- device من contracts.device_model_id
-- parts/accessories من contract_line_items يلي item_type = 'accessory'
```

| الحقل | من وين |
|-------|--------|
| purchase_date | `contracts.contract_date` |
| source_type | `'contract'` |
| source_id | `contracts.id` |
| item_type | `'device'` (لو device_model_id) أو `'accessory'` |
| item_name | `contracts.device_model_name` أو `contract_line_items.description` |
| unit_price | `contracts.base_price` أو `contract_line_items.unit_price` |
| payment_type | `contracts.payment_type` |
| is_installed | `contract_line_items.is_installed` (للقطع) |
| old_part_removed | `NULL` (مش relevant للعقود) |
| warranty_until | حسب خطة الكفالة (device_status = active → +1 سنة مثلاً) |
| device_context_id | `contracts.id` نفسه (الجهاز = السياق) |

### 2. من الصيانة الطارئة (`visit_task_emergency_parts_used`)

```sql
-- Join: visit_task_emergency_parts_used → visit_tasks → visit_task_results → field_visits
-- للوصول لـ client_id و contract_id
```

| الحقل | من وين |
|-------|--------|
| purchase_date | `field_visits.scheduled_date` أو `visit_task_results.closed_at` |
| source_type | `'emergency_maintenance'` |
| source_id | `visit_tasks.id` |
| item_type | `'part'` |
| item_name | `visit_task_emergency_parts_used.part_name_snapshot` |
| item_code | `spare_parts.code` (من spare_part_id) |
| quantity | `visit_task_emergency_parts_used.quantity` |
| unit_price | `visit_task_emergency_parts_used.unit_price` |
| payment_type | من `visit_task_emergency_financials.payment_method` (لو موجود) وإلا `'maintenance_paid'` |
| is_installed | `TRUE` (لأن القطع بالجدول = استُخدمت) |
| old_part_removed | **❓ هذا الحقل مش موجود حالياً** — لازم يضاف لـ `visit_task_emergency_parts_used` أو نستنتجه |
| device_context_id | `visit_tasks.contract_id` (الجديد) |

**ملاحظة على `old_part_removed`:**
- لو القطعة الجديدة ما رُكّبت → `old_part_removed = FALSE`
- لو رُكّبت → `old_part_removed = TRUE`
- **الحقل مش موجود حالياً بالـ DB** — لازم نضيفه أو نستنتجه من `visit_task_results.final_decision`

---

## API المطلوب

### `GET /api/customers/:id/purchase-history`

```json
{
  "customerId": 1523,
  "records": [
    {
      "id": "ch_1",
      "purchaseDate": "2026-05-15",
      "sourceType": "contract",
      "sourceId": "448",
      "sourceLabel": "عقد #448",
      "itemType": "device",
      "itemName": "RO 7 مراحل",
      "quantity": 1,
      "unitPrice": 1250000,
      "totalPrice": 1250000,
      "currency": "SYP",
      "paymentType": "installment",
      "isInstalled": true,
      "oldPartRemoved": null,
      "warrantyUntil": "2027-05-15",
      "deviceContext": { "contractId": 448, "deviceModelName": "RO 7 مراحل" }
    },
    {
      "id": "ch_2",
      "purchaseDate": "2026-05-15",
      "sourceType": "contract",
      "sourceId": "448",
      "sourceLabel": "عقد #448",
      "itemType": "accessory",
      "itemName": "فلتر كربون",
      "quantity": 2,
      "unitPrice": 45000,
      "totalPrice": 90000,
      "currency": "SYP",
      "paymentType": "cash",
      "isInstalled": true,
      "oldPartRemoved": null,
      "warrantyUntil": null,
      "deviceContext": { "contractId": 448, "deviceModelName": "RO 7 مراحل" }
    },
    {
      "id": "ch_3",
      "purchaseDate": "2026-08-20",
      "sourceType": "emergency_maintenance",
      "sourceId": "892",
      "sourceLabel": "صيانة طارئة #892",
      "itemType": "part",
      "itemName": "مضخة طوارئ",
      "itemCode": "PMP-001",
      "quantity": 1,
      "unitPrice": 350000,
      "totalPrice": 350000,
      "currency": "SYP",
      "paymentType": "maintenance_paid",
      "isInstalled": true,
      "oldPartRemoved": true,
      "warrantyUntil": null,
      "deviceContext": { "contractId": 448, "deviceModelName": "RO 7 مراحل" }
    }
  ]
}
```

---

## ملاحظات تنفيذية

1. **View vs API endpoint:** اقتراحي = نبني API endpoint مش materialized view، لأن البيانات بتتغيّر (مثلاً `is_installed` بيتحدّث)
2. **Performance:** الـ endpoint يعمل `UNION ALL` بين:
   - `contracts` + `contract_line_items`
   - `visit_task_emergency_parts_used` (مع joins)
   - وترتيب حسب `purchase_date DESC`
3. **device_context:** لكل قطعة (accessory/part) لازم نعرف لأي جهاز تابع — من `contract_id`
4. **old_part_removed:** لازم نضيف `old_part_removed BOOLEAN DEFAULT FALSE` لـ `visit_task_emergency_parts_used` (أو نستنتجه من حالة المهمة)

---

## Deliverables

- [ ] Migration: `visit_task_emergency_parts_used` يضيف `old_part_removed BOOLEAN DEFAULT FALSE`
- [ ] API endpoint: `GET /customers/:id/purchase-history`
- [ ] Frontend tab: "السجل التاريخي" ضمن ClientProfile
- [ ] Test: verify emergency maintenance parts appear with correct old_part_removed flag
