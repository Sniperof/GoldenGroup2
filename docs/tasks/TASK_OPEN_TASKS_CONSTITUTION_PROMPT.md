# Prompt: Domain Constitution for Open Tasks (المهام المفتوحة)

## Objective

Build the **complete, authoritative Domain Constitution** for the `open_tasks` entity and its related sub-entities in Golden CRM. This is the **most complex operations entity** in the system with 20 endpoints, 30+ migrations, and deep connections to clients, contracts, field visits, and task results.

Follow the exact same template and quality standard established by the `clients` pilot.

The output must be:
- **Comprehensive**: Every field, constraint, rule, relationship, state, test case documented.
- **Mixed language**: Arabic explanations, English field/code references.
- **Source-truthful**: Extracted directly from migrations, route handlers, policies, services, and shared types.
- **Critical**: Document ALL gaps, contradictions, or inconsistencies found between sources.

---

## Output Files

1. `docs/constitution/domains/open-tasks.md` — The full Open Tasks constitution
2. Update `docs/constitution/INDEX.md` — Add open-tasks row
3. Update `docs/constitution/CROSS-REFERENCE.md` — Add open_tasks and all related tables
4. If new gaps discovered: `docs/constitution/GAPS-TRACKER.md` — Add GAP-017, GAP-018, etc.

---

## Step 1: Read ALL Source Files

### A. Database Schema (Migrations)
Read EVERY migration file that touches `open_tasks` or related tables. These are critical:

```
migrations/055_open_tasks.sql                     (CREATE TABLE open_tasks — baseline)
migrations/056_open_tasks_constraints.sql           (CHECK constraints, FKs)
migrations/057_open_task_link.sql                 (client_id, contract_id linkage)
migrations/058_appointment_visit_open_task_link.sql (appointment linkage)
migrations/066_open_tasks_emergency.sql            (emergency-related fields)
migrations/068_open_tasks_snapshots.sql            (snapshot fields)
migrations/069_fix_emergency_unique.sql
migrations/070_visit_core_schema.sql               (field_visit_id linkage)
migrations/072_backfill_marketing_visits.sql
migrations/075_marketing_visit_tasks_per_instance.sql
migrations/076_scope_tasks.sql                       (scope_id linkage)
migrations/077_expand_open_tasks.sql               (major expansion — read carefully!)
migrations/084_task_activity_log.sql               (task_activity_log table)
migrations/085_call_task_links.sql                 (call_task_links table)
migrations/086_open_task_devices.sql               (open_task_devices table)
migrations/092_open_task_pre_offers.sql            (open_task_pre_offers table)
migrations/102_open_tasks_phase_zero_fields.sql    (phase zero — pre-planning)
migrations/103_open_tasks_waiting_phase.sql        (waiting phase)
migrations/104_fix_closed_by_employee_fk.sql
migrations/105_rename_statuses_and_add_phases.sql   (STATUS RENAMING — CRITICAL)
migrations/108_open_tasks_assigned_phase.sql
migrations/116_emergency_result_phases.sql         (emergency result fields)
migrations/117_emergency_result_enhancements.sql
migrations/118_emergency_decision_reasons.sql
migrations/121_emergency_payment_entries.sql
migrations/134_pre_offer_applied_discount.sql
migrations/137_fix_open_tasks_unique_index.sql
migrations/138_task_offer_contract_link.sql
migrations/142_contract_device_tracking.sql        (task_type FK)
migrations/144_delivery_task_permissions.sql
migrations/145_device_installation_results.sql
migrations/148_migrate_marketing_visits.sql
migrations/150_backfill_postsale_results.sql
```

Also read related tables:
```
migrations/106_task_type_config.sql          (task_type_config — FK target)
migrations/113_task_type_config_location_basis.sql
migrations/116_emergency_result_phases.sql  (emergency result tables)
migrations/142_contract_device_tracking.sql   (open_tasks.task_type FK to task_type_config)
```

For each, extract:
- Columns added/modified on `open_tasks`
- New related tables created (activity_log, devices, calls, pre_offers, emergency results)
- Constraints (CHECK, FK, UNIQUE, NOT NULL, DEFAULT)
- Indexes created
- **Status/phase migrations** — CRITICAL: the status field was renamed multiple times

### B. API Layer
```
packages/api/routes/openTasks.ts              (ALL 20 endpoints — this is a HUGE file)
packages/api/routes/taskTypeConfig.ts          (task types configuration)
packages/api/routes/emergencyResult.ts        (emergency result sub-routes)
packages/api/routes/emergencyActionTypes.ts     (action types for emergencies)
packages/api/policies/                        (check if there's an openTasks policy)
packages/api/services/assignedTasks.ts          (task assignment logic)
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
migrations/144_delivery_task_permissions.sql
```

---

## Step 2: Build the Constitution Document

Write `docs/constitution/domains/open-tasks.md` with the following sections.

Use this language rule throughout:
> **عناوين السكاشن والشرح بالعربي. أسماء الحقول والأكواد بالإنجليزي.**

---

### Section 1: هوية الكيان (Identity)

```markdown
## 1. هوية الكيان (Entity Identity)

- **الاسم العربي**: المهمة المفتوحة
- **الاسم الإنجليزي**: Open Task
- **اسم الجدول**: `open_tasks`
- **الوصف**: كيان العمليات المركزي. يمثل مهمة قابلة للتنفيذ (توصيل، تركيب، صيانة طارئة، جمع أسماء، إلخ...) مرتبطة بزبون وعقد وفرع. تمر بعدة phases (مراحل) من الإنشاء للإكمال.
- **الجداول المرتبطة**: clients, contracts, field_visits, task_type_config, workScopes, task_activity_log, open_task_devices, call_task_links, open_task_pre_offers, emergency_results...
- **الأهمية**: Core operations entity — كل العمليات الميدانية بتبدأ من هون.
```

---

### Section 2: الجدول والحقول (Table & Field Dictionary) ⭐ MOST IMPORTANT

#### 2.1 `open_tasks` — الجدول الرئيسي

Document **EVERY** field. The table evolved through 30+ migrations — some fields may seem redundant or renamed. Track the history.

Critical fields:

- `id` — UUID or SERIAL? (check 055_open_tasks.sql)
- `client_id` → FK to clients.id
- `contract_id` → FK to contracts.id (nullable — tasks can exist without contract)
- `branch_id` — branch context
- `task_type` → FK to task_type_config.task_type (replaced old CHECK constraint in 142)
- `task_family` — what values? ('marketing', 'service', 'emergency'?)
- `status` — ⭐ CRITICAL: This was RENAMED. Check migration 105 for the exact current values.
  - Old values may have been: 'pending', 'in_progress', 'completed'
  - Current values likely: 'open', 'assigned', 'in_progress', 'waiting', 'closed', 'cancelled', 'excluded'
  - Document ALL values and their meanings
- `phase` — ⭐ Added in migration 105. What phases exist?
  - Likely: 'zero' (pre-planning), 'assigned', 'in_progress', 'waiting', 'completed'
- `reason` — VARCHAR — purpose of the task (free text or enum?)
- `due_date` — DATE or TIMESTAMP
- `source` — where did this task originate? ('manual', 'contract', 'telemarketing', 'emergency'?)
- `origin` — similar to source? Check difference
- `zone_id` — geographic zone
- `scope_id` → FK to workScopes?
- `team_key` — assigned team identifier
- `employee_id` — assigned individual employee
- `assigned_at` — when was it assigned?
- `closed_at` — when was it closed?
- `closed_by` — who closed it?
- `closed_reason` — why was it closed?
- `excluded` — BOOLEAN — is this task excluded from normal lists?
- `excluded_at`, `excluded_by`, `excluded_reason`
- `snapshot_*` fields — added in 068. What client data is snapshotted? (name, address, phone?)
- `waiting_since` — added in 103
- `waiting_reason` — added in 103
- `device_status` — if device-related task
- `pre_offer_id` — linked pre-offer
- `source_visit_id`, `source_appointment_id` — origin tracking
- `created_at`, `updated_at`

#### 2.2 `task_activity_log` — سجل نشاط المهمة

- `id`, `open_task_id` → FK
- `activity_type` — what values? ('status_change', 'assignment', 'comment', 'result'?)
- `old_value`, `new_value`
- `performed_by` → hr_users
- `performed_at`
- `notes`

#### 2.3 `open_task_devices` — الأجهزة المرتبطة بالمهمة

- `id`, `open_task_id` → FK
- `device_model_id`
- `serial_number`
- `installation_status`
- `notes`

#### 2.4 `call_task_links` — ربط المكالمات بالمهام

- `id`, `open_task_id`, `call_log_id`
- Why does this exist? (telemarketing tasks linked to call logs)

#### 2.5 `open_task_pre_offers` — العروض المسبقة

- `id`, `open_task_id`
- `offer_type`, `offer_amount`, `discount_id`
- `applied_discount_id` (added in 134)
- `status` — what values?

#### 2.6 `emergency_results` — نتائج الطوارئ (linked via open_task_id)

This is a complex sub-entity. Check:
- `emergency_tickets` vs `emergency_results` — what's the difference?
- Fields: pre_state, post_state, actions, costs, parts_used, payment_entries, installments
- Status: is this per-task or per-ticket?

---

### Section 3: القيود والقواعد (Constraints & Business Rules)

Document at minimum:

#### BR-1: Status / Phase State Machine ⭐ CRITICAL

This is THE most important business rule for open_tasks.

Migration 105 renamed statuses and added phases. Document the COMPLETE state machine:

```
Phase Zero (pre-planning):
  [open/zero] → (assignment) → [assigned]

Active phases:
  [assigned] → (team accepts) → [in_progress]
  [in_progress] → (waiting for parts/customer) → [waiting]
  [waiting] → (parts arrived / customer ready) → [in_progress]

Terminal phases:
  [in_progress] → (task completed with result) → [closed/completed]
  [assigned/in_progress/waiting] → (cancelled) → [cancelled]
  [any] → (excluded) → [excluded] (hidden from normal lists)
```

What triggers each transition? Which endpoints?
- POST /:id/assign-team → assigned
- PATCH /:id (status update) → in_progress, waiting, cancelled
- POST /:id/exclude → excluded
- POST /:id/restore → back to previous status
- POST /bulk-exclude, POST /bulk-restore

#### BR-2: Task Type System (task_type_config)

`open_tasks.task_type` is a FOREIGN KEY to `task_type_config.task_type` (since migration 142).

What task types exist?
- 'device_delivery'
- 'device_installation'
- 'device_demo'
- 'emergency'
- 'name_collection'
- 'direct_suggestion'
- 'periodic_maintenance'
- etc.

Each task type may have different:
- Required fields
- Result forms (delivery result, installation result, demo result, emergency result)
- Permissions
- Auto-generated follow-up tasks

#### BR-3: Team Assignment vs Individual Assignment

```
team_key: assigned to a team (workScopes)
employee_id: assigned to individual
```
Can both exist? What's the priority? How does assignment propagate?

#### BR-4: Exclusion Logic

```
excluded = TRUE → task disappears from normal lists
excluded_at, excluded_by, excluded_reason → audit trail
POST /:id/restore → brings it back
POST /bulk-exclude, POST /bulk-restore → batch operations
```

What's the difference between `excluded` and `cancelled`?

#### BR-5: Emergency Task Result Flow

```
open_task (task_type='emergency') → emergency_result
emergency_result has:
  - pre_state (technical state before)
  - post_state (technical state after)
  - actions taken (array of action_type_ids)
  - costs (array)
  - parts_used (array)
  - payment_entries
  - installments
```

How is the emergency result created? (POST /:id/emergency-result)
How does it link to contracts/payments?

#### BR-6: Snapshot System

```
snapshot_fields on open_tasks:
  - client name, address, phone at time of task creation
  - Why? Because client data may change, but task needs original info
```

When are snapshots taken? Are they immutable?

#### BR-7: Permission Naming Inconsistency ⭐ LIKELY GAP

Looking at the route code:
```javascript
requirePermission('marketing_visits.view')
requirePermission('marketing_visits.update_result')
```

But the entity is `open_tasks`! Are the permissions really named `marketing_visits.*`?
Check the permissions table and seeding migrations. This is likely a legacy naming issue.

#### BR-8: Device Lifecycle Integration

```
Contract created → auto-creates open_task (device_delivery)
Delivery task completed → device_status='delivered'
Installation task created/completed → device_status='installed'
```

How do tasks drive the device lifecycle in contracts?

---

### Section 4: العلاقات (Relationships)

Include ER diagram (mermaid) showing:

```
open_tasks }o--|| clients : "for client"
open_tasks }o--|| contracts : "for contract"
open_tasks }o--|| field_visits : "via field_visit_id"
open_tasks }o--|| task_type_config : "task type"
open_tasks }o--|| workScopes : "team scope"
open_tasks ||--o{ task_activity_log : "activities"
open_tasks ||--o{ open_task_devices : "devices"
open_tasks ||--o{ call_task_links : "call logs"
open_tasks ||--o{ open_task_pre_offers : "pre offers"
open_tasks ||--o| emergency_results : "emergency result"
open_tasks }o--|| employees : "assigned to"
```

---

### Section 5: آلة الحالات (State Machine)

Document the COMPLETE state machine with phases:

```
[open/zero] ──assign──► [assigned] ──accept──► [in_progress]
                              │                    │
                              │──cancel──► [cancelled]
                              │                    │
                              │               ──wait──► [waiting]
                              │                    │      │
                              │                    │◄─────┘ (resume)
                              │                    │
                              │               ──complete──► [closed]
                              │
                              └──exclude──► [excluded] ──restore──► [previous]
```

Also document:
- What happens to `excluded` tasks? (filtered from lists but not deleted)
- Can a `closed` task be reopened?
- What's the difference between `closed` and `cancelled`?

---

### Section 6: صلاحيات الوصول (Permission Matrix)

**CRITICAL — Check actual permission keys!**

Looking at code:
```javascript
requirePermission('marketing_visits.view')
requirePermission('marketing_visits.update_result')
```

But check migrations 026, 027, 054 for the REAL permission names. They might be:
- `open_tasks.view`
- `open_tasks.create`
- `open_tasks.edit`
- `open_tasks.delete`
- OR legacy: `marketing_visits.view`, `marketing_visits.update_result`

Document WHAT EXISTS in the DB vs what the CODE uses. This is likely a major gap.

| الإذن (Code uses) | الإذن (DB might have) | النطاق | الوصف |
|---|---|---|---|
| `marketing_visits.view` | ??? | ??? | عرض المهام |
| `marketing_visits.update_result` | ??? | ??? | تعديل نتيجة / حالة |

---

### Section 7: عقد API (API Contract)

| الطريقة | المسار | الصلاحية | وصف |
|---|---|---|---|
| GET | `/api/open-tasks` | `marketing_visits.view` | قائمة المهام |
| POST | `/api/open-tasks` | `marketing_visits.update_result` | إنشاء مهمة |
| GET | `/api/open-tasks/client/:clientId` | `marketing_visits.view` | مهام زبون |
| GET | `/api/open-tasks/device-demo` | `marketing_visits.view` | مهام عرض الجهاز |
| POST | `/api/open-tasks/:id/assign-team` | `marketing_visits.update_result` | تخصيص فريق |
| GET | `/api/open-tasks/:id` | `marketing_visits.view` | تفاصيل مهمة |
| PATCH | `/api/open-tasks/:id` | `marketing_visits.update_result` | تعديل حالة/phase |
| GET | `/api/open-tasks/:id/emergency-result` | `marketing_visits.view` | نتيجة طوارئ |
| POST | `/api/open-tasks/:id/emergency-result` | `marketing_visits.update_result` | إضافة نتيجة طوارئ |
| GET | `/api/open-tasks/scope/:scopeId` | `marketing_visits.view` | مهام نطاق |
| POST | `/api/open-tasks/:id/assign-scope` | `marketing_visits.update_result` | تخصيص نطاق |
| POST | `/api/open-tasks/:id/exclude` | `marketing_visits.update_result` | استبعاد |
| POST | `/api/open-tasks/:id/restore` | `marketing_visits.update_result` | استعادة |
| POST | `/api/open-tasks/bulk-exclude` | `marketing_visits.update_result` | استبعاد دفعة |
| POST | `/api/open-tasks/bulk-restore` | `marketing_visits.update_result` | استعادة دفعة |
| GET | `/api/open-tasks/:id/activity` | `marketing_visits.view` | سجل النشاط |
| POST | `/api/open-tasks/:id/activity` | `marketing_visits.update_result` | إضافة نشاط |
| GET | `/api/open-tasks/:id/devices` | `marketing_visits.view` | أجهزة المهمة |
| POST | `/api/open-tasks/:id/devices` | `marketing_visits.update_result` | إضافة جهاز |
| GET | `/api/open-tasks/:id/calls` | `marketing_visits.view` | مكالمات المهمة |

**Query parameters:** Check the route handlers for filters (status, phase, branchId, date range, etc.)

---

### Section 8: حالات الاختبار الشاملة (Test Cases) ⭐ COMPREHENSIVE

Include at minimum:

| # | السيناريو | Method | Inputs | Expected |
|---|---|---|---|---|
| TC-01 | إنشاء مهمة توصيل | POST / | task_type='device_delivery', client_id, contract_id | 200 + task created |
| TC-02 | إنشاء مهمة بدون client | POST / | بدون client_id | 400 |
| TC-03 | تخصيص فريق | POST /:id/assign-team | team_key='team_a' | 200 + assigned_at set |
| TC-04 | تحديث phase | PATCH /:id | {status:'in_progress', phase:'in_progress'} | 200 + activity log |
| TC-05 | استبعاد مهمة | POST /:id/exclude | {reason:'customer_not_available'} | 200 + excluded=true |
| TC-06 | استعادة مهمة | POST /:id/restore | — | 200 + excluded=false |
| TC-07 | عرض سجل نشاط | GET /:id/activity | — | يعيد array of activities |
| TC-08 | إضافة نتيجة طوارئ | POST /:id/emergency-result | {pre_state, post_state, actions, costs} | 200 + emergency result |
| TC-09 | مهام الزبون | GET /client/:clientId | clientId=1024 | يعيد كل المهام |
| TC-10 | استبعاد دفعة | POST /bulk-exclude | {ids:[1,2,3], reason:'seasonal'} | 200 + all excluded |
| TC-11 | تعديل مهمة مكتملة | PATCH /:id | status='completed' → try change | 400 (locked?) |
| TC-12 | فلترة حسب phase | GET /?phase=in_progress | — | يعيد بس in_progress |
| TC-13 | device demo tasks | GET /device-demo | — | يعيد مهام العرض |
| TC-14 | cross-branch visibility | GET / | user from branch 2 | يعيد مهام فرع 2 فقط |

---

### Section 9: الثغرات والتضاربات (Gaps & Contradictions) ⭐ CRITICAL

Look for and document:

1. **Permission naming mismatch** — Code uses `marketing_visits.view` but entity is `open_tasks`. Are permissions seeded with `marketing_visits.*` or `open_tasks.*`? This is CRITICAL.
2. **Status vs Phase confusion** — Are both needed? What's the difference? Why was status renamed?
3. **task_type_config.location_basis** — Some task types are location-based. How does this affect assignment?
4. **No soft-delete** — Are tasks hard-deleted? What happens to activity logs, emergency results?
5. **Missing GET / for pre-offers** — `open_task_pre_offers` exists but is there an endpoint?
6. **Duplicate table: marketing_visit_tasks** — Is this legacy? What's the migration path?
7. **Snapshot immutability** — Are snapshots truly immutable? Can they be refreshed?
8. **Waiting phase logic** — What triggers `waiting`? Can a task wait indefinitely?
9. **Contract auto-task creation** — When a contract is created, how are delivery/installation tasks linked?
10. **Emergency result orphaning** — If emergency_result is deleted, what happens to payment_entries and installments?

---

### Section 10: تاريخ التغييرات (Schema Changelog)

Document EVERY migration that touched open_tasks, task_activity_log, open_task_devices, call_task_links, open_task_pre_offers, emergency_results.

---

## Step 3: Update Supporting Files

### INDEX.md
Add row:
```
| المهام المفتوحة (Open Tasks) | [domains/open-tasks.md](domains/open-tasks.md) | ✅ مكتمل | [XX] سطر | [YY]+ | [ZZ] |
```

### CROSS-REFERENCE.md
Add:
- `open_tasks` to branch_id, status, created_at tables
- `task_activity_log`, `open_task_devices`, `call_task_links`, `open_task_pre_offers` to Table Inventory
- Relationships diagram update
- `task_type_config` table info

### GAPS-TRACKER.md
If new gaps found (GAP-017+), add them following the exact same format.

---

## Verification Checklist

- [ ] `open-tasks.md` contains all 10 sections
- [ ] `open_tasks` table: 25+ fields documented with migration history
- [ ] Sub-tables documented: activity_log, devices, calls, pre_offers
- [ ] Status/Phase state machine fully documented
- [ ] Task types from task_type_config documented
- [ ] All 20 endpoints documented
- [ ] Permission naming discrepancy identified and documented
- [ ] At least 14 test cases
- [ ] At least 5 gaps identified
- [ ] INDEX.md, CROSS-REFERENCE.md, GAPS-TRACKER.md updated
- [ ] TypeScript check passes
- [ ] pm2 restart succeeds
- [ ] Git commit: `docs(constitution): complete open-tasks domain constitution`

---

## Notes for the Executor

1. **This is the MOST COMPLEX entity.** 20 endpoints, 30+ migrations, 5+ sub-tables. Take your time.
2. **The status/phase system is CRITICAL.** Migration 105 renamed things. Read it carefully.
3. **Permission naming is WEIRD.** `marketing_visits.view` for `open_tasks` route. Document this as a likely legacy issue.
4. **Do NOT skip sub-tables.** `task_activity_log`, `open_task_devices`, `call_task_links`, `open_task_pre_offers` must all be documented.
5. **task_type_config is important.** It's the FK target for task types. Know what types exist.
6. **Use exact SQL types** from migrations.
7. **Examples must be realistic** — Syrian context.
