# PROMPT: توحيد مصدر الوسطاء — referrers JSONB كمصدر وحيد

> **الهدف:** جعل `clients.referrers` (JSONB) هو **المصدر الوحيد** للوسطاء. الوسيط الأساسي = أول عنصر بالمصفوفة.
> **القاعدة:** لا hardcoded values. Western numerals فقط.

---

## 📁 الملفات المطلوبة التعديل

1. `migrations/184_unify_referrers.sql` — migration جديد
2. `packages/api/routes/contracts.ts` — API endpoint
3. `packages/web/src/pages/contracts/ContractDetail.tsx` — صفحة تفاصيل العقد

---

## الخطوة 1: Migration — `migrations/184_unify_referrers.sql`

```sql
-- Migration 184: populate referrers JSONB from legacy referrer_name/referrer_id/referrer_type
-- Rule: if referrers is NULL or empty array, and legacy fields have real data, populate it.

UPDATE clients
SET referrers = jsonb_build_array(
  jsonb_build_object(
    'id', referrer_id,
    'name', referrer_name,
    'type', COALESCE(
      CASE referrer_type
        WHEN 'Employee' THEN 'employee'
        WHEN 'Client' THEN 'client'
        WHEN 'Personal' THEN 'personal'
        WHEN 'Customer' THEN 'customer'
        ELSE 'unknown'
      END,
      'unknown'
    )
  )
)
WHERE (referrers IS NULL OR referrers = '[]'::jsonb)
  AND referrer_name IS NOT NULL
  AND referrer_name != ''
  AND referrer_name != 'مجهول'
  AND referrer_name != 'Unknown';

-- Add index for fast referrer lookups (optional but recommended)
CREATE INDEX IF NOT EXISTS idx_clients_referrers ON clients USING gin(referrers);
```

---

## الخطوة 2: API — `packages/api/routes/contracts.ts`

### أ) تعديل Client Query (سطر ~334-346)

أضف `referrers` للـ SELECT — **وأحذف** `referrer_name` / `referrer_id` / `referrer_type` من الـ response:

```sql
SELECT id, name, mobile, contacts, neighborhood, district, governorate,
       detailed_address AS "detailedAddress", rating, national_id AS "nationalId",
       occupation, spouse_occupation AS "spouseOccupation",
       data_quality AS "dataQuality", gender, father_name AS "fatherName",
       birth_date AS "birthDate", mother_name AS "motherName",
       national_id_registry AS "nationalIdRegistry",
       national_id_issued_by AS "nationalIdIssuedBy",
       national_id_issue_date AS "nationalIdIssueDate",
       national_id_box AS "nationalIdBox",
       nickname, first_name AS "firstName", last_name AS "lastName",
       referrers
  FROM clients WHERE id = $1
```

### ب) تعديل الـ Response (سطر ~426-441)

حافظ على `referrersCount` computed:

```js
  res.json({
    ...contract,
    installationGeoPath,
    ownershipDisplay,
    dues: dues.map(mapDue),
    tasks,
    client: client ? {
      ...client,
      geoPath: clientGeoPath,
      referrersCount: Array.isArray(client.referrers) ? client.referrers.length : 0,
    } : null,
    lineItems: lineItemResult.rows,
    paymentEntries: paymentEntriesResult.rows,
    installments: installmentsResult.rows,
    discount: discountResult.rows[0] ?? null,
  });
```

> **ملاحظة:** لا ترجّع `referrerName` / `referrerId` / `referrerType` منفصلة — فقط `referrers` + `referrersCount`.

---

## الخطوة 3: Frontend — `packages/web/src/pages/contracts/ContractDetail.tsx`

### أ) حذف أي reference لـ `referrer_name` أو `referrerName`

### ب) إضافة قسم الوسيط الأساسي (Primary Referrer)

بالـ Group 2 (هوية المشتري)، أضف بعد الجزء د (الملكية):

```tsx
{/* الجزء هـ: الوسيط الأساسي */}
{data.client?.referrersCount > 0 && data.client.referrers?.[0] && (
  <>
    <Divider />
    <div>
      <div className="text-xs font-bold text-slate-500 mb-2 uppercase tracking-wide">🤝 الوسيط</div>
      <div className="flex items-center gap-2 text-sm">
        <span className="text-slate-700 font-medium">{data.client.referrers[0].name}</span>
        {data.client.referrers[0].type && (
          <span className="text-xs text-slate-400">
            ({data.client.referrers[0].type === 'client' ? 'زبون'
              : data.client.referrers[0].type === 'employee' ? 'موظف'
              : data.client.referrers[0].type === 'personal' ? 'شخصي'
              : data.client.referrers[0].type === 'customer' ? 'عميل'
              : data.client.referrers[0].type})
          </span>
        )}
      </div>
      {/* إذا فيه أكتر من وسيط — عدد فقط بدون لستة */}
      {data.client.referrersCount > 1 && (
        <div className="text-xs text-slate-500 mt-1">
          +{data.client.referrersCount - 1} وسيط آخر
        </div>
      )}
    </div>
  </>
)}
```

### ج) إذا `referrersCount = 0` — لا شيء

لا تعرض "لا يوجد وسطاء" ولا أي placeholder. ببساطة: لا يظهر القسم.

---

## 🧪 اختبار التنفيذ

بعد التنفيذ، افتح صفحة تفاصيل عقد الزبون "عماد الحجي" (ID 23):

**المتوقع:**
- ✅ يظهر قسم "الوسيط"
- ✅ الاسم: "سعيد العمراني"
- ✅ النوع: "زبون" (أو القيمة المُحوّلة من referrer_type)
- ✅ لا يظهر `referrer_name` القديم

**التحقق من DB:**
```sql
SELECT id, name, referrers FROM clients WHERE id = 23;
-- Expected: [{"id": 18, "name": "سعيد العمراني", "type": "client"}]
```

---

## ⚠️ قواعد التنفيذ

- **لا تعدل على production** — staging أولاً
- **Western numerals فقط**
- **لا hardcoded values**
- **تأكد من `git commit` قبل التنفيذ**
- **شغّل الـ migration** بـ `pnpm run migrate` أو يدوياً بـ `psql`
- **أعد تشغيل السيرفر** بعد التعديلات

---

## 📋 ملخّص التغييرات

| # | الملف | التعديل |
|---|-------|---------|
| 1 | `migrations/184_unify_referrers.sql` | Migration جديد — تعبئة `referrers` JSONB |
| 2 | `packages/api/routes/contracts.ts` | تعديل client query + response |
| 3 | `packages/web/src/pages/contracts/ContractDetail.tsx` | إضافة قسم الوسيط الأساسي |
