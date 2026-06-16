# دستور الدومين — التخطيط التشغيلي في Golden CRM

> الحالة: معتمد كمرجع دستوري للدومين
> اللغة: عربية موحّدة
> النطاق: Planning
> الغرض: تثبيت الحقيقة التشغيلية الحالية لدومين التخطيط كما تظهر في الكود والواجهة والأنواع المشتركة، مع توضيح حدود الملكية بين جدول الفرق، توزيع المسارات، ونطاقات العمل المرتبطة بالزيارات.

---

## 0) الملخص التنفيذي

دومين التخطيط التشغيلي هو الطبقة التي تنظّم العمل اليومي قبل تنفيذ الزيارات أو توليد المهام المرتبطة بها. هذا الدومين يضمن أن الفرق والموارد ومسارات العمل موزعة بشكل صحيح على مستوى الفرع، وأن أي عملية لاحقة في الزيارات أو المهام أو الأهداف تعتمد على جدول صحيح ومصرّح به.

أول خطوة أساسية في هذا الدومين هي **جدولة الفرق اليومية**. هذه الخطوة تقع تحت مسؤولية **مدير الفرع** مباشرة، وتُنفّذ ضمن صلاحيات التخطيط المعتمدة. بعدها تُبنى عليها مسارات توزيع المسارات ونطاقات العمل وتوليد الأهداف والمهام اللاحقة.

الحقيقة التشغيلية في هذا الدومين موزعة بين:
- الخلفية: جداول اليوم، صلاحيات التخطيط، حساب الأهداف، ونطاقات العمل.
- الواجهة: شاشة جدولة الفرق، شاشة نظرة التخطيط، وشاشة توزيع المسارات.
- الأنواع المشتركة: `DaySchedule` و`TeamSlot` و`RouteAssignmentData` وما يرتبط بها من خرائط الموظفين والمناطق.

---

## 1) الفلو البشري المبسّط

`اختيار التاريخ → جدولة الفرق → حفظ جدول اليوم → دراسة النطاقات → توزيع المسارات → احتساب الأهداف → تنفيذ الزيارات`

### شرح كل خطوة
- **اختيار التاريخ**: يحدد اليوم التشغيلي المراد تخطيطه.
- **جدولة الفرق**: مدير الفرع يملأ الفرق اليومية والفرق الاحتياطية.
- **حفظ جدول اليوم**: يتم تخزين `day_schedules` لذلك التاريخ.
- **دراسة النطاقات**: مرحلة وسيطة تحليلية (قراءة فقط) تعرض لكل zone فيه مهام شركة مؤهلة سحب كل فريق الطبيعي إليه عبر ملكيته الشخصية. القرار يبقى يدوياً ولا تكتب هذه المرحلة في أي جدول. مرجع: `features/zone-study.md` و DEC-008.
- **توزيع المسارات**: تربط الفرق بالمسارات والجغرافيا ونطاقات العمل.
- **احتساب الأهداف**: يحسب النظام الأهداف التسويقية بحسب الفريق والمسار.
- **تنفيذ الزيارات**: تبدأ الزيارات المرتبطة بالجدول والمسارات المعتمدة.

---

## 2) حدود الدومين

### 2.1 داخل النطاق
يشمل هذا الدومين كل ما يلي:
- جدولة الفرق اليومية.
- تحديد مشرف الفريق والفني والمسوقين والمتدرب عند الحاجة.
- الفرق الاحتياطية / فرق الطوارئ.
- التحقق من أهلية الموظفين للظهور في الجدولة.
- توزيع المسارات الجغرافية على الفرق.
- احتساب جهات الاتصال ذات المهام المرتبطة بالفريق.
- أي اعتماد لاحق للزيارات أو المهام الذي يتطلب جدولًا صحيحًا.

### 2.2 خارج النطاق
لا يملك هذا الدومين:
- تعريف الموظف نفسه ككيان موارد بشرية مستقل.
- تعريف الزيارات التفصيلية أو نتائجها النهائية.
- إدارة العملاء أو العقود أو الديون.
- إدارة المهام التشغيلية النهائية نفسها.

### 2.3 ممنوع الخلط بين الكيانات
- جدول الفرق ليس الزيارة.
- جدول الفرق ليس المهمة.
- المسار ليس الزيارة.
- الأهداف ليست الجدول.
- الزيارات اللاحقة تعتمد على الجدول، لكنها ليست الجدول نفسه.

---

## 3) خريطة المصدر

### 3.1 ملفات الخلفية الأساسية
- `packages/api/routes/schedules.ts`
- `packages/api/routes/employees.ts`
- `packages/api/routes/planning.ts`
- `packages/api/services/telemarketingScope.ts`
- `packages/api/services/planningMarketingTargets.ts`
- `packages/api/services/teamPlanningScope.ts`
- `packages/api/routes/telemarketing.ts`
- `packages/api/routes/marketingVisits.ts`
- `packages/api/routes/openTasks.ts`

### 3.2 ملفات الواجهة الأساسية
- `packages/web/src/pages/planning/TeamScheduler.tsx`
- `packages/web/src/pages/planning/PlanOverview.tsx`
- `packages/web/src/pages/planning/RouteAssigner.tsx`
- `packages/web/src/pages/MarketingVisitsPage.tsx`
- `packages/web/src/components/marketing-visits/*`
- `packages/web/src/pages/TelemarketerWorkspace.tsx`

### 3.3 الملفات المشتركة المؤثرة
- `packages/shared/types.ts`
- `packages/shared/contracts/roles.ts`
- `packages/web/src/lib/types.ts`
- `packages/web/src/lib/api.ts`

### 3.4 الملفات الدستورية المرتبطة
- `docs/constitution/features/team-scheduling.md`
- `docs/constitution/features/zone-study.md`
- `docs/constitution/features/planning-contact-targets.md`
- `docs/constitution/features/telemarketing-appointments.md`
- `docs/constitution/features/marketing-visits.md`
- `docs/constitution/domains/visits.md`
- `docs/constitution/features/README.md`
- `docs/constitution/decisions/DEC-008-zone-study-stage.md`
- `docs/constitution/decisions/DEC-009-eligible-task-and-contact-lifecycle.md` — **تعريف «المهمة المؤهلة» (10 لبنات) ودورة حياة جهة الاتصال؛ يحكم PL-R008..R-013 ويوحّد الاستعلامات الثلاثة (العدّ/الإسناد/الداشبورد). خطة التنفيذ: `plans/2026-06-14-eligible-task-implementation-plan.md`.**

---

## 4) المفاهيم الأساسية

### 4.1 `DaySchedule`
جدول اليوم التشغيلي.
- يحتوي فرقًا وفرق طوارئ.
- هو سجل التخطيط الأساسي لليوم.

### 4.2 `TeamSlot`
خانة الفريق الأساسي.
- تحتوي مشرفًا وفنيًا ومسوقين هاتفيين ومتدربًا عند الحاجة.

### 4.3 `EmergencySlot`
خانة الطوارئ.
- تعتمد فنيًا بشكل أساسي.
- قد تحتوي متدربًا أو مسوقين إضافيين.

### 4.4 `RouteAssignmentData`
بيانات ربط الفريق بالمسارات.
- تربط اليوم والفريق بالمسارات والجغرافيا.
- تبني نطاق العمل الفعلي.

### 4.5 `Marketing Target`
الهدف التسويقي الناتج عن الربط بين الجدول والمسارات.
- ليس جدولًا مستقلًا للفرق.
- هو مخرج تخطيطي يعتمد على الجدول.
- في لحظة حساب الحمل، قد يتحول جزء من المهام المفتوحة المؤهلة إلى `assigned` حتى تصبح جاهزة لمسار الاتصال.

### 4.6 `TeamScheduler`
شاشة جدولة الفرق.
- هي نقطة البداية التشغيليّة لهذا الدومين.
- تقع تحت مسؤولية مدير الفرع مباشرة.

### 4.7 `ZoneStudy`
شاشة دراسة النطاقات.
- مرحلة وسيطة تحليلية بين `TeamScheduler` و `RouteAssigner`.
- قراءة فقط — لا تعدّل أي جدول.
- تعرض لكل zone فيه مهام شركة مؤهلة سحب فرق اليوم الطبيعي إليه (X / Y).
- مرجع كامل في `features/zone-study.md` ومبرّر في DEC-008.

---

## 5) الكيانات والحقول

### 5.1 جدول اليوم `DaySchedule`
#### الحقول الجوهرية
- `teams`
- `solos`

### 5.2 خانة الفريق `TeamSlot`
#### الحقول الجوهرية
- `supervisor`
- `technician`
- `telemarketers`
- `trainee`

### 5.3 خانة الطوارئ `EmergencySlot`
#### الحقول الجوهرية
- `technician`
- `telemarketers`
- `trainee`

### 5.4 ربط المسارات `RouteAssignmentData`
#### الحقول الجوهرية
- `routes`
- `extraZones`
- `stationOrder`

### 5.5 الموظف المؤهل للجدولة
#### الحقول الجوهرية
- `id`
- `status`
- `branchId`
- `teamSlotType`
- `canAppearInSchedule`

---

## 6) دورة الحياة والحالات

### 6.1 حالة الجدول
- لا توجد حالة انتقالية خاصة في جدول اليوم نفسه.
- الحالة العملية تكون وجودًا أو عدم وجود سجل في `day_schedules`.

### 6.2 حالات أهلية الموظف
- `active` = قابل للاستخدام التشغيلي
- `canAppearInSchedule = true` = مسموح له الظهور في الجدولة
- `teamSlotType` = يحدد نوع الخانة المناسبة له

### 6.3 نطاق الفرع
- الجدولة تُبنى على `branch context`.
- لا يُسمح بحفظ جدول بلا فرع فعّال.

---

## 7) الصلاحيات والنطاق

### 7.1 الصلاحية الأساسية
- `planning.manage` — لجدولة الفرق وتوزيع المسارات واحتساب الأهداف.
- `planning.zone_study.view` — قراءة دراسة النطاقات (DEC-008، نطاق `BRANCH`).
- `planning.zone_study.manage` — تحديث snapshot دراسة النطاقات وإدارة picks في Mode 2 (DEC-008، نطاق `BRANCH`).

### 7.2 المسؤولية التشغيلية
- مدير الفرع هو المسؤول المباشر عن جدولة الفرق اليومية.
- الصلاحية التقنية تُمرّر عبر النظام، لكن العقد التشغيلي يضع المسؤولية اليومية على مدير الفرع.

### 7.3 النطاق
- يلزم وجود `actingBranchId` أو فرع فعّال.
- لا يُقبل الحفظ أو التحميل العملي خارج سياق فرع صالح.

---

## 8) القواعد التشغيلية الأساسية

### `PL-R001` — جدول اليوم يحتاج فرعًا صالحًا
- لا يمكن حفظ جدول فرق بدون فرع فعّال.
- تنطبق على: جدول اليوم.
- التحقق: الخلفية.

### `PL-R002` — الفريق الأساسي يحتاج مشرفًا وفنيًا
- كل فريق قياسي يجب أن يحتوي مشرفًا وفنيًا.
- تنطبق على: `TeamSlot`.
- التحقق: الخلفية.

### `PL-R003` — خانة الطوارئ تحتاج فنيًا على الأقل
- خانة الطوارئ لا تُحفظ بدون فني.
- تنطبق على: `EmergencySlot`.
- التحقق: الخلفية.

### `PL-R004` — الموظف يجب أن يكون نشطًا ومؤهلًا للظهور
- لا يجوز وضع موظف غير نشط أو غير مؤهل في الجدولة.
- تنطبق على: جميع خانات الجدولة.
- التحقق: `schedule-pool` و`PUT /schedules/:date`.

### `PL-R005` — الموظف يجب أن يتبع الفرع الحالي
- لا يجوز خلط موظف من فرع آخر في جدول الفرع الحالي.
- تنطبق على: الجدولة اليومية.
- التحقق: الخلفية.

### `PL-R006` — لا تكرار لنفس الموظف في أكثر من خانة
- الموظف الواحد لا يمكن أن يظهر في أكثر من موضع داخل جدول اليوم.
- تنطبق على: كل الجدول.
- التحقق: الخلفية.

### `PL-R007` — جدول الفرق هو مصدر الأهداف اللاحقة
- احتساب جهات الاتصال ذات المهام والتوزيع اللاحق يعتمد على الجدول المعتمد.
- تنطبق على: التخطيط المتقدم.
- التحقق: `planning/marketing-targets` و`route-assignments`.

### `PL-R008` — حساب الحمل يرحّل المهام المؤهلة إلى `assigned`
- عندما يحسب النظام الحمل لفريق تخطيط صالح، تُرحّل المهام المفتوحة المؤهلة التابعة لنفس الزبائن من `open` / `needs_follow_up` إلى `assigned`.
- لا يقتصر الترحيل على المهمة التي ظهرت في الحساب؛ إذا كان الزبون مؤهلاً ضمن النطاق، تُسند كل مهامه المفتوحة المؤهلة ضمن الفرع الحالي.
- تنطبق على: `planning/marketing-targets` في وضع الحساب، ثم ما يتفرع عنه من استخراج جهات الاتصال.
- التحقق: ظهور المهام نفسها في `assigned` قبل فتح صفحة جهات الاتصال.

### `PL-R009` — أول من حُسبت له المهمة يكسبها (DEC-005)
عند تنازع فريقين في نفس المنطقة، الفريق الذي يحفظ نطاق عمله أولاً يحصل على المهام تلقائياً. الآلية: `syncAssignedTasks` يفلتر `status IN ('open', 'needs_follow_up')` عند الإسناد، فالمهام المسندة بالفعل لفريق سابق لا تُلمس. لا حاجة لحل تنازع منطقي إضافي.

### `PL-R010` — توسيع syncAssignedTasks لكل أنواع المهام (DEC-005 D24)
آلية syncAssignedTasks لا تقتصر على marketing بعد DEC-005. تشمل service و collection وكل visit_types الموسّعة. الفلتر يستفيد من `task_type_config.contact_target_visit_type` لتحديد فئة كل مهمة عند الإسناد.

### `PL-R011` — قاعدة capability للفرق (DEC-005 D25 + DEC-006 D31 — محسومة)
- فريق قياسي (`TeamSlot`) يدعم كل أنواع المهام.
- **فريق طوارئ (`EmergencySlot`) محصور بـ `emergency_maintenance` فقط** (DEC-006 D31 — حسم نهائي). **لا يستلم `periodic_maintenance` ولا أي نوع آخر.**
- لا تخصيص لكل route_assignment. capability ثابتة بنوع الفريق.

**السبب (DEC-006 D31):** الصيانة الدورية مهمة مخططة لها نافذة زمنية واسعة عبر `planning_window_days` ولا تستفيد من سرعة استجابة فريق الطوارئ. توسيع نطاق فريق الطوارئ يُضعف تركيزه على الحالات العاجلة ويخلق تنافساً غير ضروري مع الفريق القياسي. الصيانة الدورية يتولاها الفريق القياسي حصراً يُبقي وضوح الأدوار.

**تأثير على الكود:** `workScope` لفريق الطوارئ يفلتر `open_tasks` حيث `task_type = 'emergency_maintenance'` فقط. لا توسيع للنوع.

### `PL-R012` — استبعاد الزبون عبر فلاتر محدودة (DEC-005)
فلاتر الزبون في syncAssignedTasks تقتصر على:
- `clients.do_not_contact = TRUE` — حظر دائم
- `clients.is_archived = TRUE` (إن وُجد) — مؤرشف
- `clients.is_candidate = TRUE` — مرشح غير مفعّل
- `clients.cooldown_until > CURRENT_DATE` — فترة تهدئة فعّالة

لا فلتر بناءً على وجود عقود من عدمها. لا فلتر `NOT EXISTS visits` legacy.

### `PL-R013` — مكان العمل من task_type_config.location_basis (DEC-005)
موقع العمل لكل مهمة يُحسب من `task_type_config.location_basis`:
- `location_basis = 'client'` لمهام مثل `device_demo` → عنوان الزبون
- `location_basis = 'device'` لمهام مثل تسليم وتركيب وتشغيل وصيانة وتحصيل → عنوان الجهاز من `installed_devices.installation_geo_unit_id`

العقد كيان مالي تجاري، الجهاز كيان مادي بموقع. لا اعتماد على عنوان العقد لأي مهمة ميدانية.

### `PL-R014` — دراسة النطاقات مرحلة بنمطَين بين الجدولة والتوزيع (DEC-008 v2)
- `ZoneStudy` صفحة تحليلية تُعرض بعد حفظ `day_schedule` وقبل توزيع `route_assignments`.
- المرحلة لا تعدّل بيانات التشغيل: لا تكتب في `route_assignments` ولا في `work_scopes` ولا في `open_tasks`. الكتابة محصورة في جدول `zone_study_snapshots`.
- **نمطان (Modes):**
  - **`auto`:** الـ zones تُستخرج تلقائياً (شرط: ≥1 مهمة `open_task` بحالة `('open','needs_follow_up')` مؤهلة لزبون ملك الشركة). snapshot **per-branch**.
  - **`manual`:** المدير يختار zones يدوياً من قائمة الفرع. لا شرط أهلية على الـ zone. snapshot **per-user**.
- شرط الأهلية في Mode `auto` يطابق N-window من DEC-005 و `customerOwnership.ownerType IN ('company_branch','company_global')`.
- عمود الشركة في الجدول يجمع المهام المؤهلة من كل الأنواع لزبائن ملك الشركة.
- عمود الفريق X / Y يقتصر على `device_demo`: X = زبائن LEAD ملك شخصي للفريق بلا `device_demo` مفتوحة، Y = `device_demo` المؤهلة المفتوحة لزبائن الفريق في الـ zone.
- الملكية الشخصية للفريق تجمع أعضاء بدور `team_slot_type IN ('SUPERVISOR', 'TECHNICIAN')` فقط.
- **نموذج Snapshot:** أول `GET` لليوم T ينشئ snapshot في `zone_study_snapshots` (lazy). ضمن اليوم T الـ snapshot قابل للتحديث بزر "تحديث". بعد منتصف الليل (`T < CURRENT_DATE`) الـ snapshot مجمَّد للأبد؛ API يرفض الكتابة بـ `403 SNAPSHOT_FROZEN` ولا استثناء للسوبرأدمن.
- **الصلاحيات (DEC-008 D43):** صلاحيتان مفصولتان بنطاق `BRANCH` التزاماً بالمعيار الهندسي — `planning.zone_study.view` لكل `GET`، و `planning.zone_study.manage` لكل كتابة (refresh + manual picks). لا إعادة استخدام `planning.manage`.
- لا تأثير على PL-R009: قاعدة "أول من حُفظ له workScope يأخذ المهام" تبقى كما هي.
- تنطبق على: `GET /planning/zone-study`, `POST /planning/zone-study/refresh`, `POST /planning/zone-study/manual/pick`, `DELETE /planning/zone-study/manual/pick/:id`.
- التحقق: `packages/api/services/zoneStudy.ts` و `customerOwnership.ts` (يُعاد استخدامه) و middleware `requireSnapshotDateNotFrozen` و middleware الصلاحيات.

---

## 9) الواجهة المرتبطة بالدومين

### 9.1 الصفحات الأساسية
- `packages/web/src/pages/planning/TeamScheduler.tsx`
- `packages/web/src/pages/planning/ZoneStudy.tsx` (مرتقَب — DEC-008)
- `packages/web/src/pages/planning/PlanOverview.tsx`
- `packages/web/src/pages/planning/RouteAssigner.tsx`

### 9.2 ملاحظات الواجهة
- `TeamScheduler` هو نقطة الإدخال الأساسية لجدولة الفرق.
- الواجهة تعرض:
  - التاريخ
  - الموظفين المتاحين
  - الفرق الأساسية
  - فرق الطوارئ
  - حفظ الجدول
- `PlanOverview` يقرأ الجدول ثم يربطه بالمسارات والأهداف.
- `RouteAssigner` يربط الفريق بالمسارات والجغرافيا.

### 9.3 مصادر القيم في الواجهة
- قائمة الموظفين تأتي من `employees.schedulePool()`.
- الجدول اليومي يأتي من `api.schedules.get(date)`.
- الحفظ يتم عبر `api.schedules.save(date, data)`.
- جهات الاتصال ذات المهام تأتي عبر `api.planning.marketingTargets(date, teamKey)`، وهو اسم تقني تاريخي للعقد الحسابي فقط.

---

## 10) واجهات الـ API

### 10.1 جدول اليوم
- `GET /schedules/:date`
- `PUT /schedules/:date`

### 10.2 الموظفون المؤهلون للجدولة
- `GET /employees/schedule-pool`

### 10.3 التخطيط التسويقي اللاحق
- `GET /planning/marketing-targets?date=...&teamKey=...`

### 10.3.1 دراسة النطاقات (DEC-008 v2 — مرتقَب)
- `GET /planning/zone-study?date=YYYY-MM-DD&mode=auto|manual`
- `POST /planning/zone-study/refresh?date=YYYY-MM-DD&mode=auto|manual`
- `POST /planning/zone-study/manual/pick?date=YYYY-MM-DD` (body: `{zoneId}`)
- `DELETE /planning/zone-study/manual/pick/:zoneId?date=YYYY-MM-DD`

### 10.4 مسارات مرتبطة
- `GET /route-assignments`
- `GET /route-assignments/:key`
- `PUT /route-assignments/:key`

---

## 11) التوافق الخلفي

- `day_schedules` هو المصدر الفعلي لجدولة اليوم.
- `TeamScheduler` و`PlanOverview` و`RouteAssigner` كلها فوق نفس السجل.
- لو تغيرت بنية الفريق، يجب أن يتغير الجدول أولًا ثم ما يرتبط به من أهداف ومسارات.

---

## 12) الخلاصة

دومين التخطيط التشغيلي هو الطبقة التي تسبق تنفيذ الزيارات وتوزيع العمل. أول خطوة فيه هي جدولة الفرق اليومية تحت مسؤولية مدير الفرع، ثم تأتي بعدها بقية المسارات المرتبطة بالأهداف والجغرافيا والزيارات.
