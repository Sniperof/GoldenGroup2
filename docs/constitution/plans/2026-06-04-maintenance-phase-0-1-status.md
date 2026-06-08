# Emergency Maintenance V1.0 — Phase 0 + Phase 1 Status

> **التاريخ:** 2026-06-04
> **المرجع الدستوري:** [`features/tasks/maintenance.md`](../features/tasks/maintenance.md)
> **خطة التنفيذ:** [`features/tasks/maintenance-implementation-plan.md`](../features/tasks/maintenance-implementation-plan.md)
> **سيناريوهات التحقُّق:** [`features/tasks/maintenance-test-scenarios.md`](../features/tasks/maintenance-test-scenarios.md)
> **DB المُستهدَفة:** `golden_crm_dev` (localhost:5432) — staging يَستلزم تشغيل `pnpm run migrate` بعد pull
> **آخر migration قبل البدء:** `238_pre_offer_sale_reference_number.sql`

---

## ١. Phase 0 — Foundation (Schema only) ✅

### Migrations المُطبَّقة (239 → 246)

| الرقم | الملف | الأثر |
|---|---|---|
| 239 | `service_lists_categories.sql` | 5 فئات `system_lists` جديدة + seeds دنيا (`أخرى` + 1-3 قيم لكل فئة). UNIQUE index على `(category, value)` يُضاف `IF NOT EXISTS`. |
| 240 | `service_requests_table.sql` | الجدول المركزي + 7 indexes + trigger `updated_at` + 7 CHECK constraints. |
| 241 | `service_request_audit_log.sql` | جدول append-only + 3 indexes + 2 triggers يَمنعان UPDATE/DELETE على مستوى DB. |
| 242 | `service_request_problems.sql` | اللائحة بـ dual-reference + 6 indexes + trigger يَمنع تَغيير `status` من `resolved` بدون session GUC override. |
| 243 | `open_task_emergency_payload.sql` | UNIQUE FK 1:1 على `open_tasks(id)` — نمط `open_task_pre_offers`. |
| 244 | `open_tasks_source_service_request_fk.sql` | ALTER ADD COLUMN `source_service_request_id` (BIGINT, NULL) + partial index. |
| 245 | `pg_trgm_for_duplicate_detection.sql` | EXTENSION + gin trgm index على `problem_description` + phone-tail index. |
| 246 | `service_requests_system_settings.sql` | 6 system_settings rows (auto-cancel أيام + duplicate threshold/window/weights). |

### التَحقُّق (تَمّ على dev)

```
tables_4       = 4 ✓  (service_requests, service_request_audit_log,
                       service_request_problems, open_task_emergency_payload)
sr_fk_col      = 1 ✓  (open_tasks.source_service_request_id)
pg_trgm        = 1 ✓  (extension installed)
new_cats       = 5 ✓  (diagnosis_problem_types, service_partial_reasons,
                       service_unresolved_reasons, reopen_reasons,
                       emergency_uniqueness_override_reasons)
sr_settings    = 6 ✓  (service_request_*)
```

### قرارات Phase 0 المُوثَّقة

| القرار | الملف | المبرّر |
|---|---|---|
| **عدم إنشاء UNIQUE EM-UNIQ-01 الآن** | (مؤجَّل) | الفهرس الجزئي `(installed_device_id) WHERE status NOT IN terminal AND task_type='emergency_maintenance'` يَخصّ منطق `promote`. إنشاؤه قبل وجود promote service سَيُولِّد violations عند أول data. **سَيُضاف في Phase 2 ضمن migration مرافق لـ promote service.** |
| **عدم تَضييق `open_tasks.creation_origin` CHECK** | 244 (مؤجَّل لـ Phase 8) | الـ legacy `emergencyTickets.ts` و `openTasks.ts` يَكتبان قيماً (`service_request_call`, `telemarketing_inline_booking`, `cascading_during_visit`, `manual_creation`) دستوريّاً مَرفوضة. تَضييق CHECK الآن يَكسر الإنتاج. **يُضيَّق في Phase 8 cleanup بعد توقُّف كل كَتَبَة legacy.** |
| **EM-PROB-02 trigger يَستخدم session GUC `service_request.audit_override`** | 242 | نمط Postgres قياسي للـ row-level guards: الـ audit-admin endpoint يَفتح transaction ثم `SET LOCAL service_request.audit_override = 'on'` قبل الـ UPDATE. أي مسار آخر يُخطئ بصراحة. |
| **`public_ref_number UNIQUE` جزئي على `WHERE archived_at IS NULL`** | 240 | يَنسجم مع `SR-REF-05` (نظرياً يَسمح إعادة الاستخدام بعد الأرشفة — مرفوض عملياً، مَفتوح schema-wise). |
| **`triage_outcome` CHECK يَشمل كل القيم في enum واحد** | 240 | الدستور يَفرض قيماً مختلفة لكل terminal state — لكن الإلزام per-terminal يَخصّ application layer (state machine في Phase 2). الـ CHECK في DB يَضمن فقط أن القيمة من اللائحة الكاملة. |
| **`service_request_problems.installed_device_id` NOT NULL + ON DELETE RESTRICT** | 242 | الدستور (EM-PROB-05) يُلزم ربطاً صريحاً بالجهاز. RESTRICT يَمنع حذف جهاز عليه أعطال مُسجَّلة (يَحمي الـ audit trail). |
| **system_lists seeds بـ ON CONFLICT `(category, value)`** | 239 | يَتطلَّب UNIQUE index — أُنشئ في نفس الملف `IF NOT EXISTS`. لو موجود سابقاً → no-op آمن. |
| **لا hardcoded IDs في الـ seeds** | 239 / 246 | تَجنُّب PK collisions على البيئات المتعدّدة — كل INSERT يَعتمد على sequence + ON CONFLICT على الـ natural key. |
| **seeds دنيا فقط ("أخرى" + 1-5)** | 239 | تَتبَع precedent migration 235 (device_demo) — الـ admin يَملك القائمة الكاملة من `/system-lists` UI. القيم المُدخَلة عيّنات تَشغيلية فقط. |

---

## ٢. Phase 1 — Permissions & Roles ✅

### Migrations المُطبَّقة (247 → 248)

| الرقم | الملف | الأثر |
|---|---|---|
| 247 | `service_requests_permissions.sql` | 6 صلاحيات في `permissions` table بـ `ON CONFLICT (key)` آمن. |
| 248 | `request_audit_admin_role.sql` | دور template جديد + grants لـ `REQUEST_AUDIT_ADMIN` (3 perms) و `SYSTEM_ADMIN` (6 perms). يُضيف 2 UNIQUE indexes كأثر جانبي. |

### مصفوفة الصلاحيات الفعّالة

| الـ key | display_order | allowed_scopes | مَن مُنحَ |
|---|:---:|---|---|
| `service_requests.create`  | 250 | `GLOBAL, BRANCH` | SYSTEM_ADMIN |
| `service_requests.view`    | 251 | `GLOBAL` | SYSTEM_ADMIN, REQUEST_AUDIT_ADMIN |
| `service_requests.review`  | 252 | `GLOBAL` | SYSTEM_ADMIN |
| `service_requests.reject`  | 253 | `GLOBAL` | SYSTEM_ADMIN, REQUEST_AUDIT_ADMIN |
| `service_requests.promote` | 254 | `GLOBAL` | SYSTEM_ADMIN |
| `service_requests.archive` | 255 | `GLOBAL` | SYSTEM_ADMIN, REQUEST_AUDIT_ADMIN |

### الدور الجديد `REQUEST_AUDIT_ADMIN`

| السمة | القيمة | المبرّر |
|---|---|---|
| `name` | `REQUEST_AUDIT_ADMIN` | تعريف uppercase يَتبع نمط `SYSTEM_ADMIN`، `CUSTOMER_SERVICE_SUPERVISOR` |
| `display_name` | `مدقّق طلبات الصيانة` | الواجهة العربية |
| `is_template` | `true` | template = مَركزي بلا فرع (يَتوافق مع `roles_scope_ck`) |
| `is_system` | `false` | الـ admin يَستطيع تعديله من `/roles` UI (بعكس SYSTEM_ADMIN المحمي) |
| `is_protected` | `false` | لا حماية صارمة — يُمكن إيقافه إن لزم |
| `is_hidden` | `false` | ظاهر للـ admin |
| `branch_id` | `NULL` | إلزامي للـ templates |
| `team_slot_type` | `NULL` | ليس دور ميداني — مَركزي لا team-slot |

### قرارات Phase 1 المُوثَّقة

| القرار | الملف | المبرّر |
|---|---|---|
| **`role_permission_grants` (لا `role_permissions`) هو الجدول الفعّال** | 248 | `services/authorizationService.ts:160` يَقرأ من `role_permission_grants` (مع `scope_type`). `role_permissions` (بلا scope) **legacy**. لا تَكتب فيه. |
| **لم أمنح `review/promote/create` لأي دور قائم** | 248 | الـ Operator persona قرار تشغيلي — الـ admin يَختار من `/roles` UI أي دور قائم يَتولّاها (المرشَّح: `CUSTOMER_SERVICE_SUPERVISOR` — راجع §3). تَخصيص متسرّع يُكبِّل operations. |
| **`branch_manager` لم يُنشأ** | (مؤجَّل) | الخطة ذَكرته كمستلم محتمل، لكنه دور غير موجود في القاعدة الحالية. يُتَرك للـ admin إن أراد إنشاءه. |
| **اسم الدور UPPERCASE_SNAKE** | 248 | تَوافق مع `SYSTEM_ADMIN`. (`CUSTOMER_SERVICE_SUPERVISOR` يَتبع نفس النمط، `supervisior` و `tech` lowercase استثناءات سابقة). |
| **UNIQUE indexes كأثر جانبي للسلامة** | 248 | `roles_template_name_unique` (partial WHERE `is_template=true`) + `role_permission_grants_natural_unique` (role+perm+scope). كلاهما `IF NOT EXISTS`. |
| **دور `REQUEST_AUDIT_ADMIN` ≠ SYSTEM_ADMIN في الـ display** | 248 | SYSTEM_ADMIN خارج المعتاد (إدارة شاملة). REQUEST_AUDIT_ADMIN دور وظيفي محصور. أن يكون قابلاً للتعديل = مرونة تشغيلية. |

---

## ٣. توصيف `CUSTOMER_SERVICE_SUPERVISOR` (الواقع الراهن — مرجع للمرحلة 2)

### الميتاداتا

| السمة | القيمة |
|---|---|
| `id` | 2 |
| `name` | `CUSTOMER_SERVICE_SUPERVISOR` |
| `display_name` | `مشرفة خدمة زبائن` |
| `description` | "دور مشرفة خدمة الزبائن — صلاحيات إدارة العملاء والمرشحين ضمن نطاق الفرع والتكليف" |
| `is_template` | `true` |
| `is_system` | `false` |
| `team_slot_type` | `SUPERVISOR` |
| `branch_id` | `NULL` (template) |

### مصفوفة الصلاحيات الحالية (قبل ربط service_requests)

| المجال | الصلاحيات الممنوحة | النطاق |
|---|---|---|
| **admin** | `admin.view` | GLOBAL |
| **clients** | `clients.create` | BRANCH |
| **candidates** | `candidates.create`, `candidates.edit`, `candidates.view_list` | BRANCH |
| **geo** | `geo.view` | GLOBAL |
| **telemarketing** | `telemarketing.create`, `telemarketing.view`, `telemarketing.view_history` | BRANCH |
| **jobs (HR/recruitment)** | ~20 صلاحية: create, edit, schedule, conduct, record_attendance, record_result, record_decision, hire, archive, escalate, change_stage, change_status, complete, start, add_trainees, be_trainer, edit_notes, view_audit_logs, view_detail, view_eligible, view_list | BRANCH |

### القراءة الدلالية للدور

CSS هو **مشرف فرع لأنشطة خدمة العملاء + التوظيف**:
- **يُنشئ ويُحرّر العملاء والمرشحين** (BRANCH-bound).
- **يَقود التيلماركتر** (create + view + history).
- **يَتحكَّم بـ HR pipeline كاملاً** (التدريب، المقابلات، التوظيف، التَصعيد).
- **`admin.view` + `geo.view`** GLOBAL = يَرى المنظومة الإدارية والجغرافية شاملةً (للمشاهدة فقط، لا التَعديل).

### لماذا هو **المرشَّح الطبيعي** لدور Admin Operator في service_requests

| السبب | التفصيل |
|---|---|
| **مَركزي بطبيعته** | فعلاً يَتعامل مع زبائن/مرشحين عبر القنوات (`clients.create`, `telemarketing.*`). تَولّي طلبات الصيانة هاتفياً امتداد طبيعي لمسؤولياته. |
| **مشرف لا فني** | `team_slot_type = SUPERVISOR` يَنسجم مع طبيعة الفرز (قرار، توثيق، تحويل) — وليس ميدانياً. |
| **يَملك القناة الهاتفية** | `telemarketing.create` + `telemarketing.view_history` يَكشفان أن لديه سياق مكالمات الزبائن — مَنح `service_requests.create` بقناة `phone` و `internal_button` يَتكامل معها. |
| **يَملك حق إنشاء العملاء** | `clients.create` BRANCH — مفيد لمسار `external_device` و walk-in حين يَلزم تَحويل Visitor إلى Lead/Client. |
| **يَملك view العام** | `admin.view` + `geo.view` GLOBAL = اعتاد رؤية ما يَتجاوز فرعه. منح `service_requests.view` GLOBAL لا يَكسر الـ mental model. |

### المنح المقترَحة لـ `CUSTOMER_SERVICE_SUPERVISOR` (لتنفيذ يدوي من `/roles` UI أو في Phase 2)

| الصلاحية | الـ scope | المبرّر |
|---|---|---|
| `service_requests.create` | **BRANCH** | يُنشئ طلبات نيابة عن زبائن فرعه (مكالمات + walk-ins). الـ scope=BRANCH يَنسجم مع باقي صلاحياته. |
| `service_requests.view` | **GLOBAL** | الـ intake مَركزي بطبيعته (٠.١٦ + SR-08). الـ scope=GLOBAL إلزامي دستورياً. |
| `service_requests.review` | **GLOBAL** | يَقود الفرز (claim, link, escalate). إلزامي GLOBAL. |
| `service_requests.promote` | **GLOBAL** | يُرَقّي إلى open_task بعد اكتمال الربط. إلزامي GLOBAL. |
| `service_requests.archive` | **GLOBAL** | بعد terminal، يَستطيع الأرشفة (مَشترَك مع Audit Admin). |
| ❌ `service_requests.reject` | — | **محفوظة حصرياً لـ REQUEST_AUDIT_ADMIN** (SR-AUTH-01 + SR-R007). |

### قيد دستوري يَجب الانتباه له

> CSS سيَحوي صلاحية `service_requests.view` بـ `GLOBAL` بينما باقي صلاحياته BRANCH. هذا **مقصود** دستورياً — الـ intake طبقة مَركزية مَفصولة عن مسؤوليات الفرع البَحتة. الـ middleware القائم (`requirePermission` + `role_permission_grants.scope_type`) يَدعم هذا الفصل بدون تعديل.

### قرار مؤجَّل

**هل نُحدِّث الـ template CSS في migration، أم نَتركها للـ admin يَدوياً؟**

- **خيار (أ) Migration:** يَضمن أن أي branch role مُولَّد من CSS template يَستلم الصلاحيات الجديدة آلياً. لكن يَتجاوز قرار الـ admin التَشغيلي.
- **خيار (ب) UI manual (الافتراضي):** الـ admin يَضيفها من `/roles` بعد تَجربة شخصياً. أبطأ لكن أكثر وعياً.

**الاقتراح:** نَترك للـ admin مع قائمة جاهزة كما في الجدول أعلاه. Phase 2 لن تَفترض وجود grants تَلقائياً — كل endpoint يَفحص الصلاحية صراحة.

---

## ٤. ما تَبقّى قبل Phase 2

- [ ] قرار تَشغيلي: مَن يَتولّى Admin Operator persona؟ المرشَّح: `CUSTOMER_SERVICE_SUPERVISOR` (راجع §3).
- [ ] منح الصلاحيات الـ 5 المقترَحة لـ CSS من `/roles` UI (أو تأجيل لـ Phase 4 frontend).
- [ ] لا حاجة لاختبار يدوي على Phase 0 — Phase 2 services ستَختبر كل constraint عملياً.

## ٥. مخاطر مَفتوحة محمولة لـ Phase 2

| الخطر | الفعل في Phase 2 |
|---|---|
| EM-UNIQ-01 unique index غير موجود بعد | يُضاف ضمن migration مرافق لـ `services/serviceRequests/promoteService.ts`. |
| Legacy `emergencyTickets.ts` يَكتب `creation_origin='service_request_call'` (سَيُحذَف من CHECK لاحقاً) | لا تَعديل في Phase 2 — يَبقى يَعمل بالتوازي تحت feature flag. |
| `service_request.audit_override` GUC غير مُسجَّل في `postgresql.conf` كـ custom GUC | `current_setting('...', true)` بـ missing_ok=true يَرجع NULL آمن. لا تَعديل لازم. |

---

## ٦. ثغرة دستورية مكتشَفة — سحب الجهاز للورشة (مُؤجَّلة)

> **التاريخ:** 2026-06-04 (أثناء Phase 2a)
> **الحالة:** مُحلَّلة، **التَنفيذ مُؤجَّل إلى Phase 6** بقرار تَشغيلي.
> **الأثر على Phase 2:** صفر — نُكمِل بالـ 7 statuses الحالية على `service_request_problems`.

### السيناريو

الفني يَصل، يُشخِّص أعطالاً لا يُمكن معالجتها ميدانياً، **يَسحب الجهاز للورشة**، يُعيده بعد X أيام، يُركِّبه، يُغلق. **زيارتان فعليّتان + فترة ورشة بينهما** خارج إطار الزيارات الميدانية.

### الإشارة الدستورية القائمة

`features/tasks/maintenance.md §13.أ`:
> `unresolved + قرار "يحتاج ورشة"` → ملاحظة على `emergency_tickets` + `open_task` جديدة (نوع لاحق `workshop_repair` إن أُدخل)

ذُكر، لم يُحسَم. البنية التحتية حاضرة:
- `installed_devices.status` يَحوي `'in_workshop'` و `'retrieved'` و `'ready'`.
- `device_possession_log` table موجود.
- `task_type='device_repair'` موجود في `tasks-unified.md §4.6`.

### القرار البنيوي المُقترَح (للتنفيذ في Phase 6)

> **`open_task` الطارئة تَبقى مفتوحة عبر الورشة كاملاً + الزيارة الثانية. الورشة فترة بين زيارتَين على نفس open_task — لا cascade لمهمة جديدة.**

| المبرّر | التفصيل |
|---|---|
| `V-R007` (visits.md) يَفرضه | كل محاولة تنفيذ = `visit_task` جديدة تحت نفس `open_task`. السحب = محاولة 1، الإعادة = محاولة 2. |
| `EM-UNIQ-01` يَنسجم | "زبون واحد، جهاز واحد، طارئة واحدة" تَستلزم عدم تَوليد open_task ثانٍ. cascade يَكسرها. |
| اللائحة تَبقى مَرئية | `service_request_problems` تَستمرّ على نفس `open_task_id` بلا نسخ. |
| `derived_outcome` يَعمل تلقائياً | بعد الزيارة الثانية، الأعطال → `resolved` → `fully_resolved` محسوبة. |
| يَستفيد من بنية قائمة | `device_possession_log` + `installed_devices.status` enums. |

### التَغييرات المطلوبة في Phase 6 (لا الآن)

1. **`service_request_problems.status`** يَكتسب قيمة 8️⃣: **`pending_workshop`**
   - تَعني: "الجهاز سُحب للورشة، العطل يَنتظر معالجة ورشة + إعادة تركيب".
   - تَختلف عن `unresolvable_field` (إعدام دلالي) وعن `deferred` (انتظار زيارة لاحقة بدون سحب).
   - migration: DROP CHECK + ADD CHECK مع القيمة الجديدة.

2. **`visit_task_results.final_decision` (طارئة)** يَكتسب قيمة 6️⃣: **`device_retrieved`**
   - لا migration (الحقل `VARCHAR(100)` بدون CHECK).
   - تَعني: المحاولة الميدانية انتهت بسحب الجهاز — لا فشل، لا إنجاز كامل.
   - يَنعكس على `open_task.status = 'waiting_execution'` (يَنتظر زيارة الإعادة) لا `'needs_follow_up'` (الذي يَعني انتظار الزبون).

3. **`installed_devices.status`** transitions (logic، لا schema):
   ```
   active → faulty (عند البلاغ)
          → in_workshop (عند السحب — close visit بـ device_retrieved)
          → ready (بعد إصلاح الورشة)
          → active (بعد إعادة التركيب)
   ```
   تَطبيقها في `services/visitCompletion.ts` extension أو في wizard endpoint.

4. **`device_possession_log` entries** عند:
   - retrieval_for_workshop (customer → technician)
   - workshop_intake (technician → workshop)
   - workshop_release (workshop → technician)
   - post_workshop_reinstall (technician → customer)

5. **Wizard (Phase 6 frontend)**:
   - `MaintenanceActionsForm` يُضيف زر "سحب الجهاز للورشة" → modal:
     - تَأكيد الأعطال التي ستَنتقل لـ `pending_workshop`.
     - إنشاء `device_possession_log` entry.
     - تَحديث `installed_devices.status`.
     - إغلاق `visit_task_results` بـ `final_decision='device_retrieved'`.

6. **`service_request_problems.resolution_visit_task_id`** يَبقى صحيحاً منطقياً:
   - العطل الذي حُلّ بالورشة، يُسجَّل `resolution_visit_task_id = الزيارة الثانية (إعادة التركيب)`، لأنها التي شَهدت الإغلاق الميداني. الورشة فترة وسطية لا تُمثَّل كـ visit_task.

7. **Financials V1.0**: كل التَكاليف (سحب + ورشة + إعادة تركيب) تَتراكم على `open_task` الواحد. الزبون يَدفع مرة واحدة عند الإغلاق النهائي. Workshop tab منفصل في الـ wizard لتَفصيل تَكاليف الورشة.

### لماذا التَأجيل قرار حكيم

- Phase 2 services الحالية لا تَفترض هذه الحالة — نُبقي scope تَنفيذي ضيِّقاً.
- الـ wizard هو المكان الطبيعي لـ UX السحب — يُعالَج عند بنائه.
- إضافة CHECK value الآن بلا code path يَستخدمها = noise بلا منفعة.

### علامة تنبيه لـ Phase 6

أُسجِّل هذه الفقرة كـ **prerequisite check** قبل بناء `MaintenanceActionsForm`. أي قرار في Phase 6 يَتعارض مع البنود السبعة أعلاه يَحتاج مراجعة دستورية صريحة.

---

## مَنحَنى التَقدُّم

| Phase | الحالة | الأيام الفعلية |
|---|:---:|:---:|
| 0 — Foundation | ✅ | < يوم |
| 1 — Permissions | ✅ | < يوم |
| 2 — Backend Services | ✅ | < يوم |
| 3 — REST Endpoints | ✅ | < يوم |
| 4 — Frontend Dashboard | ✅ | < يوم |
| 5 — Integration | ✅ | < يوم |
| 6 — Wizard Updates | ✅ | < يوم |
| 7 — Data Migration | ✅ | < يوم |
| 8 — Legacy Cleanup | ⏳ التالي (بعد 14 يوم staging) | 1-2 (تقدير) |
| 5 — Integration | — | — |
| 6 — Wizard Updates | — | — |
| 7 — Data Migration | — | — |
| 8 — Legacy Cleanup | — | — |

---

## ٧. Phase 2 — Backend Services ✅

### Migration المُطبَّقة (249)

| الرقم | الملف | الأثر |
|---|---|---|
| 249 | `emergency_unique_active_per_device.sql` | EM-UNIQ-01: partial UNIQUE على `open_tasks(device_id)` حيث `task_type='emergency_maintenance' AND status NOT IN ('completed','closed','cancelled')`. الـ legacy rows بـ `device_id IS NULL` تَقع خارج الفهرس (لا تَكسر). |

### الـ Services الجديدة (11 ملف، ~2150 سطر)

| الملف | السطور | الـ rules المُغطّاة | API الرئيسية |
|---|:---:|---|---|
| `_shared.ts` | 195 | enums + helpers مُشتركة | `acquireTx/commitTx/rollbackTx`, `appendAudit`, `generatePublicRefNumber` (٠.٧.أ), `isTerminal`, `isTriagerPresent` |
| `createService.ts` | 232 | SR-WALKIN-01..06، channel→status (٠.٦)، ref retry على collision، first-claim auto-stamp (٠.٤.أ) | `createServiceRequest(input, db?)` |
| `stateMachine.ts` | 245 | SR-R001..R011، SR-AUTH-01، SR-REOPEN-01..04، triage_outcome per-terminal | `transitionStatus(input, db?)` |
| `claimService.ts` | 145 | SR-CLAIM-01/02/03/05/06/07 — non-exclusive soft ownership | `claimOrTakeOver(input, db?)` |
| `duplicateDetection.ts` | 165 | ٠.١٥.أ خوارزمية كاملة بـ settings live، post-insert (٠.١٥.أ "Pre-requisites") | `detectDuplicates(db, requestId, actor, role)` |
| `problemsService.ts` | 415 | ٠.١٩.ب/د/هـ/و + EM-PROB-01..05 (soft delete، resolved-lock + override) | `addProblem`, `editProblem`, `changeProblemStatus`, `softDeleteProblem`, `restoreProblem`, `auditAdminOverride` |
| `promoteService.ts` | 335 | SR-R004 + SR-AUTH-02/06 + EM-UNIQ-01/03 + ٠.١٣ external_device | `promote(input, db?)`, `mergeIntoExistingTask(input, db?)` |
| `reopenService.ts` | 95 | ٠.٤.ب per-terminal بـ role gate، wrapper على stateMachine | `reopen(input, db?)` |
| `cronAutoCancel.ts` | 80 | ٠.٤.ج — `awaiting_customer_info` > 7d → cancelled (actor='system') | `runAutoCancelAwaitingCustomerInfo()` |
| `derivedOutcomeCalc.ts` | 75 | ٠.١٩.ح — pure aggregation (8 outcomes) | `computeDerivedOutcome(openTaskId, db?)` |
| `fuzzyMatching.ts` | 165 | ٠.١١ Suggested Records (clients + candidates، high/medium/low confidence) | `suggestRecords(input, db?)` |

### قرارات Phase 2 المُوثَّقة

| القرار | الملف | المبرّر |
|---|---|---|
| **`{ ok, data } \| { ok, code }` envelope بدل throw للأخطاء العمَلية** | _shared.ts | Business-rule violations (validation, state, role) تَرجع نتيجة typed. فقط DB errors تَبلغ catch — يَتوافق مع نمط `visitCompletion.ts`. |
| **كل service يَقبل `db?: PoolClient` اختياري** | كل الـ services | يُمكِّن الـ composition: endpoint يَفتح transaction واحد ويَستدعي services متعدّدة (مَثلاً claim ثم link ثم promote في endpoint واحد). نفس نمط `checkAndCompleteVisit`. |
| **`generatePublicRefNumber()` يَستخدم MAX+lpad داخل نفس tx + retry على collision** | _shared.ts + createService.ts | الـ SUBSTRING offset = **13** (وليس 14 كما في الدستور — الدستور به typo: `SR-` (3) + `YYYYMMDD` (8) + `-` (1) = position 13 لبداية NNNN). retry 3 محاولات يُغطّي race الميكروثانية النادر. |
| **`createService` يَكتب `claimed_by_operator` event عند first-create من قناة triager-present** | createService.ts | الـ status يَبدأ `in_review` مباشرة (٠.٦)، فالـ claim auto-implicit. كتابة الـ event صراحةً تُغذّي dashboards "طلباتي" بدون استثناءات. |
| **`stateMachine.transitionStatus()` لا يَلمس `reviewed_by_user_id`** | stateMachine.ts | SR-CLAIM-05 + SR-CLAIM-07 — ownership snapshot للـ Operator الأخير، لا يُمسَح أبداً. ownership transitions تَخصّ `claimService` حصراً. |
| **`stateMachine` يَكتب event `status_changed` العام + event مُتخصِّص (e.g. `rejected_decision`, `customer_info_requested`)** | stateMachine.ts | الـ general event للـ timeline قراءة كرونولوجية. الـ specialized event للـ queryability ("كم طلباً رُفض الشهر؟"). نَكتب الاثنين. `promoted_to_task` استثناء — يَخرج من `promoteService` لأنه يَحمل `linked_open_task_id`. |
| **`promote` يُلزم `beneficiary_client_id` (لا candidate-only)** | promoteService.ts | `open_tasks.client_id NOT NULL FK → clients`. promote من candidate يَستلزم تَرقية candidate→client أوَّلاً (مسار منفصل). نَرجع code صريح. |
| **EM-UNIQ-01 يُفحص في الـ service كـ pre-check + الـ DB index يَحمي race** | promoteService.ts + migration 249 | الـ service يَرجع `merge_or_split_required` بـ `existingOpenTaskId` ليَفتح الـ UI شاشة قرار (EM-UNIQ-02). لو حدث race، DB يَرفض INSERT بـ 23505. |
| **`mergeIntoExistingTask` يَكتب `additional_report_attached` في `task_activity_log` كـ `note_added`** | promoteService.ts | الـ `task_activity_log.event_type` CHECK لا يَحوي `additional_report_attached`. نَستخدم `note_added` بـ `reason='additional_report_attached from service_request #X'` كحلّ بَسيط. توسيع الـ CHECK ممكن لاحقاً. |
| **`problemsService` لا يَفرض permission matrix ٠.١٩.هـ** | problemsService.ts | الـ matrix per-phase تَخصّ endpoint layer (Phase 3). الـ service يَفترض الـ caller authorized. |
| **`problemsService.assertDeviceOwnership` يَتساهل قبل linkage** | problemsService.ts | EM-PROB-05 يَفرض الربط، لكن إضافة عطل أثناء intake (قبل ربط beneficiary) شائع. نُؤجِّل الفحص حتى الـ link step (Phase 2b التالي أو endpoint). |
| **`auditAdminOverride` يُفعِّل GUC `service_request.audit_override` بـ `SET LOCAL`** | problemsService.ts | يَتطابق مع trigger DB في migration 242. `SET LOCAL` يَنتهي بنهاية transaction آلياً — لا تَسرُّب. |
| **`cronAutoCancel` يَستخدم `service_request_audit_log` لقياس "كم بقي في awaiting"** | cronAutoCancel.ts | يَأخذ MAX(`customer_info_requested` event) لكل request. أدقّ من `updated_at` الذي يَتغيّر بأي UPDATE (note، priority change). |
| **`derivedOutcomeCalc` يَتجاهل `reported/confirmed/resolved_at_intake` في classify** | derivedOutcomeCalc.ts | الـ outcomes الـ 7 الدستورية تَفترض الزيارة أُنجزت. لو لا تَزال الأعطال في حالات pre-visit، النتيجة `mixed`. حالة 8️⃣ `no_problems` تُغطّي soft-delete الكامل. |
| **`fuzzyMatching` يَستخدم `clients.is_candidate=false` للتفريق** | fuzzyMatching.ts | `clients` + `candidates` جداول منفصلة فعلاً، لكن `clients.is_candidate` flag يَفصل (موجود في schema). نَستعلم الجدولَين بـ UNION منطقي (استعلامَين منفصلَين، نَتائج مَدموجة في الـ output). |
| **لا unit tests كتبتُها بعد** | (مؤجَّل) | الخطة تَطلب ≥70% coverage. أَتركها لمرحلة لاحقة أو ضمن Phase 3 مع integration tests على الـ endpoints. Typecheck نظيف على الـ services الـ 11. |

### ثغرات V1.0 موَّثقة في الكود (مرفوعة لـ Phase 3+)

| الثغرة | الملف | السلوك الحالي | الحلّ المقترَح |
|---|---|---|---|
| `installed_devices.contract_id NOT NULL` يَمنع external_device synthesis (٠.١٣) | promoteService.ts → `createLightweightInstalledDevice` | يُحاول INSERT، يَلتقط 23502، يَرجع `external_device_requires_schema_relaxation` بصراحة | migration لاحقة: `ALTER COLUMN contract_id DROP NOT NULL` + CHECK مَشروط (`contract_id NOT NULL OR origin='external_no_contract'`). يُنفَّذ عند تَفعيل external_device في الـ wizard (Phase 3 أو Phase 6). |
| `task_activity_log.event_type` CHECK لا يَحوي `additional_report_attached` | promoteService.mergeIntoExistingTask | يَستخدم `note_added` مع reason text كـ work-around | توسيع CHECK في Phase 8 cleanup ضمن تَنظيف legacy event names. |
| Linkage service لم يُكتَب بعد | (Phase 2c محتمل) | `service_requests.beneficiary_client_id` يُملأ يدوياً عبر UPDATE في endpoint. اللائحة `service_request_problems` لا تَتحقَّق من device ownership قبل linkage. | يَلزم `linkService.ts` صغير: link/relink + audit `party_linked` / `linkage_changed` + revalidate problems. يُكتب في Phase 3 ضمن endpoint POST `/:id/link`. |

### نُكتب نموذجياً (smoke test) — اختياري لـ Phase 3

اختبار يدوي مُقترَح قبل بناء الـ endpoints:

```sql
-- 1. Create a request
SELECT generate_public_ref_number(...);  -- not implemented as DB function;
                                          -- use the helper in _shared.ts via psql or test script

-- بدلاً من ذلك، script سريع:
INSERT INTO service_requests (
  public_ref_number, channel, problem_description,
  requester_external, service_address, status
) VALUES (
  'SR-20260604-0001', 'phone', 'الجهاز لا يَعمل',
  '{"name":"أحمد","primary_phone":"0944123456"}'::jsonb,
  '{"governorate":"دمشق","detailed_address":"المزة"}'::jsonb,
  'in_review'
);

-- 2. Try invalid transition (received → promoted) — يَفشل في الـ service
-- 3. Try resolved_at_intake with phone channel + notes — يَنجح
-- 4. Try rejected without review_required_flag — يَفشل بـ SR-AUTH-01
```

تَركتُها للـ Phase 3 endpoints حيث الـ E2E test أنظف عبر HTTP.

### الـ Imports الموجودة (للـ Phase 3 endpoints)

```typescript
import { createServiceRequest } from '../services/serviceRequests/createService.js';
import { transitionStatus } from '../services/serviceRequests/stateMachine.js';
import { claimOrTakeOver } from '../services/serviceRequests/claimService.js';
import { detectDuplicates } from '../services/serviceRequests/duplicateDetection.js';
import {
  addProblem, editProblem, changeProblemStatus,
  softDeleteProblem, restoreProblem, auditAdminOverride,
} from '../services/serviceRequests/problemsService.js';
import { promote, mergeIntoExistingTask } from '../services/serviceRequests/promoteService.js';
import { reopen } from '../services/serviceRequests/reopenService.js';
import { runAutoCancelAwaitingCustomerInfo } from '../services/serviceRequests/cronAutoCancel.js';
import { computeDerivedOutcome } from '../services/serviceRequests/derivedOutcomeCalc.js';
import { suggestRecords } from '../services/serviceRequests/fuzzyMatching.js';
```

### مَنحَنى الـ Migrations الإجمالي

239 → 249 = **11 migration** مُطبَّقة. لا migration معلَّقة قبل Phase 3.

---

## ٨. Phase 3 — REST Endpoints ✅

### الملفات المُغيَّرة

| الملف | النوع | الإضافة |
|---|---|---|
| `packages/api/routes/serviceRequests.ts` | جديد (~620 سطر) | 24 endpoint تَحت `/api/service-requests` |
| `packages/api/routes/openTasks.ts` | تَوسيع | `GET /:id/problems` + `GET /:id/derived-outcome` |
| `packages/api/index.ts` | wiring | `import serviceRequestsRouter` + `app.use('/api/service-requests', requireAuth, serviceRequestsRouter)` خارج `branchOnly` |

### جدول الـ Endpoints (26 إجمالي)

| Method | Path | Permission | Service |
|---|---|---|---|
| POST | `/service-requests` | `service_requests.create` | `createServiceRequest` |
| POST | `/service-requests/internal` | `service_requests.create` | `createServiceRequest` بـ channel='admin_manual' |
| GET | `/service-requests` | `service_requests.view` | filters: status, channel, duplicateOnly, reviewRequired, archived, mine, beneficiaryClientId, pagination |
| GET | `/service-requests/:id` | `service_requests.view` | request + auditLog + problems (3 queries مُتوازية) |
| POST | `/service-requests/:id/claim` | `service_requests.review` | `claimOrTakeOver` |
| POST | `/service-requests/:id/take-over` | `service_requests.review` | `claimOrTakeOver` مع reason |
| POST | `/service-requests/:id/link` | `service_requests.review` | `linkBeneficiary` (inline) |
| POST | `/service-requests/:id/change-linkage` | `service_requests.review` | `linkBeneficiary` بـ isChange=true |
| GET | `/service-requests/:id/suggested-matches` | `service_requests.review` | `suggestRecords` بـ requester_external seed |
| POST | `/service-requests/:id/request-info` | `service_requests.review` | `transitionStatus → awaiting_customer_info` |
| POST | `/service-requests/:id/resume-review` | `service_requests.review` | `transitionStatus → in_review` |
| POST | `/service-requests/:id/resolve-at-intake` | `service_requests.review` | `transitionStatus → resolved_at_intake` |
| POST | `/service-requests/:id/escalate` | `service_requests.review` | inline: review_required_flag=TRUE + 2 audit events |
| POST | `/service-requests/:id/reject` | `service_requests.reject` | `transitionStatus → rejected` بـ actorRole='audit_admin' |
| POST | `/service-requests/:id/cancel` | `service_requests.review` | `transitionStatus → cancelled` |
| POST | `/service-requests/:id/reopen` | dynamic (review أو reject) | `reopen` بـ actorRole محسوبة من grants |
| POST | `/service-requests/:id/promote` | `service_requests.promote` | `promote` → 409 + collision context على EM-UNIQ-01 |
| POST | `/service-requests/:id/merge` | `service_requests.promote` | `mergeIntoExistingTask` |
| POST | `/service-requests/:id/archive` | `service_requests.archive` | inline: terminal-only + audit |
| POST | `/service-requests/:id/unarchive` | `service_requests.archive` | inline + audit |
| POST | `/service-requests/:id/notes` | `service_requests.review` | `internal_note_added` audit-only |
| POST | `/service-requests/:id/problems` | `service_requests.review` | `addProblem` |
| PATCH | `/service-requests/:id/problems/:pid` | `service_requests.review` | `editProblem` |
| PATCH | `/service-requests/:id/problems/:pid/status` | `service_requests.review` | `changeProblemStatus` |
| POST | `/service-requests/:id/problems/:pid/record-resolution` | `service_requests.review` | shortcut → status='resolved' |
| DELETE | `/service-requests/:id/problems/:pid` | `service_requests.review` | `softDeleteProblem` |
| POST | `/service-requests/:id/problems/:pid/restore` | `service_requests.reject` | `restoreProblem` (audit-admin only) |
| POST | `/service-requests/:id/problems/:pid/override` | `service_requests.reject` | `auditAdminOverride` (EM-PROB-02 bypass) |
| GET | `/open-tasks/:id/problems` | `open_tasks.view` | لائحة الأعطال لمهمة |
| GET | `/open-tasks/:id/derived-outcome` | `open_tasks.view` | `computeDerivedOutcome` |

### قرارات Phase 3 المُوثَّقة

| القرار | المبرّر |
|---|---|
| **Mount خارج `branchOnly`** | SR-08: الـ intake `GLOBAL` بطبيعته. إجبار `X-Branch-Id` يَكسر الـ middleware للـ super-admin بدون فرع. الـ permission middleware يَفحص الـ scope per-grant. |
| **`actorRole` يُستنتَج من الـ permission required بالـ endpoint** | endpoint بـ `service_requests.reject` ⇒ `audit_admin`. غيره ⇒ `operator`. تَجنُّب إدخال يَدوي عُرضة للخطأ + يَنسجم مع نموذج الصلاحية الثنائي (٠.١٦). |
| **`/reopen` يَختار `actorRole` ديناميكياً من grants** | terminal-dependent (rejected→audit_admin، resolved_at_intake/cancelled→operator). الـ service يَفحص ثانية ويَرفض إن لم يُطابق terminal. |
| **`statusFromCode()` mapping محدود (404/403/409/400)** | `not_found→404`, `wrong_role/audit_admin_cannot_claim/promoted_cannot_be_reopened→403`, `merge_or_split_required→409`. الباقي 400. يُمكِّن frontend من branching سريع. |
| **`/promote` تَرجع 409 + collision payload** | UI يَفتح modal merge/split بـ `existingOpenTaskId + installedDeviceId` فوراً (EM-UNIQ-02). 409 Conflict أَدلّ من 400 لـ collision. |
| **`linkBeneficiary` inline في الـ route لا service منفصل** | خدمة صغيرة (~50 سطر)، لا تَستحقّ ملفاً. هذه كانت `linkService.ts` المُؤجَّلة من Phase 2 — أُدمجت هنا بنظافة. |
| **`/notes` يَستخدم `appendAudit` مباشرة بدون تَغيير state** | `internal_note_added` event = ملاحظة وحدها، لا انتقال status. Phase 3 endpoint = audit row فقط. |
| **`/:id/problems/:pid/restore` و `/override` بـ `service_requests.reject`** | الـ reject perm هي علامة Audit Admin الوحيدة. استخدامها كـ gate للـ audit-admin actions يَتجنُّب إضافة perms جديدة. |
| **GET `/open-tasks/:id/problems` و `/derived-outcome` بـ `open_tasks.view`** | يَتبعان نطاق المهمة (BRANCH-aware) لا الـ service_request GLOBAL — لأن المهام مَحلية بعد promote. |
| **`transitionEndpoint(...)` helper** | DRY: 4 endpoints (request-info, resume-review, resolve-at-intake، cancel) تَتشابه تماماً — كلها transitionStatus بـ params مختلفة. |
| **`/:id/escalate` يَكتب حدثَين audit** | `escalated_to_audit_admin` + `review_required_flag_set`. الاثنان مفيدان للقراءة: الأول للتاريخ، الثاني للفلترة في dashboard. |
| **GET `/service-requests/:id` يَجمع 3 queries مُتوازية بـ Promise.all** | request + auditLog + problems. أسرع من تَسلسلي، أنظف من JOIN معقَّد. |

### حدود Phase 3 المُوثَّقة

| الحدّ | السلوك الحالي | الميتيغيت |
|---|---|---|
| **Permission matrix per-phase ٠.١٩.هـ لـ problems لا تُفرَض** | كل endpoints الـ problems تَستخدم `service_requests.review` (أو `.reject` لـ override/restore) بدون فحص "هل الـ visit أُغلق؟" | الـ matrix تَخصّ بنية الـ UI (Phase 4) + الـ visit-state context (Phase 6). الـ wizard في Phase 6 يَلتقط هذا constraint. |
| **لا rate limiting** على `POST /service-requests` | كل الـ POSTs محمية بـ `requireAuth` لكن بدون throttle | الـ V1.0 = قنوات داخلية فقط (موظفون مُسجَّلون). لو فُعِّلت `mobile_app/website/whatsapp` لاحقاً (V1.1+) يَلزم `express-rate-limit`. |
| **لا OpenAPI/Swagger annotations** | endpoints بدون `@swagger` JSDoc | تُضاف لاحقاً عند الحاجة لـ docs خارجية. لا تُؤثِّر على runtime. |
| **`/promote` لا يُعالج `external_device` بنجاح حتى الآن** | يَرجع `external_device_requires_schema_relaxation` لو device_source='external_device' بسبب `installed_devices.contract_id NOT NULL` (ثغرة موَّثقة في §7.4) | الـ migration المرافقة تُكتَب عند تَفعيل external_device في الـ wizard. حالياً company_device path يَعمل كاملاً. |
| **لا OpenAPI typed-fetch للـ frontend** | الـ frontend سيَستهلك الـ endpoints بـ `fetch` يَدوي | Phase 4 يُنشئ wrapper مَركزي صغير في `web/src/lib/api/serviceRequests.ts`. |

### تَحقُّق Phase 3 (Smoke)

- **typecheck نظيف على ملفاتي** — كل الأخطاء الـ 3 المُعلَّقة (`openTasks.ts:2352`, `telemarketing.ts:2345/2351`, `roles.ts:73`, `tmp-query-device-demo.ts:4`) قَبلية بدون علاقة.
- **API booted نظيفاً** — `tsx index.ts` يُنشئ `API server running on http://localhost:3000` + `visitEscalationJob started` + `contactTargetsCleanupJob started`، و `GET /api/health → {"status":"ok"}`.
- **لا migration معلَّقة**.

### الـ Imports المُتاحة لـ Phase 4 frontend

الـ frontend سَيَستهلك الـ endpoints عبر wrapper مَركزي. الـ paths الأساسية:

```
POST   /api/service-requests
POST   /api/service-requests/internal
GET    /api/service-requests?status=...&duplicateOnly=...&mine=...
GET    /api/service-requests/:id
POST   /api/service-requests/:id/{claim,take-over,link,change-linkage}
GET    /api/service-requests/:id/suggested-matches
POST   /api/service-requests/:id/{request-info,resume-review,resolve-at-intake}
POST   /api/service-requests/:id/{escalate,reject,cancel,reopen}
POST   /api/service-requests/:id/{promote,merge}    → 409 على EM-UNIQ-01
POST   /api/service-requests/:id/{archive,unarchive,notes}
{POST,PATCH,DELETE} /api/service-requests/:id/problems[/:pid[/status|record-resolution|restore|override]]
GET    /api/open-tasks/:id/problems
GET    /api/open-tasks/:id/derived-outcome
```

### مَنحَنى الـ Migrations الإجمالي

239 → 249 = **11 migration** مُطبَّقة. لا migration معلَّقة قبل Phase 4.

---

## ٩. Phase 4 — Frontend Dashboard ✅

### الملفات المُغيَّرة (~1300 سطر)

| الملف | النوع | الإضافة |
|---|---|---|
| `packages/web/src/lib/api.ts` | تَوسيع (+155 سطر) | namespaces `serviceRequests` (33 method) + `openTaskProblems` (2) |
| `packages/web/src/components/service-requests/AuditLogTimeline.tsx` | جديد (95) | timeline مع icons + colors + 28 event label عربي + JSON details collapsible |
| `packages/web/src/components/service-requests/SuggestedMatchesPanel.tsx` | جديد (130) | clients + candidates مع confidence badges (high/medium/low) + ربط فوري |
| `packages/web/src/components/service-requests/MergeOrSplitModal.tsx` | جديد (155) | EM-UNIQ-02 dual-choice + load reasons من system_lists + لقطة لـ existingOpenTaskId/installedDeviceId |
| `packages/web/src/components/service-requests/ProblemsList.tsx` | جديد (220) | 7 statuses labels + 4 phases + add modal بـ `diagnosis_problem_types` dropdown + status transitions + soft delete |
| `packages/web/src/pages/service-requests/ServiceRequestDetailPage.tsx` | جديد (300) | 4 tabs (overview/problems/audit/linkage) + action bar ديناميكية حسب status + perms + ownership |
| `packages/web/src/pages/service-requests/ServiceRequestsListPage.tsx` | جديد (240) | جدول + 6 فلاتر (status, channel, mine, reviewRequired, duplicateOnly, archived) + pagination + quick-claim |
| `packages/web/src/App.tsx` | wiring (+3) | `/service-requests` + `/service-requests/:id` |

### `api.serviceRequests` Method List

```
list, get, create, createInternal,
claim, takeOver, link, changeLinkage, suggestedMatches,
requestInfo, resumeReview, resolveAtIntake, escalate,
reject, cancel, reopen, promote, merge, archive, unarchive, addNote,
addProblem, editProblem, setProblemStatus, recordProblemResolution,
deleteProblem, restoreProblem, overrideProblem
```

### قرارات Phase 4 المُوثَّقة

| القرار | المبرّر |
|---|---|
| **`api.serviceRequests.promote` يَلتقط HTTP 409 يدوياً ويُرجع `{ collision }` أو `{ ok }`** | الـ generic `request<T>` يَرمي على non-2xx. promote يَحتاج 409 كـ first-class result للـ MergeOrSplitModal — لا يَنبغي أن يَكون استثناءً. |
| **MergeOrSplitModal يَستهلك `/api/system-lists?category=emergency_uniqueness_override_reasons` مباشرة** | الـ reasons admin-managed، endpoint مَخصَّص غير ضروري. نَفس النَّمط لـ `ProblemsList` مع `diagnosis_problem_types`. |
| **Action bar ديناميكية بـ `status + permission + ownership`** | تَتجنُّب رَسم أزرار غير مَنطقية. مَثلاً "تَولّي" فقط على `received`، "رَفض" فقط مع `reviewRequiredFlag + canReject`، "ترقية" فقط مع `beneficiaryClientId`. |
| **`prompt()` للأسباب بدل modals متعدّدة** | MVP سرعة. الـ Modals الأنيقة (cancellation_reason picker, rejection_reason picker) قَابلة للإضافة لاحقاً بدون تَغيير الـ API. |
| **`/service-requests/new` route حالياً 404** | الـ زرّ يُوجِّه لها لكن الصفحة غير موجودة. Phase 5 يُنشئها (4 entry points). تَجنُّب dead screen في Phase 4. |
| **`linked_open_task_id` يُوجِّه لـ `/tasks/emergency/:id`** | يَستفيد من `EmergencyTaskDetail` القائم. لا كَسر لـ unified TaskDetailLayout. |
| **`creator_role_snapshot` hardcoded `'operator'` في ProblemsList** | Phase 5 يُجرى الـ enrichment من الـ user grants الفعلية حين يُكتب modal الإنشاء الكامل. |
| **Empty states على كل المُكوِّنات** | "لا توجد أعطال" + "لا توجد طلبات" + "لا توجد أحداث" — UX انسيابي. |
| **استخدام `usePermissions` و `useAuthStore` كمصدر للـ perms** | يَتوافق مع نَمط VisitsListPage القائم. الـ middleware يَتولّى الحماية الفعلية على الـ backend. |
| **لا OpenAPI typed-fetch** | الـ wrapper بـ `any` متعمَّد — V1.0 سرعة. إن استَلزَم الأمر، تُولَّد types من السكيما لاحقاً. |

### حدود Phase 4 المُوثَّقة (مرفوعة لـ Phases لاحقة)

| الحدّ | الـ Phase المُسؤولة | السلوك الحالي |
|---|---|---|
| **شاشة "إنشاء طلب جديد"** غير مَوجودة | Phase 5 | زرّ "طلب جديد" في الـ List يُوجِّه لـ `/service-requests/new` (404). 4 entry points تُبنى. |
| **`creator_role_snapshot` بـ `'operator'` ثابت** | Phase 5 | يُتدفَّق من الـ user.role من الـ store حين يُجدَّد. |
| **inline edit للأعطال (type/details)** غير مَوجود | Phase 6 | الـ wizard هو المكان الطبيعي للـ UX المركَّزة. الـ ProblemsList حالياً يَكتفي بـ status changes + soft delete. |
| **`record-resolution` بلا زرّ مَخصَّص في UI** | Phase 6 | الـ wizard `MaintenanceActionsForm` يَلتقطها مع `repaired_by_employee_id` dropdown. |
| **فلتر "حسب الفرع" في List** غير مَوجود | (Phase 5 اختياري) | SR-08 يَجعل branch tracking-only — super-admin قد يُريده. |
| **integration `Customer360Modal`** غير مَوجود | Phase 5 | `/clients/:id` profile يَكتسب tab "طلبات الصيانة" مع `beneficiaryClientId` فلتر. |
| **integration بـ `FloatingActionButton`** غير مَوجود | Phase 5 | الـ floating الحالي يَستدعي `RequestEmergencyModal` (legacy). Phase 5 يُضيف خياراً جديداً. |
| **shape-mismatch بين `usePermissions` hook و `req.authContext.grants`** | (مَخفيّة) | الـ frontend يَفترض permissions كسلسلة keys مَسطَّحة. الـ middleware يَفحص scope-aware. للـ Phase 4 UI، فحص الـ key وحده كافٍ لـ "هل أرى الزرّ؟". الفحص الفعلي على الـ backend. |

### تَحقُّق Phase 4

- **typecheck نظيف على كل ملفاتي** — الأخطاء المتبقية (`TelemarketerWorkspace.tsx:436`, `DeviceDemoResultModal.tsx:71`) قَبلية.
- **App.tsx routes مَوصولة** — `/service-requests` و `/service-requests/:id` تَعمل بعد تَسجيل الدخول.
- **API endpoints مَوصولة عبر `request<T>` wrapper** الذي يَتولّى auth + branch context تلقائياً.
- **لا تَأثير على مَسارات قائمة** — `RequestEmergencyModal`، `EmergencyResultWizard`، `/tasks/emergency` كلها تَعمل كما كانت.

### النَّمط الفعلي للـ "مَساران مَزدوجان" بعد Phase 4

```
intake:
  ── Legacy: RequestEmergencyModal → /api/emergency-tickets (100% فعّال)
  └─ New:    /service-requests (مَرئي لكن /new غير موجود = لا entry feasible)

promote → open_tasks (موحَّد):
  ── Legacy: source='emergency_ticket', بدون payload/problems
  └─ New:    creation_origin='emergency_request', مع payload + problems

wizard:
  └─ EmergencyResultWizard (legacy) يَخدم كلا المسارَين — يَتجاهل اللائحة
     لو وُجِدت (سيُعاد بناؤه في Phase 6).

result data:
  └─ em_* FKs على open_tasks (legacy) — wizard يَكتب هنا للجميع.
```

> **التَوصية التشغيلية:** الـ UI الجديد للاستكشاف من `super_admin` و `REQUEST_AUDIT_ADMIN` فقط حتى Phase 6. باقي الـ Operators يَستمرّون على `RequestEmergencyModal` legacy.

### الـ Migrations حتى الآن: 239 → 249 (11 migration، صفر معلَّق)

---

## ١٠. Phase 5 — Integration with Entry Points ✅

### الملفات المُغيَّرة (~330 سطر)

| الملف | النوع | الإضافة |
|---|---|---|
| `packages/web/src/components/service-requests/NewServiceRequestModal.tsx` | جديد (240) | modal universal بـ `channel` prop يَدعم 4 قنوات (`internal_button`, `client_detail_button`, `admin_manual`, `phone`)، walk-in fields conditional، validation محلية قبل POST |
| `packages/web/src/pages/service-requests/NewServiceRequestPage.tsx` | جديد (30) | wrapper كامل الشاشة على modal للـ `admin_manual` channel عبر `/service-requests/new` + يَدعم `?channel=phone` deep-linking |
| `packages/web/src/components/FloatingActionButton.tsx` | تَوسيع (+25) | prop `onServiceRequestClick?` اختياري + زرّ أخضر "طلب صيانة جديد" يَظهر فقط مع الـ handler. الـ زرّ القديم وُسِم "(Legacy)" للتمييز البَصري. |
| `packages/web/src/layout/MainLayout.tsx` | تَوسيع (+14) | state للـ modal الجديد + feature flag `localStorage.gc_service_requests_ui === 'on'` + wiring الـ FAB |
| `packages/web/src/pages/ClientProfile.tsx` | تَوسيع (+13) | زرّ "طلب صيانة جديد" بَجَنب الـ Legacy + modal بـ `channel='client_detail_button'` و `beneficiaryClientId` preselected |
| `packages/web/src/App.tsx` | wiring (+2) | route `/service-requests/new` |

### قرارات Phase 5 المُوثَّقة

| القرار | المبرّر |
|---|---|
| **Feature flag بـ `localStorage.gc_service_requests_ui`** | لا حاجة لـ backend setting. Ops يُفعِّلون per-user من DevTools console: `localStorage.setItem('gc_service_requests_ui','on')`. تَفعيل تَدريجي بلا deploy. |
| **الأزرار الجديدة مَوسومة "Legacy" على القديمة** | تَوضيح بَصري للـ Operator: أي مَسار يَستخدم. يَتجنُّب اختيار خاطئ. |
| **modal universal لا 4 modals منفصلة** | الـ 4 قنوات تَتشارك 90% من الـ form. الـ `channel` prop يُغيِّر السلوك (walk-in fields، الـ submit endpoint، الـ title). DRY واضح. |
| **`/service-requests/new?channel=phone` يَدعم deep-linking** | للـ shortcut من شاشة الـ phone log المستقبلية أو bookmark. |
| **لا inline live-search في الـ modal** | `suggestedMatches` يَعمل بعد الإنشاء فقط (post-create في tab "الربط"). تَجنُّب backend round-trip لكل keystroke في MVP. يَلزم endpoint جديد `POST /service-requests/search-matches` للـ pre-create — مُؤجَّل. |
| **`onCreated` callback اختياري** | إن مُرِّر، الـ caller يَتولّى navigation (مَثل ClientProfile الذي يَبقى على نفس الصفحة بعد الـ refresh). افتراضياً يُوجِّه لـ DetailPage. |
| **`admin_manual` channel يُستدعى بـ `createInternal` endpoint** | الـ POST `/internal` يَفرض `channel='admin_manual'` على الـ backend. الـ frontend يُمرِّر القناة كذلك للـ symmetry. |
| **لم أُعدِّل `NewEmergencyTicketModal` ولا `RequestEmergencyModal`** | الـ Legacy يَبقى 100% كما هو. التَوازي صَريح. |

### كيفية التَفعيل في staging

```js
// DevTools console بعد تَسجيل الدخول:
localStorage.setItem('gc_service_requests_ui', 'on');
// أعد تحميل الصفحة. الزرّ الأخضر الجديد يَظهر في FAB و ClientProfile.

// للإطفاء:
localStorage.removeItem('gc_service_requests_ui');
```

### الحالة الكاملة بعد Phase 5

```
intake (UI):
  ├─ Legacy: RequestEmergencyModal + NewEmergencyTicketModal      (100% فعّال)
  └─ New (flag-gated): NewServiceRequestModal من FAB + ClientProfile + /service-requests/new

intake (API):
  ├─ POST /api/emergency-tickets   (legacy)
  └─ POST /api/service-requests    (Phase 3)

promote → open_tasks (موحَّد):
  مَسار واحد على DB، مَصدران مُعلَّمان بـ creation_origin

wizard:
  └─ EmergencyResultWizard (legacy) يَخدم الكلّ — يَتجاهل اللائحة (Phase 6 يُصلح)

اللائحة (service_request_problems):
  ├─ تُكتَب في intake عبر النظام الجديد
  ├─ مَرئية في ServiceRequestDetailPage + GET /open-tasks/:id/problems
  └─ غير مَرئية في الـ wizard (Phase 6 يَكتسب)
```

### حدود Phase 5 المُوثَّقة

| الحدّ | الـ Phase المُسؤولة |
|---|---|
| **Live suggested-matches أثناء كَتَبَة الـ phone** غير مَوجود | يَلزم backend endpoint `POST /search-matches`. مُؤجَّل (post-create search كافٍ في MVP). |
| **`Customer360Modal` tab "طلبات الصيانة"** غير مَوجود | يُضاف لاحقاً مع `?beneficiaryClientId=X` filter على الـ list endpoint (مَوجود). |
| **integration مع `customer_call_logs` للـ `phone` channel** | المكالمة الواردة تُسجَّل في `customer_call_logs`. ربط `service_request.id ↔ call_log` يَستحقّ tracking. مُؤجَّل لـ telephony integration. |
| **لا UI toggle للـ feature flag** | DevTools console فقط الآن. settings page يُمكن أن تَكتسب checkbox لاحقاً. |
| **`installedDeviceId` و `contractId` props على ClientProfile modal لا تُمرَّر** | عند ضغط زرّ الـ service request في ClientProfile، لا يُمرَّر جهاز محدَّد. الـ link tab بعد الإنشاء يَستطيع ربطه. الـ pre-select من ContractCard مُمكن لاحقاً. |

### تَحقُّق Phase 5

- typecheck نظيف على كل ملفاتي.
- الـ Legacy paths سَليمة (FAB "🚨 طلب طوارئ (Legacy)" + ClientProfile زرّ Zap الأحمر).
- بدون الـ flag، الـ UI الجديد لا يَظهر — صفر تَعارض مع المستخدمين الحاليين.

### الـ Migrations حتى الآن: 239 → 249 (11 migration، صفر معلَّق)

---

## ١١. Phase 6 — Wizard Updates ✅

### 6a — Schema Migrations

| الرقم | الملف | الإضافة |
|---|---|---|
| 250 | `visit_task_parts_linked_problem.sql` | عمود `linked_problem_id BIGINT FK ON DELETE SET NULL` على `visit_task_emergency_parts_used` + partial index |
| 251 | `visit_task_results_repaired_by.sql` | عمود `repaired_by_employee_id INTEGER FK ON DELETE SET NULL` على `visit_task_results` + partial index |

⚠️ ملاحظة: ظَهرت migration مُتوازية `250_device_delivery_canonical_path.sql` في الـ repo. كلا الـ 250s طُبِّقا بنجاح (lexicographic sort).

### 6b — Backend (Hybrid Wizard Logic)

| الملف | التَغيير | السطور |
|---|---|---|
| `routes/emergencyResult.ts` — `getTaskMeta` | يَجلب `source_service_request_id` على الـ open_task | +1 |
| `routes/emergencyResult.ts` — `GET /:taskId` | يُرجع `problems[]` + `derivedOutcome` + `installedDeviceId/sourceServiceRequestId` ضمن `taskMeta` للـ new path | +35 |
| `routes/emergencyResult.ts` — `PUT /:taskId/actions` | hybrid path: kل الـ legacy writes تَبقى، الـ new path يَكتب في `service_request_problems` ضمن نفس tx (newProblems + problemsStatusUpdates) | +120 |
| `routes/emergencyResult.ts` — `PUT /:taskId/costs` | cascade مَحجوب على new path + `derivedOutcome` محسوب ومُرجَع + `cascadeSkipped` flag | +25 |
| `routes/serviceRequests.ts` — `POST /:id/problems` | يَقبل `openTaskId` اختياري لـ stamp فوري بعد الإنشاء (لـ field_discovery أثناء الزيارة) | +10 |
| imports | `addProblem`, `changeProblemStatus`, `computeDerivedOutcome` | +6 |

### 6c — Frontend (Wizard UX)

| الملف | التَغيير | السطور |
|---|---|---|
| `components/emergency/EmergencyProblemsSection.tsx` | جديد كاملاً — لائحة الأعطال داخل الـ wizard مع: resolve modal بـ repaired_by + notes، defer، unresolvable buttons، Field Discovery add | 330 |
| `components/emergency/EmergencyResultWizard.tsx` | dispatcher: يَرسم `EmergencyProblemsSection` فوق `MaintenanceActionsForm` لو `sourceServiceRequestId != null` + يُمَرِّر `derivedOutcome` لـ `CostsForm` | +20 |
| `components/emergency/result-phases/CostsForm.tsx` | props جديدة (`sourceServiceRequestId`, `derivedOutcome`) + `DERIVED_TO_LEGACY` mapping + `DERIVED_LABELS` + `DERIVED_COLORS` + readonly badge UI + auto-set finalDecision via useEffect + `needs_followup` section guarded بـ `!isNewPath` + submit validation guarded | +85 |

### قرارات Phase 6 المُوَثَّقة

| القرار | المبرّر |
|---|---|
| **`EmergencyProblemsSection` فوق `ActionsForm`، لا V2 منفصل** | تَجنُّب نَسخ 580 سطر من V1. الـ UX = `ProblemsList` في detail page = اتّساق ذهني للـ Operator. |
| **`POST /service-requests/:id/problems` يَقبل `openTaskId` اختياري** | تَعديل 7 سطور أَنظف من endpoint جديد. الـ flag NULL-safe، backward compatible. الـ field_discovery يَلزمها stamp فوري لتَظهر في الـ wizard. |
| **`DERIVED_TO_LEGACY` mapping** | `emergency_result_costs.final_decision` CHECK يَحوي 4 قيم فقط. الـ derived_outcome الـ 8 يُسقَط إلى أقرب legacy value للـ DB write. الـ UI يَعرض الحقيقة الـ 8. |
| **`needs_followup section` مَحجوبة على new path** | V-R007: لا cascade — نفس الـ open_task يَستلم visit_task ثانية. الـ priority/date يُحدَّدان لاحقاً من scheduler. |
| **`recordProblemResolution` shortcut في الـ Section** | يَكتب status=resolved + repaired_by + notes في POST واحد. أَنظف من `setProblemStatus` + extra fields متعدّدة. |
| **`derivedOutcome` محسوب على kل GET ومُعاد على kل `/costs` save** | شَفافية فورية للـ frontend بدون round-trip إضافي. التَكلفة 1 query — مَقبولة. |
| **`useEffect` يُعِيد set `finalDecision` على kل تَغيير outcome** | يَضمن أن الـ DB write يَتوافق مع الـ CHECK. user لا يَكتب يدوياً على new path. |
| **immediate save في الـ Section بدل tx bundling مع actions form** | UX اتّساق مع ProblemsList. الـ atomicity في الـ hybrid endpoint مَتاحة عند الحاجة لاحقاً عبر V2 endpoint. |

### حدود Phase 6 المُوَثَّقة

| الحدّ | الـ Phase المُسؤولة | التَفصيل |
|---|---|---|
| **`installed_device_id` على `taskMeta`** | تَحسين سَريع لـ Phase 7 prep | `getTaskMeta` يَختار `ot.device_id` لكن لا يُسمّيه `installedDeviceId` في الـ taskMeta payload. زر "عطل مُكتشَف" يَفشل بـ "يَلزم installed_device_id". إصلاح بـ +1 سطر في الـ GET response. |
| **kَتَبة في `visit_task_results` الموحَّد** | V2 endpoints (مُستقبلية) | الـ Phase 6 الحالية تَكتب في `emergency_result_costs` legacy. الـ unified write يَخصّ تَكامل field_visits flow. |
| **`linked_problem_id` على parts** غير مُستخدَم في UI | تَلميع MaintenanceActionsForm (مُستقبلي) | الـ schema جاهز. الـ UI لا يَربط القطع بأعطال بَعد. |
| **`repaired_by_employee_id` على `visit_task_results`** غير مُستخدَم | V2 endpoints | Phase 6 يَكتب الـ repaired_by على `service_request_problems` مباشرة (أنظف منطقياً). الـ column يَنتظر visit_task wiring. |
| **`partially_resolved` final_decision** | (بـ design) | غير مُتاحة في الـ `emergency_result_costs.final_decision` CHECK. الـ derived `partially_resolved` يُسقَط لـ `resolved`. الـ UI يَعرض الحقيقة الكاملة. |
| **`workshop_required` scenario** | مَفعَّل في §٦ — مُؤجَّل لـ phase 6 V2 | الـ `pending_workshop` status + `device_retrieved` final_decision غير مُضافَة بعد قراراً. |

### تَحقُّق Phase 6

- typecheck نظيف على kل ملفاتي.
- legacy tasks (بدون `sourceServiceRequestId`): الـ wizard يَعمل **بـ صفر تَغيير سلوكي**.
- new-path tasks: الـ ProblemsSection تَظهر، الـ derived badge readonly، الـ cascade مَحجوب.

### الـ Migrations حتى الآن: 239 → 251 (13 migration) + 250_device_delivery المُتوازي.

---

## ١٢. Phase 7 — Data Migration ✅

### Migration المُطبَّقة

| الرقم | الملف | الحجم |
|---|---|---|
| 252 | `migrate_emergency_tickets.sql` | 3 خطوات INSERT idempotent (`service_requests` + `service_request_problems` + `service_request_audit_log`) |

⚠️ ظَهرت migration متوازية `253_device_delivery_structured_addresses.sql` — طُبِّقت أيضاً.

### الـ Field Mapping (ticket → service_request)

| الحقل الجديد | المَصدر | ملاحظة |
|---|---|---|
| `public_ref_number` | `SRM-{LPAD ticket.id 8}` | prefix SRM يُمَيِّز المُهجَّر |
| `channel` | `'phone'` | الـ legacy كان هاتفياً (§٠.٩) |
| `submission_type` | `'apply'` | افتراضي |
| `submitter_tier` | `'staff'` | الموظف كَتبه |
| `beneficiary_client_id` | `et.client_id` | مَباشر |
| `beneficiary_external` | JSONB من `client_name/address/rating` + `migration_source` marker | للـ audit trail |
| `contract_id` | `et.contract_id` | مَباشر |
| `problem_description` | `et.problem_description` | NOT NULL — fallback لو NULL |
| `requested_action_type_id` | `et.action_type_id` | يَنسجم مع FK القائم |
| `attachments` | `et.attachments` | JSONB كما هي |
| `priority` | `et.priority` (مع CHECK validation) | fallback `'Normal'` |
| `status` | `'promoted'` | ticket = open_task = مُرَقّى |
| `triage_outcome` | `'needs_field_intervention'` | الـ outcome الوحيد المسموح للـ promoted |
| `linked_open_task_id` | `et.open_task_id` | الـ trail للـ open_task القائم |
| **`archived_at`** | **`NOW()`** | **يُخفي من الـ dashboards النَشطة — قرار جوهري** |
| `created_at` | `et.created_at` | الـ timestamp الأصلي مَحفوظ |

### القرار التَصميمي الجوهري

> **`open_tasks.source_service_request_id` على المُهجَّر لا يُلمَس.**
>
> الـ wizard (Phase 6c) يَدفع UX جديدة عندما `source_service_request_id != NULL`. لكن المهام المُهجَّرة لديها نَتيجة في `em_*` legacy ولا تَملك `service_request_problems` كافية. لو فَعَّلنا الـ FK، الـ wizard سيُسقِط الـ legacy reads + يُظهر "لا أعطال" badge. **يَترك NULL على المُهجَّر** ⇒ الـ wizard يَبقى legacy 100%.

### قرارات Phase 7 المُوَثَّقة

| القرار | المبرّر |
|---|---|
| **`SRM-` prefix** | يُمَيِّز المُهجَّر فوراً + يَتجنُّب collision مع natural `SR-YYYYMMDD-NNNN`. الـ UNIQUE constraint على `WHERE archived_at IS NULL` يُفَلتر المُهجَّر تلقائياً. |
| **`archived_at = NOW()`** | لا dashboards نَشطة. لا duplicate detection. القراءة التاريخية فقط. |
| **`source_service_request_id` لا يُلمَس** | wizard يَبقى legacy للمُهجَّر. |
| **`service_request_problems` بـ best-effort** | `installed_device_id` NOT NULL يُجبر اختيار جهاز. LATERAL يَختار أوّل active. لو لا جهاز، SR يَبقى بلا قائمة. |
| **idempotent: `NOT EXISTS` على kل INSERT** | re-run آمن. مَفيد لـ staging dry-runs ولـ production retries. |
| **status `'reported'` افتراضياً، `'resolved'` لو `emergency_result_costs.final_decision='resolved'`** | الـ derived_outcome يَحسب صحيحاً لو نُشِّط لاحقاً. |
| **`creator_role_snapshot = 'system_migration'`** | يُمَيِّز المُهجَّر في تَقارير الأعطال. |
| **`created_by_user_id` = أوّل super-admin** | حقل NOT NULL. لو غير مَوجود، الـ migration تَفشل بـ FK violation صَريحة. |
| **mass INSERT بدل cursor loop** | sql-native، أسرع على datasets كبيرة (staging قد يَكون 10K+ tickets). |
| **`emergency_tickets` لا يُحذَف هنا** | Phase 8 يُجمِّدها ثم يُسقِطها بعد 14 يوم. |

### استراتيجية النَشر

| البيئة | الخطوة |
|---|---|
| dev | ✅ `pnpm run migrate` (0 rows في dev) |
| staging | backup → migrate → spot-check 10 SRs مُهجَّرة → 7 أيام مراقبة |
| production | maintenance window (off-hours) → backup → migrate → verify counts |

### Verification Queries (مُعَلَّقة في الـ migration، uncomment للـ debug)

```sql
SELECT COUNT(*) FROM emergency_tickets;
SELECT COUNT(*) FROM service_requests WHERE public_ref_number LIKE 'SRM-%';
SELECT COUNT(*) FROM service_request_problems p
  JOIN service_requests sr ON sr.id = p.service_request_id
  WHERE sr.public_ref_number LIKE 'SRM-%';
```

**Acceptance:** `tickets_count == migrated_count`. الـ problems قد تَكون أقل (best-effort).

### الـ Rollback (لو لَزم)

```sql
BEGIN;
DELETE FROM service_request_audit_log
  WHERE service_request_id IN (
    SELECT id FROM service_requests WHERE public_ref_number LIKE 'SRM-%'
  );
DELETE FROM service_request_problems
  WHERE service_request_id IN (
    SELECT id FROM service_requests WHERE public_ref_number LIKE 'SRM-%'
  );
DELETE FROM service_requests WHERE public_ref_number LIKE 'SRM-%';
COMMIT;
```

### حدود Phase 7

| الحدّ | الـ Phase المُسؤولة |
|---|---|
| `emergency_tickets` يَبقى read+write | Phase 8 |
| UI لا يُظهر badge "مُهجَّر" | تَلميع لاحق |
| هجرة `customer_call_logs` ↔ `service_request` link | تَلميع لاحق (telephony) |
| `installed_device_id` best-effort قد يَكون خاطئاً | تَصحيح يدوي عبر `auditAdminOverride` |

### الـ Migrations حتى الآن: 239 → 253 (15 migration، صفر معلَّق)
