# Prompt: Domain Constitution for Field Visits (الزيارات الميدانية)

## Objective

Build the **complete, authoritative Domain Constitution** for the `field_visits` entity and its related sub-entities in Golden CRM. This is the **central operations entity** that bridges planning (telemarketing), execution (open_tasks), and results (contracts/clients).

Follow the exact same template and quality standard established by the `clients` pilot.

The output must be:
- **Comprehensive**: Every field, constraint, rule, relationship, state, test case documented.
- **Mixed language**: Arabic explanations, English field/code references.
- **Source-truthful**: Extracted directly from migrations, route handlers, policies, services, and shared types.
- **Critical**: Document ALL gaps, contradictions, or inconsistencies found between sources.

---

## Output Files

1. `docs/constitution/domains/field-visits.md` — The full Field Visits constitution
2. Update `docs/constitution/INDEX.md` — Add field-visits row
3. Update `docs/constitution/CROSS-REFERENCE.md` — Add field_visits, visit_tasks, visit_task_results, name_collections, direct_suggestions
4. If new gaps discovered: `docs/constitution/GAPS-TRACKER.md` — Add GAP-027, GAP-028, etc.

---

## Step 1: Read ALL Source Files

### A. Database Schema (Migrations)
Read EVERY migration file that touches `field_visits` or related tables:

```
migrations/050_telemarketing_appointment_visit_tasks.sql   (appointment → visit link)
migrations/051_marketing_visits_mvp.sql                    (legacy marketing_visits — check relation)
migrations/058_appointment_visit_open_task_link.sql         (appointment → open_task → visit)
migrations/070_visit_core_schema.sql                        (CREATE TABLE field_visits, visit_tasks — CRITICAL)
migrations/071_field_visits_ended_status.sql                 (ended_at status)
migrations/072_backfill_marketing_visits.sql               (data migration)
migrations/073_emergency_details_link_to_result.sql          (emergency link)
migrations/075_marketing_visit_tasks_per_instance.sql        (visit_tasks per instance)
migrations/080_visit_sources.sql                           (source tracking)
migrations/081_visit_geo_logs.sql                          (geo logging)
migrations/082_visit_name_collections.sql                  (name collections table)
migrations/083_direct_suggestions.sql                      (direct suggestions table)
migrations/087_marketing_visit_tasks_result_fields.sql     (result fields on visit_tasks)
migrations/089_refactor_task_outcomes.sql                  (outcome refactoring)
migrations/090_add_offered_device_model.sql                (device model offering)
migrations/091_marketing_visit_task_offers.sql             (task offers table)
migrations/130_applied_device_discount_id.sql
migrations/138_task_offer_contract_link.sql                (offer → contract link)
migrations/143_device_delivery_results.sql                 (delivery results)
migrations/146_field_visit_reassignment.sql                (visit reassignment)
migrations/147_visit_tasks_device_demo.sql                 (device demo tasks)
migrations/148_migrate_marketing_visits.sql               (marketing_visits migration)
migrations/149_visit_task_postsale_results.sql            (post-sale results)
migrations/150_backfill_postsale_results.sql              (backfill)
migrations/152_drop_marketing_visits_legacy.sql            (drop legacy)
migrations/155_visit_tasks_contract_id.sql                  (contract linkage)
migrations/165_field_visits_appointment_snapshot.sql        (appointment snapshot)
migrations/166_answered_by_and_visit_referral_sheets.sql    (referral sheets)
migrations/167_snapshot_backfill.sql                       (snapshot backfill)
```

Also read related tables:
```
migrations/055_open_tasks.sql
migrations/102_open_tasks_phase_zero_fields.sql
migrations/142_contract_device_tracking.sql
migrations/145_device_installation_results.sql
```

For each, extract:
- Columns on `field_visits`, `visit_tasks`, `visit_task_results`
- Sub-tables: `visit_name_collections`, `direct_suggestions`, `marketing_visit_task_offers`
- Constraints (CHECK, FK, UNIQUE, NOT NULL, DEFAULT)
- Indexes created

### B. API Layer
```
packages/api/routes/fieldVisits.ts              (ALL 12 endpoints)
packages/api/routes/visits.ts                   (legacy visits — check if still used)
packages/api/routes/emergencyResult.ts           (emergency results)
packages/api/policies/fieldVisitPolicy.ts       (if exists — check!)
```

### C. Shared Types
```
packages/shared/types.ts
packages/shared/types/authorization.ts
```

### D. System Configuration
```
migrations/026_contracts_tasks_permissions_seeding.sql
migrations/027_contracts_tasks_departments_permissions_seeding.sql
migrations/054_permissions_allowed_scopes.sql
```

---

## Step 2: Build the Constitution Document

Write `docs/constitution/domains/field-visits.md` with the following sections.

Use this language rule throughout:
> **عناوين السكاشن والشرح بالعربي. أسماء الحقول والأكواد بالإنجليزي.**

---

### Section 1: هوية الكيان (Identity)

```markdown
## 1. هوية الكيان (Entity Identity)

- **الاسم العربي**: الزيارة الميدانية
- **الاسم الإنجليزي**: Field Visit
- **الجداول الرئيسية**: `field_visits`, `visit_tasks`, `visit_task_results`
- **الجداول الفرعية**: `visit_name_collections`, `direct_suggestions`, `marketing_visit_task_offers`
- **الوصف**: كيان التنفيذ الميداني. يمثل زيارة فعلية لفريق أو فرد لموقع الزبون. تحتوي على مهام فرعية (visit_tasks) كل واحدة بنوعها ونتيجتها. الزيارة بتربط التخطيط (telemarketing appointment) بالتنفيذ (task results) والنتيجة (contract/lead).
- **الجداول المرتبطة**: clients, contracts, open_tasks, telemarketing_appointments, employees, workScopes, task_type_config
- **الأهمية**: Core execution entity — كل شي بيمر من هون (الزيارة = "لب المشروع").
```

---

### Section 2: الجدول والحقول (Table & Field Dictionary) ⭐ MOST IMPORTANT

#### 2.1 `field_visits` — الزيارة الميدانية

Document EVERY field:

- `id` — SERIAL or UUID?
- `client_id` → FK to clients.id
- `contract_id` → FK to contracts.id (nullable — visit may exist before contract)
- `appointment_id` → FK to telemarketing_appointments.id (nullable)
- `open_task_id` → FK to open_tasks.id (which task generated this visit?)
- `branch_id` — branch context
- `team_key` — assigned team
- `employee_id` — assigned individual
- `status` — what values? ('scheduled', 'in_progress', 'completed', 'cancelled'?)
- `visit_date`, `visit_time` — VARCHAR or TIMESTAMP?
- `started_at`, `ended_at` — when did the visit actually start/end?
- `gps_coordinates` — JSONB? Lat/lng of actual visit location
- `source` — how was this visit created? ('telemarketing', 'emergency', 'manual'?)
- `address_snapshot` — TEXT — address at time of visit (immutable?)
- `client_snapshot` — JSONB — client data snapshot
- `referral_sheet_id` — added in 166
- `created_at`, `updated_at`

#### 2.2 `visit_tasks` — مهام الزيارة

- `id` — PK
- `field_visit_id` → FK
- `task_type` → FK to task_type_config.task_type
- `sequence_number` — order within visit
- `status` — what values? ('pending', 'in_progress', 'completed', 'skipped'?)
- `result_status` — what values? ('success', 'failure', 'partial', 'pending'?)
- `started_at`, `completed_at`
- `notes` — TEXT
- `contract_id` — linked contract (if task resulted in sale)
- `offered_device_model_id` — added in 090
- `result_fields` — JSONB (added in 087) — stores task-specific results

#### 2.3 `visit_task_results` — نتائج المهام

This table may have been split into specialized result tables. Check:
- `visit_task_device_delivery_results` (migration 143)
- `visit_task_device_installation_results` (migration 145)
- `visit_task_device_demo_results` (migration 147)
- `visit_task_device_activation_results`
- `visit_task_postsale_results` (migration 149)

Document each specialized result table's fields.

#### 2.4 `visit_name_collections` — جمع الأسماء

- `id` — PK
- `field_visit_id` or `visit_task_id` → FK
- `collected_names` — JSONB array of {name, phone, relation}
- `collected_by` → hr_users
- `collected_at`

#### 2.5 `direct_suggestions` — الترشيحات المباشرة

- `id` — PK
- `field_visit_id` or `visit_task_id` → FK
- `client_id` — the referred person (must exist in clients?)
- `suggestion_type` — what values?
- `notes`
- `created_at`

#### 2.6 `marketing_visit_task_offers` — عروض المهام

- `id` — PK
- `visit_task_id` → FK
- `offer_type`, `offer_amount`
- `applied_discount_id` — linked to device_discounts
- `status` — what values? ('offered', 'accepted', 'rejected'?)
- `contract_id` — if offer converted to contract

---

### Section 3: القيود والقواعد (Constraints & Business Rules)

Document at minimum:

#### BR-1: Visit Lifecycle State Machine ⭐ CRITICAL

```
[scheduled] → POST /:id/start → [in_progress]
[in_progress] → POST /:id/end → [completed] (if all tasks done)
[in_progress] → POST /:id/complete → [completed] (force complete)
[any] → (cancel) → [cancelled]
```

What happens to visit_tasks when visit is cancelled?
What happens to open_task when visit completes?

#### BR-2: Visit Task Execution Flow

```
Visit started → tasks executed in sequence
Each task:
  1. Task started (auto or manual?)
  2. Task executed (delivery/installation/demo/name_collection/etc.)
  3. Result recorded (in specialized result table)
  4. Task marked completed
Visit ends when all tasks completed or force-completed
```

#### BR-3: Name Collection Task

```
POST /visit-tasks/:taskId/name-collection
→ creates visit_name_collections row
→ collected_names = [{name, phone, relation, notes}]
```

What happens to collected names? Do they become candidates? Clients?

#### BR-4: Direct Suggestions Task

```
POST /visit-tasks/:taskId/direct-suggestions
→ creates direct_suggestions row
→ client_id = referred person
```

How does a direct suggestion differ from name_collection?

#### BR-5: Device Offering → Contract Linkage

```
visit_task.offered_device_model_id → device_discounts
if offer accepted → contract created
contract linked back to visit_task (contract.source_visit, contract.source_open_task_id)
```

#### BR-6: Geo Logging

```
GET /:id/geo — returns visit GPS coordinates
Are coordinates logged automatically (mobile app) or manually?
```

#### BR-7: Source Tracking

```
GET /:id/source — returns how this visit was created
source chain: telemarketing_appointment → open_task → field_visit
```

#### BR-8: Reassignment

```
POST /:id/reassign (or similar) — can a visit be reassigned to another team/employee?
migration 146: field_visit_reassignment
```

#### BR-9: Snapshot Immutability

```
address_snapshot, client_snapshot on field_visits
Are these set at visit creation and never changed?
```

#### BR-10: Legacy marketing_visits Dropped

```
migration 152: DROP marketing_visits
All legacy data migrated to field_visits + visit_tasks
```

---

### Section 4: العلاقات (Relationships)

Include ER diagram (mermaid) showing:

```
field_visits }o--|| clients : "for client"
field_visits }o--|| contracts : "for contract"
field_visits }o--|| telemarketing_appointments : "from appointment"
field_visits }o--|| open_tasks : "from task"
field_visits }o--|| employees : "assigned to"
field_visits }o--|| workScopes : "team"
field_visits ||--o{ visit_tasks : "contains"
visit_tasks }o--|| task_type_config : "task type"
visit_tasks ||--o| visit_name_collections : "name collection"
visit_tasks ||--o| direct_suggestions : "direct suggestion"
visit_tasks ||--o| marketing_visit_task_offers : "offers"
visit_tasks ||--o| visit_task_device_delivery_results : "delivery result"
visit_tasks ||--o| visit_task_device_installation_results : "installation result"
visit_tasks ||--o| visit_task_device_demo_results : "demo result"
visit_tasks ||--o| visit_task_postsale_results : "post-sale result"
```

---

### Section 5: آلة الحالات (State Machine)

#### 5.1 Visit Status
```
[scheduled] ──start──► [in_progress] ──end/complete──► [completed]
      │                                    │
      └───cancel──► [cancelled]           │
                                           └───force──► [completed] (partial)
```

#### 5.2 Visit Task Status
```
[pending] ──start──► [in_progress] ──complete──► [completed]
   │                      │
   └──skip────────────► [skipped]
```

#### 5.3 Result Status
```
[pending] → (task executed) → [success] / [failure] / [partial]
```

---

### Section 6: صلاحيات الوصول (Permission Matrix)

| الإذن | المفتاح | النطاق | الوصف |
|---|---|---|---|
| عرض الزيارات | `marketing_visits.view` | BRANCH | عرض قائمة وتفاصيل |
| تعديل نتيجة | `marketing_visits.update_result` | BRANCH | start, end, complete, name-collection, direct-suggestions |

**CRITICAL:** These permissions use `marketing_visits.*` namespace, not `field_visits.*`. Document this legacy naming.

---

### Section 7: عقد API (API Contract)

| الطريقة | المسار | الصلاحية | وصف |
|---|---|---|---|
| POST | `/api/field-visits/:id/start` | `marketing_visits.update_result` | بدء الزيارة |
| POST | `/api/field-visits/:id/end` | `marketing_visits.update_result` | إنهاء الزيارة |
| GET | `/api/field-visits/:id/geo` | `marketing_visits.view` | إحداثيات الزيارة |
| GET | `/api/field-visits/:id/source` | `marketing_visits.view` | مصدر الزيارة |
| GET | `/api/field-visits` | `marketing_visits.view` | قائمة الزيارات |
| GET | `/api/field-visits/:id` | `marketing_visits.view` | تفاصيل الزيارة |
| POST | `/api/field-visits/visit-tasks/:taskId/name-collection` | `marketing_visits.update_result` | جمع أسماء |
| PUT | `/api/field-visits/name-collections/:id/record-names` | `marketing_visits.update_result` | تسجيل أسماء |
| GET | `/api/field-visits/name-collections/:id` | `marketing_visits.view` | عرض أسماء |
| POST | `/api/field-visits/visit-tasks/:taskId/direct-suggestions` | `marketing_visits.update_result` | ترشيح مباشر |
| GET | `/api/field-visits/visit-tasks/:taskId/direct-suggestions` | `marketing_visits.view` | عرض ترشيحات |
| POST | `/api/field-visits/:id/complete` | `marketing_visits.update_result` | إكمال الزيارة |

Query parameters for GET /:
- Check fieldVisits.ts for filters (date, team_key, status, branch_id, etc.)

---

### Section 8: حالات الاختبار الشاملة (Test Cases) ⭐ COMPREHENSIVE

Include at minimum:

| # | السيناريو | Method | Inputs | Expected |
|---|---|---|---|---|
| TC-01 | بدء زيارة | POST /:id/start | visit_id | 200 + started_at set |
| TC-02 | إنهاء زيارة | POST /:id/end | visit_id | 200 + ended_at set |
| TC-03 | إكمال زيارة | POST /:id/complete | visit_id | 200 + status=completed |
| TC-04 | جمع أسماء | POST /visit-tasks/:taskId/name-collection | names array | 200 + name_collections row |
| TC-05 | تسجيل أسماء | PUT /name-collections/:id/record-names | names | 200 + updated |
| TC-06 | ترشيح مباشر | POST /visit-tasks/:taskId/direct-suggestions | client_id | 200 + suggestion row |
| TC-07 | عرض تفاصيل | GET /:id | visit_id | 200 + visit + tasks + results |
| TC-08 | إلغاء زيارة | (if exists) | — | 200 + status=cancelled |
| TC-09 | زيارة بدون appointment | GET /:id/source | source='manual' | يعيد المصدر |
| TC-10 | مهام الزيارة | GET /:id | — | يعيد visit_tasks array |
| TC-11 | نتيجة توصيل | (delivery task) | — | visit_task_device_delivery_results |
| TC-12 | geo tracking | GET /:id/geo | — | يعيد {lat, lng} |

---

### Section 9: الثغرات والتضاربات (Gaps & Contradictions) ⭐ CRITICAL

Look for and document:

1. **Permission naming** — `marketing_visits.*` for `field_visits` entity — legacy mismatch
2. **No visit creation endpoint** — How are field_visits created? Only from telemarketing appointments? Or manually? There may be NO POST / for creating a visit directly.
3. **visit_tasks.result_fields JSONB** — What structure? Is it validated? Can it be inconsistent?
4. **Name collections → candidates** — Do collected names automatically create candidates? Or require manual entry?
5. **Direct suggestions vs referrers** — What's the difference between direct_suggestions and clients.referrers?
6. **Legacy marketing_visits** — Migration 152 dropped it. Was all data migrated correctly?
7. **Snapshot vs live data** — address_snapshot and client_snapshot — are they actually immutable?
8. **No soft-delete** — Are visits hard-deleted? What happens to visit_tasks, results, name_collections?
9. **Contract auto-creation** — Does a successful visit_task with offer automatically create a contract? Or require manual confirmation?
10. **GPS coordinates accuracy** — Are they validated? What format? (lat/lng decimal degrees?)

---

### Section 10: تاريخ التغييرات (Schema Changelog)

Document EVERY migration that touched field_visits, visit_tasks, or related tables.

---

## Step 3: Update Supporting Files

### INDEX.md
Add row:
```
| الزيارات الميدانية (Field Visits) | [domains/field-visits.md](domains/field-visits.md) | ✅ مكتمل | [XX] سطر | [YY]+ | [ZZ] |
```

### CROSS-REFERENCE.md
Add:
- `field_visits`, `visit_tasks`, `visit_task_results` tables to inventory
- `visit_name_collections`, `direct_suggestions`, `marketing_visit_task_offers` to inventory
- `result_status` enum
- Specialized result tables (delivery, installation, demo, postsale)
- Update ER diagram

### GAPS-TRACKER.md
If new gaps found (GAP-027+), add them.

---

## Verification Checklist

- [ ] `field-visits.md` contains all 10 sections
- [ ] `field_visits` table: 15+ fields documented
- [ ] `visit_tasks` table: 10+ fields documented
- [ ] Specialized result tables documented (delivery, installation, demo, postsale)
- [ ] `visit_name_collections`, `direct_suggestions` documented
- [ ] Visit lifecycle state machine documented
- [ ] Visit task execution flow documented
- [ ] All 12 endpoints documented
- [ ] At least 12 test cases
- [ ] At least 5 gaps identified
- [ ] INDEX.md, CROSS-REFERENCE.md, GAPS-TRACKER.md updated
- [ ] TypeScript check passes
- [ ] pm2 restart succeeds
- [ ] Git commit: `docs(constitution): complete field-visits domain constitution`

---

## Notes for the Executor

1. **field_visits is the execution hub.** It connects planning → execution → results. Read every migration carefully.
2. **visit_tasks is the sub-task system.** Each visit can have multiple tasks (delivery, installation, demo, name_collection, etc.).
3. **Specialized result tables exist.** Check migrations 143, 145, 147, 149 for delivery, installation, demo, postsale result tables.
4. **Name collections and direct suggestions are sub-features.** Document them fully even though they're small tables.
5. **No direct visit creation endpoint?** Check if there's a POST /api/field-visits. If not, document how visits are created (only from appointments?).
6. **Permission naming is legacy.** `marketing_visits.*` is used — same issue as open_tasks.
7. **Use exact SQL types** from migrations.
8. **Examples must be realistic** — Syrian context, realistic team keys, visit dates.
