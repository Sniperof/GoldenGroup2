# TASK 165 — نظام اللقطات (Snapshot) للزبون والعقد + العناوين

> **الحالة:** جديد  
> **النطاق:** backend API + migration  
> **الهدف:** الزيارة والمهمة يصير عندهمون "لقطة" من بيانات الزبون والعقد وقت الإنشاء، وما يتغيروا لاحقاً إذا تعدّل ملف الزبون أو العقد. **العنوان = جزء أساسي من اللقطة.**

---

## ١) المشكلة

حالياً الكود بيقرأ بيانات الزبون والعقد **live** من الجداول الأصلية كل مرة بفتح تفاصيل الزيارة:

- الزبون غيّر رقمه بعد شهر → الزيارة القديمة بتطلع الرقم الجديد ❌
- العقد تعدل بعد فترة → المهمة القديمة بتطلع بيانات العقد الجديدة ❌
- العنوان الزبوني تغيّر → كل زيارات القديمة بتطلع العنوان الجديد ❌

هاي بتخرب التاريخية والتوثيق.

---

## ٢) الحقول الموجودة بالـ DB (ما بتحتاج migration)

| الجدول | الحقل | النوع | الحالة |
|--------|-------|-------|--------|
| `field_visits` | `customer_snapshot` | JSONB | موجود ✅ بس فاضي |
| `visit_tasks` | `contract_snapshot` | JSONB | موجود ✅ بس فاضي |

---

## ٣) هيكل `customer_snapshot` JSONB (محدّث)

```json
{
  "name": "الاسم الكامل",
  "firstName": "...",
  "fatherName": "...",
  "lastName": "...",
  "nickname": "...",
  "mobile": "...",
  "contacts": [
    { "number": "...", "type": "mobile|landline", "label": "...", "isActive": true, "supportsWhatsapp": false, "isPrimary": true }
  ],
  "address": {
    "governorate": { "id": 1, "name": "دمشق" },
    "district": { "id": 2, "name": "..." },
    "subDistrict": { "id": 3, "name": "..." },
    "neighborhood": { "id": 4, "name": "..." },
    "detailedAddress": "...",
    "gps": { "lat": 33.5, "lng": 36.3 }
  },
  "branch": { "id": 2, "name": "فرع دمشق" },
  "waterSource": "...",
  "occupation": "...",
  "spouseOccupation": "...",
  "rating": "ملتزم",
  "referrers": [
    { "type": "...", "method": "...", "name": "...", "notes": "..." }
  ]
}
```

> **هيكل الـ address:** ٤ مستويات كاملين من `geo_units` — كل مستوى عنده `id` + `name`. هاد بيضمن لو تغيّر اسم أي وحدة بالمستقبل، اللقطة بتضل محتفظة بالاسم الأصلي.

### آلية بناء الـ address بالـ backend:

```sql
-- بالاستعلام لبناء snapshot
WITH address_chain AS (
  SELECT
    gu4.id AS neighborhood_id,
    gu4.name AS neighborhood_name,
    gu3.id AS sub_district_id,
    gu3.name AS sub_district_name,
    gu2.id AS district_id,
    gu2.name AS district_name,
    gu1.id AS governorate_id,
    gu1.name AS governorate_name
  FROM geo_units gu4
  LEFT JOIN geo_units gu3 ON gu3.id = gu4.parent_id
  LEFT JOIN geo_units gu2 ON gu2.id = gu3.parent_id
  LEFT JOIN geo_units gu1 ON gu1.id = gu2.parent_id
  WHERE gu4.id = NULLIF(c.neighborhood, '')::int
)
```

> **القاعدة:** `neighborhood` بـ `clients` بيشير لـ `geo_units.id` (level 3 أو 4). إذا level 4 (حي) → نجيب الـ parent (ناحية) كـ `subDistrict`. إذا level 3 (ناحية) → `subDistrict` = نفسه، `neighborhood` = null.

---

## ٤) هيكل `contract_snapshot` JSONB (محدّث)

```json
{
  "contractId": 123,
  "contractNumber": "C-2026-001",
  "contractDate": "2026-05-20",
  "device": {
    "modelId": 5,
    "modelName": "...",
    "serialNumber": "...",
    "maintenancePlan": "..."
  },
  "installationAddress": {
    "geoUnit": { "id": 10, "name": "..." },
    "hierarchy": [
      { "level": 1, "name": "محافظة دمشق" },
      { "level": 2, "name": "..." },
      { "level": 3, "name": "..." },
      { "level": 4, "name": "..." }
    ],
    "addressText": "...",
    "gps": { "lat": 33.5, "lng": 36.3 }
  },
  "financials": {
    "paymentType": "cash|installment",
    "finalPrice": 500000,
    "downPayment": 100000,
    "installmentsCount": 6,
    "currency": "SYP"
  },
  "status": "active"
}
```

> **هيكل الـ installationAddress:** `geoUnit` = الوحدة المباشرة المختارة بالعقد. `hierarchy` = التسلسل الكامل (محافظة → منطقة → ناحية → حي) لأن العنوان العقدي **لازم يبين كامل** بغض النظر عن المستوى.

### آلية بناء الـ installationAddress بالـ backend:

```sql
-- بالاستعلام لبناء snapshot
WITH contract_geo AS (
  SELECT
    c.installation_geo_unit_id AS geo_unit_id,
    gu.name AS geo_unit_name,
    gu.level AS geo_unit_level
  FROM contracts c
  LEFT JOIN geo_units gu ON gu.id = c.installation_geo_unit_id
  WHERE c.id = $contractId
)
-- بعدها نسلك فوق عبر parent_id لحتى نجيب الـ ٤ مستويات
```

---

## ٥) العنوان بالزيارة — ٣ كيانات منفصلة

### ٥.١ عنوان الزبون (بقسم بيانات الزبون)

**المصدر:** `field_visits.customer_snapshot.address`

**العرض بالـ UI (`ClientInfoCard`):**

```
المحافظة: [name]
المنطقة:  [name]
الناحية:  [name]  ← subDistrict
الحي:     [name]  ← neighborhood (null إذا ما في)
العنوان التفصيلي: [text]
الموقع:   [رابط خريطة]
```

> **IDs مخفية.** الـ frontend ما بيعرض IDs — بس الأسماء. الـ IDs محفوظة بالـ JSONB للـ backend.

### ٥.٢ عنوان العقد (بقسم مهام الزيارة — لكل مهمة)

**المصدر:** `visit_tasks.contract_snapshot.installationAddress`

**العرض بالـ UI (بجانب كل مهمة):**

```
العنوان: [hierarchy كامل] — [addressText]
الموقع: [رابط خريطة]
```

### ٥.٣ محطة نطاق العمل (بقسم معلومات الموعد)

**المصدر:** حسب المهام المرتبطة

**القاعدة:**

| نوع المهمة | `location_basis` | المحطة = |
|-----------|-----------------|----------|
| `device_demo` | `client` | عنوان الزبون |
| `device_checkup` | `client` | عنوان الزبون |
| `gift_delivery` | `client` | عنوان الزبون |
| `device_delivery` | `contract` | عنوان العقد |
| `device_installation` | `contract` | عنوان العقد |
| `device_activation` | `contract` | عنوان العقد |
| `emergency_maintenance` | `contract` | عنوان العقد |
| `periodic_maintenance` | `contract` | عنوان العقد |
| وغيرهن (contract) | `contract` | عنوان العقد |

**منطق الحساب بالـ API:**

```
IF فيه مهمة واحدة على الأقل location_basis = 'contract' AND عندها contract_snapshot.installationAddress:
  → المحطة = عنوان العقد (من أول مهمة contract)
ELSE:
  → المحطة = عنوان الزبون (من customer_snapshot.address)
```

> **المحطة لازم تُحسب من snapshot** — لا من `clients` أو `contracts` live.

**العرض بالـ UI:**

```
المحافظة: [name]
المنطقة:  [name]
الناحية:  [name]
الحي:     [name]
العنوان التفصيلي: [text]
```

> ملاحظة: المحطة **مش كيان مستقل** — هو العنوان الزبوني أو العقدي حسب المهام. ما في حاجة لجدول منفصل أو snapshot منفصل.

---

## ٦) الملفات اللي لازم تتعدّل

### ٦.١ `packages/api/lib/snapshots.ts` — ملف جديد

٣ دوال مساعدة:

**أ) `buildCustomerSnapshot(pool, clientId, branchId?)`**
- بتعمل SELECT من `clients` + `geo_units` (للأسماء + الـ hierarchy) + `branches` (لاسم الفرع)
- بترجع الـ JSONB structure اللي فوق (مع address ككائن منفصل + branch ككائن منفصل)
- بتحل `neighborhood` (level 3 أو 4) وبتبني الـ hierarchy كامل
- `branchId` اختياري — إذا مررناه بنجيب اسم الفرع من `branches` ونضيفه للـ snapshot
- إذا `clientId` غير موجود → ترجع `null`

**ب) `buildContractSnapshot(pool, contractId)`**
- بتعمل SELECT من `contracts` + `geo_units` (للـ hierarchy)
- بترجع الـ JSONB structure اللي فوق (مع installationAddress + hierarchy)
- بتسلك فوق عبر `parent_id` من `installation_geo_unit_id` لحتى تبني الـ ٤ مستويات
- إذا `contractId` غير موجود → ترجع `null`

**ج) `getGeoUnitHierarchy(pool, geoUnitId)`**
- دالة مساعدة داخلية
- بتاخد `geo_unit_id` وبتسلك فوق عبر `parent_id`
- بترجع array: `[{level, id, name}, ...]` من الأسفل للأعلى
- بترجع `null` إذا الـ ID غير موجود

### ٦.٢ `packages/api/routes/telemarketing.ts`

خطوة حجز الموعد من الـ workspace (التيليماركتر بيحجز):

**عند INSERT `field_visits`:**
- قبل الـ INSERT، نادي `buildCustomerSnapshot(pool, params.entityId, params.branchId)`
- ضيف العمود `customer_snapshot` للـ INSERT + VALUES

**عند INSERT `visit_tasks`:**
- إذا في `contractId` (من `open_tasks`):
  - نادي `buildContractSnapshot(pool, contractId)`
  - ضيف العمود `contract_snapshot` للـ INSERT + VALUES

### ٦.٣ `packages/api/routes/openTasks.ts`

٢ أماكن:

**أ) إنشاء زيارة طوارئ (السطر ~1524):**
- عند INSERT `field_visits` ضمن `closeEmergencyTask`:
  - نادي `buildCustomerSnapshot(db, taskRow.client_id, taskRow.branch_id)`
  - ضيف `customer_snapshot` للـ INSERT

**ب) إنشاء مهمة طوارئ (السطر ~1548):**
- إذا في `contract_id`:
  - نادي `buildContractSnapshot(db, contractId)`
  - ضيف `contract_snapshot` للـ INSERT

### ٦.٤ `packages/api/routes/fieldVisits.ts` — GET /:id

**تعديل الـ response builder:**

**بيانات الزبون:**
- أول شي: إذا `fv.customer_snapshot` موجود (NOT NULL) → اعرض `customer_snapshot` مباشرة
- إذا فاضي → fallback على قراءة live من `clients` (المنطق الحالي)
- العنوان (`address` object) لازم يجي من `customer_snapshot.address` (إذا موجود)
- الفرع (`branchName`) لازم يجي من `customer_snapshot.branch.name` (إذا موجود)
- `visit.client_name` → من `customer_snapshot.name`
- `visit.first_name` → من `customer_snapshot.firstName`
- وهكذا لباقي الحقول

**بيانات العقد بالمهام:**
- أول شي: إذا `t.contract_snapshot` موجود (NOT NULL) → استخدمه مباشرة
- إذا فاضي → fallback على الـ `contractSnapshotMap` اللي بيبنيه runtime حالياً
- احذف أو علّق كود الـ `contractSnapshotMap` (البناء runtime) لأنه بطيء وغلط

**حساب المحطة (station):**
- لازم يتحسب من snapshot مش من live:

```typescript
let stationAddress = null;
const hasContractTask = tasks.some(t => t.location_basis === 'contract' && t.contract_snapshot?.installationAddress);
if (hasContractTask) {
  // خد عنوان أول مهمة contract
  const contractTask = tasks.find(t => t.location_basis === 'contract' && t.contract_snapshot?.installationAddress);
  stationAddress = contractTask.contract_snapshot.installationAddress;
} else if (fv.customer_snapshot?.address) {
  // خد عنوان الزبون
  stationAddress = fv.customer_snapshot.address;
}
// stationAddress.hierarchy = [{level, name}, ...]
// stationAddress.addressText = "..."
// stationAddress.gps = {lat, lng}
```

**الـ response address للـ ClientInfoCard:**
- `governorate` → `customer_snapshot.address.governorate.name`
- `district` → `customer_snapshot.address.district.name`
- `subDistrict` → `customer_snapshot.address.subDistrict?.name`
- `neighborhood` → `customer_snapshot.address.neighborhood?.name`
- `detailedAddress` → `customer_snapshot.address.detailedAddress`
- `gps` → `customer_snapshot.address.gps` (string format)

### ٦.٥ `packages/api/routes/openTasks.ts` — GET /:id (open task)

السطر 1065:
```typescript
// Override stale contract_snapshot with fresh live data from contracts table
```

**هاد التعليق والكود لازم يتعكس:**
- إذا `contract_snapshot` موجود → استخدمه (هو الصح)
- ما نعمل override بالـ live data
- لأن الـ open task ممكن يتحوّل لـ visit_task، والـ visit_task لازم ياخد الـ snapshot مش الـ live

---

## ٧) Migration — backfill existing data

### ٧.١ populate customer_snapshot (مع address hierarchy)

```sql
UPDATE field_visits fv
SET customer_snapshot = (
  SELECT jsonb_build_object(
    'name', c.name,
    'firstName', c.first_name,
    'fatherName', c.father_name,
    'lastName', c.last_name,
    'nickname', c.nickname,
    'mobile', c.mobile,
    'contacts', COALESCE(c.contacts, '[]'::jsonb),
    'address', (
      WITH addr_unit AS (
        SELECT
          gu4.id AS unit_id,
          gu4.name AS unit_name,
          gu4.level AS unit_level,
          gu3.id AS parent3_id, gu3.name AS parent3_name,
          gu2.id AS parent2_id, gu2.name AS parent2_name,
          gu1.id AS parent1_id, gu1.name AS parent1_name
        FROM geo_units gu4
        LEFT JOIN geo_units gu3 ON gu3.id = gu4.parent_id
        LEFT JOIN geo_units gu2 ON gu2.id = gu3.parent_id
        LEFT JOIN geo_units gu1 ON gu1.id = gu2.parent_id
        WHERE gu4.id = NULLIF(c.neighborhood, '')::int
      )
      SELECT jsonb_build_object(
        'governorate', jsonb_build_object('id', parent1_id, 'name', parent1_name),
        'district', jsonb_build_object('id', parent2_id, 'name', parent2_name),
        'subDistrict', CASE
          WHEN unit_level = 4 THEN jsonb_build_object('id', parent3_id, 'name', parent3_name)
          WHEN unit_level = 3 THEN jsonb_build_object('id', unit_id, 'name', unit_name)
          ELSE null
        END,
        'neighborhood', CASE
          WHEN unit_level = 4 THEN jsonb_build_object('id', unit_id, 'name', unit_name)
          ELSE null
        END,
        'detailedAddress', c.detailed_address,
        'gps', jsonb_build_object(
          'lat', (c.gps_coordinates->>'lat')::float,
          'lng', (c.gps_coordinates->>'lng')::float
        )
      )
      FROM addr_unit
    ),
    'branch', jsonb_build_object(
      'id', fv.branch_id,
      'name', b.name
    ),
    'waterSource', c.water_source,
    'occupation', c.occupation,
    'spouseOccupation', c.spouse_occupation,
    'rating', c.rating,
    'referrers', COALESCE(c.referrers, '[]'::jsonb)
  )
  FROM clients c
  WHERE c.id = fv.client_id
)
WHERE fv.customer_snapshot IS NULL;
```

### ٧.٢ populate contract_snapshot (مع installationAddress hierarchy)

```sql
UPDATE visit_tasks vt
SET contract_snapshot = (
  SELECT jsonb_build_object(
    'contractId', c.id,
    'contractNumber', c.contract_number,
    'contractDate', c.contract_date,
    'device', jsonb_build_object(
      'modelId', c.device_model_id,
      'modelName', c.device_model_name,
      'serialNumber', c.serial_number,
      'maintenancePlan', c.maintenance_plan
    ),
    'installationAddress', (
      WITH geo_chain AS (
        SELECT
          gu4.id AS unit_id,
          gu4.name AS unit_name,
          gu4.level AS unit_level,
          gu3.name AS l3_name,
          gu2.name AS l2_name,
          gu1.name AS l1_name
        FROM geo_units gu4
        LEFT JOIN geo_units gu3 ON gu3.id = gu4.parent_id
        LEFT JOIN geo_units gu2 ON gu2.id = gu3.parent_id
        LEFT JOIN geo_units gu1 ON gu1.id = gu2.parent_id
        WHERE gu4.id = c.installation_geo_unit_id
      )
      SELECT jsonb_build_object(
        'geoUnit', jsonb_build_object('id', unit_id, 'name', unit_name),
        'hierarchy', jsonb_build_array(
          jsonb_build_object('level', 1, 'name', l1_name),
          jsonb_build_object('level', 2, 'name', l2_name),
          jsonb_build_object('level', 3, 'name', l3_name),
          jsonb_build_object('level', 4, 'name', unit_name)
        ),
        'addressText', c.installation_address_text,
        'gps', jsonb_build_object(
          'lat', c.installation_lat,
          'lng', c.installation_lng
        )
      )
      FROM geo_chain
    ),
    'financials', jsonb_build_object(
      'paymentType', c.payment_type,
      'finalPrice', c.final_price,
      'downPayment', c.down_payment,
      'installmentsCount', c.installments_count,
      'currency', 'SYP'
    ),
    'status', c.status
  )
  FROM contracts c
  WHERE c.id = vt.contract_id
)
WHERE vt.contract_id IS NOT NULL AND vt.contract_snapshot IS NULL;
```

---

## ٨) ملاحظات حاسمة

- **لا تحذف** عمود `contract_id` من `visit_tasks` — لازم يبقى للـ FK والـ relations
- **لا تغيّر** اسماء الأعمدة الموجودة
- الـ `contract_snapshot` بالـ `visit_tasks` موجود فعلياً بالـ DB — بس فاضي
- الـ `customer_snapshot` بالـ `field_visits` موجود فعلياً بالـ DB — بس فاضي
- أي زيارة/مهمة جديدة لازم تتملّى snapshot وقت الإنشاء
- أي زيارة/مهمة قديمة بتضلها تشتغل عن طريق fallback على live data لحين ما نعمل migration

### خاص بالعناوين:

- **عنوان الزبون ≠ عنوان العقد** — العنوان الزبوني هو عنوان التواصل، العنوان العقدي هو عنوان تركيب الجهاز
- **المحطة = عنوان تنفيذ الزيارة** — ممكن يكون عنوان الزبون أو عنوان العقد حسب أنواع المهام
- **الـ geo hierarchy لازم يكون كامل** — محافظة + منطقة + ناحية + حي (إن وجد)
- **الـ IDs محفوظة بالـ snapshot** — لو تغيّرت الأسماء بالمستقبل، اللقطة بتضل محتفظة بالاسم الأصلي
- **`neighborhood` بـ `clients`** = ID من `geo_units` (level 3 أو 4). لازم نحل المستوى ونبني الـ hierarchy كامل.
- **`installation_geo_unit_id` بـ `contracts`** = ID من `geo_units` (أي مستوى). لازم نسلك فوق عبر `parent_id` لحتى نبني الـ ٤ مستويات.

---

## ٩) التحقق (Verification)

بعد التطبيق:

```sql
-- كل الزيارات لازم يكون عندهاون customer_snapshot
SELECT COUNT(*) AS missing FROM field_visits WHERE customer_snapshot IS NULL;
-- لازم يطلع 0

-- كل المهام اللي عندهاون contract_id لازم يكون عندهاون contract_snapshot
SELECT COUNT(*) AS missing FROM visit_tasks WHERE contract_id IS NOT NULL AND contract_snapshot IS NULL;
-- لازم يطلع 0

-- التأكد إن الـ address hierarchy موجودة
SELECT
  jsonb_typeof(customer_snapshot->'address') AS address_type,
  customer_snapshot->'address'->'governorate'->>'name' AS gov,
  customer_snapshot->'address'->'district'->>'name' AS dis
FROM field_visits
WHERE customer_snapshot IS NOT NULL
LIMIT 3;
```

---

## ١٠) الخلاصة

> **الـ snapshot = عقد بين الزيارة والتاريخ.**  
> الزيارة لحظة متجمدة — بيانات الزبون والعقد وقتها بتتحفظ وما بتتغير.  
> العنوان جزء من هاللقطة — عنوان الزبون لحاله وعنوان العقد لحاله، والمحطة بتتحسب من هدول اللقطات مش من live data.

---

## ١١) القضية الأولى: زر تغيير الفريق معطل

### الوضع الحالي

بـ `VisitDetailPage.tsx` السطر ~٨٤٢ فيه زر "تغيير الفريق":

```tsx
{canStart && (
  <div className="mt-4 pt-3 border-t border-slate-100">
    <button className="flex items-center gap-1.5 text-xs text-violet-600...">
      <RefreshCw className="w-3.5 h-3.5" />
      تغيير الفريق
    </button>
  </div>
)}
```

**المشكلة:** الزر ما عنده `onClick` — ضغطة عليه ما بيفتح شي. **زر وهمي.**

### الـ API موجود وشغال

`PATCH /field-visits/:id/team` (بالـ `fieldVisits.ts` السطر ١٣٦٥):

```typescript
router.patch('/:id/team', requirePermission('field_visits.update_result'), async (req, res) => {
  // بيتحقق إن status = 'scheduled' فقط
  // بيقبل: supervisorEmployeeId, technicianEmployeeId, traineeEmployeeId
  // بيحدّث: reassigned_supervisor_id, reassigned_technician_id, reassigned_trainee_id
  // بيحفظ: reassigned_team_snapshot, reassigned_at, reassigned_by
  // بي propagate للـ open_tasks المرتبطة
});
```

### المطلوب

**أ) إضافة `ChangeTeamModal` component بـ `VisitDetailPage.tsx`:**

- يفتح لما نضغط "تغيير الفريق"
- يعرض ٣ حقول dropdown:
  - المشرف (اختياري)
  - الفني (اختياري)
  - المتدرّب (اختياري)
- كل dropdown بيعرض موظفين الفرع الحالي (من جدول `employees`)
- زر "حفظ" بيرسل `PATCH` للـ API
- يمنع التبديل إذا الزيارة مش `scheduled`
- بعد الحفظ: `load()` عشان الصفحة تتحدّث

**ب) ربط الزر:**

```tsx
<button onClick={() => setShowChangeTeam(true)} ...>
```

**ج) ملاحظات:**
- إذا الزيارة solo (طوارئ) → ما يظهر حقل "المشرف" (الـ API بيرفضه)
- القيم الفارغة مسموحة (null) — يعني ممكن نشيل مشرف أو فني
- الـ modal لازم يجيب الأسماء الحالية من `teamData.effective` ويعرضها كقيم افتراضية

---

## ١٢) القضية التالتة: إجراءات مهام الزيارة ناقصة

### الوضع الحالي

بـ `VisitDetailPage.tsx` السطر ~٩٥٦، بس مهمة `device_demo` عندها زر إجراء:

```tsx
{task.task_type === 'device_demo' && canRecord && (
  <button onClick={() => setDemoModal({ taskId: task.id })}>
    تسجيل نتيجة العرض
  </button>
)}
```

**باقي المهام مجرد عرض — ما في زر يعمل شي.**

### أنواع المهام المدعومة

| نوع المهمة | الـ family | الإجراء المطلوب |
|-----------|-----------|----------------|
| `device_demo` | marketing | ✅ موجود — modal عرض الجهاز |
| `device_delivery` | delivery | ❌ ناقص — تسجيل نتيجة التسليم |
| `device_installation` | delivery | ❌ ناقص — تسجيل نتيجة التركيب |
| `device_activation` | delivery | ❌ ناقص — تسجيل نتيجة التشغيل |
| `emergency_maintenance` | emergency | ❌ ناقص — تسجيل نتيجة الصيانة |

### قاعدة الإجراء حسب حالة الزيارة

| حالة الزيارة | الإجراء المتاح |
|-------------|---------------|
| `scheduled` | عرض فقط — لا إجراء |
| `in_progress` | زر "سجّل نتيجة" |
| `ended` | زر "سجّل نتيجة" (إذا ما تسجّلت) |
| `completed` / `not_completed` | عرض النتيجة المسجّلة |
| `cancelled` | لا شي — المهام أُلغيت |

### المطلوب

**أ) إضافة ٤ modals جديدة بـ `VisitDetailPage.tsx`:**

| Modal | للمهمة | البيانات المطلوبة |
|-------|--------|------------------|
| `DeliveryResultModal` | `device_delivery` | تم التسليم / لم يُسلّم + ملاحظات |
| `InstallationResultModal` | `device_installation` | تم التركيب / لم يُركّب + ملاحظات |
| `ActivationResultModal` | `device_activation` | تم التشغيل / لم يُشغّل + ملاحظات |
| `EmergencyResultModal` | `emergency_maintenance` | بيفتح صفحة `emergencyResult.ts` المنفصلة |

**ب) تعديل `canRecord` logic:**

```tsx
const canRecord = !hasResult && ['in_progress', 'ended'].includes(visit.status);
```

**ج) ربط كل مهمة بالـ modal المناسب:**

```tsx
{canRecord && (
  <>
    {task.task_type === 'device_demo' && (
      <button onClick={() => setDemoModal({ taskId: task.id })}>تسجيل نتيجة العرض</button>
    )}
    {task.task_type === 'device_delivery' && (
      <button onClick={() => setDeliveryModal({ taskId: task.id })}>تسجيل نتيجة التسليم</button>
    )}
    {task.task_type === 'device_installation' && (
      <button onClick={() => setInstallationModal({ taskId: task.id })}>تسجيل نتيجة التركيب</button>
    )}
    {task.task_type === 'device_activation' && (
      <button onClick={() => setActivationModal({ taskId: task.id })}>تسجيل نتيجة التشغيل</button>
    )}
    {task.task_type === 'emergency_maintenance' && (
      <button onClick={() => navigate(`/emergency-result/${task.id}`)}>تسجيل نتيجة الصيانة</button>
    )}
  </>
)}
```

**د) الـ API endpoints للنتائج:**

- `POST /field-visits/:visitId/tasks/:taskId/result` — موجود وبيستخدمه `device_demo`
- `emergency_maintenance` — عنده route منفصل `emergencyResult.ts`
- التسليم/التركيب/التشغيل — ممكن يستخدمو نفس الـ endpoint العام (`/result`) مع `final_decision` مختلف

**ه) هيكل `visit_task_results` العام (للتسليم/التركيب/التشغيل):**

```json
{
  "final_decision": "completed" | "not_completed",
  "closing_notes": "...",
  "reason_code": null
}
```

**و) ملاحظة:** مهمة `emergency_maintenance` ما لازمها modal بالصفحة — لازمها صفحة منفصلة (`emergencyResult.ts`) لأنها معقّدة (حالات فنية + قطع + مصاريف). الزر بس بيعمل navigate.

---

## ١٣) ملفات التعديل المجمّعة

| # | الملف | التعديل |
|---|-------|---------|
| ١ | `packages/api/lib/snapshots.ts` | ملف جديد — ٣ دوال |
| ٢ | `packages/api/routes/telemarketing.ts` | امتلي snapshot وقت الحجز |
| ٣ | `packages/api/routes/openTasks.ts` | امتلي snapshot + وقف override |
| ٤ | `packages/api/routes/fieldVisits.ts` | اقرأ من snapshot + حساب المحطة |
| ٥ | `packages/web/src/pages/visits/VisitDetailPage.tsx` | زر تغيير فريق شغال + modals للمهام |
| ٦ | `packages/web/src/components/ClientInfoCard.tsx` | بيانات العنوان من snapshot |
| ٧ | `migrations/xxx_snapshot_backfill.sql` | backfill للبيانات القديمة |

---

## ١٤) التحقق النهائي (Verification)

```sql
-- Snapshot
SELECT COUNT(*) AS missing FROM field_visits WHERE customer_snapshot IS NULL;
SELECT COUNT(*) AS missing FROM visit_tasks WHERE contract_id IS NOT NULL AND contract_snapshot IS NULL;

-- العنوان hierarchy موجودة
SELECT
  jsonb_typeof(customer_snapshot->'address') AS addr_type,
  customer_snapshot->'address'->'governorate'->>'name' AS gov,
  customer_snapshot->'address'->'district'->>'name' AS dis,
  customer_snapshot->'address'->'subDistrict'->>'name' AS sub,
  customer_snapshot->'address'->'neighborhood'->>'name' AS nbr
FROM field_visits WHERE customer_snapshot IS NOT NULL LIMIT 3;
```

**اختبار يدوي:**
1. افتح زيارة قديمة — تأكد بيانات الزبون ظاهرة (من snapshot)
2. افتح زيارة جديدة — تأكد المحطة محسوبة صح
3. جرّب زر "تغيير الفريق" — لازم يفتح modal ويحفظ
4. جرّب "بدء زيارة" → "سجّل نتيجة" على مهمة تسليم/تركيب/تشغيل

---

## ١٥) الخلاصة النهائية

> **التاسك بيحل ٤ قضايا مجتمعة:**
> 1. ✅ Snapshot للزبون والعقد (تاريخية ثابتة)
> 2. ✅ العنوان بالتفصيل (زبون + عقد + محطة)
> 3. ✅ زر تغيير الفريق شغال (مربوط بالـ API)
> 4. ✅ إجراءات لكل مهمة (عرض/تسليم/تركيب/تشغيل/صيانة)
