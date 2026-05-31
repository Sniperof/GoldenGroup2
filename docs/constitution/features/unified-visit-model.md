# دستور الفيتشر — نموذج الزيارة الموحدة (Unified Visit Model)

> الحالة: معتمد كمرجع دستوري
> اللغة: عربية موحّدة
> النطاق: Visit Architecture — زيارة واحدة لكلshي
> الغرض: توثيق قرار الجعل `field_visits` هو الكيان الوحيد للزيارة، وإهمال `marketing_visits` كـ legacy wrapper.

---

## 0) الملخّص التنفيذي

هذا الدستور يثبّت قرار المنتج والهندسة بأن **الزيارة كيان واحد (`field_visits`)** يحتوي مهام متعددة (`visit_tasks`) من أي نوع. لا وجود لـ "زيارة تسويقية" منفصلة عن "زيارة تسليم" أو "زيارة صيانة".

`marketing_visits` (و `marketing_visit_tasks`) هو **legacy** تماماً. بدأ كـ wrapper لزيارات عرض الجهاز (التلي ماركتينج) لكن التعميم أثبت أن كل المهام متساوية: **الزبون + الموعد + الفريق + المهمة = زيارة واحدة**.

---

## 1) لماذا "زيارة واحدة"؟

### 1.1 المشكلة القديمة

| | `marketing_visits` | `field_visits` |
|---|---|---|
| **الغرض** | عرض الجهاز فقط | كل المهام التانية |
| **الجدول** | marketing_visits | field_visits |
| **المهام** | marketing_visit_tasks | visit_tasks |
| **النتائج** | marketing_visit_task_offers | visit_task_results + side tables |

معناه: نفس الأحمد بيحتاج **زيارتين** بالنظام إذا عنده عرض + تسليم:
```
marketing_visit: "عرض جهاز"  ← زيارة منفصلة
field_visit: "تسليم جهاز"    ← زيارة منفصلة
```

### 1.2 المشكلة العملية

- **الفني بيروح مرة واحدة** — بس النظام بيسجّل "زيارتين"
- **الزبون شايف فريق واحد** — بس الـ CRM بيعطي 2 reports مختلفة
- **التقارير بتضل غلط** — "عدد الزيارات" = ضعف الحقيقة
- **إضافة مهمة جديدة = صداع** — وين بروح؟ marketing ولا field؟

### 1.3 الحل

> **كل موعد مع الزبون = زيارة واحدة (`field_visits`).**
> **كل عمل ضمن الموعد = مهمة (`visit_task`).**

```
field_visit: "الأحمد — يوم الاثنين الساعة 3"
├── visit_task: عرض الجهاز (device_demo)
├── visit_task: تسليم الجهاز (device_delivery)
└── visit_task: تركيب الجهاز (device_installation)

نفس الفريق، نفس الزبون، نفس الموعد، 3 مهام، زيارة واحدة.
```

---

## 2) العقد التقني

### 2.1 الكيان الوحيد: `field_visits`

| العمود | المعنى |
|--------|--------|
| `id` | مفتاح الزيارة |
| `visit_type` | تصنيف الزيارة (`'marketing'` \| `'service'` \| `'mixed'`) — راجع §2.5 |
| `status` | حالة الزيارة (`scheduled`, `in_progress`, `completed`, `cancelled`, ...) |
| `client_id` | الزبون |
| `branch_id` | الفرع |
| `scheduled_date` / `scheduled_time` | الموعد (الزيارة هي الموعد — راجع §2.6) |
| `team_snapshot` | snapshot الفريق وقت التخطيط |
| `origin_type` | مصدر إنشاء الزيارة — راجع §2.7 |
| `origin_id` | معرّف المصدر — راجع §2.7 |

> **الحقول الموسّعة** (booking, customer_snapshot, cancellation, إلخ) موثقة بـ `features/visit-detail-page-constitution.md` §8.
> **`visit_family`** أُهمل (راجع §2.5).
> **`source_legacy_*`** أُهمل بعد حذف `marketing_visits`.

### 2.2 المهام: `visit_tasks`

| العمود | المعنى |
|--------|--------|
| `id` | مفتاح المهمة |
| `field_visit_id` | ربط بالزيارة |
| `task_type` | نوع المهمة (`device_demo`, `device_delivery`, `device_installation`, `device_activation`, `emergency_maintenance`, ...) |
| `task_family` | عائلة المهمة (`marketing`, `post_sale`, `emergency`) |
| `sequence_no` | ترتيب المهمة بالزيارة |
| `status` | حالة المهمة (`pending`, `completed`, `not_completed`, ...) |
| `source_open_task_id` | ربط بـ `open_tasks` (لو فيه) |
| `source_legacy_type` | لو من migration |
| `source_legacy_id` | الـ ID القديم |

### 2.3 النتائج: `visit_task_results` + side tables

| الجدول | للمهمة |
|--------|--------|
| `visit_task_results` | النتيجة العامة (status, notes, closed_by, closed_at) |
| `visit_task_device_demo_results` | تفاصيل عرض الجهاز (offers, cash_offer_amount, ...) |
| `visit_task_device_delivery_results` | تفاصيل التسليم (serial_number, delivery_condition, ...) |
| `visit_task_device_installation_results` | تفاصيل التركيب |
| `visit_task_device_activation_results` | تفاصيل التفعيل |

> **مبدأ عدم التكرار:** `visit_task_results` جدول أم. كل مهمة لها صف واحد. البيانات النوعية (مختلفة حسب task_type) بروح للـ side table. ما في أعمدة فارغة.

### 2.5 تصنيف الزيارة `visit_type` — قرار D4

تصنيف خفيف على مستوى الزيارة، التفصيل عبر `visit_tasks.task_type`:

| `visit_type` | متى يُستخدم |
|--------------|-------------|
| `marketing` | كل المهام في الزيارة من عائلة marketing (مثل `device_demo`) |
| `service` | كل المهام في الزيارة post-sale/service/emergency/maintenance/collection |
| `mixed` | الزيارة تحوي مهاماً من أكثر من عائلة (مثل عرض + تسليم بنفس الزيارة) |

`visit_family` كحقل قديم لم يعد له دور تصنيفي — التفصيل في `task_family` على مستوى المهمة.

### 2.6 الزيارة = الموعد — قرار D1

`field_visits` هو الكيان الوحيد للموعد والزيارة معاً. `telemarketing_appointments` يُحذف بالكامل. لا يوجد كيان "موعد" منفصل عن الزيارة.

- "حجز موعد" في واجهة التيليماركتر = إنشاء `field_visit` مباشرة بحالة `scheduled`.
- "موعد مُلغى" = `field_visit` بحالة `cancelled`.
- "موعد مؤجل" = `field_visit` بحالة `needs_reschedule`.

### 2.7 مصدر الزيارة `origin_type` + `origin_id` — قرارات D3 + D22

كل زيارة تحمل مصدرها بشكل صريح:

| `origin_type` | `origin_id` يشير إلى | متى |
|---------------|---------------------|------|
| `telemarketing` | `telemarketing_call_logs.id` | حُجزت من مكالمة تيليماركتر بنتيجة `booked_marketing_appointment` (D14 سيناريو 2) |
| `expected_followup` 🆕 | `open_tasks.id` | حُجزت لاحقاً من وعد زبون سابق (D22) عبر `POST /open-tasks/:id/schedule-from-expected` |
| `manual` | `hr_users.id` (من أنشأ) | أنشأها مدير الفرع أو موظف صاحب صلاحية يدوياً |
| `emergency_request` | معرّف طلب الطوارئ | جاءت من بلاغ طارئ مباشر |
| `system` | nullable (أو معرّف الحدث) | تولّدت تلقائياً (مثل: بعد توقيع عقد، side effect لمهمة) |

> القراءة: من تفاصيل الزيارة يظهر "المصدر" + رابط للسجل الأصلي.

### 2.4 Endpoint الموحد

```
GET    /field-visits                    ← قائمة الزيارات
GET    /field-visits/:id                ← تفاصيل الزيارة
POST   /field-visits/:id/start          ← بدء الزيارة
POST   /field-visits/:id/end            ← إنهاء الزيارة
POST   /field-visits/:id/complete       ← إغلاق الزيارة
PATCH  /field-visits/:id/team           ← إعادة إسناد الفريق
PATCH  /field-visits/:id/reschedule     ← إعادة جدولة (يحل محل "تعديل موعد")
POST   /field-visits/:id/cancel         ← إلغاء (يحل محل "إلغاء موعد")
POST   /field-visits/:id/tasks          ← إضافة مهمة جديدة داخل الزيارة (cascading)
POST   /field-visits/:id/tasks/:id/result ← تسجيل نتيجة مهمة
GET    /field-visits/:id/tasks/:id/result ← قراءة نتيجة مهمة

POST   /telemarketing/book-visit        ← حجز زيارة من التيليماركتر (يلغي /telemarketing/appointments) — قرار D2
```

> **لا يوجد `/marketing-visits/*`.** هذا الـ prefix legacy تماماً.
> **لا يوجد `/telemarketing/appointments/*`** بعد قرار D1 — يُستبدل كلياً بـ `/field-visits/*`.

---

## 3) العقد التشغيلي

### 3.1 مسار الزيارة

```
planning (التخطيط)
    │
    ├── syncAssignedTasks → open_tasks.status = 'assigned'
    │
    ├── generate-from-plan → telemarketing_task_list_items
    │
    ├── telemarketer books appointment → telemarketing_appointments
    │
    └── field_visit created (visit_type = 'marketing' | 'post_sale' | 'emergency')
            │
            ├── visit_tasks created (one per open_task)
            │
            ├── scheduled_date = appointment date
            │
            └── team_snapshot = day_schedule team
                    │
                    ├── day of visit → field_visit.status = 'in_progress'
                    │
                    ├── technician executes tasks
                    │
                    ├── records results → visit_task_results + side tables
                    │
                    └── all done → field_visit.status = 'completed'
```

### 3.2 قاعدة "الوعاء" (Container Rule)

> الزيارة هي **وعاء** (`container`) للمهام.
>
> - تعديل مسموح طول ما الزيارة `scheduled`.
> - إلغاء مسموح قبل `in_progress`.
> - إعادة جدولة مسموحة لـ `scheduled` أو `needs_reschedule`.
> - إضافة مهمة جديدة لزيارة `scheduled` = مسموح (بس بشرط).
> - إزالة مهمة = مسموح إذا ما بدّتش.

### 3.3 كلshي متساوٍ

| المهمة | عائلة | visit_type | معاملة |
|--------|-------|------------|--------|
| `device_demo` | marketing | marketing | = تسليم |
| `device_delivery` | post_sale | post_sale | = عرض |
| `device_installation` | post_sale | post_sale | = عرض |
| `device_activation` | post_sale | post_sale | = عرض |
| `emergency_maintenance` | emergency | emergency | = عرض |

> **لا يوجد مهمة "أهم" من مهمة.** كلن بنفس الـ endpoint، بنفس الـ response format، بنفس الـ lifecycle.

---

## 4) القواعد التشغيلية

### `UV-R001` — زيارة واحدة لكل موعد
لكل موعد (`appointment`) ينشأ `field_visit` واحد فقط. لا يجوز إنشاء زيارتين لنفس الموعد.

### `UV-R002` — المهمة متساوية التعامل
`visit_task` من نوع `device_demo` يُعامل بنفس الآلية يلي `device_delivery` يُعامل بها: نفس الـ endpoint، نفس الـ lifecycle، نفس الـ result recording.

### `UV-R003` — لا تكرار للـ side tables
كل `visit_task` لها `visit_task_results` واحد. إذا بيانات إضافية (مثل offers للـ demo) → side table. ما في `visit_task_results` تانية.

### `UV-R004` — الـ legacy wrapper يُهمل
`marketing_visits` (legacy wrapper) لا يُستخدم بعد اكتمال migration. أي كود جديد يُكتب لـ `field_visits` فقط.

### `UV-R005` — source_legacy للـ audit بس
أعمدة `source_legacy_type` و `source_legacy_id` موجودة بس للـ backward compatibility والـ audit. ما بيُستخدموا بالـ business logic.

### `UV-R006` — `open_tasks` مستقل عن `visit_tasks`
`open_tasks` كيان "الوعد" (promise) منفصل عن `visit_tasks` كيان "التنفيذ" (execution). الربط بس عن طريق `visit_tasks.source_open_task_id`. لا يجوز دمج الجدولين.

### `UV-R007` — كل زيارة تحمل مصدرها (`origin_type` + `origin_id`)
لا تُنشأ زيارة بدون تحديد مصدرها. القيم المسموحة لـ `origin_type`: `telemarketing`, `manual`, `emergency_request`, `system`. التفاصيل في §2.7.

### `UV-R008` — `visit_task` نسخة تنفيذ، نتيجة واحدة فقط
كل `visit_task` يمثّل **محاولة تنفيذ واحدة** ضمن زيارة واحدة. له صف واحد فقط في `visit_task_results` (مع side table للتفاصيل النوعية). لا يوجد سجل تاريخي للنتائج داخل نفس `visit_task` — التاريخ موجود كـ chain من `visit_tasks` تحت نفس `open_task` (راجع `domains/tasks.md`).

### `UV-R009` — إضافة مهام داخل الزيارة (cascading موسّع — D7)
الفريق المسؤول عن زيارة `in_progress` يستطيع إضافة **أي `open_task` للزبون نفسه** كـ `visit_task` (موجود مسبقاً أو يُنشأ لحظياً). لا قائمة بيضاء، شرط N-window معطّل. القيد الوحيد: نفس `field_visit.client_id`. كل `visit_task` جديد يربط بـ `source_open_task_id`.

### `UV-R010` — دورة حياة 7 حالات (D8 + D18)
الحالات المعتمدة: `scheduled`, `in_progress`, `ended`, `completed`, `not_completed`, `closed`, `cancelled`. **محذوفة:** `postponed_by_company`, `postponed_by_customer`, `needs_reschedule`. `cancelled` فقط من `scheduled`.

### `UV-R011` — لا إعادة جدولة على الزيارة (D18)
الزيارة = موعد لمرة واحدة. لا `PATCH /reschedule`. مفهوم "تأجيل" يتم عبر: `cancel` الزيارة → `open_task` ترجع لـ `last_waiting_status` → جدولة جديدة لاحقاً.

### `UV-R012` — حصر الحجز ضمن خطة اليوم (D18)
لا يجوز إنشاء `field_visit` لتاريخ: ليس له `day_schedule` محفوظ، أو لا تشمل `route_assignments` فيه منطقة الزبون، أو في الماضي.

### `UV-R013` — completed محسوب لا يدوي (D9 + D16 + DEC-007 §2 المبدأ الرابع)
الزيارة تنتقل `completed` تلقائياً عند تحقق **الشروط الثلاثة** مجتمعة (DEC-007 D44):
1. كل `visit_tasks` لها `visit_task_results.final_decision` غير NULL.
2. `visit_survey` موجود لـ `field_visit_id` (مُعبَّأ كلياً أو `is_skipped = TRUE` مع `skip_reason`).
3. لا اشتراط لـ `referral_sheet` — اللائحة اختيارية (DEC-007 D45).

الانتقال يُنفَّذ عبر helper `checkAndCompleteVisit(visitId)` يُستدعى بعد كل save لـ task_result أو survey أو survey skip (DEC-007 P-DEC007-04). **لا زر "إكمال" يدوي**. `not_completed` على مستوى الزيارة استثناء يدوي (الفريق وصل ولقي الموقع مغلق).

### `UV-R014` — GPS إلزامي مع `location_missing` استثناء (D17)
GPS مطلوب عند البدء والإنهاء. مهلة 30 ثانية. الفشل يتطلب `location_missing = true` + سبب من قائمة.

### `UV-R015` — صلاحيات حسب نوع الفريق (D11)
المسؤول = المشرف للقياسي، الفني للطوارئ، والدور المقابل للرديف. صلاحية فتح `closed` جديدة وحصرية بالإدارة العليا.

### `UV-R016` — `customer_snapshot` = Level 2 من `client-snapshot.md` (D12)
لا تكرار schema. الزيارة تستخدم Standard Snapshot المعرّف هناك.

### `UV-R017` — `contact_target` يبقى مغلقاً بعد إلغاء الزيارة (D23)
هدف اليوم تحقق بالتواصل. إلغاء الزيارة لا يُعيد فتح `contact_target`. العمل اللاحق عبر `contact_target` يوم جديد أو خطة المدير.

---

### `UV-R018` — الشقّان الأساسيان لكل زيارة (DEC-007 §2 المبدأ الأول)

كل `field_visit` يحوي **بنيوياً** جزأين أساسيين خارج `visit_tasks`، مرتبطين بـ `field_visit_id` مباشرة عبر FK مع قيد `UNIQUE` (واحد لكل زيارة):

#### الشق الأول: اللائحة `referral_sheet` — **اختيارية**
- يُسمح بزيارة بدون لائحة دون سبب صريح.
- تُنشأ **يدوياً بزر "إضافة لائحة جديدة"** بعد بدء الزيارة (`status = in_progress`) — DEC-007 D41.
- الحقول المملوءة آلياً عند الإنشاء: `referral_type='client'`، `referral_entity_id=client_id`، snapshots للاسم والعنوان، `referral_origin_channel='visit'`، `field_visit_id`، `owner_user_id=team_responsible_user_id`، `target_candidates=0`، `status='New'`، `referral_date=scheduled_date`.
- تحديث `target_candidates` لاحقاً عبر endpoint منفصل خلال `in_progress` أو `ended`. لا حاجة لإنشاء جديد، فقط UPDATE.

#### الشق الثاني: الاستبيان `visit_survey` — **إلزامي**
- لا تُكتمل الزيارة بدونه إلا بـ skip معتمد من `system_lists` فئة `survey_skip_reasons` (DEC-007 D42).
- **11 حقلاً ثابتاً:** `household_members_count`, `drinking_water_source`, `tds_test_result`, `hardness_test_drops`, `demo_kit_tds_result`, `customer_opinion_water_source`, `customer_opinion_demo_kit`, `customer_opinion_purification_idea`, `customer_purchase_intent`, `expected_payment_method`, `area_evaluation` (4 قيم من `area_evaluation_options`: ممتازة/جيدة/متوسطة/ضعيفة — DEC-007 D43).
- قيد CHECK مركّب: إما `is_skipped = TRUE` + `skip_reason` + كل الـ 11 حقل NULL، أو `is_skipped = FALSE` + كل الـ 11 غير NULL + `filled_by_user_id` غير NULL.

#### مسؤول الفريق = المالك (DEC-007 المبدأ 2 + D47)
- الفريق القياسي (`TeamSlot`): المسؤول = المشرفة (`supervisor`).
- فريق الطوارئ (`EmergencySlot`): المسؤول = الفني (`technician`).
- عند إنشاء الزيارة، المسؤول يُحفظ كـ `team_responsible_user_id` snapshot على `field_visits` (من `team_snapshot`). كل `referral_sheet` (`owner_user_id`) وكل `visit_survey` (`filled_by_user_id`) يحملان قيمة المسؤول لحظة الإنشاء.
- إعادة تعيين الفريق لاحقاً لا تُحدِّث الملكية retroactively.

#### توقيت فتح الإدخال (DEC-007 المبدأ 3 + D46)
- كلاهما **مغلق** في `status = scheduled` (الواجهة معطّلة).
- يفتح للإدخال بعد `POST /field-visits/:id/start` (يصبح `in_progress`).
- يبقى متاحاً خلال `ended`.
- يُغلق عند `completed`.
- السبب: اللائحة قرار من الزبون أثناء الزيارة، الاستبيان قياسات تحتاج معدات الزيارة (Demo Kit, TDS meter). الإدخال المسبق يفقد معناه.

---

## 5) سلوك الواجهة

### 5.1 شاشة قائمة الزيارات (`VisitsListPage`)
تعرض:
- كل الزيارات (marketing + post_sale + emergency)
- فلتر حسب `visit_type`
- تاريخ، فريق، زبون، عدد المهام، الحالة
- رابط لـ تفاصيل الزيارة الموحدة

### 5.2 شاشة تفاصيل الزيارة (`VisitDetailPage`)
تعرض:
- معلومات الزيارة (زبون، موعد، فريق)
- قائمة المهام (كلshي — عرض + تسليم + تركيب + صيانة)
- كل مهمة: حالة، نتيجة، زر "تسجيل نتيجة"
- أزرار lifecycle (بدء، إنهاء، إلغاء، إعادة جدولة)

### 5.3 مودال تسجيل النتيجة (`VisitTaskResultModal`)
- يفتح لأي نوع مهمة
- الـ fields بتختلف حسب `task_type` (conditional rendering)
- الـ submit بيروح لـ `POST /field-visits/:id/tasks/:id/result`

---

## 6) الفجوات والـ Legacy

### `UV-G001` — `marketing_visits` Legacy Migration
**الحالة: ✅ Migration مكتمل 100% — كل المراحل منفذة**

| المرحلة | الشغل | الحالة |
|---------|-------|--------|
| ١ | Backend: `GET /field-visits/` list + `POST reschedule` + `POST cancel` + demo result handler | ✅ منفذ |
| ٢ | API Client: `api.fieldVisits.list/reschedule/cancel` | ✅ منفذ |
| ٣ | قائمة الزيارات: `VisitsListPage.tsx` → `/field-visits` | ✅ منفذ |
| ٤ | تفاصيل الزيارة: `VisitDetailPage.tsx` مع demo result + lifecycle | ✅ منفذ |
| ٥ | Nav + Routes + Bridge UPSERT عند الجدولة | ✅ منفذ |
| ٦ | نقل الـ Permissions (`marketing_visits.*` → `field_visits.*`) | ✅ منفذ |
| ٧ | حذف `marketingVisits.ts` backend + components + pages | ✅ منفذ |
| ٨ | حذف `MarketingVisit` types | ✅ منفذ |
| ٨.٥ | نهigrate `ContractForm.tsx` لـ `fieldVisits` | ✅ منفذ |
| ٩ | حذف آخر methods من `api.ts` | ✅ منفذ |
| ١٠ | حذف الباقي من `types.ts` | ✅ منفذ |
| ١١ | Verify build + clean remaining refs | ✅ منفذ |
| ١٢ | تنظيف `telemarketing.ts` + `openTasks.ts` SQL | ✅ منفذ |
| **١٣** | **حذف جداول `marketing_visits` + `marketing_visit_tasks` + `marketing_visit_task_offers` من DB** | **✅ DONE** |

**النتيجة:**
- `marketing_visits` ❌ محذوف (جدول + API + types + components)
- `field_visits` ✅ الكيان الوحيد والـ Canonical
- `visit_tasks` ✅ الكيان الوحيد للمهام
- `visit_task_results` ✅ النتائج الموحدة

### `UV-G002` — `open_tasks` لسا independent
**الحالة: مغلق ✅ — قرار المنتج: يبقى independent**

`open_tasks` (مهام مفتوحة) بيضلّ كيان منفصل عن `visit_tasks`. `open_tasks` = "الوعد" (promise)، `visit_tasks` = "التنفيذ" (execution). الربط بس عن طريق `visit_tasks.source_open_task_id`. انظر: `domains/visits.md` القاعدة `V-R006`.

### `UV-G003` — `telemarketing_appointments` لسا منفصلة
**الحالة: مغلقة ✅ — قرار D1 (2026-05-31)**

**القرار:** الزيارة = الموعد. `telemarketing_appointments` يُحذف بالكامل. `field_visits` هو الكيان الوحيد للموعد. راجع §2.6 + `decisions/DEC-003-visit-task-unification.md`.

### `UV-G004` — `visit_type` و `visit_family` لا يفرّقا `post_sale` عن `emergency`
**الحالة: مغلقة ✅ — قرار D4 (2026-05-31)**

**القرار:**
- `visit_type` يبقى تصنيف خفيف بـ 3 قيم: `marketing` \| `service` \| `mixed` (راجع §2.5).
- `visit_family` يُهمل كحقل تصنيفي.
- التفصيل التشغيلي يعتمد على `visit_tasks.task_type` و `task_type_config.task_family`.

---

## 7) التوافق الخلفي

- `PlanOverview` يقرأ من `field_visits` (عبر `workScopes` أو `planningMarketingTargets`)
- `PlanningContactTargets` تولد `field_visit` + `visit_tasks`
- `TelemarketerWorkspace` يخلق موعد → يولد `field_visit`
- `PostSaleStepper` يربط `open_task` بـ `visit_task` ضمن `field_visit`
- `EmergencyResultWizard` يسجل نتيجة على `visit_task` ضمن `field_visit`

---

## 8) الخلاصة

> **الزيارة = كيان واحد (`field_visits`).**
> **المهمة = جزء من الزيارة (`visit_tasks`).**
> **النوع = مجرد label (`task_type`)، مش كيان منفصل.**
> **النتيجة = موحدة (`visit_task_results`) + تخصيص (`side tables`).**
> **الـ Legacy (`marketing_visits`) = يُهمل ويُحذف.**
