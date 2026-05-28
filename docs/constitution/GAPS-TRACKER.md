# متعقب الثغرات — Golden CRM Gaps Tracker

> **الهدف:** نسجّل كل ثغرة أو تضارب أو قصور نكتشفو — ونحدد مين المسؤول عن حلو.
> **القاعدة:** أي ثغرة بدون رقم (GAP-XXX) = ما موجودة. لازم كل ثغرة تاخد رقم وتحط هون.

---

## الثغرات المفتوحة (Open Gaps)

### GAP-001: bulk-delete hard-delete bypass ⭐ عالية

| البند | التفصيل |
|---|---|
| **الكيان** | clients |
| **الموقع** | `routes/clients.ts:989` |
| **الوصف** | `POST /api/clients/bulk-delete` بيعمل `DELETE FROM clients WHERE id = ANY($1)` — hard-delete مباشر بدون فحص العقود أو الزيارات. |
| **التأثير** | بيتجاوز soft-delete mechanism — ممكن نضيع بيانات تاريخية + نكسر FK constraints |
| **الحل المقترح** | عدّل `bulk-delete` ليعمل بنفس منطق الحذف الفردي: فحص العقود → إلغاء المهام المفتوحة → soft-delete |
| **الحالة** | ⏳ مفتوحة |
| **ملف الدستور** | [clients.md §9.1](domains/clients.md#91-الثغرة-الأولى) |

### GAP-002: ASSIGNED scope blocked بالـ DB ⭐ عالية

| البند | التفصيل |
|---|---|
| **الكيان** | clients |
| **الموقع** | `migrations/054_permissions_allowed_scopes.sql` vs `policies/clientPolicy.ts` |
| **الوصف** | هجرة الـ DB بتحظر `ASSIGNED` scope لصلاحيات `clients.*` (بس `GLOBAL` و `BRANCH`). بس الكود في `clientPolicy.ts` والـ `customerOwnership.ts` جاهز تماماً لـ `ASSIGNED`. |
| **التأثير** | ما بيقدر أي admin يعطي صلاحية ASSIGNED للزبائن — فنظام الملكية الفردية (personal ownership) ما بيشتغل. |
| **الحل المقترح** | عدّل `054_permissions_allowed_scopes.sql` ليضيف `'ASSIGNED'` لـ `clients.view`, `clients.view_list`, `clients.edit` |
| **الحالة** | ⏳ مفتوحة |
| **ملف الدستور** | [permissions.md §9.1](domains/permissions.md#gap-002-تعطل-النطاق-الشخصي-للعملاء-بالـ-db) |

### GAP-003: Geo fields stored as VARCHAR not INTEGER 🟡 متوسطة

| البند | التفصيل |
|---|---|
| **الكيان** | clients |
| **الموقع** | `migrations/001_core_tables.sql` (clients.governorate, district, neighborhood) |
| **الوصف** | `governorate`, `district`, `neighborhood` مخزنة كـ `VARCHAR(255)` بس هي فعلياً `geo_units.id` (INTEGER). Migration `167` بيعمل `::int` casting قسري. |
| **التأثير** | ممكن يتخزن نص غير رقمي → بيكسر الـ queries اللي بتحتاج joining مع `geo_units` |
| **الحل المقترح** | ALTER TABLE → `INTEGER` + `FK → geo_units(id)` + `ON DELETE SET NULL` |
| **الحالة** | ✅ محلول — `migrations/170_clients_geo_integer.sql` + `routes/clients.ts` |
| **ملف الدستور** | [geo-units.md §9.1](domains/geo-units.md#gap-003-محلول--تحويل-حقول-عناوين-الزبائن-من-varchar-إلى-integer-fk) |

### GAP-004: Stale single-ownership column 🟢 منخفضة

| البند | التفصيل |
|---|---|
| **الكيان** | clients |
| **الموقع** | `migrations/031_clients_assigned_hr_user_id.sql` |
| **الوصف** | `assigned_hr_user_id` لساته موجود بالـ DB بعد الانتقال لـ `client_assignments` (M2M) |
| **التأثير** | تكرار بيانات + تخريب فهم المطورين الجدد |
| **الحل المقترح** | `ALTER TABLE clients DROP COLUMN assigned_hr_user_id;` |
| **الحالة** | ⏳ مفتوحة |
| **ملف الدستور** | [clients.md §9.4](domains/clients.md#94-الثغرة-الرابعة) |

### GAP-005: Missing CHECK constraints on enum-like fields 🟡 متوسطة

| البند | التفصيل |
|---|---|
| **الكيان** | clients |
| **الموقع** | `migrations/009_data_quality.sql` + `010_client_gender.sql` |
| **الوصف** | `data_quality` و `gender` نوعهم `VARCHAR` بدون `CHECK constraint` — بس الكود والـ Typescript بيحددوا قيم محددة |
| **التأثير** | ممكن يتخزن أي نص → بيعطل الـ UI والـ filtering |
| **الحل المقترح** | `ALTER TABLE clients ADD CHECK (gender IN ('Male', 'Female'))` + `ADD CHECK (data_quality IN ('Complete', 'Partial', 'Minimal'))` |
| **الحالة** | ⏳ مفتوحة |
| **ملف الدستور** | [clients.md §9.5](domains/clients.md#95-الثغرة-الخامسة) |

### GAP-006: Client cross-branch lookup missing ⭐ عالية — **جديد**

| البند | التفصيل |
|---|---|
| **الكيان** | clients + contracts |
| **الموقع** | `routes/clients.ts` (GET /api/clients) + `routes/contracts.ts` (POST /api/contracts) |
| **الوصف** | الزبون `branch_id = 1` (دمشق). مستخدم من فرع 2 (حمص) بدّو يعمل عقد للزبون. ما بيقدر — لأن بحث الزبائن بيفلتر بس حسب `branch_id`. |
| **التأثير** | فرع حمص ما بيقدر يخدم "زبون دمشق" إذا الزبون جاه للخدمة بمنطقة حمص. العقد بيُنشأ بـ `contracts.branch_id = فرع المنشئ` — بس الزبون "مخبوء" عن حمص. |
| **الحل المقترح** | إضافة permission `clients.cross_branch_lookup` + endpoint `POST /api/clients/lookup` بيبحث بكل الفروع (read-only). أو: تعديل `GET /api/clients` ليدعم `?crossBranch=true` للمستخدمين المصرح لهم. |
| **الحالة** | ⏳ مفتوحة — **بدّها قرار معماري** |
| **ملف الدستور** | هاد الملف (GAP-006) |
| **القرارات المطلوبة** | انظر [CROSS-REFERENCE.md § decision-needed](CROSS-REFERENCE.md#قرارات-معلقة) |

### GAP-007: Candidate detail view endpoint missing (No GET /api/candidates/:id) 🟡 متوسطة

| البند | التفصيل |
|---|---|
| **الكيان** | candidates |
| **الموقع** | `routes/candidates.ts` |
| **الوصف** | لا يوجد مسار برميجي لجلب تفاصيل مرشح فردي (`GET /api/candidates/:id`). بالرغم من احتواء ملف السياسات الأمنية على دالة تحقق مخصصة `canViewCandidate` تشير لأحقية المستخدم بالوصول. |
| **التأثير** | تضطر واجهة المستخدم الرسومية (Frontend) لجلب كامل قائمة المرشحين وتصفيتها محلياً لعرض التفاصيل، مما يسبب استهلاكاً ضخماً للبيانات ومخاطر تسريب أمني. |
| **الحل المقترح** | إنشاء المسار `GET /api/candidates/:id` وربطه بالسياسة الأمنية المحددة واستعلام الحقول الفردية. |
| **الحالة** | ⏳ مفتوحة |
| **ملف الدستور** | [candidates.md §9.1](domains/candidates.md#91-الثغرة-الأولى) |

### GAP-008: Status values mismatch between DB and Typescript Type 🟡 متوسطة

| البند | التفصيل |
|---|---|
| **الكيان** | candidates |
| **الموقع** | `packages/shared/types.ts` (`CandidateStatus` type) vs `migrations/007_candidates_missing_columns.sql` |
| **الوصف** | تفرض قاعدة البيانات بقيد الفحص قيم الحالة: `New`, `Suggested`, `FollowUp`, `Contacted`, `Qualified`, `Junk`. بينما يعرّف النوع البرمجي المشترك في Typescript القيمة `Prospect` بدلاً من `New`. |
| **التأثير** | حدوث أخطاء برمجية أو خطأ قاعدة بيانات `500` عند محاولة إرسال القيمة `Prospect` من الواجهة الأمامية لقاعدة البيانات. |
| **الحل المقترح** | توحيد المسمى إما لـ `New` أو لـ `Prospect` بكافة طبقات التطبيق بالاتفاق مع مهندس النظام. |
| **الحالة** | ⏳ مفتوحة |
| **ملف الدستور** | [candidates.md §9.2](domains/candidates.md#92-الثغرة-الثانية) |

### GAP-009: ASSIGNED scope blocked by allowed_scopes on DB 🟡 متوسطة

| البند | التفصيل |
|---|---|
| **الكيان** | candidates |
| **الموقع** | `migrations/054_permissions_allowed_scopes.sql` vs `routes/candidates.ts` |
| **الوصف** | هجرة الصلاحيات `054` تحدد النطاقات المسموحة لصلاحيات المرشحين بـ `GLOBAL` و `BRANCH` فقط. بينما يحتوي كود الـ API والسياسات على منطق لدعم نطاق `ASSIGNED`. |
| **التأثير** | تعذر منح صلاحيات تعديل أو حذف المرشحين بنطاق مسند شخصياً للموظفين، مما يعيق تفعيل سيناريوهات العمل. |
| **الحل المقترح** | تعديل Allowed scopes لكيان candidates لتدعم `ASSIGNED` في هجرة بذر قاعدة البيانات. |
| **الحالة** | ⏳ مفتوحة |
| **ملف الدستور** | [permissions.md §9.2](domains/permissions.md#gap-009-تعطل-النطاق-الشخصي-للمرشحين-بالـ-db) |

### GAP-010: Stale candidates single-ownership column 🟢 منخفضة

| البند | التفصيل |
|---|---|
| **الكيان** | candidates |
| **الموقع** | `migrations/001_core_tables.sql` vs `migrations/042_assignments_m2m.sql` |
| **الوصف** | بقاء العمود `owner_user_id` في جدول `candidates` بعد الانتقال الشامل لنظام التعيين متعدد الأطراف في جدول الربط `candidate_assignments` في الهجرة `042`. |
| **التأثير** | تكرار وتخزين بيانات غير مستخدمة ومربكة للمطورين في قاعدة البيانات. |
| **الحل المقترح** | إسقاط العمود `owner_user_id` من جدول `candidates` والاعتماد بالكامل على جدول الجانكشن. |
| **الحالة** | ⏳ مفتوحة |
| **ملف الدستور** | [candidates.md §9.4](domains/candidates.md#94-الثغرة-الرابعة) |

### GAP-011: Missing DB check constraint on referral_confirmation_status 🟢 منخفضة

| البند | التفصيل |
|---|---|
| **الكيان** | candidates |
| **الموقع** | `migrations/001_core_tables.sql` (candidates.referral_confirmation_status) |
| **الوصف** | حقل `referral_confirmation_status` يتم استخدامه بقيم `'Pending' \| 'Confirmed' \| 'Rejected'` بالـ shared type، ولكن لا يوجد قيد تحقق `CHECK constraint` عليه بالداتابيز. |
| **التأثير** | إمكانية تخزين قيم عشوائية تالفة مما يسبب مشاكل في الفلترة وعرض الواجهة. |
| **الحل المقترح** | إضافة قيد تحقق `CHECK (referral_confirmation_status IN ('Pending', 'Confirmed', 'Rejected'))` لجدول المرشحين. |
| **الحالة** | ⏳ مفتوحة |
| **ملف الدستور** | [candidates.md §9.5](domains/candidates.md#95-الثغرة-الخامسة) |

### GAP-012: Critical Missing Auth & Scopes on Dues Router ⭐ عالية — **جديد**

| البند | التفصيل |
|---|---|
| **الكيان** | dues / contracts |
| **الموقع** | `packages/api/routes/dues.ts` |
| **الوصف** | يفتقر مسار الديون والذمم الحساس جداً `/api/dues` بالكامل إلى وجود بوابات أمان التحقق والتوثيق (`requireAuth`) أو الفحص الجنائي للصلاحيات (`requirePermission`)، مما يتيح لأي شخص بالخارج قراءة الديون أو تعديلها دون تسجيل دخول. |
| **التأثير** | إمكانية تسريب بيانات الذمم والديون لعامة الجمهور، أو قيام مهاجم خارجي بشطب وتعديل مديونيات العملاء والذمم المالية المستحقة وتخريب حسابات الشركة دون أي تتبع. |
| **الحل المقترح** | إدراج برمجيات التحقق الوسطى `requireAuth` والتحقق من الصلاحيات والفرع المالي للطلب `requirePermission` وتصفية الديون حسب فرع الموظف بصرامة. |
| **الحالة** | ⏳ مفتوحة |
| **ملف الدستور** | [contracts.md §9.1](domains/contracts.md#91-الثغرة-الأولى) |

### GAP-013: Casing Mismatch in Payments Statuses 🟡 متوسطة — **جديد**

| البند | التفصيل |
|---|---|
| **الكيان** | contract_installments + dues |
| **الموقع** | `migrations/001_core_tables.sql` (dues.status) vs `migrations/127_contract_payments.sql` (contract_installments.status) |
| **الوصف** | تفرض قاعدة البيانات بقيد فحص الأقساط `contract_installments` قيماً بحروف صغيرة تماماً (`pending`, `paid`, `partial`, `overdue`)، بينما يفرض جدول الديون والمتابعات `dues` قيماً بحروف كابيتال (`Pending`, `Partial`, `Paid`, `Overdue`). |
| **التأثير** | وقوع أخطاء برمجية وحالات تعطل غير متوقعة (HTTP 500) عند قيام المطورين بالتحديث التلقائي لحالات الأقساط والديون نتيجة التضارب الفعلي في حالة الأحرف وعجز الفلترة. |
| **الحل المقترح** | توحيد حالة أحرف القيم في قيد الفحص بالداتابيز لتتطابق تماماً في كلا الجدولين الفرعيين. |
| **الحالة** | ⏳ مفتوحة |
| **ملف الدستور** | [contracts.md §9.2](domains/contracts.md#92-الثغرة-الثانية) |

### GAP-014: Core Financial Entity Lacks Soft-Delete 🟡 متوسطة — **جديد**

| البند | التفصيل |
|---|---|
| **الكيان** | contracts |
| **الموقع** | `routes/contracts.ts` (DELETE /api/contracts/:id) |
| **الوصف** | يفتقر الكيان المالي الأساسي `contracts` لنظام الحذف الناعم (Soft-Delete) ولا يملك عمود `deleted_at`. الحذف المطبق هو حذف فيزيائي مباشر يعمد إلى شطب سجل العقد وتدمير سجلات الدفعات والأقساط والديون المرتبطة به. |
| **التأثير** | زوال أي أثر للتدقيق الجنائي المحاسبي، وإمكانية تخريب الحسابات والمقبوضات دون القدرة على استعادتها أو معرفة المسؤول عن الحذف. |
| **الحل المقترح** | إضافة عمود `deleted_at` لجدول `contracts` وتحويل كافة مسارات الحذف إلى تحديث للراية وحجبه من الاستعلامات القياسية. |
| **الحالة** | ⏳ مفتوحة |
| **ملف الدستور** | [contracts.md §9.3](domains/contracts.md#93-الثغرة-الثالثة) |

### GAP-015: Missing Prices vs Sum of Payments Validation 🟡 متوسطة — **جديد**

| البند | التفصيل |
|---|---|
| **الكيان** | contracts + contract_payment_entries |
| **الموقع** | `routes/contracts.ts` (POST /api/contracts) |
| **الوصف** | لا يقوم الخادم بالتحقق من تطابق المبالغ المستلمة الفردية لقيمة الدفعة الأولى `down_payment` عند الإنشاء، كما لا يتم التحقق من مطابقة إجمالي الأقساط لصافي متبقي العقد. |
| **التأثير** | إمكانية إرسال وحفظ سجلات مالية تالفة أو مشوهة رياضياً (تفاوت الدفعة المقبوضة فعلياً عن الموثقة بالعقد) مما يخلق تعارضات وتقارير محاسبية غير متزنة بالصناديق. |
| **الحل المقترح** | تطبيق فحص رياضي ومطابقة دقيقة للمبالغ المرسلة مع بنود الدفعات والأقساط بالـ Controller قبل الحفظ النهائي. |
| **الحالة** | ⏳ مفتوحة |
| **ملف الدستور** | [contracts.md §9.4](domains/contracts.md#94-الثغرة-الرابعة) |

### GAP-016: Ambiguous Payments Method Casing 🟢 منخفضة — **جديد**

| البند | التفصيل |
|---|---|
| **الكيان** | contract_payment_entries |
| **الموقع** | `migrations/127_contract_payments.sql` (contract_payment_entries.method) |
| **الوصف** | استخدام قيمة وسيلة السداد `usd_cash` كطريقة دفع مستقلة لحساب العقد على الرغم من وجود عمود مستقل ومفصول للعملة يوثق العملات الأجنبية `currency = 'USD'`. |
| **التأثير** | حدوث تعارض وازدواجية تشغيلية عند إعداد تقارير الخزنة والمقبوضات، وخطر تضارب البيانات في حال اختيار طريقة الدفع الأجنبية مع عملة محلية بالخطأ. |
| **الحل المقترح** | قصر حقل `method` على وسيلة النقل المالي (`cash`, `bank`, `wallet`) وفصل العملة لتعتمد حصرياً على العمود الخاص بها. |
| **الحالة** | ⏳ مفتوحة |
| **ملف الدستور** | [contracts.md §9.5](domains/contracts.md#95-الثغرة-الخامسة) |

### GAP-017: Critical Legacy Permissions Mismatch ⭐ عالية — **جديد**

| البند | التفصيل |
|---|---|
| **الكيان** | open_tasks / permissions |
| **الموقع** | `packages/api/routes/openTasks.ts` |
| **الوصف** | يعتمد الكود برمجياً بشكل كامل في التحقق وحماية مسارات الكيان `open_tasks` على صلاحيات قديمة وموروثة تخص كياناً آخر `marketing_visits` (مثل `marketing_visits.view` و `marketing_visits.update_result`). |
| **التأثير** | إرباك شديد للمطورين وتداخل مفاهيم الحماية والأدوار الإدارية وصعوبة التحكم بامتيازات موظفي المتابعة هاتفياً والفرق الميدانية بشكل معزول ونظيف. |
| **الحل المقترح** | بذر صلاحيات مستقلة ومخصصة للمهام المفتوحة (`open_tasks.view` و `open_tasks.edit`) وتعديل الكود للاعتماد عليها. |
| **الحالة** | ✅ محلول جزئي — `openTasks.ts` محدّث (migration 174). تبقى `fieldVisits.ts`، `workScopes.ts`، `emergencyResult.ts` تستخدم `marketing_visits.*` حتى مراجعة دوماناتها. |
| **ملف الدستور** | [open-tasks.md §6](domains/open-tasks.md#6-صلاحيات-الوصول-permission-matrix) |

### GAP-018: Legacy Database Duplications 🟡 متوسطة — **جديد**

| البند | التفصيل |
|---|---|
| **الكيان** | open_tasks / marketing_visit_tasks / tasks |
| **الموقع** | `migrations/055_open_tasks.sql` (open_tasks.marketing_visit_task_id) |
| **الوصف** | بقاء الجداول القديمة `tasks` و `marketing_visit_tasks` بالداتابيز وتخزين أعمدة الربط التاريخية بها على الرغم من تولي الكيان الجديد `open_tasks` كامل المسؤولية التشغيلية والمالية. |
| **التأثير** | تكرار غير مبرر للبيانات التشغيلية وحيرة المطورين الجدد في معرفة وتحديد الجداول المعتمدة حالياً للعمل. |
| **الحل المقترح** | ترحيل كافة البيانات المتبقية بالجداول القديمة للكيان الجديد وإسقاط الجداول depolarized نهائياً. |
| **الحالة** | ⏳ مفتوحة |
| **ملف الدستور** | [open-tasks.md §9.2](domains/open-tasks.md#92-الثغرة-الثانية) |

### GAP-019: Central Operations Entity Lacks Soft-Delete 🟡 متوسطة — **جديد**

| البند | التفصيل |
|---|---|
| **الكيان** | open_tasks |
| **الموقع** | `routes/openTasks.ts` |
| **الوصف** | يفتقر الكيان المركزي المحرك للعمليات الميدانية `open_tasks` لنظام الحذف الناعم (`deleted_at`)، ويعتمد الحذف المطبق فيه على الحذف الفيزيائي المباشر من قاعدة البيانات. |
| **التأثير** | زوال السجل التاريخي لأداء الفنيين والفرق وتدمير سجلات الأنشطة وتعديلات الدفعات والأجهزة التابعة أوتوماتيكياً وقسرياً (بسبب `ON DELETE CASCADE`) دون ترك أي أثر للتدقيق. |
| **الحل المقترح** | إضافة عمود `deleted_at` للجدول الرئيسي وحجب المهام المحذوفة برمجياً بدلاً من شطبها فيزيائياً. |
| **الحالة** | ⏳ مفتوحة |
| **ملف الدستور** | [open-tasks.md §9.3](domains/open-tasks.md#93-الثغرة-الثالثة) |

### GAP-020: Unverified Emergency Dues Confirmation 🟡 متوسطة — **جديد**

| البند | التفصيل |
|---|---|
| **الكيان** | emergency_results / dues |
| **الموقع** | `packages/api/routes/emergencyResult.ts` (POST /:id/installments/confirm) |
| **الوصف** | يقبل مسار تأكيد وجدولة أقساط صيانة الطوارئ توليد الذمم والديون `dues` دون التحقق الصارم من اتساق تواريخ استحقاق الأقساط أو خلوها من التداخل الزمني والتناقضات المالية الفجة. |
| **التأثير** | إمكانية إرسال ذمم وديون تالفة أو متداخلة زمنياً والتأثير السلبي التلقائي على صناديق الفروع ومتابعات التحصيل الهاتفي. |
| **الحل المقترح** | فرض فحص رياضي ومقارنة زمنية دقيقة لجدولة الأقساط في خوارزمية السيرفر قبل الـ Commit النهائي. |
| **الحالة** | ⏳ مفتوحة |
| **ملف الدستور** | [open-tasks.md §9.4](domains/open-tasks.md#94-الثغرة-الرابعة) |

### GAP-021: Branch Context Inconsistency 🟡 متوسطة — **جديد**

| البند | التفصيل |
|---|---|
| **الكيان** | open_tasks / clients |
| **الموقع** | `open_tasks.branch_id` vs `clients.branch_id` |
| **الوصف** | يسمح النظام بإنشاءمهمة بفرع تشغيلي يختلف عن فرع العميل الأصلي، ولكن تصفية وعرض كشوف المهام للمشرفين بالـ UI تفترض وتعتمد أحياناً حصرها وفق فرع العميل مما يؤدي لضياع بعض المهام الميدانية. |
| **التأثير** | تعطل وإرباك حركة الفنيين وصعوبة تتبع المهام المتبادلة بين الفروع والمحافظات المختلفة. |
| **الحل المقترح** | توحيد شروط التحقق والالتزام التام بقراءة فرع المهمة المعزول `open_tasks.branch_id` في جميع تقارير وجداول الإعداد والتحضير للفروع. |
| **الحالة** | ⏳ مفتوحة |
| **ملف الدستور** | [open-tasks.md §9.5](domains/open-tasks.md#95-الثغرة-الخامسة) |

### GAP-022: Critical Missing Scopes on Contact Targets Router ⭐ عالية — **جديد**

| البند | التفصيل |
|---|---|
| **الكيان** | contact_targets |
| **الموقع** | `routes/contactTargets.ts` |
| **الوصف** | يفتقر مسار أهداف التسويق والتحصيل الميداني اليومي `/api/contact-targets` بالكامل لوجود بوابات أمان التحقق من الصلاحيات المعيارية للفرع (`requirePermission`)، مما يتيح لأي مستخدم مصرح له بالدخول (حتى لو كان متدرباً) بالمزامنة وعرض كافة أهداف المبيعات والمتابعة الجغرافية والتحصيل. |
| **التأثير** | إمكانية تسريب بيانات المبيعات الحساسة للمنافسين أو التلاعب بخطة التوزيع اليومي للفرع دون إذن مسبق. |
| **الحل المقترح** | فرض قيود التحقق من الصلاحيات (`requirePermission('telemarketing.lists.generate')`) على بوابات المزامنة والتحضير وتصفيتها جغرافياً بصرامة. |
| **الحالة** | ⏳ مفتوحة |
| **ملف الدستور** | [telemarketing.md §9.1](domains/telemarketing.md#91-الثغرة-الأولى) |

### GAP-023: PUT/PATCH Endpoints Missing for Telemarketing Appointments 🟡 متوسطة — **جديد**

| البند | التفصيل |
|---|---|
| **الكيان** | telemarketing_appointments |
| **الموقع** | `routes/telemarketing.ts` |
| **الوصف** | لا يوجد أي خيار أو endpoint برمجي مخصص لتحديث أو تعديل أو إعادة جدولة مواعيد التسويق المحجوزة (`telemarketing_appointments`). الطريقة الوحيدة لتغيير موعد هي الحذف المباشر وإعادة الحجز من البداية. |
| **التأثير** | يؤدي الحذف وإعادة الحجز لإنشاء مواعيد جديدة بمعرفات جديدة، مما يؤدي لتخريب السجل التاريخي ومعدلات التحويل، وتوليد مهام ميدانية وزيارات مكررة أو orphaned بالخلفية. |
| **الحل المقترح** | إنشاء مسار مخصص للتحديث `PUT /api/telemarketing/appointments/:id` للقيام بإعادة الجدولة وتحديث التاريخ/الشريحة وتعديل المهام والزيارات المرتبطة تلقائياً. |
| **الحالة** | ⏳ مفتوحة |
| **ملف الدستور** | [telemarketing.md §9.2](domains/telemarketing.md#92-الثغرة-الثانية) |

### GAP-024: Unconstrained and Unvalidated communication_method 🟢 منخفضة — **جديد**

| البند | التفصيل |
|---|---|
| **الكيان** | telemarketing_call_logs |
| **الموقع** | `migrations/001_core_tables.sql` (telemarketing_call_logs.communication_method) |
| **الوصف** | حقل وسيلة الاتصال `communication_method` في سجل المكالمات غير مقيد بقيد تحقق بالداتابيز (`CHECK constraint`) ولا يملك خادم التحقق أي قيود تمنع إدخال قيم عشوائية أو نصوص غير معيارية باللغات المختلفة (مثل 'واتساب'، 'phone'...). |
| **التأثير** | تشويه وتلف التقارير الإحصائية لنشاط مركز الاتصال واستهلاك القنوات، وتخريب الفلترة بالواجهات الرسومية. |
| **الحل المقترح** | إضافة قيد تحقق `CHECK (communication_method IN ('phone', 'whatsapp', 'sms'))` للجدول مع ضبط التخزين التلقائي برمجياً. |
| **الحالة** | ⏳ مفتوحة |
| **ملف الدستور** | [telemarketing.md §9.3](domains/telemarketing.md#93-الثغرة-الثالثة) |

### GAP-025: Perpetual NULL Snapshot for water_source 🟢 منخفضة — **جديد**

| البند | التفصيل |
|---|---|
| **الكيان** | telemarketing_appointments |
| **الموقع** | `routes/telemarketing.ts` (POST /api/telemarketing/appointments) |
| **الوصف** | يحاول جدول المواعيد أخذ لقطة فورية لخاصية العميل `water_source` كـ Snapshot وقت الحجز، ولكن نتيجة حذفه أو هيكلته الجديدة بجدول العملاء `clients` المحدث، لم يعد الحقل متاحاً بنفس المسمى مما ينتج عنه snapshot دائم القيمة `NULL`. |
| **التأثير** | إرسال بيانات ناقصة للفنيين الميدانيين حول نوع المياه المتاحة مما يربك العمل الميداني ويفقد حقل الـ snapshot قيمته التاريخية. |
| **الحل المقترح** | تحديث الاستعلام المالي والبيانات المرجعية للعميل وقت الموعد لتسحب الحقل من موقعه الصحيح والمستقر بجدول الزبائن. |
| **الحالة** | ⏳ مفتوحة |
| **ملف الدستور** | [telemarketing.md §9.4](domains/telemarketing.md#94-الخراب-الرابع) |

### GAP-026: Lack of Soft-Delete for Telemarketing Entities 🟡 متوسطة — **جديد**

| البند | التفصيل |
|---|---|
| **الكيان** | telemarketing_task_lists / telemarketing_call_logs / telemarketing_appointments |
| **الموقع** | `routes/telemarketing.ts` |
| **الوصف** | تفتقر كافة جداول التسويق الهاتفي (كشوف، مكالمات، مواعيد) لميزة الحذف الناعم (`deleted_at`)، ويترتب على حذف العميل أو المرشح تدمير سجلات الاتصال به فيزيائياً نتيجة قيد `ON DELETE CASCADE`. |
| **التأثير** | تدمير شامل وجارف للبيانات التاريخية والتدقيق الجنائي للأداء ونتائج العمل لفرق الكول سنتر بمرور الوقت مع حذف الحسابات. |
| **الحل المقترح** | إدراج حقول `deleted_at` لكافة الجداول وتحويل مسارات الحذف لقصر استعلاماتها يدوياً لحفظ الأرشيف التشغيلي. |
| **الحالة** | ⏳ مفتوحة |
| **ملف الدستور** | [telemarketing.md §9.5](domains/telemarketing.md#95-الثغرة-الخامسة) |

### GAP-027: Critical Permission Naming Mismatch ✅ محلول

| البند | التفصيل |
|---|---|
| **الكيان** | field_visits / permissions |
| **الموقع** | `packages/api/routes/fieldVisits.ts` |
| **الوصف** | جميع مسارات وإجراءات التحكم بنظام الزيارات الميدانية الموحد `field_visits` يتم التحقق منها وحمايتها بصلاحيات قديمة تتبع الكيان المتروك `marketing_visits` (مثل `marketing_visits.view` و `marketing_visits.update_result`). |
| **التأثير** | إرباك إداري شديد للمطورين ومسؤولي الأمن وصعوبة فصل أدوار فنيي المبيعات عن فنيي الصيانة. |
| **الحل المطبق** | استبدال 12 صلاحية في `fieldVisits.ts`: 6 × `marketing_visits.view` → `field_visits.view`، 6 × `marketing_visits.update_result` → `field_visits.edit`. هجرة `175_field_visits_permissions.sql` أنشأت `field_visits.edit` ومنحت كلا الصلاحيتين للأدوار. |
| **الحالة** | ✅ محلول — 2026-05-25 |
| **ملف الدستور** | [field-visits.md §6](domains/field-visits.md#6-صلاحيات-الوصول-permission-matrix) |

### GAP-028: Technical Contradiction on result_fields JSONB 🟡 متوسطة — **جديد**

| البند | التفصيل |
|---|---|
| **الكيان** | visit_tasks |
| **الموقع** | `docs/tasks/TASK_FIELD_VISITS_CONSTITUTION_PROMPT.md` vs `migrations/070_visit_core_schema.sql` |
| **الوصف** | تشير مسودة العمل السابقة إلى وجود حقل كـ JSONB باسم `result_fields` بجدول `visit_tasks` المضاف بالهجرة `087`. بالبحث، يتبين أن الهجرة `087` أضافت الحقول لجدول `marketing_visit_tasks` القديم والمتروك والذي تم إسقاطه في الهجرة `152` ولا وجود لهذا الحقل نهائياً بالجدول المعتمد حالياً. |
| **التأثير** | حدوث أخطاء برمجية وحيرة المطورين الجدد عند البحث عن الحقل المزعوم. |
| **الحل المقترح** | توضيح أن نتائج المهام الفنية والتشغيلية المعتمدة حالياً تعتمد بنسبة 100% على جداول النتائج التخصصية الملحقة بنظام Unified Result Pattern. |
| **الحالة** | ⏳ مفتوحة |
| **ملف الدستور** | [field-visits.md §9.2](domains/field-visits.md#92-الثغرة-الثانية) |

### GAP-029: Lack of Direct Visit Creation Endpoint 🟡 متوسطة — **جديد**

| البند | التفصيل |
|---|---|
| **الكيان** | field_visits |
| **الموقع** | `packages/api/routes/fieldVisits.ts` |
| **الوصف** | لا يوجد أي مسار برميجي متاح بالخادم يسمح بإنشاء زيارة ميدانية جديدة بشكل مستقل ومباشر (`POST /api/field-visits/` معطل أو غير منشأ). |
| **التأثير** | يعجز المدير الإداري للفرع عن تعيين وتكليف زيارة يدوية فجائية للفنيين دون توليد موعد تواصل هاتفي أو مهمة صيانة طارئة مسبقة بالخلفية. |
| **الحل المقترح** | بناء مسار مخصص للإنشاء اليدوي المباشر `POST /api/field-visits` وتوفير الصلاحيات المخصصة له. |
| **الحالة** | ⏳ مفتوحة |
| **ملف الدستور** | [field-visits.md §9.3](domains/field-visits.md#93-الثغرة-الثالثة) |

### GAP-030: Unchecked Technical Diagnostic Fields 🟢 منخفضة — **جديد**

| البند | التفصيل |
|---|---|
| **الكيان** | visit_task_emergency_technical_states |
| **الموقع** | `migrations/070_visit_core_schema.sql` (visit_task_emergency_technical_states) |
| **الوصف** | حقول التشخيص الهامة والمستقطبة من الميدان مثل `low_pressure_switch`, `high_pressure_switch`, `solenoid_valve`, `uv_status` مخزنة كـ `VARCHAR(100)` دون أي قيود فحص (`CHECK constraints`) أو التحقق البرمجي من تطابق القيم وقصرها على خيارات محددة. |
| **التأثير** | إدخال قيم عشوائية مختلفة وتلف جودة التقارير التقنية لأعطال الفلاتر. |
| **الحل المقترح** | إضافة قيد تحقق `CHECK` لقصر الحقول على القيم المعتمدة بالواجهة الرسومية (مثل 'Good', 'Damaged', 'Disconnected'). |
| **الحالة** | ⏳ مفتوحة |
| **ملف الدستور** | [field-visits.md §9.4](domains/field-visits.md#94-الثغرة-الرابعة) |

### GAP-031: Lack of Automatic Candidate Generation from Name Collection 🟢 منخفضة — **جديد**

| البند | التفصيل |
|---|---|
| **الكيان** | visit_name_collections / candidates |
| **الموقع** | `packages/api/routes/fieldVisits.ts` |
| **الوصف** | عند نجاح مهمة جمع الأسماء وتوثيق actual_count بجدول `visit_name_collections` وتحديث سجل `referral_sheets` بالعدد، لا يقوم النظام بالإنشاء والتحويل التلقائي لتلك التوصيات كـ `candidates` بقاعدة البيانات، بل يتطلب ذلك إدخالاً يدوياً مكرراً لاحقاً. |
| **التأثير** | ضياع التوصيات التسويقية الهامة وإهدار أداء مركز الاتصال. |
| **الحل المقترح** | بناء خوارزمية ذكية تقوم فوراً بتوليد سجلات مرشحين بصفة `Suggested` مع ربطهم بصحيفة الترشيح كإجراء تلقائي. |
| **الحالة** | ⏳ مفتوحة |
| **ملف الدستور** | [field-visits.md §9.5](domains/field-visits.md#95-الثغرة-الخامسة) |

### GAP-032: No Soft-Delete for Field Visits and Tasks 🟡 متوسطة — **جديد**

| البند | التفصيل |
|---|---|
| **الكيان** | field_visits / visit_tasks / visit_task_results |
| **الموقع** | `routes/fieldVisits.ts` |
| **الوصف** | يفتقر الكيان التنفيذي والمالي الهام `field_visits` بالكامل لنظام الحذف الناعم (`deleted_at`). حذف أي عميل أو تذكرة يؤدي لإزالة الزيارات ومهامها ونتائجها وقطع الغيار المصروفة فيزيائياً بـ `ON DELETE CASCADE`. |
| **التأثير** | فقدان شامل وفوري للأثر الجنائي التاريخي للأعمال والقطع والذمم المالية وضرب تقارير التدقيق السنوية. |
| **الحل المقترح** | إدراج حقول `deleted_at` لجميع جداول المهام والزيارات والتسويات، وقصر الحذف على تعديل حالة الراية. |
| **الحالة** | ⏳ مفتوحة |
| **ملف الدستور** | [field-visits.md §9.6](domains/field-visits.md#96-الثغرة-السادسة) |

### GAP-033: GPS Field Type Inconsistency and Lack of Boundary Checks 🟢 منخفضة — **جديد**

| البند | التفصيل |
|---|---|
| **الكيان** | visit_geo_logs / visit_task_device_delivery_results |
| **الموقع** | `migrations/081_visit_geo_logs.sql` vs `migrations/149_visit_task_postsale_results.sql` |
| **الوصف** | يتم تخزين الإحداثيات الجغرافية في جدول التتبع `visit_geo_logs` بنوع `DECIMAL(10,8)` و `DECIMAL(11,8)`، بينما يتم تخزين إحداثي التسليم الفعلي بجدول `visit_task_device_delivery_results` بنوع `NUMERIC(10,7)`. كما يخلو السيرفر من أي فحص للتحقق من سلامة الأرقام ومنطقيتها الرياضية. |
| **التأثير** | تباين في دقة التحديد الجغرافي وقيم الإحداثيات بين التقارير التشغيلية وتقارير التوصيل المالي. |
| **الحل المقترح** | توحيد نوع الحقول في جميع الجداول كـ `DECIMAL(10,8)` وفرض التحقق من الحدود الرياضية (-90 إلى 90 للخطوط العرضية) في كود الـ Controller. |
| **الحالة** | ⏳ مفتوحة |
| **ملف الدستور** | [field-visits.md §9.7](domains/field-visits.md#97-الثغرة-السابعة) |

### GAP-034: Employee residence VARCHAR → dropped (Option B) 🟡 متوسطة — **محلول**

| البند | التفصيل |
|---|---|
| **الكيان** | employees |
| **الموقع** | `migrations/171_drop_employees_residence_text.sql` + `routes/adminApplications.ts` |
| **الوصف** | حذف `employees.residence` النصي — الأعمدة `residence_*_id` (4 حقول INTEGER FK → geo_units) كانت موجودة بالفعل. بيانات اختبار فقط. |
| **الحالة** | ✅ محلول — `migrations/171_drop_employees_residence_text.sql` |
| **ملف الدستور** | [geo-units.md §9.2](domains/geo-units.md#gap-034-محلول--option-b-حذف-employeesresidence-النصي) |

### GAP-035: Missing CHECK constraints on level values 🟢 منخفضة — **محلول**

| البند | التفصيل |
|---|---|
| **الكيان** | geo_units |
| **الموقع** | `migrations/001_core_tables.sql` (geo_units) |
| **الوصف** | لا يفرض الجدول بقاعدة البيانات أي قيود فحص (`CHECK constraint`) على قيم الحقل `level`. **اكتشاف أثناء الحل:** النظام الفعلي يدعم 4 مستويات (وليس 3 كما وُثّق) — Level 4 يُمثّل الأحياء والقرى الدقيقة. |
| **التأثير** | إمكانية إدخال مستويات عشوائية تالفة (0، 5، أرقام سالبة). |
| **الحل المقترح** | `ALTER TABLE geo_units ADD CONSTRAINT geo_units_level_check CHECK (level IN (1, 2, 3, 4));` |
| **الحالة** | ✅ محلول — `migrations/168_geo_units_constraints.sql` |
| **ملف الدستور** | [geo-units.md §9.3](domains/geo-units.md#gap-035-غياب-قيد-التحقق-من-المستويات-الإدارية-no-level-validation-check) |

### GAP-036: No parent-child level hierarchy validation 🟢 منخفضة — **محلول**

| البند | التفصيل |
|---|---|
| **الكيان** | geo_units |
| **الموقع** | `migrations/001_core_tables.sql` (geo_units) |
| **الوصف** | لا يوجد فحص يضمن النزاهة الهرمية — ممكن ربط حي (level=4) بمحافظة (level=1) مباشرة. |
| **التأثير** | تشويه كلي لهيكلية شجرة العناوين وعجز فلترة `geoScopeService`. |
| **الحل المقترح** | فحص API: `parent.level = child.level - 1` مع رسائل خطأ واضحة. |
| **الحالة** | ✅ محلول — `packages/api/routes/geoUnits.ts` (POST handler) |
| **ملف الدستور** | [geo-units.md §9.4](domains/geo-units.md#gap-036-غياب-التحقق-الهرمي-بين-الأب-والابن-no-parent-level-validation) |

### GAP-037: PUT/PATCH Endpoints Missing for Geo Units 🟡 متوسطة — **محلول**

| البند | التفصيل |
|---|---|
| **الكيان** | geo_units |
| **الموقع** | `packages/api/routes/geoUnits.ts` |
| **الوصف** | يفتقر ملف المسارات لـ `PUT /api/geo-units/:id` و`GET /api/geo-units/:id`. |
| **التأثير** | لتصحيح خطأ إملائي بسيط، يضطر الإداري لحذف الحي (Cascade) وإعادة إنشائه. |
| **الحل المقترح** | إضافة `PUT /:id` لتعديل الاسم فقط + `GET /:id` للقراءة الفردية. |
| **الحالة** | ✅ محلول — `packages/api/routes/geoUnits.ts` (GET /:id + PUT /:id) |
| **ملف الدستور** | [geo-units.md §9.5](domains/geo-units.md#gap-037-انعدام-مسارات-التحديث-وقراءة-العنصر-الفردي-بالـ-api) |

### GAP-038: Branches covered areas JSONB lacks referential integrity 🟡 متوسطة — **محلول**

| البند | التفصيل |
|---|---|
| **الكيان** | branches |
| **الموقع** | `migrations/014_branch_id_domain_tables.sql` (branches.covered_geo_ids) |
| **الوصف** | `branches.covered_geo_ids` كانت JSONB بدون FK — حذف geo_unit يترك IDs يتيمة تكسر عزل النطاق في `geoScopeService`. |
| **التأثير** | نطاقات فروع خاطئة → إمكانية رؤية بيانات فروع أخرى أو إخفاء بيانات مشروعة. |
| **الحل المقترح** | جدول ربط `branch_geo_coverage (branch_id FK, geo_unit_id FK ON DELETE CASCADE)`. |
| **الحالة** | ✅ محلول — `migrations/169_branch_geo_coverage_table.sql` + `geoScopeService.ts` + `branches.ts` |
| **ملف الدستور** | [geo-units.md §9.6](domains/geo-units.md#gap-038-تراجع-النزاهة-على-تغطية-الفروع-covered_geo_ids-bypass) |

### GAP-039: Dangerous recursive deletion cascade 🟡 متوسطة — **محلول**

| البند | التفصيل |
|---|---|
| **الكيان** | geo_units |
| **الموقع** | `migrations/001_core_tables.sql` (geo_units.parent_id) |
| **الوصف** | حقل `parent_id` كان مُعرَّفاً بـ `ON DELETE CASCADE` — حذف محافظة يمسح كل مناطقها وأحياءها فوراً وبصمت. |
| **التأثير** | حذف محافظة واحدة = ضياع عشرات الأحياء + بيانات يتيمة بجدول العملاء. |
| **الحل المقترح** | استبدال CASCADE بـ `ON DELETE RESTRICT` + معالجة خطأ 23503 بالـ API برسالة واضحة. |
| **الحالة** | ✅ محلول — `migrations/168_geo_units_constraints.sql` + معالجة `23503` في DELETE handler |
| **ملف الدستور** | [geo-units.md §9.7](domains/geo-units.md#gap-039-خطورة-الحذف-المتتالي-التلقائي-dangerous-deletion-cascade) |

### GAP-040: Legacy role string column duplication on hr_users 🟢 منخفضة — **جديد**

| البند | التفصيل |
|---|---|
| **الكيان** | hr_users |
| **الموقع** | `migrations/003_hr_rbac_tables.sql` (hr_users.role) |
| **الوصف** | تكرار تعريف دور المستخدم عن طريق حقل نصي يتيم `role` موروث من المراحل الأولى للنظام، بالتوازي مع حقل المعرف المرجعي الجديد `role_id` المرتبط بقوالب الفروع. |
| **التأثير** | خطر تباين وتعارض الهوية الأمنية للمستخدم بالخلفية عند تعديل معرف الرقم دون النص، مما قد ينتج سلوكاً غير متوقع عند التحقق من الهوية بالواجهة. |
| **الحل المقترح** | إزالة الحقل النصي القديم `role` من الداتابيز وتعديل كافة الإشارات البرمجية لتعتمد بالكامل على الرقم المرجعي للدور الأمني. |
| **الحالة** | ⏳ مفتوحة |
| **ملف الدستور** | [permissions.md §9.4](domains/permissions.md#gap-040-ازدواجية-وتكرار-حقل-الدور-بجدول-حسابات-المستخدمين) |

### GAP-041: Legacy branch_id column duplication on hr_users 🟢 منخفضة — **جديد**

| البند | التفصيل |
|---|---|
| **الكيان** | hr_users / user_branch_assignments |
| **الموقع** | `migrations/013_multi_branch_identity.sql` (hr_users.branch_id) |
| **الوصف** | بقاء وتكرار حقل الفرع الفردي الموروث `branch_id` بجدول حسابات المستخدمين، على الرغم من تدشين وإطلاق جدول تخصيص الفروع المتعددة الحديث `user_branch_assignments`. |
| **التأثير** | تعارض برمج تشغيلي بالخلفية عند سحب فروع أو تعديل الفرع الرئيسي للموظف دون تعديل الحقل الفردي، مما يخلق تعييناً معلقاً ويتيماً. |
| **الحل المقترح** | إيقاف وتصفير الحقل الفردي القديم `branch_id` وتوجيه كافة استعلامات النطاق الأمني لتتحقق من جدول الربط المتعدد حصرياً. |
| **الحالة** | ⏳ مفتوحة |
| **ملف الدستور** | [permissions.md §9.5](domains/permissions.md#gap-041-ازدواجية-وتكرار-تخصيصات-الفروع-للموظفين) |

### GAP-042: Redundant role_permissions and role_permission_grants co-existence 🟡 متوسطة — **جديد**

| البند | التفصيل |
|---|---|
| **الكيان** | roles / permissions |
| **الموقع** | `migrations/019_authorization_schema_preparation.sql` |
| **الوصف** | التعايش المشترك والازدواجي لجدولي الربط: الجدول التأسيسي القديم `role_permissions` وجدول المنح الجغرافي المعزز بالنطاقات `role_permission_grants`. |
| **التأثير** | استهلاك غير مبرر لموارد الداتابيز وإجبار المطورين على كتابة كود مكرر لإجراء إضافتين متزامنتين بجدولين منفصلين عند إسناد صلاحية للدور بالخلفية. |
| **الحل المقترح** | إزالة جدول الربط القديم البسيط بالكامل وتوجيه عمليات فحص الصلاحيات لتعتمد بالكامل على نطاق الـ Grants. |
| **الحالة** | ⏳ مفتوحة |
| **ملف الدستور** | [permissions.md §9.6](domains/permissions.md#gap-042-التعايش-المشترك-لجدولي-الصلاحيات-role_permissions-و-role_permission_grants) |

### GAP-043: No audit log for permission changes 🟢 منخفضة — **جديد**

| البند | التفصيل |
|---|---|
| **الكيان** | role_permission_grants / permissions |
| **الموقع** | `packages/api/routes/roles.ts` |
| **الوصف** | يفتقر نظام الصلاحيات والأدوار لوجود جدول تدقيق ومراقبة (Audit Log) لتتبع التغييرات التي تطرأ على منح الصلاحيات وتعديل نطاقها. |
| **التأثير** | عجز مسؤولي الأمان بالـ HQ عن معرفة من قام بمنح صلاحية إدارية خطيرة لموظف تشغيلي بالخارج ومتى تم ذلك. |
| **الحل المقترح** | ربط عمليات تعديل الصلاحيات بجدول المراقبة العام `audit_logs` أو حقن سجل مخصص للتدقيق الأمني بالخلفية. |
| **الحالة** | ⏳ مفتوحة |
| **ملف الدستور** | [permissions.md §9.7](domains/permissions.md#gap-043-غياب-سجل-التدقيق-والمراقبة-على-تعديل-الصلاحيات) |

### GAP-044: allowed_scopes array silent application policy bypass 🟡 متوسطة — **جديد**

| البند | التفصيل |
|---|---|
| **الكيان** | permissions |
| **الموقع** | `migrations/054_permissions_allowed_scopes.sql` (allowed_scopes) |
| **الوصف** | يؤدي تعارض الفحوصات الأمنية بين مستوى الكود والـ DB (حيث يحظر الـ DB حقل `ASSIGNED` كـ allowed_scope للعملاء) لحدوث إغلاق صامت للواجهة وعرقلة المنح الأمني دون إشعار واضح بالخطأ البرمجي. |
| **التأثير** | إرباك الموظفين وتوقف العمليات التشخيصية في بيئات الفروع دون معرفة السبب في الحظر التلقائي بالواجهة الرسومية للشركة. |
| **الحل المقترح** | توحيد مستويات التحقق الأمني بذكاء، وبذر النطاقات المدعومة بالـ DB بالتزامن مع السياسة الفعلية لكيانات الكود. |
| **الحالة** | ⏳ مفتوحة |
| **ملف الدستور** | [permissions.md §9.8](domains/permissions.md#gap-044-تعارض-فحوصات-الصلاحيات-بين-الداتابيز-والسياسة-البرمجية) |

### GAP-045: Lack of permission check on branches GET endpoints 🟡 متوسطة

| البند | التفصيل |
|---|---|
| **الكيان** | branches |
| **الموقع** | `packages/api/routes/branches.ts` (GET / and GET /:id) |
| **الوصف** | تكتفي مسارات القراءة واستعراض الفروع بالتحقق من تسجيل الدخول فقط `requireAuth` دون التحقق من صلاحية قراءة مخصصة للكيان. |
| **التأثير** | يتيح لأي حساب تشغيلي مصرح له بالوصول (حتى الموظف الميداني البسيط) استعراض وقراءة عناوين وهواتف وتفاصيل ومصفوفة نطاق التغطية الجغرافية الكاملة لكافة فروع الشركة دون قيود. |
| **الحالة** | ✅ محلول — `requirePermission('branches.view')` على GET / وGET /:id |
| **ملف الدستور** | [branches.md §9.1](domains/branches.md#gap-045-محلول--إضافة-branchesview-لمسارات-الاستعلام) |

### GAP-046: No referential integrity on covered_geo_ids JSONB array 🟡 متوسطة

| البند | التفصيل |
|---|---|
| **الكيان** | branches |
| **الموقع** | `migrations/001_core_tables.sql` (branches.covered_geo_ids) |
| **الوصف** | يتم حفظ التغطية التشغيلية للفرع الجغرافي كـ JSONB Array دون فرض أي قيد مرجعي (Foreign Key) بجدول التقسيمات الجغرافية الرئيسي `geo_units`. |
| **التأثير** | بقاء وتراكم معرفات لأحياء جغرافية يتيمة وتالفة عند مسح وحدات جغرافية. |
| **الحالة** | ✅ محلول — `migrations/169_branch_geo_coverage_table.sql` (junction table مع CASCADE) |
| **ملف الدستور** | [branches.md §9.2](domains/branches.md#gap-046-محلول--استبدال-covered_geo_ids-jsonb-بجدول-branch_geo_coverage) |

### GAP-047: Lack of validation schema on contact_info JSONB structure 🟢 منخفضة — **جديد**

| البند | التفصيل |
|---|---|
| **الكيان** | branches |
| **الموقع** | `migrations/004_column_additions.sql` (branches.contact_info) |
| **الوصف** | يتم تخزين حقل معلومات التواصل كـ JSONB مرن وحر دون وجود قيد فحص أو التحقق من صحة تطابق الكائنات البرمجية (Contact Schema Structure validation). |
| **التأثير** | إمكانية إدخال بيانات تالفة أو كائنات مشوهة بالداتابيز تؤدي لحدوث أخطاء فادحة وتوقف تام بالواجهات الأمامية للعملاء عند محاولة تفكيك وقراءة مصفوفة الفروع بالمتصفح. |
| **الحل المقترح** | تطبيق فحص وتحقق صارم في السيرفر باستخدام Zod Schema للـ `contactInfo` المدخل بطلب الـ PUT/POST قبل ترحيل الحفظ بقاعدة البيانات. |
| **الحالة** | ✅ محلول — `validateContactInfo()` في POST وPUT بـ `branches.ts` |
| **ملف الدستور** | [branches.md §9.3](domains/branches.md#gap-047-محلول--التحقق-من-بنية-contact_info-في-post-وput) |

### GAP-048: Absence of audit log for branch changes 🟢 منخفضة — **جديد**

| البند | التفصيل |
|---|---|
| **الكيان** | branches |
| **الموقع** | `packages/api/routes/branches.ts` |
| **الوصف** | تخلو واجهة الإدارة للفروع تماماً من وجود نظام تتبع وتدقيق (Audit Trail) للعمليات التشغيلية الهامة كالتغيير الجغرافي للمقر، أو تعديل مصفوفة الأحياء المغطاة، أو تغيير أرقام الاتصال. |
| **التأثير** | صعوبة تحديد المسؤول عن إحداث تغييرات جغرافية أدت لتداخل نطاقات العمل الميداني للفرق وتغيير توزيع العمليات الجغرافية. |
| **الحل المقترح** | تسجيل وربط عمليات التعديل للفروع بجدول المراقبة والتدقيق العام للمشروع `audit_logs`. |
| **الحالة** | ⏳ مفتوحة |
| **ملف الدستور** | [branches.md §9.4](domains/branches.md#gap-048-انعدام-سجل-التدقيق-ومراقبة-التغييرات-للفروع) |

### GAP-049: No validation check on inactive branch for new domain records 🟡 متوسطة — **جديد**

| البند | التفصيل |
|---|---|
| **الكيان** | clients / contracts / open_tasks |
| **الموقع** | `packages/api/routes/clients.ts` & `packages/api/routes/contracts.ts` |
| **الوصف** | لا يفرض السيرفر أي فحوصات تمنع إسناد أو تسجيل عقود أو عملاء أو مهام جديدة لفرع تم تحويل حالته ميدانياً لـ غير نشط (`status = 'inactive'`). |
| **التأثير** | إمكانية ترحيل سجلات وعمليات جديدة لفروع مغلقة مما يؤدي لضياع السجلات ميدانياً لغياب فرق العمل النشطة التابعة للفرع. |
| **الحل المقترح** | تطبيق قيد فحص بالـ Controllers يحظر ترحيل السجلات الجديدة في حال لم تكن حالة الفرع المرجعي `active` بالداتابيز. |
| **الحالة** | ✅ محلول — فحص branch.status قبل INSERT في clients + contracts + openTasks |
| **ملف الدستور** | [branches.md §9.5](domains/branches.md#gap-049-محلول--منع-إنشاء-سجلات-جديدة-لفرع-موقوف) |

### GAP-050: Public Access على إدارة الأجهزة وقطع الغيار ⭐ حرجة — **جديد**

| البند | التفصيل |
|---|---|
| **الكيان** | device_models / spare_parts |
| **الموقع** | `packages/api/routes/deviceModels.ts` (POST/PUT/DELETE) / `packages/api/routes/spareParts.ts` (كل المسارات) |
| **الوصف** | مسارات إنشاء وتعديل وحذف الأجهزة وقطع الغيار تخلو تماماً من `requireAuth` أو `requirePermission` — متاحة لأي شخص بالإنترنت. |
| **التأثير** | أي مهاجم يستطيع تعديل أسعار الكتالوج أو حذف موديلات الأجهزة كاملاً دون تسجيل دخول. |
| **الحل المطبق** | `requirePermission('catalog.manage')` على POST/PUT/DELETE + `requireAuth` على GET في كلا الملفين. `catalog.manage` يمر للـ superAdmin تلقائياً — يحتاج migration لبذر الصلاحية للأدوار الإدارية. |
| **الحالة** | ✅ محلول — 2026-05-25 |
| **ملف الدستور** | [devices-maintenance.md §6](domains/devices-maintenance.md#6-صلاحيات-الوصول-والمصفوفة-الأمنية-permission-matrix) |

### GAP-051: غياب صلاحيات مخصصة لإدارة الخصومات 🟡 متوسطة — **جديد**

| البند | التفصيل |
|---|---|
| **الكيان** | device_discounts |
| **الموقع** | `packages/api/routes/deviceModels.ts` (Discounts endpoints POST/PUT/DELETE) |
| **الوصف** | مسارات إنشاء وتعديل وحذف الخصومات المالية تكتفي بـ `requireAuth` دون صلاحية مخصصة لإدارة السياسات المالية. |
| **التأثير** | أي موظف بحساب نشط يستطيع إنشاء خصم 100% وتطبيقه على مبيعات الأجهزة. |
| **الحل المطبق** | استبدال `requireAuth` بـ `requirePermission('devices.discounts.manage')` على POST/PUT/DELETE للخصومات. يحتاج migration لبذر الصلاحية للأدوار المناسبة. |
| **الحالة** | ✅ محلول — 2026-05-25 |
| **ملف الدستور** | [devices-maintenance.md §6](domains/devices-maintenance.md#6-صلاحيات-الوصول-والمصفوفة-الأمنية-permission-matrix) |

### GAP-052: Hard Delete يتيّم بيانات العقود التاريخية 🟡 متوسطة — **جديد**

| البند | التفصيل |
|---|---|
| **الكيان** | device_models / spare_parts |
| **الموقع** | `packages/api/routes/deviceModels.ts` / `spareParts.ts` |
| **الوصف** | حذف موديل جهاز يُفرغ `contracts.device_model_id` إلى NULL ويتيم البيانات التاريخية. لا يوجد soft-delete. |
| **التأثير** | فقدان الربط التاريخي بين العقود وموديلات الأجهزة — ضرب التقارير المالية والمبيعات. |
| **الحل المطبق** | `migrations/180_devices_soft_delete.sql` أضاف `deleted_at` للجدولين. DELETE تحول لـ `UPDATE deleted_at = NOW()`. GET يفلتر `WHERE deleted_at IS NULL`. |
| **الحالة** | ✅ محلول — 2026-05-25 |
| **ملف الدستور** | [devices-maintenance.md §9](domains/devices-maintenance.md#9-الثغرات-والتضاربات-المكتشفة-gaps--contradictions) |

### GAP-053: JSONB Arrays بدون تكامل مرجعي فيزيائي 🟡 متوسطة — **جديد**

| البند | التفصيل |
|---|---|
| **الكيان** | spare_parts / device_models |
| **الموقع** | `spare_parts.compatible_device_ids` / `device_models.supported_visit_types` |
| **الوصف** | مصفوفات JSONB تخزن معرفات أجهزة وأنواع زيارات بدون Foreign Key — حذف جهاز لا يُنظّف مصفوفات التوافق. |
| **التأثير** | معرفات تالفة ويتيمة تُسبب فشل استعلامات التوافق وأخطاء واجهة المستخدم. |
| **الحل المقترح** | جداول ربط مستقلة أو trigger يُنظّف المصفوفات عند الحذف. |
| **الحالة** | ⏳ مفتوحة |
| **ملف الدستور** | [devices-maintenance.md §9](domains/devices-maintenance.md#9-الثغرات-والتضاربات-المكتشفة-gaps--contradictions) |

### GAP-054: غياب فحص التداخل الزمني للخصومات 🟡 متوسطة — **جديد**

| البند | التفصيل |
|---|---|
| **الكيان** | device_discounts |
| **الموقع** | `packages/api/routes/deviceModels.ts` (POST /:id/discounts، PUT /:id/discounts/:did) |
| **الوصف** | لا يوجد فحص يمنع وجود خصمين متداخلين زمنياً بنسب مختلفة لنفس الجهاز في نفس الفترة. |
| **التأثير** | السيرفر لا يعرف أي خصم يطبق عند التعارض — قد يطبق الأرخص عشوائياً مما يُسبب خسائر مالية. |
| **الحل المطبق** | فحص `start_date <= $endDate AND end_date >= $startDate` قبل الإنشاء والتعديل. يُرجع 400 عند التداخل. |
| **الحالة** | ✅ محلول — 2026-05-25 |
| **ملف الدستور** | [devices-maintenance.md §9](domains/devices-maintenance.md#9-الثغرات-والتضاربات-المكتشفة-gaps--contradictions) |

### GAP-055: `visit_task_device_demo_results` يفتقر لمعرف الجهاز المعروض 🟡 متوسطة — **جديد**

| البند | التفصيل |
|---|---|
| **الكيان** | visit_task_device_demo_results |
| **الموقع** | `migrations/070_visit_core_schema.sql` |
| **الوصف** | الجدول يحفظ العرض والعقد المنشأ لكن لا يحتوي على `offered_device_model_id` لمعرفة الجهاز المعروض في الزيارة. |
| **التأثير** | تعذّر تحليل نسبة التحويل per-device للعروض الميدانية — ضعف في تقارير المبيعات. |
| **الحل المطبق** | `migrations/179_device_demo_offered_model.sql` أضاف `offered_device_model_id INTEGER FK → device_models ON DELETE SET NULL`. |
| **الحالة** | ✅ محلول — 2026-05-25 |
| **ملف الدستور** | [devices-maintenance.md §9](domains/devices-maintenance.md#9-الثغرات-والتضاربات-المكتشفة-gaps--contradictions) |

### GAP-056: ازدواجية حقلي `name`/`brand` مع `name_ar`/`name_en` ⭐ عالية — **جديد**

| البند | التفصيل |
|---|---|
| **الكيان** | device_models |
| **الموقع** | `packages/api/routes/deviceModels.ts` دالة `normalizeDevicePayload()` سطر 38-40 |
| **الوصف** | الكود يُجبر دائماً: `name = name_ar` و`brand = name_en`. الحقلان الأصليان من المهجرة 001 زائدان وغير مستقلان ويُضيّعان مساحة تخزين ويربكون المطورين. |
| **التأثير** | تضليل المطورين الجدد — أربعة حقول بدلاً من اثنين، وتكرار بيانات في كل سجل، وإمكانية تعارض القيم. |
| **الحل المقترح** | مهجرة تُسقط `name` و`brand` وتوجّه الاستعلامات للحقول الثنائية. |
| **الحالة** | ⏳ مفتوحة |
| **ملف الدستور** | [devices-maintenance.md §2.1](domains/devices-maintenance.md#21-جدول-موديلات-الأجهزة-device_models) |

### GAP-057: `visit_task_device_activation_results` غير موجود في المهجرات ⭐ عالية — **جديد**

| البند | التفصيل |
|---|---|
| **الكيان** | device_activation task / field_visits |
| **الموقع** | مهجرات 001-147 (مفحوصة كاملاً) |
| **الوصف** | الوثائق السابقة والمخطط تشير لجدول `visit_task_device_activation_results` لكنه لم يُنشأ في أي مهجرة مفحوصة حتى المهجرة 147. مرحلة التشغيل تُحدّث `device_status` برمجياً فقط دون تخزين نتائج تقنية. |
| **التأثير** | لا يوجد تتبع تقني لقياسات TDS ومعايرة الجهاز عند التشغيل الأولي — ثغرة جودة خدمة. |
| **الحل المطبق** | `migrations/181_device_activation_results.sql` أنشأ الجدول بحقول: `tds_before`, `tds_after`, `pump_pressure`, `uv_status`, `customer_trained`, `activated_by_employee_id`. |
| **الحالة** | ✅ محلول (DB فقط) — 2026-05-25 — يحتاج API endpoint و frontend لاستخدام الجدول. |
| **ملف الدستور** | [devices-maintenance.md §2.5](domains/devices-maintenance.md#25-جداول-نتائج-المهام-المتخصصة) |

### GAP-058: `maintenance_interval` VARCHAR غير مقيد وغير مُفعَّل 🟡 متوسطة — **جديد**

| البند | التفصيل |
|---|---|
| **الكيان** | device_models |
| **الموقع** | `migrations/001_core_tables.sql` + `deviceModels.ts` سطر 43 |
| **الوصف** | الحقل `maintenance_interval` من نوع `VARCHAR(50)` بدون CHECK constraint، وافتراضيه في الكود `'6 أشهر'` (نص عربي غير معياري). لا يوجد منطق جدولة أوتوماتيكية للصيانة بناءً عليه. |
| **التأثير** | الحقل "تزييني" فقط — لا يُولّد مهام صيانة ولا يُطبّق فترة صيانة معيارية. |
| **الحل المقترح** | تحويل إلى `INTEGER` (عدد أشهر) + منطق جدولة صيانة دورية في `task_type_config`. |
| **الحالة** | ⏳ مفتوحة |
| **ملف الدستور** | [devices-maintenance.md §3](domains/devices-maintenance.md#3-القيود-والقواعد-التشغيلية-business-rules) |

### GAP-059: القيمة الافتراضية لـ category مخالفة للـ CHECK Constraint ⭐ عالية — **جديد**

| البند | التفصيل |
|---|---|
| **الكيان** | device_models |
| **الموقع** | `packages/api/routes/deviceModels.ts` سطر 42 |
| **الوصف** | `category: body.category \|\| 'صناعي'` — القيمة الافتراضية `'صناعي'` (عربية) بينما قيد DB يسمح فقط بـ `'Residential', 'Industrial', 'Commercial'` (إنجليزية). |
| **التأثير** | أي طلب POST/PUT بدون category → يحاول تخزين `'صناعي'` → يخالف CHECK constraint → خطأ 500 بالـ DB. |
| **الحل المطبق** | `category: body.category \|\| 'Industrial'` |
| **الحالة** | ✅ محلول — 2026-05-25 |
| **ملف الدستور** | [devices-maintenance.md §3](domains/devices-maintenance.md#3-القيود-والقواعد-التشغيلية-business-rules) |

### GAP-060: محدودية حالات `device_status` — غياب حالات الخدمة 🟡 متوسطة — **جديد**

| البند | التفصيل |
|---|---|
| **الكيان** | contracts |
| **الموقع** | `migrations/142_contract_device_tracking.sql` |
| **الوصف** | القيم المسموحة `pending_delivery, delivered, installed, active` فقط. لا توجد حالات للأجهزة المعطوبة (`faulty`)، المسحوبة (`retrieved`)، الموقوفة مؤقتاً (`disconnected`)، أو التحت صيانة (`under_maintenance`). |
| **التأثير** | لا يمكن تتبع أجهزة تحتاج إصلاحاً أو أجهزة أُعيدت للشركة — ثغرة في إدارة الأصول. |
| **الحل المطبق** | `migrations/178_device_status_extend.sql` وسّع CHECK بإضافة `under_maintenance, faulty, retrieved, disconnected`. |
| **الحالة** | ✅ محلول — 2026-05-25 |
| **ملف الدستور** | [devices-maintenance.md §5](domains/devices-maintenance.md#5-آلة-الحالات-التشغيلية-lifecycle-state-machine) |

### GAP-061: حقل `code` بدون UNIQUE constraint 🟢 منخفضة — **جديد**

| البند | التفصيل |
|---|---|
| **الكيان** | device_models |
| **الموقع** | `migrations/125_device_code.sql` |
| **الوصف** | الحقل `device_models.code` لا يملك قيد UNIQUE — يمكن نظرياً أن يتكرر نفس الكود لأجهزة مختلفة. |
| **التأثير** | فشل استعلامات البحث بالكود وإرباك فرق المخازن والتوزيع. |
| **الحل المطبق** | `migrations/177_device_code_unique.sql`: `CREATE UNIQUE INDEX WHERE code IS NOT NULL` |
| **الحالة** | ✅ محلول — 2026-05-25 |
| **ملف الدستور** | [devices-maintenance.md §9](domains/devices-maintenance.md#9-الثغرات-والتضاربات-المكتشفة-gaps--contradictions) |

### GAP-062: Geo unit status has no operational effect — cascade, scope, tasks, blocks all missing ⭐ عالية

| البند | التفصيل |
|---|---|
| **الكيان** | geo_units + open_tasks + field_visits + clients + geoScopeService |
| **الموقع** | `routes/geoUnits.ts` · `services/geoScopeService.ts` · `routes/clients.ts` · `routes/openTasks.ts` · `routes/contracts.ts` |
| **الوصف** | حقل `geo_units.status` موجود بالـ DB والـ badge ظاهر في الواجهة، لكن تغيير الحالة لـ `inactive` **لا يفعل أي شيء** فعلياً — لا cascade للأبناء، لا تأثير على نطاق الفروع، لا منع لتسجيل زبائن جدد، لا منع لإنشاء مهام، ولا إلغاء للمهام القائمة. |
| **التأثير** | `inactive` مجرد cosmetic badge — لا يوقف أي عمليات في المنطقة المعطّلة. |
| **الحالة** | 🔴 مؤجلة — يتطلب معرفة كاملة بجميع المتأثرين قبل التنفيذ |
| **ملف الدستور** | [geo-units.md §3 BR-5](domains/geo-units.md#br-5-قاعدة-حالة-الوحدة-الجغرافية-geo-unit-status) |

**المكونات الخمسة المطلوبة للتنفيذ الكامل:**

**1. Cascade الحالة للأبناء** — `routes/geoUnits.ts` → `PATCH /:id/status`
```sql
WITH RECURSIVE descendants AS (
  SELECT id FROM geo_units WHERE id = $geoUnitId
  UNION ALL
  SELECT g.id FROM geo_units g INNER JOIN descendants d ON g.parent_id = d.id
)
UPDATE geo_units SET status = $status WHERE id IN (SELECT id FROM descendants)
```
- تعطيل أب → يُعطّل كل أبنائه وأبناء أبنائه
- إعادة تفعيل أب → يُفعّل كل الأبناء (السلوك المتفق عليه)

**2. إلغاء المهام القائمة** — نفس endpoint `PATCH /:id/status` عند `status='inactive'`
- بعد UPDATE الـ geo units، نجمع كل IDs المتأثرة
- نُلغي `open_tasks` غير المنتهية عبر JOIN على `clients.neighborhood` أو `contracts.installation_geo_unit_id`:
```sql
UPDATE open_tasks SET status='cancelled',
  notes = COALESCE(notes,'')||' | إلغاء تلقائي — إيقاف العمل في المنطقة'
WHERE status NOT IN ('completed','closed','cancelled')
  AND (client IN affected_neighborhood OR contract IN affected_geo)
```
- حالات المهام النشطة: `open, needs_follow_up, assigned, in_scheduling, scheduled, waiting_execution, in_execution, ended`
- نُلغي أيضاً `field_visits` بحالة `scheduled`

**3. استبعاد inactive من نطاق الفرع** — `services/geoScopeService.ts`
- `effectiveCoveredIds`: تصفية الوحدات المعطّلة
- `buildServiceGeoIds`: تخطي الوحدة المعطّلة وكل أبنائها في الـ recursion:
```typescript
const addDescendants = (unitId: number) => {
  const unit = byId.get(unitId);
  if (!unit || unit.status === 'inactive') return; // ← يوقف الـ recursion كاملاً
  service.add(unitId);
  for (const child of childrenByParent.get(unitId) ?? []) addDescendants(child.id);
};
```

**4. منع تسجيل زبون جديد في منطقة معطّلة** — `routes/clients.ts` POST
```typescript
if (neighborhood) {
  const { rows } = await pool.query('SELECT status FROM geo_units WHERE id=$1', [neighborhood]);
  if (rows[0]?.status === 'inactive')
    return res.status(400).json({ error: 'لا يمكن تسجيل زبون في منطقة موقوفة العمل' });
}
```

**5. منع إنشاء مهمة جديدة في منطقة معطّلة** — `routes/openTasks.ts` POST + `routes/contracts.ts` POST
- للمهام المبنية على العميل: فحص `client.neighborhood` قبل INSERT
- للمهام المبنية على العقد: فحص `contract.installation_geo_unit_id` قبل INSERT

**ملاحظات التنفيذ:**
- الـ PATCH endpoint يحتاج transaction كاملة: BEGIN → cascade geo → cancel tasks → cancel visits → COMMIT
- يجب إرجاع عداد الوحدات المتأثرة والمهام الملغاة في الـ response للواجهة
- الواجهة تحتاج confirm modal قبل التعطيل تُظهر عدد الوحدات والمهام المتأثرة (يُحسب أولاً بـ dry-run query بدون commit)

---

### GAP-063: `branches.manage` يجمع صلاحيات بمستويات حساسية مختلفة — لا يوجد مستوى وسيط 🟡 متوسطة

| البند | التفصيل |
|---|---|
| **الكيان** | branches |
| **الموقع** | `packages/api/routes/branches.ts` + `migrations/permissions` |
| **الوصف** | `PUT /:id` كان يتطلب `branches.manage` لأي تعديل — سواء كان اسم + عنوان + تواصل (بيانات تشغيلية) أو نطاق التغطية + الحالة (تأثير على عزل البيانات والعمليات). مدير الفرع يحتاج تعديل معلومات التواصل بدون صلاحية إنشاء/حذف فروع أو تغيير نطاقها الجغرافي. |
| **التأثير** | إما يعطى مدير الفرع صلاحية كاملة (خطر أمني) أو لا يستطيع تعديل بياناته (عرقلة تشغيلية). |
| **الحل المقترح** | إضافة `branches.edit` كصلاحية وسيطة تسمح بتعديل الاسم والعنوان والتواصل فقط. |
| **الحالة** | ✅ محلول — `migrations/173_branches_edit_permission.sql` + `routes/branches.ts` |
| **ملف الدستور** | [branches.md §6](domains/branches.md#6-الصلاحيات-والأدوار) |

---

### GAP-067: Type Conflict in Employee Number between Migrations 🔴 عالية — **جديد**

| البند | التفصيل |
|---|---|
| **الكيان** | employees |
| **الموقع** | `migrations/017_employee_profiles.sql` & `migrations/017_employees_extended_profile.sql` |
| **الوصف** | يحدد المهجر الأول الحقل `employee_number` بنوع `BIGINT` بينما يعيد المهجر الثاني تعريفه بنوع `VARCHAR(50)` دون أي حماية أو فحص تكاملي. |
| **التأثير** | حدوث مشاكل وتوقف مفاجئ في الـ API وقاعدة البيانات عند مقارنة الأرقام وظيفياً، وتعطل واجهات البحث. |
| **الحل المقترح** | توحيد العمود بالكامل ليكون `BIGINT` وربطه بالمتسلسلة لضمان التوليد التلقائي الفريد. |
| **الحالة** | ⏳ مفتوحة |
| **ملف الدستور** | [employees.md §9.1](domains/employees.md#gap-067-type-conflict-in-employee-number-between-migrations-عالية-الخطورة) |

---

### GAP-068: Discrepancy between Legacy text `branch` and `branch_id` FK 🔴 عالية — **جديد**

| البند | التفصيل |
|---|---|
| **الكيان** | employees |
| **الموقع** | `migrations/001_core_tables.sql` & `migrations/013_multi_branch_identity.sql` |
| **الوصف** | بقاء الحقل النصي القديم `branch` (VARCHAR) متوازياً مع الحقل المرجعي الحقيقي `branch_id` (INTEGER REFERENCES branches) دون أي مزامنة أو حظر. |
| **التأثير** | إمكانية إدخال اسم فرع نصي لا يتطابق إطلاقاً مع معرف الفرع الفعلي للموظف، مما يتسبب بتشوش البيانات وفشل التقارير. |
| **الحل المقترح** | إسقاط الحقل النصي `branch` من جدول الموظفين نهائياً والاعتماد الكلي على `branch_id`. |
| **الحالة** | ⏳ مفتوحة |
| **ملف الدستور** | [employees.md §9.2](domains/employees.md#gap-068-discrepancy-between-legacy-text-branch-and-branch_id-عالية-الخطورة) |

---

### GAP-069: Missing Soft Delete on Employees 🟡 متوسطة — **جديد**

| البند | التفصيل |
|---|---|
| **الكيان** | employees |
| **الموقع** | `packages/api/routes/employees.ts` |
| **الوصف** | يمسح مسار الحذف الموظف فيزياياً بشكل نهائي من قاعدة البيانات طالما لا توجد قيود مباشرة، دون وجود حقل أرشفة `deleted_at`. |
| **التأثير** | ضياع الهوية والبيانات التشغيلية التاريخية للموظفين السابقين في التقارير المجمعة وسجلات المراقبة (Audit Logs). |
| **الحل المقترح** | إضافة حقل `deleted_at` وتفعيل الحذف الناعم (Soft Delete) بجميع مستودعات الموظفين. |
| **الحالة** | ⏳ مفتوحة |
| **ملف الدستور** | [employees.md §9.3](domains/employees.md#gap-069-missing-soft-delete-on-employees-متوسطة) |

---

### GAP-070: Status Desynchronization in User Branch Assignments 🟡 متوسطة — **جديد**

| البند | التفصيل |
|---|---|
| **الكيان** | employees / branches |
| **الموقع** | `packages/api/services/userBranchAssignmentService.ts` |
| **الوصف** | غياب آلية أوتوماتيكية تعطل الفروع المرتبطة بالموظف الموقوف مؤقتاً أو المفصول بـ `user_branch_assignments` عند تغيير حالته بـ `employees` أو `hr_users`. |
| **التأثير** | بقاء تخصيصات الفروع نشطة للموظفين المعطلين بالداتابيز، مما يشوه تقارير الموارد البشرية وتوزيع الموظفين. |
| **الحل المقترح** | كتابة trigger أو Hook يقوم بتحديث `user_branch_assignments.status = 'inactive'` تلقائياً عند تعطيل حساب الموظف. |
| **الحالة** | ⏳ مفتوحة |
| **ملف الدستور** | [employees.md §9.4](domains/employees.md#gap-070-status-desynchronization-in-user-branch-assignments-متوسطة) |

---

### GAP-071: Operational Role Ambiguity in System Models 🟡 متوسطة — **جديد**

| البند | التفصيل |
|---|---|
| **الكيان** | employees / hr_users |
| **الموقع** | `employees.role` VS `hr_users.role` VS `hr_users.role_id` |
| **الوصف** | تشتت مفهوم الدور بنية الكود: دور فني بالموظف (لتسجيل المهام)، ودور نصي بالمستخدم، ودور فيزيائي حقيقي مربوط بالصلاحيات بجدول الأدوار `roles`. |
| **التأثير** | إمكانية منح الموظف صلاحية محاسب أو مدير فرع بالدخول بينما هو فني بسيط بالمهام، مما يحدث ثغرات أمنية وتعارضاً بالصلاحيات. |
| **الحل المقترح** | توحيد مرجعية الأدوار بالكامل والاعتماد المطلق على معرف الأدوار المربوط بالصلاحيات `role_id`. |
| **الحالة** | ⏳ مفتوحة |
| **ملف الدستور** | [employees.md §9.5](domains/employees.md#gap-071-operational-role-ambiguity-in-system-models-متوسطة) |

---

### GAP-072: Absence of Audit Trails for Employee Profile Changes 🟡 متوسطة — **جديد**

| البند | التفصيل |
|---|---|
| **الكيان** | employees |
| **الموقع** | `packages/api/routes/employees.ts` |
| **الوصف** | خلو عمليات تحديث الموظف بالكامل (معلومات السكن، أرقام التواصل، تفاصيل الخبرة) من تسجيل ورقابة التغييرات بنظام الـ Audit Trail العام للشركة. |
| **التأثير** | عدم القدرة على تحديد المسؤول عن تعديل تواريخ مباشرة العمل أو تغيير العنوان الجغرافي للموظفين بشكل احتيالي. |
| **الحل المقترح** | ربط عمليات التعديل والـ PUT للموظفين بجدول المراقبة العام `audit_logs` مع تسجيل القيم القديمة والجديدة. |
| **الحالة** | ⏳ مفتوحة |
| **ملف الدستور** | [employees.md §9.6](domains/employees.md#gap-072-absence-of-audit-trails-for-employee-profile-changes-متوسطة) |

### GAP-073: Branch Access Check Missing on Sub-Resource GET Endpoints 🟢 منخفضة — **جديد**

| البند | التفصيل |
|---|---|
| **الكيان** | field_visits |
| **الموقع** | `packages/api/routes/fieldVisits.ts` — أسطر 521, 577, 1123, 1272 |
| **الوصف** | مسارات الطفرة (start, end, complete, name-collection إلخ) تفحص `branch_id` وتُرجع 403 إذا كانت الزيارة لفرع مختلف. لكن 4 مسارات قراءة فرعية (`GET /:id/geo`, `GET /:id/source`, `GET /name-collections/:id`, `GET /visit-tasks/:taskId/direct-suggestions`) لا تجري أي فحص للفرع. |
| **التأثير** | مستخدم من فرع (أ) يستطيع قراءة بيانات جغرافية وأسماء وترشيحات لزيارات فرع (ب) إذا عرف المعرف. |
| **الحل المقترح** | إضافة JOIN بـ `field_visits` للتحقق من `branch_id` في هذه المسارات الأربعة. مؤجل. |
| **الحالة** | ⏳ مفتوحة — مؤجل |
| **ملف الدستور** | [field-visits.md §9](domains/field-visits.md#9-الثغرات-والتضاربات-المكتشفة-gaps--contradictions) |

### GAP-074: ClientAvatar dataQuality mapping mismatch — DB values vs UI expectations 🟢 منخفضة — **جديد**

|| البند | التفصيل |
||---|---|
|| **الكيان** | clients / shared UI |
|| **الموقع** | `packages/api/routes/clients.ts` (SELECT `data_quality`) vs `packages/web/src/components/ClientAvatar.tsx` |
|| **الوصف** | الـ DB بيخزّن `data_quality` بقيم: `Complete` / `Partial` / `Minimal`. بس المكوّن `ClientAvatar.tsx` بيتوقع `dataQuality` بقيم: `correct` / `incorrect` / `needs_edit`. الـ API بيرجّع القيم من الـ DB بدون mapping — فالقيم ما عم تتطابق أبداً. |
|| **التأثير** | كل الأفاتارات بالـ UI بيظهرو باللون الرمادي الافتراضي (`bg-slate-100`) حتى لو `data_quality = "Complete"`. المستخدم ما عم يستفيد من نظام ألوان صحة البيانات. |
|| **الحل المقترح** | خياران: (أ) تعديل `ClientAvatar.tsx` ليقبل القيم الـ DB مباشرة (`Complete` → أخضر، `Partial` → أصفر، `Minimal` → أحمر). (ب) تعديل الـ API (`routes/clients.ts`) ليعمل mapping من DB → UI قبل ما يرجّع الـ JSON. **التوصية: (أ)** — لأنه أبسط وما بيأثر على API contract. |
|| **الحالة** | ⏳ مفتوحة |
|| **ملف الدستور** | [client-snapshot.md §قواعد الأفاتار](components/client-snapshot.md#قواعد-الأفاتار-avatar) |

---

## الثغرات المحلولة (Resolved Gaps)

| الرقم | الكيان | الوصف | تاريخ الحل | الملفات المتأثرة |
|---|---|---|---|---|
| GAP-035 | geo_units | إضافة CHECK constraint على `level IN (1,2,3,4)` | 2026-05-24 | `migrations/168_geo_units_constraints.sql` |
| GAP-036 | geo_units | فحص هرمي `parent.level = child.level - 1` في POST handler | 2026-05-24 | `packages/api/routes/geoUnits.ts` |
| GAP-037 | geo_units | إضافة `GET /:id` + `PUT /:id` (تعديل الاسم فقط) | 2026-05-24 | `packages/api/routes/geoUnits.ts` |
| GAP-039 | geo_units | استبدال `ON DELETE CASCADE` بـ `ON DELETE RESTRICT` + معالجة 23503 | 2026-05-24 | `migrations/168_geo_units_constraints.sql` + `geoUnits.ts` |
| GAP-038 | branches / geo_units | استبدال `covered_geo_ids` JSONB بجدول `branch_geo_coverage` مع FK | 2026-05-24 | `migrations/169_branch_geo_coverage_table.sql` + `geoScopeService.ts` + `branches.ts` |
| GAP-003 | clients | تحويل `governorate`, `district`, `neighborhood` من VARCHAR → INTEGER FK → geo_units | 2026-05-24 | `migrations/170_clients_geo_integer.sql` + `routes/clients.ts` |
| GAP-034 | employees | حذف `employees.residence` النصي — أعمدة `residence_*_id` FK كانت موجودة بالفعل | 2026-05-24 | `migrations/171_drop_employees_residence_text.sql` + `routes/adminApplications.ts` |
| GAP-045 | branches | استبدال `requireAuth` بـ `requirePermission('branches.view')` على GET / وGET /:id | 2026-05-24 | `routes/branches.ts` |
| GAP-046 | branches | استبدال `covered_geo_ids` JSONB بـ `branch_geo_coverage` junction table مع CASCADE | 2026-05-24 | `migrations/169_branch_geo_coverage_table.sql` + `branches.ts` + `geoScopeService.ts` |
| GAP-047 | branches | التحقق من بنية `contact_info` (type/department/value) في POST وPUT | 2026-05-25 | `routes/branches.ts` |
| GAP-049 | clients / contracts / open_tasks | منع إنشاء سجلات لفرع inactive | 2026-05-25 | `routes/clients.ts` + `routes/contracts.ts` + `routes/openTasks.ts` |
| GAP-063 | branches | إضافة `branches.edit` كمستوى وسيط بين `branches.view` و`branches.manage` | 2026-05-25 | `migrations/173_branches_edit_permission.sql` + `routes/branches.ts` |
| GAP-064 | open_tasks | تعريب رسائل الخطأ في POST / (`clientId`، `branchId`، `reason`) | 2026-05-25 | `routes/openTasks.ts` |
| GAP-065 | open_tasks | إضافة validation لـ `taskFamily` و`taskType` في POST / قبل الوصول للـ DB | 2026-05-25 | `routes/openTasks.ts` |
| GAP-066 | open_tasks | توثيق §7 API Contract الكامل — الدستور كان يوثق 4 endpoints من أصل 20 | 2026-05-25 | `docs/constitution/domains/open-tasks.md §7` |
| GAP-017 | open_tasks | استبدال `marketing_visits.*` بـ `open_tasks.view/edit` في openTasks.ts (محلول جزئي) | 2026-05-25 | `migrations/174_open_tasks_permissions.sql` + `routes/openTasks.ts` |
| GAP-027 | field_visits | استبدال 12 × `marketing_visits.*` بـ `field_visits.view/edit` في fieldVisits.ts | 2026-05-25 | `migrations/175_field_visits_permissions.sql` + `routes/fieldVisits.ts` |
| GAP-074 | dues / contracts | إضافة `requireAuth` + `requirePermission` + branch filter على `dues.ts` — كان مفتوح للعالم | 2026-05-25 | `routes/dues.ts` |
| GAP-075 | contracts | إضافة `authorize()` branch check على `GET /api/contracts/:id` — كان يكشف عقود فروع أخرى | 2026-05-25 | `routes/contracts.ts` |
| GAP-050 | device_models / spare_parts | `requirePermission('catalog.manage')` على الكتابة + `requireAuth` على القراءة | 2026-05-25 | `routes/deviceModels.ts` + `routes/spareParts.ts` |
| GAP-051 | device_discounts | `requirePermission('devices.discounts.manage')` على POST/PUT/DELETE الخصومات | 2026-05-25 | `routes/deviceModels.ts` |
| GAP-052 | device_models / spare_parts | soft-delete عبر `deleted_at` + فلترة `WHERE deleted_at IS NULL` | 2026-05-25 | `migrations/180` + `routes/deviceModels.ts` + `routes/spareParts.ts` |
| GAP-054 | device_discounts | فحص التداخل الزمني `start_date <= endDate AND end_date >= startDate` في POST وPUT | 2026-05-25 | `routes/deviceModels.ts` |
| GAP-055 | visit_task_device_demo_results | إضافة `offered_device_model_id FK → device_models` | 2026-05-25 | `migrations/179_device_demo_offered_model.sql` |
| GAP-057 | visit_task_device_activation_results | إنشاء الجدول بحقول tds_before/after, pump_pressure, uv_status, customer_trained | 2026-05-25 | `migrations/181_device_activation_results.sql` |
| GAP-059 | device_models | تصحيح category default من `'صناعي'` → `'Industrial'` | 2026-05-25 | `routes/deviceModels.ts:42` |
| GAP-060 | contracts | توسيع `device_status` CHECK: إضافة faulty/retrieved/disconnected/under_maintenance | 2026-05-25 | `migrations/178_device_status_extend.sql` |
| GAP-061 | device_models | `UNIQUE INDEX ON device_models(code) WHERE code IS NOT NULL` | 2026-05-25 | `migrations/177_device_code_unique.sql` |

---

## قرارات معلقة (Pending Architectural Decisions)

### قرار 1: هل الزبون يكون "مشترك بين فروع"؟

| الخيار | الميزات | العيوب | التكلفة |
|---|---|---|---|
| **A. Cross-branch lookup** (read-only search) | بسيط، ما بيكسر architecture | الزبون لساته "تابع لفرع واحد" بالـ DB | 2-3 prompts |
| **B. Primary + shared visibility** | حمص بتنشئ عقد + دمشق بتتابع زبونها | تعقيد بالـ reporting (من بيحسب الزبون؟) | 3-5 prompts |
| **C. Full multi-branch client** | الزبون بيصير "تابع لعدة فروع" | إعادة هيكلة كبيرة لـ ownership + reporting + dashboard | 12-18 prompts |

**التوصية الحالية:** خيار A لأنه بيحل 80% من المشكلة بـ 20% من التكلفة.

**المطلوب:** قرار من Product Owner (إبراهيم) — هل بدّنا A ولا B ولا C؟

---

### GAP-DS-001: JSONB teams/solos lacks FK validation 🔴 عالية — **جديدة**

| البند | التفصيل |
|---|---|
| **الكيان** | day_schedules |
| **الموقع** | `migrations/001_core_tables.sql` (الحقلان `teams` و `solos`) |
| **الوصف** | لا يملك `teams` و `solos` (JSONB) أي FK validation للـ `employees.id`. يمكن حفظ IDs غير موجودة إذا تم تجاوز API أو إدخال مباشر. |
| **التأثير** | نزاعة جدولة تالفة → أهداف تأشيرية تالفة → مهام مسندة لفريق غير موجود |
| **الحل المقترح** | إضافة validation trigger على `day_schedules` أو استخدام جدول ربط منفصل لـ `team_members` |
| **الحالة** | ⏳ مفتوحة |
| **ملف الدستور** | [day-schedules.md §9.1](domains/day-schedules.md#gap-ds-001) |

### GAP-DS-002: Missing created_by / updated_at / created_at on day_schedules 🟡 متوسطة — **جديدة**

| البند | التفصيل |
|---|---|
| **الكيان** | day_schedules |
| **الموقع** | `migrations/001_core_tables.sql` |
| **الوصف** | لا يوجد `created_by` أو `updated_at` أو `created_at` على `day_schedules`. لا أرشيف للتغييرات. |
| **التأثير** | صعوبة تدقيق الأخطاء — ما فينا نعرف مين حفظ أو حذف جدول |
| **الحل المقترح** | إضافة `created_by`, `created_at`, `updated_at` على `day_schedules` |
| **الحالة** | ⏳ مفتوحة |
| **ملف الدستور** | [day-schedules.md §9.2](domains/day-schedules.md#gap-ds-002) |

### GAP-DS-003: solos JSONB lacks CHECK constraint 🟡 متوسطة — **جديدة**

| البند | التفصيل |
|---|---|
| **الكيان** | day_schedules |
| **الموقع** | `migrations/001_core_tables.sql` |
| **الوصف** | `solos` لا يملك `CHECK constraint` — يمكن حفظ أي JSON |
| **التأثير** | تلف البيانات التشغيلية للفرق الميدانية |
| **الحل المقترح** | إضافة JSON Schema validation على السيرفر أو trigger |
| **الحالة** | ⏳ مفتوحة |
| **ملف الدستور** | [day-schedules.md §9.3](domains/day-schedules.md#gap-ds-003) |

### GAP-DS-004: schedules.ts missing requirePermission('planning.manage') 🔴 عالية — **جديدة**

| البند | التفصيل |
|---|---|
| **الكيان** | day_schedules |
| **الموقع** | `packages/api/routes/schedules.ts` |
| **الوصف** | `GET /schedules/:date` و `PUT /schedules/:date` لا يفرضان `requirePermission('planning.manage')` |
| **التأثير** | أي مستخدم مسجّل بيقدر يجلب/يحفظ جداول الفرق |
| **الحل المقترح** | إضافة `requirePermission('planning.manage')` على المسارات |
| **الحالة** | ⏳ مفتوحة |
| **ملف الدستور** | [day-schedules.md §9.4](domains/day-schedules.md#gap-ds-004) |

### GAP-DS-005: day_schedules lacks branch_id 🟡 متوسطة — **جديدة**

| البند | التفصيل |
|---|---|
| **الكيان** | day_schedules |
| **الموقع** | `migrations/001_core_tables.sql` |
| **الوصف** | `date` هو المفتاح الأساسي الوحيد. لو فرعين بدون التاريخ ـ تضارب! |
| **التأثير** | فرع أ و فرع ب مش يقدروا يحفظوا جدول اليوم لنفس التاريخ |
| **الحل المقترح** | إضافة `branch_id` مع `UNIQUE (date, branch_id)` أو `date` = `{branch_id}_{YYYY-MM-DD}` |
| **الحالة** | ⏳ مفتوحة |
| **ملف الدستور** | [day-schedules.md §9.5](domains/day-schedules.md#gap-ds-005) |

### GAP-DS-006: GET /schedules/:date returns 200 instead of 404 🟡 متوسطة — **جديدة**

| البند | التفصيل |
|---|---|
| **الكيان** | day_schedules |
| **الموقع** | `packages/api/routes/schedules.ts` (GET /:date) |
| **الوصف** | بيرجع `200` مع جدول فارغ بدل `404` |
| **التأثير** | تضارب بين السلوك المتوقع والحالي |
| **الحل المقترح** | تعديل GET handler ليرجع `404` إذا ما في سجل |
| **الحالة** | ⏳ مفتوحة |
| **ملف الدستور** | [day-schedules.md §9.6](domains/day-schedules.md#gap-ds-006) |

### GAP-DS-007: Missing created_at on save 🟡 متوسطة — **جديدة**

| البند | التفصيل |
|---|---|
| **الكيان** | day_schedules |
| **الموقع** | `packages/api/routes/schedules.ts` (PUT /:date) |
| **الوصف** | الـ upsert ما بيسجّل `created_at`. لا يوجد جدول `schedules` legacy. |
| **التأثير** | تلف تاريخ الإنشاء |
| **الحل المقترح** | إضافة `created_at` على `day_schedules` |
| **الحالة** | ⏳ مفتوحة |
| **ملف الدستور** | [day-schedules.md §9.7](domains/day-schedules.md#gap-ds-007) |

### GAP-RA-001: `routes[].routeId` لا يملك FK validation 🔴 عالية — **جديدة**

|| البند | التفصيل |
|---|---|---|
| **الكيان** | route_assignments |
| **الموقع** | `migrations/001_core_tables.sql` + `routeAssignments.ts` |
| **الوصف** | `route_assignments.routes` JSONB يخزّن `routeId` بدون FK validation إلى `routes.id`. يمكن حفظ معرّف مسار غير موجود. |
| **التأثير** | توزيع مسار يشير إلى مسار محذوف أو غير موجود → كسر منطق التخطيط |
| **الحل المقترح** | validation trigger عند الحفظ أو استعلام JOIN للتحقق |
| **الحالة** | ⏳ مفتوحة |
| **ملف الدستور** | [route-assignments.md §9.1](domains/route-assignments.md#gap-ra-001) |

### GAP-RA-002: `extra_zones` و `station_order` بدون FK إلى `geo_units` 🔴 عالية — **جديدة**

|| البند | التفصيل |
|---|---|---|
| **الكيان** | route_assignments |
| **الموقع** | `migrations/001_core_tables.sql` |
| **الوصف** | مصفوفتا `extra_zones` و`station_order` JSONB تخزّنان `geo_unit_id` بدون FK validation. |
| **التأثير** | مناطق جغرافية غير موجودة في التوزيع → فشل في عزل النطاق |
| **الحل المقترح** | validation عند الحفظ أو جدول ربط منفصل |
| **الحالة** | ⏳ مفتوحة |
| **ملف الدستور** | [route-assignments.md §9.2](domains/route-assignments.md#gap-ra-002) |

### GAP-RA-003: `GET /route-assignments` لا يُطبّق فلترة بالفرع 🟡 متوسطة — **جديدة**

|| البند | التفصيل |
|---|---|---|
| **الكيان** | route_assignments |
| **الموقع** | `packages/api/routes/routeAssignments.ts` (GET /) |
| **الوصف** | المسار يُرجع كل التوزيعات من كل الفروع بدون فلترة بالفرع الفعّال. |
| **التأثير** | تسريب بيانات توزيع مسارات فروع أخرى |
| **الحل المقترح** | إضافة فلترة حسب `actingBranchId` أو استخلاص `branch_id` من `key` |
| **الحالة** | ⏳ مفتوحة |
| **ملف الدستور** | [route-assignments.md §9.3](domains/route-assignments.md#gap-ra-003) |

### GAP-RA-004: `syncAssignedTasks` في transaction منفصلة عن UPSERT 🟡 متوسطة — **جديدة**

|| البند | التفصيل |
|---|---|---|
| **الكيان** | route_assignments |
| **الموقع** | `packages/api/routes/routeAssignments.ts` (PUT /:key) |
| **الوصف** | `route_assignments` يُحفظ في pool ثم `syncAssignedTasks` يُشغّل في pgClient transaction منفصلة. فشل المزامنة لا يُرجع الحفظ. |
| **التأثير** | حالة عدم تطابق: توزيع محفوظ لكن المهام غير مُسنَدة |
| **الحل المقترح** | دمج الحفظ والمزامنة في transaction واحدة أو تطبيق compensating transaction |
| **الحالة** | ⏳ مفتوحة |
| **ملف الدستور** | [route-assignments.md §9.4](domains/route-assignments.md#gap-ra-004) |

### GAP-RO-001: `route_points.geo_unit_id` لا يملك FK 🔴 عالية — **جديدة**

|| البند | التفصيل |
|---|---|---|
| **الكيان** | route_points |
| **الموقع** | `migrations/001_core_tables.sql` |
| **الوصف** | `geo_unit_id` في `route_points` لا يملك FK إلى `geo_units(id)`. |
| **التأثير** | نقاط مسار تشير إلى وحدات جغرافية محذوفة → بيانات يتيمة |
| **الحل المقترح** | `ALTER TABLE route_points ADD FOREIGN KEY (geo_unit_id) REFERENCES geo_units(id)` |
| **الحالة** | ⏳ مفتوحة |
| **ملف الدستور** | [routes.md §9.1](domains/routes.md#gap-ro-001) |

### GAP-RO-002: لا يوجد `UNIQUE(route_id, point_order)` 🟡 متوسطة — **جديدة**

|| البند | التفصيل |
|---|---|---|
| **الكيان** | route_points |
| **الموقع** | `migrations/001_core_tables.sql` |
| **الوصف** | يمكن تكرار `point_order` لنفس `route_id` بدون قيد فريد. |
| **التأثير** | ترتيب مكرر → ارتباك في الواجهة والتخطيط |
| **الحل المقترح** | `CREATE UNIQUE INDEX idx_route_points_order ON route_points(route_id, point_order)` |
| **الحالة** | ⏳ مفتوحة |
| **ملف الدستور** | [routes.md §9.2](domains/routes.md#gap-ro-002) |

### GAP-RO-003: `routes.status` بدون CHECK constraint 🟡 متوسطة — **جديدة**

|| البند | التفصيل |
|---|---|---|
| **الكيان** | routes |
| **الموقع** | `migrations/001_core_tables.sql` |
| **الوصف** | `status VARCHAR(50)` بدون CHECK — القيم المتوقعة `active`/`inactive` غير مقيّدة. |
| **التأثير** | قيم عشوائية تُخزّن بدون رفض |
| **الحل المقترح** | `ALTER TABLE routes ADD CHECK (status IN ('active', 'inactive'))` |
| **الحالة** | ⏳ مفتوحة |
| **ملف الدستور** | [routes.md §9.3](domains/routes.md#gap-ro-003) |

### GAP-RO-004: `GET /routes` يقبل pagination params لكن لا يُطبّقها 🟢 منخفضة — **جديدة**

|| البند | التفصيل |
|---|---|---|
| **الكيان** | routes |
| **الموقع** | `packages/api/routes/routes.ts` (GET /) |
| **الوصف** | الـ endpoint يقبل `page` و`limit` كـ query params لكن الـ SQL لا يستخدم `LIMIT`/`OFFSET`. |
| **التأثير** | params زائدة — لا تأثير فعلي |
| **الحل المقترح** | إضافة LIMIT/OFFSET أو إزالة params من Swagger |
| **الحالة** | ⏳ مفتوحة |
| **ملف الدستور** | [routes.md §9.4](domains/routes.md#gap-ro-004) |

---

## كيف نضيف ثغرة جديدة

```markdown
### GAP-XXX: [عنوان مختصر]

| البند | التفصيل |
|---|---|
| **الكيان** | [اسم الكيان] |
| **الموقع** | [ملف:سطر] |
| **الوصف** | [شرح التضارب أو القصور] |
| **التأثير** | [شو بيصير إذا ما حلّينا] |
| **الحل المقترح** | [اقتراح] |
| **الحالة** | ⏳ مفتوحة / ✅ محلولة |
| **ملف الدستور** | [رابط] |
```

---

## إحصائيات سريعة

|| | |
|---|---|---|
|| **عدد الثغرات المفتوحة** | 56 |
|| **عدد الثغرات المحلولة** | 32 |
|| **عالية الخطورة** | 10 (GAP-001, GAP-002, GAP-006, GAP-012, GAP-022, GAP-056, GAP-062, GAP-067, GAP-068, GAP-DS-001, GAP-DS-004, GAP-RA-001, GAP-RA-002, GAP-RO-001) |
|| **متوسطة** | 26 (GAP-005, GAP-007, GAP-008, GAP-009, GAP-013, GAP-014, GAP-015, GAP-018, GAP-019, GAP-020, GAP-021, GAP-023, GAP-026, GAP-028, GAP-029, GAP-032, GAP-042, GAP-044, GAP-053, GAP-058, GAP-069, GAP-070, GAP-071, GAP-072, GAP-DS-002, GAP-DS-003, GAP-DS-005, GAP-DS-006, GAP-DS-007, GAP-RA-004, GAP-RO-002, GAP-RO-003) |
|| **منخفضة** | 18 (GAP-004, GAP-010, GAP-011, GAP-016, GAP-024, GAP-025, GAP-030, GAP-031, GAP-033, GAP-040, GAP-041, GAP-043, GAP-048, GAP-073, GAP-RO-004) |
|| **الكيان الأكثر ثغرات** | field_visits (7) / permissions (6) / contracts (6) / employees (6) / open_tasks (5) / telemarketing (5) / clients (5) / candidates (5) / day_schedules (7) / devices-maintenance (3) / branches (1) / geo_units (1) / route_assignments (4) / routes (4) |
|| **قرارات معلقة** | 1 (multi-branch client) + 1 (contract ownership DEC-002) |
