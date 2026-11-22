# دستور الكيان: الأجهزة المركبة (Installed Devices Domain Constitution)

> **الحالة (Status):** Authoritative / Active — أُنشئ في 2026-05-26 مع Phase 2A/B/C من مسار فصل الجهاز عن العقد.
> **المرجع المعتمد لدورة الحياة الفيزيائية للجهاز بعد البيع** — الموقع، الحالة، الكفالة، الصيانة — مستقلاً عن بنود العقد المالي.
> **آخر تحديث:** 2026-11-20 — سجل التغييرات ودورة الحياة وتعديل الرقم التسلسلي ([DEC-024](../decisions/DEC-024-device-activity-log-and-lifecycle.md))، ونقل الحيازة إلى زبون آخر ([DEC-025](../decisions/DEC-025-device-possession-transfer.md)).

---

## 1. هوية الكيان (Entity Identity)

- **الاسم العربي:** الجهاز المركب / الجهاز الميداني
- **الاسم الإنجليزي:** Installed Device
- **اسم الجدول:** `installed_devices`
- **الوصف:** يمثل الوجود الفيزيائي للجهاز في منزل الزبون بعد إتمام صفقة البيع. بينما يوثق العقد (`contracts`) الاتفاق المالي والقانوني بين الشركة والزبون، يوثّق `installed_devices` واقعة المنتج المادي: أين هو الآن، ما حالته الحالية، متى سُلِّم وركِّب، وأي كفالات تغطيه. الفصل بين الكيانين هو ما يتيح في المستقبل: نقل ملكية جهاز، تتبع تاريخ قطع الغيار لكل وحدة، وإدارة كفالات متعددة المصدر على نفس الجهاز.
- **الجداول المرتبطة:**
  1. `device_warranties` *(Phase 4 — ✅ مكتمل)* — كفالات مستقلة مصدرها العقد أو مهمة التسليم أو اتفاق منفصل.
  2. `device_installed_parts` *(Phase 5 — ✅ مكتمل)* — تاريخ قطع الغيار المركبة والمستبدلة لكل وحدة.
- **الأهمية التشغيلية:** نقطة الحقيقة الوحيدة (`single source of truth`) لكل استفسار ميداني عن الجهاز — يستخدمه نظام المهام، التقارير الجغرافية، وجدولة الصيانة. أي خلل في بياناته يؤثر مباشرة على جودة المهام الميدانية وحسابات الكفالة.

---

## 2. معجم الجداول والحقول (Table & Field Dictionary)

### 2.1 جدول الأجهزة المركبة `installed_devices`

أُنشئ في Migration 190 (Phase 2A). يمتد بمهجرات: 190، 191، 192 (ملغاة)، 193.

| الحقل | النوع | NULL? | DEFAULT | Constraints | الوصف | مثال |
|-------|-------|-------|---------|-------------|-------|------|
| `id` | `SERIAL` | ❌ | — | `PRIMARY KEY` | المعرف الفريد للجهاز | `7` |
| `contract_id` | `INTEGER` | ✅ | — | `FK → contracts(id) ON DELETE RESTRICT` | العقد المصدر للجهاز عندما يكون الجهاز مبيعاً من الشركة. يكون `NULL` للأجهزة الخارجية المسجلة للخدمة دون عقد بيع. | `22` أو `NULL` |
| `customer_id` | `INTEGER` | ❌ | — | `FK → clients(id) ON DELETE RESTRICT` | مالك الجهاز الحالي (قابل للتغيير عند نقل الملكية) | `23` |
| `branch_id` | `INTEGER` | ✅ | — | `FK → branches(id) ON DELETE SET NULL` | الفرع المسؤول عن خدمة الجهاز | `3` |
| `device_model_id` | `INTEGER` | ✅ | — | `FK → device_models(id) ON DELETE SET NULL` | موديل الجهاز من الكتالوج | `5` |
| `device_model_name` | `VARCHAR(255)` | ✅ | — | — | لقطة اسم الموديل وقت البيع | `"فلتر ذهبي 7 مراحل"` |
| `serial_number` | `VARCHAR(255)` | ✅ | — | `UNIQUE lower(btrim(serial_number)) WHERE non-empty` | رقم اختياري يمكن استكماله لاحقاً؛ وعند إدخاله يكون فريداً عالمياً لهذه الوحدة، مع تجاهل حالة الأحرف والمسافات الطرفية | `"GS-2026-001"` أو `NULL` |
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

القاموس المعتمد هو [DEC-CT-03](../contracts/08-resolved-decisions.md) و[01d](../contracts/01d-unified-device-contract-states.md). قيد `CHECK` في قاعدة البيانات يضم اثنتي عشرة قيمة (هجرات 001 و397 و435):

```
pending_delivery ↔ delivery_suspended
       ↓
delivered → installed → active
                          ↓
      faulty / in_workshop / ready / out_of_service / retrieved
                          
contract_cancelled  (من أي حالة غير نهائية عند إلغاء العقد)
```

| القيمة | المعنى | من يكتبها اليوم |
|--------|--------|-----------------|
| `registered` | مسجل ولم يبدأ مساره | لا مسار يكتبها |
| `pending_delivery` | تم اعتماد العقد، الجهاز لم يُسلَّم بعد | إنشاء الجهاز عند الاعتماد، فشل التسليم، استئناف التسليم |
| `delivery_suspended` | التسليم متوقف إدارياً لغياب الزبون؛ الجهاز لم يُسلّم ويبقى محجوزاً للعقد | تعليق التسليم فقط |
| `delivered` | سُلِّم الجهاز، لم يُركَّب بعد | نتيجة التسليم، الإرجاع بعد الورشة، النقل |
| `installed` | رُكِّب في الموقع | نتيجة التركيب |
| `active` | فعّال ويعمل | نتيجة التشغيل، تسجيل جهاز خارجي، ترقية طلب خدمة |
| `faulty` | معطّل | تسجيل جهاز خارجي فقط |
| `in_workshop` | في عهدة الورشة | نتيجة السحب للصيانة |
| `ready` | جاهز بعد الصيانة | لا مسار يكتبها |
| `out_of_service` | خارج الخدمة | نتيجة الفك |
| `retrieved` | مسحوب إلى الشركة | نتيجة السحب لغير الصيانة |
| `contract_cancelled` | عقده ملغى | إلغاء العقد فقط |

`delivery_suspended` انتقال يدوي خاص بمرحلة ما قبل التسليم. لا يفحص الخادم وجود دفعة أو قسط، ولا يغيّر العقد أو الذمم أو مهام التحصيل. التعليق يلغي مهمة التسليم والزيارة غير المنفذة بسبب «تعليق التسليم لغياب الزبون»، ويُرفض إذا بدأ التنفيذ الميداني أو بقيت نتيجة قيد الحسم. العودة اليدوية إلى `pending_delivery` لا تنشئ مهمة تسليم تلقائيا.

كل انتقال حالة، من أي مسار، يُسجَّل في سجل تغييرات الجهاز مع مصدره ومنفّذه (BR-6).

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
contracts (0..1) ─────── (0..1) installed_devices
                                │── customer_id  → clients
                                │── branch_id    → branches
                                │── device_model_id → device_models
                                │── installation_geo_unit_id → geo_units
                                └── ✅ ← open_tasks.device_id  (Phase 3)
                                └── ✅ ← device_warranties.device_id  (Phase 4)
                                └── ✅ ← device_installed_parts.device_id  (Phase 5)
                                └── ✅ ← device_activity_log.device_id  (DEC-024، هجرة 498)
                                └── ✅ ← device_possession_transfers.device_id  (DEC-025، هجرة 500)
```

**المسدّد الحالي:** عند نقل الحيازة إلى زبون آخر، يحمل `contracts.payer_client_id` من يسدّد ما تبقى من أقساط العقد، ويبقى `contracts.customer_id` مشتري العقد ([DEC-CT-24](../contracts/08-resolved-decisions.md)).

**الربط العكسي:** يحتفظ `contracts.installed_device_id` بمرجع عكسي لتسهيل التنقل في الاتجاهين دون JOIN إضافي عندما يوجد عقد.

**الأجهزة الخارجية:** الجهاز الخارجي هو صف كامل في `installed_devices`، لكنه لا يملك عقد بيع. لذلك يكون `contract_id = NULL` مع بقاء `customer_id` و`branch_id` وبيانات الموقع والحالة التشغيلية إلزامية لمسارات الخدمة.

عند تسجيل جهاز خارجي يجب فتح سجل حيازة حالي في `device_possession_log` ضمن نفس الـ transaction:

- `holder_type = customer`
- `holder_id = installed_devices.customer_id`
- `reason = external_registration`
- `end_at = NULL`

لا يجوز إنشاء جهاز خارجي بلا سجل حيازة مفتوح، لأن `customer_id` يحدد الزبون التشغيلي الحالي، أما دفتر الحيازة فهو المرجع التاريخي المعتمد لعلاقة الجهاز بالحائز.

عند إنشاء جهاز خارجي لا يجوز افتراض أن حالته `active`. يجب على الموظف تحديد الحالة التشغيلية الحالية من واقع الجهاز:

- `delivered`: الجهاز موجود عند الزبون وغير مركب بعد.
- `installed`: الجهاز مركب لكنه غير مشغل/غير معتمد كفعال.
- `active`: الجهاز مركب ومشغل.
- `faulty`: الجهاز معطل أو أُدخل أساساً بغرض صيانة عطل.

---

## 4. منطق الأعمال (Business Rules)

### BR-0: قاعدة الارتباط التشغيلية للمهام

`installed_devices.id` هو المفتاح التشغيلي المعتمد لأي مهمة تخص جهازاً مادياً، سواء كان الجهاز من عقد بيع أو جهازاً خارجياً.

- المهام التشغيلية للجهاز تُربط عبر `open_tasks.device_id`.
- `contract_id` رابط اختياري في المهام التشغيلية، يستخدم كسياق مالي/قانوني عندما يوجد عقد.
- لا يجوز منع مهمة تشغيلية بسبب غياب `contract_id` إذا كان لديها `device_id` صالح وفرع وزبون ونطاق صلاحية.
- المهام المالية أو العقدية الصريحة فقط يجوز أن تشترط عقداً، مثل تحصيل قسط عقد أو وعود/استحقاقات مصدرها العقد.
- للجهاز الخارجي، بديل العقد في الخدمة المتكررة هو `service_agreement` عند الحاجة، وليس عقد بيع وهمي.

### BR-1: الإنشاء التلقائي عند البيع

عند كل INSERT لعقد من نوع `sale_contract`، يُطلَق trigger `trg_auto_create_installed_device` (migration 191) تلقائياً لإنشاء صف `installed_devices` ثم يكتب `installed_device_id` العكسي على العقد — كل هذا في نفس الـ transaction.

> **Phase 2C:** الـ trigger يُنشئ الصف بقيم أولية (null)، ثم يتولى كود `contracts.ts POST` كتابة الحقول الفيزيائية مباشرةً بعد ذلك في نفس الـ transaction.

### BR-2: مصدر الكتابة المباشر (Phase 2C)

جميع تعديلات الحقول الفيزيائية تذهب مباشرةً إلى `installed_devices` — لا يوجد trigger مزامنة وسيط. العقد (`contracts`) يحتفظ فقط بالحقول المالية والقانونية.

**الحقول المالية (تبقى في contracts):** `base_price`, `final_price`, `payment_type`, `down_payment`, `installments_count`, `status`, `buyer_*`, `source_*`, `sale_*`, `discount_*`, `invoice_notes`.

**الحقول الفيزيائية (تُكتب في installed_devices فقط):** `serial_number`, `status`, `delivery_date`, `installation_date`, `installation_geo_unit_id`, `installation_address_text`, `installation_lat/lng`, `warranty_months`, `warranty_visits`, `contract_warranty_end_date`, `is_golden_warranty`, `golden_warranty_end_date`.

### BR-2A: تفرد الرقم التسلسلي

- `serial_number` يعرّف وحدة فيزيائية واحدة عالمياً، بصرف النظر عن العقد أو الزبون أو الفرع أو `device_source` أو الموديل.
- المقارنة تتجاهل حالة الأحرف والمسافات الطرفية؛ لذلك `TEST-1` و` test-1 ` و`test-1` رقم واحد.
- يسمح بـ`NULL` عندما لم تُعرف الهوية النهائية بعد، لكن القيمة غير الفارغة لا يجوز أن تظهر على أكثر من صف.
- غياب الرقم لا يمنع إنشاء الجهاز الخارجي أو حفظ العقد أو اعتماده، ولا يُصنّف وحده كسجل ناقص.
- قاعدة البيانات هي الحارس النهائي ضد الطلبات المتزامنة، وتعيد واجهات الكتابة تعارضاً `409` بالكود `device_serial_conflict`.
- لا يجوز إصلاح التكرارات التاريخية بحذف صف جهاز أو اختيار مالك الرقم آلياً؛ يجب أن يحدد فريق التشغيل الرقم الصحيح لكل سجل متأثر.

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
| كفالة العقد | سطر `contract` في `device_warranties`، ومرآته `contract_warranty_end_date` | تُنشأ `pending` عند اعتماد العقد، وتبدأ بتشغيل الجهاز: `activated_at + months` ([DEC-CT-04](../contracts/08-resolved-decisions.md)) |
| الكفالة الذهبية | أسطر `golden` في `device_warranties`؛ و`golden_warranty_end_date` مشتق من أحدثها الفعّالة | تُفعَّل بتاريخ الوصل من نتيجة مهمة «عرض كفالة ذهبية» ([DEC-CT-17](../contracts/08-resolved-decisions.md)) |

كل الكفالات تعيش في `device_warranties` ([DEC-CT-16](../contracts/08-resolved-decisions.md)).

### BR-5: الموقع قابل للتغيير

حقول `installation_geo_unit_id`, `installation_address_text`, `lat/lng` تمثل الموقع الحالي للجهاز — وليس الموقع وقت التوصيل الأصلي. إذا انتقل الجهاز لمنزل آخر يُحدَّث الموقع مباشرةً هنا دون أن يتأثر العقد الأصلي.

### BR-6: سجل التغييرات ودورة الحياة ([DEC-024](../decisions/DEC-024-device-activity-log-and-lifecycle.md))

- كل تغيير على `installed_devices` يكتبه trigger في `device_activity_log` (إضافة فقط): الإنشاء، وتغيّر الحالة، وتعديل كل حقل آخر بقيم مقروءة.
- كل سطر يحمل مصدره (العملية، أو نتيجة الزيارة مع نوع المهمة)، وسببه، ومنفّذه.
- أي مسار جديد يكتب على الجهاز داخل transaction يجب أن يوسم عمليته بـ `labelDeviceChange` قبل الكتابة، وإلا ظهر بلا مصدر.
- دورة حياة الجهاز مشتقة وقت العرض من الجداول الأصلية، ولا تُخزَّن.

### BR-7: تعديل بيانات الجهاز من صفحته

- عملية مستقلة بصلاحية `installed_devices.edit_details`. أول ما تشمله الرقم التسلسلي، وتنضم إليها تعديلات صفحة الجهاز اللاحقة.
- سبب التعديل إلزامي، والرقم الجديد يخضع لـ BR-2A.

### BR-8: نقل الحيازة إلى زبون آخر ([DEC-025](../decisions/DEC-025-device-possession-transfer.md))

- عملية واحدة تنقل الحيازة وزبون الجهاز والمسدّد الحالي للعقد ومتبقي أقساط العقد والكفالة الذهبية ومهام تحصيلها المفتوحة. ويمكن أن تغيّر الموقع، لكنها لا تغيّر الفرع.
- شروطها: كل مهام الجهاز التشغيلية مكتملة أو ملغاة، والحالة `delivered` أو `installed` أو `active` أو `faulty` أو `out_of_service`، ولا اتفاق خدمة فعّال، وسبب من قائمة `device_possession_transfer_reasons`، وتاريخ اليوم فقط.
- الكفالات تبقى على الجهاز دون تغيير.
- مهمة النقل الميدانية إلى زبون آخر تنقل الأقساط ومهام التحصيل بالطريقة نفسها عند نجاحها.
- لا يُضاف سطر حيازة لزبون إلا عبر هذه العملية.

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
| **GAP-094** (كانت GAP-078) | تفعيل الكفالة الذهبية | ✅ مكتمل عبر DEC-CT-17 / CT-IMPL-017 |
| **Phase 3** | ربط `open_tasks.device_id` | ✅ مكتمل (migration 194, 2026-05-26) |
| **Phase 4** | إنشاء `device_warranties` | ✅ مكتمل (migration 196, 2026-05-26) |
| **Phase 5** | إنشاء `device_installed_parts` | ✅ مكتمل (migration 197, 2026-05-26) |
| **Phase 6** | DROP الحقول Legacy من `contracts` | ✅ مكتمل (migration 195, 2026-05-26) |

---

## 6. صلاحيات الوصول (Permission Matrix)

كل صلاحية تُفحص على فرع الجهاز (`installed_devices.branch_id`).

| العملية | الصلاحية المطلوبة | ملاحظة |
|---------|------------------|--------|
| قراءة القائمة وقراءة جهاز | `installed_devices.view` أو `clients.devices.view` أو `contracts.view_list` | — |
| تعديل جهاز `PATCH /:id` (المسار القديم) | `contracts.edit` | يقبل أي حقل فيزيائي بما فيه الحالة، بلا حارس انتقالات؛ لا يقبل الدخول إلى `delivery_suspended` أو الخروج منها. يظهر في السجل بمصدر «تعديل يدوي للجهاز» |
| تعديل بيانات الجهاز من صفحته `PATCH /:id/details` | `installed_devices.edit_details` | DEC-024. لا تُمنح تلقائياً |
| عرض سجل التغييرات | `installed_devices.activity_log.view` | DEC-024. نطاق GLOBAL/BRANCH |
| عرض دورة الحياة | `installed_devices.lifecycle.view` | DEC-024. نطاق GLOBAL/BRANCH/ASSIGNED، وكل فئة داخلها تتبع صلاحية قسمها |
| عرض سجل الحيازة والحائز الحالي | `installed_devices.possession.view` | — |
| نقل الحيازة إلى زبون آخر | `installed_devices.possession.manage` | DEC-025 |
| تعليق/إعادة التسليم | `installed_devices.delivery_suspension.manage` | من تفاصيل الجهاز فقط، بنطاق GLOBAL/BRANCH وسجل تدقيق إلزامي |
| تسجيل جهاز خارجي | `installed_devices.create_external` | — |
| إنشاء جهاز من عقد | غير متاح مباشرةً | يُنشأ تلقائياً عند اعتماد `sale_contract` |
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

### 7.4 `PATCH /api/installed-devices/:id/details` (DEC-024)

تعديل بيانات الجهاز من صفحته. الحقل المتاح حالياً: `serialNumber`.

```json
{ "serialNumber": "GS-2026-002", "reason": "تصحيح خطأ إدخال بعد مطابقة الملصق" }
```

**Response (200):** `{ "ok": true, "id": 7, "serialNumber": "GS-2026-002" }`
**Response (400):** سبب ناقص، أو رقم فارغ، أو رقم مطابق للحالي.
**Response (409):** `{ "code": "device_serial_conflict" }` — الرقم مستخدم على جهاز آخر.

---

### 7.5 `GET /api/installed-devices/:id/activity` (DEC-024)

أسطر سجل التغييرات، الأحدث أولاً: `eventType` (`created` / `status_changed` / `field_changed`)، و`fieldKey`، و`oldValue`، و`newValue`، و`changeContext`، و`taskType`، و`visitId`، و`reason`، و`performedByName`، و`createdAt`.

---

### 7.6 `GET /api/installed-devices/:id/lifecycle` (DEC-024)

`{ events, hiddenCategories }`. كل حدث له `category` (`entry` / `status` / `tasks` / `contract` / `warranties` / `possession`)، و`kind`، و`at`، و`title`، و`decision` لنتائج المهام، و`detail`، و`actor`، و`link`. `hiddenCategories` هي الفئات التي حُذفت لأنها خارج صلاحيات المستخدم.

---

### 7.7 `POST /api/devices/:deviceId/possession/transfer` (DEC-025)

نقل الحيازة إلى زبون آخر.

```json
{
  "toClientId": 1234,
  "reasonCode": "migrated_data_correction",
  "notes": "اختياري، وإلزامي مع «أخرى»",
  "location": { "geoUnitId": 321, "addressText": "...", "lat": null, "lng": null }
}
```

`location` اختياري؛ بدونه يبقى الموقع كما هو.

**Response (201):** `{ transferId, fromClientId, toClientId, contractBalanceSyp, warrantyBalanceSyp, movedTaskIds, locationChanged }`
**Response (409):** بأحد الرموز `open_device_tasks` أو `collection_tasks_in_planning` أو `active_service_agreement` أو `device_status_not_transferable`، مع أرقام المهام في `details` عند وجودها.

واجهة إضافة سطر الحيازة العامة `POST /api/devices/:deviceId/possession` ترفض `holderType = customer` بالرمز `use_possession_transfer`.

---

## 8. الثغرات المفتوحة (Open Gaps)

### GAP-094: غياب واجهة تفعيل الكفالة الذهبية ✅ محلول

> كانت تحمل الرقم GAP-078، وهو رقم مستخدم في [`GAPS-TRACKER.md`](../trackers/GAPS-TRACKER.md) لمراقبة الجداول القديمة؛ أُعيد ترقيمها في 2026-11-20.

- **الحل المطبق:** [DEC-CT-17](../contracts/08-resolved-decisions.md) جعل التفعيل نتيجة لمهمة «عرض كفالة ذهبية» بتاريخ الوصل، تنشئ سطراً `golden` في `device_warranties` (CT-IMPL-017، هجرتا 307 و308). الحقلان على الجهاز صارا مرآة مشتقة لا تُكتب يدوياً.
- **الإشكالية (الأصلية):** لا يوجد UI في صفحة نتيجة مهمة "تسليم كفالة ذهبية" يتيح اختيار الفترة من `device_models.golden_warranty_periods` وكتابة `is_golden_warranty + golden_warranty_end_date` على `installed_devices`.
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
| **2026-05-26** | `196_device_warranties.sql` | **Phase 4:** إنشاء جدول `device_warranties` (id, device_id FK, warranty_type CHECK('contract'\|'golden'), start_date, end_date, months, visits, source_task_id FK, is_active, notes). UNIQUE(device_id, warranty_type). تحديث `contracts.ts` POST/PUT لـ UPSERT في `device_warranties` عند حفظ warrantyMonths. إنشاء route `GET /api/device-warranties?deviceId=` و`PATCH /api/device-warranties/:id`. |
| **2026-05-26** | `197_device_installed_parts.sql` | **Phase 5:** إنشاء جدول `device_installed_parts` (id, device_id FK, open_task_id FK, spare_part_id FK, part_name_snapshot, maintenance_type, unit_price, quantity, line_total, event_type, event_date). تحديث `emergencyResult.ts` PUT /:taskId/parts ليُزامن القطع إلى `device_installed_parts` عند وجود device_id على المهمة. إنشاء route `GET /api/device-parts?deviceId=`. |
| **2026-07-22** | `375_installed_device_serial_uniqueness.sql` | فرض التفرد العالمي للرقم التسلسلي بعد `lower(btrim(...))` مع السماح بـ`NULL`، وإيقاف المهاجرة بتقرير واضح عند وجود تكرارات تحتاج مصالحة تشغيلية. |
| **2026-11-19** | `498_device_activity_log.sql` | DEC-024: جدول `device_activity_log` وtrigger على `installed_devices`، وصلاحيتا `installed_devices.activity_log.view` و`installed_devices.lifecycle.view` بمنح لحاملي المفاتيح المقابلة، وسطر «إنشاء» لكل جهاز قائم. |
| **2026-11-19** | `499_installed_device_edit_details_permission.sql` | DEC-024: صلاحية `installed_devices.edit_details` بلا منح. |
| **2026-11-19** | `500_device_possession_transfer.sql` | DEC-025: `contracts.payer_client_id`، وجدول `device_possession_transfers`، و`device_possession_log.reason_code`، وقائمة `device_possession_transfer_reasons`. |
| **2026-11-20** | `501_field_transfer_finances.sql` | DEC-025 D7: `source` و`visit_task_result_id` (فريد) و`left_task_ids` على `device_possession_transfers`، و`reason_code` اختياري للنقل الميداني. |
