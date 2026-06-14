# دستور فيتشر — دراسة النطاقات

> الحالة: معتمد كمرجع دستوري للفيتشر
> النسخة: v2 (2026-06-13) — أضاف Mode 2 والـ snapshot المجمَّد
> اللغة: عربية موحّدة
> النطاق: Planning Zone Study
> الغرض: تثبيت وظيفة `ZoneStudy` كمرحلة وسيطة تحليلية في فلو التخطيط اليومي بين جدولة الفرق وتوزيع المسارات، تتيح لمدير الفرع رؤية المهام المؤهلة لزبائن ملك الشركة لكل منطقة، مع تفصيل سحب فرق اليوم الطبيعي للمنطقة عبر ملكيتها الشخصية على الزبائن.

---

## 0) الملخص التنفيذي

`ZoneStudy` صفحة شبه-قراءة تُعرض بعد حفظ جدول الفرق `day_schedule` وقبل توزيع المسارات `route_assignments`. تأخذ تاريخ اليوم التشغيلي ومعرّف الفرع الفعّال، وترجع جدولاً: صفّ لكل zone، عمود رقمي للشركة، وعمود تحليلي X / Y لكل فريق في `day_schedule`.

تدعم الصفحة **نمطَين (Modes)**:

- **Mode `auto`:** الـ zones تُستخرج تلقائياً (كل zone فيه ≥1 مهمة شركة مؤهلة). snapshot على مستوى الفرع.
- **Mode `manual`:** المدير يختار zones يدوياً لاستكشاف بدائل (مناطق هادئة، تنويع تغطية). snapshot على مستوى المستخدم.

كلا الـ Modes يستخدمان نموذج **snapshot مجمَّد بعد منتصف الليل**: ضمن اليوم T الـ snapshot قابل للتحديث بزر "تحديث"، وبعد منتصف الليل يصير سجلاً مغلقاً يُقرأ ولا يُحدَّث. هذا يعطي المدير أداة قرار ضمن اليوم وأثراً تدقيقياً بعده.

هذا الجدول يجيب على سؤال المدير: **"أي فريق له سحب طبيعي إلى هذا الـ zone، ليكون توزيعه عليه أكثر كفاءة؟"** فالفريق الذي يملك زبائن شخصيين بمهام `device_demo` كثيرة في الـ zone سيُمضي وقتاً أطول هناك على أي حال، فإضافة مهام الشركة إلى مساره يُقصِّر مسارات الفرق الأخرى ويزيد إنتاجية اليوم.

`ZoneStudy` لا تكتب في `route_assignments` ولا في `work_scopes` ولا في `open_tasks`. كل ما تكتبه محصور في جدول واحد جديد `zone_study_snapshots`. القرار الفعلي يبقى يدوياً في `RouteAssigner`، وقاعدة "أول من حُفظ له workScope يأخذ المهام" (PL-R009) لا تتغير.

---

## 1) الفلو البشري المبسّط

`اختيار التاريخ → جدولة الفرق → حفظ جدول اليوم → فتح دراسة النطاقات → اختيار النمط (auto/manual) → قراءة الجدول → تحديث عند الحاجة → الانتقال إلى توزيع المسارات → اتخاذ القرار يدوياً`

### شرح كل خطوة

- **اختيار التاريخ**: يحدد اليوم التشغيلي المراد تخطيطه. الافتراضي اليوم الحالي (`CURRENT_DATE`).
- **جدولة الفرق**: مدير الفرع يحفظ جدول اليوم في `TeamScheduler`.
- **فتح دراسة النطاقات**: يضغط زر "دراسة النطاقات" بعد حفظ الجدول.
- **اختيار النمط**: يبدأ افتراضياً في Mode 1 (auto). يقدر يحوّل إلى Mode 2 (manual) لاستكشاف بدائل.
- **قراءة الجدول**: في Mode 1 يرى الـ zones التلقائية. في Mode 2 يضيف zones يدوياً من قائمة الفرع.
- **التحديث عند الحاجة**: ضمن اليوم T، زر "تحديث" يعيد حساب snapshot من الحالة الراهنة.
- **الانتقال إلى توزيع المسارات**: يضغط زر "متابعة إلى توزيع المسارات".
- **اتخاذ القرار يدوياً**: يبني `route_assignments` في `RouteAssigner` بناءً على القراءة.

### بعد منتصف الليل

عند فتح صفحة لتاريخ T < اليوم الحالي:
- زر "تحديث" مخفي.
- في Mode 2 لا يمكن إضافة أو حذف zones.
- الجدول يعرض snapshot كما كان لحظة آخر تحديث قبل منتصف الليل.
- بانر "هذا snapshot مجمَّد ليوم سابق" واضح.

---

## 2) حدود الفيتشر

### 2.1 داخل النطاق

تشمل هذه الفيتشر كل ما يلي:

- نمطان متمايزان: `auto` (تلقائي) و `manual` (يدوي).
- في Mode `auto`: استخراج كل zone فيه ≥1 مهمة شركة مؤهلة لليوم T.
- في Mode `manual`: تخزين قائمة zones باختيار المستخدم وحساب الأرقام لها.
- حساب عدد المهام المؤهلة (كل الأنواع) لزبائن ملك الشركة لكل zone.
- حساب X / Y لكل فريق في `day_schedule` لكل zone.
- التحقق من `actingBranchId` من سياق المصادقة.
- كتابة الـ snapshot في جدول `zone_study_snapshots`.
- تحديث الـ snapshot ضمن اليوم T بضغط زر "تحديث".
- تجميد الـ snapshot بعد منتصف الليل بمنطق محسوب (`date < CURRENT_DATE`).
- زر تنقل من `TeamScheduler` إلى `ZoneStudy`.
- زر تنقل من `ZoneStudy` إلى `RouteAssigner`.

### 2.2 خارج النطاق

لا تملك هذه الفيتشر:

- كتابة أو تعديل في `route_assignments`.
- كتابة أو تعديل في `work_scopes`.
- كتابة أو تعديل في `open_tasks` بما يشمل `assigned_team_key` و `assigned_scope_id` و `assigned_for_date`.
- اقتراح آلي لتوزيع الـ zones على الفرق.
- إنشاء جدول الفرق أو تعديله.
- إدارة `client_assignments` أو تعديل الملكية الشخصية.
- إنشاء مهام جديدة من شاشة الدراسة.
- تنفيذ `syncAssignedTasks` أو ما يقوم مقامها.
- cron jobs أو polling تلقائي. التحديث صريح فقط.
- تعديل snapshot ليوم سابق (المنع للسوبرأدمن أيضاً).

### 2.3 ممنوع الخلط بين الكيانات

- دراسة النطاقات ليست توزيع المسارات.
- دراسة النطاقات ليست نطاق العمل `work_scope`.
- دراسة النطاقات ليست `PlanOverview` (الذي يقرأ بعد التوزيع).
- جدول `ZoneStudy` ليس جدول الفرق نفسه.
- X / Y في عمود الفريق ليس "حجم مهام الفريق" المعتاد؛ هو X = عمق المحفظة المحتمل و Y = حمل اليوم الفعلي بمعنى `device_demo` المؤهلة.

---

## 3) خريطة المصدر

### 3.1 ملفات الخلفية المتوقعة

- `packages/api/services/zoneStudy.ts` (جديد) — منطق `computeZoneStudy`, `getOrCreateSnapshot`, `refreshSnapshot`.
- `packages/api/routes/zoneStudy.ts` (جديد) — 5 endpoints حسب §10.
- `packages/api/services/customerOwnership.ts` (موجود — يُعاد استخدامه).
- `packages/api/services/teamPlanningScope.ts` (مرجعي — لا تعديل).
- `migrations/NNN_zone_study_snapshots.sql` (جديد) — إنشاء الجدول.

### 3.2 ملفات الواجهة المتوقعة

- `packages/web/src/pages/planning/ZoneStudy.tsx` (جديد).
- `packages/web/src/pages/planning/TeamScheduler.tsx` (يضاف زر تنقل).
- `packages/web/src/pages/planning/RouteAssigner.tsx` (يستلم زائر قادم من `ZoneStudy`).
- `packages/web/src/lib/api.ts` (يضاف client للـ endpoint الجديد).

### 3.3 الملفات المشتركة المؤثرة

- `packages/shared/types.ts` (يضاف `ZoneStudyMode`, `ZoneStudyRow`, `ZoneStudyTeamCell`, `ZoneStudySnapshot`).
- `packages/shared/contracts/roles.ts` (لا تغيير — نفس الصلاحية القائمة).

### 3.4 الملفات الدستورية المرتبطة

- `docs/constitution/domains/planning.md`
- `docs/constitution/domains/work-scopes.md`
- `docs/constitution/domains/route-assignments.md`
- `docs/constitution/domains/open-tasks.md`
- `docs/constitution/decisions/DEC-002-contract-ownership-from-task.md`
- `docs/constitution/decisions/DEC-005-contact-targets-filter.md`
- `docs/constitution/decisions/DEC-008-zone-study-stage.md`
- `docs/constitution/domains/permissions.md`
- `docs/constitution/domains/permissions-engineering-standard.md`
- `docs/constitution/features/planning-contact-targets.md`

---

## 4) المفاهيم الأساسية

### 4.1 المهمة المؤهلة (Eligible Task)

مهمة `open_task` تنطبق عليها شروط N-window من DEC-005:

- `status IN ('open', 'needs_follow_up')`.
- إذا كان لها `expected_date`: ضمن نافذة `task_type_config.lead_window_days` قبل التاريخ.
- وإلا إذا كان لها `required_date`: ضمن نفس النافذة.
- وإلا (لا تواريخ): مؤهلة دائماً ضمن منطقتها.
- المهام المتأخرة (الفائتة) تبقى مؤهلة وتظهر بإشارة "متأخرة" (سلوك DEC-005، مبدأ سادس).

### 4.2 الـ Zone

`geo_units.id` يعكس وحدة جغرافية. يأتي للمهمة من:

- `clients.neighborhood` إذا `task_type_config.location_basis = 'client'`.
- `installed_devices.installation_geo_unit_id` إذا `task_type_config.location_basis = 'device'`.

(انعكاس مباشر لقاعدة PL-R013.)

### 4.3 ملكية الشركة وملكية شخصية

تعريف `customerOwnership.ts` الموجود:

- **ملك الشركة (company-owned):** `ownerType IN ('company_branch', 'company_global')`. الزبون OP/FOP، أو زبون LEAD بلا أي `client_assignment` فعّال.
- **ملك شخصي (personal-owned):** `ownerType IN ('personal_single_supervisor', 'personal_single_technician', 'personal_multi')`. الزبون LEAD مع `client_assignment` فعّال لمستخدم نشط بدور `team_slot_type IN ('SUPERVISOR', 'TECHNICIAN')`.

### 4.4 الفريق في `day_schedule`

كل عنصر في `day_schedules.teams` يمثل فريق قياسي بمفتاح `team_X`. يحتوي أعضاء بأدوار `supervisor`, `technician`, `telemarketers`, `trainee`. `ZoneStudy` تأخذ من كل فريق المعرّفات `supervisor.hrUserId` و `technician.hrUserId` فقط (الأدوار صاحبة `team_slot_type IN ('SUPERVISOR', 'TECHNICIAN')`).

### 4.5 X (عمق المحفظة)

عدد الزبائن في الـ zone اللذين:

- `customerOwnership.ownerType` ليس company.
- على الأقل واحد من `personalAssignments[*].userId` يساوي `supervisor.hrUserId` أو `technician.hrUserId` للفريق.
- ليس لهم `device_demo` بحالة `('open', 'needs_follow_up')` (سواء مؤهلة أم لا).

### 4.6 Y (حمل اليوم)

عدد مهام `device_demo` المؤهلة (N-window) بحالة `('open', 'needs_follow_up')`، لزبائن ملك شخصي لأي عضو في الفريق، داخل الـ zone.

### 4.7 عمود الشركة

عدد كل المهام المؤهلة لزبائن ملك الشركة في الـ zone. يشمل كل أنواع المهام الموجودة في `task_type_config`.

### 4.8 النمط (Mode) — v2

قيمة `'auto'` أو `'manual'`. تحدد مصدر صفوف الجدول:

- **`auto`:** الصفوف مستخرجة تلقائياً من شرط D39 (≥1 مهمة شركة مؤهلة). snapshot per-branch.
- **`manual`:** الصفوف باختيار يدوي من المدير. snapshot per-user.

كلا الـ Modes يستخدمان نفس حساب الأعمدة.

### 4.9 الـ Snapshot — v2

سجل في `zone_study_snapshots` يخزن الحالة الكاملة للجدول لـ (فرع + تاريخ + مستخدم + نمط).

`snapshot_data` JSONB يحتوي:
- `zones: ZoneStudyRow[]` — الصفوف الكاملة بالأرقام.
- `computedAt: timestamp` — لحظة الحساب.
- `branchSchedulePresent: boolean` — هل كان `day_schedule` موجوداً لحظة الحساب.

### 4.10 التجميد بعد منتصف الليل — v2

snapshot للتاريخ T:
- **قابل للتحديث** إذا `T >= CURRENT_DATE` (يعني اليوم الحالي أو المستقبل).
- **مجمَّد** إذا `T < CURRENT_DATE`. لا تحديث، لا إضافة، لا حذف.

التجميد منطقي محسوب — لا حقل `is_locked` في DB، لا cron job.

---

## 5) الكيانات والحقول

### 5.1 صف جدول الدراسة `ZoneStudyRow` (نوع داخلي للواجهة، غير مخزّن)

#### الحقول الجوهرية

- `zoneId` (integer) — معرّف `geo_units.id`.
- `zoneName` (string) — اسم المنطقة من `geo_units.name`.
- `companyEligibleCount` (integer) — عدد مهام الشركة المؤهلة.
- `teams` (array of `ZoneStudyTeamCell`).

### 5.2 خانة فريق في صف `ZoneStudyTeamCell`

#### الحقول الجوهرية

- `teamKey` (string) — `team_X`.
- `teamLabel` (string) — اسم الفريق المعروض (مثلاً "فريق هند").
- `untappedLeads` (integer) — قيمة X.
- `eligibleDeviceDemos` (integer) — قيمة Y.

### 5.3 جدول DB جديد — `zone_study_snapshots` (v2)

#### الحقول الجوهرية

| الحقل | النوع | NULL? | الوصف |
|---|---|---|---|
| `id` | `SERIAL` | ❌ | المعرف الفريد. |
| `branch_id` | `INTEGER` | ❌ | FK → `branches(id) ON DELETE RESTRICT`. |
| `date` | `DATE` | ❌ | اليوم التشغيلي الذي يخص الـ snapshot. |
| `user_id` | `INTEGER` | ✅ | FK → `hr_users(id) ON DELETE SET NULL`. NULL لـ `mode='auto'`، قيمة لـ `mode='manual'`. |
| `mode` | `VARCHAR(20)` | ❌ | `'auto'` أو `'manual'` (CHECK constraint). |
| `snapshot_data` | `JSONB` | ❌ | الصفوف الكاملة (انظر 4.9). |
| `refreshed_at` | `TIMESTAMPTZ` | ❌ | لحظة آخر تحديث. DEFAULT `NOW()`. |
| `created_at` | `TIMESTAMPTZ` | ❌ | لحظة الإنشاء. DEFAULT `NOW()`. |

#### القيود

- `UNIQUE (branch_id, date, user_id, mode)` — snapshot واحد لكل تجميعة.
- `CHECK (mode IN ('auto', 'manual'))`.
- لا soft-delete. الحذف فيزيائي إن حدث.

#### الفهارس

- `idx_zone_study_snapshots_branch_date (branch_id, date)`.

#### مصادر البيانات المحسوبة لـ `snapshot_data`

- `open_tasks` + `task_type_config` (الأهلية).
- `clients` + `installed_devices` + `geo_units` (الـ zones).
- `client_assignments` + `hr_users` + `roles` + `employees` (الملكية).
- `day_schedules` (الفرق).

---

## 6) دورة الحياة والحالات — v2

### 6.1 دورة حياة الـ snapshot

```
أول فتح ليوم T (GET)
   ↓
لا snapshot موجود → حساب من الحالة الراهنة → INSERT في DB
   ↓
عرض على المستخدم
   ↓
─────────── خلال اليوم T (T = CURRENT_DATE) ───────────
   │
   ├─ زر "تحديث" → POST /refresh → إعادة حساب → UPDATE snapshot_data + refreshed_at
   │
   ├─ Mode 2: إضافة zone → POST /manual/pick → UPDATE snapshot_data
   │
   └─ Mode 2: حذف zone → DELETE /manual/pick/:id → UPDATE snapshot_data
   ↓
─────────── بعد منتصف الليل (T < CURRENT_DATE) ───────────
   │
   ├─ زر "تحديث" مخفي في الواجهة.
   ├─ POST /refresh يرجع 403 SNAPSHOT_FROZEN.
   ├─ POST /manual/pick يرجع 403 SNAPSHOT_FROZEN.
   ├─ DELETE /manual/pick/:id يرجع 403 SNAPSHOT_FROZEN.
   └─ GET يرجع 200 مع snapshot كما هو.
```

### 6.2 حالات الجدول المعروض

- **مكتمل (live):** الـ endpoint رجع snapshot لليوم T = اليوم الحالي. الواجهة تعرض الأرقام مع زر تحديث.
- **مكتمل (مجمَّد):** الـ endpoint رجع snapshot لليوم T < اليوم الحالي. الواجهة تعرض الأرقام مع شارة "مجمَّد" بدون زر تحديث.
- **فارغ (auto):** لا توجد مهام شركة مؤهلة في الفرع لليوم T؛ تُعرض رسالة "لا zones تستدعي الدراسة لهذا اليوم".
- **فارغ (manual):** المدير لم يضف أي zone بعد؛ تُعرض رسالة "أضف منطقة لاستكشاف توزيع الفرق".
- **بدون snapshot:** يوم سابق بلا snapshot محفوظ؛ تُعرض رسالة "لا snapshot محفوظ لهذا اليوم" بدون محاولة إنشاء.
- **بدون فرق:** Mode 1 على يوم بلا `day_schedule`؛ يعرض عمود الشركة فقط مع بانر "لا فرق محفوظة — ارجع لجدولة الفرق".
- **خطأ:** `400` إذا التاريخ غير صالح، `403` إذا غياب الصلاحية، `400` إذا غياب الفرع الفعّال، `403 SNAPSHOT_FROZEN` لمحاولة كتابة على يوم سابق.

### 6.3 أرشفة وتاريخ

كل snapshots محفوظة في DB إلى الأبد (لا حذف، لا soft-delete). المدير يقدر يرجع لأي يوم سابق ويرى snapshot كما كان مجمَّداً. هذا يخدم التدقيق التشغيلي.

---

## 7) الصلاحيات والنطاق — v2

التزاماً بالمعيار الهندسي للصلاحيات (`permissions-engineering-standard.md`, 2026-06-11) الذي يفصل قرار القراءة عن قرار الكتابة، يُعرَّف لـ `ZoneStudy` صلاحيتان مستقلتان (لا إعادة استخدام `planning.manage`).

### 7.1 مصفوفة الصلاحيات

| المفتاح | النوع | Scope | الوصف |
|---|---|---|---|
| `planning.zone_study.view` | Operation | `BRANCH` | قراءة جدول الدراسة و snapshots لكل `GET`، يشمل الأيام المجمَّدة. |
| `planning.zone_study.manage` | Operation | `BRANCH` | تحديث snapshot وإضافة/حذف picks في Mode 2 (`POST /refresh`, `POST /manual/pick`, `DELETE /manual/pick/:id`). |

### 7.2 قواعد التطبيق

- `manage` لا تُغني عن `view`؛ من يحتاج التحديث يُمنح الاثنتين.
- subject لكل عملية كتابة = `branch_id` للـ snapshot المستهدف، يُتحقق منه عبر `actingBranchId`.
- خصوصية Mode 2 تُحمى بعمود `user_id` في `zone_study_snapshots`، لا بالـ scope: حتى مع `planning.zone_study.view`، الـ query يفلتر `user_id = req.user.id` لـ `mode = 'manual'` فلا يرى مستخدم استكشاف مدير آخر.
- إخفاء التبويب أو زر التحديث في الواجهة تحسين UX فقط؛ التحقق الأمني على الخادم لكل endpoint.

### 7.3 المسؤولية التشغيلية

- مدير الفرع هو المستخدم الأساسي (يملك الصلاحيتين).
- يمكن منح `view` فقط لدور مساعد/مناوب يحتاج القراءة دون إنشاء أو تجميد snapshots.
- المشرفون لا يحتاجون الوصول؛ القرار قرار توزيع لا قرار تنفيذ.

### 7.4 النطاق

- يلزم وجود `actingBranchId` أو فرع فعّال.
- جدول `ZoneStudy` محصور بالفرع الفعّال.
- النطاق `BRANCH` فقط. لا `ASSIGNED`. السوبرأدمن بدون فرع فعّال يرى `400`.

---

## 8) القواعد التشغيلية الأساسية

### `ZS-R001` — `ZoneStudy` لا تعدّل بيانات التشغيل

- لا تكتب في `route_assignments`, `work_scopes`, `open_tasks`.
- لا تستدعي `syncAssignedTasks`.
- لا تعدل `assigned_team_key` أو `assigned_for_date` أو `assigned_scope_id`.
- الكتابة الوحيدة المسموحة على `zone_study_snapshots` فقط.
- تنطبق على: كل endpoints الفيتشر.

### `ZS-R002` — شرط ظهور zone

- yone يظهر إذا وفقط إذا فيه ≥1 مهمة `open_task` تنطبق عليها (eligibility + company-owned + branch + day).
- لا يظهر zone فيه ملكية شخصية فقط بلا مهام شركة.
- التحقق: خدمة `zoneStudy.ts`.

### `ZS-R003` — أهلية المهمة موحّدة مع DEC-005

- يستخدم نفس N-window من `task_type_config.lead_window_days`.
- لا تعريف جديد للأهلية.
- التحقق: استعلام الـ SQL.

### `ZS-R004` — ملكية الزبون من `customerOwnership.ts`

- يُعاد استخدام `buildCustomerOwnershipSql` بدون تعديل.
- لا تعريف موازٍ للملكية.
- التحقق: استعلام الـ SQL.

### `ZS-R005` — المالك الشخصي للفريق يجمع SUPERVISOR و TECHNICIAN

- أي عضو في الفريق بدور `team_slot_type IN ('SUPERVISOR', 'TECHNICIAN')` يُحتسب مالكاً.
- التيلماركتر والمتدرب لا يُحتسبان.
- التحقق: قراءة `day_schedules.teams[*].supervisor.hrUserId` و `.technician.hrUserId`.

### `ZS-R006` — X يستثني device_demo المفتوح

- زبون بـ `device_demo` مفتوح (open/needs_follow_up) سواء مؤهل أم لا يُستثنى من X.
- X يقيس فقط زبائن "بكر" بلا متابعة عرض جهاز قائمة.
- التحقق: استعلام الـ SQL.

### `ZS-R007` — Y يقتصر على `device_demo` المؤهلة

- Y لا يشمل أنواع أخرى من المهام لزبائن الفريق.
- Y لا يشمل `device_demo` غير المؤهلة.
- التحقق: استعلام الـ SQL.

### `ZS-R008` — عمود الشركة يشمل كل الأنواع المؤهلة

- لا يقتصر على `device_demo`.
- يشمل `emergency_maintenance`, `periodic_maintenance`, `collection`, `delivery`, `device_installation`, ...
- التحقق: استعلام الـ SQL.

### `ZS-R009` — الفرع الفعّال إلزامي + صلاحيتان مفصولتان

- غياب `actingBranchId` يرجع `400`.
- كل `GET` يتطلب `planning.zone_study.view`؛ كل `POST`/`DELETE` يتطلب `planning.zone_study.manage`.
- `manage` لا تُغني عن `view`. غياب المنح المطلوب = `403` (deny by default).
- التحقق: middleware الـ permission + subject policy على `branch_id`.

### `ZS-R010` — نطاق snapshot يختلف بحسب الـ Mode (v2)

- `mode = 'auto'`: snapshot per-branch؛ `user_id = NULL` في DB.
- `mode = 'manual'`: snapshot per-user؛ `user_id = req.user.id`.
- مدير يرى snapshot Mode 1 لكل الفرع، و Mode 2 الخاصة به فقط.
- التحقق: في `getOrCreateSnapshot`.

### `ZS-R011` — التجميد بعد منتصف الليل (v2)

- `T < CURRENT_DATE` يجمّد الـ snapshot.
- أي endpoint كتابة يرجع `403 SNAPSHOT_FROZEN` للتاريخ المجمَّد.
- لا استثناء للسوبرأدمن.
- التحقق: middleware `requireSnapshotDateNotFrozen`.

### `ZS-R012` — الإنشاء lazy عند أول GET (v2)

- لا snapshot يُنشأ مسبقاً (لا cron، لا eager-creation عند حفظ `day_schedule`).
- أول `GET` لـ (branch, date, mode, user?) ينشئ snapshot إذا غير موجود.
- استثناء: `T < CURRENT_DATE` بدون snapshot موجود لا ينشئ جديداً؛ يرجع `null`.
- التحقق: في `getOrCreateSnapshot`.

### `ZS-R013` — التحديث صريح فقط (v2)

- snapshot لا يُحدَّث تلقائياً عند تغيّر `open_tasks` أو `client_assignments` أو `day_schedules`.
- التحديث يحدث فقط عند ضغط زر "تحديث" (مع T = اليوم الحالي) أو عند تعديل picks في Mode 2.
- التحقق: لا triggers على الجداول الأخرى.

### `ZS-R014` — Mode 1 يعمل بلا `day_schedule` (v2)

- في حال غياب `day_schedules` ليوم T، Mode 1 ينشئ snapshot بـ `teams: []` لكل zone مع `branchSchedulePresent: false`.
- الواجهة تعرض بانر "لا فرق محفوظة".
- التحقق: في `computeZoneStudy`.

### `ZS-R015` — Mode 2 يقبل zones خالية من مهام شركة (v2)

- في Mode 2 لا شرط أهلية على الـ zone نفسه.
- `companyEligibleCount = 0` ممكن وطبيعي.
- التحقق: في `computeZoneStudy`.

---

## 9) الواجهة المرتبطة بالفيتشر

### 9.1 الصفحة الأساسية

- `packages/web/src/pages/planning/ZoneStudy.tsx`

### 9.2 تركيب الواجهة

- شريط علوي يحوي:
  - حقل التاريخ (افتراضياً اليوم التشغيلي).
  - زر "العودة لجدولة الفرق".
  - زر "متابعة إلى توزيع المسارات".
- جدول مركزي:
  - الصف الأول رؤوس الأعمدة.
  - عمود ثابت يساراً: اسم الـ zone.
  - عمود ثاني: عدد مهام الشركة (محاذاة وسط، خط عريض).
  - أعمدة الفرق: X / Y، مع tooltip يشرح X و Y.
- رسالة فارغة إذا لا zones.

### 9.3 مصادر القيم في الواجهة

- الجدول يأتي من `api.planning.zoneStudy(date)`.
- التاريخ الافتراضي = `today` بصيغة `YYYY-MM-DD`.
- اسم الفريق يُحسب من `day_schedules.teams[i].supervisor.name` أو يُسرد كـ "فريق i" إن غاب الاسم.

### 9.4 ملاحظات تشغيلية للواجهة

- الجدول قراءة فقط، لا inputs.
- لا حفظ، لا تعديل، لا اقتراح.
- إذا الـ endpoint رجع 400 بسبب غياب الفرع، تُعرض رسالة "اختر فرعاً للمتابعة".

---

## 10) واجهات الـ API — v2

### 10.1 قائمة الـ endpoints

| Method | Path | الصلاحية | الوصف |
|---|---|---|---|
| `GET` | `/planning/zone-study?date=...&mode=auto` | `planning.zone_study.view` | يقرأ snapshot Mode 1 لليوم. ينشئ snapshot إذا أول فتح ضمن اليوم الحالي. |
| `GET` | `/planning/zone-study?date=...&mode=manual` | `planning.zone_study.view` | يقرأ snapshot Mode 2 للمستخدم الحالي. ينشئ snapshot فارغ إذا أول فتح ضمن اليوم الحالي. |
| `POST` | `/planning/zone-study/refresh?date=...&mode=...` | `planning.zone_study.manage` | يعيد حساب snapshot ويحدث `snapshot_data` + `refreshed_at`. يرفض إذا `date < CURRENT_DATE`. |
| `POST` | `/planning/zone-study/manual/pick?date=...` | `planning.zone_study.manage` | يضيف `zoneId` لقائمة Mode 2 ويعيد حساب الـ snapshot. |
| `DELETE` | `/planning/zone-study/manual/pick/:zoneId?date=...` | `planning.zone_study.manage` | يحذف `zoneId` من قائمة Mode 2 ويعيد حساب الـ snapshot. |

### 10.2 المعلمات المشتركة

| المعلمة | المكان | النوع | إلزامية | الوصف |
|---|---|---|---|---|
| `date` | Query | `string` | نعم | بصيغة `YYYY-MM-DD`. |
| `mode` | Query | `string` | نعم في GET/refresh | `'auto'` أو `'manual'`. |
| `zoneId` | Body / Path | `integer` | نعم في pick/DELETE | `geo_units.id`. |
| `X-Branch-Id` | Header / Auth Context | `integer` | نعم | سياق الفرع الفعّال. |

### 10.3 Response Schema الموحَّد لـ GET و POST

```json
{
  "date": "2026-06-13",
  "branchId": 3,
  "mode": "auto",
  "userId": null,
  "refreshedAt": "2026-06-13T08:15:00Z",
  "isFrozen": false,
  "snapshot": {
    "branchSchedulePresent": true,
    "zones": [
      {
        "zoneId": 142,
        "zoneName": "الجسر الأبيض",
        "companyEligibleCount": 2,
        "teams": [
          { "teamKey": "team_0", "teamLabel": "فريق هند", "untappedLeads": 10, "eligibleDeviceDemos": 5 },
          { "teamKey": "team_1", "teamLabel": "فريق هدى", "untappedLeads": 10, "eligibleDeviceDemos": 2 },
          { "teamKey": "team_2", "teamLabel": "فريق سعاد", "untappedLeads": 12, "eligibleDeviceDemos": 7 }
        ]
      }
    ]
  }
}
```

- `isFrozen = true` للأيام السابقة. الواجهة تستخدمه لإخفاء زر التحديث.
- `userId = null` لـ `mode = 'auto'`، قيمة لـ `mode = 'manual'`.
- إذا تاريخ سابق بلا snapshot موجود: `snapshot: null, isFrozen: true`.

### 10.4 أخطاء التحقق

- `400`: `date must be YYYY-MM-DD`.
- `400`: `mode must be 'auto' or 'manual'`.
- `400`: `zoneId is required` (في POST/DELETE manual/pick).
- `400`: `A branch context is required`.
- `400`: `zoneId غير صالح أو غير فعّال` (المعرّف لا يطابق `geo_units` فعّالة). ملاحظة: `geo_units` عام بلا `branch_id`، وغرض Mode 2 استكشاف مناطق هادئة، لذا لا يُفرض انتماء المنطقة للفرع — انظر `GAP-ZS-006`.
- `401`: غياب المصادقة.
- `403`: المستخدم لا يملك `planning.zone_study.view` (في GET) أو `planning.zone_study.manage` (في POST/DELETE).
- `403 BRANCH_FORBIDDEN`: الفرع المستهدف خارج تعيينات المستخدم الفعّالة.
- `403 SNAPSHOT_FROZEN`: محاولة كتابة على `date < CURRENT_DATE`.
- `409`: `zoneId already picked` (في POST manual/pick على zone موجود).
- `500`: خطأ داخلي.

### 10.5 خصوصية Mode 2

- المستخدم يرى snapshot Mode 2 الخاص به فقط (لا يرى snapshots المدراء الآخرين).
- في DB، الـ UNIQUE constraint يفصل صفوف Mode 2 لكل مستخدم.

---

## 11) حالات الاختبار الشاملة — v2

### 11.1 اختبارات Mode 1 (auto)

| الرمز | السيناريو | الطريقة والمسار | المدخلات | السلوك المتوقع |
|---|---|---|---|---|
| **TC-01** | أول فتح Mode 1 لليوم الحالي | `GET ?date=today&mode=auto` | تاريخ اليوم + فرع فعّال | `200` + إنشاء snapshot جديد في DB + `isFrozen: false` |
| **TC-02** | فتح Mode 1 بعد إنشاء snapshot | نفس | بعد TC-01 | `200` + نفس الـ snapshot من DB بدون إعادة حساب |
| **TC-03** | تحديث Mode 1 ضمن اليوم | `POST /refresh?date=today&mode=auto` | snapshot موجود | `200` + إعادة حساب + `refreshed_at` جديد |
| **TC-04** | تحديث Mode 1 لتاريخ سابق | `POST /refresh?date=yesterday&mode=auto` | snapshot موجود | `403 SNAPSHOT_FROZEN` |
| **TC-05** | فتح Mode 1 لتاريخ سابق بـ snapshot موجود | `GET ?date=yesterday&mode=auto` | snapshot موجود | `200` + `isFrozen: true` |
| **TC-06** | فتح Mode 1 لتاريخ سابق بلا snapshot | `GET ?date=oldDay&mode=auto` | لا snapshot | `200` + `snapshot: null, isFrozen: true` (لا إنشاء جديد) |
| **TC-07** | يوم بلا مهام شركة مؤهلة | `GET ?date=today&mode=auto` | data فارغة | `200` + snapshot بـ `zones: []` |
| **TC-08** | Mode 1 بدون `day_schedule` | `GET ?date=today&mode=auto` بلا جدول | data بهذه الحالة | `200` + snapshot بـ `branchSchedulePresent: false` + `teams: []` لكل zone |

### 11.2 اختبارات Mode 2 (manual)

| الرمز | السيناريو | الطريقة والمسار | المدخلات | السلوك المتوقع |
|---|---|---|---|---|
| **TC-09** | أول فتح Mode 2 لمدير جديد | `GET ?date=today&mode=manual` | لا snapshot للمستخدم | `200` + إنشاء snapshot per-user بـ `zones: []` |
| **TC-10** | إضافة zone في Mode 2 | `POST /manual/pick {zoneId: 142}` | zone صالح | `200` + snapshot يحوي zone واحد بأرقام محسوبة |
| **TC-11** | إضافة zone مكرر | نفس بنفس zoneId | snapshot موجود فيه zone | `409 zoneId already picked` |
| **TC-12** | حذف zone من Mode 2 | `DELETE /manual/pick/142?date=today` | snapshot يحوي zone 142 | `200` + snapshot بدون zone 142 |
| **TC-13** | zone غير موجود أو غير فعّال | `POST /manual/pick {zoneId: 999999}` | معرّف لا يطابق `geo_units` فعّالة | `400 zoneId غير صالح أو غير فعّال` |
| **TC-14** | إضافة zone بلا مهام شركة (هادئة) | `POST /manual/pick {zoneId: empty_zone}` | zone فعّالة بلا زبائن/مهام | `200` + zone مضافة مع `companyEligibleCount: 0` و X/Y أصفار (هذا غرض Mode 2) |
| **TC-15** | كل المدراء في نفس الفرع لهم picks منفصلة | مدير A + مدير B | كل واحد يضيف zones مختلفة | snapshots منفصلة في DB |
| **TC-16** | تعديل Mode 2 لتاريخ سابق | `POST /manual/pick` على yesterday | snapshot موجود | `403 SNAPSHOT_FROZEN` |

### 11.3 اختبارات عامة

| الرمز | السيناريو | المدخلات | السلوك المتوقع |
|---|---|---|---|
| **TC-17** | تنسيق تاريخ خاطئ | `date=13-06-2026` | `400 date must be YYYY-MM-DD` |
| **TC-18** | mode غير معروف | `mode=other` | `400 mode must be 'auto' or 'manual'` |
| **TC-19** | فرع غير فعّال | بلا `X-Branch-Id` | `400 A branch context is required` |
| **TC-20** | غياب صلاحية القراءة | `GET` بلا `planning.zone_study.view` | `403` |
| **TC-21** | الـ endpoints لا تكتب في جداول التشغيل | تنفيذ كامل لكل endpoints | لا تغيير في `route_assignments`, `work_scopes`, `open_tasks` |
| **TC-22** | السوبرأدمن لا يستثنى من التجميد | السوبرأدمن يحاول تحديث yesterday | `403 SNAPSHOT_FROZEN` |
| **TC-23** | عدم إنشاء snapshot للأيام السابقة | `GET ?date=lastWeek&mode=auto` بلا snapshot | `200 + snapshot: null` بدون إدخال في DB |
| **TC-24** | view لا تكفي للتحديث | `POST /refresh` بمستخدم يملك `view` فقط بلا `manage` | `403` (المنح الناقص = deny by default) |
| **TC-25** | view لا تكفي لـ pick | `POST /manual/pick` بمستخدم يملك `view` فقط | `403` |
| **TC-26** | فرع خارج تعيينات المستخدم | `GET` لفرع غير مشمول بـ `user_branch_assignments` | `403 BRANCH_FORBIDDEN` |
| **TC-27** | عزل Mode 2 بين المدراء | مدير A يملك `view`، يطلب Mode 2 ليوم فيه picks لمدير B | لا يرى picks مدير B (الـ query يفلتر `user_id`) |

### 11.4 اختبارات الواجهة

- فتح الصفحة بعد حفظ `day_schedule` بنجاح يعرض الجدول.
- فتح الصفحة قبل حفظ `day_schedule` يعرض بانر "لا فرق محفوظة" + الجدول بدون أعمدة الفرق.
- التبويب من auto لـ manual يحفظ مكان المستخدم.
- زر "تحديث" مخفي إذا `date < today`.
- شارة "snapshot مجمَّد" واضحة للأيام السابقة.
- زر "متابعة إلى توزيع المسارات" ينقل إلى `RouteAssigner` مع نفس التاريخ.
- في Mode 2: حقل البحث/الاختيار يقترح zones من قائمة الفرع فقط.

---

## 12) الثغرات والتضاربات المحتملة

### `GAP-ZS-001`: غياب FK validation على `zoneId`

- نفس فجوة GAP-WS-001 و GAP-RA-002 الموثقة في `work-scopes.md` و `route-assignments.md`.
- لا أثر تشغيلي في `ZoneStudy` لأنها قراءة فقط، لكن يلزم استخدام `JOIN geo_units` للتأكد من صحة الـ zone قبل العرض.

### `GAP-ZS-002`: تكرار حساب الأهلية بين `ZoneStudy` و `PlanOverview`

- الـ N-window يُحسب في كلا الفيتشرين على نفس البيانات.
- إذا تغيرت قاعدة الأهلية في DEC لاحق، الفيتشرين يجب أن يتحدثا معاً.
- التوصية: استخراج SQL مشترك في خدمة محايدة (`taskEligibility.ts`) في تحسين لاحق.

### `GAP-ZS-003`: لا تأخذ في الاعتبار "personal_multi"

- زبون له أكثر من مالك شخصي يُحتسب لكل فريق فيه أي من مالكيه.
- النتيجة: نفس الزبون قد يظهر في X / Y لفريقين مختلفين في نفس الـ zone.
- لا يُعتبر خطأ تشغيلياً (المدير يفهم أن `personal_multi` تعني الزبون فعلاً مشترك)، لكن قد يحتاج توضيح في الواجهة عبر tooltip.

### `GAP-ZS-004`: stale snapshot (v2)

- بين ضغطتين لزر "تحديث"، snapshot قد يتقادم: مهام جديدة، تغيير ملكية، إغلاق `contact_target`.
- المدير قد يقرر بناءً على أرقام لم تعد دقيقة لحظياً.
- المنطق التصميمي: التحديث صريح وقرار المدير، الـ stale مقبول كلفة لـ تجميد منتصف الليل.
- توصية تشغيلية: شارة في الواجهة تعرض `refreshed_at` بوضوح، وزر تحديث بارز.

### `GAP-ZS-006`: لا يوجد ربط صارم منطقة↔فرع في المخطط (v2)

- `geo_units` جدول عام (`level/parent_id/status`) بلا `branch_id`.
- لذلك "المنطقة تتبع الفرع" غير قابل للفرض على مستوى قاعدة البيانات.
- التحقق في `pickZone` يقتصر على **وجود + فعّالة** (`assertZoneSelectable`). هذا يخدم غرض Mode 2 صراحةً (استكشاف مناطق هادئة بلا زبائن/مهام).
- الحماية الفعلية: الـ snapshot محصور بالفرع والمستخدم، وأرقام X/Y والشركة تُحسب ضمن الفرع فقط — فاختيار منطقة بعيدة يظهر أصفاراً بلا أي تسريب بيانات.
- لو لزم لاحقاً تقييد جغرافي، يُربط الفرع بـ `geo_unit` جذر وتُفلتر المناطق ضمن شجرته (`parent_id`). مؤجَّل حتى يُطلب.

### `GAP-ZS-005`: عدم تحديث تلقائي عند تغيّر `day_schedule` (v2)

- إذا حفظ المدير `day_schedule` بعد إنشاء snapshot Mode 1، الأعمدة (الفرق) في الـ snapshot لا تتحدث.
- المدير لازم يضغط "تحديث" يدوياً.
- منطق تصميمي مقصود (ZS-R013).
- توصية: تنبيه بسيط في الواجهة إذا `branchSchedulePresent` تغير بين القراءة الأخيرة والآن.

---

## 13) تاريخ التغييرات

| التاريخ | الملف | طبيعة التعديل |
|---|---|---|
| **2026-06-12** | `docs/constitution/features/zone-study.md` | إنشاء أولي عبر DEC-008. |
| **2026-06-13** | `docs/constitution/features/zone-study.md` | v2 — إضافة Mode 2، نموذج snapshot المجمَّد بعد منتصف الليل، جدول `zone_study_snapshots`، 5 endpoints، 6 قواعد جديدة (ZS-R010 إلى ZS-R015)، 2 فجوات جديدة (GAP-ZS-004 و GAP-ZS-005). |
| **2026-06-13** | `docs/constitution/features/zone-study.md` | صلاحيتان مفصولتان `planning.zone_study.view` و `.manage` (BRANCH) بدل `planning.manage`، التزاماً بالمعيار الهندسي. تحديث §7 و §10 و §11 (TC-24 إلى TC-27). |
