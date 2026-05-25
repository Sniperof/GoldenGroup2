# دستور الكيان: الأجهزة والصيانة (Devices & Maintenance Domain Constitution)

> **الحالة (Status):** Authoritative / Active
> **المرجع المعتمد لتفاصيل المنتجات (فلاتر المياه)، قطع الغيار، الخصومات المالية، وتتبع دورة حياة الأجهزة والزيارات الفنية الميدانية.**

---

## 1. هوية الكيان (Entity Identity)

- **الاسم العربي:** الأجهزة والصيانة / كتالوج المنتجات وقطع الغيار
- **الاسم الإنجليزي:** Devices & Maintenance
- **الجداول الرئيسية:**
  1. `device_models` — موديلات الفلاتر والأجهزة (الكتالوج الأساسي)
  2. `spare_parts` — قطع الغيار والملحقات الاستهلاكية
  3. `device_discounts` — حملات التخفيضات الزمنية المربوطة بالموديلات
- **الجداول الفرعية وجداول تتبع العمليات:**
  1. `contract_line_items` — البنود الفعلية المباعة في العقود (أجهزة/ملحقات/خدمات)
  2. `open_task_devices` — لقطة الأجهزة الملحقة بمهام المبيعات المفتوحة
  3. `visit_task_device_delivery_results` — نتائج التوصيل الميداني الفعلي (Unified pattern)
  4. `visit_task_device_demo_results` — نتائج عروض المبيعات الميدانية (Unified pattern)
  5. `open_task_delivery_results` — نتائج توصيل الأجهزة للمهام المفتوحة
  6. `open_task_installation_results` — نتائج تركيب الأجهزة للمهام المفتوحة
  7. `device_technical_states` — الحالات التقنية التاريخية للأجهزة (صيانة طارئة)
  8. `emergency_result_parts` — قطع الغيار المستهلكة في مهام الطوارئ
- **الوصف:** الكيان المحوري للمنتجات المادية للشركة (فلاتر المياه والملحقات). يتتبع النظام الجهاز منذ تعريفه بالكتالوج، مروراً بتقديمه كعرض تسويقي ميداني (`device_demo`)، وبيعه وتفصيله في العقود، ومن ثم توليد مهام التوصيل (`device_delivery`) والتركيب (`device_installation`) والتشغيل الأولي (`device_activation`)، ووصولاً للصيانات الدورية والطارئة وإدارة قطع الغيار المستهلكة.
- **الأهمية البرمجية والتشغيلية:** يمثل الركيزة المالية واللوجستية للنظام (Core Product & Service Catalog). أي تلاعب ببيانات كتالوج الأجهزة أو أسعارها يؤثر مباشرة على العقود، حسابات الذمم المالية، ومخزون الموظفين الفنيين ميدانياً.

---

## 2. معجم الجداول والحقول (Table & Field Dictionary)

### 2.1 جدول موديلات الأجهزة `device_models`

يحتوي على الكتالوج المعتمد لأجهزة الفلترة والمبيعات المتاحة بالشركة. يمتد عبر هجرات متعددة (001، 036، 123، 124، 125، 128).

| الحقل (Field) | النوع (SQL Type) | NULL? | DEFAULT | Constraints | الوصف بالعربية | مثال |
|---|---|---|---|---|---|---|
| `id` | `SERIAL` | ❌ | `nextval()` | `PRIMARY KEY` | المعرف الفريد للموديل | `5` |
| `name` | `VARCHAR(255)` | ❌ | — | — | الاسم الافتراضي — يساوي `name_ar` دائماً بحكم الكود | `"فلتر 7 مراحل ذكي"` |
| `name_ar` | `VARCHAR(255)` | ✅ | — | — | الاسم العربي الرسمي للكتالوج | `"فلتر 7 مراحل ذكي"` |
| `name_en` | `VARCHAR(255)` | ❌ | — | `NOT NULL` (مفروض مهجرة 124) | الاسم الإنجليزي الرسمي للكتالوج | `"7-Stage Smart Filter"` |
| `brand` | `VARCHAR(255)` | ✅ | — | — | العلامة التجارية — يساوي `name_en` دائماً بحكم الكود | `"Golden Water"` |
| `category` | `VARCHAR(50)` | ✅ | — | `CHECK (category IN ('Residential', 'Industrial', 'Commercial'))` | فئة تشغيل الجهاز | `"Residential"` |
| `maintenance_interval` | `VARCHAR(50)` | ✅ | — | — | الفاصل الزمني للصيانة (VARCHAR غير مقيد) | `"6 أشهر"` أو `"6_months"` |
| `base_price` | `NUMERIC` | ✅ | `0` | — | السعر الأساسي للمستهلك قبل أي خصم | `650000` (ل.س) |
| `code` | `VARCHAR(255)` | ✅ | — | — | الرمز السريع التعريفي (لا يوجد UNIQUE constraint) | `"GW-SM7-2026"` |
| `supported_visit_types` | `JSONB` | ✅ | `'[]'::jsonb` | — | أنواع زيارات الصيانة المدعومة (بدون FK) | `["periodic_maintenance"]` |
| `is_golden_warranty` | `BOOLEAN` | ❌ | `FALSE` | — | هل يخضع لعقد الكفالة الذهبية؟ | `true` |
| `golden_warranty_periods` | `JSONB` | ❌ | `'[]'::jsonb` | — | تفاصيل فترات الكفالة المتاحة | `[{"months": 24}]` |
| `is_featured` | `BOOLEAN` | ❌ | `FALSE` | — | هل الجهاز مميز بواجهة العروض؟ (سابقاً `is_offer_included` — مهجرة 123) | `true` |
| `description` | `TEXT` | ✅ | — | — | الشرح التفصيلي بالعربية | `"فلتر معالج متطور..."` |
| `description_en` | `TEXT` | ✅ | — | — | الشرح التفصيلي بالإنجليزية (أضيف مهجرة 124) | `"Advanced 7-stage..."` |
| `images` | `JSONB` | ❌ | `'[]'::jsonb` | — | مصفوفة صور المنتج | `["/uploads/sm7.jpg"]` |
| `primary_image_id` | `TEXT` | ✅ | — | — | معرف الصورة المصغرة الرئيسية | `"sm7_main"` |
| `videos` | `JSONB` | ❌ | `'[]'::jsonb` | — | مقاطع فيديو توضيحية | `[]` |
| `documents` | `JSONB` | ❌ | `'[]'::jsonb` | — | ملفات كتيبات ومستندات | `["/uploads/manual.pdf"]` |

> **⚠️ تحذير هيكلي:** الحقل `name` يساوي دائماً `name_ar` والحقل `brand` يساوي `name_en` بحكم دالة `normalizeDevicePayload()` في الكود. هذا تضارب بنيوي — انظر GAP-056.

> **⚠️ لاحظ:** الحقلان `discount_percent` و `discounted_price` اللذان أضيفا في مهجرة 036 تم **حذفهما نهائياً** في مهجرة 128 ونُقلا لجدول `device_discounts` المستقل.

---

### 2.2 جدول قطع الغيار والملحقات `spare_parts`

| الحقل (Field) | النوع (SQL Type) | NULL? | DEFAULT | Constraints | الوصف بالعربية | مثال |
|---|---|---|---|---|---|---|
| `id` | `SERIAL` | ❌ | `nextval()` | `PRIMARY KEY` | المعرف الفريد للقطعة | `12` |
| `name` | `VARCHAR(255)` | ❌ | — | — | الاسم الفعلي للقطعة | `"مضخة ضغط 24 فولت"` |
| `code` | `VARCHAR(100)` | ✅ | — | — | الكود التعريفي للقطعة (لا يوجد UNIQUE) | `"SP-PUMP-24V"` |
| `base_price` | `NUMERIC` | ✅ | `0` | — | السعر الأساسي للقطعة | `120000` (ل.س) |
| `maintenance_type` | `VARCHAR(50)` | ✅ | — | `CHECK (maintenance_type IN ('Periodic', 'Emergency', 'Accessory'))` | فئة الصيانة التي تستخدم بها القطعة | `"Emergency"` |
| `compatible_device_ids` | `JSONB` | ✅ | `'[]'::jsonb` | — | معرفات الأجهزة المتوافقة (بدون FK — فجوة) | `[5, 6]` |

---

### 2.3 جدول خصومات الأجهزة `device_discounts`

| الحقل (Field) | النوع (SQL Type) | NULL? | DEFAULT | Constraints | الوصف بالعربية | مثال |
|---|---|---|---|---|---|---|
| `id` | `SERIAL` | ❌ | `nextval()` | `PRIMARY KEY` | المعرف الفريد للخصم | `3` |
| `device_model_id` | `INTEGER` | ❌ | — | `FK → device_models(id) ON DELETE CASCADE` | الجهاز المستهدف بالخصم | `5` |
| `label` | `VARCHAR(255)` | ❌ | — | `UNIQUE INDEX (device_model_id, label)` | عنوان ومسمى حملة الخصم | `"تخفيضات العيد الوطني"` |
| `percentage` | `NUMERIC` | ❌ | — | `CHECK (percentage >= 0 AND percentage <= 100)` | نسبة الخصم المئوية (فقط نسب — لا مبالغ ثابتة) | `15.00` |
| `start_date` | `DATE` | ❌ | — | — | تاريخ بدء تفعيل الحملة | `2026-05-01` |
| `end_date` | `DATE` | ❌ | — | — | تاريخ نهاية حملة الخصم | `2026-05-31` |
| `is_active` | `BOOLEAN` | ❌ | `TRUE` | — | هل الخصم نشط يدوياً (غير المدى الزمني)؟ | `true` |
| `created_by` | `INTEGER` | ✅ | — | `FK → hr_users(id) ON DELETE SET NULL` | الموظف منشئ الحملة | `7` |
| `created_at` | `TIMESTAMPTZ` | ✅ | `NOW()` | — | تاريخ تسجيل الخصم | `2026-04-20 10:00:00+00` |

> **قيد فريد مركّب:** `UNIQUE INDEX idx_device_discounts_unique_label ON device_discounts(device_model_id, label)` — يمنع تكرار نفس اسم الحملة لنفس الجهاز.
> **الشرط المركّب للخصم الفعّال:** `is_active = TRUE AND start_date <= CURRENT_DATE AND end_date >= CURRENT_DATE`

---

### 2.4 حقول دورة حياة الأجهزة على جدول `contracts`

| الحقل | النوع | NULL? | DEFAULT | القيم المسموحة | الوصف |
|---|---|---|---|---|---|
| `device_model_id` | `INTEGER` | ✅ | — | FK → device_models(id) ON DELETE SET NULL | موديل الجهاز المباع |
| `device_model_name` | `VARCHAR(255)` | ✅ | — | — | لقطة اسم الجهاز (يبقى حتى لو حُذف الموديل) |
| `serial_number` | `VARCHAR(255)` | ✅ | — | — | الرقم التسلسلي الفيزيائي للجهاز |
| `device_status` | `VARCHAR(50)` | ✅ | `'pending_delivery'` | `CHECK (device_status IN ('pending_delivery', 'delivered', 'installed', 'active'))` | حالة الجهاز في دورة الحياة (مهجرة 142) |
| `discount_id` | `INTEGER` | ✅ | — | FK → device_discounts(id) ON DELETE SET NULL | معرف الخصم المرتبط تاريخياً (مهجرة 126) |
| `applied_device_discount_id` | `INTEGER` | ✅ | — | FK → device_discounts(id) ON DELETE SET NULL | الخصم المطبق الفعلي على هذا العقد (مهجرة 130) |
| `maintenance_plan` | `VARCHAR(10)` | ✅ | — | — | خطة الصيانة المرتبطة بالعقد |

**جدول `contract_line_items` — حقول الجهاز:**

| الحقل | النوع | NULL? | DEFAULT | Constraints | الوصف |
|---|---|---|---|---|---|
| `item_type` | `VARCHAR(50)` | ❌ | — | `CHECK (item_type IN ('device', 'accessory', 'service_fee'))` | فئة البند |
| `spare_part_id` | `INTEGER` | ✅ | — | FK → spare_parts(id) ON DELETE SET NULL | قطعة الغيار (إذا كان البند ملحق) |
| `is_installed` | `BOOLEAN` | ✅ | `FALSE` | — | هل تم تركيب هذا البند فعلياً؟ (مهجرة 142) |

---

### 2.5 جداول نتائج المهام المتخصصة

#### A. `visit_task_device_delivery_results` (مهجرة 143)

| الحقل | النوع | NULL? | DEFAULT | الوصف |
|---|---|---|---|---|
| `id` | `BIGSERIAL` | ❌ | — | PK |
| `visit_task_result_id` | `BIGINT` | ❌ | — | FK → visit_task_results(id) CASCADE, UNIQUE |
| `serial_number` | `VARCHAR(100)` | ✅ | — | الرقم التسلسلي للجهاز المسلّم |
| `device_model_id` | `INTEGER` | ✅ | — | FK → device_models(id) ON DELETE SET NULL |
| `delivery_address` | `TEXT` | ✅ | — | عنوان التسليم الفعلي |
| `actual_delivery_date` | `DATE` | ✅ | — | تاريخ التسليم الفعلي |
| `delivered_by_employee_id` | `INTEGER` | ✅ | — | FK → employees(id) ON DELETE SET NULL |
| `customer_acknowledged` | `BOOLEAN` | ✅ | `FALSE` | إقرار الزبون بالاستلام |
| `delivery_condition` | `VARCHAR(50)` | ✅ | — | `CHECK IN ('perfect', 'minor_damage', 'missing_accessories')` |
| `delivery_photos` | `JSONB` | ✅ | `'[]'` | صور التسليم |
| `created_at` | `TIMESTAMPTZ` | ❌ | `NOW()` | — |
| `updated_at` | `TIMESTAMPTZ` | ❌ | `NOW()` | — |

#### B. `open_task_delivery_results` (مهجرة 144)

| الحقل | النوع | NULL? | DEFAULT | الوصف |
|---|---|---|---|---|
| `id` | `BIGSERIAL` | ❌ | — | PK |
| `open_task_id` | `INTEGER` | ❌ | — | FK → open_tasks(id) CASCADE, UNIQUE |
| `outcome` | `VARCHAR(50)` | ❌ | — | `CHECK IN ('delivered_successfully', 'customer_not_available', 'wrong_address', 'refused_delivery')` |
| `serial_number` | `VARCHAR(100)` | ✅ | — | — |
| `device_model_id` | `INTEGER` | ✅ | — | FK → device_models(id) ON DELETE SET NULL |
| `delivery_address` | `TEXT` | ✅ | — | — |
| `actual_delivery_date` | `DATE` | ✅ | — | — |
| `delivered_by_employee_id` | `INTEGER` | ✅ | — | FK → employees(id) ON DELETE SET NULL |
| `customer_acknowledged` | `BOOLEAN` | ❌ | `FALSE` | — |
| `delivery_condition` | `VARCHAR(50)` | ✅ | — | `CHECK IN ('perfect', 'minor_damage', 'missing_accessories')` |
| `delivery_photos` | `JSONB` | ❌ | `'[]'` | — |
| `notes` | `TEXT` | ✅ | — | — |
| `created_at` | `TIMESTAMPTZ` | ❌ | `NOW()` | — |
| `updated_at` | `TIMESTAMPTZ` | ❌ | `NOW()` | — |

#### C. `open_task_installation_results` (مهجرة 145)

| الحقل | النوع | NULL? | DEFAULT | الوصف |
|---|---|---|---|---|
| `id` | `BIGSERIAL` | ❌ | — | PK |
| `open_task_id` | `INTEGER` | ❌ | — | FK → open_tasks(id) CASCADE, UNIQUE |
| `outcome` | `VARCHAR(50)` | ❌ | — | `CHECK IN ('installed_successfully', 'installation_incomplete', 'site_not_ready')` |
| `water_source_type` | `VARCHAR(50)` | ✅ | — | نوع مصدر المياه |
| `pipe_type` | `VARCHAR(50)` | ✅ | — | نوع الأنابيب |
| `pipe_length_meters` | `NUMERIC(8,2)` | ✅ | — | طول الأنابيب بالأمتار |
| `electrical_connection` | `BOOLEAN` | ❌ | `FALSE` | وجود توصيل كهربائي |
| `wall_mounting_done` | `BOOLEAN` | ❌ | `FALSE` | تثبيت الجهاز على الجدار |
| `installed_accessories` | `JSONB` | ❌ | `'[]'` | الملحقات المركبة |
| `installation_start_date` | `DATE` | ✅ | — | بداية التركيب |
| `installation_end_date` | `DATE` | ✅ | — | نهاية التركيب |
| `before_photos` | `JSONB` | ❌ | `'[]'` | صور قبل التركيب |
| `after_photos` | `JSONB` | ❌ | `'[]'` | صور بعد التركيب |
| `technical_notes` | `TEXT` | ✅ | — | ملاحظات فنية |
| `installed_by_employee_id` | `INTEGER` | ✅ | — | FK → employees(id) ON DELETE SET NULL |
| `created_at` | `TIMESTAMPTZ` | ❌ | `NOW()` | — |
| `updated_at` | `TIMESTAMPTZ` | ❌ | `NOW()` | — |

#### D. `visit_task_device_demo_results` (مهجرة 070)

| الحقل | النوع | NULL? | DEFAULT | الوصف |
|---|---|---|---|---|
| `id` | `BIGSERIAL` | ❌ | — | PK |
| `visit_task_result_id` | `BIGINT` | ❌ | — | FK → visit_task_results(id) CASCADE, UNIQUE |
| `offer_type` | `VARCHAR(50)` | ✅ | — | `CHECK IN ('cash', 'installment')` |
| `offer_amount` | `NUMERIC` | ✅ | — | `CHECK >= 0` — مبلغ العرض |
| `installment_months` | `INTEGER` | ✅ | — | `CHECK > 0` — عدد أشهر التقسيط |
| `closed_by_employee_id` | `INTEGER` | ✅ | — | FK → employees(id) ON DELETE SET NULL |
| `contract_id` | `INTEGER` | ✅ | — | FK → contracts(id) ON DELETE SET NULL — العقد المنشأ عند الإغلاق |
| `created_at` | `TIMESTAMPTZ` | ❌ | `NOW()` | — |
| `updated_at` | `TIMESTAMPTZ` | ❌ | `NOW()` | — |

> **⚠️ ملاحظة:** لا يوجد `visit_task_device_activation_results` بالمهجرات المفحوصة (001 إلى 147). الجدول المشار إليه بالدستور السابق لم يُنشأ بعد — انظر GAP-057.

---

### 2.6 جدول `open_task_devices` (مهجرة 086)

| الحقل | النوع | NULL? | DEFAULT | Constraints | الوصف |
|---|---|---|---|---|---|
| `id` | `BIGSERIAL` | ❌ | `nextval()` | `PRIMARY KEY` | المعرف الفريد |
| `task_id` | `INTEGER` | ❌ | — | `FK → open_tasks(id) ON DELETE CASCADE` | المهمة المرتبطة |
| `device_model_id` | `INTEGER` | ✅ | — | `FK → device_models(id) ON DELETE SET NULL` | الجهاز المرتبط بالمهمة |
| `device_name_snapshot` | `VARCHAR(255)` | ❌ | — | — | لقطة اسم الجهاز وقت الإنشاء (للحماية من الحذف) |
| `quantity` | `INTEGER` | ❌ | `1` | — | الكمية |
| `created_at` | `TIMESTAMPTZ` | ❌ | `NOW()` | — | تاريخ الإنشاء |

---

### 2.7 حقول الأجهزة في جداول أخرى

| الجدول | الحقل | النوع | الوصف |
|---|---|---|---|
| `marketing_visit_tasks` | `sold_device_model_id` | `INTEGER FK → device_models` | الجهاز الذي بيع في زيارة تسويقية (مهجرة 087) |
| `marketing_visit_tasks` | `offered_device_model_id` | `INTEGER FK → device_models` | الجهاز الذي عُرض في الزيارة (مهجرة 090) |
| `marketing_visit_tasks` | `applied_device_discount_id` | `INTEGER FK → device_discounts` | الخصم المطبق في عرض المبيعات (مهجرة 130) |
| `marketing_visits` | `requested_device_model_id` | `INTEGER FK → device_models` | الجهاز المطلوب من قِبل العميل للزيارة |
| `open_task_pre_offers` | `device_model_id` | `INTEGER FK → device_models` | الجهاز في العرض المسبق |
| `open_task_pre_offers` | `applied_device_discount_id` | `INTEGER FK → device_discounts` | الخصم في العرض المسبق (مهجرة 134) |
| `emergency_result_parts` | `spare_part_id` | `INTEGER FK → spare_parts` | قطعة الغيار المستخدمة في الطوارئ |
| `visit_task_emergency_parts_used` | `spare_part_id` | `INTEGER FK → spare_parts` | قطعة الغيار في مهام الطوارئ الموحدة |
| `device_technical_states` | `contract_id` | `INTEGER FK → contracts` | ربط الحالة التقنية بالعقد والجهاز |

---

## 3. القيود والقواعد التشغيلية (Business Rules)

### BR-1: آلة دورة حياة الأجهزة — Device Lifecycle State Machine

حالة الجهاز الفيزيائي تُتتبع عبر `contracts.device_status` وتتحرك بواسطة دالة `updateDeviceStatusFromTask()` في `openTasks.ts` (السطر 1510+). الدالة تُطلق تلقائياً عند إكمال مهمة مفتوحة من نوع delivery/installation/activation.

```
[ pending_delivery ]
      │
      │ اكتمال مهمة device_delivery بنجاح
      ▼
[ delivered ]
      │
      │ اكتمال مهمة device_installation بنجاح
      ▼
[ installed ]
      │
      │ اكتمال مهمة device_activation بنجاح
      ▼
[ active ]  ←── هنا فقط يتحول contracts.status إلى 'active'
```

**التشغيل في الكود:**
- `device_delivery` → `contracts.device_status = 'delivered'` (فقط)
- `device_installation` → `contracts.device_status = 'installed'` (فقط)
- `device_activation` → `contracts.device_status = 'active'` + `contracts.status = 'active'` معاً

**توليد مهمة التوصيل تلقائياً:** عند إنشاء عقد من نوع `sale_contract` يقوم الخادم فوراً بإنشاء `open_task` من نوع `device_delivery` مرتبطة بالعقد (`contracts.ts` السطر 474).

---

### BR-2: احتساب وتطبيق الخصومات الزمنية

الشرط المركّب الذي يجب تحققه كاملاً لتطبيق الخصم:

```
is_active = TRUE
AND start_date <= CURRENT_DATE
AND end_date >= CURRENT_DATE
```

**ثبات سعر العقد المبرم:** بمجرد حفظ العقد مع `applied_device_discount_id`، يُخزّن `final_price` كرقم ثابت في العقد. حتى لو حُذف سجل الخصم لاحقاً فإن `applied_device_discount_id` يتحول إلى `NULL` فقط (بفضل `ON DELETE SET NULL`) دون أي تغيير على الأسعار الإجمالية المخزنة.

**ثغرة التداخل الزمني:** لا يوجد فحص يمنع وجود خصومات متداخلة زمنياً بنسب مختلفة لنفس الجهاز في نفس الفترة — انظر GAP-054.

---

### BR-3: نظام التوافق JSONB

حقلان بالغا الأهمية يستخدمان JSONB لتخزين مصفوفات المعرفات بدون Foreign Key:
1. **`spare_parts.compatible_device_ids`:** معرفات الأجهزة المتوافقة مع هذه القطعة
2. **`device_models.supported_visit_types`:** أنواع مهام الزيارات الممكنة لهذا الموديل

**الأثر:** لا يوجد فحص تكامل DB. حذف جهاز لا يُنظّف مصفوفات القطع التي تشير إليه — انظر GAP-053.

---

### BR-4: فاصل الصيانة — Maintenance Interval

الحقل `device_models.maintenance_interval` هو `VARCHAR(50)` حر بالكامل. لا يوجد قيد `CHECK` ولا تحقق في الكود. القيمة الافتراضية التي يحددها الكود عند الإنشاء هي `'6 أشهر'`. لا يوجد نظام جدولة أوتوماتيكية للصيانة بناءً على هذا الحقل — انظر GAP-058.

---

### BR-5: نظام الفئات — Category System

الفئات المتاحة: `Residential` | `Industrial` | `Commercial`.

يستخدم الكود القيمة الافتراضية `'صناعي'` (بالعربية، ليست من قيم الـ CHECK!) عند الإنشاء:
```typescript
category: body.category || 'صناعي'  // ← الافتراضي مخالف للقيود!
```
انظر GAP-059 — الكود يُنتج قيمة غير صالحة عند غياب `category` في الطلب.

---

### BR-6: تتبع نتائج العروض — Demo Conversion

جدول `visit_task_device_demo_results` يربط الجهاز بالعقد عبر `contract_id`. يُعدّ السجل "إغلاق ناجح" إذا وُجد `contract_id` غير NULL. لا يوجد `offered_device_model_id` في هذا الجدول — انظر GAP-055.

---

### BR-7: تتبع التركيب — Installation Tracking

`contract_line_items.is_installed` يتم تحديثه يدوياً عبر مسار مخصص:
```
PUT /api/contracts/:id/line-items/:itemId/installation
```
يتطلب صلاحية `contracts.edit`. لا يتم التحديث تلقائياً عند إكمال مهمة التركيب.

---

### BR-8: ثبات الأسعار — Price Locking

عند إنشاء عقد بخصم: يتم تخزين `final_price` كقيمة ثابتة في `contracts.final_price`. الخصم المطبق يُحفظ في `contracts.applied_device_discount_id` كمرجع. إذا انتهت صلاحية الحملة أو حُذفت لاحقاً، يبقى `final_price` محفوظاً بقيمته الأصلية.

---

## 4. العلاقات البرمجية والفيزيائية (Entity Relationships)

```mermaid
erDiagram
    device_models {
        SERIAL id PK
        VARCHAR name
        VARCHAR name_ar
        VARCHAR name_en NOT_NULL
        VARCHAR category
        NUMERIC base_price
        JSONB supported_visit_types
        BOOLEAN is_golden_warranty
        BOOLEAN is_featured
        VARCHAR code
    }
    spare_parts {
        SERIAL id PK
        VARCHAR name
        NUMERIC base_price
        VARCHAR maintenance_type
        JSONB compatible_device_ids
    }
    device_discounts {
        SERIAL id PK
        INTEGER device_model_id FK
        VARCHAR label
        NUMERIC percentage
        DATE start_date
        DATE end_date
        BOOLEAN is_active
    }
    contracts {
        SERIAL id PK
        INTEGER device_model_id FK
        INTEGER applied_device_discount_id FK
        VARCHAR device_status
        NUMERIC base_price
        NUMERIC final_price
    }
    contract_line_items {
        SERIAL id PK
        INTEGER contract_id FK
        VARCHAR item_type
        INTEGER spare_part_id FK
        BOOLEAN is_installed
    }
    open_task_devices {
        BIGSERIAL id PK
        INTEGER task_id FK
        INTEGER device_model_id FK
        VARCHAR device_name_snapshot
    }
    open_task_delivery_results {
        BIGSERIAL id PK
        INTEGER open_task_id FK
        VARCHAR outcome
        INTEGER device_model_id FK
    }
    open_task_installation_results {
        BIGSERIAL id PK
        INTEGER open_task_id FK
        VARCHAR outcome
    }
    visit_task_results {
        BIGSERIAL id PK
        BIGINT visit_task_id
    }
    visit_task_device_delivery_results {
        BIGSERIAL id PK
        BIGINT visit_task_result_id FK
        INTEGER device_model_id FK
        VARCHAR serial_number
    }
    visit_task_device_demo_results {
        BIGSERIAL id PK
        BIGINT visit_task_result_id FK
        INTEGER contract_id FK
        VARCHAR offer_type
    }

    device_models ||--o{ device_discounts : "has campaigns"
    device_models ||--o{ contracts : "sold via"
    device_models ||--o{ contract_line_items : "referenced in"
    device_models ||--o{ open_task_devices : "snapshot in"
    device_models ||--o{ open_task_delivery_results : "delivered as"
    device_models ||--o{ visit_task_device_delivery_results : "delivered as"
    spare_parts ||--o{ contract_line_items : "added to"
    contracts ||--o{ contract_line_items : "contains"
    contracts ||--o{ visit_task_device_demo_results : "created from"
    device_discounts ||--o{ contracts : "applied to"
    visit_task_results ||--o| visit_task_device_delivery_results : "specialized"
    visit_task_results ||--o| visit_task_device_demo_results : "specialized"
```

---

## 5. آلة الحالات التشغيلية (Lifecycle State Machine)

### 5.1 حالة الجهاز بداخل العقود `contracts.device_status`

```
[ pending_delivery ]  ← الحالة الافتراضية عند إنشاء sale_contract
        │
        │ device_delivery task → مكتمل بنجاح (outcome: delivered_successfully)
        ▼
[ delivered ]
        │
        │ device_installation task → مكتمل بنجاح (outcome: installed_successfully)
        ▼
[ installed ]
        │
        │ device_activation task → مكتمل بنجاح
        ▼
[ active ]  ← فقط هنا يتحول contracts.status إلى 'active'
```

**ملاحظة:** لا توجد حالات لـ `under_maintenance` أو `retired` أو `faulty` — انظر GAP-060.

### 5.2 حالة خصم جهاز `device_discounts` (حالة مركّبة)

```
is_active = FALSE  →  [ خصم معطل يدوياً ]
                              ▲
                              │ Admin يعطل يدوياً
is_active = TRUE AND end_date < TODAY  →  [ خصم منتهي الصلاحية ]

is_active = TRUE AND start_date > TODAY  →  [ خصم لم يبدأ بعد ]

is_active = TRUE AND start_date ≤ TODAY ≤ end_date  →  [ خصم فعّال للتطبيق ]
```

### 5.3 حالة تركيب البند `contract_line_items.is_installed`

```
[ FALSE ]  ← الافتراضي عند إنشاء العقد
    │
    │ PUT /api/contracts/:id/line-items/:itemId/installation
    │ body: { isInstalled: true }
    ▼
[ TRUE ]  ← تم التركيب الفعلي
```

---

## 6. صلاحيات الوصول والمصفوفة الأمنية (Permission Matrix)

### ⚠️ ثغرات أمنية حرجة في `deviceModels.ts`

عند فحص الكود مباشرة، اتضحت الحقيقة الصادمة: **معظم نقاط النهاية لإدارة الأجهزة وقطع الغيار لا تحتوي على أي تحقق من الهوية أو الصلاحيات.**

| الإجراء | المسار | وسيط الأمان الفعلي | الخطورة |
|---|---|---|---|
| استعراض كل الأجهزة | `GET /api/device-models` | ❌ لا شيء (PUBLIC) | 🔴 عالية |
| أجهزة البيع حسب الفرع | `GET /api/device-models/for-sale` | `requireAuth` فقط | 🟡 متوسطة |
| إنشاء جهاز جديد | `POST /api/device-models` | ❌ لا شيء (PUBLIC) | 🔴 حرجة |
| تعديل بيانات جهاز | `PUT /api/device-models/:id` | ❌ لا شيء (PUBLIC) | 🔴 حرجة |
| حذف جهاز من الكتالوج | `DELETE /api/device-models/:id` | ❌ لا شيء (PUBLIC) | 🔴 حرجة |
| استعراض الخصومات اليوم | `GET /api/device-models/:id/discounts` | `requireAuth` فقط | 🟡 متوسطة |
| استعراض كل الخصومات (إدارة) | `GET /api/device-models/:id/discounts/all` | `requireAuth` فقط | 🟡 متوسطة |
| إنشاء خصم مالي | `POST /api/device-models/:id/discounts` | `requireAuth` فقط | 🟡 متوسطة |
| تعديل خصم | `PUT /api/device-models/:id/discounts/:did` | `requireAuth` فقط | 🟡 متوسطة |
| حذف خصم | `DELETE /api/device-models/:id/discounts/:did` | `requireAuth` فقط | 🟡 متوسطة |
| استعراض قطع الغيار | `GET /api/spare-parts` | ❌ لا شيء (PUBLIC) | 🔴 عالية |
| إنشاء قطعة غيار | `POST /api/spare-parts` | ❌ لا شيء (PUBLIC) | 🔴 حرجة |
| تعديل قطعة غيار | `PUT /api/spare-parts/:id` | ❌ لا شيء (PUBLIC) | 🔴 حرجة |
| حذف قطعة غيار | `DELETE /api/spare-parts/:id` | ❌ لا شيء (PUBLIC) | 🔴 حرجة |

**صلاحيات العقود (contracts.ts — محمي بالكامل):**

| الإجراء | المسار | الصلاحية المطلوبة |
|---|---|---|
| استعراض قائمة العقود | `GET /api/contracts` | `contracts.view_list` |
| تفاصيل عقد | `GET /api/contracts/:id` | `contracts.view_list` |
| إنشاء عقد | `POST /api/contracts` | `contracts.create` |
| تعديل عقد | `PUT /api/contracts/:id` | `contracts.edit` |
| حذف عقد | `DELETE /api/contracts/:id` | `contracts.delete` |
| تحديث حالة تركيب ملحق | `PUT /api/contracts/:id/line-items/:itemId/installation` | `contracts.edit` |

---

## 7. عقد واجهة العمليات (API Contract)

### 7.1 جدول نقاط النهاية الكامل

| الطريقة | المسار | Auth | الوصف |
|---|---|---|---|
| `GET` | `/api/device-models` | ❌ PUBLIC | قائمة كل الأجهزة مع كامل بياناتها |
| `GET` | `/api/device-models/for-sale` | `requireAuth` | الأجهزة المصرح ببيعها حسب فرع المستخدم |
| `POST` | `/api/device-models` | ❌ PUBLIC | إنشاء موديل جهاز جديد |
| `PUT` | `/api/device-models/:id` | ❌ PUBLIC | تعديل بيانات موديل |
| `DELETE` | `/api/device-models/:id` | ❌ PUBLIC | حذف موديل من الكتالوج |
| `GET` | `/api/device-models/:id/discounts` | `requireAuth` | الخصومات الفعّالة اليوم لهذا الجهاز |
| `GET` | `/api/device-models/:id/discounts/all` | `requireAuth` | كل الخصومات (إدارة) |
| `POST` | `/api/device-models/:id/discounts` | `requireAuth` | إنشاء حملة خصم جديدة |
| `PUT` | `/api/device-models/:id/discounts/:did` | `requireAuth` | تعديل حملة خصم |
| `DELETE` | `/api/device-models/:id/discounts/:did` | `requireAuth` | حذف حملة خصم |
| `GET` | `/api/spare-parts` | ❌ PUBLIC | قائمة كل قطع الغيار |
| `POST` | `/api/spare-parts` | ❌ PUBLIC | إنشاء قطعة غيار |
| `PUT` | `/api/spare-parts/:id` | ❌ PUBLIC | تعديل قطعة غيار |
| `DELETE` | `/api/spare-parts/:id` | ❌ PUBLIC | حذف قطعة غيار |
| `GET` | `/api/contracts` | `contracts.view_list` | قائمة العقود |
| `GET` | `/api/contracts/:id` | `contracts.view_list` | تفاصيل عقد |
| `POST` | `/api/contracts` | `contracts.create` | إنشاء عقد + delivery task تلقائي |
| `PUT` | `/api/contracts/:id` | `contracts.edit` | تعديل عقد شامل |
| `DELETE` | `/api/contracts/:id` | `contracts.delete` | حذف عقد نهائي |
| `PUT` | `/api/contracts/:id/line-items/:iid/installation` | `contracts.edit` | تحديث حالة تركيب ملحق |

### 7.2 مثال — جلب الخصومات الفعّالة

```http
GET /api/device-models/5/discounts
Authorization: Bearer <token>
```

```json
[
  {
    "id": 3,
    "label": "تخفيضات رمضان 2026",
    "percentage": "15.00",
    "startDate": "2026-03-01",
    "endDate": "2026-03-31"
  }
]
```

### 7.3 مثال — إنشاء جهاز جديد

```http
POST /api/device-models
Content-Type: application/json

{
  "nameAr": "فلتر 7 مراحل ذكي",
  "nameEn": "7-Stage Smart Filter",
  "basePrice": 650000,
  "category": "Residential",
  "maintenanceInterval": "6 أشهر",
  "isGoldenWarranty": true,
  "goldenWarrantyPeriods": [{"months": 24}],
  "isFeatured": true,
  "code": "GW-SM7-2026"
}
```

### 7.4 مثال — تحديث حالة تركيب ملحق

```http
PUT /api/contracts/22/line-items/102/installation
Authorization: Bearer <token>
Content-Type: application/json

{ "isInstalled": true }
```

```json
{ "success": true, "isInstalled": true }
```

---

## 8. حالات الاختبار الشاملة (Test Cases)

| معرف | السيناريو | Method | المدخلات | النتيجة المتوقعة |
|---|---|---|---|---|
| **TC-01** | جلب قائمة الأجهزة بدون جلسة | GET | `/api/device-models` (بدون Token) | 200 OK — تُرجع المصفوفة الكاملة (Public endpoint خطير!) |
| **TC-02** | جلب أجهزة البيع المصرح بها | GET | `/api/device-models/for-sale` + Bearer Token + X-Branch-Id | 200 OK — تُرجع فقط الأجهزة التابعة لفرع المستخدم |
| **TC-03** | إنشاء جهاز بدون جلسة | POST | `/api/device-models` + بيانات كاملة (بدون Token) | 200 OK — يُنشأ الجهاز! (ثغرة أمنية حرجة GAP-050) |
| **TC-04** | إنشاء جهاز بقيمة category عربية | POST | `{"nameAr":"...", "nameEn":"...", "basePrice":650000}` (بدون category) | 200 OK لكن category='صناعي' (قيمة خارج CHECK — GAP-059) |
| **TC-05** | إضافة خصم بنسبة خارج المجال | POST | `/api/device-models/5/discounts` + percentage=-5 | النسبة تُثبَّت عند 0 (Math.max/min في الكود) |
| **TC-06** | إنشاء خصم مكرر لنفس الجهاز | POST | خصم بنفس label لجهاز موجود | 400 Bad Request — "في حملة بنفس الاسم" |
| **TC-07** | جلب خصم منتهي الصلاحية | GET | `/api/device-models/5/discounts` بعد end_date | 200 OK — مصفوفة فارغة (الخصم المنتهي لا يظهر) |
| **TC-08** | إنشاء عقد — توليد مهمة توصيل تلقائي | POST | `/api/contracts` + contractType='sale_contract' | 200 OK + إنشاء open_task من نوع device_delivery تلقائياً |
| **TC-09** | إكمال مهمة توصيل — انتقال حالة الجهاز | POST | إكمال open_task نوع device_delivery | contracts.device_status → 'delivered' |
| **TC-10** | إكمال مهمة تركيب — انتقال الحالة | POST | إكمال open_task نوع device_installation | contracts.device_status → 'installed' |
| **TC-11** | إكمال مهمة تشغيل — تنشيط العقد | POST | إكمال open_task نوع device_activation | device_status → 'active' + contracts.status → 'active' |
| **TC-12** | تحديث حالة تركيب ملحق | PUT | `/api/contracts/22/line-items/102/installation` + isInstalled:true | 200 OK + contract_line_items.is_installed = TRUE |
| **TC-13** | التحقق من توافق قطعة الغيار (JSONB) | GET | قطعة لها compatible_device_ids=[5,6] + بحث عن قطع جهاز 5 | يجب فلترة برمجية (لا FK في الـ DB) |
| **TC-14** | حذف جهاز مباع — قطع المرجعية | DELETE | حذف جهاز له عقود مرتبطة | 200 OK لكن contracts.device_model_id → NULL (ON DELETE SET NULL) |
| **TC-15** | إنشاء قطعة غيار بدون جلسة | POST | `/api/spare-parts` + بيانات القطعة (بدون Token) | 200 OK — يُنشأ (ثغرة أمنية GAP-050) |

---

## 9. الثغرات والتضاربات المكتشفة (Gaps & Contradictions)

### 🔴 GAP-050: Public Access على إدارة الأجهزة وقطع الغيار (حرجة)

| البند | التفصيل |
|---|---|
| **الموقع** | `packages/api/routes/deviceModels.ts` سطر 162، 322، 402، 468 / `spareParts.ts` سطر 78، 137، 198، 248 |
| **الوصف** | مسارات POST/PUT/DELETE للأجهزة تخلو تماماً من `requireAuth` — أي شخص بالإنترنت يستطيع تعديل أسعار الكتالوج أو حذف الأجهزة. |
| **الأثر** | شلل تشغيلي — تعديل الأسعار يؤثر فوراً على حسابات العقود الجديدة. |
| **الحل** | إضافة `requireAuth` + `requirePermission('catalog.manage')` لجميع مسارات الكتابة. |
| **الحالة** | ⏳ مفتوحة |

### 🔴 GAP-051: غياب صلاحيات مخصصة لإدارة الخصومات (عالية)

| البند | التفصيل |
|---|---|
| **الموقع** | `packages/api/routes/deviceModels.ts` (Discounts endpoints) |
| **الوصف** | مسارات إنشاء وتعديل وحذف الخصومات المالية تكتفي بـ `requireAuth` فقط دون صلاحية مخصصة. |
| **الأثر** | أي موظف ميداني يمتلك حساباً يستطيع إنشاء خصم 100% وتطبيقه على المبيعات. |
| **الحل** | بذر صلاحية `devices.discounts.manage` وتطبيقها. |
| **الحالة** | ⏳ مفتوحة |

### 🟡 GAP-052: Hard Delete يتيّم بيانات العقود (متوسطة)

| البند | التفصيل |
|---|---|
| **الموقع** | `packages/api/routes/deviceModels.ts` سطر 468 / `spareParts.ts` سطر 248 |
| **الوصف** | حذف جهاز يُفرغ `device_model_id` في العقود القديمة إلى NULL مع بقاء `device_model_name` كلقطة نصية فقط. لا يوجد soft-delete. |
| **الأثر** | فقدان الربط بين العقود التاريخية وموديلات الأجهزة — ضرب التقارير المالية. |
| **الحل** | إضافة `deleted_at` لجدولي `device_models` و`spare_parts`. |
| **الحالة** | ⏳ مفتوحة |

### 🟡 GAP-053: JSONB Arrays بدون تكامل مرجعي (متوسطة)

| البند | التفصيل |
|---|---|
| **الموقع** | `spare_parts.compatible_device_ids` / `device_models.supported_visit_types` |
| **الوصف** | مصفوفات JSONB تخزن معرفات أجهزة وأنواع زيارات بدون FK — حذف جهاز لا يُنظّف مصفوفات التوافق. |
| **الأثر** | معرفات تالفة تُسبب فشل استعلامات التوافق. |
| **الحل** | إما جداول ربط مستقلة أو trigger يُنظّف المصفوفات عند الحذف. |
| **الحالة** | ⏳ مفتوحة |

### 🟡 GAP-054: غياب فحص التداخل الزمني للخصومات (متوسطة)

| البند | التفصيل |
|---|---|
| **الموقع** | `packages/api/routes/deviceModels.ts` (POST/PUT discounts) |
| **الوصف** | لا يوجد فحص يمنع وجود خصمين متداخلين زمنياً بنسب مختلفة لنفس الجهاز. |
| **الأثر** | السيرفر لا يعرف أي خصم يطبق عند التعارض — قد يطبق الأرخص أو الأقدم عشوائياً. |
| **الحل** | فحص `OVERLAPS` في SQL عند إنشاء/تعديل الخصم أو قيد `EXCLUDE` في PostgreSQL. |
| **الحالة** | ⏳ مفتوحة |

### 🟡 GAP-055: `visit_task_device_demo_results` يفتقر لمعرف الجهاز المعروض (متوسطة)

| البند | التفصيل |
|---|---|
| **الموقع** | `migrations/070_visit_core_schema.sql` |
| **الوصف** | الجدول يحفظ `offer_amount` و`contract_id` لكن لا يحتوي على `offered_device_model_id`. من المستحيل معرفة أي جهاز عُرض في هذه الزيارة مباشرة. |
| **الأثر** | تعذّر تحليل نسبة التحويل per-device للعروض الميدانية. |
| **الحل** | إضافة `offered_device_model_id INTEGER FK → device_models` لهذا الجدول. |
| **الحالة** | ⏳ مفتوحة |

### 🔴 GAP-056: ازدواجية `name`/`brand` مع `name_ar`/`name_en` (عالية)

| البند | التفصيل |
|---|---|
| **الموقع** | `packages/api/routes/deviceModels.ts` دالة `normalizeDevicePayload()` |
| **الوصف** | الكود يُجبر دائماً: `name = name_ar` و`brand = name_en`. الحقلان `name` و`brand` الأصليان من المهجرة الأولى زائدان وغير مستقلان. |
| **الأثر** | تضليل المطورين — أربعة حقول بدلاً من اثنين، وتكرار بيانات في كل سجل. |
| **الحل** | إسقاط `name` و`brand` والاعتماد الكامل على `name_ar` و`name_en`. |
| **الحالة** | ⏳ مفتوحة |

### 🔴 GAP-057: `visit_task_device_activation_results` غير موجود في المهجرات (عالية)

| البند | التفصيل |
|---|---|
| **الموقع** | مهجرات 001-147 — مفحوصة كاملاً |
| **الوصف** | الدستور السابق وبعض الوثائق تشير لجدول `visit_task_device_activation_results` لكنه لم يُنشأ في أي مهجرة مفحوصة حتى المهجرة 147. |
| **الأثر** | مرحلة التشغيل الأولي `device_activation` تُحدّث `device_status` برمجياً لكن لا تُخزّن نتائج تقنية مفصّلة. |
| **الحل** | إنشاء المهجرة المناسبة لهذا الجدول أو التوثيق الصريح لعدم وجوده. |
| **الحالة** | ⏳ مفتوحة |

### 🟡 GAP-058: `maintenance_interval` VARCHAR غير مقيد (متوسطة)

| البند | التفصيل |
|---|---|
| **الموقع** | `migrations/001_core_tables.sql` (device_models.maintenance_interval) |
| **الوصف** | الحقل VARCHAR(50) بدون CHECK constraint + الافتراضي في الكود `'6 أشهر'` (نص عربي) — لا يوجد نظام جدولة أوتوماتيكية للصيانة بناءً عليه. |
| **الأثر** | البيانات لا تُولّد مهام صيانة — الحقل تزييني فقط في الوقت الحالي. |
| **الحل** | تحويل إلى `INTEGER` (عدد أشهر) + CHECK > 0 + منطق جدولة الصيانة الدورية. |
| **الحالة** | ⏳ مفتوحة |

### 🔴 GAP-059: القيمة الافتراضية لـ category مخالفة للـ CHECK (عالية)

| البند | التفصيل |
|---|---|
| **الموقع** | `packages/api/routes/deviceModels.ts` سطر 42 |
| **الوصف** | `category: body.category \|\| 'صناعي'` — القيمة الافتراضية عربية `'صناعي'` بينما الـ CHECK يسمح فقط بـ `'Residential', 'Industrial', 'Commercial'` (إنجليزية). |
| **الأثر** | أي طلب POST بدون category → يخزن `'صناعي'` → يخالف الـ CHECK constraint → خطأ DB 500. |
| **الحل** | تصحيح الافتراضي: `category: body.category \|\| 'Industrial'` |
| **الحالة** | ⏳ مفتوحة |

### 🟡 GAP-060: محدودية حالات `device_status` (متوسطة)

| البند | التفصيل |
|---|---|
| **الموقع** | `migrations/142_contract_device_tracking.sql` |
| **الوصف** | القيم المسموحة `pending_delivery, delivered, installed, active` فقط. لا توجد حالات للأجهزة المعطوبة أو المسحوبة أو المتوقفة. |
| **الأثر** | لا يمكن تتبع أجهزة معطلة (`faulty`) أو مسحوبة (`retrieved`) أو موقوفة (`disconnected`). |
| **الحل** | توسيع CHECK لإضافة حالات `under_maintenance`, `faulty`, `retrieved`, `disconnected`. |
| **الحالة** | ⏳ مفتوحة |

### 🟢 GAP-061: `code` بدون UNIQUE constraint (منخفضة)

| البند | التفصيل |
|---|---|
| **الموقع** | `migrations/125_device_code.sql` |
| **الوصف** | الحقل `device_models.code` لا يملك قيد `UNIQUE` — يمكن نظرياً أن يتكرر نفس الكود لأجهزة مختلفة. |
| **الأثر** | فشل استعلامات البحث بالكود، وإرباك فرق المخازن والتوزيع. |
| **الحل** | `CREATE UNIQUE INDEX ON device_models(code) WHERE code IS NOT NULL;` |
| **الحالة** | ⏳ مفتوحة |

---

## 10. سجل التغييرات وهيكلية قاعدة البيانات (Schema Changelog)

| المهجرة | التأثير | التفاصيل |
|---|---|---|
| `001_core_tables.sql` | **تأسيس النواة** | إنشاء `device_models`, `spare_parts`, `contracts` بحقولهم الأساسية |
| `036_device_model_catalog_fields.sql` | **توسيع الكتالوج** | إضافة `name_ar`, `name_en`, `discount_percent`, `discounted_price`, `is_golden_warranty`, `golden_warranty_periods`, `is_offer_included`, `description`, `images`, `primary_image_id`, `videos`, `documents` |
| `051_marketing_visits_mvp.sql` | **ربط التسويق بالأجهزة** | `marketing_visits.requested_device_model_id FK → device_models` |
| `070_visit_core_schema.sql` | **نتائج العروض الموحدة** | إنشاء `visit_task_device_demo_results` (نتائج عروض المبيعات) |
| `086_open_task_devices.sql` | **مهام الأجهزة المفتوحة** | إنشاء `open_task_devices` (لقطة الأجهزة بالمهام المفتوحة) |
| `087_marketing_visit_tasks_result_fields.sql` | **حقول نتائج الزيارات** | إضافة `currency`, `discount_percentage`, `sold_device_model_id`, `no_closing_reason` إلى `marketing_visit_tasks` |
| `090_add_offered_device_model.sql` | **جهاز العرض التسويقي** | إضافة `offered_device_model_id FK → device_models` إلى `marketing_visit_tasks` |
| `106_task_type_config.sql` | **20 نوع مهمة معتمد** | بذر `task_type_config` بكل أنواع مهام الأجهزة: delivery، installation، activation، maintenance، demo |
| `116_emergency_result_phases.sql` | **الحالات التقنية للأجهزة** | إنشاء `device_technical_states` (تاريخ القياسات الفنية) + `emergency_maintenance_actions` + `emergency_result_costs` |
| `117_emergency_result_enhancements.sql` | **قطع غيار الطوارئ** | إنشاء `emergency_result_parts` (قطع الطوارئ مع سبب عدم استرداد القطعة القديمة) |
| `122_device_discounts.sql` | **نظام الخصومات الزمني** | إنشاء `device_discounts` (الجدول المستقل للحملات التخفيضية) |
| `123_rename_is_featured.sql` | **إعادة تسمية** | إعادة تسمية `is_offer_included` → `is_featured` |
| `124_device_bilingual.sql` | **إلزامية الإنجليزي** | إضافة `description_en` + جعل `name_en NOT NULL` |
| `125_device_code.sql` | **رمز المنتج** | إضافة `code VARCHAR(255)` لموديلات الأجهزة (بدون UNIQUE) |
| `126_contract_enhancements.sql` | **بنود العقد** | إنشاء `contract_line_items` + إضافة `discount_id`, `sale_source`, `applied_discount` للعقود |
| `128_drop_device_fixed_discount.sql` | **إزالة الخصم القديم** | حذف `discount_percent` و`discounted_price` من `device_models` |
| `129_discount_constraints.sql` | **فرض فرادة الخصم** | إضافة `UNIQUE INDEX (device_model_id, label)` لجدول الخصومات |
| `130_applied_device_discount_id.sql` | **تطبيق الخصم المبرم** | إضافة `applied_device_discount_id FK → device_discounts` للعقود و`marketing_visit_tasks` |
| `134_pre_offer_applied_discount.sql` | **خصم العرض المسبق** | إضافة `applied_device_discount_id` لـ `open_task_pre_offers` |
| `142_contract_device_tracking.sql` | **دورة حياة الأجهزة** | إضافة `contracts.device_status` (CHECK: pending_delivery/delivered/installed/active) + `contract_line_items.is_installed` |
| `143_device_delivery_results.sql` | **نتائج توصيل الزيارات** | إنشاء `visit_task_device_delivery_results` (للنظام الموحد) |
| `144_delivery_task_permissions.sql` | **صلاحيات التوصيل** | إنشاء `open_task_delivery_results` + بذر صلاحيات: `tasks.delivery.*`, `tasks.installation.create`, `tasks.activation.create` |
| `145_device_installation_results.sql` | **نتائج التركيب** | إنشاء `open_task_installation_results` + بذر صلاحيات: `tasks.installation.view`, `tasks.installation.result` |
| `147_visit_tasks_device_demo.sql` | **توحيد نتائج العروض** | إضافة `visit_tasks.legacy_result VARCHAR(50)` (جسر الهجرة للبيانات القديمة) |
