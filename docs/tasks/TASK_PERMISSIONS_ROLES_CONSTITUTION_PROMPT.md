# Prompt: Domain Constitution for Permissions & Roles (الصلاحيات والأدوار)

## Objective

Build the **complete, authoritative Domain Constitution** for the `permissions`, `roles`, `role_permission_grants`, `user_branch_assignments`, and `hr_users` entities in Golden CRM. This is the **RBAC backbone** that governs ALL other entities — understanding it is essential for resolving multiple high-severity gaps.

Follow the exact same template and quality standard established by the `clients` pilot.

The output must be:
- **Comprehensive**: Every field, constraint, rule, relationship, state, test case documented.
- **Mixed language**: Arabic explanations, English field/code references.
- **Source-truthful**: Extracted directly from migrations, route handlers, services, and shared types.
- **Critical**: Document ALL gaps, contradictions, or inconsistencies — especially the ASSIGNED scope blocking and permission naming mismatches.

---

## Output Files

1. `docs/constitution/domains/permissions.md` — The full Permissions/Roles constitution
2. Update `docs/constitution/INDEX.md` — Add permissions row
3. Update `docs/constitution/CROSS-REFERENCE.md` — Add RBAC tables and relationships
4. Update `docs/constitution/GAPS-TRACKER.md` — Update GAP-002, GAP-009, GAP-017, GAP-027 descriptions with root cause analysis

---

## Step 1: Read ALL Source Files

### A. Database Schema (Migrations)
Read EVERY migration file that touches RBAC:

```
migrations/003_hr_rbac_tables.sql              (CREATE TABLE roles, permissions, role_permissions, hr_users — CRITICAL baseline)
migrations/005_constraints_cleanup.sql           (cleanup)
migrations/012_job_title_role_link.sql           (job titles)
migrations/013_multi_branch_identity.sql         (multi-branch support)
migrations/015_role_templates_seed.sql             (role templates)
migrations/019_authorization_schema_preparation.sql (preparation)
migrations/020_role_model_conflict_cleanup.sql      (cleanup)
migrations/021_candidates_authorization_enablement.sql
migrations/022_referral_sheets_authorization_foundation.sql
migrations/024_clients_permissions_seeding.sql     (clients.* permissions seeded)
migrations/025_clients_role_grants_refinement.sql   (role grants refined)
migrations/026_contracts_tasks_permissions_seeding.sql
migrations/027_contracts_tasks_departments_permissions_seeding.sql
migrations/028_user_branch_assignment_permissions_seeding.sql
migrations/029_system_admin_role_protection.sql     (protect super admin)
migrations/030_central_admin_permissions_seeding.sql
migrations/032_interviewer_assignment_and_conduct_permission.sql
migrations/033_customer_service_supervisor_role_seed.sql
migrations/034_candidate_name_lists_permissions.sql
migrations/035_role_job_tasks.sql                  (role_job_tasks table)
migrations/038_planning_schedule_appearance_permission.sql
migrations/039_training_trainer_permission.sql
migrations/043_clients_can_be_assigned_permission.sql
migrations/046_telemarketing_permissions_seeding.sql
migrations/052_marketing_visits_permissions.sql
migrations/054_permissions_allowed_scopes.sql       (⭐ CRITICAL — allowed_scopes table)
migrations/059_recruitment_permissions_complete.sql
migrations/062_roles_team_slot_type.sql             (team_slot_type)
migrations/063_planning_view_manage_permissions.sql
migrations/074_telemarketing_appointments_book_permission.sql
migrations/114_emergency_action_types.sql
migrations/119_resolve_escalation_permission.sql
migrations/136_seed_sales_can_close.sql
migrations/144_delivery_task_permissions.sql
```

Also read:
```
migrations/106_task_type_config.sql               (task types with permissions)
```

### B. API Layer
```
packages/api/routes/roles.ts                     (14 endpoints — roles + permissions + hr_users)
packages/api/services/authorizationService.ts    (auth context building)
packages/api/services/userBranchAssignmentService.ts (branch assignments)
packages/api/policies/                           (check all policy files)
```

### C. Shared Types
```
packages/shared/types/authorization.ts           (AuthContext, scope types)
packages/shared/types/auth.ts                    (AuthUser, JWT payload)
packages/shared/contracts/roles.js               (if exists)
```

### D. System Configuration
Read the tRPC router if it touches roles:
```
packages/api/trpc/routers/roles.ts               (tRPC roles router)
packages/api/trpc/router.ts                      (tRPC main router)
```

---

## Step 2: Build the Constitution Document

Write `docs/constitution/domains/permissions.md` with the following sections.

Use this language rule throughout:
> **عناوين السكاشن والشرح بالعربي. أسماء الحقول والأكواد بالإنجليزي.**

---

### Section 1: هوية الكيان (Identity)

```markdown
## 1. هوية الكيان (Entity Identity)

- **الاسم العربي**: نظام الصلاحيات والأدوار (RBAC)
- **الاسم الإنجليزي**: Permissions & Roles System
- **الجداول الرئيسية**: `roles`, `permissions`, `role_permission_grants`, `role_permissions`, `user_branch_assignments`, `hr_users`
- **الوصف**: النظام الأمني المركزي للتحكم بالوصول. يحدد مين بيقدر يشوف/يعدل/يحذف/ينشئ بكل كيان، وعلى أي نطاق (GLOBAL/BRANCH/ASSIGNED/NONE). كل مستخدم (`hr_users`) بياخد دور (`roles`)، كل دور بياخد مجموعة صلاحيات (`permissions`)، والنطاق بيتحدد حسب فروع المستخدم (`user_branch_assignments`).
- **الجداول المرتبطة**: الكل — كل كيان بالنظام له صلاحيات هون
- **الأهمية**: **Core security foundation** — كل شي تاني بيعتمد عليه.
```

---

### Section 2: الجدول والحقول (Table & Field Dictionary) ⭐ MOST IMPORTANT

#### 2.1 `roles` — الأدوار

| الحقل | النوع | NULL? | Constraints | وصف |
|---|---|---|---|---|
| `id` | `SERIAL` | ❌ | `PRIMARY KEY` | |
| `name` | `VARCHAR(255)` | ❌ | `UNIQUE` | اسم الدور |
| `display_name` | `VARCHAR(255)` | ✅ | | الاسم الظاهر |
| `is_template` | `BOOLEAN` | ✅ | `DEFAULT FALSE` | قالب جاهز؟ |
| `team_slot_type` | `VARCHAR(50)` | ✅ | | نوع الفريق (SUPERVISOR, TECHNICIAN, etc.) |
| `job_title_id` | `INTEGER` | ✅ | `FK` | المسمى الوظيفي |
| `department_id` | `INTEGER` | ✅ | `FK` | القسم |
| `created_at` | `TIMESTAMPTZ` | ✅ | | |

#### 2.2 `permissions` — الصلاحيات

| الحقل | النوع | NULL? | Constraints | وصف |
|---|---|---|---|---|
| `id` | `SERIAL` | ❌ | `PRIMARY KEY` | |
| `key` | `VARCHAR(255)` | ❌ | `UNIQUE` | المفتاح الفريد (e.g., `clients.view_list`) |
| `name` | `VARCHAR(255)` | ✅ | | الاسم الظاهر |
| `category` | `VARCHAR(100)` | ✅ | | التصنيف (clients, contracts, admin, etc.) |
| `description` | `TEXT` | ✅ | | الوصف |
| `created_at` | `TIMESTAMPTZ` | ✅ | | |

#### 2.3 `role_permission_grants` — منح الصلاحيات للأدوار

| الحقل | النوع | NULL? | Constraints | وصف |
|---|---|---|---|---|
| `id` | `SERIAL` | ❌ | `PRIMARY KEY` | |
| `role_id` | `INTEGER` | ❌ | `FK → roles(id) ON DELETE CASCADE` | |
| `permission_id` | `INTEGER` | ❌ | `FK → permissions(id) ON DELETE CASCADE` | |
| `granted_at` | `TIMESTAMPTZ` | ✅ | | |

#### 2.4 `role_permissions` — ⭐ LEGACY OR ACTIVE?

Check migration 003 and 020. Is this table still used or replaced by `role_permission_grants`? Document the relationship.

#### 2.5 `user_branch_assignments` — تخصيص فروع المستخدمين

| الحقل | النوع | NULL? | Constraints | وصف |
|---|---|---|---|---|
| `id` | `SERIAL` | ❌ | `PRIMARY KEY` | |
| `user_id` | `INTEGER` | ❌ | `FK → hr_users(id)` | المستخدم |
| `branch_id` | `INTEGER` | ❌ | `FK → branches(id)` | الفرع |
| `is_primary` | `BOOLEAN` | ✅ | `DEFAULT FALSE` | هل هو الفرع الرئيسي؟ |
| `assigned_at` | `TIMESTAMPTZ` | ✅ | | |

#### 2.6 `hr_users` — مستخدمو النظام

| الحقل | النوع | NULL? | Constraints | وصف |
|---|---|---|---|---|
| `id` | `SERIAL` | ❌ | `PRIMARY KEY` | |
| `name` | `VARCHAR(255)` | ❌ | | الاسم |
| `username` | `VARCHAR(255)` | ❌ | `UNIQUE` | اسم الدخول |
| `password_hash` | `TEXT` | ❌ | | كلمة المرور مشفرة |
| `role` | `VARCHAR(50)` | ✅ | | الدور (legacy string?) |
| `role_id` | `INTEGER` | ✅ | `FK → roles(id)` | الدور (new FK system) |
| `employee_id` | `INTEGER` | ✅ | `FK → employees(id)` | الموظف المرتبط |
| `branch_id` | `INTEGER` | ✅ | `FK → branches(id)` | الفرع (legacy?) |
| `is_active` | `BOOLEAN` | ✅ | `DEFAULT TRUE` | هل نشط؟ |
| `is_super_admin` | `BOOLEAN` | ✅ | `DEFAULT FALSE` | سوبر أدمن؟ |
| `created_at` | `TIMESTAMPTZ` | ✅ | | |

#### 2.7 `allowed_scopes` — ⭐ THE MOST IMPORTANT TABLE FOR GAPS

This table was created in migration 054. Document it FULLY:

| الحقل | النوع | NULL? | Constraints | وصف |
|---|---|---|---|---|
| `id` | `SERIAL` | ❌ | `PRIMARY KEY` | |
| `permission_id` | `INTEGER` | ❌ | `FK → permissions(id)` | الصلاحية |
| `allowed_scopes` | `JSONB` / `TEXT[]` | ❌ | | النطاقات المسموحة |

**CRITICAL:** What values are in `allowed_scopes` for each permission? Check the migration SQL. Likely values: `['GLOBAL', 'BRANCH']` or `['GLOBAL', 'BRANCH', 'ASSIGNED']` or `['NONE']`.

This table is WHY GAP-002 and GAP-009 exist — it might BLOCK `ASSIGNED` scope for certain permissions.

---

### Section 3: القيود والقواعد (Constraints & Business Rules)

#### BR-1: RBAC Hierarchy
```
hr_user → has role → role has permissions → permissions have allowed_scopes
hr_user → assigned to branches → via user_branch_assignments
```

#### BR-2: Scope Resolution Logic (from authorizationService.ts)

```
For a user accessing a resource:
  1. Get user's role permissions (from role_permission_grants)
  2. For each permission, check allowed_scopes
  3. If permission has GLOBAL → user sees ALL
  4. If permission has BRANCH → user sees their assigned branches
  5. If permission has ASSIGNED → user sees only their assigned records
  6. If permission has NONE → user sees NOTHING
```

Document HOW `authorize()` works in `authorizationService.ts`.

#### BR-3: The ASSIGNED Scope Problem (GAP-002, GAP-009 Root Cause)

```
allowed_scopes for 'clients.view_list' = ['GLOBAL', 'BRANCH']
→ ASSIGNED is NOT in the list!
→ Even though clientPolicy.ts has logic for ASSIGNED, the DB blocks it.
```

Document the EXACT allowed_scopes values for:
- `clients.view`, `clients.view_list`, `clients.edit`
- `candidates.view`, `candidates.view_list`
- `contracts.view_list`, etc.

#### BR-4: Super Admin Bypass

```
is_super_admin = TRUE → bypasses ALL permission checks
→ But does NOT bypass branch filtering? Or does it?
```

#### BR-5: Permission Naming Mismatches (GAP-017, GAP-027 Root Cause)

```
Code uses:         'marketing_visits.view', 'marketing_visits.update_result'
But entity is:      'open_tasks', 'field_visits'
DB may have:        'open_tasks.view', 'field_visits.view'  — OR NOT?
```

Document what permissions actually EXIST in the `permissions` table vs what the CODE uses.

#### BR-6: Role Template Propagation

```
POST /api/admin/role-templates/:id/propagate
→ Copies a template role's permissions to all branches?
→ Only super admin can do this.
```

#### BR-7: Team Slot Type (from migration 062)

```
roles.team_slot_type = 'SUPERVISOR' | 'TECHNICIAN' | 'TELEMARKETER' | etc.
→ Used by workScopes and team assignments.
→ A user with team_slot_type='SUPERVISOR' can lead a team.
```

#### BR-8: Central Admin vs System Admin (migration 029, 030)

```
System admin: full system access (is_super_admin)
Central admin: manages roles/permissions but NOT super admin?
```

Document the difference.

#### BR-9: Job Tasks (role_job_tasks from migration 035)

```
role_job_tasks: links roles to specific job functions
Not the same as permissions — more like "responsibilities"
```

#### BR-10: Permission Category System

```
permissions.category = 'clients', 'contracts', 'tasks', 'admin', 'hr', etc.
→ Used for grouping in UI?
→ Not for authorization logic
```

---

### Section 4: العلاقات (Relationships)

Include ER diagram (mermaid) showing:

```
roles ||--o{ role_permission_grants : "grants"
permissions ||--o{ role_permission_grants : "granted to"
roles ||--o{ hr_users : "assigned to"
hr_users ||--o{ user_branch_assignments : "assigned to"
branches ||--o{ user_branch_assignments : "has users"
permissions ||--o{ allowed_scopes : "scope config"
hr_users }o--|| employees : "linked to"
roles }o--|| departments : "belongs to"
roles ||--o{ role_job_tasks : "job tasks"
```

---

### Section 5: آلة الحالات (State Machine)

Roles and permissions don't have a traditional state machine. But document:

```
User state:
[is_active=true] → can login and use system
[is_active=false] → blocked

Role propagation state:
[template] → [propagated to branches] → [users assigned]
```

---

### Section 6: صلاحيات الوصول (Permission Matrix) — META!

This section documents who can manage the permission system itself:

| الإذن | المفتاح | النطاق | الوصف |
|---|---|---|---|
| عرض الأدوار | `admin.roles.view` | GLOBAL | عرض roles + permissions |
| إدارة الأدوار | `admin.roles.manage` | GLOBAL | إنشاء/تعديل/حذف roles |
| تعديل نطاقات الصلاحيات | `admin.super` / `super_admin` | GLOBAL | تعديل `allowed_scopes` |

---

### Section 7: عقد API (API Contract)

| الطريقة | المسار | الصلاحية | وصف |
|---|---|---|---|
| GET | `/api/admin/roles` | `admin.roles.view` | قائمة الأدوار |
| GET | `/api/admin/roles/:id` | `admin.roles.view` | تفاصيل دور |
| GET | `/api/admin/roles/:id/permissions` | `admin.roles.view` | صلاحيات الدور |
| POST | `/api/admin/roles` | `admin.roles.manage` | إنشاء دور |
| PUT | `/api/admin/roles/:id` | `admin.roles.manage` | تعديل دور |
| DELETE | `/api/admin/roles/:id` | `admin.roles.manage` | حذف دور |
| PUT | `/api/admin/roles/:id/permissions` | `admin.roles.manage` | تحديث صلاحيات الدور |
| POST | `/api/admin/role-templates/:id/propagate` | `super_admin` | نشر القالب |
| GET | `/api/admin/permissions` | `admin.roles.view` | قائمة كل الصلاحيات |
| PUT | `/api/admin/permissions/scopes` | `super_admin` | تعديل `allowed_scopes` ⭐ |
| GET | `/api/admin/hr-users` | `admin.roles.view` | قائمة المستخدمين |
| GET | `/api/admin/hr-users/assignable` | `clients.view_list` | مستخدمين قابلين للتخصيص |
| POST | `/api/admin/hr-users` | `admin.roles.manage` | إنشاء مستخدم |
| PUT | `/api/admin/hr-users/:id` | `admin.roles.manage` | تعديل مستخدم |

---

### Section 8: حالات الاختبار الشاملة (Test Cases) ⭐ COMPREHENSIVE

| # | السيناريو | Method | Inputs | Expected |
|---|---|---|---|---|
| TC-01 | عرض قائمة الأدوار | GET /roles | — | 200 + roles array |
| TC-02 | إنشاء دور جديد | POST /roles | {name:"Sales Manager", permissions:[...]} | 200 + role created |
| TC-03 | منح صلاحية ASSIGNED | PUT /roles/:id/permissions | add `clients.view` | 200 |
| TC-04 | تعديل allowed_scopes | PUT /permissions/scopes | {permission_id: X, scopes:['GLOBAL','BRANCH','ASSIGNED']} | 200 ⭐ |
| TC-05 | نشر قالب دور | POST /role-templates/:id/propagate | template_id=1 | 200 |
| TC-06 | إنشاء مستخدم | POST /hr-users | {username:"ali", password:"...", role_id: 5} | 200 |
| TC-07 | تخصيص مستخدم لفرع | (implicit via user_branch_assignment) | user_id=10, branch_id=3 | 200 |
| TC-08 | super_admin bypass | (any endpoint) | is_super_admin=true | ✅ bypasses all checks |
| TC-09 | عرض صلاحيات الدور | GET /roles/:id/permissions | role_id | 200 + permissions array |
| TC-10 | حذف دور مستخدم | DELETE /roles/:id | role_id | 200 + check if users reassigned |
| TC-11 | BRANCH scope filtering | GET /clients | user with BRANCH only | sees branch clients only |
| TC-12 | ASSIGNED scope filtering | GET /clients | user with ASSIGNED only | sees assigned clients only (if allowed by DB) |

---

### Section 9: الثغرات والتضاربات (Gaps & Contradictions) ⭐ CRITICAL

Document root causes for existing gaps AND new ones:

1. **GAP-002 Root Cause** — `allowed_scopes` for `clients.*` lacks `'ASSIGNED'`. Show the EXACT SQL from migration 054.
2. **GAP-009 Root Cause** — `allowed_scopes` for `candidates.*` lacks `'ASSIGNED'`. Same issue.
3. **GAP-017 Root Cause** — Code uses `marketing_visits.view` but permissions table may have `open_tasks.view` or may NOT. Show what's actually in the DB.
4. **GAP-027 Root Cause** — Code uses `marketing_visits.view` for `field_visits`. Same naming issue.
5. **New: role vs role_id** — `hr_users` has both `role` (VARCHAR, legacy) and `role_id` (INTEGER, new). Which is authoritative? Is `role` deprecated?
6. **New: branch_id on hr_users vs user_branch_assignments** — `hr_users.branch_id` (single) vs `user_branch_assignments` (multiple). Which wins?
7. **New: role_permissions vs role_permission_grants** — Two tables with similar names. What's the difference? Which is active?
8. **New: No audit log for permission changes** — Who changed allowed_scopes? When? Not tracked.
9. **New: Permission key naming inconsistency** — Some use dots (`clients.view_list`), some use underscores (`clients_view_list`), some use camelCase? Document the pattern.
10. **New: Template roles with is_template=true** — Can regular users be assigned template roles? Or are templates only for propagation?

---

### Section 10: تاريخ التغييرات (Schema Changelog)

Document the evolution of the RBAC system through migrations. Highlight:
- 003: Initial RBAC tables
- 013: Multi-branch identity added
- 054: allowed_scopes introduced (THE critical change)
- 062: team_slot_type added

---

## Step 3: Update Supporting Files

### INDEX.md
Add row:
```
| الصلاحيات والأدوار (Permissions & Roles) | [domains/permissions.md](domains/permissions.md) | ✅ مكتمل | [XX] سطر | [YY]+ | [ZZ] |
```

### CROSS-REFERENCE.md
Add:
- RBAC tables to inventory
- `role_permission_grants` as junction table
- `user_branch_assignments` as junction table
- `allowed_scopes` pattern documentation
- Permission naming patterns (dots vs underscores)

### GAPS-TRACKER.md
**Update existing gaps with root cause analysis:**
- GAP-002: Add root cause — `allowed_scopes` for `clients.*` lacks `'ASSIGNED'`
- GAP-009: Add root cause — same for `candidates.*`
- GAP-017: Add root cause — permission key mismatch
- GAP-027: Add root cause — permission key mismatch

**Add new gaps (GAP-040+)** for newly discovered issues.

---

## Verification Checklist

- [ ] `permissions.md` contains all 10 sections
- [ ] All 6 RBAC tables documented with all fields
- [ ] `allowed_scopes` table FULLY documented with actual values from migration 054
- [ ] `authorize()` function logic explained
- [ ] Scope resolution (GLOBAL/BRANCH/ASSIGNED/NONE) explained with examples
- [ ] All 14 endpoints documented
- [ ] Root causes for GAP-002, GAP-009, GAP-017, GAP-027 documented
- [ ] At least 12 test cases
- [ ] At least 5 new gaps identified
- [ ] GAPS-TRACKER.md updated with root cause analysis
- [ ] INDEX.md, CROSS-REFERENCE.md updated
- [ ] TypeScript check passes
- [ ] pm2 restart succeeds
- [ ] Git commit: `docs(constitution): complete permissions domain constitution`

---

## Notes for the Executor

1. **This entity is DIFFERENT** — it's not a business entity, it's a security entity. Focus on HOW the system decides who can do what.
2. **allowed_scopes is the key to everything.** Read migration 054 very carefully. Extract the EXACT SQL that seeds allowed_scopes values.
3. **authorizationService.ts is the brain.** Read it line by line — `authorize()`, `buildAuthContext()`, `resolveActingBranch()`.
4. **Connect the dots.** Show how GAP-002, GAP-009, GAP-017, GAP-027 all trace back to specific rows in the permissions/allowed_scopes tables.
5. **Check the tRPC router.** `trpc/routers/roles.ts` may have additional role management endpoints not in the Express routes.
6. **Use exact SQL types** from migrations.
7. **Examples must show realistic permission keys** — `clients.view_list`, `contracts.create`, `telemarketing.lists.generate`.
