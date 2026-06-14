# قرار معماري: إدراج مرحلة دراسة النطاقات بين جدولة الفرق وتوزيع المسارات

> رقم القرار DEC-008
> التاريخ 2026-06-12 (نسخة أولى) • 2026-06-13 (نسخة v2: Mode 2 + Snapshot)
> الحالة معتمد
> الأولوية متوسطة
> يكمل دستور التخطيط (`docs/constitution/domains/planning.md`) و DEC-002 و DEC-005
> الكيانات المتأثرة day_schedules, route_assignments, work_scopes, open_tasks, client_assignments, task_type_config, geo_units, zone_study_snapshots (جديد)

## 1 الملخص التنفيذي

هذا القرار يدخل مرحلة وسيطة جديدة في الفلو التشغيلي اليومي اسمها **دراسة النطاقات (ZoneStudy)**. تقع بين شاشة جدولة الفرق وشاشة توزيع المسارات، ووظيفتها الوحيدة تزويد مدير الفرع بصورة تحليلية تساعده على القرار اليدوي عند توزيع نطاقات اليوم على فرق `day_schedule`.

أبرز التحولات. الفلو الرسمي يصبح بأربع خطوات بدل ثلاث (جدولة → دراسة → توزيع → احتساب). الدراسة لا تنتج قراراً آلياً ولا توزيعاً مسبقاً، فقط جدول قراءة فقط. الجدول يفصّل لكل فريق في `day_schedule` سحب الفريق الطبيعي للمنطقة عبر ملكيته الشخصية على زبائنها.

**نسخة v2 (2026-06-13).** التصميم تطور ليتضمن وضعَين:
- **Mode 1 (Auto):** يعرض تلقائياً كل zone فيه مهمة شركة مؤهلة. snapshot على مستوى الفرع.
- **Mode 2 (Manual):** يتيح للمدير اختيار zones يدوياً لاستكشاف توزيعات بديلة لمناطق لا تحتوي مهام شركة لهذا اليوم. snapshot على مستوى المستخدم.

كلا الـ Modes يستخدمان نموذج **snapshot مجمَّد بعد منتصف الليل**: ضمن اليوم T الـ snapshot قابل للتحديث بضغطة زر، وبعد منتصف الليل يصير سجلاً تاريخياً مغلقاً للأبد. هذا يحافظ على أثر القرار التشغيلي لكل يوم ويسمح بعودة المدير لمراجعة "ماذا رأى يومذاك".

## 2 المبادئ التأسيسية

### المبدأ الأول: دراسة قراءة فقط لا قرار آلي

`ZoneStudy` لا تكتب في `route_assignments` ولا تقترح توزيعاً. هي صفحة تحليلية تساعد المدير على فهم "أي فريق له سحب طبيعي إلى أي zone". القرار يبقى يدوياً في `RouteAssigner`.

السبب. القاعدة الحالية في التخطيط (PL-R009) تعتمد على "أول من حُفظ له workScope يأخذ المهام". أي قرار آلي من `ZoneStudy` يخلق منطقاً موازياً ينافس هذه القاعدة ويحرم المدير من المرونة. الإبقاء على المرحلة كقراءة فقط يحافظ على عقد التخطيط الحالي ويضيف فقط شفافية أكبر للقرار اليدوي.

### المبدأ الثاني: شرط ظهور الـ zone مرتبط بالشركة لا بالفرق

zone يظهر في جدول `ZoneStudy` إذا وفقط إذا فيه على الأقل مهمة واحدة مؤهلة (eligible) ضمن نافذة N لزبون ملكيته شركة. وجود ملكية شخصية في الـ zone وحدها لا يُظهره — لأن المهام الشخصية ستذهب لفريقها تلقائياً عبر `syncAssignedTasks` ولا تحتاج قرار توزيع.

السبب. المدير لا يحتاج تحليل zone ما فيه شغل شركة. القرار المطلوب هو "أي فريق يستلم zone فيه مهام شركة"، والـ zones التي تخلو من مهام شركة خارج نطاق هذا القرار.

### المبدأ الثالث: عمود الشركة موسّع، أعمدة الفرق ضيقة

عمود الشركة يجمع كل المهام المؤهلة من كل الأنواع (`emergency_maintenance`, `periodic_maintenance`, `collection`, `delivery`, `device_demo`...) لزبائن ملك الشركة. أعمدة الفرق تقتصر على `device_demo` فقط لزبائن ملك شخصي للفريق.

السبب. تنوع مهام الشركة يعكس "حجم الشغل العام في الـ zone". لكن لقياس "سحب الفريق الطبيعي" للمنطقة، المهمة الأكثر دلالة هي `device_demo` لأنها مرتبطة بزبائن LEAD لم يتم التعاقد معهم بعد، وهي طبيعياً ملك شخصي للمشرفة أو الفني الذي يتابعهم. غيرها من المهام (صيانة، تحصيل) ترتبط بزبائن OP/FOP ملك شركة، فلا معنى لإحصائها داخل أعمدة الملكية الشخصية.

### المبدأ الرابع: الملكية الشخصية تجمع المشرف والفني معاً

في أعمدة الفرق، الملكية الشخصية تشمل أي مالك ضمن الفريق له `team_slot_type IN ('SUPERVISOR', 'TECHNICIAN')`. لا تفصيل بين السوبرفايزر والفني في العرض.

السبب. وحدة الفريق التشغيلية في `day_schedule` هي مجموعة (مشرف + فني + ...) تعمل سوياً في نفس المسار. القرار "أي فريق يستلم zone" يقوم على سحب الفريق ككل لا على دور فردي. تفصيل الملكية يشتت المدير عن قراره.

### المبدأ الخامس: المهام المؤهلة تتبع تعريف DEC-005

"مؤهلة" تعني نفس تعريف N-window في DEC-005: مهمة لها `required_date` أو `expected_date` ضمن نافذة `task_type_config.lead_window_days`، أو مهمة فائتة (متأخرة) بقيت مفتوحة. لا تعريف جديد لـ "أهلية" خاصة بـ `ZoneStudy`.

السبب. وحدة معنى الأهلية بين `contact_targets`, `syncAssignedTasks`, و `ZoneStudy` تمنع انفصال أرقام الصفحة عن أرقام `PlanOverview` و `TelemarketerWorkspace`. الرقم 5 في `ZoneStudy` يساوي الرقم 5 في `PlanOverview` لنفس الفريق ونفس الـ zone ونفس اليوم.

### المبدأ السادس: الـ snapshot مجمَّد بعد منتصف الليل (v2)

ضمن اليوم T الـ snapshot قابل للتحديث بضغطة زر "تحديث". بعد منتصف الليل (`T+1 00:00:00`) الـ snapshot يصبح سجلاً مغلقاً للأبد: API يرفض أي محاولة كتابة، الواجهة تخفي زر التحديث، والقراءة تعود لـ JSONB المخزن بدون حساب جديد.

السبب. القرار التشغيلي اليومي يجب أن يبقى مربوطاً بالحالة التي بُني عليها. لو سمحنا بتحديث snapshot ليوم سابق، سنفقد إمكانية مراجعة "ماذا رأى المدير لحظة اتخاذ القرار". التجميد يحوّل الـ snapshot من واجهة عمل إلى أثر تدقيقي بعد انتهاء اليوم.

### المبدأ السابع: نطاق الـ snapshot يختلف بين الـ Modes (v2)

`Mode 1` deterministic — أي مستخدم يفتحه يرى نفس الـ zones والأرقام بحكم اعتماده على حالة الفرع وحدها. لذا snapshot واحد على مستوى الفرع لكل يوم.

`Mode 2` بطبيعته شخصي — كل مدير يستكشف توزيعات بديلة من زاويته. لذا snapshot منفصل لكل مستخدم.

السبب. توحيد النطاقَين على مستوى واحد يخلق إما تنافس في الـ picks (لو per-branch لـ Mode 2) أو تكرار غير مبرر للحساب (لو per-user لـ Mode 1).

## 3 القرارات

### D38: إدراج مرحلة `ZoneStudy` رسمياً في فلو التخطيط

الفلو التشغيلي الرسمي يصبح:

`اختيار التاريخ → جدولة الفرق → حفظ جدول اليوم → دراسة النطاقات → توزيع المسارات → احتساب الأهداف → تنفيذ الزيارات`

`ZoneStudy` مرحلة اختيارية تشغيلياً لكن موصى بها قبل أي توزيع جديد على `route_assignments`. لا يفرض النظام عبورها قسرياً قبل الوصول إلى `RouteAssigner`.

### D39: شرط ظهور zone في جدول الدراسة

zone يظهر في جدول `ZoneStudy` لليوم T إذا وفقط إذا فيه ≥1 `open_task` بالشروط التالية مجتمعة:

- `status IN ('open', 'needs_follow_up')`.
- مهمة مؤهلة بمعنى N-window من DEC-005.
- صاحب المهمة زبون ملك الشركة (أي `customerOwnership.ownerType IN ('company_branch', 'company_global')` كما يحسبه `customerOwnership.ts`).
- الـ zone هو `clients.neighborhood` (للمهام بـ `location_basis = 'client'`) أو `installed_devices.installation_geo_unit_id` (للمهام بـ `location_basis = 'device'`) حسب D5 من DEC-005 (PL-R013).

### D40: تركيب الجدول وعدّاداته

جدول `ZoneStudy` يحتوي صفاً لكل zone مؤهلة، وعموداً ثابتاً للشركة، وعموداً لكل فريق ضمن `day_schedule` لليوم T.

**عمود الشركة (رقم واحد):** عدد كل المهام المؤهلة لزبائن ملك الشركة في الـ zone (كل الأنواع).

**عمود الفريق (X / Y):**
- X = عدد زبائن `LEAD` ملك شخصي لأي عضو في الفريق (مشرف أو فني) في الـ zone، **بلا** `device_demo` مفتوحة (يمثل عمق المحفظة المحتمل).
- Y = عدد مهام `device_demo` المؤهلة المفتوحة لزبائن ملك شخصي لأي عضو في الفريق في الـ zone (يمثل حمل اليوم الفعلي).

### D41: مصدر الملكية الشخصية حصراً من `client_assignments`

`ZoneStudy` لا تخترع مفهوماً جديداً للملكية. تعتمد على نفس منطق `customerOwnership.ts` الموجود في الكود: `client_assignments(client_id, hr_user_id)` مع شرط `hr_users.is_active = TRUE AND employees.status = 'active' AND roles.team_slot_type IN ('SUPERVISOR', 'TECHNICIAN')`.

### D42: لا تأثير على `syncAssignedTasks` ولا على PL-R009

`ZoneStudy` لا تكتب في `work_scopes` ولا في `open_tasks.assigned_team_key`. آلية "أول من حُفظ له workScope يأخذ المهام" (PL-R009) تبقى دون تغيير. الـ ZoneStudy تقدم بيانات قراءة فقط مشتقة من نفس المصادر التي يقرأها التخطيط لاحقاً.

### D43: نطاق الصلاحية والوصول (محدّث v2 — صلاحيتان مستقلتان)

التزاماً بالمعيار الهندسي للصلاحيات (`permissions-engineering-standard.md`, 2026-06-11) الذي يفرض فصل قرار القراءة عن قرار الكتابة ويمنع جمع قرارين أمنيين تحت مفتاح واحد، تُعرَّف **صلاحيتان جديدتان** لـ `ZoneStudy` بدل إعادة استخدام `planning.manage`:

| المفتاح | النوع | Scope | الوصف |
|---|---|---|---|
| `planning.zone_study.view` | Operation | `BRANCH` | قراءة جدول الدراسة و snapshots (كل `GET`، يشمل الأيام المجمَّدة). |
| `planning.zone_study.manage` | Operation | `BRANCH` | تحديث snapshot وإضافة/حذف picks في Mode 2 (كل `POST`/`refresh` و `POST`/`DELETE` على manual/pick). |

**قواعد التطبيق:**
- النطاق `BRANCH` فقط لكلتيهما. لا `ASSIGNED` — المدير يرى ويدير كامل بيانات فرعه.
- خصوصية snapshot Mode 2 لكل مستخدم (per-user) تُحمى بعمود `user_id` في `zone_study_snapshots` لا بالـ scope. المستخدم لا يرى Mode 2 لمدير آخر حتى لو امتلك `planning.zone_study.view`؛ الـ query يفلتر `user_id = req.user.id` لـ `mode = 'manual'`.
- `manage` لا تُغني عن `view`؛ الأدوار التي تحتاج التحديث تُمنح الاثنتين.
- subject لكل عملية كتابة هو `branch_id` للـ snapshot المستهدف، ويُتحقق منه عبر `actingBranchId`.
- `allowed_scopes` في DB لكلتا الصلاحيتين = `{BRANCH}` (مع `GLOBAL` اختيارياً للسوبرأدمن إن لزم اتساق مع باقي صلاحيات planning — يُحسم عند البذر).

**أثر على المعيار:** يلزم بحسب §9 من المعيار الهندسي تحديث `صلاحيات_النظام.xlsx` و `permission-inventory` و migration بذر الصلاحيتين ومنحهما لدور `branch_manager` (BRANCH). هذه خطوات تنفيذ تُنفّذ مع الكود لا في التوثيق الدستوري.

### D44: نمطان (Modes) داخل `ZoneStudy` (v2)

`ZoneStudy` تدعم نمطين متمايزين تشترك في عمود واحد للشركة وأعمدة فرق X/Y بنفس الحساب، وتختلف فقط في **مصدر صفوف الجدول**:

- **Mode `auto`:** الـ zones تُستخرج تلقائياً حسب شرط D39 (≥1 مهمة شركة مؤهلة في الـ zone).
- **Mode `manual`:** الـ zones يختارها المدير يدوياً من قائمة `geo_units` للفرع. لا شرط أهلية على الـ zone نفسه؛ المدير قد يختار zones خالية تماماً من مهام شركة. عمود الشركة في هذه الحالة يكون 0، لكن أعمدة الفرق تبقى محسوبة من نفس منطق X/Y.

كلا الـ Modes متاحان في نفس الصفحة عبر تبويبتين. التنقل بين التبويبتين لا يفقد الـ picks.

### D45: نموذج الـ snapshot + جدول `zone_study_snapshots` (v2)

يُنشأ جدول جديد:

```sql
CREATE TABLE zone_study_snapshots (
  id            SERIAL PRIMARY KEY,
  branch_id     INTEGER NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
  date          DATE NOT NULL,
  user_id       INTEGER REFERENCES hr_users(id) ON DELETE SET NULL,  -- NULL لـ mode = 'auto'
  mode          VARCHAR(20) NOT NULL CHECK (mode IN ('auto', 'manual')),
  snapshot_data JSONB NOT NULL,
  refreshed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (branch_id, date, user_id, mode)
);

CREATE INDEX idx_zone_study_snapshots_branch_date
  ON zone_study_snapshots (branch_id, date);
```

**ملاحظات على الـ schema:**
- `user_id` يكون NULL لـ `mode = 'auto'` (per-branch) ويحمل قيمة لـ `mode = 'manual'` (per-user).
- `snapshot_data` يحوي الصفوف الكاملة: مصفوفة من `{zoneId, zoneName, companyEligibleCount, teams: [{teamKey, teamLabel, untappedLeads, eligibleDeviceDemos}]}`.
- لا حقل `is_locked`؛ التجميد منطقي محسوب من `date < CURRENT_DATE`.

### D46: دورة حياة الـ snapshot (v2)

**الإنشاء (lazy):** أول `GET` لليوم T بأحد الـ Modes ينشئ snapshot بحساب الحالة الراهنة ويكتبها في DB.

**التحديث (refresh):** خلال اليوم T، ضغط زر "تحديث" يُشغّل `POST /planning/zone-study/refresh` الذي يعيد الحساب ويكتب فوق `snapshot_data` + `refreshed_at = NOW()`.

**التحرير اليدوي (Mode 2 picks):** إضافة أو حذف zone في Mode 2 يُحدّث `snapshot_data.zones[]` فوراً ويعيد حساب الأرقام للـ zones الباقية في نفس النداء.

**التجميد:** بعد منتصف الليل، `POST /planning/zone-study/refresh` يرفض `403 SNAPSHOT_FROZEN` لأي تاريخ T حيث `T < CURRENT_DATE`. وبالمثل `POST /planning/zone-study/manual/pick` و `DELETE` يرفضان. `GET` يبقى مسموحاً ويرجع الـ snapshot كما هو.

**عدم وجود snapshot ليوم سابق:** إذا فُتح `GET` لتاريخ T < اليوم بدون snapshot موجود، يُرجع `200` مع `{ snapshot: null, message: "لا snapshot محفوظ لهذا اليوم" }` بدون محاولة إنشاء جديد.

### D47: سلوك Mode 1 عند غياب `day_schedule` (v2)

إذا فُتح Mode 1 لـ T ولا يوجد `day_schedule` لذلك اليوم، الـ snapshot يُنشأ مع:
- `zones` محسوبة طبيعياً (مهام شركة مؤهلة).
- `teams: []` لكل صف (لا فرق لعرض X/Y).
- الواجهة تعرض بانر "لا فرق محفوظة لهذا اليوم — يُنصح بحفظ جدول الفرق أولاً" مع زر رجوع لـ `TeamScheduler`.

عند حفظ `day_schedule` لاحقاً ضمن نفس اليوم T، الـ snapshot لا يُحدَّث تلقائياً؛ المدير يضغط "تحديث" لإدخال الأعمدة الجديدة. هذا يتسق مع المبدأ السادس (التحديث صريح وليس تلقائي).

## 4 ملاحظات على الكود الفعلي

أثناء التحقق من الكود لتثبيت هذا القرار، رُصدت معطيات تشغيلية:

الأولى. `customerOwnership.ts` موجود وجاهز، ويعطي `ownerType` المطلوب. لا يحتاج تعديل. يمكن إعادة استخدام `buildCustomerOwnershipSql` مباشرة في خدمة `ZoneStudy`.

الثانية. الفلتر الموجود في `customerOwnership.getCompanyOwnedClients(branchId, zoneIds)` يطابق منطق D39 لكنه لا يفلتر بالـ N-window. خدمة `ZoneStudy` تحتاج فلتر إضافي على `task_type_config.lead_window_days` و `open_tasks.required_date/expected_date`.

الثالثة. `task_type_config.lead_window_days` هو الحقل الذي يحدد N-window للمهمة الواحدة. غيابه على نوع مهمة يعني أنها لا تخضع لنافذة (تبقى مؤهلة دائماً). هذا السلوك يجب أن يُحترم في خدمة `ZoneStudy`.

الرابعة. `day_schedules.teams` و `day_schedules.solos` JSONB. خدمة `ZoneStudy` تستخرج منهما `team_key` ومعرفات أعضاء كل فريق ثم تربطها بـ `client_assignments`.

الخامسة (تصحيح أثناء التنفيذ). `geo_units` جدول **عام بلا `branch_id`** (تحقُّق فعلي). لذلك تحقّق "المنطقة تتبع الفرع" في `pickZone` (Mode 2) **لا يُفرض**، بل يقتصر على **وجود + فعّالة**. السبب أن غرض Mode 2 استكشاف مناطق هادئة قد لا تحوي زبائن أو مهاماً؛ فرض الانتماء يُفشل حالة الاستخدام الأساسية. الحماية تبقى عبر حصر الـ snapshot بالفرع والمستخدم وحساب X/Y والشركة ضمن الفرع. موثّق في `GAP-ZS-006`.

## 5 التأثير على الكود

### Migrations مطلوبة (v2)

**migration 1 — جدول `zone_study_snapshots`** بالتركيب المحدد في D45:
- العمود `mode` بقيد `CHECK (mode IN ('auto', 'manual'))`.
- `UNIQUE (branch_id, date, user_id, mode)` يفرض snapshot واحد لكل (فرع + تاريخ + مستخدم + نمط).
- `idx_zone_study_snapshots_branch_date` للاستعلام السريع حسب الفرع واليوم.

**migration 2 — بذر الصلاحيتين** (D43):
- إدخال `planning.zone_study.view` و `planning.zone_study.manage` في `permissions` مع `allowed_scopes = {BRANCH}` (و `module = 'planning'`, `sub_module = 'zone_study'`).
- منحهما لدور `branch_manager` بنطاق `BRANCH` في `role_permission_grants`.
- migration قابلة للتكرار بأمان (idempotent) حسب §4.2 من المعيار الهندسي.

لا migrations أخرى. الباقي يبقى قائماً على جداول موجودة (`open_tasks`, `client_assignments`, `clients`, `installed_devices`, `task_type_config`, `day_schedules`, `geo_units`).

### Backend

- ملف جديد `packages/api/services/zoneStudy.ts` يحتوي:
  - `computeZoneStudy(date, branchId, mode, userId?, pickedZoneIds?)` يرجع `snapshot_data` المحسوب لحظياً.
  - يعيد استخدام `buildCustomerOwnershipSql` من `customerOwnership.ts`.
  - يفلتر المهام المؤهلة عبر `task_type_config.lead_window_days` و `required_date`/`expected_date`.
  - `getOrCreateSnapshot(date, branchId, mode, userId?)` — الـ lazy creation logic من D46.
  - `refreshSnapshot(date, branchId, mode, userId?)` — يرفض `T < CURRENT_DATE`.
- ملف جديد `packages/api/routes/zoneStudy.ts` (أو إضافة لـ `planning.ts`) يحتوي 5 endpoints بحسب §10 من دستور الفيتشر.
- middleware للتحقق من تجميد الـ snapshot: `requireSnapshotDateNotFrozen(req, res, next)`.

### Frontend

- صفحة جديدة `packages/web/src/pages/planning/ZoneStudy.tsx` تعرض:
  - تبويبتان (Auto / Manual).
  - زر "تحديث" (مخفي إذا `date < today`).
  - في Mode 2: حقل البحث/الاختيار لإضافة zone.
  - شارة "snapshot مجمَّد" واضحة للأيام السابقة.
- زر تنقل من `TeamScheduler` إلى `ZoneStudy` بعد حفظ الجدول.
- زر تنقل من `ZoneStudy` إلى `RouteAssigner` للمتابعة.
- زر تحديث يدوي خلال اليوم T فقط. لا polling تلقائي.

## 6 التأثير على الدستور

| الملف | التحديث |
|---|---|
| domains/planning.md | إدراج `ZoneStudy` في §1 (الفلو)، إضافة قاعدة `PL-R014` بتأطير المرحلة |
| features/zone-study.md | جديد — دستور الفيتشر الكامل |
| features/README.md | إدراج رابط الفيتشر |
| decisions/README.md | إدراج رابط DEC-008 |

## 7 القرارات المعلقة

P-DEC008-01. هل ندعم `ZoneStudy` على مستوى أوسع من branch (مثلاً منطقة جغرافية تجمع عدة فروع)؟ تأجيل حتى يطلبه المستخدم.

P-DEC008-02. ~~هل نضيف live-refresh لـ `ZoneStudy` عند حفظ `route_assignment` من شاشة موازية لمدير آخر؟~~ **محسوم في v2:** التحديث صريح فقط عبر زر "تحديث" خلال اليوم T. لا polling.

P-DEC008-03. ~~هل نسمح بإضافة zone خارج المؤهل اليوم (zoom-out) بطلب يدوي من المدير؟~~ **محسوم في v2:** نعم، عبر Mode 2 (D44).

P-DEC008-04 (v2). هل يحتاج النظام cron job يجمّد snapshots ليلياً بشكل صريح، أم يكفي المنطق المحسوب (`date < CURRENT_DATE`)؟ التوصية: يكفي المحسوب — لا حاجة لـ cron.

P-DEC008-05 (v2). هل نسمح للسوبرأدمن بتعديل snapshot ليوم سابق (override)؟ التوصية: لا — التجميد قاعدة معمارية لا تُكسر حتى للسوبرأدمن. تأجيل حتى يطلبه المستخدم.

## 8 المراجع

- decisions/DEC-002-contract-ownership-from-task.md
- decisions/DEC-005-contact-targets-filter.md
- decisions/DEC-006-pending-resolutions-round1.md
- domains/planning.md
- domains/work-scopes.md
- domains/route-assignments.md
- features/zone-study.md
- features/planning-contact-targets.md
- packages/api/services/customerOwnership.ts
