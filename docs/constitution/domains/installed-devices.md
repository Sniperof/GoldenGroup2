# دستور الكيان: الأجهزة المركبة (Installed Devices Domain Constitution)

> **الحالة (Status):** Authoritative / Active — أُنشئ في 2026-05-26 مع Phase 2A/B/C من مسار فصل الجهاز عن العقد.
> **المرجع المعتمد لدورة الحياة الفيزيائية للجهاز بعد البيع** — الموقع، الحالة، الكفالة، الصيانة — مستقلاً عن بنود العقد المالي.

---

## 1. هوية الكيان (Entity Identity)

- **الاسم العربي:** الجهاز المركب / الجهاز الميداني
- **الاسم الإنجليزي:** Installed Device
- **اسم الجدول:** `installed_devices`
- **الوصف:** يمثل الوجود الفيزيائي للجهاز في منزل الزبون بعد إتمام صفقة البيع. بينما يوثق العقد (`contracts`) الاتفاق المالي والقانوني بين الشركة والزبون، يوثّق `installed_devices` واقعة المنتج المادي: أين هو الآن، ما حالته الحالية، متى سُلِّم وركِّب، وأي كفالات تغطيه. الفصل بين الكيانين هو ما يتيح في المستقبل: نقل ملكية جهاز، تتبع تاريخ قطع الغيار لكل وحدة، وإدارة كفالات متعددة المصدر على نفس الجهاز.
- **الجداول المرتبطة (مخططة — لم تُنشأ بعد):**
  1. `device_warranties` *(Phase 4)* — كفالات مستقلة مصدرها العقد أو مهمة التسليم أو اتفاق منفصل.
  2. `device_installed_parts` *(Phase 5)* — تاريخ قطع الغيار المركبة والمستبدلة لكل وحدة.
- **الأهمية التشغيلية:** نقطة الحقيقة الوحيدة (`single source of truth`) لكل استفسار ميداني عن الجهاز — يستخدمه نظام المهام، التقارير الجغرافية، وجدولة الصيانة. أي خلل في بياناته يؤثر مباشرة على جودة المهام الميدانية وحسابات الكفالة.

---

## 2. معجم الجداول والحقول (Table & Field Dictionary)

### 2.1 جدول الأجهزة المركبة `installed_devices`

أُنشئ في Migration 190 (Phase 2A). يمتد بمهجرات: 190، 191، 192 (ملغاة)، 193.

| الحقل | النوع | NULL? | DEFAULT | Constraints | الوصف | مثال |
|-------|-------|-------|---------|-------------|-------|------|
| `id` | `SERIAL` | ❌ | — | `PRIMARY KEY` | المعرف الفريد للجهاز | `7` |
| `contract_id` | `INTEGER` | ❌ | — | `FK → contracts(id) ON DELETE RESTRICT` | العقد المصدر للجهاز — لا يتغير بعد الإنشاء | `22` |
| `customer_id` | `INTEGER` | ❌ | — | `FK → clients(id) ON DELETE RESTRICT` | مالك الجهاز الحالي (قابل للتغيير عند نقل الملكية) | `23` |
| `branch_id` | `INTEGER` | ✅ | — | `FK → branches(id) ON DELETE SET NULL` | الفرع المسؤول عن خدمة الجهاز | `3` |
| `device_model_id` | `INTEGER` | ✅ | — | `FK → device_models(id) ON DELETE SET NULL` | موديل الجهاز من الكتالوج | `5` |
| `device_model_name` | `VARCHAR(255)` | ✅ | — | — | لقطة اسم الموديل وقت البيع | `"فلتر ذهبي 7 مراحل"` |
| `serial_number` | `VARCHAR(255)` | ✅ | — | — | الرقم التسلسلي الفريد لهذه الوحدة تحديداً | `"GS-2026-001"` |
| `status` | `VARCHAR(50)` | ❌ | `'pending_delivery'` | `CHECK (status IN (...))` | الحالة الفيزيائية الحالية للجهاز | `"installed"` |
| `installation_geo_unit_id` | `INTEGER` | ✅ | — | `FK → geo_units(id) ON DELETE SET NULL` | المنطقة الجغرافية لموقع الجهاز | `123` |
| `installation_address_text` | `TEXT` | ✅ | — | — | العنوان التفصيلي لموقع التركيب | `"المزة، بناية 5، طابق 2"` |
| `installation_lat` | `NUMERIC(12,8)` | ✅ | — | — | خط عرض موقع الجهاز | `33.51380000` |
| `installation_lng` | `NUMERIC(12,8)` | ✅ | — | — | خط طول موقع الجهاز | `36.27650000` |
| `delivery_date` | `DATE` | ✅ | — | — | تاريخ التسليم الفعلي للجهاز | `2026-05-25` |
| `installation_date` | `DATE` | ✅ | — | — | تاريخ التركيب الفعلي في منزل الزبون | `2026-05-28` |
| `is_golden_warranty` | `BOOLEAN` | ❌ | `FALSE` | — | هل تغطي الكفالة الذهبية هذه الوحدة؟ | `true` |
| `golden_warranty_end_date` | `DATE` | ✅ | — | — | تاريخ انتهاء الكفالة الذهبية | `2028-05-24` |
| `contract_warranty_end_date` | `DATE` | ✅ | — | — | تاريخ انتهاء كفالة العقد القياسية | `2027-05-24` |
| `warranty_months` | `INTEGER` | ✅ | — | — | مدة كفالة العقد بالأشهر | `12` |
| `warranty_visits` | `INTEGER` | ✅ | — | — | عدد زيارات الصيانة المتضمنة في الكفالة | `4` |
| `created_at` | `TIMESTAMPTZ` | ❌ | `NOW()` | — | وقت إنشاء السجل | `2026-05-24T20:15:00Z` |
| `updated_at` | `TIMESTAMPTZ` | ❌ | `NOW()` | trigger | يُحدَّث تلقائياً عند كل UPDATE | `2026-05-26T10:00:00Z` |

#### قيود دورة الحياة `status`

```
pending_delivery → delivered → installed → active → decommissioned
```

| القيمة | المعنى |
|--------|--------|
| `pending_delivery` | تم إنشاء العقد، الجهاز لم يُسلَّم بعد |
| `delivered` | سُلِّم الجهاز، لم يُركَّب بعد |
| `installed` | رُكِّب في الموقع، قيد الاختبار |
| `active` | فعّال ويعمل بشكل طبيعي |
| `decommissioned` | خُرِّج من الخدمة (معيب أو استُبدل) |

#### الفهارس

| الفهرس | الأعمدة | النوع | الغرض |
|--------|---------|-------|-------|
| `uidx_installed_devices_contract` | `(contract_id)` | UNIQUE | ضمان وحدة الجهاز لكل عقد |
| `idx_installed_devices_customer` | `(customer_id)` | INDEX | البحث بأجهزة زبون معين |
| `idx_installed_devices_branch` | `(branch_id)` | INDEX | فلترة بالفرع |
| `idx_installed_devices_model` | `(device_model_id)` | INDEX | إحصاءات الموديلات |
| `idx_installed_devices_status` | `(status)` | INDEX | فلترة بالحالة |

---

## 3. العلاقات (Relationships)

```
contracts (1) ────────── (1) installed_devices
                              │── customer_id  → clients
                              │── branch_id    → branches
                              │── device_model_id → device_models
                              │── installation_geo_unit_id → geo_units
                              └── [مخطط] ← open_tasks.device_id  (Phase 3)
                              └── [مخطط] ← device_warranties.device_id  (Phase 4)
                              └── [مخطط] ← device_installed_parts.device_id  (Phase 5)
```

**الربط العكسي:** يحتفظ `contracts.installed_device_id` بمرجع عكسي لتسهيل التنقل في الاتجاهين دون JOIN إضافي.

---

## 4. منطق الأعمال (Business Rules)

### BR-1: الإنشاء التلقائي عند البيع

عند كل INSERT لعقد من نوع `sale_contract`، يُطلَق trigger `trg_auto_create_installed_device` (migration 191) تلقائياً لإنشاء صف `installed_devices` ثم يكتب `installed_device_id` العكسي على العقد — كل هذا في نفس الـ transaction.

> **Phase 2C:** الـ trigger يُنشئ الصف بقيم أولية (null)، ثم يتولى كود `contracts.ts POST` كتابة الحقول الفيزيائية مباشرةً بعد ذلك في نفس الـ transaction.

### BR-2: مصدر الكتابة المباشر (Phase 2C)

جميع تعديلات الحقول الفيزيائية تذهب مباشرةً إلى `installed_devices` — لا يوجد trigger مزامنة وسيط. العقد (`contracts`) يحتفظ فقط بالحقول المالية والقانونية.

**الحقول المالية (تبقى في contracts):** `base_price`, `final_price`, `payment_type`, `down_payment`, `installments_count`, `status`, `buyer_*`, `source_*`, `sale_*`, `discount_*`, `invoice_notes`.

**الحقول الفيزيائية (تُكتب في installed_devices فقط):** `serial_number`, `status`, `delivery_date`, `installation_date`, `installation_geo_unit_id`, `installation_address_text`, `installation_lat/lng`, `warranty_months`, `warranty_visits`, `contract_warranty_end_date`, `is_golden_warranty`, `golden_warranty_end_date`.

### BR-3: فاصل الصيانة المحسوب

لا يُخزَّن فاصل الصيانة بالأيام مباشرةً. يُحسَّب عند الحاجة:

```
interval_days = floor((warranty_months × 30) / warranty_visits)
```

مثال: 12 شهراً / 4 زيارات = 90 يوم بين كل زيارتين.

الـ fallback للعقود القديمة (ما قبل Phase 2A): يُقرأ `contracts.maintenance_plan` كاحتياطي إذا كان `warranty_visits IS NULL`.

### BR-4: نظام الكفالة المزدوج

| الكفالة | الحقل | مصدر التفعيل |
|---------|-------|--------------|
| كفالة العقد | `contract_warranty_end_date` | تُحسَّب عند إنشاء العقد: `contractDate + warranty_months` |
| الكفالة الذهبية | `is_golden_warranty + golden_warranty_end_date` | تُفعَّل يدوياً من مهمة تسليم الكفالة (GAP-078 — معلق) |

### BR-5: الموقع قابل للتغيير

حقول `installation_geo_unit_id`, `installation_address_text`, `lat/lng` تمثل الموقع الحالي للجهاز — وليس الموقع وقت التوصيل الأصلي. إذا انتقل الجهاز لمنزل آخر يُحدَّث الموقع مباشرةً هنا دون أن يتأثر العقد الأصلي.

---

## 5. مسار الهجرة الكامل (Migration Roadmap)

### ما اكتمل

| المرحلة | المهجرة / الكود | التاريخ | الوصف |
|---------|----------------|---------|-------|
| **0** | مهجرات 186-189 | 2026-05-26 | إصلاح JSONB الكفالات + إضافة warranty_months/visits |
| **2A** | مهجرة 190 | 2026-05-26 | إنشاء الجدول + backfill 10 عقود + فهارس |
| **2A** | مهجرة 191 | 2026-05-26 | trigger INSERT → auto-create installed_devices |
| **2B** | مهجرة 192 + كود | 2026-05-26 | تحويل جميع قراءات API إلى `installed_devices` عبر LEFT JOIN |
| **2C** | مهجرة 193 + كود | 2026-05-26 | الكتابات مباشرةً إلى `installed_devices` + حذف trigger المزامنة |

### المراحل القادمة (موثقة في §8 و §9)

| المرحلة | الوصف | الحالة |
|---------|-------|--------|
| **GAP-078** | تفعيل الكفالة الذهبية من مهمة التسليم | ⏳ معلق |
| **Phase 3** | ربط `open_tasks.device_id` | ✅ مكتمل (migration 194, 2026-05-26) |
| **Phase 4** | إنشاء `device_warranties` | ⏳ مخطط |
| **Phase 5** | إنشاء `device_installed_parts` | ⏳ مخطط |
| **Phase 6** | DROP الحقول Legacy من `contracts` | ✅ مكتمل (migration 195, 2026-05-26) |

---

## 6. صلاحيات الوصول (Permission Matrix)

يرث `installed_devices` صلاحيات `contracts` حتى يُنشأ نظام صلاحياته المستقل:

| العملية | الصلاحية المطلوبة | ملاحظة |
|---------|------------------|--------|
| قراءة القائمة `GET /` | `contracts.view_list` | مع دعم فلترة `?customerId`, `?branchId`, `?status` |
| قراءة جهاز `GET /:id` | `contracts.view_list` | — |
| تعديل جهاز `PATCH /:id` | `contracts.edit` | الحقول الفيزيائية فقط |
| إنشاء `POST` | غير متاح مباشرةً | يُنشأ تلقائياً عند إنشاء `sale_contract` |
| حذف `DELETE` | غير متاح | محمي بـ `ON DELETE RESTRICT` من جانب العقد |

---

## 7. عقد API (API Contract)

**Base URL:** `/api/installed-devices`
**Middleware:** `requireAuth` على كل المسارات

---

### 7.1 `GET /api/installed-devices`

استرجاع قائمة الأجهزة مع دعم الفلاتر.

**Query params:**
| المعامل | النوع | الوصف |
|---------|-------|-------|
| `customerId` | integer | فلتر بمعرف الزبون |
| `branchId` | integer | فلتر بمعرف الفرع |
| `status` | string | فلتر بالحالة الفيزيائية |

**Response (200):**
```json
[
  {
    "id": 7,
    "contractId": 22,
    "customerId": 23,
    "branchId": 3,
    "deviceModelId": 5,
    "deviceModelName": "فلتر ذهبي 7 مراحل",
    "serialNumber": "GS-2026-001",
    "status": "installed",
    "installationGeoUnitId": 123,
    "installationGeoUnitName": "المزة",
    "installationAddressText": "بناية 5، طابق 2",
    "installationLat": 33.5138,
    "installationLng": 36.2765,
    "deliveryDate": "2026-05-25",
    "installationDate": "2026-05-28",
    "isGoldenWarranty": false,
    "goldenWarrantyEndDate": null,
    "contractWarrantyEndDate": "2027-05-24",
    "warrantyMonths": 12,
    "warrantyVisits": 4,
    "contractNumber": "C-2026-00022",
    "customerName": "أحمد محمد",
    "createdAt": "2026-05-24T20:15:00Z",
    "updatedAt": "2026-05-26T10:00:00Z"
  }
]
```

---

### 7.2 `GET /api/installed-devices/:id`

استرجاع جهاز واحد بمعرفه.

**Response (404):** `{ "error": "الجهاز غير موجود" }`

---

### 7.3 `PATCH /api/installed-devices/:id`

تعديل الحقول الفيزيائية فقط. يقبل أي مجموعة جزئية من:

```json
{
  "serialNumber": "GS-2026-001",
  "status": "active",
  "deliveryDate": "2026-05-25",
  "installationDate": "2026-05-28",
  "installationGeoUnitId": 123,
  "installationAddressText": "بناية 5، طابق 2",
  "installationLat": 33.5138,
  "installationLng": 36.2765,
  "isGoldenWarranty": true,
  "goldenWarrantyEndDate": "2028-05-24",
  "contractWarrantyEndDate": "2027-05-24",
  "warrantyMonths": 12,
  "warrantyVisits": 4
}
```

**Response (200):** `{ "ok": true, "id": 7 }`
**Response (400):** `{ "error": "لا يوجد حقول للتحديث" }` — إذا أُرسل body فارغ.
**Response (404):** `{ "error": "الجهاز غير موجود" }`

---

## 8. الثغرات المفتوحة (Open Gaps)

### GAP-078: غياب واجهة تفعيل الكفالة الذهبية ⚠️ معلق

- **الإشكالية:** لا يوجد UI في صفحة نتيجة مهمة "تسليم كفالة ذهبية" يتيح اختيار الفترة من `device_models.golden_warranty_periods` وكتابة `is_golden_warranty + golden_warranty_end_date` على `installed_devices`.
- **الأثر:** الكفالة الذهبية تبقى `FALSE` لجميع الأجهزة حتى بعد تسليمها فعلياً.
- **الحل المطلوب:** إضافة dropdown في نتيجة المهمة + `PATCH /api/installed-devices/:id` بالحقلين.

### GAP-ID-001: trigger 191 يكتب قيماً null إلى installed_devices عند الإنشاء ⚠️ انتقالي

- **الإشكالية:** trigger `auto_create_installed_device` (migration 191) يقرأ الحقول الفيزيائية من `contracts` عند INSERT — لكن في Phase 2C لا تُكتَب هذه الحقول في contracts. النتيجة: الصف يُنشأ بـ `null` ثم يُحدَّث مباشرةً بالكود.
- **الأثر:** خطوتان بدلاً من واحدة (INSERT بـ null + UPDATE فوري) في نفس الـ transaction.
- **التوصية في Phase 6:** تعديل الـ trigger ليُنشئ الصف بالحقول الأساسية فقط (`contract_id`, `customer_id`, `branch_id`, `device_model_id/name`, `status`) دون الحقول التي ستُملأ لاحقاً بالكود.

### GAP-ID-002: لا يوجد branch-level authorization على `GET /api/installed-devices` 🔴 أمنية

- **الإشكالية:** الـ endpoint يدعم `?branchId` لكن لا يتحقق من صلاحية المستخدم الحالي على ذلك الفرع. مستخدم فرع A يستطيع استرجاع أجهزة فرع B بمجرد تمرير `?branchId=B`.
- **التوصية:** إضافة `authorize()` check مشابه لما طُبِّق على `GET /api/contracts/:id`.

---

## 9. توثيق المراحل القادمة التفصيلي

### 9.1 Phase 3: ربط `open_tasks.device_id`

#### الهدف
ربط كل مهمة ميدانية (`open_tasks`) بالجهاز الفيزيائي المستهدف مباشرةً — لا فقط بالعقد. يُتيح هذا:
- استعراض تاريخ جميع المهام على جهاز بعينه
- فصل مهام صيانة جهاز معين عن بقية مهام العقد
- أساس لجدولة الصيانة الدورية الذكية بناءً على `warranty_visits` للجهاز

#### المتطلبات المسبقة
- [x] جدول `installed_devices` موجود وبيانات backfill مكتملة (Phase 2A ✅)
- [x] جميع `sale_contract` لديها صف في `installed_devices` (التحقق: `COUNT = 10/10` ✅)
- [ ] لا توجد مهام مرتبطة بعقود بدون `installed_device_id` — يجب التحقق قبل migration

#### خطوات التنفيذ

**الخطوة 1 — migration إضافة العمود:**
```sql
-- migration 194 (مقترح)
ALTER TABLE open_tasks
  ADD COLUMN IF NOT EXISTS device_id INTEGER
    REFERENCES installed_devices(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_open_tasks_device_id
  ON open_tasks(device_id);
```

**الخطوة 2 — backfill للمهام الموجودة:**
```sql
UPDATE open_tasks ot
SET device_id = d.id
FROM installed_devices d
WHERE d.contract_id = ot.contract_id
  AND ot.contract_id IS NOT NULL
  AND ot.device_id IS NULL;
```

**الخطوة 3 — تحديث `openTasks.ts` POST:**
```typescript
// عند إنشاء مهمة جديدة مرتبطة بعقد → استرجاع device_id تلقائياً
const { rows: deviceRow } = await client.query(
  'SELECT id FROM installed_devices WHERE contract_id = $1 LIMIT 1',
  [contractId]
);
const deviceId = deviceRow[0]?.id ?? null;
// أضفه إلى INSERT open_tasks
```

**الخطوة 4 — تحديث SELECT في `openTasks.ts`:**
- إضافة `ot.device_id AS "deviceId"` لكل queries
- إزالة الـ LEFT JOIN على `installed_devices` عبر `contract_id` — يصبح مباشراً عبر `device_id`

**الخطوة 5 — تحديث واجهة المستخدم:**
- `TaskContractTab.tsx` — قراءة بيانات الجهاز عبر `task.deviceId` بدلاً من `task.contractId → installed_devices`
- صفحة تفاصيل الجهاز (`DeviceDetail.tsx` أو جديدة) — عرض قائمة المهام المرتبطة بهذا الجهاز تحديداً

#### الاختبارات المطلوبة

| السيناريو | الشرط |
|-----------|-------|
| إنشاء مهمة جديدة لعقد موجود | `open_tasks.device_id` يُملأ تلقائياً |
| استرجاع مهام جهاز معين | `GET /api/open-tasks?deviceId=X` يُرجع المهام الصحيحة |
| مهمة بدون عقد | `device_id = NULL` مقبول — لا خطأ |
| حذف installed_device | مستحيل بسبب `ON DELETE RESTRICT` من العقد — لكن لو سمحنا، `device_id` يصبح `NULL` بـ `ON DELETE SET NULL` |

---

### 9.2 Phase 6: DROP الحقول Legacy من `contracts`

#### الهدف
تنظيف جدول `contracts` من الحقول الفيزيائية التي انتقلت إلى `installed_devices` — يُبقي العقد كياناً مالياً صافياً.

#### شروط البدء الصارمة (يجب اكتمالها جميعاً قبل تشغيل migration)

| الشرط | طريقة التحقق |
|-------|--------------|
| Phase 2C مكتملة — لا كود يكتب هذه الحقول في contracts | `grep -r "serial_number\|device_status\|delivery_date\|installation_date\|installation_geo_unit_id" packages/api/routes/contracts.ts` → يجب ألا يظهر في INSERT/UPDATE |
| Phase 3 مكتملة — `open_tasks.device_id` يعمل | تأكيد أن الـ openTasks لا تقرأ الحقول من contracts مباشرةً |
| `customerCalls.ts` لا يقرأ من `contracts.*` للحقول المحذوفة | ✅ مكتمل في Phase 2B |
| جميع العقود النشطة لديها `installed_device_id` | `SELECT COUNT(*) FROM contracts WHERE installed_device_id IS NULL AND contract_type = 'sale_contract'` → يجب أن تُرجع 0 |
| `warranty_visits` مُعبأ في `installed_devices` لكل عقود نشطة | تحقق لمنع كسر حسابات الصيانة |

#### الحقول المستهدفة للحذف

| الحقل | الجدول | ملاحظة |
|-------|--------|--------|
| `serial_number` | `contracts` | انتقل إلى `installed_devices.serial_number` |
| `device_status` | `contracts` | انتقل إلى `installed_devices.status` |
| `delivery_date` | `contracts` | انتقل إلى `installed_devices.delivery_date` |
| `installation_date` | `contracts` | انتقل إلى `installed_devices.installation_date` |
| `installation_geo_unit_id` | `contracts` | انتقل إلى `installed_devices.installation_geo_unit_id` |
| `installation_address_text` | `contracts` | انتقل إلى `installed_devices.installation_address_text` |
| `installation_lat` | `contracts` | انتقل إلى `installed_devices.installation_lat` |
| `installation_lng` | `contracts` | انتقل إلى `installed_devices.installation_lng` |
| `is_golden_warranty` | `contracts` | انتقل إلى `installed_devices.is_golden_warranty` |
| `golden_warranty_end_date` | `contracts` | انتقل إلى `installed_devices.golden_warranty_end_date` |
| `contract_warranty_end_date` | `contracts` | انتقل إلى `installed_devices.contract_warranty_end_date` |
| `warranty_months` | `contracts` | انتقل إلى `installed_devices.warranty_months` |
| `warranty_visits` | `contracts` | انتقل إلى `installed_devices.warranty_visits` |
| `maintenance_plan` | `contracts` | يُحذف بعد GAP-079 Phase 3 (backfill warranty_visits كامل) |
| `maintenance_interval` | `device_models` | يُحذف بعد GAP-079 Phase 2 |

#### migration مقترحة (بعد اكتمال الشروط)

```sql
-- migration 19X (اسم مقترح: 19X_phase6_drop_legacy_contract_device_columns.sql)
-- ⚠️ لا تُشغَّل إلا بعد التحقق من جميع شروط Phase 6 أعلاه

ALTER TABLE contracts
  DROP COLUMN IF EXISTS serial_number,
  DROP COLUMN IF EXISTS device_status,
  DROP COLUMN IF EXISTS delivery_date,
  DROP COLUMN IF EXISTS installation_date,
  DROP COLUMN IF EXISTS installation_geo_unit_id,
  DROP COLUMN IF EXISTS installation_address_text,
  DROP COLUMN IF EXISTS installation_lat,
  DROP COLUMN IF EXISTS installation_lng,
  DROP COLUMN IF EXISTS is_golden_warranty,
  DROP COLUMN IF EXISTS golden_warranty_end_date,
  DROP COLUMN IF EXISTS contract_warranty_end_date,
  DROP COLUMN IF EXISTS warranty_months,
  DROP COLUMN IF EXISTS warranty_visits;
  -- maintenance_plan: يُحذف في migration منفصلة بعد GAP-079 Phase 3

ALTER TABLE device_models
  DROP COLUMN IF EXISTS maintenance_interval;
  -- يُحذف بعد GAP-079 Phase 2
```

#### تنظيف الكود المطلوب بعد migration

```
packages/api/routes/contracts.ts:
  - حذف الحقول Legacy من contractSelect
  - حذف auto-create trigger 191 (يصبح ليس له معنى لنقل الحقول)
  - تعديل trigger 191 ليُنشئ الصف بالحقول الأساسية فقط

packages/web/src/pages/contracts/ContractForm.tsx:
  - حذف حقول legacy من النموذج إذا لم يحذف من قبل

packages/api/routes/contracts.ts contractSelect:
  - حذف كل الحقول المرتبطة بـ d.* التي انتقلت (ستُقرأ عبر /api/installed-devices مباشرةً)
```

---

## 10. تاريخ التغييرات (Schema Changelog)

| التاريخ | المهجرة | التغيير |
|---------|---------|---------|
| **2026-05-26** | `190_create_installed_devices.sql` | إنشاء الجدول + backfill 10 عقود + فهارس + `contracts.installed_device_id` |
| **2026-05-26** | `191_installed_devices_trigger.sql` | trigger AFTER INSERT على contracts → auto-create صف installed_devices |
| **2026-05-26** | `192_sync_installed_device_trigger.sql` | *(Phase 2B انتقالي — محذوف في 193)* trigger AFTER UPDATE → مزامنة الحقول الفيزيائية |
| **2026-05-26** | `193_drop_sync_trigger.sql` | حذف trigger المزامنة — Phase 2C اكتملت، الكتابات مباشرةً |
| **2026-05-26** | `194_open_tasks_device_id.sql` | **Phase 3:** إضافة `open_tasks.device_id FK → installed_devices` + index + backfill للـ4 مهام الموجودة. تحديث `openTasks.ts POST` و`contracts.ts` (auto-create delivery task) لملء `device_id` تلقائياً. |
| **2026-05-26** | `195_phase6_drop_contract_device_columns.sql` | **Phase 6:** حذف 13 حقلاً فيزيائياً من `contracts` (serial_number, device_status, delivery_date, installation_date, installation_geo/address/lat/lng, warranty_*, is_golden_warranty, *_warranty_end_date). تعديل trigger 191 ليُنشئ installed_devices بالحقول الأساسية فقط. تحويل `updateContractDeviceStatusOnTaskCompletion` لتكتب على `installed_devices.status`. |
