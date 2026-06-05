# دستور شاشة تفاصيل الزيارة الميدانية

> **الحالة:** معتمد — مراجعة ٢
> **اللغة:** عربية موحّدة
> **النطاق:** Visit Detail Page — شاشة تفاصيل الزيارة الميدانية الواحدة
> **آخر تحديث:** ٢٣/٥/٢٠٢٦

---

## ٠) الملخّص التنفيذي

شاشة تفاصيل الزيارة بتعرض كل شي عن زيارة واحدة: موعد + زبون + محطة + فريق + أسماء + مهام + محصلة.

**قاعدة أساسية:** بيانات الزبون (الاسم + العنوان + التواصل) بتُحفظ كـ snapshot وقت إنشاء الزيارة ضمن `field_visits.customer_snapshot` — لأن الزبون ممكن يعدّل ملفه لاحقاً، وما يجوز تأثّر بيانات الزيارات القديمة.

**ما هو موجود الآن بـ DB:** `field_visits`، `visit_tasks`، `visit_task_results`، `visit_geo_logs`، `visit_name_collections`، `direct_suggestions`، `task_type_config`.

**ما يحتاج migration:** أعمدة الموعد (appointment_*) + `customer_snapshot` JSONB + `cancellation_reason_id` + `cancellation_notes`. راجع القسم ٨.

---

## ١) القسم الأول: معلومات الموعد

هاي المعلومات بتيجي من التيليماركتر وقت حجز الموعد وبتتحفظ مع الزيارة.

| # | البيانة | الحقل في `field_visits` | النوع | الحالة |
|---|---------|------------------------|-------|--------|
| ١ | **تاريخ التنفيذ** | `scheduled_date` | DATE | موجود ✅ |
| ٢ | **الموعد المتوقع للوصول** | `scheduled_time` | VARCHAR(50) | موجود ✅ |
| ٣ | **تاريخ حجز الموعد** | `appointment_booked_at` | TIMESTAMPTZ | يحتاج migration ⚠️ |
| ٤ | **اسم التيليماركتر** | `booked_by_telemarketer_id` FK → `hr_users` | INTEGER | يحتاج migration ⚠️ |
| ٥ | **ملاحظات التيليماركتر** | `telemarketer_notes` | TEXT | يحتاج migration ⚠️ |
| ٦ | **من رد على الاتصال** | `answered_by` | VARCHAR(50) | يحتاج migration ⚠️ |

**قيم `answered_by`:** `'customer'` \| `'spouse'` \| `'child'` \| `'other'`

---

## ٢) القسم الثاني: بيانات الزبون (Snapshot)

بيانات الزبون بتُنسخ من ملفه وقت إنشاء الزيارة وبتُخزَّن بـ `field_visits.customer_snapshot` (JSONB — يحتاج migration ⚠️).

**لحين تطبيق الـ migration:** النظام بيقرأ البيانات live من جدول `clients`.

### ٢.١ الاسم

| # | البيانة | المفتاح بـ `customer_snapshot` | مصدره الأصلي بـ `clients` |
|---|---------|-------------------------------|--------------------------|
| ١ | الاسم الكامل | `name` | `clients.name` |
| ٢ | الاسم الأول | `firstName` | `clients.first_name` |
| ٣ | اسم الأب | `fatherName` | `clients.father_name` |
| ٤ | الكنية / اللقب | `lastName` | `clients.last_name` |
| ٥ | اللقب الشائع | `nickname` | `clients.nickname` |

### ٢.٢ التواصل

| # | البيانة | المفتاح بـ `customer_snapshot` | مصدره الأصلي بـ `clients` |
|---|---------|-------------------------------|--------------------------|
| ١ | الرقم الرئيسي | `mobile` | `clients.mobile` |
| ٢ | قائمة الأرقام | `contacts` (array) | `clients.contacts` (JSONB) |

كل عنصر بـ `contacts[]`: `{ number, type, label, isActive, supportsWhatsapp, isPrimary }`

### ٢.٣ العنوان

| # | البيانة | المفاتيح بـ `customer_snapshot` | العرض بالـ UI |
|---|---------|--------------------------------|---------------|
| ١ | المحافظة | `governorateId` + `governorateName` | الاسم فقط |
| ٢ | المنطقة | `districtId` + `districtName` | الاسم فقط |
| ٣ | الناحية | `neighborhoodId` + `neighborhoodName` | الاسم فقط |
| ٤ | العنوان التفصيلي | `detailedAddress` | النص كامل |
| ٥ | الموقع على الخريطة | `gpsLat` + `gpsLng` | خريطة صغيرة أو رابط |

> **IDs مخفية:** الـ UI بيعرض أسماء المناطق فقط. IDs محفوظة بالـ JSON للـ backend.

مصادر الأعمدة بـ `clients`: `governorate`, `district`, `neighborhood` (VARCHAR — بتخزن ID كنص) → أسماءها من `geo_units`.

### ٢.٤ بيانات إضافية

| # | البيانة | المفتاح بـ `customer_snapshot` | مصدره الأصلي بـ `clients` |
|---|---------|-------------------------------|--------------------------|
| ١ | الفرع | — | `branches.name` من `field_visits.branch_id` (لا يحتاج snapshot) |
| ٢ | مصدر المياه | `waterSource` | `clients.water_source` |
| ٣ | مهنة الزبون | `occupation` | `clients.occupation` |
| ٤ | مهنة الزوج / الزوجة | `spouseOccupation` | `clients.spouse_occupation` |
| ٥ | تقييم الزبون | `rating` | `clients.rating` |
| ٦ | الوسيط | `referrers` (array) | `clients.referrers` (JSONB) |

---

## ٣) القسم الثالث: محطة نطاق العمل المستهدفة

**المحطة = المنطقة الإدارية التي ينتمي إليها الزبون** (أو العقد) حسب نوع مهمته.

### ٣.١ كيف بيتحدد العنوان؟

النظام بيحسب المحطة من `visit_tasks` + `task_type_config.location_basis`:

| نوع المهمة | `location_basis` | المحطة = |
|-----------|-----------------|----------|
| `device_demo` | `client` | `clients.neighborhood` → `geo_units` |
| `emergency_maintenance` | `contract` | `contracts.installation_geo_unit_id` → `geo_units` |
| `device_delivery` | `contract` | `contracts.installation_geo_unit_id` → `geo_units` |
| `device_installation` | `contract` | `contracts.installation_geo_unit_id` → `geo_units` |
| `device_activation` | `contract` | `contracts.installation_geo_unit_id` → `geo_units` |

**قاعدة التعارض:** إذا فيه مهمة `location_basis = 'contract'` بالزيارة → المحطة = عنوان العقد. إذا كل المهام `location_basis = 'client'` → المحطة = عنوان الزبون.

### ٣.٢ الآلية التقنية

المحطة **تُحسب live** عند عرض الصفحة — لا تُحفظ كـ snapshot بـ `field_visits`. الحساب يتم عبر:

```sql
visit_tasks vt
  JOIN task_type_config ttc ON ttc.task_type = vt.task_type
  LEFT JOIN contracts c ON c.id = vt.contract_id
  LEFT JOIN geo_units gu ON gu.id = CASE
    WHEN ttc.location_basis = 'contract' AND c.installation_geo_unit_id IS NOT NULL
      THEN c.installation_geo_unit_id
    ELSE NULLIF(client.neighborhood, '')::int
  END
```

(نفس الـ `eff_zone` LATERAL المُطبَّق بـ `packages/api/routes/planning.ts`)

### ٣.٣ ما يُعرض

| # | البيانة | المصدر |
|---|---------|--------|
| ١ | اسم المنطقة (المحطة) | `geo_units.name` من الحساب أعلاه |
| ٢ | تسلسل المنطقة | `geo_units` hierarchy (محافظة → منطقة → ناحية) |

---

## ٤) القسم الرابع: الفريق المسؤول

### ٤.١ الفريق الأصلي

| # | الدور | الحقل | النوع |
|---|-------|-------|-------|
| ١ | المشرف | `team_snapshot → supervisor.name` | JSONB |
| ٢ | الفني | `team_snapshot → technician.name` | JSONB |
| ٣ | المتدرّب | `team_snapshot → trainee.name` | JSONB |

`field_visits.team_snapshot` موجود ✅ — بيُحفظ وقت إنشاء الزيارة من جدول الجدولة.

### ٤.٢ الفريق الرديف (بعد إعادة التعيين)

إذا صار تغيير فريق قبل تنفيذ الزيارة:

| # | الدور | الحقل | FK → |
|---|-------|-------|------|
| ١ | المشرف الجديد | `reassigned_supervisor_id` | `employees` |
| ٢ | الفني الجديد | `reassigned_technician_id` | `employees` |
| ٣ | المتدرّب الجديد | `reassigned_trainee_id` | `employees` |
| ٤ | snapshot الفريق الجديد | `reassigned_team_snapshot` | JSONB |
| ٥ | وقت التغيير | `reassigned_at` | TIMESTAMPTZ |
| ٦ | من قام بالتغيير | `reassigned_by` | FK → `hr_users` |

جميع هذه الحقول موجودة ✅ بـ `field_visits`.

### ٤.٣ منطق العرض

```
إذا reassigned_supervisor_id IS NOT NULL:
  → الفريق الجديد = رئيسي (بخط عادي)
  → الفريق القديم = رديف (بخط رمادي أو بـ "تاريخ التغيير")
إذا لا:
  → الفريق الأصلي من team_snapshot فقط
```

### ٤.٤ زر تغيير الفريق

- **يظهر بس إذا:** `status = 'scheduled'`
- **لا يظهر إذا:** `in_progress` أو `ended` أو `cancelled` أو ما بعدها
- **الأكشن:** يفتح مودال تغيير فريق → يحدّث `reassigned_*` fields

---

## ٥) القسم الخامس: لائحة الأسماء الجديدة

### ٥.١ الجداول الموجودة

| الجدول | الربط | الغرض |
|--------|-------|-------|
| `visit_name_collections` | `visit_task_id` FK → `visit_tasks` | تتبع عدد الأسماء الموعودة والمُجمَّعة |
| `direct_suggestions` | `visit_task_id` FK → `visit_tasks` | أسماء أفراد مقترحين مباشرة (اسم + رقم) |

### ٥.٢ هيكل `visit_name_collections`

| الحقل | النوع | المعنى |
|-------|-------|--------|
| `proposed_count` | INTEGER | عدد الأسماء التي وعد بها الزبون |
| `actual_count` | INTEGER | عدد الأسماء التي جُمعت فعلياً |
| `referral_sheet_id` | FK → `referral_sheets` | ورقة الإحالة المرتبطة (إن وُجدت) |
| `status` | `pending` \| `partial` \| `completed` | حالة التجميع |

### ٥.٣ هيكل `direct_suggestions`

| الحقل | النوع | المعنى |
|-------|-------|--------|
| `name` | VARCHAR(255) | اسم الشخص المقترح |
| `phone` | VARCHAR(50) | رقمه |
| `is_direct` | BOOLEAN | هل قدّمه الزبون مباشرة؟ |
| `status` | `pending` \| `contacted` \| `converted` | حالة المتابعة |

### ٥.٤ منطق العرض

- **بالزيارة:** عدد الأسماء المقترحة (SUM `proposed_count`) + عدد المُجمَّعة (SUM `actual_count`) — بدون تفاصيل.
- **للتفاصيل:** ربط `visit_tasks → visit_name_collections → referral_sheets` أو `direct_suggestions`.
- **لا حاجة لعمود `suggested_names_count` بـ `field_visits`** — الحساب من `visit_name_collections`.

### ٥.٥ ربط `referral_sheets`

ورقة الإحالة المُنشأة من الزيارة تُوصَل عبر: `visit_tasks → visit_name_collections → referral_sheets`. لا حاجة لـ `field_visit_id` مباشر على `referral_sheets`.

`referral_sheets.referral_origin_channel` يُستخدم لتمييز مصدر ورقة الإحالة — يُضاف `'field_visit'` كقيمة مقبولة عند إنشاء الورقة من الزيارة.

---

## ٦) القسم السادس: مهام الزيارة

### ٦.١ أنواع المهام المدعومة بـ `visit_tasks`

| `task_type` | `task_family` | الاسم العربي | `location_basis` |
|------------|--------------|-------------|-----------------|
| `device_demo` | `marketing` | عرض جهاز | `client` |
| `device_delivery` | `service` | تسليم الجهاز | `contract` |
| `device_installation` | `service` | تركيب الجهاز | `contract` |
| `device_activation` | `service` | تشغيل الجهاز | `contract` |
| `emergency_maintenance` | `service` | الصيانة الطارئة | `contract` |

### ٦.٢ بيانات كل مهمة

| # | البيانة | الحقل | المصدر |
|---|---------|-------|--------|
| ١ | نوع المهمة (عربي) | `task_type_config.arabic_label` | JOIN على `task_type` |
| ٢ | الترتيب | `visit_tasks.sequence_no` | INTEGER |
| ٣ | الحالة | `visit_tasks.status` | pending / in_progress / completed / not_completed / cancelled |
| ٤ | العقد المرتبط | `visit_tasks.contract_id` → `contracts` | live lookup — اسم الجهاز + رقم العقد |
| ٥ | ملاحظات التنفيذ | `visit_tasks.execution_notes` | TEXT |

> **ملاحظة contract_id:** `visit_tasks.contract_id` موجود ✅ (أضيف بـ migration 155). النظام يقرأ بيانات العقد live من `contracts` — لا يعتمد على `contract_snapshot` JSONB وحده.

### ٦.٣ الإجراء حسب حالة الزيارة

| حالة `field_visits.status` | الإجراء المتاح لكل مهمة |
|---------------------------|------------------------|
| `scheduled` | عرض فقط — لا إجراء |
| `in_progress` | زر "سجّل نتيجة" |
| `ended` / `completed` / `not_completed` | عرض النتيجة المسجّلة من `visit_task_results` |
| `cancelled` | لا شي — المهام أُلغيت |
| `postponed_by_company` / `postponed_by_customer` / `needs_reschedule` | عرض فقط |

### ٦.٤ نتائج المهمة بـ `visit_task_results`

| الحقل | المعنى |
|-------|--------|
| `final_decision` | القرار النهائي |
| `reason_code` | رمز السبب |
| `closing_notes` | ملاحظات الإغلاق |
| `closed_by` FK → `hr_users` | من سجّل النتيجة |
| `closed_at` | وقت التسجيل |

لكل `task_type` جدول نتائج مخصص يرتبط عبر `visit_task_result_id`:
- `visit_task_device_demo_results`
- `visit_task_device_delivery_results`
- `visit_task_device_installation_results`
- `visit_task_device_activation_results`
- `visit_task_emergency_financial` + `visit_task_emergency_parts_used` + `visit_task_emergency_technical_states`

---

## ٧) القسم السابع: محصلة الزيارة

هاي بتظهر بعد ما الفريق يخلص — ملخّص "شو صار فعلياً".

### ٧.١ بيانات التنفيذ (من `visit_geo_logs`)

`visit_geo_logs` علاقة 1:1 مع `field_visits` (UNIQUE على `visit_id`) ✅.

| # | البيانة | الحقل |
|---|---------|-------|
| ١ | تاريخ الزيارة الفعلي | `actual_start_time` (DATE جزء منه) |
| ٢ | وقت البدء الفعلي | `actual_start_time` (TIME جزء منه) |
| ٣ | وقت الانتهاء | `actual_end_time` |
| ٤ | المدة | `duration_minutes` (INTEGER) |
| ٥ | مسافة التنقل | `distance_meters` (INTEGER) |
| ٦ | موقع البدء على الخريطة | `actual_start_lat` + `actual_start_lng` |
| ٧ | دقة موقع البدء | `actual_start_accuracy` (INTEGER — متر) |
| ٨ | موقع الانتهاء على الخريطة | `actual_end_lat` + `actual_end_lng` |
| ٩ | دقة موقع الانتهاء | `actual_end_accuracy` (INTEGER — متر) |
| ١٠ | لم يتوفر GPS | `location_missing` (BOOLEAN) |

### ٧.٢ حالة الزيارة وإغلاقها (من `field_visits`)

| حالة `field_visits.status` | المعنى |
|---------------------------|--------|
| `scheduled` | مجدولة — لم تبدأ |
| `in_progress` | جارية — الفريق بالموقع |
| `ended` | انتهى التنفيذ — لم يُقيَّم بعد |
| `completed` | مكتملة |
| `not_completed` | لم تكتمل |
| `postponed_by_company` | مؤجلة بطلب من الشركة |
| `postponed_by_customer` | مؤجلة بطلب من الزبون |
| `cancelled` | ملغاة |
| `needs_reschedule` | تحتاج إعادة جدولة |

| # | البيانة | الحقل |
|---|---------|-------|
| ١ | من أغلق الزيارة | `closed_by` FK → `hr_users` |
| ٢ | وقت الإغلاق | `closed_at` TIMESTAMPTZ |
| ٣ | ملاحظات الميدان | `field_notes` TEXT |
| ٤ | سبب الإلغاء | `cancellation_reason_id` FK → `system_lists` — **يحتاج migration** ⚠️ |
| ٥ | ملاحظات الإلغاء | `cancellation_notes` TEXT — **يحتاج migration** ⚠️ |

---

## ٨) حالة قاعدة البيانات

### ٨.١ موجود الآن ✅

**`field_visits`:**
`id`, `visit_type`, `visit_family`, `status`, `client_id`, `branch_id`, `scheduled_date`, `scheduled_time`, `team_snapshot`, `reassigned_supervisor_id`, `reassigned_technician_id`, `reassigned_trainee_id`, `reassigned_team_snapshot`, `reassigned_at`, `reassigned_by`, `field_notes`, `closed_by`, `closed_at`, `created_by`, `source_legacy_type`, `source_legacy_id`

**جداول مرتبطة بـ field_visits:**
- `visit_tasks` (مع `contract_id` + `contract_snapshot` من migration 155)
- `visit_task_results` + جداول النتائج المخصصة
- `visit_geo_logs` (1:1)
- `visit_name_collections` (per task)
- `direct_suggestions` (per task)

### ٨.٢ يحتاج migration ⚠️

**أعمدة جديدة بـ `field_visits`:**

| # | العمود | النوع | الغرض |
|---|--------|-------|-------|
| ١ | `appointment_booked_at` | TIMESTAMPTZ | وقت حجز الموعد من التيليماركتر |
| ٢ | `booked_by_telemarketer_id` | INTEGER FK → `hr_users` | التيليماركتر الذي حجز |
| ٣ | `telemarketer_notes` | TEXT | ملاحظات التيليماركتر عن المكالمة |
| ٤ | `answered_by` | VARCHAR(50) | من رد (`customer` / `spouse` / `child` / `other`) |
| ٥ | `customer_snapshot` | JSONB | لقطة بيانات الزبون وقت إنشاء الزيارة |
| ٦ | `cancellation_reason_id` | INTEGER FK → `system_lists` | سبب الإلغاء (category = `'visit_cancellation_reasons'`) |
| ٧ | `cancellation_notes` | TEXT | ملاحظات إضافية عن الإلغاء |

**هيكل `customer_snapshot` JSONB:**

```json
{
  "name": "الاسم الكامل",
  "firstName": "...", "fatherName": "...", "lastName": "...", "nickname": "...",
  "mobile": "...",
  "contacts": [{ "number": "...", "type": "mobile|landline", "label": "...", "isActive": true, "supportsWhatsapp": false, "isPrimary": true }],
  "governorateId": 1, "governorateName": "...",
  "districtId": 2, "districtName": "...",
  "neighborhoodId": 3, "neighborhoodName": "...",
  "detailedAddress": "...",
  "gpsLat": 33.5, "gpsLng": 36.3,
  "waterSource": "...",
  "occupation": "...",
  "spouseOccupation": "...",
  "rating": "ملتزم | غير ملتزم"
}
```

---

## ٩) قواعد العرض (UI Rules)

### VDP-R001 — Snapshot وليس Live (بعد migration)
بعد تطبيق الـ migration، بيانات الزبون (الاسم + العنوان + التواصل) بتُقرأ من `customer_snapshot`. **قبل الـ migration:** تُقرأ live من `clients`.

### VDP-R002 — IDs مخفية
IDs المناطق محفوظة بالـ JSONB للـ backend. الـ UI بيعرض أسماء المناطق فقط.

### VDP-R003 — الفريق الجديد = الرئيسي
إذا `reassigned_supervisor_id IS NOT NULL` → الفريق الجديد بيظهر كرئيسي، القديم (من `team_snapshot`) كرديف.

### VDP-R004 — زر تغيير الفريق بس قبل البدء
يظهر فقط إذا `status = 'scheduled'`. لما الزيارة تبدأ (`in_progress`) → الزر يختفي.

### VDP-R005 — لائحة الأسماء = عدد فقط في الزيارة
الزيارة بتعرض العدد (SUM `proposed_count`). التفاصيل في `direct_suggestions` + `referral_sheets`.

### VDP-R006 — المحطة محسوبة تلقائياً
النظام يحسب عنوان المحطة من `visit_tasks.contract_id` + `task_type_config.location_basis`. المستخدم لا يختار يدوياً.

### VDP-R007 — خريطتا البدء والانتهاء
خريطتان thumbnail صغيرتان. ضغطة على وحدة → تفتح خريطة كاملة.

### VDP-R008 — حالات الزيارة المرئية
٩ حالات مدعومة في DB: `scheduled`, `in_progress`, `ended`, `completed`, `not_completed`, `postponed_by_company`, `postponed_by_customer`, `cancelled`, `needs_reschedule`.

---

## ١٠) الفجوات — مُغلقة

| الكود | الوصف | القرار |
|-------|-------|--------|
| VDP-G001 | أعمدة `target_*` للمحطة | **مُغلقة:** المحطة تُحسب live من `visit_tasks + task_type_config + contracts + geo_units` (نمط `eff_zone`). لا snapshot مستقل. |
| VDP-G002 | `suggested_names_count` + `referral_sheets.field_visit_id` | **مُغلقة:** يُستخدم `visit_name_collections.proposed_count` (موجود). ربط الورقة عبر `visit_task → visit_name_collections → referral_sheets`. `referral_origin_channel = 'field_visit'` للتمييز. |
| VDP-G003 | هيكل `customer_snapshot` — ماذا نحفظ؟ | **مُغلقة:** نحفظ: اسم كامل + أجزاء + تواصل + عنوان كامل (id+name) + gps + water_source + مهنة + تقييم. يحتاج migration. |
| VDP-G004 | `cancellation_reason_id` — أي جدول؟ | **مُغلقة:** يُستخدم `system_lists` (category = `'visit_cancellation_reasons'`). + `cancellation_notes TEXT`. يحتاج migration. |

---

## ١١) الخلاصة

> **الزيارة = ٧ أقسام:** موعد + زبون (snapshot) + محطة (محسوبة) + فريق + أسماء + مهام + محصلة.
> **Customer snapshot** يُحفظ في `customer_snapshot` JSONB — يحتاج migration.
> **المحطة** تُحسب من `task_type_config.location_basis` + `contract_id` — لا snapshot مستقل.
> **الفريق الجديد** (reassigned_*) يحل محل القديم في العرض. FK → `employees`.
> **لائحة الأسماء** عبر `visit_name_collections` + `direct_suggestions` — موجودة.
> **الإغلاق** عبر `field_visits.closed_by/closed_at` + `cancellation_*` — يحتاج migration.
