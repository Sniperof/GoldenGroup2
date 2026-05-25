# دستور الكيان: الفروع (Branches Domain Constitution)

> **الحالة (Status):** Active / Authoritative  
> **المرجع الأعلى والتأسيسي للوحدات التنظيمية وعمليات التشغيل متعدد الفروع (Multi-branch)، وتنسيق تغطية الصلاحيات والفلترة الجغرافية.**

---

## 1. هوية الكيان (Entity Identity)

- **الاسم العربي:** الفروع / مراكز التشغيل الجغرافية
- **الاسم الإنجليزي:** Branches
- **اسم الجدول:** `branches`
- **الوصف:** الكيان التنظيمي والتأسيسي الأول لجميع العمليات في Golden CRM. يمثل الفرع وحدة تشغيل جغرافية وإدارية مستقلة للشركة تمتلك موقعاً فيزيائياً معتمداً ومجموعة فروع مغطاة بالتشغيل ومصفوفة موظفين وفرق عمل ميدانية. يتم عزل كافة البيانات التشغيلية (عملاء، عقود، زيارات، مكالمات، مهام) وإسناد الصلاحيات الأمنية جغرافياً وفق نطاق الفروع المصرح بها للمستخدم.
- **الجداول المرتبطة:**
  1. `clients` (مرتبط بـ `branch_id`).
  2. `employees` (مرتبط بـ `branch_id`).
  3. `contracts` (مرتبط بـ `branch_id`).
  4. `candidates` (مرتبط بـ `branch_id`).
  5. `open_tasks` (مرتبط بـ `branch_id`).
  6. `field_visits` (مرتبط بـ `branch_id`).
  7. `user_branch_assignments` (يربط الموظف بعدة فروع تشغيلية).
  8. `roles` (استنساخ قوالب الصلاحيات والوظائف للفرع).
  9. `departments` (الأقسام التابعة للفرع).
  10. `contact_targets` (أهداف اتصالات التسويق للفرع).
- **الأهمية والأمان:** يمثل ركيزة الحماية وعزل الفروع (Branch Scoping / Multi-branch Isolation). أي تسريب أو وصول خارج الفروع المتاحة يمثل خرقاً أمنياً صريحاً لخصوصية العملاء وحسابات الفروع بالشركة.

---

## 2. معجم الجداول والحقول (Table & Field Dictionary)

### 2.1 جدول الفروع `branches`
يخزن البيانات الأساسية للمواقع الفيزيائية ونطاق التغطية والاتصال للفروع المتاحة بالشركة.

| الحقل (Field) | النوع (SQL Type) | NULL? | DEFAULT | Constraints | الوصف والشرح بالعربية | مثال واقعي (Example) |
|---|---|---|---|---|---|---|
| `id` | `INTEGER` | ❌ | `nextval()` | `PRIMARY KEY` | المعرف الفريد للفرع | `3` (فرع حمص) |
| `name` | `VARCHAR(255)` | ❌ | — | — | الاسم الفعلي للفرع | `"فرع حمص"` |
| `location_geo_id`| `INTEGER` | ✅ | — | `FK → geo_units(id) ON DELETE RESTRICT`| المعرف الجغرافي للمقر الرئيسي للفرع | `10` (معرف حمص القديمة) |
| `detailed_address`| `TEXT` | ✅ | — | — | العنوان التفصيلي الفيزيائي للمقر | `"حي الواعر، شارع الخراب"`|
| `contact_info` | `JSONB` | ✅ | `'[]'::jsonb`| — | معلومات التواصل وأقسام الفرع | `[{"type": "phone", ...}]` |
| `status` | `VARCHAR(50)` | ✅ | `'active'` | `CHECK (status IN (active, inactive))` | حالة التفعيل للفرع بالعمليات | `"active"` |
| `created_at` | `TIMESTAMPTZ` | ✅ | `NOW()` | — | تاريخ تأسيس الفرع بالخلفية | `2026-04-01 12:00:00+00` |

---

### 2.2 المقر المعتمد مقابل جدول التغطية الجغرافية
تتوزع هوية الفرع جغرافياً وفق بعدين رئيسيين بالـ DB:
1. **المقر المعتمد للفرع (`location_geo_id`):** حقل أمني ونزاهة فيزيائية من نوع `INTEGER REFERENCES geo_units(id) ON DELETE RESTRICT`. يمثل المركز المالي والإداري لنشاط الفرع بالشركة.
2. **جدول التغطية (`branch_geo_coverage`):** جدول ربط مستقل (Junction Table — migration 169) يربط الفرع بالوحدات الجغرافية التي يغطيها:
   ```sql
   branch_geo_coverage (
     branch_id   INTEGER REFERENCES branches(id)   ON DELETE CASCADE,
     geo_unit_id INTEGER REFERENCES geo_units(id)  ON DELETE CASCADE,
     PRIMARY KEY (branch_id, geo_unit_id)
   )
   ```
   - حذف فرع → يُحذف كل صفوفه بالجدول تلقائياً (CASCADE).
   - حذف وحدة جغرافية → تُزال تغطية تلك الوحدة من جميع الفروع تلقائياً (CASCADE).
   - يُستخدم في `geoScopeService.ts` لبناء `serviceGeoIds` و`visibleGeoIds` لكل فرع.

---

### 2.3 هيكلية بيانات التواصل وأقسام الفروع `BranchContact`
يتم تخزين معلومات التواصل للفرع كـ JSONB يحتوي على مصفوفة كائنات تطابق النوع المشترك `BranchContact` بالخلفية:

```typescript
export interface BranchContact {
  id: string;            // معرف UUID فريد للواجهة الرسومية
  type: BranchContactType;
  department: BranchDepartment;
  value: string;         // البريد، الهاتف، أو الموقع الفعلي
  label?: string;        // ملاحظة إضافية
}

export type BranchContactType = 'email' | 'phone' | 'mobile' | 'website';
export type BranchDepartment = 'customer_service' | 'hr' | 'management' | 'accounting' | 'other';
```

*مثال تخزين واقعي بالـ DB:*
```json
[
  {
    "id": "c7a8b9d0-1234-5678-abcd-112233445566",
    "type": "phone",
    "department": "customer_service",
    "value": "031-234567",
    "label": "الرقم الأساسي لصيانة الفلاتر"
  }
]
```

---

## 3. القيود والقواعد التشغيلية (Database Constraints & Business Rules)

### BR-1: مطابقة وصلاحيات الوصول متعدد الفروع (Multi-branch Scope System)
يتعامل خادم التطبيق مع حدود وصول المستخدم للفروع بطريقة ديناميكية صارمة:
1. **إسناد الفروع للمستخدم:** يرتبط المستخدم الموظف بأكثر من فرع مع تحديد الفرع الرئيسي للعمل عبر جدول التخصيص `user_branch_assignments` (مصفوفة `allowedBranchIds`).
2. **تحديد الفرع الجاري (`actingBranchId`):** يُقرأ من الهيدر المرسل بالطلب `X-Branch-Id`. في حال كان الموظف يمتلك حق الوصول للفرع المرسل، يُعتمد كفرع جاري، وإلا يُستبدل بالفرع الرئيسي المعتمد له.
3. **فلترة السجلات جغرافياً:** يتم تصفية وعزل استعلامات جداول العملاء والعقود والمهام والزيارات بحيث تنحصر فقط في السجلات التابعة للفرع الجاري أو الفروع المصرح بها للموظف:
$$\text{WHERE } \text{record.branch\_id} \in \text{context.allowedBranchIds}$$

### BR-2: قيد المنع التام لحذف الفروع (ON DELETE RESTRICT Safety Bound)
لحماية سلامة وموثوقية البيانات المالية والجنائية التاريخية للشركة، تم فرض قيد حذف صارم `ON DELETE RESTRICT` لجميع حقول `branch_id` بالجدوال التشغيلية (انظر الهجرة `014`):
- يمنع محرك قاعدة البيانات حذف أي فرع بالكامل في حال كان يحتوي على زبون واحد (`clients`) أو موظف واحد (`employees`) أو عقد واحد (`contracts`) أو مهام ميدانية جارية أو تاريخية.
- للتخلص من الفرع، يجب تصفية ونقل ارتباطات كافة الموظفين والعملاء أولاً، وهو ما يمثل صمام أمان شامل ضد الحذف العشوائي.

### BR-3: قواعد حالة التفعيل والأرشفة (Branch Status Constraints)
- **حالة نشط (`status = 'active'`):** الفرع يعمل بالكامل، يظهر بالواجهات، ويسمح بإنشاء سجلات جديدة وتوزيع مهام ميدانية.
- **حالة غير نشط (`status = 'inactive'`):** الفرع متوقف ومغلق. يمنع الخادم بـ tRPC/Express إسناد موظفين جدد له أو تحويل فنيين تشغيليين، مع بقاء سجلاته التاريخية متاحة للقراءة والتدقيق المالي فقط لحفظ الأثر التاريخي للأقساط والصيانة.

### BR-4: نزاهة التغطية الجغرافية — محلولة ✅ (migration 169)
* **الوضع السابق:** كانت التغطية مخزنة كـ JSONB Array بلا FK، مما يترك معرفات يتيمة عند حذف وحدات جغرافية.
* **الوضع الحالي:** التغطية مخزنة في `branch_geo_coverage` (junction table) مع `ON DELETE CASCADE` على كلا الطرفين — حذف أي وحدة جغرافية يُنظّف الفروع المرتبطة بها أوتوماتيكياً. (انظر §2.2 للتفاصيل)

---

## 4. العلاقات الهيكلية (Entity Relationships)

```mermaid
erDiagram
    branches ||--o{ clients : "has clients (ON DELETE RESTRICT)"
    branches ||--o{ employees : "employs technicians (ON DELETE RESTRICT)"
    branches ||--o{ contracts : "owns contracts (ON DELETE RESTRICT)"
    branches ||--o{ candidates : "has candidates (ON DELETE RESTRICT)"
    branches ||--o{ open_tasks : "hosts tasks (ON DELETE RESTRICT)"
    branches ||--o{ field_visits : "hosts visits (ON DELETE RESTRICT)"
    branches ||--o{ user_branch_assignments : "linked in assignments (ON DELETE CASCADE)"
    branches ||--o{ roles : "cloned roles (ON DELETE CASCADE)"
    branches ||--o{ departments : "contains (ON DELETE CASCADE)"
    branches }o--|| geo_units : "located at (ON DELETE RESTRICT)"
```

---

## 5. قواعد الحذف والنزاهة المرجعية (Deletion & Integrity Rules)

- **حظر حذف الفرع (RESTRICT):** تفرض محركات قاعدة البيانات حظر حذف الفرع المرتبط بالعملاء والموظفين والعقود بـ `ON DELETE RESTRICT` لمنع تخلف سجلات يتمية بلا مرجعية مالية.
- **الحذف المتتالي (CASCADE):** عند نجاح حذف الفرع الشاغر (الخالي تماماً من السجلات والارتباطات الأساسية)، يقوم محرك الـ DB بالمسح المتتالي للارتباطات الأمنية والداخلية للفرع بـ `ON DELETE CASCADE` في الجداول التالية:
  - جدول مصفوفة الصلاحيات والأدوار المنسوخة للفرع `roles` (حيث يتم إزالة كافة الأدوار المستنسخة جراء وجود `branch_id`).
  - جدول تخصيص فروع المستخدمين `user_branch_assignments` (حيث تزال الفروع المخصصة للموظفين).
  - جدول الأقسام الإدارية والمهام الفرعية للفرع `departments`.

---

## 6. صلاحيات الوصول (Permission Matrix)

تم تنظيم الصلاحيات الخاصة بإدارة الفروع بالخلفية كالتالي:

| الصلاحية المطلوبة (Permission Key) | النطاق المسموح (Allowed Scopes) | الوصف والشرح بالعربية |
|---|---|---|
| `branches.view` | `GLOBAL / BRANCH` | استعراض قائمة الفروع وتفاصيلها — مطلوبة لـ `GET /` و `GET /:id` |
| `branches.edit` | `GLOBAL / BRANCH` | تعديل البيانات التشغيلية للفرع (الاسم، العنوان، معلومات التواصل) — لا تتيح تغيير التغطية الجغرافية أو الحالة |
| `branches.manage` | `GLOBAL / BRANCH` | الصلاحية الإدارية الكاملة: إنشاء فرع جديد، حذفه، تغيير حالته (`status`)، وتعديل نطاق التغطية الجغرافية (`coveredGeoIds`) |

**ملاحظة التسلسل الهرمي:** `PUT /:id` يقبل `branches.edit` أو `branches.manage`. إذا تضمن الطلب `coveredGeoIds` أو `status`، يُتحقق تلقائياً من وجود `branches.manage` — وإلا يُعاد `403`.

---

## 7. عقد API (API Contract)

### 7.1 قائمة endpoints المتاحة

#### 1. `GET /api/branches`
- **الوصف:** استعراض وجلب قائمة جميع الفروع بالنظام.
- **الصلاحية المطلوبة:** `branches.view`.
- **صيغة الاستجابة:**
```json
[
  {
    "id": 3,
    "name": "فرع حمص",
    "locationGeoId": 10,
    "detailedAddress": "حي الواعر، بناية ١٢",
    "coveredGeoIds": [10, 43],
    "contactInfo": [
      { "id": "uuid-1", "type": "phone", "department": "customer_service", "value": "031-234567" }
    ],
    "status": "active",
    "createdAt": "2026-04-01T12:00:00.000Z",
    "locationGeoName": "حمص القديمة"
  }
]
```

#### 2. `POST /api/branches`
- **الوصف:** تأسيس وإنشاء فرع تشغيلي جديد للشركة.
- **الصلاحية المطلوبة:** `branches.manage`.
- **طلب المدخلات (Body Schema):**
```json
{
  "name": "فرع اللاذقية الجديد",
  "locationGeoId": 9,
  "detailedAddress": "شبه الجزيرة، بناية ٧",
  "coveredGeoIds": [9, 34, 35],
  "contactInfo": [
    { "id": "uuid-x", "type": "email", "department": "management", "value": "latakia@golden-crm.com" }
  ],
  "status": "active"
}
```
- **الاستجابة:** إرجاع السجل المنشأ كاملاً مع معرف الـ `id` الجديد.

#### 3. `GET /api/branches/:id`
- **الوصف:** تفاصيل فرع فردي.
- **الصلاحية المطلوبة:** `branches.view`.
- **رموز الأخطاء:** `404` إذا لم يوجد الفرع.

#### 4. `PUT /api/branches/:id`
- **الوصف:** تعديل بيانات الفرع. الحقول التشغيلية (الاسم، العنوان، التواصل) تتطلب `branches.edit` أو `branches.manage`. الحقول الحساسة (`coveredGeoIds`، `status`) تتطلب `branches.manage` حصراً.
- **الصلاحية المطلوبة:** `branches.edit` أو `branches.manage` (حسب الحقول المرسلة).
- **رموز الأخطاء:** `400` (حقل مطلوب ناقص أو contactInfo غير صالح) / `403` (صلاحية غير كافية) / `404` (فرع غير موجود).

#### 5. `DELETE /api/branches/:id`
- **الوصف:** حذف الفرع المحدد — يفشل إذا كان مرتبطاً بعملاء أو موظفين أو عقود.
- **الصلاحية المطلوبة:** `branches.manage`.
- **رموز الأخطاء:** `404` (غير موجود) / `409` (لا يمكن الحذف — توجد سجلات مرتبطة).

---

## 8. حالات الاختبار الشاملة (Test Cases)

| معرف الاختبار | سيناريو الاختبار (Scenario) | طريقة الطلب | المدخلات البرمجية (Inputs) | النتيجة المتوقعة (Expected) |
|---|---|---|---|---|
| **TC-01** | عرض كافة فروع النظام بنجاح | `GET /api/branches` | — | الرد بـ `200` وإرجاع مصفوفة الفروع المعرفة مع دمج الاسم الجغرافي للمقر. |
| **TC-02** | عرض تفاصيل فرع مخصص بنجاح | `GET /api/branches/3` | `id = 3` | الرد بـ `200` وإرجاع السجل الكامل والتفصيلي للفرع. |
| **TC-03** | منع قراءة الفروع بدون `branches.view` | `GET /api/branches` | حساب بدون صلاحية `branches.view` | الرد بـ `403` (GAP-045 ✅). |
| **TC-04** | منع إنشاء فرع بدون مسمى | `POST /api/branches` | `{ "locationGeoId": 1 }` | الرد بـ `400` "اسم الفرع مطلوب". |
| **TC-05** | إنشاء فرع تشغيلي جديد بنجاح | `POST /api/branches` | `{ "name": "الفرع التجريبي", "locationGeoId": 1 }` | الرد بـ `200` وتوليد الرقم الفريد. |
| **TC-06** | حظر حذف فرع يحتوي على زبائن | `DELETE /api/branches/1` | `id = 1` (فرع يحتوي على زبائن) | الرد بـ `409` "لا يمكن حذف هذا الفرع — أرشف الفرع بدلاً من حذفه". |
| **TC-07** | حظر حذف فرع يحتوي على موظفين | `DELETE /api/branches/2` | `id = 2` (يحتوي على موظفين) | الرد بـ `409` بنفس الرسالة. |
| **TC-08** | حذف فرع فارغ تماماً بنجاح | `DELETE /api/branches/9` | `id = 9` (فرع خالٍ من السجلات) | الرد بـ `200` مع حذف CASCADE لتعيينات الفروع التابعة. |
| **TC-09** | تعديل تغطية الفرع الجغرافية | `PUT /api/branches/3` | `{ "name": "فرع حمص", "coveredGeoIds": [10, 43, 44] }` | الرد بـ `200` وتحديث `branch_geo_coverage` ضمن transaction. |
| **TC-10** | حظر تغيير الحالة بدون `branches.manage` | `PUT /api/branches/3` | مستخدم لديه `branches.edit` فقط، يرسل `{ "name": "...", "status": "inactive" }` | الرد بـ `403` "تعديل حالة الفرع يتطلب branches.manage" (GAP-063 ✅). |
| **TC-16** | السماح بتعديل التواصل بـ `branches.edit` | `PUT /api/branches/3` | مستخدم لديه `branches.edit` فقط، يرسل `{ "name": "...", "contactInfo": [...] }` بدون `status`/`coveredGeoIds` | الرد بـ `200` (GAP-063 ✅). |
| **TC-11** | محاولة الوصول لفرع غير معرّف | `GET /api/branches/999` | `id = 999` | الرد بـ `404` "الفرع غير موجود". |
| **TC-12** | رفض contactInfo بنوع غير مدعوم | `POST /api/branches` | `{ "name": "فرع", "contactInfo": [{"type":"fax","department":"hr","value":"031"}] }` | الرد بـ `400` "نوع التواصل غير مدعوم" (GAP-047 ✅). |
| **TC-13** | رفض تسجيل زبون لفرع موقوف | `POST /api/clients` | طلب لفرع `status=inactive` | الرد بـ `400` "لا يمكن تسجيل زبون جديد — الفرع المحدد موقوف عن العمل" (GAP-049 ✅). |
| **TC-14** | رفض إنشاء عقد لفرع موقوف | `POST /api/contracts` | طلب لفرع `status=inactive` | الرد بـ `400` "لا يمكن إنشاء عقد جديد — الفرع المحدد موقوف عن العمل" (GAP-049 ✅). |
| **TC-15** | رفض إنشاء مهمة لفرع موقوف | `POST /api/open-tasks` | طلب لفرع `status=inactive` | الرد بـ `400` "لا يمكن إنشاء مهمة جديدة — الفرع المحدد موقوف عن العمل" (GAP-049 ✅). |

---

## 9. الثغرات والتضاربات المكتشفة (Gaps & Contradictions)

### GAP-045: ✅ محلول — إضافة `branches.view` لمسارات الاستعلام
* **الموقع:** `packages/api/routes/branches.ts`
* **الحل المُطبَّق:** استبدال `requireAuth` بـ `requirePermission('branches.view')` على `GET /` و `GET /:id`. الصلاحية موجودة في DB منذ migration 030 ومستخدمة صحيحاً في الواجهة.
* **التاريخ:** 2026-05-24

### GAP-046: ✅ محلول — استبدال `covered_geo_ids` JSONB بجدول `branch_geo_coverage`
* **الموقع:** `migrations/169_branch_geo_coverage_table.sql` + `geoScopeService.ts` + `branches.ts`
* **الحل المُطبَّق:** إنشاء junction table مع `ON DELETE CASCADE` على كلا الطرفين — حذف أي وحدة جغرافية يُنظّف تغطية الفروع أوتوماتيكياً. (انظر §2.2)
* **التاريخ:** 2026-05-24

### GAP-047: ✅ محلول — التحقق من بنية `contact_info` في POST وPUT
* **الموقع:** `packages/api/routes/branches.ts`
* **الحل المُطبَّق:** دالة `validateContactInfo()` تتحقق من كل عنصر: `type` ∈ (email/phone/mobile/website)، `department` ∈ (customer_service/hr/management/accounting/other)، `value` غير فارغ. تُستدعى في بداية POST وPUT قبل الوصول للـ DB وتُعيد `400` فورًا عند أي خطأ.
* **التاريخ:** 2026-05-25

### GAP-063: ✅ محلول — إضافة `branches.edit` كصلاحية وسيطة
* **الموقع:** `migrations/173_branches_edit_permission.sql` + `packages/api/routes/branches.ts`
* **الحل المُطبَّق:** صلاحية جديدة `branches.edit` (`GLOBAL/BRANCH`) تتيح لـ `PUT /:id` تعديل الاسم والعنوان والتواصل فقط. إذا أرسل الطلب `coveredGeoIds` أو `status`، يُجري الكود فحصاً إضافياً inline لـ `branches.manage` — يُعيد `403` إن لم تتوفر. تم أيضاً إصلاح `status = COALESCE($5, status)` بدل `status || 'active'` لمنع إعادة تفعيل الفروع الموقوفة عرضياً.
* **التاريخ:** 2026-05-25

### GAP-048: انعدام سجل التدقيق ومراقبة التغييرات للفروع
* **الموقع:** `packages/api/routes/branches.ts`
* **الوصف:** تخلو واجهة الإدارة للفروع تماماً من وجود نظام تتبع وتدقيق (Audit Trail) للعمليات التشغيلية الهامة كالتغيير الجغرافي للمقر، أو تعديل مصفوفة الأحياء المغطاة، أو تغيير أرقام الاتصال.
* **التأثير:** صعوبة تحديد المسؤول عن إحداث تغييرات جغرافية أدت لتداخل نطاقات العمل الميداني للفرق وتغيير توزيع العمليات الجغرافية.
* **الحل المقترح:** تسجيل وربط عمليات التعديل للفروع بجدول المراقبة والتدقيق العام للمشروع `audit_logs`.

### GAP-049: ✅ محلول — منع إنشاء سجلات جديدة لفرع موقوف
* **الموقع:** `routes/clients.ts` + `routes/contracts.ts` + `routes/openTasks.ts`
* **الحل المُطبَّق:** فحص `SELECT status FROM branches WHERE id = $branchId` قبل كل INSERT في المسارات الثلاثة — يُعيد `400` مع رسالة عربية واضحة إذا كان الفرع `inactive`.
* **التاريخ:** 2026-05-25

---

## 10. تاريخ التغييرات الهيكلية (Schema Changelog)

| تاريخ الهجرة | رقم الهجرة (File) | الإجراء والوصف التقني والتأثير |
|---|---|---|
| **2026-04-01** | `001_core_tables.sql`| التأسيس الأولي لجدول `branches` مع تحديد المقر والمستند التأسيسي لمصفوفة التغطية الجغرافية والحالة. |
| **2026-04-02** | `004_column_additions.sql`| إضافة حقل معلومات التواصل للفرع `contact_info` بصفة مصفوفة JSONB مرنة بالخلفية. |
| **2026-04-14** | `013_multi_branch_identity.sql`| **تعدد الهوية التنظيمية:** ربط حسابات المستخدمين (`hr_users`) والأدوار الأكاديمية بالفروع ودعم قوالب النسخ للفرع. |
| **2026-04-14** | `014_branch_id_domain_tables.sql`| **الربط متعدد الفروع المعزز:** إدراج حقول `branch_id REFERENCES branches(id) ON DELETE RESTRICT` بـ 11 جدولاً لجميع الكيانات المتاحة. |
| **2026-04-15** | `016_departments.sql`| تأسيس الأقسام الإدارية والعملياتية وربطها المباشر بالفرع الرئيسي بـ `ON DELETE CASCADE`. |
| **2026-04-20** | `019_authorization_schema_preparation.sql`| إدخال جدول تعيينات الفروع وتعدد الوصول للمستخدمين `user_branch_assignments`. |
| **2026-04-24** | `040_branches_detailed_address.sql`| إلحاق حقل العنوان الفيزيائي التفصيلي `detailed_address` بجدول الفروع لتحديد مقار العمل بالكامل. |
| **2026-04-27** | `060_fix_branch_geo_coverage.sql`| معالجة وتصحيح بنية معطيات التغطية والمواقع الجغرافية وتطابقها للفلترة جغرافياً. |
| **2026-05-24** | `169_branch_geo_coverage_table.sql`| **GAP-046:** استبدال `covered_geo_ids` JSONB بجدول `branch_geo_coverage` مع `ON DELETE CASCADE` على كلا الطرفين + ترحيل البيانات الموجودة. |
| **2026-05-25** | `routes/branches.ts` (no migration) | **GAP-045 + GAP-047:** `requirePermission('branches.view')` على GET endpoints + `validateContactInfo()` لـ POST/PUT. |
| **2026-05-25** | `routes/clients.ts` + `routes/contracts.ts` + `routes/openTasks.ts` (no migration) | **GAP-049:** فحص `branch.status` قبل كل INSERT — يمنع إنشاء سجلات لفروع موقوفة. |
| **2026-05-25** | `migrations/173_branches_edit_permission.sql` + `routes/branches.ts` | **GAP-063:** إضافة `branches.edit` كصلاحية وسيطة — `PUT /:id` يقبل `edit` أو `manage`، لكن `coveredGeoIds`/`status` تتطلب `manage` حصراً. إصلاح `COALESCE($5, status)` لحفظ الحالة الحالية عند غياب `status` في الطلب. |
