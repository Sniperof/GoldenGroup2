# Prompt: Domain Constitution for Branches (الفروع)

## Objective

Build the **complete, authoritative Domain Constitution** for the `branches` entity in Golden CRM. This is a **foundational organizational entity** — the entire multi-branch system depends on it.

Follow the exact same template and quality standard established by the `clients` pilot.

The output must be:
- **Comprehensive**: Every field, constraint, rule, relationship, state, test case documented.
- **Mixed language**: Arabic explanations, English field/code references.
- **Source-truthful**: Extracted directly from migrations, route handlers, services, and shared types.
- **Critical**: Document ALL gaps, contradictions, or inconsistencies found between sources.

---

## Output Files

1. `docs/constitution/domains/branches.md` — The full Branches constitution
2. Update `docs/constitution/INDEX.md` — Add branches row
3. Update `docs/constitution/CROSS-REFERENCE.md` — Add branches relationships
4. If new gaps discovered: `docs/constitution/GAPS-TRACKER.md` — Add GAP-045, GAP-046, etc.

---

## Step 1: Read ALL Source Files

### A. Database Schema (Migrations)
```
migrations/001_core_tables.sql              (CREATE TABLE branches — baseline)
migrations/004_column_additions.sql         (ALTER TABLE branches)
migrations/013_multi_branch_identity.sql     (multi-branch support)
migrations/014_branch_id_domain_tables.sql  (branch_id FK added to domain tables)
migrations/016_departments.sql              (departments linked to branches?)
migrations/019_authorization_schema_preparation.sql
migrations/037_branch_geo_coverage_backfill.sql
migrations/040_branches_detailed_address.sql
migrations/045_contact_targets.sql
migrations/051_marketing_visits_mvp.sql
migrations/054_permissions_allowed_scopes.sql
migrations/055_open_tasks.sql
migrations/060_fix_branch_geo_coverage.sql
migrations/064_customer_call_logs.sql
migrations/070_visit_core_schema.sql
migrations/167_snapshot_backfill.sql
```

Also check how other tables reference branches:
- `clients.branch_id` — ON DELETE RESTRICT
- `employees.branch` or `employees.branch_id` — check migration 001 and 014
- `contracts.branch_id`
- `candidates.branch_id`
- `field_visits.branch_id`
- `open_tasks.branch_id`
- `telemarketing_task_lists.team_key` — does this reference branches?
- `user_branch_assignments.branch_id`
- `contact_targets.branch_id`
- `hr_users.branch_id` — legacy single branch

### B. API Layer
```
packages/api/routes/branches.ts          (5 endpoints — GET list, GET :id, POST, PUT, DELETE)
packages/api/services/authorizationService.ts (branch resolution logic)
packages/api/services/geoScopeService.ts   (branch geo coverage)
```

### C. Shared Types
```
packages/shared/types.ts
packages/shared/types/authorization.ts   (AuthContext, allowedBranchIds)
```

### D. System Configuration
```
migrations/054_permissions_allowed_scopes.sql (branches.manage permission)
```

---

## Step 2: Build the Constitution Document

Write `docs/constitution/domains/branches.md` with the following sections.

Use this language rule throughout:
> **عناوين السكاشن والشرح بالعربي. أسماء الحقول والأكواد بالإنجليزي.**

---

### Section 1: هوية الكيان (Identity)

```markdown
## 1. هوية الكيان (Entity Identity)

- **الاسم العربي**: الفرع
- **الاسم الإنجليزي**: Branch
- **اسم الجدول**: `branches`
- **الوصف**: وحدة التشغيل المستقلة للشركة. كل فرع = موقع جغرافي + فريق عمل + نطاق صلاحيات. الفروع بتتحدد فيها كل العمليات (زبائن، عقود، مهام، زيارات).
- **الجداول المرتبطة**: clients, employees, contracts, candidates, field_visits, open_tasks, telemarketing_task_lists, contact_targets, user_branch_assignments, departments, day_schedules, workScopes, route_assignments...
- **الأهمية**: Core organizational entity — بدون الفرع ما بيشتغل الـ multi-branch system.
```

---

### Section 2: الجدول والحقول (Table & Field Dictionary) ⭐ MOST IMPORTANT

#### 2.1 `branches` — الفروع

| الحقل | النوع | NULL? | DEFAULT | Constraints | وصف | مثال |
|---|---|---|---|---|---|---|
| `id` | `SERIAL` | ❌ | — | `PRIMARY KEY` | | `3` |
| `name` | `VARCHAR(255)` | ❌ | — | — | اسم الفرع | `"فرع دمشق"` |
| `location_geo_id` | `INTEGER` | ✅ | — | `FK → geo_units(id)` | موقع الفرع الجغرافي | `1` (دمشق) |
| `detailed_address` | `TEXT` | ✅ | — | — | العنوان التفصيلي | `"شارع الثورة، بناية ١٠"` |
| `covered_geo_ids` | `JSONB` | ✅ | `'[]'` | — | المناطق المغطاة | `[1, 2, 3, 12, 13, 15]` |
| `contact_info` | `JSONB` | ✅ | `'[]'` | — | معلومات التواصل | `[{"type": "phone", "value": "011-1234567"}]` |
| `status` | `VARCHAR(50)` | ✅ | `'active'` | `CHECK ('active', 'inactive')` | الحالة | `"active"` |
| `created_at` | `TIMESTAMPTZ` | ✅ | `NOW()` | — | تاريخ الإنشاء | `"2026-04-01"` |

#### 2.2 `location_geo_id` vs `covered_geo_ids`

```
location_geo_id = geo_units.id (INTEGER FK)
  → The exact location of the branch office
  
covered_geo_ids = JSONB array of geo_units.id
  → All geographic areas this branch serves
  → Used for geo-scope filtering in list endpoints
```

This is the key to understanding BRANCH scope. A user's allowedBranchIds determines which branches they can see, and each branch has covered_geo_ids that determine which geo areas are visible.

---

### Section 3: القيود والقواعد (Constraints & Business Rules)

#### BR-1: Branch Scope System

```
User → assigned to branches via user_branch_assignments
User sees: clients, candidates, contracts, tasks, visits
  WHERE branch_id IN user's allowedBranchIds
  
Geo Scope:
  branch.covered_geo_ids = [1, 12, 123]
  user with this branch → sees geo_units with id in [1, 12, 123]
```

Document how `resolveGeoScope()` in `geoScopeService.ts` works with `covered_geo_ids`.

#### BR-2: ON DELETE RESTRICT

```
clients.branch_id → FK with ON DELETE RESTRICT
→ Cannot delete a branch if it has clients!
```

Check: does branches have CASCADE deletion protection? What happens when trying to delete a branch with employees, contracts, etc.?

#### BR-3: Status System

```
status = 'active' → branch is operational, appears in lists
status = 'inactive' → branch is closed, hidden from normal lists?
```

Does inactive status prevent new records from being created for this branch?
Does it prevent existing users from accessing historical data?

#### BR-4: Contact Info JSONB

```
contact_info = [
  { "type": "phone", "value": "011-1234567", "label": "main" },
  { "type": "email", "value": "damascus@golden-crm.com", "label": "manager" }
]
```

Is there any validation on contact_info structure? Or is it free-form JSON?

#### BR-5: Covered Geo IDs JSONB

```
covered_geo_ids = [1, 12, 13, 123, 124, 125]
→ These are geo_units.id values
→ NOT a foreign key constraint (JSONB array)
→ Risk: invalid IDs, non-existent geo units
```

Document GAP-037 (already identified in geo-units constitution) more specifically for branches.

#### BR-6: Single Branch per Record

```
clients.branch_id = single branch (INTEGER)
contracts.branch_id = single branch (INTEGER)
employees.branch = single branch (VARCHAR? or INTEGER? Check migration 001 vs 014)
```

An employee works for ONE branch. A client belongs to ONE branch. But a branch has MANY employees and MANY clients.

#### BR-7: Branch vs Team

```
branch = organizational unit (has physical location)
team = operational unit within a branch (workScopes, day_schedules)
A branch may have multiple teams.
```

---

### Section 4: العلاقات (Relationships)

Include ER diagram (mermaid) showing:

```
branches ||--o{ clients : "has"
branches ||--o{ employees : "employs"
branches ||--o{ contracts : "owns"
branches ||--o{ candidates : "has"
branches ||--o{ field_visits : "hosts"
branches ||--o{ open_tasks : "has"
branches ||--o{ telemarketing_task_lists : "hosts"
branches ||--o{ contact_targets : "targets"
branches ||--o{ user_branch_assignments : "assigned to"
branches ||--o{ departments : "contains"
branches ||--o{ day_schedules : "schedules"
branches }o--|| geo_units : "located at"
```

---

### Section 5: آلة الحالات (State Machine)

```
Branch Lifecycle:
[active] → (deactivate) → [inactive]
   │
   └── new records blocked? existing records read-only?
   
[inactive] → (reactivate) → [active]
```

---

### Section 6: صلاحيات الوصول (Permission Matrix)

| الإذن | المفتاح | النطاق | الوصف |
|---|---|---|---|
| عرض الفروع | (implicit via requireAuth) | GLOBAL | أي مسجل دخول بيشوف الفروع |
| إدارة الفروع | `branches.manage` | GLOBAL | إنشاء/تعديل/حذف |

**CRITICAL NOTE:** GET / and GET /:id use `requireAuth` only — NO `requirePermission`! Any authenticated user can see all branches. Is this intentional? Document this as a gap if it seems like a security issue.

---

### Section 7: عقد API (API Contract)

| الطريقة | المسار | الصلاحية | وصف |
|---|---|---|---|
| GET | `/api/branches` | `requireAuth` فقط | قائمة الفروع |
| GET | `/api/branches/:id` | `requireAuth` فقط | تفاصيل فرع |
| POST | `/api/branches` | `branches.manage` | إنشاء فرع |
| PUT | `/api/branches/:id` | `branches.manage` | تعديل فرع |
| DELETE | `/api/branches/:id` | `branches.manage` | حذف فرع |

**Query parameters:** None — simple list.

**Request body for POST /:**
```json
{
  "name": "فرع حمص",
  "locationGeoId": 16,
  "detailedAddress": "شارع الوحدة، بناية ٥",
  "coveredGeoIds": [16, 17, 18, 160, 161, 162],
  "contactInfo": [
    { "type": "phone", "value": "031-1234567", "label": "main" }
  ],
  "status": "active"
}
```

---

### Section 8: حالات الاختبار الشاملة (Test Cases) ⭐ COMPREHENSIVE

| # | السيناريو | Method | Inputs | Expected |
|---|---|---|---|---|
| TC-01 | عرض كل الفروع | GET / | — | 200 + all branches |
| TC-02 | أي مستخدم مسجل بيشوف الفروع | GET / | user بدون `branches.manage` | 200 ✅ |
| TC-03 | إنشاء فرع | POST / | {name:"حمص", locationGeoId:16} | 200 + branch created |
| TC-04 | إنشاء بدون اسم | POST / | {locationGeoId:16} | 400 |
| TC-05 | تعديل مناطق التغطية | PUT /:id | {coveredGeoIds:[16,17]} | 200 |
| TC-06 | حذف فرع مع زبائن | DELETE /:id | branch has clients | 500/400 (RESTRICT) |
| TC-07 | حذف فرع فاضي | DELETE /:id | branch empty | 200 |
| TC-08 | تفعيل/تعطيل | PUT /:id | {status:"inactive"} | 200 |
| TC-09 | عرض فرع | GET /:id | id=3 | 200 + details |
| TC-10 | geo coverage filter | (via geoScopeService) | coveredGeoIds=[1,12] | filters geo_units |
| TC-11 | فرع inactive — زبون جديد | POST /clients | branchId=inactive_branch | ??? blocked or allowed? |
| TC-12 | contact_info validation | POST / | contactInfo invalid | ??? validated? |

---

### Section 9: الثغرات والتضاربات (Gaps & Contradictions) ⭐ CRITICAL

1. **No permission check on GET / and GET /:id** — `requireAuth` only, no `requirePermission`. Any user can see all branches. Is this a security issue?
2. **covered_geo_ids as JSONB** — No FK constraint. Invalid IDs possible. (GAP-037 reinforcement)
3. **contact_info structure** — No validation/schema. Free-form JSON.
4. **No audit for branch changes** — Who changed covered_geo_ids? Not tracked.
5. **What happens to records when branch goes inactive?** — Do existing clients/tasks still work? Can new ones be created?
6. **employees.branch vs employees.branch_id** — Migration 001 created `branch` as VARCHAR(255). Migration 014 may have changed it. Check both.
7. **ON DELETE RESTRICT** — clients.branch_id has RESTRICT. But what about other tables (contracts, tasks, visits)? Do they also have RESTRICT or SET NULL?
8. **Branch deletion with user_branch_assignments** — If branch deleted, what happens to user assignments? CASCADE or RESTRICT?
9. **Duplicate branch names** — Is `name` UNIQUE? Check constraints.
10. **Snapshot inconsistency** — When branch location changes, do old visit snapshots still reference old geo_unit? (Immutable snapshots?)

---

### Section 10: تاريخ التغييرات (Schema Changelog)

Document every migration that touched branches table.

---

## Step 3: Update Supporting Files

### INDEX.md
Add row:
```
| الفروع (Branches) | [domains/branches.md](domains/branches.md) | ✅ مكتمل | [XX] سطر | [YY]+ | [ZZ] |
```

### CROSS-REFERENCE.md
Add:
- `branches` to Table Inventory
- `covered_geo_ids` JSONB pattern documentation
- `branch_id` references across all tables
- Update `ON DELETE` behaviors for branch_id FKs

### GAPS-TRACKER.md
If new gaps found (GAP-045+), add them. Update GAP-037 description with branch-specific findings.

---

## Verification Checklist

- [ ] `branches.md` contains all 10 sections
- [ ] `branches` table: 7+ fields documented
- [ ] `covered_geo_ids` JSONB documented with risks
- [ ] `contact_info` JSONB documented
- [ ] ON DELETE RESTRICT documented
- [ ] All 5 endpoints documented
- [ ] GET endpoints lacking permission check documented as gap
- [ ] At least 10 test cases
- [ ] At least 5 gaps identified
- [ ] INDEX.md, CROSS-REFERENCE.md, GAPS-TRACKER.md updated
- [ ] TypeScript check passes
- [ ] pm2 restart succeeds
- [ ] Git commit: `docs(constitution): complete branches domain constitution`

---

## Notes for the Executor

1. **branches is simpler than previous entities.** Only 5 endpoints, 1 main table. But it's foundational.
2. **covered_geo_ids is the key concept.** Understand how it drives BRANCH scope filtering.
3. **GET endpoints security.** `requireAuth` without `requirePermission` — is this intentional or a gap?
4. **Check ON DELETE behaviors.** For each table with branch_id FK, check if it's RESTRICT, CASCADE, or SET NULL.
5. **Use exact SQL types** from migrations.
6. **Examples must be realistic** — Syrian branch names, realistic geo coverage.
