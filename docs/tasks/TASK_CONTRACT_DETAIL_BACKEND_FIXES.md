# PROMPT: إصلاحات Backend — صفحة تفاصيل العقد

> **الهدف:** إصلاح 5 مشاكل بـ `packages/api/routes/contracts.ts` — البيانات ما بترجّع للـ Frontend.
> **القاعدة:** كل تعديل يكون مبني على schema الحقيقي. لا hardcoded values. Western numerals فقط.

---

## 📁 الملف المطلوب التعديل

```
packages/api/routes/contracts.ts
```

---

## 🔴 المشكلة 1: رقم الإيصال (`receiptNumber`) — ناقص بالـ SELECT

**الوضع الحالي:**
- العمود `receipt_number` موجود بـ `contracts` (migration 127)
- بس **ما مختار** بـ `contractSelect` (سطر 11-51)
- النتيجة: `data.receiptNumber` = `undefined` دائماً

**التعديل المطلوب:**
أضف هالسطر لـ `contractSelect` بـ `packages/api/routes/contracts.ts` (مع باقي الأعمدة):

```sql
  c.receipt_number AS "receiptNumber",
```

---

## 🔴 المشكلة 2: الرمز (`code`) — ناقص بالـ DB وبالـ SELECT

**الوضع الحالي:**
- العمود `code` **مش موجود** بجدول `contracts`
- migration ما لقيته بيضيفه

**التعديل المطلوب — خطوتين:**

### أ) Migration جديد: `migrations/128_contracts_add_code.sql`

```sql
-- Migration 128: add code field to contracts
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS code VARCHAR(100);
```

### ب) إضافة للـ `contractSelect` بـ `contracts.ts`:

```sql
  c.code AS "code",
```

---

## 🔴 المشكلة 3: الوسطاء (`referrers` / `referrersCount`) — غير موجودين بالـ API

**الوضع الحالي:**
- `clients.referrers` = `JSONB` موجود بـ DB (migration 004)
- Client query (سطر 332-345) **ما بيختار `referrers`**
- الـ Frontend بيدور على `data.client?.referrers` و `data.client?.referrersCount`
- النتيجة: الوسطاء ما بيظهروا أبداً

**التعديل المطلوب — خطوتين:**

### أ) تعديل Client Query بـ `contracts.ts` (سطر 332-345):

أضف `referrers` للـ SELECT:

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
         referrers AS "referrers",
         classification
    FROM clients WHERE id = $1
```

### ب) تعديل الـ Response (سطر 423-435):

أضف computed field لـ `referrersCount`:

```js
  res.json({
    ...contract,
    installationGeoPath,
    clientGeoPath,
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

> **ملاحظة:** `referrers` من DB هو `JSONB` = array. `referrersCount` computed من طولو.

---

## 🔴 المشكلة 4: التصنيف (`classification`) — غير موجود بالـ API

**الوضع الحالي:**
- `clients.classification` = `VARCHAR(50)` موجود بـ DB
- Client query **ما بيختارو**
- الـ Frontend بيدور على `data.client?.classification`
- النتيجة: badge التصنيف ما بيظهر (LEAD/OP/FOP)

**التعديل المطلوب:**

أضف `classification` للـ client query (تم إضافته أعلاه مع `referrers`).

بس إذا بتحب تعملو separate:

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
         referrers AS "referrers",
         classification
    FROM clients WHERE id = $1
```

---

## 🔴 المشكلة 5: `client.geoPath` — غلط بالـ nesting

**الوضع الحالي:**
- الـ API بيحسب `clientGeoPath` وبيرجّعو بـ **root** (سطر 426)
- الـ Frontend بيدور على `data.client?.geoPath` (جوا الـ client object)
- النتيجة: العنوان المختصر (`addressShort`) ما بيظهر بالـ MiniSnapshot

**التعديل المطلوب:**

غيّر الـ response (سطر 423-435) لتحط `geoPath` جوا الـ `client` object:

```js
  res.json({
    ...contract,
    installationGeoPath,
    // clientGeoPath removed from root — moved inside client
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

> **ملاحظة:** ما تنساش تحذف `clientGeoPath` من root الـ response إذا كان موجود.

---

## 🧪 فحص بعد التنفيذ

**افتح صفحة تفاصيل عقد بالمتصفح وتحقق:**

1. ✅ رقم الإيصال (`receiptNumber`) بيظهر بالملخص المالي
2. ✅ حقل "الرمز" (`code`) بيظهر بالجهاز والصيانة
3. ✅ الوسطاء بيظهروا تحت هوية المشتري (إذا فيه referrers بالـ DB)
4. ✅ badge التصنيف (LEAD/OP/FOP) بيظهر جنب الاسم
5. ✅ العنوان الكامل بيظهر (عن طريق `client.geoPath`)

---

## ⚠️ قواعد التنفيذ

- **لا تعدل على production** — testing على staging أولاً
- **Western numerals فقط**
- **لا hardcoded values**
- **لا تعديل على Frontend** — كل التعديلات هون backend فقط
- **تأكد من `git commit` قبل التنفيذ**
