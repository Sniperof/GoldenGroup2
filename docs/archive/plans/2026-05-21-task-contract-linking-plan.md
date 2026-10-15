# خطة: ربط مهمة عرض الجهاز بعقود متعددة

> تاريخ الإنشاء: 2026-05-21
> الحالة: مرحلة التخطيط
> السياق: مهمة واحدة قد تُفضي لبيع أكثر من جهاز → كل جهاز مباع = رقم بيعة + عقد مستقل

---

## 1. المشكلة الحالية

| الجدول | الحقل | القيد الحالي | المشكلة |
|--------|-------|-------------|---------|
| `marketing_visit_tasks` | `contract_id` | Scalar FK | مهمة ↔ عقد واحد فقط |
| `marketing_visit_tasks` | `sale_reference_number` | UNIQUE على المهمة | رقم بيعة واحد للمهمة كلها |
| `open_tasks` | `contract_id` | Scalar FK | نفس المشكلة |
| `contracts` | `source_visit` | `VARCHAR(255)` — نص فقط | لا FK حقيقي لمصدر البيع |
| `contracts` | `sale_source` | `CHECK IN (...)` | يعرف النوع لكن لا يعرف أي عرض بالذات |
| `marketing_visit_task_offers` | — | لا `contract_id` | العرض نفسه لا يرتبط بعقده |

**السيناريو الغير مدعوم:**
```
مهمة عرض جهاز
  ├── عرض جهاز A (كاش 1,000,000)    → قبول → رقم بيعة 00001 → عقد #101
  └── عرض جهاز B (تقسيط 800,000)   → قبول → رقم بيعة 00002 → عقد #102
```

---

## 2. المبدأ المعماري المقترح

**العلاقة الصحيحة هي: عرض ↔ عقد**

```
open_tasks  ←──  marketing_visit_tasks  ←──  marketing_visit_task_offers ──→  contracts
   (مهمة)          (مهمة الزيارة)               (عرض مُقدَّم / مقبول)          (العقد)
```

- المهمة **تعرف** عقودها بالاستعلام: `SELECT c.id FROM contracts c JOIN marketing_visit_task_offers o ON o.contract_id = c.id WHERE o.task_id = $taskId`
- العقد **يعرف** مصدره: `source_task_offer_id → marketing_visit_task_offers`
- `sale_reference_number` ينتقل من مستوى المهمة إلى **مستوى العرض المقبول**

---

## 3. التغييرات المطلوبة

### 3.1 Migrations

**Migration A — إضافة `contract_id` لجدول العروض**
```sql
ALTER TABLE marketing_visit_task_offers
  ADD COLUMN IF NOT EXISTS contract_id INTEGER
    REFERENCES contracts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_mvto_contract
  ON marketing_visit_task_offers(contract_id)
  WHERE contract_id IS NOT NULL;
```

**Migration B — ربط العقد بمصدره (العرض + المهمة)**
```sql
ALTER TABLE contracts
  ADD COLUMN IF NOT EXISTS source_open_task_id    INTEGER REFERENCES open_tasks(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_task_offer_id   BIGINT  REFERENCES marketing_visit_task_offers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sale_reference_number  VARCHAR(5);

-- ربط رقم البيعة بالعقد مباشرةً
CREATE INDEX IF NOT EXISTS idx_contracts_sale_ref ON contracts(sale_reference_number)
  WHERE sale_reference_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contracts_source_task ON contracts(source_open_task_id)
  WHERE source_open_task_id IS NOT NULL;
```

**Migration C — رقم البيعة على مستوى العرض**
> `marketing_visit_task_offers.sale_reference_number` موجود بالفعل (migration 089).
> يحتاج فقط تحديث logic التوليد (انظر §3.2).

**Deprecation — الحقول القديمة (لا تُحذف فوراً)**
```sql
-- marketing_visit_tasks.contract_id     ← يبقى مؤقتاً للاستعلامات القديمة
-- marketing_visit_tasks.sale_reference_number ← يبقى = أول رقم بيعة للمهمة (للـ legacy)
-- open_tasks.contract_id                ← يبقى = أول عقد للمهمة (للـ legacy)
```

---

### 3.2 Backend — `applyTaskOutcome()` في `marketingVisits.ts`

**تغيير توليد رقم البيعة:**

```
حالياً:
  outcome = 'device_sold'  → saleReferenceNumber واحد للمهمة كلها

مطلوب:
  لكل عرض بـ customerResponse = 'accepted'  → saleReferenceNumber مستقل
  outcome = 'device_sold' (قبول مباشر بدون offers)  → saleReferenceNumber واحد كما الآن
```

**لوجيك تعبئة `contract_id` على العرض:**

```typescript
// بعد إنشاء العقد من مكان آخر:
// UPDATE marketing_visit_task_offers
//   SET contract_id = $contractId, sale_reference_number = $saleRef
//  WHERE id = $offerId

// أو عند ربط العقد يدوياً:
// الـ API: PATCH /marketing-visits/:visitId/tasks/:taskId/offers/:offerId/contract
```

**استعلام "عقود المهمة"** (بدل `task.contractId` الـ Scalar):
```sql
SELECT c.id, c.contract_number, mvto.sale_reference_number, mvto.device_model_id
FROM marketing_visit_task_offers mvto
JOIN contracts c ON c.id = mvto.contract_id
WHERE mvto.task_id = $taskId
  AND mvto.contract_id IS NOT NULL;
```

---

### 3.3 Frontend

**شاشة نتيجة المهمة (DeviceDemoResultRenderer):**
- بدل: "رقم العقد: #101"
- الجديد: قائمة عقود مرتبطة بكل عرض مقبول

**نموذج إنشاء العقد (ContractForm):**
- إضافة حقل `sourceOpenTaskId` + `sourceTaskOfferId` + `saleReferenceNumber` كـ hidden fields تُعبَّأ من سياق المهمة
- زر "إنشاء عقد" ينتقل مباشرة للنموذج مع تعبئة مسبقة من بيانات العرض المقبول

---

## 4. مراحل التطبيق

```
المرحلة 1 (Schema) — تُطبَّق أولاً، مستقلة وغير كاسرة:
  Migration A: contract_id على marketing_visit_task_offers
  Migration B: source_open_task_id + source_task_offer_id + sale_reference_number على contracts

المرحلة 2 (API ربط العقد بالعرض):
  PATCH /marketing-visits/:visitId/tasks/:taskId/offers/:offerId/contract
  Body: { contractId, saleReferenceNumber }
  → يُحدِّث marketing_visit_task_offers.contract_id
  → يُحدِّث contracts.source_task_offer_id + source_open_task_id + sale_reference_number

المرحلة 3 (توليد رقم البيعة متعدد):
  تعديل applyTaskOutcome: لكل عرض accepted → saleReferenceNumber مستقل
  تحديث marketing_visit_tasks.sale_reference_number = أول رقم للـ legacy

المرحلة 4 (Frontend):
  تحديث DeviceDemoResultRenderer لعرض قائمة العقود
  تحديث ContractForm لقبول source_task_offer_id
  إضافة زر "إنشاء عقد" من نافذة نتيجة المهمة
```

---

## 5. القرارات المعتمدة (2026-05-21)

| # | السؤال | القرار المعتمد |
|---|--------|----------------|
| P1 | متى يُنشأ العقد؟ | **يدوياً** — الموظف أو المشرف ينشئه بعد النتيجة. **يمكن من داخل الزيارة** مباشرةً |
| P2 | من يُنشئ العقد؟ | **الموظف الميداني والمشرف كلاهما** |
| P3 | رقم البيعة | يُولَّد عند تسجيل النتيجة لكل عرض مقبول، يُربط بالعقد عند إنشائه |
| P4 | `marketing_visit_tasks.contract_id` | يبقى كـ legacy = أول عقد — لا يُحذف حالياً |

---

## 6. الحالة

| المرحلة | الحالة |
|---------|--------|
| 1 — Schema | ⬜ لم تبدأ |
| 2 — API ربط | ⬜ لم تبدأ |
| 3 — توليد متعدد | ⬜ لم تبدأ |
| 4 — Frontend | ⬜ لم تبدأ |
