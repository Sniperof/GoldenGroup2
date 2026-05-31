# دستور الكيان: التسويق الهاتفي (Telemarketing Domain Constitution)

> **الحالة (Status):** Active Draft / Authoritative  
> **المرجع الأعلى لكيانات وأنشطة التسويق الهاتفي وكشوف وجداول الاتصالات، والمكالمات، والمواعيد المحجوزة، وأهداف الاتصال اليومية.**

---

## 1. هوية الكيان (Entity Identity)

- **الاسم العربي:** التسويق الهاتفي / مركز الاتصال
- **الاسم الإنجليزي:** Telemarketing
- **الجداول الرئيسية:** 
  1. `telemarketing_task_lists` (كشوف الاتصال اليومية الموزعة على الفرق).
  2. `telemarketing_task_list_items` (بنود الاتصال والعملاء المرشحين الفرديين داخل الكشف).
  3. `telemarketing_call_logs` (سجلات توثيق المكالمات الهاتفية الجارية ونتائجها التفصيلية).
  4. `telemarketing_appointments` (مواعيد الزيارات الميدانية المحجوزة هاتفياً).
  5. `contact_targets` (الأهداف والذمم اليومية المخصصة للمتابعة والتحصيل والجدولة).
- **الوصف:** السلسلة الهيكلية الحاكمة لعمليات التواصل الصوتي والرسائل الهاتفية المباشرة مع الزبائن (`clients`) والمرشحين (`candidates`). يقوم الكيان بدور الوسيط والتكامل التشغيلي بين التخطيط (الخلفي) والتنفيذ الميداني للفنيين والفرق، حيث يحوّل أهداف الاتصال اليومية إلى مكالمات فعلية مسجلة ونتائج محددة، ثم يثبت مواعيد مؤكدة تنطلق منها مهام التركيب والزيارات والتحصيل.
- **الأهمية والأمان:** يمثل العمود الفقري لتوليد المبيعات وتنظيم خدمة العملاء. أي تسريب في بيانات الاتصال أو تلاعب في المواعيد وحالات الأرقام المعتمدة يضر بالمستهدف المالي اليومي للشركة ويسرب البيانات المنافسة. يخضع لرقابة صلاحيات مشددة على مستوى الفرع لتأمين الفلترة الجغرافية.

---

## 2. معجم الجداول والحقول (Table & Field Dictionary)

### 2.1 جدول كشوف الاتصال `telemarketing_task_lists`

يخزن الكشوف اليومية الحاضنة لبنود الاتصالات الموزعة على فرق الاتصال الهاتفي.

| الحقل (Field) | النوع (SQL Type) | NULL? | DEFAULT | Constraints | الوصف والشرح بالعربية | مثال واقعي (Example) |
|---|---|---|---|---|---|---|
| `id` | `VARCHAR(100)` | ❌ | — | `PRIMARY KEY` | المعرف الفريد النصي للكشف (UUID) | `"list-99214"` |
| `team_key` | `VARCHAR(100)` | ❌ | — | — | كود فريق الاتصال المخصص له الكشف | `"team_tele_damascus"` |
| `date` | `VARCHAR(50)` | ❌ | — | `UNIQUE (team_key, date)` | تاريخ التشغيل الفعلي الجاري للكشف | `"2026-05-24"` |
| `created_at` | `TIMESTAMPTZ` | ✅ | `NOW()` | — | تاريخ إنشاء الكشف بقاعدة البيانات | `"2026-05-24T20:45:00Z"` |

---

### 2.2 جدول بنود الكشوف `telemarketing_task_list_items`

يخزن العملاء أو المرشحين المدرجين في كشف الاتصال وحالة الاتصال الفردية الجارية معهم.

| الحقل (Field) | النوع (SQL Type) | NULL? | DEFAULT | Constraints | الوصف والشرح بالعربية | مثال واقعي (Example) |
|---|---|---|---|---|---|---|
| `id` | `VARCHAR(100)` | ❌ | — | `PRIMARY KEY` | المعرف الفريد النصي للبند | `"item-8012"` |
| `task_list_id` | `VARCHAR(100)` | ❌ | — | `FK → ...task_lists(id) ON DELETE CASCADE` | معرف الكشف التابع له البند | `"list-99214"` |
| `entity_type` | `VARCHAR(20)` | ❌ | — | `CHECK (entity_type IN ('candidate', 'client'))`| نوع الكيان المستهدف (`candidate` أو `client`) | `"candidate"` |
| `entity_id` | `INTEGER` | ❌ | — | — | معرف الكيان الفردي (الزبون أو المرشح) | `1024` |
| `name` | `VARCHAR(255)` | ❌ | — | — | اسم الشخص المستهدف بالاتصال الفعلي | `"محمد أحمد يوسف"` |
| `mobile` | `VARCHAR(50)` | ❌ | — | — | رقم الهاتف المحمول الأساسي للاتصال | `"0991234567"` |
| `contact_number`| `VARCHAR(50)` | ✅ | — | — | رقم هاتف بديل إضافي للتواصل | `"0933281928"` |
| `contact_label` | `VARCHAR(255)` | ✅ | — | — | تسمية تصنيف هاتف البديل (المنزل، العمل) | `"المنزل"` |
| `address_text` | `TEXT` | ✅ | — | — | العنوان النصي التفصيلي لموقع العميل | `"دمشق، الميدان، بناية الصفا"` |
| `geo_unit_id` | `INTEGER` | ✅ | — | — | معرف المنطقة السكنية الجغرافية للعميل | `12` |
| `status` | `VARCHAR(20)` | ✅ | `'pending'` | `CHECK (status IN ('pending', 'called', 'booked'))`| حالة بند الاتصال الحالية | `"called"` |
| `call_outcome` | `VARCHAR(50)` | ✅ | — | — | نتيجة الاتصال الأخيرة التي تم تدوينها | `"not_interested"` |
| `contact_target_id`| `BIGINT`| ✅ | — | `FK → contact_targets(id) ON DELETE SET NULL` | معرف مستهدف الاتصال المسبب للجدولة | `3042` |

---

### 2.3 جدول سجل مكالمات التسويق `telemarketing_call_logs`

يوثق التتبع التاريخي والجنائي لكافة محاولات الاتصال والمكالمات الهاتفية الجارية.

| الحقل (Field) | النوع (SQL Type) | NULL? | DEFAULT | Constraints | الوصف والشرح بالعربية | مثال واقعي (Example) |
|---|---|---|---|---|---|---|
| `id` | `VARCHAR(100)` | ❌ | — | `PRIMARY KEY` | المعرف الفريد لسجل المكالمة | `"call-5510"` |
| `entity_type` | `VARCHAR(20)` | ❌ | — | `CHECK (entity_type IN ('candidate', 'client'))`| نوع الكيان المستهدف | `"client"` |
| `entity_id` | `INTEGER` | ❌ | — | — | معرف الكيان (الزبون أو المرشح) | `1024` |
| `task_list_id` | `VARCHAR(100)` | ✅ | — | — | معرف كشف الاتصال التابع له (إن وجد) | `"list-99214"` |
| `team_key` | `VARCHAR(100)` | ❌ | — | — | كود فريق الاتصال الجاري المكالمة | `"team_tele_damascus"` |
| `outcome` | `VARCHAR(50)` | ❌ | — | `CHECK (outcome IN ...)` | النتيجة النهائية الصارمة للمكالمة (21 نتيجة) | `"booked_marketing_appointment"` |
| `contact_label` | `VARCHAR(255)` | ✅ | — | — | تسمية تصنيف هاتف العميل المتصل به | `"الأساسي"` |
| `contact_number`| `VARCHAR(50)` | ✅ | — | — | رقم الهاتف الفعلي الذي تم التواصل معه | `"0991234567"` |
| `notes` | `TEXT` | ✅ | — | — | تفاصيل وملاحظات المكالمة الهاتفية يدوياً | `"طلب الاتصال به غداً لعدم التفرغ"` |
| `timestamp` | `TIMESTAMPTZ` | ✅ | `NOW()` | — | تاريخ ووقت إجراء وتوثيق المكالمة | `"2026-05-24T20:46:00Z"` |
| `called_by` | `INTEGER` | ✅ | — | — | معرف الموظف الذي أجرى المكالمة | `12` |
| `communication_method`| `VARCHAR(30)`| ✅ | — | — | وسيلة الاتصال المعتمدة (هاتف، واتساب) | `"phone"` |
| `contact_target_id`| `BIGINT`| ❌ 🆕 | — | `FK → contact_targets(id) ON DELETE RESTRICT` | معرف `contact_target` واحد محدد (DEC-006 D34 — كل مكالمة تربط بهدف واحد). الواجهة تُلزم اختياره قبل تسجيل النتيجة | `3042` |

---

### 2.4 جدول مواعيد التسويق `telemarketing_appointments`

يخزن المواعيد الجاري حجزها هاتفياً وتفاصيل الزيارات المبرمة.

| الحقل (Field) | النوع (SQL Type) | NULL? | DEFAULT | Constraints | الوصف والشرح بالعربية | مثال واقعي (Example) |
|---|---|---|---|---|---|---|
| `id` | `VARCHAR(100)` | ❌ | — | `PRIMARY KEY` | المعرف الفريد النصي للموعد | `"appt-7741"` |
| `entity_type` | `VARCHAR(20)` | ❌ | — | `CHECK (entity_type IN ('candidate', 'client'))`| نوع الكيان المستهدف بالموعد | `"candidate"` |
| `entity_id` | `INTEGER` | ❌ | — | — | معرف الكيان (الزبون أو المرشح) | `1024` |
| `customer_name` | `VARCHAR(255)` | ❌ | — | — | اسم العميل وقت حجز الموعد (Denormalized) | `"محمد أحمد يوسف"` |
| `customer_address`| `TEXT` | ✅ | — | — | العنوان المعتمد للزيارة ميدانياً للزبون | `"الميدان، بناية الصفا"` |
| `customer_mobile`| `VARCHAR(50)` | ✅ | — | — | رقم تواصل العميل للموعد المعتمد الفعلي | `"0991234567"` |
| `team_key` | `VARCHAR(100)` | ❌ | — | — | كود الفريق المكلف بالاتصال وصاحب الموعد | `"team_tele_damascus"` |
| `date` | `VARCHAR(50)` | ❌ | — | — | التاريخ المحدد للزيارة الميدانية المعتمد | `"2026-05-26"` |
| `time_slot` | `VARCHAR(50)` | ❌ | — | — | الفترة الزمنية لحضور الفريق (شريحة الوقت) | `"10:00-11:00"` |
| `occupation` | `VARCHAR(255)` | ✅ | — | — | لقطة لمهنة العميل وقت كتابة الموعد | `"مهندس"` |
| `water_source` | `VARCHAR(255)` | ✅ | — | — | لقطة لمصدر المياه المستخدم لدى العميل | `"شبكة رئيسية"` |
| `notes` | `TEXT` | ✅ | — | — | ملاحظات إضافية حول الموعد المبرم | `"الرجاء إحضار عينات فحص المياه"` |
| `created_at` | `TIMESTAMPTZ` | ✅ | `NOW()` | — | تاريخ إنشاء موعد الحجز | `"2026-05-24T20:46:00Z"` |
| `created_by` | `INTEGER` | ✅ | — | — | معرف الموظف الذي حجز الموعد هاتفياً | `12` |
| `contact_target_id`| `BIGINT`| ✅ | — | `FK → contact_targets(id) ON DELETE SET NULL` | معرف مستهدف الاتصال المربوط بالموعد | `3042` |
| `answered_by` | `VARCHAR(50)` | ✅ | — | — | اسم الشخص الذي أجاب على المكالمة وحجز | `"أخت العميل"` |

---

### 2.5 جدول أهداف الاتصال `contact_targets`

> الحالة بعد DEC-005. توسعة كاملة لقواعد الفلتر ودورة الحياة ومستوى grain. راجع decisions/DEC-005-contact-targets-filter.md للقرارات الكاملة.

يوثق الأهداف اليومية للتواصل الهاتفي. كل سجل يمثل (زبون + موقع عمل + يوم تشغيلي) واحد. السجل الواحد قد يحوي مهام من أنواع متعددة عند نفس الموقع.

| الحقل (Field) | النوع (SQL Type) | NULL? | الوصف |
|---|---|---|---|
| `id` | `BIGSERIAL` | ❌ | المعرف الفريد |
| `branch_id` | `INTEGER` | ❌ | الفرع التشغيلي |
| `target_type` | `VARCHAR(50)` | ❌ | نوع الهدف، حالياً `'client'` فقط |
| `target_id` | `INTEGER` | ❌ | معرف الزبون |
| `work_location_geo_unit_id` 🆕 (DEC-005 D27) | `INTEGER` | ❌ | عنوان العمل من task_type_config.location_basis. عنوان الزبون لمهام marketing، عنوان الجهاز لمهام service و collection |
| `visit_type` | `VARCHAR(50)` | ❌ | `marketing` \| `service` \| `collection` \| `mixed` (موسّع بـ D24) |
| `source_id` | `INTEGER` | ❌ | معرف المصدر |
| `supervisor_hr_user_id` | `INTEGER` | ✅ | المشرف المسؤول |
| `zone_id` | `INTEGER` | ✅ | المنطقة الجغرافية المرتبطة بـ route_assignment |
| `team_key` | `VARCHAR(100)` | ✅ | الفريق المسؤول (محسوب من route_assignments) |
| `status` | `VARCHAR(50)` | ❌ | `new` \| `queued` \| `in_call_list` \| `contacted` \| `closed` \| `cancelled` |
| `latest_call_outcome` | `VARCHAR(50)` | ✅ | آخر نتيجة مكالمة |
| `latest_task_list_item_id` | `VARCHAR(100)` | ✅ | معرف آخر بند كشف تواصل |
| `latest_visit_id` (DEC-004 D23) | `BIGINT` | ✅ | معرف الزيارة الأحدث (محل `latest_appointment_id`) |
| `closing_reason` 🆕 (DEC-005 D26) | `VARCHAR(50)` | ✅ | `booked` \| `manual_telemarketer` \| `manual_supervisor` \| `auto_closed_by_cron` \| `cooldown_set` |
| `closed_by` 🆕 | `INTEGER` FK | ✅ | من أغلق |
| `closed_at` 🆕 | `TIMESTAMPTZ` | ✅ | متى أُغلق |
| `created_at` / `updated_at` | `TIMESTAMPTZ` | ❌ | timestamps |
| `date` | `DATE` | ✅ | اليوم التشغيلي |

**حقول محذوفة (DEC-005 D30):**
- ❌ `target_stage` — كان CHECK يقبل `'lead'` فقط، لم يُستخدم لاتخاذ قرار.
- ❌ `source_type` — نفس الوضع، CHECK يقبل `'lead'` فقط.

**UNIQUE constraint جديد (DEC-005 D27):**
```
UNIQUE (branch_id, target_id, work_location_geo_unit_id, date)
```

محذوف من المفتاح: `visit_type` (السجل يجمع كل الأنواع في الموقع نفسه)، `source_type` (الحقل محذوف).

---

## 3. القيود والقواعد (Constraints & Business Rules)

### 3.1 قيود محددات قاعدة البيانات (Database Constraints)
- **Cascade Deletion:** تتمتع بنود الكشوف `telemarketing_task_list_items` بقيد ربط مباشر `ON DELETE CASCADE` مع كشف الاتصال الرئيسي `telemarketing_task_lists` مما يزيل البنود تلقائياً في حال حذف الكشف.
- **outcome CHECK Constraint:** يفرض جدول سجل المكالمات `telemarketing_call_logs` قيد فحص متكامل لـ 21 نتيجة صحيحة ومطابقة ومترجمة (انظر BR-1).
- **Date-Zone Daily Unique Constraint:** يفرض حقل الأهداف قيد تكرار يومي صارم لمنع تداخل تحضير المكالمات لنفس العميل بنفس اليوم والفرقة الجغرافية:
  `UNIQUE (branch_id, target_type, target_id, visit_type, source_type, date, zone_id)`.

### 3.2 قواعد العمل البرمجية والتشغيلية (Business Rules)

#### BR-1: هيكل محصلة المكالمات الهاتفية (Telemarketing Outcome System) — محدّث بـ DEC-006 D39

> **التحوّل (DEC-006 D39):** عدد النتائج انخفض إلى **16** عبر دمج المتشابهات. الأسباب الفرعية تُفصل في قوائم `system_lists`.
>
> **outcomes المحذوفة:** `other_company_not_interested`، `seen_offer_not_interested`، `other_company_callback`، `seen_offer_callback`.
> **outcomes المُضافة:** `customer_requested_followup` (يحل محل callback المحذوفتين).
> **outcomes المعدّلة دلالياً:** `not_interested` تستوعب الآن "غير مهتم نهائياً" بكل أسبابه؛ الأسباب اختيارية من `not_interested_reasons` لأغراض التقارير لا للمنطق.

التطبيق يوفر 16 نتيجة معيارية مقسمة لـ 5 مجموعات كبرى بالاتساق المطلق مع السيرفر و `telemarketingOutcomes.ts`:
1. **لم يتم التواصل (`not_reached`):** `no_answer`, `busy`, `out_of_coverage`, `not_in_service`, `wrong_number`, `auto_disconnected`, `message_sent`.
2. **تم التواصل - بدون موعد (`reached`):** `currently_busy`, `interrupted`, `not_interested` (موحّدة)، `address_updated`, `new_number`.
3. **تم التواصل - طلب خدمة (`service_request`):** `service_request`, `company_customer_missing_phone`.
4. **حجز موعد (`booked`):** `booked_marketing_appointment` فقط.
5. **وعد بمتابعة (`followup_promise`) 🆕 — D22:** `customer_requested_followup` — الزبون طلب اتصال/زيارة بموعد محدد. تتطلب `expected_date` + `expected_time` + سبب من `customer_followup_reasons`. تنقل `open_task` لـ `needs_follow_up`. `closesContactTarget = false`.

#### BR-1.5: فئات `system_lists` المرتبطة بـ outcomes (DEC-006 D39)

**فئات جديدة معتمدة:**
- `customer_followup_reasons` — تُستخدم عند `customer_requested_followup`. **إلزامية**.
- `visit_cancellation_reasons` — تُستخدم عند إلغاء زيارة `scheduled` قبل بدئها. إلزامية.
- `location_missing_reasons` — تُستخدم عند استثناء GPS أثناء الزيارة. إلزامية.
- `cooldown_manual_reasons` — تُستخدم عند تفعيل cooldown يدوياً. إلزامية.
- `visit_not_completed_reasons` — تُستخدم عند توثيق زيارة بنتيجة `not_completed`. إلزامية.
- `not_interested_reasons` — تُستخدم اختياراً عند `not_interested` لأغراض التقارير. **اختيارية**.

**فئات محذوفة من الكود الحالي:**
- ⛔ `telemarketing_rejection_reason` — مغطاة بـ outcomes الجديدة المتمايزة. القيم الست تُهجَّر للحذف.
- ⛔ `telemarketing_reschedule_reason` — تُستبدل بـ `customer_followup_reasons`. القيم الخمس تُهجَّر للفئة الجديدة.

**فئات محتفظ بها بلا تغيير:** `emergency_unresolved_reason` (نتيجة زيارة الطوارئ)، `no_closing_reasons` (إغلاق العقد).

> القيم الفعلية (seed) لكل فئة لم تُحسم بعد (P-DEC006-01 — جلسة seed values).

#### BR-2: سلسلة الزناد والتسلسل الآلي للحجز (محدّث — DEC-003 + DEC-004)

> **ملاحظة هامة:** سلسلة الزناد القديمة (`telemarketing_appointments` → trigger → `field_visits`) **أُلغيت كلياً**. الـ endpoint `POST /api/telemarketing/appointments` تم استبداله بـ `POST /telemarketing/book-visit` ينشئ `field_visit` مباشرة (D2).

**السلسلة الجديدة (D14 سيناريو 2):**

عند نجاح حجز موعد عبر `POST /telemarketing/book-visit`:

1. **فحص D18 الإلزامي:** النظام يرفض إذا أحد الشروط فشل:
   - `day_schedule` غير محفوظ لـ `scheduled_date`.
   - `route_assignments` لا تشمل منطقة الزبون لذلك اليوم.
   - التاريخ في الماضي.

2. **إنشاء `field_visit`** مباشرة بحالة `scheduled`:
   - `origin_type = 'telemarketing'`, `origin_id = call_log_id`.
   - `customer_snapshot` يتعبأ كاملاً (Level 2 — D12).
   - `team_snapshot` يتعبأ من route_assignments + day_schedule لذلك اليوم.

3. **إنشاء `visit_tasks`** من قائمة `open_task_ids` المختارة من التيليماركتر:
   - كل `visit_task` يربط بـ `source_open_task_id`.
   - `open_task.status` تتحوّل لـ `scheduled`.

4. **تحديث `contact_target`:**
   - `status = 'closed'` (D23).
   - `latest_call_outcome = 'booked_marketing_appointment'`.
   - `latest_visit_id` يربط بالزيارة الجديدة (محل `latest_appointment_id`).

5. **إلغاء الزيارة لاحقاً (D23):**
   - `contact_target.status` يبقى `closed` — هدف اليوم تحقق بالتواصل.
   - `open_tasks` ترجع لـ `last_waiting_status` (D10).

**سلاسل بديلة:**
- **طلب خدمة بدون حجز (D14 سيناريو 1):** `service_request` outcome → `open_task` جديدة بحالة `open` + `creation_origin = 'service_request_call'`. لا زيارة.
- **وعد متابعة لاحقة (D22):** `customer_requested_followup` outcome 🆕 → `open_task.status = 'needs_follow_up'` + `expected_date/time`. لا زيارة. زر Schedule-from-Expected ينشئها لاحقاً.

#### BR-3: التعددية وتنوع الكيانات المستهدفة (Entity Polymorphism)
- يعتمد النظام بالكامل بنية التعددية لنوع الكيانات (`entity_type IN ('candidate', 'client')`).
- تخدم هذه الميزة إدارة الاتصال بالمرشحين (`candidates`) لتحويلهم لمبيعات جديدة، والعملاء القدامى (`clients`) لمتابعة التحصيل والصيانة.
- في حال كان الهدف مرشحاً وتم حجز موعد زيارة مبيعات ناجحة له ونتج عنها عقد: يقوم النظام بترقية وضع المرشح تلقائياً وربطه بالعميل المنشأ مع الحفاظ التام على كامل سجلات المكالمات والأرشيف الصوتي التاريخي للزبون.

#### BR-4: استبقاء وتوثيق الخصائص الفدائية وقت الحجز (Appointment Snapshots)
- يقوم جدول المواعيد `telemarketing_appointments` بأخذ لقطات فورية لبعض خصائص العميل وقت حجز الموعد مثل المهنة `occupation` ومصدر المياه `water_source`.
- الهدف من هذه اللقطة حماية البيانات التشغيلية الأولية والتحضيرية للفنيين الميدانيين قبل ذهابهم للموقع، تحسباً لتحديث بيانات العميل لاحقاً من قسم الصيانة أو المبيعات.

---

## 4. العلاقات بين الجداول (Entity Relationships)

```mermaid
erDiagram
    telemarketing_task_lists ||--o{ telemarketing_task_list_items : "contains"
    telemarketing_task_list_items }o--|| candidates : "calls candidate"
    telemarketing_task_list_items }o--|| clients : "calls client"
    telemarketing_task_list_items ||--o{ telemarketing_call_logs : "records calls"
    telemarketing_task_list_items ||--o| telemarketing_appointments : "resolves to"
    telemarketing_call_logs }o--|| contact_targets : "tracks target"
    telemarketing_appointments }o--|| contact_targets : "completes target"
    telemarketing_appointments ||--o| open_tasks : "spawns task"
    telemarketing_appointments ||--o| field_visits : "spawns visit"
    contact_targets }o--|| branches : "monitored by"
```

---

## 5. آلة الحالات التشغيلية (State Machine)

### 5.1 دورة حياة بنود كشف الاتصال (Task List Item Lifecycle)
- **`pending` (قيد الانتظار):** الحالة الافتراضية للبند الملحق فور إنشاء الكشف.
- **`called` (تم التواصل):** بعد تسجيل مكالمة هاتفية صحيحة بـ 20 نتيجة متاحة عدا الحجز.
- **`booked` (تم الحجز):** عند نجاح المكالمة وحجز شريحة مواعد مؤكدة للزيارة.

### 5.2 دورة حياة أهداف الاتصال اليومية (محدّثة بـ DEC-005 D26)

`new` (جديد). الهدف المستقطب الأولي عند إنشاؤه بحفظ خطة اليوم.

`queued` / `in_call_list` (مدرج بكشف الاتصال). عند إلحاق الهدف بكشف تواصل جاري.

`contacted` (تم التواصل). عند تدوين أي مكالمة بأي نتيجة عدا الحجز.

`closed` (مغلق). الحالة النهائية، تصل عبر أربعة مسارات.

#### مسارات الإغلاق

**المسار الأول: تلقائي على الحجز فقط (D26).** عند نتيجة `booked_marketing_appointment` وإنشاء `field_visit`، الـ contact_target ينتقل تلقائياً إلى `closed`. `closing_reason = 'booked'`.

**المسار الثاني: يدوي بواسطة التيليماركتر (D26).** التيليماركتر تقرر إنهاء "هدف اليوم" بعد تواصل أو محاولات فاشلة. متاح عبر مسارين في الواجهة: خيار داخل نافذة تسجيل نتيجة المكالمة، وزر مستقل على بطاقة الـ contact_target. `closing_reason = 'manual_telemarketer'`.

**المسار الثالث: يدوي بواسطة المشرف (D26).** المشرف يُغلق لأسباب تشغيلية (تجنب تكرار، الزبون غير متاح للمتابعة). `closing_reason = 'manual_supervisor'`.

**المسار الرابع: CRON أمان (D26).** يومياً في وقت قابل للضبط (افتراضي 22:00 من `system_settings.contact_target_cleanup_time`). يُغلق كل `contact_targets` حيث `status != 'closed' AND date < CURRENT_DATE`. يُرجع الـ `open_tasks` المرتبطة لـ `last_waiting_status` (D10). `closing_reason = 'auto_closed_by_cron'`.

#### قاعدة جوهرية (DEC-005 D26)

**لا إغلاق تلقائي على نتائج الرفض.** عند نتيجة `not_interested` أو `other_company_not_interested` أو `seen_offer_not_interested` أو أي نتيجة رفض أخرى، الـ contact_target يبقى مفتوحاً. السبب أن التيليماركتر قد تجرب رقم آخر للزبون. القرار النهائي بالإغلاق يدوي.

ملاحظة على الكود: حقل `closesContactTarget` في `packages/shared/telemarketingOutcomes.ts` يصير `false` لكل النتائج باستثناء `booked_marketing_appointment` (الذي يُعالج بمنطق إنشاء الزيارة).

---

## 5.3 قواعد الفلتر والـ grain (DEC-005)

### المبادئ التأسيسية

**Bottom-up.** الفلتر يبدأ من المهام المفتوحة، ليس من الزبون. الزبون يظهر إذا له على الأقل `open_task` واحدة جاهزة في موقع داخل نطاق العمل المحفوظ.

**عنوان الجهاز لا العقد.** location_basis في `task_type_config` يأخذ القيم `client` (عنوان الزبون لمهام marketing) أو `device` (عنوان الجهاز من `installed_devices.installation_geo_unit_id` لمهام service و collection). العقد كيان مالي تجاري، الجهاز كيان مادي.

**required_date بدل due_date.** المهام التي ليست مالية تستخدم required_date كاسم دلالي. `due_date` يبقى للأقساط والذمم المالية فقط.

**نافذة N واحدة.** قيمة N (تُحفظ في `task_type_config.lead_window_days`) تدل فقط على عدد الأيام قبل required_date أو expected_date التي تُظهر المهمة في contact_targets.

**المهام الفائتة تبقى تظهر.** لا اختفاء صامت. علامة "متأخرة" بأولوية عرض عالية.

### grain (DEC-005 D27)

contact_target = (زبون + موقع عمل + يوم).

السجل الواحد يجمع كل المهام في الموقع نفسه بغض النظر عن نوعها. زبون عنده عنوانه + جهاز 1 + جهاز 2 قد يكون له حتى 3 سجلات في اليوم، واحد لكل موقع. لو الجهاز 1 ضمن نطاق فريق A والجهاز 2 ضمن فريق B، السجلات تذهب لفرق مختلفة.

### قاعدة التوسع لكل visit_types (DEC-005 D24)

`syncAssignedTasks` يعمل على كل أنواع المهام، ليس marketing فقط. الفلتر يحدد visit_type على مستوى السجل (marketing عند مهام عرض الجهاز، service عند post-sale وغيرها، collection عند تحصيل، mixed عند تنوع الأنواع في الموقع نفسه).

### استبعادات الزبون (DEC-005)

الفلاتر على مستوى الزبون تقتصر على ما يعكس "غير قابل للتواصل":

- `clients.do_not_contact = TRUE` — حظر دائم.
- `clients.is_archived = TRUE` (إن وُجد).
- `clients.is_candidate = TRUE` — المرشحون مسار منفصل.
- `clients.cooldown_until > CURRENT_DATE` — حظر مؤقت.

لا فلتر `NOT EXISTS contracts` (يُحذف من الكود). لا فلتر `NOT EXISTS visits` legacy (يُحذف).

## 5.4 cooldown على مستوى الزبون (DEC-005 D29)

### المفهوم

cooldown يحجب الزبون من كل contact_targets بغض النظر عن نوع المهمة. مدته محددة وتنتهي تلقائياً بفوات التاريخ.

### حقول جديدة على clients

- `cooldown_until` (DATE). تاريخ انتهاء الحجب.
- `cooldown_reason` (TEXT). سبب التفعيل.
- `cooldown_set_by` (FK → hr_users). من فعّل.
- `cooldown_set_at` (TIMESTAMPTZ). وقت التفعيل.

### المدة الافتراضية

من `system_settings.default_cooldown_days`. القيمة الافتراضية المبدئية 7 أيام، قابلة للضبط بواسطة الأدمن.

### حالات التفعيل التلقائي

عند تسجيل نتيجة `not_interested` (الموحّدة بعد DEC-006 D39 — تستوعب كل أسباب عدم الاهتمام)، النظام يضع `cooldown_until = CURRENT_DATE + default_cooldown_days` تلقائياً. السبب اختياري من `not_interested_reasons` لأغراض التقارير.

**فك cooldown اليدوي قبل المدة (DEC-006 D32):** صلاحية حصرية لـ **مدير الفرع** عبر `permissions.cooldown_unlock`. التيلماركتر والمشرف لا يملكان هذه الصلاحية. السبب: cooldown غالباً يُفعَّل بعد رفض صريح من الزبون أو قرار تشغيلي مدروس؛ فكّه قبل المدة يعني تجاوز قرار سابق. المشرف قد يُضغط لفك cooldown تحت تحقيق أهداف يومية.

### حالات التفعيل اليدوي

عند الإغلاق اليدوي لـ contact_target، خيار اختياري لتفعيل cooldown. يستخدمه التيليماركتر بعد محاولات متعددة فاشلة، أو المشرف لمنع تكرار تشغيلي.

### فك Cooldown اليدوي

من شاشة تفاصيل الزبون، زر "إلغاء فترة التهدئة". يحتاج صلاحية مشرف أو أعلى.

### انتهاء آلي

الفلتر في `syncAssignedTasks` يفحص `cooldown_until IS NULL OR cooldown_until < CURRENT_DATE`. بعد فوات التاريخ الزبون مؤهل تلقائياً، الحقل يبقى محفوظاً للتاريخ.

### الدمج مع do_not_contact

`clients.do_not_contact` (BOOLEAN) حظر دائم. الفلتر يفحص الاثنين معاً، أي منهما يحجب يحجب. شاشة تفاصيل الزبون تجمعهما في قسم "حالة التواصل" مع زرين منفصلين لإدارة كل واحد.

### التفاعل مع expected_date

لا تأثير متبادل. expected_date task-level. cooldown customer-level. عند `customer_requested_followup` يُحفظ expected_date على المهمة فقط، لا يفعّل cooldown.

## 5.5 الوعي عبر الفرق (DEC-005 D28)

### نافذة مصغرة في TelemarketerWorkspace

عند عرض contact_target، نافذة جانبية تعرض كل contact_targets الأخرى لنفس الزبون داخل الفرع لليوم. تشمل حالتها ونتائج مكالماتها وزيارات المحجوزة. قراءة فقط.

### علامة على بطاقة الزبون

في القائمة الرئيسية للتيليماركتر، badge "+N فرق" يظهر لو الزبون له contact_targets في فرق أخرى داخل الفرع.

### التحديث live

عند حجز أو إغلاق contact_target في فريق آخر، النافذة المصغرة تتحدث.

### النطاق

كل contact_targets للزبون نفسه ضمن الفرع نفسه + التاريخ نفسه. لا يشمل فروع أخرى.

### Endpoint

`GET /telemarketing/customer/:customerId/all-targets-today` يجلب كل contact_targets المرتبطة بالزبون لليوم.

## 6. صلاحيات الوصول (Permission Matrix)

> [!CAUTION]
> **ثغرة أمنية هيكلية (GAP-022):** مسار الأهداف الهاتفية المباشرة والمزامنة اليومية الميدانية للتحصيل بملف `routes/contactTargets.ts` يفتقر بالكامل لوجود بوابات التحقق من الصلاحيات المعيارية للفرع (`requirePermission`)، مما يسمح لأي مستخدم مصرح له بالدخول (حتى لو كان متدرباً) بالمزامنة وعرض كافة أهداف المبيعات والمتابعة الجغرافية.

| المسار التشغيلي (Route Path) | المفتاح الفعلي المطلوب | النطاق المسموح (Scope) | الوصف والشرح بالعربية |
|---|---|---|---|
| `GET /api/telemarketing/snapshot`| `telemarketing.lists.view` | BRANCH / GLOBAL | عرض لقطة كشف الاتصال الحالي للفريق |
| `POST /task-lists/upsert` | `telemarketing.lists.generate`| BRANCH / GLOBAL | إنشاء أو تحديث كشوف الاتصالات يدوياً |
| `POST /task-lists/generate-from-plan`| `telemarketing.lists.generate`| BRANCH / GLOBAL | توليد بنود الكشوف بناء على الخطط |
| `POST /api/telemarketing/call-logs`| `telemarketing.calls.create` | BRANCH / GLOBAL | تسجيل مكالمة هاتفية وتحديث المحصلة |
| `POST /api/telemarketing/appointments`| `telemarketing.appointments.book`| BRANCH / GLOBAL | حجز موعد وتأكيد الزيارات الميدانية |
| `POST /api/telemarketing/service-tasks`| `telemarketing.calls.create` | BRANCH / GLOBAL | تحويل العميل وتوليد مهمة صيانة/صندوق |

---

## 7. عقد API (API Contract)

### 7.1 قائمة endpoints الرئيسية (Core Endpoints)

1. **`GET /api/telemarketing/snapshot`**
   - **الغرض:** استرجاع تفاصيل وإحصائيات بنود كشف الاتصال اليومي المخصص للفريق واليوم الجاري.
   - **الباراميترات:** `teamKey` (مفتاح الفريق)، `date` (التاريخ المختار).

2. **`POST /api/telemarketing/call-logs`**
   - **الغرض:** تسجيل وتوثيق تفاصيل محاولة تواصل هاتفية وتحديث حالة بنود الكشف.
   - **المدخلات (Request Body):**
     `{ "entityType": "client", "entityId": 1024, "outcome": "busy", "teamKey": "team_tele_damascus", "notes": "الرقم مشغول يرجى الإعادة" }`

3. **`POST /api/telemarketing/appointments`**
   - **الغرض:** حجز موعد زيارة وإطلاق سلسلة التكليف والمهام التلقائية ميدانياً.
   - **المدخلات:**
     `{ "entityType": "client", "entityId": 1024, "customerName": "أحمد", "date": "2026-05-26", "timeSlot": "10:00-11:00", "teamKey": "team_tele_damascus" }`

4. **`GET /api/contact-targets/marketing`**
   - **الغرض:** جلب قائمة أهداف المبيعات المفتوحة اليومية المخصصة للمتابعة بالفرع.
   - **الرأس (Headers):** `X-Branch-Id` (معرف فرع التشغيل الجاري بصرامة).

---

## 8. حالات الاختبار الشاملة (Test Cases)

| الرمز | سيناريو الفحص والاختبار | الطريقة والمسار | المدخلات المرسلة | السلوك المتوقع والاستجابة | ملاحظات تشغيلية |
|---|---|---|---|---|---|
| **TC-01** | تسجيل مكالمة ناجحة للزبون بنتيجة حجز | POST `/api/telemarketing/call-logs` | كائن مكالمة للزبون `1024` بنتيجة `booked_marketing_appointment`. | ترميز `200` مع حفظ السجل الهاتفي وإغلاق مستهدف الاتصال الجاري. | يمهد لنقل البند لحالة booked في كشف التحضير. |
| **TC-02** | محاولة حجز موعد زيارة كامل مبيعاتياً | POST `/api/telemarketing/appointments` | تفاصيل الزبون واليوم وشريحة الوقت المتاحة. | ترميز `200` وحجز الموعد وتوليد مهمة `device_demo` وزيارة ميدانية آلياً. | التحقق من صحة عمل سلسلة الزناد التلقائي والتسلسل للكيانات. |
| **TC-03** | تسجيل مكالمة فاشلة بسبب رفض صريح | POST `/api/telemarketing/call-logs` | نتيجة `rejected` مع تبرير رفض `telemarketing_rejection_reason`. | ترميز `200` وتحديث حالة البند لـ `called` وإغلاق الهدف نهائياً. | يوثق رغبات العملاء بالانسحاب ويمنع إزعاجهم. |
| **TC-04** | استرجاع لقطة الكشف اليومي لفرقة الاتصال | GET `/api/telemarketing/snapshot` | الباراميترات النصية للفريق واليوم الجاري. | ترميز `200` مع كائن الكشف التفصيلي والبنود المعلقة ومعدلات الإنجاز. | يعكس واجهة المتابعة الفورية لموظفي التسويق. |
| **TC-05** | توليد كشف اتصال ديناميكي من الخطة | POST `/task-lists/generate-from-plan` | معرف خطة التحضير المبرمة والتواريخ. | ترميز `200` واستيراد العملاء لجدول البنود التابع للكشف أوتوماتيكياً. | يختصر جهد إدخال وتكرار العملاء المستهدفين يدوياً. |
| **TC-06** | تحويل تواصل هاتف لصيانة وفتح مهمة | POST `/api/telemarketing/service-tasks` | معرف المكالمة ونوع الصيانة المطلوبة `periodic_maintenance`. | ترميز `200` وإنشاء مهمة خدمة مفتوحة `open_tasks` وتخصيصها للفرع الجاري. | يسهل خدمة العملاء وحفظ متطلباتهم المحاسبية هاتفياً. |
| **TC-07** | محاولة حجز موعد لعميل بفرع مغاير | POST `/api/telemarketing/appointments` | إرسال طلب حجز الزيارة لزبون من فرع مغاير. | ترميز `200` ونجاح التوثيق والالتزام بالربط الجغرافي المعزول للطلب. | يعكس مرونة النظام في إدارة المبيعات المتقاطعة للفروع. |

---

## 9. الثغرات والتضاربات المكتشفة (Gaps & Contradictions)

تم رصد عدد من الثغرات والعيوب الهيكلية الحرجة التي تهدد كفاءة وحماية الكيانات الهاتفية:

### 🚨 9.1 الثغرة الأولى: غياب أمني كامل للتحقق بصلاحيات أهداف الاتصال (Missing Branch Sync Auth Scopes on Contact Targets)
- **التضارب:** مسار الأهداف الهاتفية الميدانية والمزامنة اليومية الميدانية للتحصيل بملف `routes/contactTargets.ts` يفتقر بالكامل لوجود بوابات التحقق من الصلاحيات المعيارية للفرع (`requirePermission`)، مما يسمح لأي مستخدم مصرح له بالدخول (حتى لو كان متدرباً) بالمزامنة وعرض كافة أهداف المبيعات والمتابعة الجغرافية.
- **الأثر التشغيلي:** إمكانية تسريب بيانات المبيعات الحساسة للفروع المنافسة أو العبث غير المحسوب بمعدلات ومؤشرات أهداف الفرع ومزامنتها.
- **التوصية:** إدراج بوابات الأمان `requirePermission('contact_targets.view')` و `requirePermission('contact_targets.manage')` للمسارات فوراً وتصفية البيانات بصرامة.

### ⚠️ 9.2 الثغرة الثانية: انعدام مسارات التعديل أو التحديث للمواعيد المحجوزة (No PUT/PATCH Endpoints for Appointments)
- **التضارب:** لا يوجد أي مسار برمجي مخصص لتحديث أو تعديل أو إعادة جدولة مواعيد التسويق المحجوزة (`telemarketing_appointments`).
- **الأثر التشغيلي:** في حال رغبة العميل بتأجيل الموعد أو تعديل شريحة الوقت، يضطر الموظف لإنشاء موعد حجز جديد بالكامل مما يخلق مواعيد مكررة وتضارب بيانات مهول وأجهزة تابعة "تائهة" لعدم وجود آلية للتعديل المباشر.
- **التوصية:** بناء وإتاحة مسار تعديل صريح `PATCH /api/telemarketing/appointments/:id` لتحديث التواريخ والشرائح والمزامنة التشغيلية.

### ⚠️ 9.3 الثغرة الثالثة: غياب فحص قيود وسيلة الاتصال وتوحيدها (Unconstrained Communication Method Values)
- **التضارب:** حقل وسيلة الاتصال الموثق بـ `telemarketing_call_logs.communication_method` نوعه `VARCHAR(30)` ولكنه يفتقر بالكامل لوجود قيد فحص `CHECK constraint` بالـ DB أو Server Validation بالـ Controller.
- **الأثر التشغيلي:** إدخال بيانات عشوائية أو مشوهة إملائياً من الواجهات (مثل `phone`, `Phone`, `واتس اب`, `whatsapp`) مما يعطل كفاءة إعداد تقارير الأداء وتتبع قنوات التواصل.
- **التوصية:** إرساء قيد فحص صارم ومحدد بالقيم المقبولة حصرياً (`'phone', 'whatsapp', 'sms'`).

### ⚠️ 9.4 الثغرة الرابعة: تضارب لقطات خصائص المياه مع الجدول المحدث للعملاء (Water Source Snapshot Inconsistency)
- **التضارب:** يقوم جدول مواعيد التسويق بأخذ لقطة فورية لمصدر المياه الخاص بالعميل وتخزينه في `water_source` كعمود نصي، على الرغم من قيام قاعدة البيانات مؤخراً بفصل خصائص المياه وجعلها حقولاً إدارية متغيرة بالكامل، مما يفرغ الحقل المسجل من معناه ويسجله كـ `null` دائماً.
- **الأثر التشغيلي:** تزويد الفنيين الميدانيين بمعلومات ناقصة أو مشوهة وغير موحدة حول عينات فحص المياه المطلوبة للزبائن الجدد.
- **التوصية:** توحيد قراءة مصادر المياه وربطها بالهيكلية الجديدة لخصائص الزبون وقت الحفظ.

### ⚠️ 9.5 الثغرة الخامسة: افتقار الكيانات والأنشطة لنظام الحذف الناعم (Central Telemarketing Lacks Soft-Delete)
- **التضارب:** تعتمد جميع الجداول الخمسة للتسويق على الحذف الفيزيائي الحاد. وفي حال القيام بحذف العميل أو المرشح، يتم تدمير ومحو كامل سجل مكالماته وتاريخ اتصالاته والمواعيد المحجوزة والكشوف المرتبطة به تلقائياً وقسرياً بموجب قيد الربط `ON DELETE CASCADE`.
- **الأثر التشغيلي:** ضياع تتبع الأداء وسجلات العمل التاريخية لأقسام التسويق وعدم توفر أثر محاسبي آمن لمراجعة إنتاجية مركز الاتصال.
- **التوصية:** تطبيق معيار الحذف الناعم وتجميد الحسابات التالفة مع الحفاظ التام على الأرشيف التاريخي.

---

## 10. تاريخ التغييرات الهيكلية (Schema Changelog)

| تاريخ الهجرة | ملف الهجرة (Migration File) | طبيعة التعديل وهدف التأثير الفني والتشغيلي على الجدول |
|---|---|---|
| **2026-04** | `001_core_tables.sql` | التأسيس الهيكلي الأولي وإنشاء جداول الكشوف `task_lists` والبنود والاتصالات والمواعيد والمحددات القياسية. |
| **2026-04** | `014_branch_id_domain_tables.sql` | ربط عمليات الكشوف بالفرع التشغيلي المنشئ وتدشين فهرسة الفروع لرفع سرعة الاستعلام والبحث. |
| **2026-04** | `045_contact_targets.sql` | تأسيس البنية التحتية لأهداف الاتصال اليومية `contact_targets` وربط الحالات ومستويات جودة البيانات. |
| **2026-04** | `046_telemarketing_permissions_seeding.sql`| بذر صلاحيات استعراض الكشوف وإنشائها وحجز المواعيد وضبط الأدوار بفروع الشركة. |
| **2026-04** | `047_telemarketing_contact_target_linkage.sql`| ربط جداول البنود والمكالمات والمواعيد بجدول أهداف الاتصال وتصحيح أنواع معرفات الليفسايكل لتتطابق كـ `VARCHAR(100)`. |
| **2026-04** | `048_telemarketing_outcome_expand.sql`| التوسيع الهيكلي الهام: رفع قيد فحص نتيجة المكالمة ليتسع لـ MVP Outcome المتكامل وتصنيفها لمجموعات. |
| **2026-04** | `049_cleanup_null_branch_telemarketing_data.sql`| تطهير ومعالجة السجلات التاريخية القديمة وتعبئة الفروع المفقودة لتفادي استثناءات الاستعلام. |
| **2026-04** | `050_telemarketing_appointment_visit_tasks.sql`| بناء الزناد والتسلسل الآلي لتوليد المهام والزيارات الميدانية فور إبرام موعد التسويق الهاتفي. |
| **2026-04** | `051_marketing_visits_mvp.sql` | ربط كشوف الاتصالات بالزيارات الميدانية المبيعاتية الموحدة لتتبع نتائج العروض. |
| **2026-04** | `054_permissions_allowed_scopes.sql`| ضبط وتقييد النطاقات المسموحة للتسويق بـ `GLOBAL` و `BRANCH` واستبعاد النطاق الفردي `ASSIGNED`. |
| **2026-04** | `057_open_task_link.sql` | دمج معرفات التكليف المفتوح ببنود الاتصالات لتسجيل نتائج المكالمات. |
| **2026-04** | `058_appointment_visit_open_task_link.sql`| ربط الموعد بالتكليف المفتوح ومزامنة حركة الحالات والمراحل للزيارات ميدانياً. |
| **2026-04** | `064_customer_call_logs.sql` | تدشين السجل الموحد لاتصال الزبائن وحل تعارض ربط المكالمات التليفونية بملف المتابعة. |
| **2026-04** | `074_telemarketing_appointments_book_permission.sql`| ضبط صلاحية حجز موعد المبيعات وحصرها بالفئات المصرحة منعاً للتجاوزات. |
| **2026-05** | `093_backfill_call_task_links.sql`| تعبئة وترحيل روابط المهام المفقودة للمكالمات السابقة لضمان اتساق تتبع الأداء التقني. |
| **2026-05** | `097_telemarketing_call_logs_outcome_add_missing.sql`| إلحاق نتيجة "إضافة رقم جديد" و"مرسل رسالة نصية" لقيد فحص محصلات المكالمات لتفادي الأخطاء البرمجية. |
| **2026-05** | `098_telemarketing_rejection_reschedule_reasons.sql`| بذر أسباب الرفض المعيارية وأسباب التأجيل في جدول القوائم `system_lists` لتغذية الواجهات وتوحيد التحليل. |
| **2026-05** | `107_contact_targets_closed_status.sql`| تصحيح حركة حالات أهداف الاتصال ونقلها لوضع الإغلاق `closed` فور اكتمال سيناريو الحجز بنجاح. |
| **2026-05** | `151_contact_targets_add_date.sql`| الانتقال لنمط الأهداف اليومية وإضافة حقل التاريخ وتثبيت راية المفتاح الفريد الموحد يومياً للعميل. |
| **2026-05** | `154_contact_targets_zone_unique.sql`| ترقية القيد الفريد للأهداف ليشمل المعرف الجغرافي للمنطقة `zone_id` تفادياً للتعارضات وتكامل التحضير. |
| **2026-05** | `166_answered_by_and_visit_referral_sheets.sql`| إضافة حقل تدوين اسم مجيب الاتصال `answered_by` لجدول مواعيد التسويق لرفع دقة التوثيق. |
