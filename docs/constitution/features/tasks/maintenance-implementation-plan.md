# المخطَّط التقني للتنفيذ — Emergency Maintenance V1.0

> **الغرض:** ترجمة قرارات [maintenance.md](./maintenance.md) إلى مراحل تنفيذ هندسية مُتسلسلة مع تَبعيات صريحة + معايير قبول + سيناريوهات تحقّق.
> **النطاق:** V1.0 — emergency_maintenance + قنوات داخلية فقط.
> **آخر تحديث:** 2026-06-04
> **سيناريوهات التحقّق:** [maintenance-test-scenarios.md](./maintenance-test-scenarios.md)

---

## المبادئ الحاكمة للتنفيذ

| المبدأ | المعنى التطبيقي |
|---|---|
| **No-break strategy** | الـ Wizard الحالي يَبقى عاملاً طوال التنفيذ. التحوُّل يَحدث تدريجياً، لا قطعة واحدة |
| **Schema قبل الكود** | كل migration تُنفَّذ + تُختبَر قبل أن يَعتمد عليها أي كود |
| **Feature Flag على البوابات** | الـ endpoints الجديدة خلف feature flag حتى التحقّق |
| **Backward compatibility 14 يوم** | كل تَغيير يُسبِّب breaking يَترك بديلاً 14 يوم staging stable قبل الحذف |
| **Audit log قبل البيانات** | جدول audit log يُنشأ في Phase 0 — قبل أي بيانات تُحفَظ |
| **Migrations مُرقَّمة** | كل migration بـ رقم تَسلسلي بعد آخر migration موجودة (يُحدَّد عند البدء) |

---

## المراحل (Phases)

### Phase 0 — Foundation (الأساس)

**الهدف:** بنية تحتية بدون أي تَغيير سلوكي.

#### Migrations
1. **`NNN_service_lists_categories.sql`**
   - INSERT في `system_lists` للفئات الجديدة:
     - `diagnosis_problem_types` (٠.١٩ + P-MAINT-12)
     - `service_partial_reasons` (المحور 10)
     - `service_unresolved_reasons` (المحور 10)
     - `reopen_reasons` (٠.٤.ب)
     - `emergency_uniqueness_override_reasons` (EM-UNIQ-04)
   - قيم seed minimal ("أخرى" + قيم أساسية).

2. **`NNN_service_requests_table.sql`**
   - CREATE TABLE `service_requests` بـ schema ٠.٧ كاملة.
   - CHECK constraints على status (6 حالات) + channel (7 قنوات) + submission_type + submitter_tier + device_source + triage_outcome.
   - UNIQUE على `public_ref_number WHERE archived_at IS NULL`.
   - Indexes ٠.٧ كلها.

3. **`NNN_service_request_audit_log_table.sql`**
   - CREATE TABLE `service_request_audit_log` بـ schema ٠.١٧.
   - CHECK على event_type (16+ events).
   - DB Trigger يَمنع UPDATE/DELETE (append-only).
   - FK `ON DELETE CASCADE` من `service_request_id`.

4. **`NNN_service_request_problems_table.sql`**
   - CREATE TABLE `service_request_problems` بـ schema ٠.١٩.ب كاملة.
   - CHECK على status (7 قيم) + added_during_phase (4 قيم).
   - Indexes ٠.١٩.ج كلها.
   - DB Trigger يَمنع تَغيير status من 'resolved' (EM-PROB-02) إلا بـ flag override.

5. **`NNN_open_task_emergency_payload_table.sql`**
   - CREATE TABLE `open_task_emergency_payload` بـ UNIQUE FK → open_tasks(id).
   - حقول: `source_service_request_id`, `reported_problem_snapshot`, `reported_action_type_id`.

6. **`NNN_open_tasks_source_service_request_fk.sql`**
   - ALTER `open_tasks` ADD `source_service_request_id INTEGER FK NULL`.
   - Index جزئي على القيم غير NULL.

7. **`NNN_pg_trgm_extension.sql`**
   - CREATE EXTENSION IF NOT EXISTS pg_trgm (للـ duplicate detection).
   - CREATE INDEX gin trgm على `service_requests.problem_description`.
   - CREATE INDEX على آخر 7 أرقام من phone.

8. **`NNN_system_settings_seed.sql`**
   - INSERT في `system_settings`:
     - `service_request_awaiting_auto_cancel_days = 7`
     - `service_request_duplicate_threshold = 0.75`
     - `service_request_duplicate_window_hours = 72`
     - `service_request_duplicate_phone_weight = 0.50`
     - `service_request_duplicate_device_weight = 0.25`
     - `service_request_duplicate_problem_weight = 0.25`

#### Deliverables
- 8 migrations مُختبرة في staging
- Schema جاهز ولكن **لا كود يَكتب أو يَقرأ منه بعد**
- اختبارات unit لـ CHECK constraints يَدوياً عبر psql

#### Validation
- اختبار INSERT/SELECT يدوي على كل جدول جديد
- اختبار duplicate detection بـ pg_trgm.similarity() على بيانات وهمية

#### Risks
- 🟡 conflict مع migrations جارية (يُحَلّ بترقيم آمن بعد فحص آخر رقم)
- 🟢 لا تأثير على الإنتاج (لا كود يستخدم الجداول الجديدة)

#### Effort
**S** (1-2 أيام)

---

### Phase 1 — Permissions & Roles (الصلاحيات)

**الهدف:** نموذج الصلاحية الثنائي قابلاً للاستخدام.

#### Migrations
1. **`NNN_service_requests_permissions.sql`**
   - INSERT في `permissions` للستة:
     - `service_requests.create` (BRANCH + GLOBAL)
     - `service_requests.view` (GLOBAL فقط)
     - `service_requests.review` (GLOBAL فقط)
     - `service_requests.reject` (GLOBAL فقط)
     - `service_requests.promote` (GLOBAL فقط)
     - `service_requests.archive` (GLOBAL فقط)

2. **`NNN_request_audit_admin_role.sql`**
   - INSERT في `roles` دور `request_audit_admin` (أو متفرّع من branch_manager).
   - INSERT في `role_permissions` للربط.

#### Backend
- middleware `requirePermission` يَدعم الصلاحيات الجديدة (يَجب أن يَدعمها أصلاً، فقط نَتأكَّد).
- Auth context يَحوي الصلاحيات الجديدة.

#### Deliverables
- 2 migrations
- ربط صلاحيات بأدوار `super_admin`, `branch_manager`, `request_audit_admin`

#### Validation
- SC-29 (BRANCH user محجوب)
- SC-30 (Operator لا يَستطيع reject)

#### Effort
**S** (نصف يوم)

---

### Phase 2 — Backend Services (الخدمات الأساسية)

**الهدف:** business logic مُنفصل عن endpoints.

#### Services
1. **`services/serviceRequests/createService.ts`**
   - `createServiceRequest({channel, requester, beneficiary?, problem_description, attachments?, ...})`
   - يُولِّد `public_ref_number` بـ تنسيق SR-YYYYMMDD-NNNN (atomic).
   - يَفحص duplicate ⇒ يُفعِّل flag.
   - يَكتب في audit log: `request_created`.
   - يَرجع service_request مع id + ref_number.

2. **`services/serviceRequests/stateMachine.ts`**
   - `transitionStatus(requestId, newStatus, actor, reason?)`
   - يَفرض قواعد SR-R001..R011.
   - يَكتب audit log: `status_changed`.

3. **`services/serviceRequests/claimService.ts`**
   - `claim(requestId, operatorId)` — SR-CLAIM-01.
   - `takeOver(requestId, newOperatorId, reason?)` — SR-CLAIM-02..03.
   - إشعار للـ owner السابق (notification بسيطة).

4. **`services/serviceRequests/problemsService.ts`**
   - `addProblem({requestId, problemTypeId, details, addedDuringPhase, createdByUserId})`.
   - `editProblem(problemId, updates)` — يَفرض مصفوفة الصلاحيات ٠.١٩.هـ.
   - `changeStatus(problemId, newStatus, recordedBy?, repairedBy?, visitTaskId?)`.
   - `softDelete(problemId, reason, actor)`.
   - `auditAdminOverride(problemId, newState, reason)` — EM-PROB-04.

5. **`services/serviceRequests/duplicateDetection.ts`**
   - `detectDuplicates(requestId)` — الخوارزمية ٠.١٥.أ.
   - يَستدعى آلياً بعد create.

6. **`services/serviceRequests/fuzzyMatching.ts`**
   - `suggestRecords(name, phone)` — للـ Suggested Records List.
   - يَستخدم pg_trgm + match على phone tail.

7. **`services/serviceRequests/promoteService.ts`**
   - `promote(requestId, operatorId)` — SR-R004 + SR-AUTH-02.
   - يَفحص: الـ beneficiary مربوط + الـ installed_device_id متوفّر.
   - يَفحص EM-UNIQ-01 ⇒ يَعرض شاشة قرار merge vs split.
   - يَدعم `external_device` بإنشاء installed_device خفيف (٠.١٣).
   - يُنشئ `open_task` + `open_task_emergency_payload`.
   - يَنقل الـ problems لـ open_task_id.
   - audit log: `promoted_to_task` أو `merged_into_existing_task`.

8. **`services/serviceRequests/reopenService.ts`**
   - `reopen(requestId, reason, actorRole)` — SR-REOPEN-01..05.
   - يَفرض قواعد per terminal type.

9. **`services/serviceRequests/cronAutoCancel.ts`**
   - cron يومي 22:00 لتنفيذ ٠.٤.ج.

10. **`services/serviceRequests/derivedOutcomeCalc.ts`**
    - `computeDerivedOutcome(openTaskId)` — ٠.١٩.ح.

#### Tests
- unit tests لكل service.
- integration tests لـ state transitions.

#### Deliverables
- 10 services مع unit coverage ≥ 70%.

#### Validation
- SC-01, SC-05, SC-06, SC-08, SC-11, SC-12, SC-16, SC-18, SC-19 (مع mocks للـ frontend)

#### Risks
- 🟡 race condition في توليد `public_ref_number` (يُحَلّ بـ transaction + retry)
- 🟡 race condition في duplicate detection (يُحَلّ بـ post-insert detection)

#### Effort
**L** (5-7 أيام)

---

### Phase 3 — REST Endpoints

**الهدف:** كَشف الخدمات للـ frontend عبر HTTP.

#### Endpoints (جميعها في `routes/serviceRequests.ts`)

| Method | Path | Permission | Service |
|---|---|---|---|
| POST | `/service-requests` | `service_requests.create` | `createService` |
| POST | `/service-requests/internal` | `service_requests.create` | `createService` بـ in_review مباشرة |
| GET | `/service-requests` | `service_requests.view` | list مع filters |
| GET | `/service-requests/:id` | `service_requests.view` | full details + audit log + problems |
| POST | `/service-requests/:id/claim` | `service_requests.review` | `claimService.claim` |
| POST | `/service-requests/:id/take-over` | `service_requests.review` | `claimService.takeOver` |
| POST | `/service-requests/:id/link` | `service_requests.review` | يَربط beneficiary + audit |
| POST | `/service-requests/:id/change-linkage` | `service_requests.review` | SR-CAND-01 |
| GET | `/service-requests/:id/suggested-matches` | `service_requests.review` | `fuzzyMatching.suggestRecords` |
| POST | `/service-requests/:id/request-info` | `service_requests.review` | → `awaiting_customer_info` |
| POST | `/service-requests/:id/resume-review` | `service_requests.review` | → `in_review` |
| POST | `/service-requests/:id/resolve-at-intake` | `service_requests.review` | + triage_outcome |
| POST | `/service-requests/:id/escalate` | `service_requests.review` | يُفعِّل review_required_flag |
| POST | `/service-requests/:id/reject` | `service_requests.reject` | Audit Admin only |
| POST | `/service-requests/:id/promote` | `service_requests.promote` | `promoteService` |
| POST | `/service-requests/:id/merge` | `service_requests.promote` | EM-UNIQ-03 |
| POST | `/service-requests/:id/cancel` | `service_requests.review` | admin-initiated |
| POST | `/service-requests/:id/archive` | `service_requests.archive` | soft archive |
| POST | `/service-requests/:id/unarchive` | `service_requests.archive` | SR-REOPEN-05 |
| POST | `/service-requests/:id/reopen` | حسب terminal | SR-REOPEN-01..05 |
| POST | `/service-requests/:id/problems` | حسب مرحلة | `problemsService.add` |
| PATCH | `/service-requests/:id/problems/:pid` | حسب مرحلة | edit details/type |
| PATCH | `/service-requests/:id/problems/:pid/status` | حسب مرحلة | change status |
| POST | `/service-requests/:id/problems/:pid/record-resolution` | حسب مرحلة | تسجيل نتيجة (recorded_by + repaired_by) |
| DELETE | `/service-requests/:id/problems/:pid` | حسب مرحلة | soft delete + reason |
| POST | `/service-requests/:id/problems/:pid/restore` | `service_requests.reject` | Audit Admin |
| POST | `/service-requests/:id/problems/:pid/override` | `service_requests.reject` | Audit Admin بعد visit closed |
| GET | `/open-tasks/:id/problems` | `open_tasks.view` | لائحة أعطال المهمة |
| GET | `/open-tasks/:id/derived-outcome` | `open_tasks.view` | محسوب |

#### Deliverables
- ~28 endpoint مَكتوبَة مع JSDoc.
- API tests لـ سيناريوهات الـ scenarios.

#### Validation
- SC-01, SC-02, SC-05..18, SC-20..23 (full E2E عبر HTTP)

#### Risks
- 🟡 permission enforcement consistency (يُحَلّ بـ middleware tests)

#### Effort
**L** (4-5 أيام)

---

### Phase 4 — Frontend: Service Requests Dashboard

**الهدف:** شاشة GLOBAL مركزية للـ Operator + Audit Admin.

#### Components
1. **`pages/service-requests/ServiceRequestsListPage.tsx`**
   - جدول الـ requests مع filters: status, duplicate, review_required, archived.
   - عمود `overdue` badge محسوب من `created_at`.
   - زر "تولّي" على requests غير المُتَولّاة.

2. **`pages/service-requests/ServiceRequestDetailPage.tsx`**
   - Tabs: Overview / Problems / Audit Log / Linked Open Task.
   - أزرار حسب الحالة: claim, request-info, resolve-at-intake, escalate, promote, reject, cancel, archive.

3. **`components/service-requests/ProblemsList.tsx`**
   - عرض اللائحة مع status badges.
   - زر "إضافة عطل" — modal مع dropdown من `system_lists.diagnosis_problem_types`.
   - زر "تعديل" و "حذف" — حسب مصفوفة الصلاحيات.
   - بادج "مُكتشَف في الميدان" للـ field_discovery.

4. **`components/service-requests/SuggestedMatchesPanel.tsx`**
   - يَعرض Fuzzy matches مع confidence levels.
   - زر "ربط" + زر "إنشاء Candidate جديد".

5. **`components/service-requests/MergeOrSplitModal.tsx`**
   - عند promote، إذا EM-UNIQ-01 يُفعَّل ⇒ شاشة قرار dual choice.
   - "دمج مع المهمة القائمة" أو "افتح طلب منفصل" + سبب + escalate.

6. **`components/service-requests/AuditLogTimeline.tsx`**
   - عرض الـ audit log زمنياً.

#### Deliverables
- 6 صفحات/components + routing.

#### Validation
- SC-01, SC-03, SC-13, SC-14, SC-18, SC-19, SC-20..23 (UI walkthrough)

#### Effort
**L** (5-6 أيام)

---

### Phase 5 — Frontend: Integration مع نقاط الإدخال الموجودة

**الهدف:** توصيل الـ floating button + زر تفاصيل الزبون بالنظام الجديد.

#### Changes
1. **Floating button (`internal_button` channel):**
   - يَفتح modal لإنشاء service_request.
   - يُحدِّد `channel='internal_button'`, `requester_user_id = current user`.
   - بعد الحفظ، يَنقل إلى ServiceRequestDetailPage.

2. **زر "إنشاء صيانة" من تفاصيل الزبون (`client_detail_button` channel):**
   - يَملأ آلياً `beneficiary_client_id`.
   - يَفتح modal مُختصَر (لا حاجة لـ walk-in fields).

3. **Phone channel (لأخذ المكالمات):**
   - شاشة سريعة لإدخال walk-in بسرعة + Suggested Matches فورية.

4. **`admin_manual` channel:**
   - من لوحة الأدمن، شاشة كاملة لإنشاء request للحالات الخاصة.

#### Backend
- لا تَغيير backend (يَستخدم endpoints المرحلة 3).

#### Deliverables
- 4 entry points مُتَّصلة.
- الـ pre-existing UI القديم (لو يَستدعي مباشرة `/open-tasks`) يَتحوّل لـ service_requests.

#### Validation
- SC-01 (client_detail_button), SC-03 (admin_manual للـ walk-in)

#### Risks
- 🟡 أيّ UI آخر يَستدعي endpoints قديمة يَحتاج تحديث (يُكتشف عبر grep)

#### Effort
**M** (3-4 أيام)

---

### Phase 6 — Visit Task Wizard Updates

**الهدف:** تَعديل الـ wizard ليُطبِّق لائحة الأعطال + derived_outcome.

#### Schema
1. **`NNN_visit_task_parts_used_problem_link.sql`**
   - ALTER `visit_task_emergency_parts_used` ADD `linked_problem_id INTEGER FK NULL` (ربط القطعة بعطل من اللائحة).

2. **`NNN_visit_task_results_resolution_metadata.sql`**
   - تأكُّد أن `visit_task_results` يَدعم `recorded_by` (موجود) + إضافة `repaired_by_employee_id INTEGER FK NULL` لو لم يَكن موجوداً.

#### Backend
1. **تعديل `routes/emergencyResult.ts`:**
   - Phase 2 endpoint يَستلم لائحة `problems_status_updates` بدل `actions_taken` فقط.
   - يَفعل INSERT/UPDATE على `service_request_problems` مع `resolution_visit_task_id`.
   - Phase 2 يَدعم إضافة problem جديد (Field Discovery).
   - Phase 4 endpoint يَحسب `derived_outcome` آلياً، لا يَأخذها من body.

2. **حذف منطق "needs_followup creates new task":**
   - في `CostsForm` على الـ frontend (Phase 6 frontend).
   - في الـ backend، إزالة الـ cascading code.

#### Frontend
1. **`EmergencyResultWizard.tsx`:** بدون تَغيير بنيوي (4 phases تَبقى).
2. **`MaintenanceActionsForm.tsx`:**
   - إضافة قسم "لائحة الأعطال" في الأعلى.
   - لكل عطل: status dropdown (resolved/deferred/unresolvable_field) + notes.
   - زر "إضافة عطل مُكتشَف" (Field Discovery).
   - حقل dropdown ربط القطعة بعطل (اختياري).
   - dropdowns منفصلَين لـ recorded_by و repaired_by.
3. **`CostsForm.tsx`:**
   - حذف array `DECISIONS` (الـ 4 خيارات اليدوية).
   - استبدالها بـ `derived_outcome` badge readonly.
   - حذف منطق `needs_followup` cascade.

#### Deliverables
- 2 migrations
- backend endpoints مُحدَّثة
- frontend wizard مُحدَّث

#### Validation
- SC-32, SC-33, SC-34, SC-35

#### Risks
- 🔴 الـ wizard مُستخدَم في الإنتاج — التغيير يُمكن أن يَكسر workflow قائم
- ميتيغيت: feature flag على المسار الجديد، الـ wizard القديم يَبقى متاحاً 14 يوم

#### Effort
**XL** (7-10 أيام)

---

### Phase 7 — Data Migration: emergency_tickets → service_requests

**الهدف:** هجرة بيانات الـ tickets القديمة.

#### Migration
1. **`NNN_migrate_emergency_tickets_to_service_requests.sql`**
   - SELECT FROM `emergency_tickets`.
   - INSERT INTO `service_requests` بـ:
     - `channel = 'phone'`
     - `status` مَنطقياً من `emergency_tickets.status` (mapping)
     - `requester_external` JSON من البيانات القديمة لو الـ client مجهول
     - `problem_description` من `problem_description`
     - `created_at` محفوظ
   - INSERT INTO `service_request_problems` بـ بند واحد لكل ticket من `action_type_id` + `problem_description`.

#### Verification
- COUNT في staging: قبل + بعد المُهاجَرَة = نفسه.
- spot-check 10 sample requests للـ data integrity.

#### Strategy
1. Staging: تشغيل المهاجَرَة، 7 أيام مراقبة.
2. Production: مُهاجَرَة في maintenance window (off-hours).
3. الـ frontend القديم لـ `emergency_tickets` يَبقى متاحاً read-only.

#### Deliverables
- 1 migration بـ verification queries.

#### Risks
- 🔴 data loss لو الـ mapping خاطئ
- ميتيغيت: backup كامل قبل المُهاجَرَة + rollback migration جاهز

#### Effort
**M** (3-4 أيام مع testing)

---

### Phase 8 — Legacy Cleanup

**الهدف:** إزالة الـ code/UI القديم بعد 14 يوم staging stable.

#### Steps
1. حذف `routes/emergencyTickets.ts` (read-only mode يَبقى لـ data access).
2. حذف UI القديم: `RequestEmergencyModal.tsx`، الـ list view القديمة.
3. حذف الـ DECISIONS array من CostsForm.
4. UPDATE `permissions` لإزالة الصلاحيات القديمة المُتروكة.
5. DROP TABLE `emergency_tickets` (في migration نهائية، فقط بعد تأكُّد من backups).

#### Validation
- typecheck على كل الـ code base.
- E2E tests كاملة.

#### Effort
**S** (1-2 يوم)

---

## ترتيب التَّبعيات

```
Phase 0 (Foundation)
    ↓
Phase 1 (Permissions)
    ↓
Phase 2 (Backend Services) ── يعتمد على Phase 0+1
    ↓
Phase 3 (REST Endpoints) ── يعتمد على Phase 2
    ↓
Phase 4 (Frontend Dashboard) ── يعتمد على Phase 3
    ↓        ↘
Phase 5     Phase 6 (Wizard)  ── يعتمد على Phase 3
    ↓        ↓
    └─→ Phase 7 (Data Migration) ── يعتمد على Phase 4+5+6 stable
            ↓
        Phase 8 (Cleanup) ── بعد 14 يوم
```

---

## التقدير الإجمالي

| المرحلة | الحجم | الأيام التقديرية |
|---|---|---|
| Phase 0 | S | 1-2 |
| Phase 1 | S | 0.5 |
| Phase 2 | L | 5-7 |
| Phase 3 | L | 4-5 |
| Phase 4 | L | 5-6 |
| Phase 5 | M | 3-4 |
| Phase 6 | XL | 7-10 |
| Phase 7 | M | 3-4 |
| Phase 8 | S | 1-2 |
| **المجموع** | — | **30-40 يوم تطوير** |

> ملاحظة: التقدير بدون buffer (testing + bug fixes + reviews). مع buffer realistic ≈ 50-60 يوم.

---

## مصفوفة المخاطر

| المخاطرة | الاحتمال | الأثر | ميتيغيت |
|---|---|---|---|
| race condition في `public_ref_number` | 🟡 متوسط | 🟡 collision | atomic transaction + retry |
| race condition في duplicate detection | 🟡 متوسط | 🟢 تَكرار سهل التصحيح | post-insert detection (٠.١٥.أ) |
| الـ wizard القديم يُكسَر | 🔴 عالي | 🔴 إنتاج معطَّل | feature flag + 14 يوم staging |
| Data loss في مُهاجَرَة `emergency_tickets` | 🟡 متوسط | 🔴 لا استرجاع | backup + rollback migration + spot-check |
| Operator يَفقد owner عند take-over دون قصد | 🟢 منخفض | 🟢 محل لوم تشغيلي | notification + audit log + UX confirmation |
| `cascading_during_visit` legacy code يُسبِّب bugs | 🟡 متوسط | 🟡 سلوك خاطئ | grep شامل + tests على Phase 6 |

---

## خطة الـ Rollback

| المرحلة | Rollback strategy |
|---|---|
| Phase 0 | DROP TABLES (لم يَكتب فيها كود بعد) |
| Phase 1 | DELETE permissions/roles الجديدة |
| Phase 2 | تَعطيل الـ services (لا تُستخدَم بعد) |
| Phase 3 | feature flag = OFF (الـ endpoints مُعطَّلة) |
| Phase 4-5 | feature flag على الـ UI الجديدة |
| Phase 6 | feature flag على المسار الجديد للـ wizard. الـ wizard القديم يُعاد تفعيله |
| Phase 7 | rollback migration: TRUNCATE الـ service_requests الجديدة المُهاجَرة (إن لم تَكن production data إضافية) |
| Phase 8 | غير قابلة للـ rollback — يَجب التأكُّد من stability قبلها |

---

## معايير القبول النهائية (Definition of Done)

قبل اعتبار V1.0 جاهزاً للإنتاج:

- [ ] جميع الـ 35 سيناريو في [maintenance-test-scenarios.md](./maintenance-test-scenarios.md) تَمرّ
- [ ] code coverage ≥ 75% على الـ services الجديدة
- [ ] E2E tests على المسارات الـ 5 السعيدة الأكثر تَكراراً (SC-01..05)
- [ ] performance tests:
  - duplicate detection < 500ms لـ 100K requests
  - GET /service-requests (list) < 1s لـ 10K records
- [ ] documentation:
  - API docs (Swagger) كاملة
  - operator user guide
- [ ] audit log integrity verified عبر مراجعة عشوائية لـ 100 request
- [ ] 14 يوم staging stable بدون P1/P2 incidents
- [ ] training session لـ Operators + Audit Admins

---

## الفجوات المعروفة (post-V1.0)

| الفجوة | متى تُعالَج |
|---|---|
| القنوات الخارجية (mobile/web/whatsapp) — auth + endpoints عامة | V1.1+ |
| Periodic maintenance عبر service_requests (لو قُرِّر لاحقاً) | V2 |
| Visit_task wizard يُستخدَم على periodic | V2 |
| Reporting dashboard متقدّم (analytics per fault, per technician) | V1.2 |
| Mobile app technician interface لإدخال نتائج الزيارة | V2 |

---

## المراجع

- [maintenance.md](./maintenance.md) — الدستور الكامل
- [maintenance-test-scenarios.md](./maintenance-test-scenarios.md) — 35 سيناريو تحقّق
- [device-demo.md](./device-demo.md) — قالب مرجعي
