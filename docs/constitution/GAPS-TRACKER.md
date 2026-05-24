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
| **التأثير** | ما بيقدر أي admin يعطي صلاحية ASSIGNED للزبائن — فنظام الملكية الفردية (personal ownership) ما بيشتغل |
| **الحل المقترح** | عدّل `054_permissions_allowed_scopes.sql` ليضيف `'ASSIGNED'` لـ `clients.view`, `clients.view_list`, `clients.edit` |
| **الحالة** | ⏳ مفتوحة |
| **ملف الدستور** | [clients.md §9.2](domains/clients.md#92-الثغرة-الثانية) |

### GAP-003: Geo fields stored as VARCHAR not INTEGER 🟡 متوسطة

| البند | التفصيل |
|---|---|
| **الكيان** | clients |
| **الموقع** | `migrations/001_core_tables.sql` (clients.governorate, district, neighborhood) |
| **الوصف** | `governorate`, `district`, `neighborhood` مخزنة كـ `VARCHAR(255)` بس هي فعلياً `geo_units.id` (INTEGER). Migration `167` بيعمل `::int` casting قسري. |
| **التأثير** | ممكن يتخزن نص غير رقمي → بيكسر الـ queries اللي بتحتاج joining مع `geo_units` |
| **الحل المقترح** | ALTER TABLE → `INTEGER` + `FK → geo_units(id)` + `ON DELETE RESTRICT` |
| **الحالة** | ⏳ مفتوحة |
| **ملف الدستور** | [clients.md §9.3](domains/clients.md#93-الثغرة-الثالثة) |

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
| **ملف الدستور** | [candidates.md §9.3](domains/candidates.md#93-الثغرة-الثالثة) |

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

---

## الثغرات المحلولة (Resolved Gaps)

| الرقم | الكيان | الوصف | تاريخ الحل | ملاحظات |
|---|---|---|---|---|
| — | — | — | — | — |

*(ما فيه ثغرات محلولة لهلق — أول ما يُحل واحد، ننقلو لهون)*

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

| | |
|---|---|
| **عدد الثغرات المفتوحة** | 11 |
| **عالية الخطورة** | 3 (GAP-001, GAP-002, GAP-006) |
| **متوسطة** | 5 (GAP-003, GAP-005, GAP-007, GAP-008, GAP-009) |
| **منخفضة** | 3 (GAP-004, GAP-010, GAP-011) |
| **الكيان الأكثر ثغرات** | clients (5) / candidates (5) |
| **قرارات معلقة** | 1 (multi-branch client) |
