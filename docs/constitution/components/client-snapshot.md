# مكون مشترك: لقطة بيانات الزبون (ClientSnapshot)

> **النوع:** Shared UI Component  
> **الحالة:** Draft — بانتظار موافقة Product Owner  
> **الهدف:** توحيد عرض بيانات الزبون على 3 مستويات بكل مشروع Golden CRM  
> **القاعدة:** الزبون هو نفسه — الشكل بس هو يلي بيتغيّر حسب السياق

---

## المستوى الأول: Mini Snapshot (للقوائم والجداول)

### التعريف

لقطة مصغّرة بتظهر بالقوائم والجداول. الهدف: الفني أو الموظف يعرف **مين الزبون** وبأي **منطقة** وبينقر عليه إذا بدّو يفوت للتفاصيل.

**القاعدة الأساسية:**
- ما في عنوان تفصيلي (`detailed_address`) بالمستوى الأول — نهائياً
- العنوان = آخر مستويين متتالين من `geo_units`
- الناحية (subArea / level 3) **زامنية** — لازم تكون موجودة وقت إضافة الزبون
- الحي (neighborhood / level 4) **اختياري** — إذا موجود بنعرضو، إذا مش موجود بنعرض المنطقة (district / level 2)

---

### الحقول (DB → UI)

| الحقل بالعربي | اسم الحقل بالكود | مصدره بالـ DB | نوع الـ DB | NULL? | كيف بنعرض؟ |
|---|---|---|---|---|---|
| الأفاتار | `avatar` | `clients.gender` + `clients.data_quality` | `VARCHAR` | ✅ | أيقونة دائرية بلون حسب `dataQuality` + أيقونة جنس |
| الاسم الكامل | `fullName` | `clients.first_name` + `clients.father_name` + `clients.last_name` | `VARCHAR` | ❌ | سطر واحد bold |
| التصنيف | `classification` | `clients.classification` | `VARCHAR(50)` | ✅ | **badge جانب الاسم** — LEAD أو OP أو FOP |
| رقم الموبايل الرئيسي | `primaryMobile` | `clients.mobile` | `VARCHAR(50)` | ❌ | Western numerals فقط، 10 خانات منظّفة |
| العنوان المختصر | `addressShort` | `geo_units` (آخر مستويين متتالين) | `VARCHAR` | ❌ | `subArea.name + " — " + neighborhood.name` أو `district.name + " — " + subArea.name` إذا ما في neighborhood |
| المسؤول عن الزبون | `ownershipDisplay` | `client_assignments` JOIN `hr_users` | `VARCHAR` | ✅ | اسم أول مسؤول + "+N" إذا في أكتر |

---

### العنوان المختصر (`addressShort`) — كيف بيتبنى من الكود

**الخطوة 1:** نجيب IDs من `clients`:
```sql
SELECT 
  c.neighborhood,   -- VARCHAR, مثلاً "123" (level 4 — اختياري)
  c.district,       -- VARCHAR, مثلاً "12"  (level 2)
  c.governorate     -- VARCHAR, مثلاً "1"   (level 1)
FROM clients c
```

**الخطوة 2:** نعمل lookup بـ `geo_units`:
```typescript
const geoMap = new Map<number, { name: string; level: number; parentId: number | null }>();
// نعبّي من: SELECT id, name, level, parent_id FROM geo_units WHERE id = ANY([neighborhoodId, districtId, governorateId])
```

**الخطوة 3:** نحدّد آخر مستويين متتالين:
```typescript
function buildAddressShort(
  neighborhoodId: number | null,
  districtId: number | null,
  geoMap: Map<number, GeoUnit>
): string {
  const neighborhood = neighborhoodId ? geoMap.get(neighborhoodId) : null;
  
  if (neighborhood) {
    // الحي موجود → الناحية هي الـ parent تبع الحي
    const subArea = neighborhood.parentId ? geoMap.get(neighborhood.parentId) : null;
    if (subArea) {
      return `${subArea.name} — ${neighborhood.name}`;
    }
    return neighborhood.name;
  }
  
  // ما في حي → نعرض المنطقة + الناحية (district + subArea)
  const district = districtId ? geoMap.get(districtId) : null;
  if (district) {
    // نبحث عن أول child level=3 تابع للـ district
    const subArea = findFirstChildOfParent(districtId, 3, geoMap);
    if (subArea) {
      return `${district.name} — ${subArea.name}`;
    }
    return district.name;
  }
  
  return '';
}
```

**ملاحظة:** الناحية (subArea / level 3) **زامنية** — ما بيصير زبون بدون ناحية بالنظام. الحي (neighborhood / level 4) اختياري.

---

### المسؤول عن الزبون (`ownershipDisplay`) — كيف بيتبنى من الكود

**من `client_assignments` + `hr_users`:**
```sql
SELECT 
  u.name AS "ownerName",
  COUNT(*) OVER() AS "totalOwners"
FROM client_assignments ca
JOIN hr_users u ON u.id = ca.hr_user_id
WHERE ca.client_id = $1
  AND u.is_active = TRUE
  AND u.employee_id IS NOT NULL
ORDER BY ca.assigned_at ASC
LIMIT 1
```

**العرض:**
```
"أحمد علي"           → إذا مسؤول واحد
"أحمد علي +2"        → إذا في 3 مسؤولين (الأول +2 تانيين)
"فرع دمشق"           → إذا ملكية الفرع (ما في assignees) — اسم الفرع
"—"                  → إذا ما في فرع ولا مسؤولين (نادر)
```

---

### قواعد الأفاتار (`avatar`):

**المكوّن:** `ClientAvatar.tsx` — دائري، لون خلفية حسب `dataQuality`، أيقونة داخلية حسب `gender`.

**الأيقونة الداخلية حسب الجنس:**
| الجنس | الأيقونة |
|-------|----------|
| `female` | أيقونة بنت بـ hijab 👩 |
| `male` أو `null` | أيقونة شاب بـ collar 👨 |

**لون الخلفية حسب `dataQuality`:**
| قيمة الـ DB (`data_quality`) | لون الخلفية | المعنى |
|------------------------------|-------------|--------|
| `Complete` | 🟢 أخضر (`bg-emerald-100`) | البيانات كاملة |
| `Partial` | 🟡 أصفر (`bg-amber-100`) | البيانات ناقصة |
| `Minimal` | 🔴 أحمر (`bg-red-100`) | البيانات بحد أدنى |
| `null` أو أي قيمة تانية | ⚪ رمادي (`bg-slate-100`) | غير محدد |

**الحجم:** `size="sm"` (w-9 h-9) بالمستوى الأول — صغير لحتى يبين بالقوائم.

---

### قواعد الموبايل (`primaryMobile`):

- `clients.mobile` مخزّن بـ `VARCHAR(50)` — دايماً منظّف لـ 10 خانات سورية
- Western numerals فقط — `0991234567`
- ما بيظهر بشكل `0944 123 456` ولا `+963 991 234 567` بالمستوى الأول
- لوحة المفاتيح العربية ما بتتدخل — الرقم يلي بيجي من الـ DB هو يلي بنعرضو

---

### 🎨 مثال واضح (Visual Example):

**البيانات من الـ DB:**
```json
{
  "first_name": "أحمد",
  "father_name": "محمد",
  "last_name": "علي",
  "mobile": "0991234567",
  "neighborhood": "123",
  "district": "12",
  "governorate": "1"
}
```

** lookup بـ geo_units:**
| id | name | level |
|---|---|---|
| 1 | دمشق | 1 |
| 12 | المزة | 2 |
| 122 | فيلات غربية | 3 |
| 123 | بناية 5 | 4 |

**كيف بيظهر بالـ UI (Mini Snapshot):**
```
┌─────────────────────────────────────────────┐
│  [👩]  أحمد محمد علي  [OP]                  │  ← avatar + bold + badge التصنيف
│  0991234567  ·  فيلات غربية — بناية 5       │  ← grey
│  أحمد علي +1                                │  ← grey أخف، ownershipDisplay
└─────────────────────────────────────────────┘
```

**إذا ما في `neighborhood` (مثلاً زبون بمنطقة ريفية):**
```
┌─────────────────────────────────────────────┐
│  [👨]  خالد عمر حسن                          │
│  0987654321  ·  المزة — فيلات غربية         │  ← district + subArea
│  خالد عمر                                   │
└─────────────────────────────────────────────┘
```

**إذا الزبون ملكية الفرع (ما في assignees):**
```
┌─────────────────────────────────────────────┐
│  [👨]  سامي فهد محمود                        │
│  0955112233  ·  الحسكة — مركز المدينة       │
│  فرع دمشق                                   │  ← ملكية فرع
└─────────────────────────────────────────────┘
```

---

### 📋 السياقات يلي بيستخدم المستوى الأول

| # | السياق / الكيان | الملف بالكود | الحالة | ملاحظات |
|---|----------------|-------------|--------|---------|
| 1 | Route Assignments (توزيع المسارات) | `routes/routeAssignments.ts` | ⏳ غير مطبّق | لساتها ما فيها client snapshot |
| 2 | Schedule Pool (جداول الفنيين) | `routes/schedules.ts` | ⏳ غير مطبّق | بتعرض employees مش clients |
| 3 | Task Lists — summary view (قوائم المهام المختصرة) | `routes/openTasks.ts` — GET / | ⚠️ **مطبّق جزئياً** | بترجّع `clientName` + `clientMobile` + `clientNeighborhood` (ID ناصي!) — بس ما في `addressShort` ولا `ownershipDisplay` |
| 4 | Name Collections (جمع الأسماء بالزيارة) | `routes/fieldVisits.ts` | ⏳ غير مطبّق | بتعرض `client_name` بس من `field_visits` — flat text |
| 5 | Telemarketing Lists (قوائم التسويق) | `routes/telemarketing.ts` | ⏳ غير مطبّق | `itemMobile` + `customerName` — flat fields مش موحّدة |

---

### ⚠️ الفجوات الحالية (Mini Snapshot مش موحّد)

| # | الفجوة | السياق المتأثر | الوضع الحالي | المطلوب |
|---|--------|---------------|-------------|---------|
| 1 | `clientNeighborhood` بيرجّع ID ناصي (مثلاً `"123"`) — مش name | `openTasks.ts` | بيعرض رقم مش اسم | `addressShort` يحلّل ID → name |
| 2 | `field_visits` بتخزّن `client_name` كـ flat text — مش من `clients` | `fieldVisits.ts` | اسم قديم إذا تغيّر الزبون | نرجّع من `clients` مباشرة |
| 3 | `telemarketing` بيستخدم `customer_name` + `customer_mobile` flat | `telemarketing.ts` | ما في ربط حقيقي بالزبون | نستخدم `MiniClientSnapshot` |
| 4 | ما في `ownershipDisplay` بأي سياق | الكل | ما بنعرف مين المسؤول | نضيف حقل المسؤول |
| 5 | العنوان المختصر مختلف بكل سياق | الكل | مش توحيد | نطبّق `addressShort` قاعدة موحّدة |

---

## المستوى الثاني: Standard Snapshot (للمهام والزيارات)

> **هاد "لب المشروع" — أهم مستوى. بيظهر بصفحة الزيارة (VDP)، تفاصيل المهمة، الطارئ، الموعد، ورأس الزيارة.**

### التعريف

لقطة قياسية بتظهر بالسياقات يلي بدهن **تفاصيل كاملة للزبون** مش بس اسم ورقم. الهدف: الفني أو الموظف يعرف كل شي عن الزبون قبل ما يوصل لعندو.

**الفرق عن المستوى الأول:**
- الاسم بيتفكّك لـ 3 أجزاء (first + father + last) مش بس fullName
- التصنيف (`classification`) موجود بالمستويين — بس بالأول بس badge، بالثاني بس badge أيضاً
- العنوان كامل (4 مستويات + تفصيلي + خريطة)
- المهنة + مهنة الزوج/ة دائماً تظهر
- التقييم (`committed`) **جديد بالمستوى الثاني فقط** — وشريطة `classification === 'OP'`
- الوسطاء: عدد فقط (لا زر إضافة)
- قائمة التواصل كاملة
- الملاحظات
- المسؤول/ين

---

### الحقول (DB → UI)

#### أ) الهوية الكاملة

| الحقل بالعربي | اسم الحقل بالكود | مصدره بالـ DB | نوع الـ DB | NULL? | قاعدة العرض |
|---|---|---|---|---|---|
| الأفاتار | `avatar` | `clients.gender` + `clients.data_quality` | `VARCHAR` | ✅ | دائري بلون `dataQuality` + أيقونة جنس |
| الاسم الأول | `firstName` | `clients.first_name` | `VARCHAR(255)` | ❌ | سطر أول bold |
| اسم الأب | `fatherName` | `clients.father_name` | `VARCHAR(255)` | ✅ | يلحق firstName |
| الكنية | `lastName` | `clients.last_name` | `VARCHAR(255)` | ❌ | يلحق fatherName |
| اللقب | `nickname` | `clients.nickname` | `VARCHAR(255)` | ✅ | بين قوسين بعد الاسم الكامل |
| التصنيف | `classification` | `clients.classification` | `VARCHAR(50)` | ✅ | **badge جانب الاسم** — LEAD أو OP أو FOP |

**الاسم الكامل:**
```
firstName + " " + fatherName + " " + lastName
```
إذا `fatherName` فاضي:
```
firstName + " " + lastName
```
إذا `nickname` موجود:
```
"أحمد محمد علي (أبو شهاب)"
```

**التصنيف (`classification`) — كيف بيظهر:**
- بيظهر كـ **badge صغير** (pill/chip) جانب الاسم، مش سطر منفصل
- إذا `classification = "LEAD"`: badge رمادي ⚪ "LEAD"
- إذا `classification = "OP"`: badge أزرق 🔵 "OP"
- إذا `classification = "FOP"`: badge أخضر 🟢 "FOP"
- إذا `classification` فاضي: **ما بنعرض شي** — ما في badge فارغ

**مثال بالـ UI:**
```
[👩]  أحمد محمد علي (أبو شهاب)  [OP]          ← avatar + الاسم bold + badge التصنيف
```

---

#### ب) التواصل (Contacts)

| الحقل بالعربي | اسم الحقل بالكود | مصدره بالـ DB | نوع الـ DB | NULL? | قاعدة العرض |
|---|---|---|---|---|---|
| الموبايل الرئيسي | `primaryMobile` | `clients.mobile` | `VARCHAR(50)` | ❌ | أول سطر، bold، Western numerals |
| قائمة التواصل | `contacts` | `clients.contacts` | `JSONB` | ✅ | array من `ContactEntry` |

**هيكل `ContactEntry` (من `clients.contacts` JSONB):**

| الخاصية | النوع | وصف |
|---|---|---|
| `id` | `STRING` | معرّف فريد للرابط (UUID) |
| `label` | `STRING` | وصف الرقم: `"موبايل"`, `"بيت"`, `"واتساب"`, `"عمل"` |
| `number` | `STRING` | الرقم نفسه، 10 خانات منظّفة |
| `isPrimary` | `BOOLEAN` | هل هو الرقم الرئيسي؟ (دايماً FALSE للـ contacts الإضافية) |
| `hasWhatsApp` | `BOOLEAN` | هل الرقم عليه واتساب؟ |
| `status` | `STRING` | `"active"` أو `"inactive"` |

**مثال من الـ DB:**
```json
[
  {
    "id": "contact-001",
    "label": "بيت",
    "number": "0112223334",
    "isPrimary": false,
    "hasWhatsApp": false,
    "status": "active"
  },
  {
    "id": "contact-002",
    "label": "واتساب",
    "number": "0991234568",
    "isPrimary": false,
    "hasWhatsApp": true,
    "status": "active"
  }
]
```

**قواعد العرض:**

1. **الموبايل الرئيسي** (`clients.mobile`) بيظهر أول شي — **bold**، سطر منفصل:
   ```
   📞 0991234567
   ```

2. **كل contact إضافي** بيظهر بسطر منفصل، مرتّبين حسب `status` (active قدّام) ثم `label`:
   ```
   🏠 بيت: 0112223334
   💬 واتساب: 0991234568
   ```

3. **الـ label بيحدّد الأيقونة:**
   - `"موبايل"` → 📱
   - `"بيت"` → 🏠
   - `"واتساب"` → 💬
   - `"عمل"` → 💼
   - أي label تاني → 📞

4. **الرقم** بيظهر Western numerals فقط، 10 خانات منظّفة

5. **إذا `hasWhatsApp = true`:** نضيف أيقونة واتساب 💬 جنب الرقم

6. **إذا `status = "inactive"`:** الرقم بيظهر grey-out أو بـ strikethrough (مش strike-through كامل، بس grey)

7. **إذا ما في contacts إضافية** (array فاضي): ما بنعرض شي تاني تحت الموبايل الرئيسي

**مثال كامل:**
```
📞 0991234567                        ← primaryMobile bold
🏠 بيت: 0112223334                   ← contact[0]
💬 واتساب: 0991234568                 ← contact[1] (hasWhatsApp)
💼 عمل: 0987654321 (غير نشط)         ← contact[2] (inactive)
```

**إذا contacts فاضية:**
```
📞 0991234567                        ← بس الرئيسي
```

---

#### ج) العنوان الكامل (Address)

| الحقل بالعربي | اسم الحقل بالكود | مصدره بالـ DB | نوع الـ DB | NULL? | قاعدة العرض |
|---|---|---|---|---|---|
| المحافظة | `address.governorate` | `geo_units.name` (FK من `clients.governorate`) | `VARCHAR` | ✅ | مستوى 1 |
| المنطقة | `address.district` | `geo_units.name` (FK من `clients.district`) | `VARCHAR` | ✅ | مستوى 2 |
| الناحية | `address.subArea` | `geo_units.name` (FK من `clients.neighborhood` → parent level 3) | `VARCHAR` | ❌ | مستوى 3 — **زامني** |
| الحي | `address.neighborhood` | `geo_units.name` (FK من `clients.neighborhood` → level 4) | `VARCHAR` | ✅ | مستوى 4 — اختياري |
| العنوان التفصيلي | `address.detailedAddress` | `clients.detailed_address` | `TEXT` | ✅ | سطر منفصل تحت الـ geo |
| GPS | `address.gps` | `clients.gps_coordinates` | `JSONB` | ✅ | `{"lat": 33.51, "lng": 36.27}` |
| خريطة | `address.mapUrl` | مولد من `gps` | `STRING` | ✅ | رابط Google Maps أو OpenStreetMap |

**الترتيب الإلزامي للعنوان:**
```
المحافظة → المنطقة → الناحية → الحي
```

**ملاحظات:**
- الناحية (subArea / level 3) **زامنية** — لازم تكون موجودة
- الحي (neighborhood / level 4) **اختياري** — إذا مش موجود ما بنترك فراغ، بنكمل للناحية
- العنوان التفصيلي بيظهر **تحت** الـ geo hierarchy، مش وسطو
- **لا `detailedAddress` داخل سطر العنوان المختصر** — هاد خطأ قديم تم إصلاحو

**مثال:**
```
دمشق → المزة → فيلات غربية → بناية 5
فيلات غربية، بناية 5، طابق 2، شقة 4
[Map pin]
```

---

#### د) المعلومات الشخصية (Personal Info)

| الحقل بالعربي | اسم الحقل بالكود | مصدره بالـ DB | نوع الـ DB | NULL? | قاعدة العرض |
|---|---|---|---|---|---|
| المهنة | `occupation` | `clients.occupation` | `VARCHAR(255)` | ✅ | **دائماً تظهر** — "غير محدد" إذا فاضي |
| مهنة الزوج/ة | `spouseOccupation` | `clients.spouse_occupation` | `VARCHAR(255)` | ✅ | **دائماً تظهر** — "غير محدد" إذا فاضي |
| مصدر المياه | `waterSource` | `clients.water_source` | `VARCHAR(255)` | ✅ | ما بتظهر بـ appointment section |
| التقييم | `committed` | `clients.committed` | `VARCHAR(50)` | ✅ | **يظهر فقط إذا `classification === 'OP'`** — "ملتزم" أو "غير ملتزم" |

**قاعدة ذهبية:**
> المهنة (`occupation`) + مهنة الزوج/ة (`spouseOccupation`) **دائماً بتظهر**. إذا فاضية بالـ DB، العرض بيكون `"غير محدد"`. **ما بنخبّي الحقول الفاضية.**

**قاعدة التقييم:**
> حقل التقييم (`committed`) **يظهر فقط** في المستوى الثاني، **وشريطة** يكون تصنيف الزبون (`classification`) = `OP`. القيم: `"ملتزم"` أو `"غير ملتزم"`. إذا `classification !== 'OP'`، هالحقل ماخفي بالكامل.

**ملاحظة `waterSource`:**
- `waterSource` **ما بتظهر** بـ ClientInfoCard تبع appointment section
- بتظهر بس بـ Standard Snapshot العام (إذا لساتها موجودة بالـ DB)

---

#### ه) الوسطاء (Referrers)

| الحقل بالعربي | اسم الحقل بالكود | مصدره بالـ DB | نوع الـ DB | NULL? | قاعدة العرض |
|---|---|---|---|---|---|
| قائمة الوسطاء | `referrers` | `clients.referrers` | `JSONB` | ✅ | array من `{type, id, name}` |
| عدد الوسطاء | `referrersCount` | `clients.referrers.length` | `INTEGER` | ✅ | عدد الوسطاء فقط |

**قواعد الوسطاء:**
- **لا progress bars** — بس عدد
- **لا زر إضافة** — هاد view مش form
- إذا `referrers` فاضية: نص `"لا يوجد وسطاء مسجّلين"`
- إذا في وسطاء: `"2 وسطاء"`

**مثال:**
```
الوسطاء: 2 وسطاء
```

**إذا فاضية:**
```
الوسطاء: لا يوجد وسطاء مسجّلين
```

---

#### و) الملاحظات (Notes)

| الحقل بالعربي | اسم الحقل بالكود | مصدره بالـ DB | نوع الـ DB | NULL? | قاعدة العرض |
|---|---|---|---|---|---|
| ملاحظات | `notes` | `clients.notes` | `TEXT` | ✅ | textarea أو expandable section |

---

#### ز) المسؤول/ين (Ownership)

| الحقل بالعربي | اسم الحقل بالكود | مصدره بالـ DB | نوع الـ DB | NULL? | قاعدة العرض |
|---|---|---|---|---|---|
| المسؤول/ين | `assignments` | `client_assignments` JOIN `hr_users` + `roles` | `JSON Array` | ✅ | list من `{userId, userName, roleDisplayName}` |
| ملكية الفرع | `branchOwnership` | `clients.branch_id` JOIN `branches` | `OBJECT {id, name}` | ✅ | إذا ما في assignees |

**العرض:**
- إذا في assignees: list بأسماء المسؤولين + أدوارن
- إذا ملكية فرع: `"فرع دمشق"` (اسم الفرع)
- إذا mixed: نعرض المسؤول/ين + ملاحظة "فرع دمشق"

---

#### ح) Source Channel

| الحقل بالعربي | اسم الحقل بالكود | مصدره بالـ DB | نوع الـ DB | NULL? | قاعدة العرض |
|---|---|---|---|---|---|
| مصدر الزبون | `sourceChannel` | `clients.source_channel` | `VARCHAR(255)` | ✅ | badge صغير — "SocialMedia"، "PhoneCall"، إلخ |

---

### 🎨 مثال كامل (Standard Snapshot):

**البيانات من الـ DB:**
```json
{
  "first_name": "أحمد",
  "father_name": "محمد",
  "last_name": "علي",
  "nickname": "أبو شهاب",
  "mobile": "0991234567",
  "contacts": [
    {"label": "بيت", "number": "0112223334", "isPrimary": false, "status": "active"}
  ],
  "governorate": "1",
  "district": "12",
  "neighborhood": "123",
  "detailed_address": "فيلات غربية، بناية 5، طابق 2، شقة 4",
  "gps_coordinates": {"lat": 33.5138, "lng": 36.2765},
  "occupation": "مهندس برمجيات",
  "spouse_occupation": "طبيبة أطفال",
  "water_source": "شبكة مياه عامة",
  "classification": "OP",
  "committed": "ملتزم",
  "notes": "يفضل الاتصال بعد الظهر فقط",
  "referrers": [
    {"type": "Client", "id": 45, "name": "خالد عمر"},
    {"type": "Employee", "id": 12, "name": "سامي فهد"}
  ],
  "source_channel": "SocialMedia"
}
```

**كيف بيظهر بالـ UI (Standard Snapshot):**

```
┌─────────────────────────────────────────────────────────────┐
│  [👩]  أحمد محمد علي (أبو شهاب)  [OP]                     │  ← avatar + bold + badge التصنيف
├─────────────────────────────────────────────────────────────┤
│  📞 0991234567                                              │  ← primaryMobile bold
│  🏠 بيت: 0112223334                                          │  ← contact[0]
├─────────────────────────────────────────────────────────────┤
│  📍 دمشق → المزة → فيلات غربية → بناية 5                   │  ← geo hierarchy
│  فيلات غربية، بناية 5، طابق 2، شقة 4                        │  ← detailedAddress
│  [🗺️  خريطة]                                                │  ← map link من gps
├─────────────────────────────────────────────────────────────┤
│  💼 المهنة: مهندس برمجيات                                   │  ← occupation
│  💼 مهنة الزوج/ة: طبيبة أطفال                               │  ← spouseOccupation
│  التقييم: ملتزم                                              │  ← committed (لأن classification = OP)
├─────────────────────────────────────────────────────────────┤
│  الوسطاء: 2 وسطاء                                          │  ← referrersCount
├─────────────────────────────────────────────────────────────┤
│  📝 ملاحظات: يفضل الاتصال بعد الظهر فقط                     │  ← notes
├─────────────────────────────────────────────────────────────┤
│  المسؤول: أحمد علي — سوبرفايزر                             │  ← ownershipDisplay
│  المصدر: SocialMedia                                         │  ← sourceChannel badge
└─────────────────────────────────────────────────────────────┘
```

**إذا `classification = "LEAD"`:**
```
أحمد محمد علي (أبو شهاب)  [LEAD]            ← badge رمادي
```

**إذا `classification` فاضي:**
```
أحمد محمد علي (أبو شهاب)                    ← بس الاسم، ما في badge
```

**إذا `classification = "FOP"` (ما في حقل التقييم):**
```
💼 المهنة: مهندس برمجيات
💼 مهنة الزوج/ة: طبيبة أطفال
(ما في "التقييم" لأن FOP مش OP)          ← committed مخفي
```

**إذا `occupation` و `spouseOccupation` فاضيين:**
```
💼 المهنة: غير محدد
💼 مهنة الزوج/ة: غير محدد
```

**إذا `referrers` فاضية:**
```
الوسطاء: لا يوجد وسطاء مسجّلين
```

---

### 📋 السياقات يلي بيستخدم المستوى الثاني

| # | السياق / الكيان | الملف بالكود | الحالة | ملاحظات |
|---|----------------|-------------|--------|---------|
| 1 | **Visit Detail Page (VDP)** | `routes/fieldVisits.ts` + `packages/web` | ⚠️ **مطبّق جزئياً** | `customer_snapshot` موجود بس مش كل الحقول مطبّقة (مثلاً `spouseOccupation` مش متأكد) |
| 2 | **Open Task Detail** | `routes/openTasks.ts` — GET /:id | ✅ **مطبّق جزئياً** | `clientSnapshot` JSONB موجود بس `occupation` + `spouseOccupation` مش موجودين بـ `buildOpenTaskSnapshots()` |
| 3 | **Emergency Ticket Detail** | `routes/emergencyTickets.ts` + `emergencyResult.ts` | ⏳ **غير موحّد** | `client_name` + `client_address` flat text — **ما في snapshot JSONB** |
| 4 | **Appointment Card** | `routes/telemarketing.ts` | ⏳ **غير موحّد** | `customer_name` + `occupation` + `water_source` flat fields |
| 5 | **Field Visit Header** | `routes/fieldVisits.ts` | ⚠️ **مطبّق جزئياً** | `customer_snapshot` موجود بس بعض الحقول مش متطابقة مع VDP |

---

### ⚠️ الفجوات الحالية (Standard Snapshot مش موحّد)

| # | الفجوة | السياق المتأثر | الوضع الحالي | المطلوب |
|---|--------|---------------|-------------|---------|
| 1 | `buildOpenTaskSnapshots()` ما بيضيف `occupation` + `spouseOccupation` | `openTasks.ts` | snapshot ناقص | نضيف الحقول لـ `clientSnapshot` |
| 2 | `emergency_tickets` ما عندها `client_snapshot` JSONB | `emergencyTickets.ts` | `client_name` + `client_address` flat | نضيف `client_snapshot` JSONB + backfill |
| 3 | `telemarketing_appointments` ما عندها `client_snapshot` | `telemarketing.ts` | `customer_name` + `occupation` + `water_source` flat | نضيف `client_id` + `client_snapshot` JSONB |
| 4 | `field_visits.customer_snapshot` مش متطابق مع VDP rules | `fieldVisits.ts` | بعض الحقول ناقصة أو مش متطابقة | نحدّث snapshot ليطابق VDP |
| 5 | `water_source` — هل تظهر ولا لا؟ | VDP | decision pending | `water_source` ما بتظهر بـ appointment section |
| 6 | `referrers` — count + button بس، لا progress bars | الكل | بعض الأماكن فيها progress bars قديمة | نحذف progress bars |

---

## المستوى الثالث: Full Snapshot (للصفحات التفصيلية)

> **ملاحظة:** رح نناقشو بعد المستوى التاني.

**الحقول الإضافية (فوق Standard):**
- الجنس (`gender`)
- الرقم الوطني (`nationalId`)
- تاريخ الميلاد (`birthDate`)
- اسم الأم (`motherName`)
- معلومات السجل المدني (`nationalIdRegistry`, `nationalIdIssuedBy`, `nationalIdIssueDate`, `nationalIdBox`)
- ملاحظات عامة (`notes`)
- Source channel (`sourceChannel`)
- تاريخ التسجيل + مسجّل من قبل مين (`createdAt`, `createdBy`)
- Referral sheet مربوطة (`referralSheetId`)

**السياقات:**
- Client Detail Page
- Contract Creation (review step)
- Referral Sheet Detail
