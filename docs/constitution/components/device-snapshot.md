# مكون مشترك: لقطة بيانات الجهاز (DeviceSnapshot)

> **النوع:** Shared Data Contract + UI Component  
> **الحالة:** Draft — بانتظار مراجعة Product Owner  
> **الهدف:** توحيد قراءة وعرض بيانات الجهاز المركب في كل السياقات التشغيلية: تفاصيل الزبون، صفحة الجهاز، مهام التسليم/التركيب/التشغيل، الصيانة والطوارئ.  
> **القاعدة:** الجهاز هو نفس الكيان، لكن طريقة عرضه تختلف حسب السياق. مصدر الحقيقة التشغيلي هو `installed_devices`، وليس `contracts`.

---

## 1. التشخيص الحالي

عند اعتماد عقد كان محفوظاً كمسودة، يتم إنشاء صف في `installed_devices` عبر trigger:

```sql
materialize_device_on_activation()
  -> auto_create_installed_device_for(contract_id)
```

هذا trigger يملأ فقط الحقول الأساسية:

- `contract_id`
- `customer_id`
- `branch_id`
- `device_model_id`
- `device_model_name`
- `status = pending_delivery`

أما الحقول الفيزيائية/التشغيلية مثل:

- `serial_number`
- `installation_geo_unit_id`
- `installation_address_text`
- `installation_lat/lng`
- `delivery_date`
- `installation_date`
- `warranty_months`
- `warranty_visits`

فتُكتب حالياً من كود `contracts.ts` عند إنشاء عقد نشط مباشرة أو تعديل عقد، لكنها لا تُعاد تعبئتها تلقائياً في مسار اعتماد المسودة إلا إذا نفذنا خطوة صريحة بعد الاعتماد.

**الأثر المرئي:**  
من تفاصيل الزبون ← قسم الأجهزة ← فتح الجهاز، تظهر صفحة الجهاز موجودة لكن أغلب المعلومات فارغة لأن `DeviceProfilePage` يقرأ من `/api/installed-devices/:id`، وهذا endpoint يعرض ما هو موجود فعلاً في `installed_devices`.

---

## 2. القرار المعماري

### 2.1 مصدر الحقيقة

| نوع البيانات | مصدر الحقيقة | السبب |
|---|---|---|
| هوية الجهاز الفيزيائية | `installed_devices` | الجهاز بعد البيع كيان مستقل عن العقد |
| رقم العقد والبيانات القانونية/المالية | `contracts` | العقد هو المصدر القانوني والمالي |
| موديل الجهاز وقت البيع | `installed_devices.device_model_id/name` مع fallback من العقد فقط عند الإصلاح | نحتاج snapshot ثابت وقت البيع |
| الموقع الحالي للجهاز | `installed_devices.installation_*` | الموقع قابل للتغير بعد البيع |
| حالة الجهاز | `installed_devices.status` | دورة حياة فيزيائية |
| الكفالات | `device_warranties` + حقول legacy على `installed_devices` | الكفالة قد تكون من العقد أو ذهبية أو لاحقة |

### 2.2 القاعدة الذهبية

لا نعتمد على `contractSnapshot.device` كبديل دائم عن `DeviceSnapshot`.

`contractSnapshot` يصف العقد في سياق مهمة.  
`deviceSnapshot` يصف الجهاز نفسه في سياق تشغيل/تسليم/صيانة.

---

## 3. مستويات العرض

### 3.1 Mini Device Snapshot

يظهر في الجداول والقوائم:

- قسم الأجهزة في صفحة الزبون
- قائمة مهام ما بعد البيع
- قوائم الصيانة والطوارئ

الحقول:

```ts
type MiniDeviceSnapshot = {
  id: number;
  modelName: string;
  serialNumber: string | null;
  status: string;
  contractNumber: string | null;
  customerName?: string | null;
  addressShort: string | null;
};
```

قاعدة العرض:

- السطر الرئيسي: `modelName`
- السطر الثانوي: `serialNumber || #id`
- badges: الحالة + الكفالة عند توفرها
- العنوان المختصر: آخر مستويين من geo path أو `installationAddressText` عند غياب geo

---

### 3.2 Standard Device Snapshot

يظهر في:

- صفحة تفاصيل الجهاز
- تبويب الجهاز داخل المهمة
- مودال اختيار جهاز لخدمة أو صيانة

```ts
type DeviceSnapshot = {
  id: number;
  contractId: number;
  contractNumber: string | null;
  customerId: number;
  customerName: string | null;
  branchId: number | null;
  branchName: string | null;

  identity: {
    modelId: number | null;
    modelName: string;
    serialNumber: string | null;
  };

  lifecycle: {
    status: string;
    deliveryDate: string | null;
    installationDate: string | null;
    activatedAt: string | null;
  };

  location: {
    geoUnitId: number | null;
    geoUnitName: string | null;
    geoPath: Array<{ id: number; name: string; level: number }>;
    addressText: string | null;
    lat: number | null;
    lng: number | null;
    addressShort: string | null;
  };

  warranty: {
    contractWarrantyEndDate: string | null;
    goldenWarrantyEndDate: string | null;
    warrantyMonths: number | null;
    warrantyVisits: number | null;
    primaryStatus: string | null;
  };
};
```

---

### 3.3 Full Device Snapshot

يظهر في صفحة الجهاز الكاملة فقط، ويمكن أن يتضمن:

- `currentPossession`
- `possessionHistory`
- `activeTasks`
- `linkedContract`
- `financialSummary`
- `installedParts`
- `warranties[]`

قاعدة مهمة: هذه إضافات قراءة مجمّعة للواجهة، وليست حقولاً تُخزن كـ JSON snapshot داخل كل جدول.

---

## 4. API Builder المقترح

نضيف helper واحد في الـ API:

```ts
export async function buildDeviceSnapshot(db, installedDeviceId: number): Promise<DeviceSnapshot | null>
```

الاستعلام الأساسي:

```sql
SELECT
  d.id,
  d.contract_id,
  c.contract_number,
  d.customer_id,
  c.customer_name,
  d.branch_id,
  b.name AS branch_name,
  d.device_model_id,
  d.device_model_name,
  d.serial_number,
  d.status,
  d.delivery_date,
  d.installation_date,
  d.activated_at,
  d.installation_geo_unit_id,
  gu.name AS installation_geo_unit_name,
  d.installation_address_text,
  d.installation_lat,
  d.installation_lng,
  d.contract_warranty_end_date,
  d.golden_warranty_end_date,
  d.warranty_months,
  d.warranty_visits
FROM installed_devices d
JOIN contracts c ON c.id = d.contract_id
LEFT JOIN branches b ON b.id = d.branch_id
LEFT JOIN geo_units gu ON gu.id = d.installation_geo_unit_id
WHERE d.id = $1
```

ثم يبني:

- `geoPath` من `geo_units.parent_id`
- `addressShort` من آخر مستويين في `geoPath`
- `warranty.primaryStatus` من `device_warranties` إن وجد، وإلا من التواريخ legacy

---

## 5. أين يُخزن DeviceSnapshot؟

### 5.1 لا نخزنه في `installed_devices`

لأن `installed_devices` نفسه هو مصدر الحقيقة.

### 5.2 نخزنه في `open_tasks.device_snapshot`

عند إنشاء مهمة مبنية على جهاز:

- `device_delivery`
- `device_installation`
- `device_activation`
- `emergency_maintenance`
- `maintenance`
- أي مهمة موقعها أو سياقها مبني على الجهاز

الهدف: أن تبقى المهمة قابلة للقراءة تاريخياً حتى لو تغير موقع الجهاز لاحقاً.

الحقل المقترح:

```sql
ALTER TABLE open_tasks
  ADD COLUMN IF NOT EXISTS device_snapshot JSONB;
```

مع مبدأ:

- `device_id` يبقى FK تشغيلي حي.
- `device_snapshot` لقطة وقت إنشاء المهمة.
- عند فتح المهمة نعرض snapshot، ومعها تنبيه صغير إذا اختلفت عن الجهاز الحالي.

---

## 6. إصلاح مسار اعتماد العقد

عند اعتماد عقد مسودة:

1. `UPDATE contracts SET status='active', closing_employee_id=...`
2. trigger ينشئ `installed_devices`
3. يجب مباشرة بعد ذلك تنفيذ `hydrateInstalledDeviceFromContractDraft(contractId)`
4. بعدها ننشئ مهمة `device_delivery` ونمرر لها `device_id`
5. `persistOpenTaskSnapshots()` يجب أن يحفظ:
   - `client_snapshot`
   - `contract_snapshot`
   - `device_snapshot`

الدالة المقترحة:

```ts
async function hydrateInstalledDeviceFromContractDraft(db, contractId: number) {
  // تقرأ بيانات العقد القانونية + أي حقول فيزيائية مخزنة/مرسلة وقت إنشاء المسودة
  // وتكتب القيم النهائية على installed_devices.
}
```

ملاحظة مهمة: إذا لم تكن الحقول الفيزيائية محفوظة في `contracts` بعد Phase 2C، يجب ألا نعتمد عليها من العقد. الحل الأفضل أن نحفظها وقت المسودة في مصدر مؤقت واضح، أو نكتبها إلى `installed_devices` حتى للمسودة مع status `pending_contract_approval` إذا قررنا السماح بوجود جهاز قبل الاعتماد. القرار الحالي في الدستور يقول: المسودة بلا آثار جانبية، لذلك نحتاج مكاناً تحفظ فيه “مدخلات الجهاز قبل الاعتماد”.

---

## 7. فجوة البيانات في المسودات

حالياً عند حفظ عقد كمسودة، حقول الجهاز التي يدخلها المستخدم مثل الرقم التسلسلي والعنوان ليست موجودة في `contracts` بعد فصل Phase 2C، ولا يوجد `installed_devices` لأن المسودة بلا آثار جانبية.

لذلك عند الاعتماد لاحقاً لا توجد نسخة موثوقة لإعادة تعبئة الجهاز.

### خيار A — الموصى به

إضافة `draft_device_payload JSONB` إلى `contracts`.

يُستخدم فقط للعقود `draft`.

مثال:

```json
{
  "serialNumber": "GS-001",
  "deviceStatus": "pending_delivery",
  "deliveryDate": null,
  "installationDate": null,
  "installationGeoUnitId": 123,
  "installationAddressText": "الطابق الثاني",
  "installationLat": 33.5,
  "installationLng": 36.2,
  "warrantyMonths": 12,
  "warrantyVisits": 4
}
```

عند الاعتماد:

- نقرأ `contracts.draft_device_payload`
- نكتب القيم إلى `installed_devices`
- يمكن بعدها إفراغه أو تركه كأثر تدقيقي

### خيار B

إنشاء `installed_devices` حتى للمسودة، لكن بحالة `pending_contract_approval`.

هذا يخالف قاعدة “المسودة بلا آثار جانبية”، لذلك لا يُنصح به إلا إذا غيّرنا قرار الدستور.

---

## 8. خطة تطبيق قصيرة

1. إضافة مستند `device-snapshot.md` واعتماده.
2. إضافة migration:
   - `contracts.draft_device_payload JSONB`
   - `open_tasks.device_snapshot JSONB`
3. تعديل `ContractForm`:
   - عند إنشاء/تعديل مسودة يرسل حقول الجهاز داخل `draftDevicePayload`.
4. تعديل `contracts.ts approve`:
   - بعد إنشاء `installed_devices` يطبق `draft_device_payload` على الجهاز.
5. إضافة `buildDeviceSnapshot()` و `persistOpenTaskSnapshots()` يكتب `device_snapshot` عند وجود `device_id`.
6. تعديل `/installed-devices/:id`:
   - يرجع `deviceSnapshot` جاهزاً أو يرجع نفس shape القياسي.
7. تعديل `DeviceProfilePage` و `DevicesTab`:
   - يعتمدان على `DeviceSnapshot` بدل حقول مبعثرة.

---

## 9. Definition of Done

- عقد مسودة يحتوي بيانات جهاز، بعد اعتماده يظهر الجهاز في صفحة الزبون ببياناته كاملة.
- مهمة التسليم المولدة تلقائياً تحمل `device_id` و `device_snapshot`.
- صفحة تفاصيل الجهاز لا تحتاج fallback من العقد لعرض الهوية والموقع.
- أي مهمة لاحقة تستخدم snapshot تاريخي للجهاز، مع إمكانية الرجوع للجهاز الحالي عبر `device_id`.
- لا يتم تكرار منطق بناء بيانات الجهاز في أكثر من endpoint.
