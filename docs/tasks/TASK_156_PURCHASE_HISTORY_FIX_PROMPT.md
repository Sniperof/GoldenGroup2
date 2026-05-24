# TASK: إصلاح مشكلتين بسجل المشتريات

## المشكلة 1: الجهاز مكرّر (ظاهر مرتين)

### السبب:
`contract_line_items` query (Source 2) بيحتوي:
```sql
AND cli.item_type IN ('accessory', 'device')
```

بعدين الـ CASE بيحول أي `device` لـ `accessory` لأنه ما في `spare_part`:
```sql
CASE
  WHEN sp.maintenance_type = 'Periodic' THEN 'periodic_part'
  WHEN sp.maintenance_type = 'Emergency' THEN 'emergency_part'
  ELSE 'accessory'
END AS item_type,
```

### الحل:
```sql
-- Source 2: contract_line_items query
-- السطر 500:
AND cli.item_type = 'accessory'  -- << غيّر من IN ('accessory', 'device') لـ = 'accessory'
```

الجهاز الوحيد لازم يجي من Source 1 (`contracts` table) بس.

---

## المشكلة 2: source_label مش ظاهر (من اي عقد تم الشراء)

### السبب:
Source 1 (الجهاز):
```sql
'عقد #' || c.contract_number AS source_label,
```

لو `contract_number` = NULL → `source_label` = NULL.

### الحل:
نستخدم COALESCE — إذا `contract_number` فاضي، نستخدم `c.id`:
```sql
'عقد #' || COALESCE(c.contract_number, c.id::text) AS source_label,
```

نفس الشي لـ Source 2 (line items) وSource 3 (emergency).

---

## الملف: `packages/api/routes/customerCalls.ts`

### التعديل 1 — Source 2 (سطر ~500):
**النص الحالي:**
```sql
AND cli.item_type IN ('accessory', 'device')
```

**النص الجديد:**
```sql
AND cli.item_type = 'accessory'
```

### التعديل 2 — source_label لكل المصادر:

**Source 1 (سطر ~436):**
```sql
'عقد #' || COALESCE(c.contract_number, c.id::text) AS source_label,
```

**Source 2 (سطر ~476):**
```sql
'عقد #' || COALESCE(c.contract_number, c.id::text) AS source_label,
```

**Source 3 (سطر ~516):**
```sql
'صيانة طارئة #' || vt.id::text AS source_label,
```
→ هاد صح، بس نتأكد إنه بيظهر.

---

## Deliverables

- [ ] `customerCalls.ts` — Source 2: `item_type = 'accessory'` (بدل `IN ('accessory', 'device')`)
- [ ] `customerCalls.ts` — COALESCE لـ source_label بكل المصادر
- [ ] Build passed
- [ ] Test: /customers/21/purchase-history — جهاز واحد بس + source_label ظاهر
