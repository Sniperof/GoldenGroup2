# فهرس الدستور — Golden CRM Constitution Index

> نقطة الدخول الرئيسية لكل دستورات المشروع.
> **القاعدة:** أي معلومة بدّك إياها — هاد أول ملف بتفتحه.

---

## الدومينات (Domains) — الكيانات الأساسية

| الكيان | الملف | الحالة | الحجم | Test Cases | الثغرات |
|---|---|---|---|---|---|
| الزبائن (Clients) | [domains/clients.md](domains/clients.md) | ✅ مكتمل | 533 سطر | 12+ | 5 |
| المرشحون (Candidates) | [domains/candidates.md](domains/candidates.md) | ✅ مكتمل | 301 سطر | 11+ | 5 |
| العقود (Contracts) | [domains/contracts.md](domains/contracts.md) | ✅ مكتمل | 700+ سطر | 8+ | 7 (GAP-074✅ GAP-075✅ + 5 مؤجلة) |
| الأجهزة المركبة (Installed Devices) | [domains/installed-devices.md](domains/installed-devices.md) | ✅ مكتمل | 350+ سطر | — | 2 (GAP-078⏳ GAP-ID-001⏳ GAP-ID-002🔴) |
| المهام المفتوحة (Open Tasks) | [domains/open-tasks.md](domains/open-tasks.md) | ✅ مكتمل | 402 سطر | 8+ | 7 (GAP-017✅ GAP-064✅ GAP-065✅ GAP-066✅ + 3 مؤجلة) |
| الزيارات (Visits) | [domains/visits.md](domains/visits.md) | ⚠️ قديم | 202 سطر | — | — |
| الزيارات الميدانية (Field Visits) | [domains/field-visits.md](domains/field-visits.md) | ✅ مكتمل | 513 سطر | 12+ | 8 (GAP-027✅ + 7 أخرى) |
| المهام (Tasks) | [domains/tasks.md](domains/tasks.md) | ⚠️ قديم | 17,165 بايت | — | — |
| التخطيط (Planning) | [domains/planning.md](domains/planning.md) | ⚠️ قديم | 14,126 بايت | — | — |
| التوظيف (Jobs) | [domains/jobs-recruitment.md](domains/jobs-recruitment.md) | ⚠️ قديم | 26,418 بايت | — | — |
| الأجهزة والصيانة (Devices & Maintenance) | [domains/devices-maintenance.md](domains/devices-maintenance.md) | ✅ مكتمل | 757 سطر | 15+ | 12 |
| الموظفون (Employees) | [domains/employees.md](domains/employees.md) | ✅ مكتمل | 480 سطر | 12+ | 6 |
| المناطق الجغرافية (Geo Units) | [domains/geo-units.md](domains/geo-units.md) | ✅ مكتمل | 240 سطر | 10+ | 7 |
| التسويق الهاتفي (Telemarketing) | [domains/telemarketing.md](domains/telemarketing.md) | ✅ مكتمل | 311 سطر | 7+ | 5 |
| الفروع (Branches) | [domains/branches.md](domains/branches.md) | ✅ مكتمل | 294 سطر | 16+ | 6 (GAP-045✅ GAP-046✅ GAP-047✅ GAP-049✅ GAP-063✅ + GAP-048 مؤجل) |
| البنية التنظيمية | [domains/org-structure.md](domains/org-structure.md) | ⚠️ فاضي | 218 بايت | — | — |
| الصلاحيات والأدوار (Permissions & Roles) | [domains/permissions.md](domains/permissions.md) | ✅ مكتمل | 382 سطر | 12+ | 9 |
| الإعدادات الإدارية | [domains/admin-settings.md](domains/admin-settings.md) | ⚠️ فاضي | 221 بايت | — | — |
| المهام الموحدة | [domains/tasks-unified.md](domains/tasks-unified.md) | ⚠️ قديم | 10,991 بايت | — | — |

**الدومينات المتبقية (72 جدول — مش كلون مُوثقين بعد):**
[عرض الكل في CROSS-REFERENCE.md](CROSS-REFERENCE.md#الجداول)

---

## الميزات (Features)

| الميزة | الملف | الحالة |
|---|---|---|
| زيارة ميدانية | [features/marketing-visits.md](features/marketing-visits.md) | ⚠️ قديم |
| توصيل جهاز | [features/device-delivery-task.md](features/device-delivery-task.md) | ⚠️ قديم |
| تركيب جهاز | [features/device-installation-task.md](features/device-installation-task.md) | ⚠️ قديم |
| تخطيط الاتصال | [features/planning-contact-targets.md](features/planning-contact-targets.md) | ⚠️ قديم |
| جدولة الفرق | [features/team-scheduling.md](features/team-scheduling.md) | ⚠️ قديم |

---

## المراجع السريعة (Quick Reference)

### أين ألاقي...؟

| بدّك تفهم... | روح ع... |
|---|---|
| شو الحقول تبع الزبون وقيودها | [domains/clients.md §2](domains/clients.md#2-الجدول-والحقول-table--field-dictionary) |
| شو صلاحيات الزبون ونطاقاتها | [domains/clients.md §6](domains/clients.md#6-صلاحيات-الوصول-permission-matrix) |
| شو API endpoints تبع الزبون | [domains/clients.md §7](domains/clients.md#7-عقد-api-api-contract) |
| شو test cases موجودة | [domains/clients.md §8](domains/clients.md#8-حالات-الاختبار-الشاملة-test-cases) |
| شو الثغرات المكتشفة | [domains/clients.md §9](domains/clients.md#9-الثغرات-والتضاربات-المكتشفة-gaps--contradictions) |
| شو تاريخ التغييرات على الزبون | [domains/clients.md §10](domains/clients.md#10-تاريخ-التغييرات-schema-changelog) |
| العلاقات بين الجداول | [CROSS-REFERENCE.md](CROSS-REFERENCE.md) |
| الثغرات المفتوحة بكل الكيانات | [GAPS-TRACKER.md](GAPS-TRACKER.md) |
| القالب لتوثيق كيان جديد | [templates/entity-constitution.md](templates/entity-constitution.md) |

---

## دليل العمل مع الدستور (Workflow Guide)

> **⚠️ هذا أهم ملف بالمشروع بعد هذا الفهرس.**
> بيشرح كيف نضيف كيان، كيف نحل ثغرة، كيف نكتب prompt، كيف نضيف feature.
>
> [📖 اقرأ دليل العمل كاملاً](CONSTITUTION-WORKFLOW.md)

### شو بتحتوي الدليل؟

| البند | الرابط |
|---|---|
| السياق الحالي (9/72 كيان مكتمل) | [§1](CONSTITUTION-WORKFLOW.md#1-السياق-الحالي-current-context) |
| آلية العمل (إضافة كيان / حل ثغرة / feature جديدة) | [§2](CONSTITUTION-WORKFLOW.md#2-آلية-العمل-workflow) |
| قالب كتابة Prompts الدقيقة | [§3](CONSTITUTION-WORKFLOW.md#3-كيفية-كتابة-الـ-prompts-الدقيقة-prompt-writing-guide) |
| كيفية توثيق حل Gap | [§4](CONSTITUTION-WORKFLOW.md#4-كيفية-توثيق-حل-gap-gap-fix-documentation) |
| كيفية إضافة Feature جديدة | [§5](CONSTITUTION-WORKFLOW.md#5-كيفية-إضافة-feature-جديدة-new-feature-documentation) |
| الكيانات الناقصة (62 كيان) | [§6](CONSTITUTION-WORKFLOW.md#6-الكيانات-الناقصة-remaining-entities--6272) |
| نماذج جاهزة للاستخدام | [§7](CONSTITUTION-WORKFLOW.md#7-نماذج-جاهزة-للاستخدام-ready-to-use-templates) |
| قائمة التحقق النهائية (16 نقطة) | [§9](CONSTITUTION-WORKFLOW.md#9-قائمة-التحقق-النهائية-final-checklist) |

---

## قواعد التنقل

1. **البحث:** Ctrl+F بالملف — كل عنوان بيحتوي ID (مثلاً `## 3.`)
2. **الروابط:** كل قسم مرتبط برقم — استخدم `#9.3` للوصول لثغرة رقم 3
3. **التحديث:** أي تعديل بيغيّر المعنى → حدّث الدستور أولاً
4. **الكود هو الحقيقة:** الدستور عبارة عن تفسير منظم — المصدر التشغيلي = الكود

---

## الأرشيف والتسليم (Handoffs)

| التاريخ | الملف | الموضوع |
|---|---|---|
| 2026-05-11 | [handoffs/2026-05-11-planning-appointments-handoff.md](handoffs/2026-05-11-planning-appointments-handoff.md) | Planning & Appointments |
| 2026-05-12 | [handoffs/2026-05-12-p1-p4-findings-handoff.md](handoffs/2026-05-12-p1-p4-findings-handoff.md) | P1-P4 Findings |

---

## القرارات المعمارية (Architectural Decisions)

| القرار | التاريخ | الموضوع | الحالة |
|---|---|---|---|
| DEC-001 | 2026-05-27 | [معضلة تعدد الفروع في خدمة الزباين](decisions/DEC-001-multi-branch-client-service.md) | ⏳ قيد المراجعة |

---

## المهام المعلّقة (Pending Tasks)

### 🔴 توحيد Mini ClientSnapshot عبر المشروع

> **الحالة:** ⏳ لم يُنفّذ | **الملف:** [tasks/TASK_UNIFY_MINI_CLIENT_SNAPSHOT.md](tasks/TASK_UNIFY_MINI_CLIENT_SNAPSHOT.md) | **البرومptz:** [tasks/TASK_UNIFY_MINI_CLIENT_SNAPSHOT_PROMPT.md](tasks/TASK_UNIFY_MINI_CLIENT_SNAPSHOT_PROMPT.md)

**الهدف:** تطبيق Mini ClientSnapshot الموحّد على كل الأماكن يلي بيعرضو بيانات الزبون بشكل مختصر.

**الأماكن المستهدفة:**
| # | الجدول | الـ migration | الـ Frontend | ملاحظات |
|---|---|---|---|---|
| 1 | `contracts` | `ADD client_snapshot JSONB` | جدول العقود | `customer_name` flat → `clientSnapshot` |
| 2 | `emergency_tickets` | `ADD client_snapshot JSONB` | صفحة الطوارئ | `client_name` + `client_address` flat → `clientSnapshot` |
| 3 | `telemarketing_appointments` | `ADD client_id + client_snapshot JSONB` | صفحة المواعيد | `customer_name` flat → `clientSnapshot` |
| 4 | `field_visits` | `UPDATE customer_snapshot shape` | VDP (Visit Detail Page) | `customer_snapshot` موجود بس مش موحّد |

**الـ Migration المقترحة:** `migrations/176_add_client_snapshots.sql`

---

### 🟠 بيانات الأسماء المقترحة ولوائح الأسماء

> **الحالة:** ⏳ لم يُنفّذ | **الملف:** [tasks/TASK_NAME_COLLECTIONS_REFERRAL_SHEETS.md](tasks/TASK_NAME_COLLECTIONS_REFERRAL_SHEETS.md) | **البرومptz:** [tasks/TASK_NAME_COLLECTIONS_REFERRAL_SHEETS_PROMPT.md](tasks/TASK_NAME_COLLECTIONS_REFERRAL_SHEETS_PROMPT.md)

**الهدف:** تحسين تجربة جمع الأسماء (Name Collections) والترشيحات المباشرة (Direct Suggestions) ولوائح الأسماء (Referral Sheets) بحيث كل اسم مقترح يصير له MiniClientSnapshot.

**الكيانات الثلاثة:**
| # | الكيان | الحالة الحالية | المطلوب |
|---|---|---|---|
| 1 | `visit_name_collections` | `client_id` موجود بس ما في `client_snapshot` | أضف `client_snapshot JSONB` + اعرض MiniClientSnapshot بالمودال |
| 2 | `direct_suggestions` | بس `name` + `phone` — معزولة | أضف `suggester_snapshot JSONB` + ربط تلقائي بـ `clients` |
| 3 | `referral_sheets` | `source_client_id` موجود بس ما في `snapshot` | أضف `source_client_snapshot JSONB` + قائمة المرشحين |

**الميزات الجديدة:**
- عرض الزبون (المجمع) بـ MiniClientSnapshot داخل NameCollectionModal
- قائمة الأسماء المجمّعة بأرقام تلفوناتها
- زر "تحويل لمرشح" (Convert to Candidate) للترشيحات المباشرة
- التحويل التلقائي من NameCollections → Candidates لما `actual_count >= proposed_count`

**الـ Migration المقترحة:** `migrations/177_name_collections_snapshots.sql`

---

### 🔵 المستوى الثالث: Full ClientSnapshot

> **الحالة:** ⏳ لم يُبدأ بعد | **موقع التوثيق:** [components/client-snapshot.md §المستوى الثالث](components/client-snapshot.md#المستوى-الثالث-full-snapshot)

**الحقول الإضافية (فوق Standard):**
- الجنس (`gender`)
- الرقم الوطني (`nationalId`)
- تاريخ الميلاد (`birthDate`)
- اسم الأم (`motherName`)
- معلومات السجل المدني
- ملاحظات عامة (`notes`)
- Source channel (`sourceChannel`)
- تاريخ التسجيل + مسجّل من قبل مين
- Referral sheet مربوطة

**السياقات:**
- Client Detail Page
- Contract Creation (review step)
- Referral Sheet Detail

---

## قواعد التنقل

1. **البحث:** Ctrl+F بالملف — كل عنوان بيحتوي ID (مثلاً `## 3.`)
2. **الروابط:** كل قسم مرتبط برقم — استخدم `#9.3` للوصول لثغرة رقم 3
3. **التحديث:** أي تعديل بيغيّر المعنى → حدّث الدستور أولاً
4. **الكود هو الحقيقة:** الدستور عبارة عن تفسير منظم — المصدر التشغيلي = الكود

---

## الأرشيف والتسليم (Handoffs)

| التاريخ | الملف | الموضوع |
|---|---|---|
| 2026-05-11 | [handoffs/2026-05-11-planning-appointments-handoff.md](handoffs/2026-05-11-planning-appointments-handoff.md) | Planning & Appointments |
| 2026-05-12 | [handoffs/2026-05-12-p1-p4-findings-handoff.md](handoffs/2026-05-12-p1-p4-findings-handoff.md) | P1-P4 Findings |
