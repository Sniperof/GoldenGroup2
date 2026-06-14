# دستور الكيان: المناطق الجغرافية (Geo Units Domain Constitution)

> **الحالة (Status):** Active / Authoritative  
> **المرجع الأعلى للوحدات والتقسيمات الجغرافية، والتحقق الجغرافي من المسارات، وصلاحيات التغطية للفروع، وتنسيق تمديد العناوين الفني.**

---

## 1. هوية الكيان (Entity Identity)

- **الاسم العربي:** الوحدات الجغرافية / التقسيم الجغرافي الهيكلي
- **الاسم الإنجليزي:** Geo Units
- **اسم الجدول:** `geo_units`
- **الوصف:** الكيان التأسيسي والعمود الفقري لبنية العناوين الجغرافية في Golden CRM. يقوم الكيان بتمثيل المستويات الإدارية والجغرافية في الجمهورية العربية السورية في بنية هرمية تبدأ بالمحافظة (`level = 1`)، تليها المنطقة أو المدينة (`level = 2`)، ثم الحي أو الناحية (`level = 3`). يتم ربط كل وحدة تابعة بالمعرف الأب (`parent_id`) لتأمين تكامل الشجرة الجغرافية. تعتمد عليه كافة الجداول التشغيلية لتحديد التوزيع الميداني وصلاحيات الفرق.
- **الجداول المرتبطة:**
  1. `clients` (عبر حقول العناوين `governorate`, `district`, `neighborhood`).
  2. `candidates` (عبر حقل `geo_unit_id`).
  3. `branches` (عبر الحقل الجغرافي للفرع `location_geo_id` وقائمة التغطية `covered_geo_ids`).
  4. `installed_devices` / `contracts.draft_device_payload` (موقع تركيب الجهاز `installation_geo_unit_id` — يُخزَّن على `installed_devices` للعقود الفعّالة، وفي `draft_device_payload->>'installationGeoUnitId'` للمسودّات؛ **لا يوجد عمود `installation_geo_unit_id` على جدول `contracts` نفسه**). يُفرض أن يكون مستوى الحي (level 4) عند الحفظ.
  5. `employees` (عبر حقل السكن `residence`).
  6. `routes` & `route_points` (لتوجيه وجدولة مسارات الفرق جغرافياً).
  7. `task_type_config` (عبر حقل أساس المطابقة الجغرافي للمهام `location_basis`).
- **الأهمية والأمان:** يمثل الأساس الجوهري لفلترة وعزل البيانات جغرافياً بين الفروع (Branch Isolation). أي تلاعب في بذر الوحدات الجغرافية أو صلاحيات التغطية يكسر الحماية الأمنية للبيانات.

---

## 2. معجم الجداول والحقول (Table & Field Dictionary)

### 2.1 جدول الوحدات الجغرافية `geo_units`

يخزن الأسماء والمستويات الإدارية للتقسيمات في بنية هرمية متكاملة.

| الحقل (Field) | النوع (SQL Type) | NULL? | DEFAULT | Constraints | الوصف والشرح بالعربية | مثال واقعي (Example) |
|---|---|---|---|---|---|---|
| `id` | `INTEGER` | ❌ | `nextval()` | `PRIMARY KEY` | المعرف الفريد للتقسيم الجغرافي | `12` (المزة) |
| `name` | `VARCHAR(255)` | ❌ | — | — | الاسم الجغرافي للتقسيم | `"المزة"` |
| `level` | `INTEGER` | ❌ | — | `CHECK (level IN (1,2,3,4))` | المستوى الهرمي الإداري (1→4) | `2` (منطقة/مدينة) |
| `parent_id` | `INTEGER` | ✅ | — | `FK → geo_units(id) ON DELETE RESTRICT` | معرف التقسيم الأب الأعلى التابع له | `1` (معرف محافظة دمشق) |
| `status` | `VARCHAR(10)` | ❌ | `'active'` | `CHECK (status IN ('active','inactive'))` | حالة الوحدة — inactive يخفيها من selectors العناوين | `'active'` |

---

### 2.2 فريد فهرس التكامل الثنائي (Unique Index Constraint)

لتفادي تكرار إدخال مناطق أو أحياء بنفس الاسم والمستوى الإداري تحت نفس الأب الجغرافي، يفرض النظام بقاعدة البيانات Index فريداً وصارماً (انظر `053_geo_units_unique_constraint.sql`):
```sql
CREATE UNIQUE INDEX IF NOT EXISTS geo_units_name_level_parent_unique
  ON geo_units (LOWER(name), level, COALESCE(parent_id, 0));
```
*ملاحظة تقنية:* يتم استخدام دالة `COALESCE` لمعالجة القيم الفارغة (`NULL`) في حقل `parent_id` للمحافظات (`level = 1`) حيث تُستبدل بالرقم `0` في الفهرس، كما يُطبق الفحص بحروف صغيرة `LOWER` لضمان عدم الحساسية التامة لحالة الأحرف.

---

### 2.3 بذرة البيانات الجغرافية السورية المعتمدة (Syrian Geo Data)

يقوم النظام ببذر وحقن البيانات الجغرافية الحقيقية للمحافظات والمناطق والأحياء في سوريا (انظر هجرة بذر البيانات `061_syrian_geo_data.sql`):
- **المستوى الأول (Level 1 - المحافظات):** تشمل المحافظات الرئيسية بالداتابيز: `1` (دمشق)، `2` (حلب)، `9` (اللاذقية)، `10` (حمص)، `11` (طرطوس).
- **المستوى الثاني (Level 2 - المناطق والمراكز):** مثل `مزة`, `دوما`, `جرمانا` بمحافظة دمشق، و`الشهباء`, `أعزاز` بمحافظة حلب، و`الواعر`, `القصير` بمحافظة حمص.
- **المستوى الثالث (Level 3 - الأحياء والنواحي):** مثل `مزة القديمة` و`فيلات غربية` التابعة للمزة، و`الحميدية` و`الصالحية` التابعة لدمشق القديمة.

---

## 3. القيود والقواعد التشغيلية (Database Constraints & Business Rules)

### BR-1: الهيكلية الرباعية والتسلسل الإداري (Hierarchy Levels)
يدعم النظام بنية **رباعية المستويات** (وُثّقت خطأً ثلاثية سابقاً — تصحيح 2026-05-24):
- **المستوى الأول (`level = 1`):** المحافظة (Governorate). لا يملك أب جغرافي (`parent_id IS NULL`). مثال: `دمشق`.
- **المستوى الثاني (`level = 2`):** المنطقة أو المدينة (District/City). يتبع لمحافظة. مثال: `دمشق القديمة`.
- **المستوى الثالث (`level = 3`):** الناحية أو الحي الكبير (Sub-district). يتبع لمنطقة. مثال: `الحميدية`.
- **المستوى الرابع (`level = 4`):** الحي الدقيق أو القرية (Neighborhood/Village). يتبع لناحية. مثال: `باب شرقي`.

**القيد المُطبَّق بالـ DB (migration 168):** `CHECK (level IN (1, 2, 3, 4))`
**قاعدة الهرمية (مُطبَّقة بالـ API):** `parent.level = child.level - 1` — المحافظة لا تقبل أباً، وأي مستوى آخر يجب أن يشير لأب من المستوى الأدنى مباشرةً.

### BR-2: قيود الفلترة الجغرافية والصلاحيات (Geo Scope Filtering)
يتم فلترة وحماية عرض البيانات الجغرافية للفرع ديناميكياً بواسطة خوارزمية ذكية بالخادم (انظر `geoScopeService.ts`):
- **نطاق الوصول العام (`GLOBAL`):** يستعلم ويستعرض كافة الوحدات الجغرافية بلا قيود.
- **نطاق الفرع (`BRANCH`):** يرى فقط الوحدات الجغرافية التابعة لنطاق تغطية الفرع المعتمد:
  1. يقوم النظام بقراءة جدول `branch_geo_coverage` (junction table — migration 169) لتحديد الوحدات المغطاة للفرع.
  2. في حال لم تُسجَّل تغطية، يتم الاعتماد تلقائياً على عنوان مركز الفرع `branches.location_geo_id` كمرجع أساسي وحيد.
  3. يتم بناء قائمة `serviceGeoIds` التي تشتمل على كافة الوحدات المغطاة وأبناءها وأبناء أبنائها بشكل تكراري للتشغيل الميداني.
  4. يتم بناء قائمة `visibleGeoIds` التي تضيف كافة الآباء والأجداد الجغرافيين لتسهيل العرض والملاحة الهرمية بالواجهة الرسومية للفرع.

### BR-3: تركيب ومطابقة المهام جغرافياً (Task Geographic Matching - location_basis)
لتوزيع المهام الميدانية بكفاءة على الفروع، يقوم النظام بالمطابقة الجغرافية بناءً على إعدادات نوع المهمة `task_type_config.location_basis` (انظر هجرة `113`):
- **أساس العميل (`client`):** يتم ربط ومطابقة المهمة جغرافياً وفق الحي السكني للزبون (`clients.neighborhood`). يُستخدم للمهام الشخصية مثل عروض المبيعات (`device_demo`) والهدايا وتشييك العميل الجاري.
- **أساس العقد (`contract`):** يتم ربط ومطابقة المهمة جغرافياً وفق العنوان الجغرافي المعتمد والموثق فعلياً لتركيب الفلتر بـ `contracts.installation_geo_unit_id`. يُستخدم لجميع صيانات الأجهزة والتركيبات والتسليم وتحصيل الأقساط المادية المترتبة على العقد المبرم.

### BR-4: صياغة ودمج وتوصيف العنوان (Address Assembly)
يتم تركيب العنوان النصي الكامل للعملاء والفرق برمجياً عبر دمج أسماء الوحدات الجغرافية الموثقة:
$$\text{Full Address} = \text{Governorate Name} \rightarrow \text{District Name} \rightarrow \text{Neighborhood Name} \rightarrow \text{Detailed Physical Address}$$
- **مثال واقعي:** `"حمص، القصير، حي البلدية، بناية النور ط2"`

### BR-5: قاعدة حالة الوحدة الجغرافية (Geo Unit Status)
- **`active`:** الوحدة متاحة للاختيار في جميع selectors (عناوين الزبائن، تغطية الفروع، عناوين العقود).
- **`inactive`:** الوحدة معطّلة — تظهر في إدارة المستويات للـ admin فقط، ولا تظهر في selectors العناوين للمستخدمين.
- **التأثير الحالي (2026-05-24):** التبديل يغيّر الحالة للوحدة المحددة فقط — الأبناء لا يتأثرون آلياً. البيانات التاريخية (زبائن/زيارات/عقود مرتبطة بالوحدة) لا تُحذف ولا تُخفى.
- **🔴 مؤجل — GAP-062:** التأثير الكامل للـ `inactive` (cascade للأبناء، استبعاد من نطاق الفرع، منع التسجيل، إلغاء المهام) موثّق ومؤجل حتى يكتمل audit جميع المتأثرين عبر الوحدات. (انظر [GAP-062](../../GAPS-TRACKER.md#gap-062))

---

## 4. العلاقات الهيكلية (Entity Relationships)

```mermaid
erDiagram
    geo_units ||--o{ geo_units : "parent_id (hierarchy)"
    geo_units ||--o{ clients : "as governorate (INTEGER FK)"
    geo_units ||--o{ clients : "as district (INTEGER FK)"
    geo_units ||--o{ clients : "as neighborhood (INTEGER FK)"
    geo_units ||--o{ branches : "branch location (location_geo_id)"
    geo_units ||--o{ contracts : "installation location (installation_geo_unit_id)"
    geo_units ||--o{ candidates : "candidate residence (geo_unit_id)"
```

---

## 5. قواعد الحذف والنزاهة المرجعية (Deletion & Integrity Rules)

```
[حذف وحدة جغرافية — DELETE /api/geo-units/:id]
        │
        ├─► يوجد أبناء؟ ──► ON DELETE RESTRICT ──► 409 "احذف الأبناء أولاً"
        │
        └─► لا أبناء ──► حذف الوحدة بنجاح (200)
                │
                ├─► branch_geo_coverage: ON DELETE CASCADE → تُحذف تغطية الفروع تلقائياً ✅
                └─► clients.governorate/district/neighborhood: ON DELETE SET NULL → تُصفَّر تلقائياً ✅
```

- **RESTRICT على `parent_id` (migration 168):** لا يمكن حذف وحدة لها أبناء — يجب حذف الأبناء أولاً من الأسفل للأعلى (حي → ناحية → منطقة → محافظة).
- **CASCADE على `branch_geo_coverage`:** حذف أي وحدة جغرافية يُنظّف تغطية الفروع المرتبطة أوتوماتيكياً — عزل الفروع لا يكسر بعد الآن.
- **SET NULL على `clients`:** حذف وحدة جغرافية يضع `NULL` في حقول عناوين الزبائن المرتبطة (governorate/district/neighborhood) بدلاً من كسر القيد — بيانات العميل تبقى سليمة.

---

## 6. صلاحيات الوصول (Permission Matrix)

شجرة المستويات الإدارية تفصل بين **تعبئة العنوان داخل النماذج** (lookup روتيني)، و**فتح صفحة إدارة المستويات** (عرض إداري)، و**تعديل البنية الوطنية** (إدارة). المستويات الإدارية بنية وطنية مركزية شبيهة بـ `system_lists`: التعديل قرار مركزي (HQ) بنطاق `GLOBAL` فقط، بينما يحصل الفرع على قراءة مفلترة بتغطيته دون أي حق تعديل. (هجرة `279_geo_units_permission_tree.sql`.)

| الصلاحية المطلوبة | مفتاح الأمان (Permission Key) | النوع | النطاق المسموح (Scope) | الوصف والشرح بالعربية |
|---|---|---|---|---|
| قراءة العناوين داخل الحقول | `geo_units.lookup` | Lookup | `GLOBAL`, `BRANCH`, `ASSIGNED` | قراءة الوحدات النشطة كخيارات عناوين داخل نماذج الزبائن والعقود والمهام، مفلترة بتغطية الفرع. لا تفتح صفحة الإدارة ولا تمنح تعديلاً. |
| عرض المستويات الإدارية | `geo.view` | Admin View | `GLOBAL`, `BRANCH` | فتح صفحة إدارة المستويات وقراءة الوحدات (بما فيها `inactive`) ضمن النطاق. مدير الفرع يرى تغطية فرعه فقط. |
| إدارة المستويات الإدارية | `geo.manage` | Admin Manage | `GLOBAL` فقط | إنشاء/تعديل/حذف/تغيير حالة وحدة جغرافية. حكر على المقر؛ لا يملك أي فرع تعديل الشجرة الوطنية. |

#### 6.1 قواعد المستويات الإدارية والعناوين

- **تعبئة العنوان تستخدم `geo_units.lookup` لا `geo.view`.** أي حقل عنوان (زبون/عقد/مهمة) يقرأ الوحدات عبر lookup مفلتر بالتغطية، فلا يحتاج موظف ميداني صلاحية فتح صفحة الإدارة لتعبئة عنوان.
- **القيم القابلة للاختيار = `active` فقط.** يستبعد مكوّن الاختيار (`GeoSmartSearch`) الوحدات المعطّلة من الخيارات، مع إبقائها لعرض مسار السجلات التاريخية التي قد تشير لوحدة معطّلة.
- **العرض على مستوى الفرع مفلتر بالتغطية.** `geo.view`/`geo_units.lookup` بنطاق `BRANCH` يريان فقط `visibleGeoIds` = الوحدات المغطّاة + أبناؤها + سلسلة آبائها (للملاحة الهرمية). لا تظهر أي منطقة شقيقة خارج التغطية. الجلب الفردي `GET /:id` يطبّق نفس الفلترة (يعيد `404` لوحدة خارج النطاق).
- **التعديل GLOBAL فقط ويُفرض على كل handler.** `POST/PUT/PATCH/DELETE` محمية بـ `geo.manage`، والنطاق المسموح `GLOBAL` وحده يمنع أي منحة فرعية. أي محاولة منح `geo.manage` بنطاق `BRANCH`/`ASSIGNED` تُرفض عند الحفظ.
- **الكتابة على الخادم تعيد التحقق دائماً.** أي مسار يحفظ `geo_unit_id` داخل عنوان (زبون/عقد/جهاز مركّب) يستدعي `assertGeoUnitInScope` ليرفض أي عنوان خارج تغطية الفرع المالك للسجل. فلترة الواجهة ليست حماية أمنية.
- **قيد دقّة المستوى حسب العملية.** قد تفرض عملية حدّاً أدنى لمستوى العنوان: عنوان تركيب العقد يجب أن يكون **مستوى الحي (level 4)** — يُفرض في المنتقي (`minSelectableLevel`) وعلى الخادم معاً (`400 installation_geo_not_neighborhood`). هذا تطبيق لنمط [الحقول التشغيلية المقيّدة بالنطاق](permissions-engineering-standard.md#51-نمط-الحقول-التشغيلية-المقيّدة-بالنطاق-scoped-operational-fields).

---

## 7. عقد API (API Contract)

### 7.1 قائمة endpoints المتاحة

| الطريقة | المسار | الصلاحية | وصف |
|---|---|---|---|
| `GET` | `/api/geo-units` | `geo.view` أو `geo_units.lookup` | قائمة كل الوحدات مفلترة حسب scope الفرع |
| `GET` | `/api/geo-units/active` | `geo.view` أو `geo_units.lookup` | قائمة الوحدات النشطة فقط (للاستخدام في selectors العناوين) |
| `GET` | `/api/geo-units/reference` | `geo.view` أو `geo_units.lookup` | قائمة مرجعية للعناوين مفلترة حسب scope الفرع |
| `GET` | `/api/geo-units/:id` | `geo.view` أو `geo_units.lookup` | تفاصيل وحدة فردية — مفلترة بالنطاق (`404` خارج التغطية) |
| `POST` | `/api/geo-units` | `geo.manage` (GLOBAL) | إنشاء وحدة جديدة مع تحقق هرمي |
| `PUT` | `/api/geo-units/:id` | `geo.manage` (GLOBAL) | تعديل اسم الوحدة فقط (level/parent محمي) |
| `PATCH` | `/api/geo-units/:id/status` | `geo.manage` (GLOBAL) | تغيير حالة وحدة واحدة (active/inactive) — الأبناء لا يتأثرون (GAP-062 مؤجل) |
| `DELETE` | `/api/geo-units/:id` | `geo.manage` (GLOBAL) | حذف — يفشل بـ 409 إذا يوجد أبناء |

#### `GET /api/geo-units`
- **الفلترة:** آلياً وفق `BRANCH` scope إذا كان المستخدم محدود الصلاحية.
- **الاستجابة:**
```json
[
  { "id": 1, "name": "دمشق", "level": 1, "parentId": null },
  { "id": 12, "name": "دمشق القديمة", "level": 2, "parentId": 1 },
  { "id": 45, "name": "الحميدية", "level": 3, "parentId": 12 },
  { "id": 149, "name": "باب شرقي", "level": 4, "parentId": 45 }
]
```

#### `GET /api/geo-units/:id`
- **الاستجابة:** نفس بنية عنصر واحد + `404` إذا غير موجود.

#### `POST /api/geo-units`
- **الصلاحية:** `geo.manage` (GLOBAL فقط).
- **Body:**
```json
{ "name": "حمص القديمة", "level": 2, "parentId": 10 }
```
- **التحقق:** `level IN [1,2,3,4]` ← `parent.level = level - 1` ← unique index.
- **رموز الخطأ:** `400` (تحقق هرمي) / `409` (اسم مكرر).

#### `PUT /api/geo-units/:id`
- **الصلاحية:** `geo.manage` (GLOBAL فقط).
- **Body:** `{ "name": "الاسم المصحح" }` — يُعدّل الاسم فقط، level وparent محميان.
- **رموز الخطأ:** `400` (اسم فارغ) / `404` (غير موجود) / `409` (اسم مكرر).

#### `DELETE /api/geo-units/:id`
- **الصلاحية:** `geo.manage` (GLOBAL فقط).
- **السلوك:** `ON DELETE RESTRICT` — يعيد `409` إذا يوجد أبناء مع رسالة: "احذف الأبناء أولاً".

---

## 8. حالات الاختبار الشاملة (Test Cases)

| معرف الاختبار | سيناريو الاختبار (Scenario) | طريقة الطلب | المدخلات البرمجية (Inputs) | النتيجة المتوقعة (Expected) |
|---|---|---|---|---|
| **TC-01** | عرض شجرة الوحدات الجغرافية | `GET /` | — | الرد بـ `200` مع مصفوفة الوحدات الجغرافية المسموح بعرضها. |
| **TC-02** | إنشاء محافظة جديدة بنجاح | `POST /` | `{ "name": "حماة", "level": 1 }` | الرد بـ `200` وإرجاع سجل المحافظة بـ `parentId = null`. |
| **TC-03** | إنشاء منطقة تابعة بنجاح | `POST /` | `{ "name": "سلمية", "level": 2, "parentId": 12 }` | الرد بـ `200` وحفظ السجل وربطه بـ `parent_id`. |
| **TC-04** | منع تكرار نفس الحي بنفس المستوى | `POST /` | `{ "name": "المزة", "level": 2, "parentId": 1 }` | الرد بـ `409` "إسم مكرر: توجد وحدة جغرافية بنفس الاسم والمستوى". |
| **TC-05** | محاولة حذف وحدة لها أبناء | `DELETE /:id` | `id = 12` (منطقة لها أحياء تابعة) | الرد بـ `409` "لا يمكن حذف هذه الوحدة الجغرافية — يوجد وحدات تابعة لها. احذف الأبناء أولاً." |
| **TC-06** | التحقق من فلترة نطاق الفرع | `GET /` | مستخدم بنطاق صلاحية `BRANCH` ومغطى بـ covered_geo_ids = `[12]` (المزة) | إعادة منطقة المزة والمحافظة التابعة لها فقط، وحجب بقية المحافظات والمناطق. |
| **TC-07** | إنشاء حي بدون أب إداري | `POST /` | `{ "name": "حي مخرب", "level": 3, "parentId": null }` | الرد بـ `400` "المستوى 3 يجب أن يكون تابعاً لوحدة من المستوى 2" — مُطبَّق بالـ API (GAP-036 ✅). |
| **TC-08** | حذف وحدة مرتبطة بـ client كعنوان | `DELETE /:id` | `id = 12` (المزة) وعملاء لديهم neighborhood=12 | الرد بـ `200` وحذف الوحدة — حقول العملاء تُضبط على `NULL` تلقائياً بـ `ON DELETE SET NULL` (GAP-003 ✅). |
| **TC-09** | محاولة إنشاء مستوى غير مدعوم | `POST /` | `{ "name": "مستوى 0", "level": 0 }` أو `level=5` | الرد بـ `400` "المستوى الإداري يجب أن يكون بين 1 و 4" — مُطبَّق بـ CHECK constraint + API validation (GAP-035 ✅). |
| **TC-10** | تجميع ودمج عنوان العميل النصي | (implicit) | `governorate = 1` (دمشق)، `district = 12` (المزة)، `neighborhood = 123` (فيلات غربية) | تجميع وعرض العنوان كـ `"دمشق، المزة، فيلات غربية، بناية ٥"` بالواجهة الأمامية. |
| **TC-11** | تغيير حالة وحدة إلى inactive | `PATCH /:id/status` | `{ "status": "inactive" }` على وحدة نشطة | الرد بـ `200` وإرجاع السجل بـ `status: "inactive"` — الأبناء لا يتأثرون (GAP-062 مؤجل). |
| **TC-12** | قائمة الوحدات النشطة فقط | `GET /active` | — | الرد بـ `200` مع مصفوفة تشمل الوحدات بحالة `active` فقط، مفلترة حسب scope الفرع. |

---

## 9. الثغرات والتضاربات المكتشفة (Gaps & Contradictions)

### GAP-003: ✅ محلول — تحويل حقول عناوين الزبائن من VARCHAR إلى INTEGER FK
* **الموقع:** `migrations/170_clients_geo_integer.sql` + `packages/api/routes/clients.ts`
* **الحل المُطبَّق:**
  - تحويل `clients.governorate`, `clients.district`, `clients.neighborhood` من `VARCHAR(255)` → `INTEGER`
  - ترحيل البيانات الموجودة: `governorate` (36 قيمة صحيحة محفوظة)، `district` (كانت فارغة → `NULL`)، `neighborhood` (36 قيمة صحيحة محفوظة)
  - إضافة `FK → geo_units(id) ON DELETE SET NULL` لكل حقل
  - تصحيح `routes/clients.ts` سطر 892 و 1056: `c.governorate || ''` → `Number(c.governorate) || null`
* **التاريخ:** 2026-05-24

### GAP-034: ✅ محلول — Option B: حذف `employees.residence` النصي
* **الموقع:** `migrations/171_drop_employees_residence_text.sql` + `packages/api/routes/adminApplications.ts`
* **الحل المُطبَّق:**
  - حذف عمود `employees.residence` النصي (بيانات اختبار — لا خسارة حقيقية)
  - الأعمدة `residence_governorate_id`, `residence_region_id`, `residence_sub_area_id`, `residence_neighborhood_id` كانت موجودة بالفعل مع FK → `geo_units(id)`
  - تنظيف `adminApplications.ts`: حذف كود بناء النص + تصحيح INSERT/RETURNING/SELECT
* **التاريخ:** 2026-05-24

### GAP-035: ✅ محلول — إضافة CHECK constraint على `level`
* **الموقع:** `migrations/168_geo_units_constraints.sql`
* **الحل المُطبَّق:** `ALTER TABLE geo_units ADD CONSTRAINT geo_units_level_check CHECK (level IN (1, 2, 3, 4));`
* **ملاحظة:** اكتُشف أثناء الحل أن النظام يدعم 4 مستويات فعلياً (وليس 3). الدستور صُحّح في BR-1.
* **التاريخ:** 2026-05-24

### GAP-036: ✅ محلول — فحص هرمي في POST handler
* **الموقع:** `packages/api/routes/geoUnits.ts` (POST /)
* **الحل المُطبَّق:** فحص `parent.level = child.level - 1` مع رسائل خطأ 400 واضحة لكل حالة.
* **التاريخ:** 2026-05-24

### GAP-037: ✅ محلول — إضافة `GET /:id` و`PUT /:id`
* **الموقع:** `packages/api/routes/geoUnits.ts`
* **الحل المُطبَّق:** `GET /:id` للقراءة الفردية + `PUT /:id` لتعديل الاسم فقط (level وparent محميان من التعديل).
* **التاريخ:** 2026-05-24

### GAP-038: ✅ محلول — استبدال `covered_geo_ids` JSONB بجدول `branch_geo_coverage`
* **الموقع:** `migrations/169_branch_geo_coverage_table.sql` + `geoScopeService.ts` + `branches.ts`
* **الحل المُطبَّق:**
  - إنشاء `branch_geo_coverage (branch_id FK → branches ON DELETE CASCADE, geo_unit_id FK → geo_units ON DELETE CASCADE, PRIMARY KEY (branch_id, geo_unit_id))`
  - ترحيل بيانات `covered_geo_ids` الموجودة — فقط IDs المرتبطة بـ `geo_units` حقيقية
  - حذف عمود `branches.covered_geo_ids`
  - تعديل `loadBranchCoveredGeoIds()` في `geoScopeService` للاستعلام من الجدول الجديد
  - تعديل GET/POST/PUT في `branches.ts` لإدارة الـ junction table باستخدام transactions
* **الفائدة:** حذف أي `geo_unit` يُنظّف تغطية الفروع أوتوماتيكياً — عزل الفروع لا يكسر بعد الآن.
* **التاريخ:** 2026-05-24

### GAP-039: ✅ محلول — استبدال CASCADE بـ RESTRICT
* **الموقع:** `migrations/168_geo_units_constraints.sql` + `packages/api/routes/geoUnits.ts`
* **الحل المُطبَّق:**
  - حذف `geo_units_parent_id_fkey` وإعادة إنشاؤه بـ `ON DELETE RESTRICT`
  - معالجة `err.code === '23503'` في DELETE handler برسالة: "لا يمكن حذف هذه الوحدة — يوجد وحدات تابعة لها. احذف الأبناء أولاً."
* **التاريخ:** 2026-05-24

---

## 10. تاريخ التغييرات الهيكلية (Schema Changelog)

| تاريخ الهجرة | رقم الهجرة (File) | الإجراء والوصف التقني والتأثير |
|---|---|---|
| **2026-04-01** | `001_core_tables.sql`| التأسيس الأساسي الأولي لجدول `geo_units` بأربعة حقول أساسية. |
| **2026-04-14** | `014_branch_id_domain_tables.sql`| إضافة حقول التغطية والمواقع الجغرافية للفروع بصفة JSONB وعلاقات FK للمراكز. |
| **2026-04-16** | `053_geo_units_unique_constraint.sql`| **تحديث التكامل الهيكلي:** إنشاء الفهرس الفريد لمنع تكرار المناطق والأسماء المتطابقة تحت نفس الأب. |
| **2026-04-19** | `060_fix_branch_geo_coverage.sql`| معالجة وتصحيح حقول التغطية وتكامل معطياتها للفروع. |
| **2026-04-20** | `061_syrian_geo_data.sql`| **الهجرة الجغرافية الكبرى:** بذرة وحقن البيانات والتقسيمات الجغرافية السورية الحقيقية لدمشق وحمص وحلب واللاذقية وطرطوس. |
| **2026-04-26** | `101_contracts_installation_address.sql`| ربط العقود مالياً وتقنياً بمواقع تركيب الأجهزة بـ `installation_geo_unit_id`. |
| **2026-04-27** | `113_task_type_config_location_basis.sql`| تأسيس عمود `location_basis` لتنظيم مطابقة وتوزيع المهام الجغرافية للفرق. |
| **2026-05-24** | `167_snapshot_backfill.sql`| ترحيل ونسخ البيانات التاريخية لـ snapshots مع تصفية وعمل casting لحقول VARCHAR الجغرافية لعملاء CRM. |
| **2026-05-24** | `168_geo_units_constraints.sql`| **GAP-035 + GAP-039:** إضافة `CHECK (level IN (1,2,3,4))` + استبدال `ON DELETE CASCADE` بـ `ON DELETE RESTRICT` على `parent_id`. |
| **2026-05-24** | `169_branch_geo_coverage_table.sql`| **GAP-038:** إنشاء جدول `branch_geo_coverage` + ترحيل بيانات `covered_geo_ids` + حذف العمود القديم. |
| **2026-05-24** | `170_clients_geo_integer.sql`| **GAP-003:** تحويل `clients.governorate`, `district`, `neighborhood` من `VARCHAR` → `INTEGER` + إضافة `FK → geo_units(id) ON DELETE SET NULL`. |
| **2026-05-24** | `171_drop_employees_residence_text.sql`| **GAP-034 B:** حذف `employees.residence` النصي — الأعمدة الصحيحة `residence_*_id` كانت موجودة بالفعل. |
| **2026-05-24** | `172_geo_units_status.sql`| إضافة `geo_units.status VARCHAR(10) DEFAULT 'active' CHECK IN ('active','inactive')` + endpoint `PATCH /:id/status` + `GET /active`. |
| **2026-06-13** | `279_geo_units_permission_tree.sql`| **فصل شجرة الصلاحيات:** إضافة `geo_units.lookup` (GLOBAL/BRANCH/ASSIGNED) لتعبئة العناوين، حصر `geo.manage` بـ `GLOBAL` فقط وحذف أي منحة فرعية لها، وترحيل (backfill) منح `geo.view` إلى `geo_units.lookup` بنفس النطاق. الكود: قبول `geo_units.lookup` على قراءات geo-units، فلترة `GET /:id` بالنطاق، واستبعاد الوحدات المعطّلة من خيارات الاختيار. |
