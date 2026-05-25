# Prompt: Domain Constitution for Telemarketing (التسويق الهاتفي)

## Objective

Build the **complete, authoritative Domain Constitution** for the `telemarketing` entity and its related sub-entities in Golden CRM. Follow the exact same template and quality standard established by the `clients` pilot.

The output must be:
- **Comprehensive**: Every field, constraint, rule, relationship, state, test case documented.
- **Mixed language**: Arabic explanations, English field/code references.
- **Source-truthful**: Extracted directly from migrations, route handlers, policies, services, and shared types.
- **Critical**: Document ALL gaps, contradictions, or inconsistencies found between sources.

---

## Output Files

1. `docs/constitution/domains/telemarketing.md` — The full Telemarketing constitution
2. Update `docs/constitution/INDEX.md` — Add telemarketing row
3. Update `docs/constitution/CROSS-REFERENCE.md` — Add telemarketing tables, fields, relationships
4. If new gaps discovered: `docs/constitution/GAPS-TRACKER.md` — Add GAP-022, GAP-023, etc.

---

## Step 1: Read ALL Source Files

### A. Database Schema (Migrations)
Read EVERY migration file that touches telemarketing or related tables:

```
migrations/001_core_tables.sql                    (CREATE TABLE telemarketing_task_lists, telemarketing_task_list_items, telemarketing_call_logs, telemarketing_appointments)
migrations/014_branch_id_domain_tables.sql        (branch linkage)
migrations/045_contact_targets.sql                (CREATE TABLE contact_targets)
migrations/046_telemarketing_permissions_seeding.sql
migrations/047_telemarketing_contact_target_linkage.sql
migrations/048_telemarketing_outcome_expand.sql   (outcome enum expansion)
migrations/049_cleanup_null_branch_telemarketing_data.sql
migrations/050_telemarketing_appointment_visit_tasks.sql
migrations/051_marketing_visits_mvp.sql
migrations/054_permissions_allowed_scopes.sql
migrations/057_open_task_link.sql
migrations/058_appointment_visit_open_task_link.sql
migrations/064_customer_call_logs.sql             (customer_call_logs — related but separate)
migrations/074_telemarketing_appointments_book_permission.sql
migrations/093_backfill_call_task_links.sql
migrations/097_telemarketing_call_logs_outcome_add_missing.sql
migrations/098_telemarketing_rejection_reschedule_reasons.sql
migrations/107_contact_targets_closed_status.sql
migrations/151_contact_targets_add_date.sql
migrations/154_contact_targets_zone_unique.sql
migrations/166_answered_by_and_visit_referral_sheets.sql
```

For each, extract:
- Columns on telemarketing tables
- Constraints (CHECK, FK, UNIQUE, NOT NULL, DEFAULT)
- Indexes created
- Outcome enums and their values

### B. API Layer
```
packages/api/routes/telemarketing.ts          (ALL 9 endpoints)
packages/api/routes/contactTargets.ts         (contact_targets endpoints)
packages/api/routes/customerCalls.ts          (call logs — related but separate entity)
packages/api/policies/telemarketingPolicy.ts   (if exists — check!)
packages/api/services/telemarketingScope.ts   (scope logic)
```

### C. Shared Types
```
packages/shared/types.ts
packages/shared/telemarketingOutcomes.ts       (likely contains outcome enums)
packages/shared/types/authorization.ts
```

### D. System Configuration
```
migrations/046_telemarketing_permissions_seeding.sql
migrations/054_permissions_allowed_scopes.sql
migrations/074_telemarketing_appointments_book_permission.sql
```

---

## Step 2: Build the Constitution Document

Write `docs/constitution/domains/telemarketing.md` with the following sections.

Use this language rule throughout:
> **عناوين السكاشن والشرح بالعربي. أسماء الحقول والأكواد بالإنجليزي.**

---

### Section 1: هوية الكيان (Identity)

```markdown
## 1. هوية الكيان (Entity Identity)

- **الاسم العربي**: التسويق الهاتفي
- **الاسم الإنجليزي**: Telemarketing
- **الجداول الرئيسية**: `telemarketing_task_lists`, `telemarketing_task_list_items`, `telemarketing_call_logs`, `telemarketing_appointments`, `contact_targets`
- **الوصف**: نظام إدارة الاتصالات الهاتفية بالزبائن والمرشحين. يشمل: كشوف الاتصال (task lists)، تسجيل المكالمات (call logs)، حجز المواعيد (appointments)، وأهداف الاتصال (contact targets).
- **الجداول المرتبطة**: candidates, clients, open_tasks, field_visits, branches, hr_users
- **الأهمية**: Operations core — الوسيط بين التخطيط والميدان.
```

---

### Section 2: الجدول والحقول (Table & Field Dictionary) ⭐ MOST IMPORTANT

#### 2.1 `telemarketing_task_lists` — كشوف الاتصال

- `id` — VARCHAR(100) PK (not SERIAL — UUID or custom ID?)
- `team_key` — VARCHAR(100) NOT NULL
- `date` — VARCHAR(50) NOT NULL
- `created_at` — TIMESTAMPTZ
- `UNIQUE (team_key, date)`

#### 2.2 `telemarketing_task_list_items` — بنود الكشف

- `id` — VARCHAR(100) PK
- `task_list_id` → FK to telemarketing_task_lists(id) ON DELETE CASCADE
- `entity_type` — CHECK ('candidate', 'client') — ⭐ who can be called?
- `entity_id` — INTEGER NOT NULL
- `name`, `mobile` — VARCHAR
- `contact_number`, `contact_label` — alternative contact info
- `address_text`, `geo_unit_id` — location
- `status` — DEFAULT 'pending', CHECK ('pending', 'called', 'booked') — ⭐ what values?
- `call_outcome` — what values? ('no_answer', 'busy', 'rejected', 'booked', 'rescheduled'?)

#### 2.3 `telemarketing_call_logs` — سجل المكالمات

- `id` — VARCHAR(100) PK
- `entity_type` — CHECK ('candidate', 'client')
- `entity_id` — INTEGER NOT NULL
- `task_list_id` → FK (nullable?)
- `team_key` — VARCHAR(100) NOT NULL
- `outcome` — ⭐ CRITICAL: CHECK with specific values. Check migration 048 (expand), 097 (add missing), 098 (rejection reasons). Document ALL possible values.
- `contact_label`, `contact_number`
- `notes` — TEXT
- `timestamp` — TIMESTAMPTZ DEFAULT NOW()
- `called_by` → hr_users.id
- `communication_method` — VARCHAR(30)
- `rejection_reason` — added in 098 — what values?
- `reschedule_reason` — added in 098 — what values?
- `answered_by` — added in 166 — who answered the call?

#### 2.4 `telemarketing_appointments` — مواعيد التسويق

- `id` — VARCHAR(100) PK
- `entity_type` — CHECK ('candidate', 'client')
- `entity_id` — INTEGER NOT NULL
- `customer_name`, `customer_address`, `customer_mobile`
- `team_key` — VARCHAR(100) NOT NULL
- `date`, `time_slot` — VARCHAR(50)
- `occupation`, `water_source` — snapshot fields (why?)
- `notes` — TEXT
- `created_at`, `created_by`
- `status` — what values? (confirmed, cancelled, completed?)

#### 2.5 `contact_targets` — أهداف الاتصال

- `id` — VARCHAR(100) PK
- `target_type` — what values? ('candidate', 'client'?)
- `target_id` — INTEGER
- `branch_id` — branch context
- `zone_id` — geographic zone
- `date` — target date
- `status` — what values? Check 107 (closed_status). Likely: 'open', 'closed', 'booked'?
- `closed_at`, `closed_by`, `closed_reason`
- `expected_count`, `actual_count` — metrics?

---

### Section 3: القيود والقواعد (Constraints & Business Rules)

Document at minimum:

#### BR-1: Outcome System ⭐ CRITICAL

The `outcome` field in `telemarketing_call_logs` has evolved through multiple migrations:

```
Migration 001 (baseline):   'no_answer', 'busy', 'rejected', 'booked'
Migration 048 (expand):     added more values?
Migration 097 (add missing): added 'rescheduled', 'call_back', 'wrong_number'?
Migration 098 (rejection/reschedule reasons): added structured reasons
```

Document the COMPLETE set of valid outcomes, rejection reasons, and reschedule reasons.
Check `packages/shared/telemarketingOutcomes.ts` for the source of truth.

#### BR-2: Appointment → Open Task Linkage

```
When an appointment is booked:
  1. telemarketing_appointment row created
  2. open_task may be auto-created (migration 050, 058)
  3. field_visit may be auto-created from appointment (migration 050)
```

Document the full trigger chain: appointment → open_task → field_visit.

#### BR-3: Call Log → Task Linkage

```
call_task_links table:
  call_log_id ↔ open_task_id
```

When is this link created? What does it enable? (Can a call generate a service task?)

#### BR-4: Entity Type Polymorphism

```
entity_type IN ('candidate', 'client')
```

Both candidates AND clients can be called and booked. How does the system handle the difference?
- candidates: may convert to clients
- clients: already have contracts
- When a candidate is called → booked → visited → converts to client, what happens to the call log?

#### BR-5: Contact Target Lifecycle

```
[open] → (calls made) → [booked] → (appointment completed) → [closed]
   │
   └── (not reachable) → [closed with reason]
```

What closes a contact_target? Manual or automatic?

#### BR-6: Team Key System

```
team_key = 'team_a_2026_05_20'
```

How is team_key structured? What does it reference? (workScopes? day_schedules?)

#### BR-7: Snapshot Fields

```
telemarketing_appointments.occupation, water_source
```

Why are these snapshotted at appointment time? (Because client data may change before the visit.)

---

### Section 4: العلاقات (Relationships)

Include ER diagram (mermaid) showing:

```
telemarketing_task_lists ||--o{ telemarketing_task_list_items : "contains"
telemarketing_task_list_items }o--|| candidates : "entity_type='candidate'"
telemarketing_task_list_items }o--|| clients : "entity_type='client'"
telemarketing_task_list_items ||--o{ telemarketing_call_logs : "generates calls"
telemarketing_task_list_items ||--o| telemarketing_appointments : "books appointment"
telemarketing_call_logs ||--o| call_task_links : "links to tasks"
telemarketing_appointments ||--o| open_tasks : "creates task"
telemarketing_appointments ||--o| field_visits : "creates visit"
contact_targets }o--|| branches : "belongs to"
contact_targets }o--|| zones : "target zone"
```

---

### Section 5: آلة الحالات (State Machine)

#### 5.1 Task List Item Lifecycle
```
[pending] → (call made) → [called] ──► [booked] ──► (appointment completed) → [done]
   │
   └── (not reachable) → [excluded/closed]
```

#### 5.2 Appointment Lifecycle
```
[scheduled] → (confirmed) → [confirmed] ──► (visit done) → [completed]
   │
   └── (cancelled) → [cancelled]
```

#### 5.3 Contact Target Lifecycle
```
[open] → (calls in progress) → [in_progress] ──► [closed]
```

#### 5.4 Call Log Outcomes
```
[outcome enum]:
  - no_answer: no response
  - busy: line busy
  - rejected: person refused
  - booked: appointment set
  - rescheduled: moved to another time
  - call_back: requested callback
  - wrong_number: incorrect contact
```

---

### Section 6: صلاحيات الوصول (Permission Matrix)

| الإذن | المفتاح | النطاق | الوصف |
|---|---|---|---|
| عرض كشوف الاتصال | `telemarketing.lists.view` | BRANCH | عرض task lists والـ snapshot |
| إنشاء/تعديل كشف | `telemarketing.lists.generate` | BRANCH | upsert و generate-from-plan |
| تسجيل مكالمة | `telemarketing.calls.create` | BRANCH | إضافة call log |
| حجز موعد | `telemarketing.appointments.book` | BRANCH | إنشاء appointment |
| عرض أهداف الاتصال | `contact_targets.view` | BRANCH | عرض contact_targets |
| إدارة أهداف الاتصال | `contact_targets.manage` | BRANCH | تعديل contact_targets |

**CRITICAL NOTE:** Check if these permissions exist in the DB (migration 046, 054) or if there's a naming mismatch.

---

### Section 7: عقد API (API Contract)

| الطريقة | المسار | الصلاحية | وصف |
|---|---|---|---|
| GET | `/api/telemarketing/snapshot` | `telemarketing.lists.view` | snapshot للكشف الحالي |
| POST | `/api/telemarketing/task-lists/upsert` | `telemarketing.lists.generate` | إنشاء/تعديل كشف |
| POST | `/api/telemarketing/task-lists/generate-from-plan` | `telemarketing.lists.generate` | توليد كشف من الخطة |
| PATCH | `/api/telemarketing/task-lists/:taskListId/items/:itemId` | `telemarketing.calls.create` | تحديث بند (status, outcome) |
| POST | `/api/telemarketing/call-logs` | `telemarketing.calls.create` | تسجيل مكالمة |
| POST | `/api/telemarketing/appointments` | `telemarketing.appointments.book` | حجز موعد |
| POST | `/api/telemarketing/task-lists/:taskListId/items/:itemId/close` | `telemarketing.calls.create` | إغلاق بند |
| GET | `/api/telemarketing/task-type-options` | `telemarketing.calls.create` | خيارات أنواع المهام |
| POST | `/api/telemarketing/service-tasks` | `telemarketing.calls.create` | إنشاء مهمة خدمة |

Also document:
- `GET /api/contact-targets` (from contactTargets.ts)
- `POST /api/contact-targets` (from contactTargets.ts)

---

### Section 8: حالات الاختبار الشاملة (Test Cases) ⭐ COMPREHENSIVE

Include at minimum:

| # | السيناريو | Method | Inputs | Expected |
|---|---|---|---|---|
| TC-01 | تسجيل مكالمة ناجحة | POST /call-logs | entity_type='client', outcome='booked' | 200 + call log |
| TC-02 | تسجيل مكالمة برفض | POST /call-logs | outcome='rejected', rejection_reason='not_interested' | 200 |
| TC-03 | حجز موعد | POST /appointments | client_id, date, time_slot | 200 + appointment + auto open_task? |
| TC-04 | إنشاء كشف من الخطة | POST /task-lists/generate-from-plan | plan_id, date, team_key | 200 + task list with items |
| TC-05 | تحديث بند لـ booked | PATCH /items/:itemId | status='booked' | 200 + item updated |
| TC-06 | إغلاق بند | POST /items/:itemId/close | — | 200 + item closed |
| TC-07 | عرض snapshot | GET /snapshot | team_key, date | يعيد task list + items + stats |
| TC-08 | مكالمة لـ candidate | POST /call-logs | entity_type='candidate' | 200 + candidate not affected |
| TC-09 | مكالمة لـ client | POST /call-logs | entity_type='client' | 200 + client call history updated |
| TC-10 | حجز موعد لزبون له عقد نشط | POST /appointments | client_id with active contract | 200 + linked to contract? |
| TC-11 | توليد مهمة خدمة | POST /service-tasks | call_log_id, task_type | 200 + open_task created |
| TC-12 | رفض مع سبب | POST /call-logs | outcome='rejected', rejection_reason='price' | 200 + reason stored |

---

### Section 9: الثغرات والتضاربات (Gaps & Contradictions) ⭐ CRITICAL

Look for and document:

1. **Outcome values mismatch** — What does `telemarketingOutcomes.ts` say vs what migrations allow? Any values in TS but not in DB CHECK?
2. **Appointment auto-task creation** — Is it guaranteed? What if the auto-task creation fails?
3. **Contact target closure** — Who can close? Is it automatic when all items are booked/closed?
4. **No PUT/PATCH for appointments** — Can appointments be rescheduled? Only via creating a new one?
5. **Call logs for deleted clients/candidates** — What happens to call logs if the entity is soft-deleted?
6. **Communication_method** — What values? Is it validated?
7. **team_key format** — Is it validated against workScopes or day_schedules?
8. **Duplicate appointments** — Can the same client have multiple appointments on the same day?
9. **Snapshot inconsistency** — `telemarketing_appointments` has `occupation` and `water_source` but clients table moved `water_source` to appointment-only. Is this aligned?
10. **ASSIGNED scope** — Do telemarketing permissions support ASSIGNED scope? Or only BRANCH?

---

### Section 10: تاريخ التغييرات (Schema Changelog)

Document every migration that touched telemarketing tables.

---

## Step 3: Update Supporting Files

### INDEX.md
Add row:
```
| التسويق الهاتفي (Telemarketing) | [domains/telemarketing.md](domains/telemarketing.md) | ✅ مكتمل | [XX] سطر | [YY]+ | [ZZ] |
```

### CROSS-REFERENCE.md
Add:
- `telemarketing_task_lists`, `telemarketing_task_list_items`, `telemarketing_call_logs`, `telemarketing_appointments`, `contact_targets` to Table Inventory
- `outcome` enum values to shared documentation
- `entity_type` ('candidate', 'client') pattern
- Relationships to ER diagram

### GAPS-TRACKER.md
If new gaps found (GAP-022+), add them.

---

## Verification Checklist

- [ ] `telemarketing.md` contains all 10 sections
- [ ] 5 tables documented with all fields
- [ ] Outcome enum fully documented (all values from migrations + shared types)
- [ ] Rejection/reschedule reasons documented
- [ ] Appointment → open_task → field_visit trigger chain documented
- [ ] Call log → task link documented
- [ ] All 9 endpoints documented
- [ ] At least 12 test cases
- [ ] At least 5 gaps identified
- [ ] INDEX.md, CROSS-REFERENCE.md, GAPS-TRACKER.md updated
- [ ] TypeScript check passes
- [ ] pm2 restart succeeds
- [ ] Git commit: `docs(constitution): complete telemarketing domain constitution`

---

## Notes for the Executor

1. **The outcome system is CRITICAL.** It evolved through 4 migrations (001, 048, 097, 098). Document the final state.
2. **Check `packages/shared/telemarketingOutcomes.ts`.** This is likely the source of truth for outcomes.
3. **Appointments auto-create tasks.** Check migration 050 and 058 for the trigger logic.
4. **Entity polymorphism** ('candidate'/'client') appears in 3 tables. Document how the system handles both.
5. **Do NOT skip `contact_targets`.** It's part of telemarketing domain even though it has its own route file.
6. **Use exact SQL types** from migrations.
7. **Examples must be realistic** — Syrian phone numbers, realistic team keys.
