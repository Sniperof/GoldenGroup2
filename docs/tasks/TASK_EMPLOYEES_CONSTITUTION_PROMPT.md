# Prompt: Domain Constitution for Employees (الموظفون)

> **ملف الإخراج:** `docs/constitution/domains/employees.md`
> **الهدف:** بناء الدستور الكامل لكيان الموظفين (11/72)
> **الجودة المستهدفة:** ~500 سطر، 12+ Test Cases، 5+ Gaps

---

## Objective

بناء الدستور الكامل لكيان الموظفين (Employees). يتبع نفس النموذج والجودة المحددة من pilot clients (clients, candidates, permissions, branches...).

## Output Files

1. `docs/constitution/domains/employees.md`
2. تحديث `docs/constitution/INDEX.md`
3. تحديث `docs/constitution/CROSS-REFERENCE.md`
4. تحديث `docs/constitution/GAPS-TRACKER.md` (إذا وجدت ثغرات)

---

## Step 1: Read ALL Source Files

### A. Database Schema (Migrations)

اقرأ كل migration بيلمس الموظفين:

**Core Schema:**
- `migrations/001_core_tables.sql` — جدول `employees` الأساسي (base columns: id, name, role, mobile, branch, residence, status, job_title, avatar, created_at)
- `migrations/003_hr_rbac_tables.sql` — جداول `hr_users`, `roles`, `permissions`, `role_permissions`, `role_permission_grants`
- `migrations/013_multi_branch_identity.sql` — إضافة `employees.branch_id`
- `migrations/014_branch_id_domain_tables.sql` — تفاصيل إضافة `branch_id` للـ domain tables
- `migrations/016_departments.sql` — جدول `departments` + إضافة `employees.department_id`
- `migrations/017_employee_profiles.sql` — الحقول الغنية: employee_number (sequence), first_name, father_name, last_name, birth_date, gender, marital_status, military_service, residence geo FKs, detailed_address, contacts JSONB, academic_qualification, specialization, years_of_experience, driving_license, job_skills, foreign_languages JSONB, hire_date, start_work_date, contract_type, work_type, previous_employment, direct_manager_id (self-referencing FK), referrer_type, source_channel, referrer_name, referral_notes + Indexes
- `migrations/017_employees_extended_profile.sql` — Extended profile (duplicate/additional columns) + unique index على employee_number
- `migrations/019_authorization_schema_preparation.sql` — `user_branch_assignments` (user_id, branch_id, is_primary, status), `role_permission_grants` (role_id, permission_id, scope_type CHECK GLOBAL/BRANCH/ASSIGNED)
- `migrations/020_role_model_conflict_cleanup.sql` — Redirect role_id → template, tighten UBA constraints, clone_role_templates_to_branch function
- `migrations/028_user_branch_assignment_permissions_seeding.sql` — permissions seeding: `users.branch_assignments.view`, `users.branch_assignments.manage`
- `migrations/032_interviewer_assignment_and_conduct_permission.sql` — `jobs.interviews.conduct`
- `migrations/035_employees_referral_entity_id.sql` — إضافة `employees.referral_entity_id`
- `migrations/039_training_trainer_permission.sql` — `jobs.training.be_trainer`
- `migrations/041_clients_created_by.sql` — clients.created_by (hr_users.id)
- `migrations/042_assignments_m2m.sql` — `client_assignments` + `candidate_assignments` (hr_user_id FKs)
- `migrations/044_employee_trainee_role.sql` — تعديل `employees_role_check` (NULL or IN supervisor/technician/telemarketer/trainee) + system_lists job_title seed
- `migrations/054_permissions_allowed_scopes.sql` — `permissions.allowed_scopes TEXT[]` + GLOBAL-only vs GLOBAL+BRANCH classifications
- `migrations/062_roles_team_slot_type.sql` — `roles.team_slot_type`
- `migrations/095_employee_status_refactor.sql` — تغيير status من (active/leave/inactive) إلى (active/vacation/suspended/terminated) + remap
- `migrations/104_fix_closed_by_employee_fk.sql` — closed_by_employee_id FK
- `migrations/171_drop_employees_residence_text.sql` — حذف `employees.residence` (GAP-034 fix)

### B. API Layer (Routes)

- `packages/api/routes/employees.ts` — Endpoints: GET /, GET /manager-candidates, GET /schedule-pool, GET /closers, GET /:id, POST /, PUT /:id, PUT /:id/system-account, DELETE /:id
- `packages/api/routes/auth.ts` — POST /login
- `packages/api/routes/roles.ts` — CRUD roles + permissions
- `packages/api/routes/branches.ts` — branch context

### C. Services & Business Logic

- `packages/api/services/employeeService.ts` — prepareEmployeeWriteInput, insertPreparedEmployeeProfile, createEmployeeRecord, updateEmployeeRecord, deleteEmployeeRecord, getEmployees, getEmployeeById, getEmployeeManagerCandidates, saveEmployeeSystemAccount + validation logic (duplicate detection, geo resolution, manager validation)
- `packages/api/services/authService.ts` — loginUser, JWT token minting, permissions + grants loading
- `packages/api/services/authorizationService.ts` — authorize(), resolveActingBranch()
- `packages/api/services/userBranchAssignmentService.ts` — listUserBranchAssignments, upsertUserBranchAssignment, deactivateUserBranchAssignment, setPrimaryUserBranchAssignment, reconcilePrimaryBranch (LEGACY_COMPAT: hr_users.branch_id mirrors primary)
- `packages/api/services/roleAssignmentGuard.ts` — validateTemplateRoleAssignment, TEMPLATE_ROLE_ASSIGNMENT_ERROR

### D. Repositories

- `packages/api/repositories/employeeRepository.ts` — listEmployees, fetchEmployeeListItem, fetchEmployeeDetailRow, fetchLatestHiringApplication, fetchApplicantById, fetchVacancyById, fetchReferrerById, fetchApplicationInterviews, fetchApplicationTrainings, findEmployeeBranchId, findEmployeeDuplicateByContactNumbers, listScopedEmployeeManagerCandidates, insertEmployeeSystemAccount, updateEmployeeSystemAccount, unlinkEmployeeSystemAccounts, updateHrUserNameByEmployeeId, deleteEmployee + HIRED_APPLICATION_JOINS + EMPLOYEE_RESIDENCE_SQL + EMPLOYEE_DETAIL_COLS
- `packages/api/repositories/authRepository.ts` — findUserForLogin, getRolePermissions, getRoleGrants (RoleGrant interface)

### E. Policies

- `packages/api/policies/candidatePolicy.ts`
- `packages/api/policies/clientPolicy.ts`
- `packages/api/policies/referralSheetPolicy.ts`

### F. Shared Types

- `packages/shared/types/auth.ts` — AuthUser interface (id, name, role, roleId, roleDisplayName, isSuperAdmin, branchId)
- `packages/shared/types/authorization.ts` — SCOPE_TYPES, ScopeType, PermissionGrant, AuthContext, AuthorizationCheck, AuthorizationResult

---

## Step 2: Build the Constitution Document

اكتب `docs/constitution/domains/employees.md` مع الأقسام العشرة:

### Section 1: هوية الكيان (Identity)

- الاسم: الموظفون / Employees
- الجداول: employees (main), hr_users (system account), user_branch_assignments (branch access), role_permission_grants (permissions)
- الأهمية: Core — كل شيء مربوط بالموظف

### Section 2: الجدول والحقول (Table & Field Dictionary) ⭐

**جدول `employees`:**
- base: id (SERIAL PK), name (VARCHAR NOT NULL), role (VARCHAR NULLable CHECK supervisor/technician/telemarketer/trainee), mobile (VARCHAR NOT NULL), branch (VARCHAR legacy), branch_id (INTEGER FK → branches), status (VARCHAR CHECK active/vacation/suspended/terminated), job_title (VARCHAR), avatar (TEXT), created_at (TIMESTAMPTZ)
- identity: employee_number (BIGINT UNIQUE, sequence default), first_name, father_name, last_name
- personal: birth_date (DATE), gender (VARCHAR), marital_status (VARCHAR), military_service (VARCHAR)
- address geo: residence_governorate_id, residence_region_id, residence_sub_area_id, residence_neighborhood_id (all INTEGER FK → geo_units ON DELETE SET NULL), detailed_address (TEXT), residence (VARCHAR legacy — dropped in 171)
- contact: contacts (JSONB NOT NULL DEFAULT '[]')
- academic: academic_qualification (VARCHAR), specialization (VARCHAR), years_of_experience (INTEGER), driving_license (BOOLEAN), job_skills (TEXT), foreign_languages (JSONB DEFAULT '[]')
- employment: hire_date (DATE), start_work_date (DATE), contract_type (VARCHAR), work_type (VARCHAR), previous_employment (TEXT), department_id (INTEGER FK → departments)
- hierarchy: direct_manager_id (INTEGER FK → employees ON DELETE SET NULL, self-referencing)
- referral: referrer_type (VARCHAR), source_channel (VARCHAR), referrer_name (VARCHAR), referral_notes (TEXT), referral_entity_id (INTEGER)

**جدول `hr_users`:**
- id (SERIAL PK), name (VARCHAR NOT NULL), username (VARCHAR NOT NULL UNIQUE), password_hash (VARCHAR NOT NULL), role (VARCHAR NOT NULL), is_active (BOOLEAN DEFAULT TRUE), created_at (TIMESTAMPTZ), employee_id (INTEGER FK → employees ON DELETE SET NULL, UNIQUE partial index), role_id (INTEGER FK → roles)

**جدول `user_branch_assignments`:**
- id (SERIAL PK), user_id (INTEGER FK → hr_users ON DELETE CASCADE), branch_id (INTEGER FK → branches ON DELETE CASCADE), is_primary (BOOLEAN NOT NULL DEFAULT FALSE), status (VARCHAR CHECK active/inactive), created_at, updated_at, UNIQUE (user_id, branch_id), UNIQUE partial index (user_id WHERE is_primary)

**جدول `role_permission_grants`:**
- id (SERIAL PK), role_id (FK → roles), permission_id (FK → permissions), scope_type (VARCHAR CHECK GLOBAL/BRANCH/ASSIGNED), created_at, updated_at, UNIQUE (role_id, permission_id)

### Section 3: القيود والقواعد (Constraints & Business Rules) ⭐

- CHECK: employees.status IN ('active', 'vacation', 'suspended', 'terminated')
- CHECK: employees.role IS NULL OR IN ('supervisor', 'technician', 'telemarketer', 'trainee')
- UNIQUE partial: employee_number (WHERE NOT NULL)
- UNIQUE partial: hr_users.employee_id (WHERE NOT NULL)
- UNIQUE: hr_users.username
- FK: employees.department_id → departments(id) ON DELETE SET NULL
- FK: employees.direct_manager_id → employees(id) ON DELETE SET NULL (self-referencing)
- FK: employees.branch_id → branches(id) ON DELETE SET NULL
- FK: employees.residence_*_id → geo_units(id) ON DELETE SET NULL (×4)
- FK: hr_users.employee_id → employees(id) ON DELETE SET NULL
- UBA: one primary branch per user (partial unique index)
- Business Rule: duplicate detection by contact numbers (409 conflict)
- Business Rule: manager must be from same branch + same department
- Business Rule: residence requires governorate + region + sub_area minimum
- Business Rule: `hr_users.branch_id` mirrors primary UBA (LEGACY_COMPAT)
- Business Rule: employee role derived from job_title via deriveEmployeeRoleFromVacancyTitle()
- Business Rule: branch_id resolved via resolveActingBranch() with x-branch-id header fallback

### Section 4: العلاقات (Relationships)

- employees → branches (many-to-one)
- employees → departments (many-to-one)
- employees → employees (self-referencing: direct_manager_id)
- employees → geo_units (×4: governorate, region, sub_area, neighborhood)
- hr_users → employees (one-to-one optional via employee_id)
- hr_users → roles (many-to-one via role_id)
- user_branch_assignments → hr_users (many-to-one)
- user_branch_assignments → branches (many-to-one)
- role_permission_grants → roles (many-to-one)
- role_permission_grants → permissions (many-to-one)
- client_assignments → hr_users
- candidate_assignments → hr_users

### Section 5: آلة الحالات (State Machine)

- active → vacation
- active → suspended
- active → terminated
- vacation → active
- vacation → suspended
- vacation → terminated
- suspended → active
- suspended → terminated
- (terminated is terminal)

### Section 6: صلاحيات الوصول (Permission Matrix)

ابحث عن كل permissions المرتبطة بالموظفين من migrations و routes:
- employees.view_list
- employees.create
- employees.edit
- employees.delete
- users.branch_assignments.view
- users.branch_assignments.manage
- admin.roles.manage (لـ system-account)
- planning.manage (لـ schedule-pool)
- sales.can_close (لـ closers endpoint)
- jobs.interviews.conduct
- jobs.training.be_trainer
- planning.schedule.appear

⚠️ تحقق من allowed_scopes لكل permission في DB

### Section 7: عقد API (API Contract)

- GET /api/employees — list (branch-scoped, superAdmin sees all)
- GET /api/employees/manager-candidates — managers in branch+dept
- GET /api/employees/schedule-pool — active + canAppearInSchedule + teamSlotType
- GET /api/employees/closers — users with sales.can_close permission
- GET /api/employees/:id — detail (branch ownership check)
- POST /api/employees — create (branchId required, GLOBAL grant accepts body.branchId)
- PUT /api/employees/:id — update (owner branch + target branch checks)
- PUT /api/employees/:id/system-account — link/unlink hr_user (requires admin.roles.manage)
- DELETE /api/employees/:id — delete (owner branch check)
- POST /api/auth/login — login

### Section 8: حالات الاختبار الشاملة (Test Cases) ⭐

≥ 12 حالة:
1. Happy path: create employee with all fields
2. Validation: missing firstName
3. Validation: missing lastName
4. Validation: missing birthDate
5. Validation: missing gender
6. Validation: missing maritalStatus
7. Validation: missing militaryService
8. Validation: missing jobTitle
9. Validation: missing contractType
10. Validation: missing workType
11. Validation: missing departmentId
12. Validation: missing geo (governorate/region/sub_area)
13. Duplicate detection: contact number exists → 409
14. Manager validation: self-reference rejected
15. Manager validation: different branch rejected
16. Manager validation: not in department candidates rejected
17. Permission denied: view_list on wrong branch
18. Permission denied: create without employees.create
19. Permission denied: edit on wrong branch
20. Permission denied: system-account without admin.roles.manage
21. Edge case: employee_number auto-generated from sequence
22. Edge case: update changes branch (owner + target branch checks)
23. Edge case: superAdmin sees all branches
24. Edge case: schedule-pool filters by planning.schedule.appear + teamSlotType
25. Cross-branch: user with GLOBAL employees.view_list sees all
26. Cross-branch: user with BRANCH employees.view_list sees only assigned branch

### Section 9: الثغرات والتضاربات (Gaps & Contradictions) ⭐

ابحث عن ≥ 5 gaps:
- تضارب: `employees.residence` text column VS geo FKs (fixed in 171 but may exist in code)
- تضارب: duplicate migration 017 (017_employee_profiles.sql + 017_employees_extended_profile.sql) — نفس الرقم، محتوى مختلف
- تضارب: `employees.branch` (VARCHAR legacy) VS `employees.branch_id` (INTEGER FK) — أي واحد source-of-truth؟
- Legacy: `hr_users.branch_id` mirrored from UBA — هل باقي consumers بيستخدموه؟
- Missing: لا soft-delete على employees — حذف فعلي
- Missing: لا audit trail على تغييرات الموظف
- Naming mismatch: `employees.role` (operational role) VS `hr_users.role` (legacy text) VS `hr_users.role_id` (FK to roles table)
- Potential: employee_number من نوع BIGINT بس 017_employees_extended_profile بتحطه VARCHAR(50)
- Potential: `role` constraint يسمح بـ NULL — هل مقصود؟
- Potential: `user_branch_assignments.status` لا يتم تحديثه تلقائياً عند تغيير `hr_users.is_active`

### Section 10: تاريخ التغييرات (Schema Changelog)

- 001: employees base table
- 003: hr_users + roles + permissions
- 013: employees.branch_id
- 016: departments + employees.department_id
- 017: rich profile fields
- 019: user_branch_assignments + role_permission_grants
- 020: role template conflict resolution
- 028: UBA permissions seeding
- 032: interviewer conduct permission
- 035: employees.referral_entity_id
- 039: training trainer permission
- 041: clients.created_by
- 042: assignments M2M
- 044: trainee role + system_lists
- 054: permissions.allowed_scopes
- 062: roles.team_slot_type
- 095: status refactor (active/vacation/suspended/terminated)
- 104: closed_by_employee FK
- 171: drop employees.residence

---

## Step 3: Update Supporting Files

### INDEX.md
أضف صف:
| 11 | الموظفون (Employees) | domains/employees.md | ✅ مكتمل | ~500 سطر | 12+ | Y |

### CROSS-REFERENCE.md
- أضف الحقول المشتركة: employee_id, created_by, closed_by_employee_id, entered_by_user_id, assigned_hr_user_id
- أضف العلاقات: employees ↔ branches, employees ↔ departments, employees ↔ geo_units, hr_users ↔ employees, user_branch_assignments
- حدّث الـ Table Inventory

### GAPS-TRACKER.md
- GAP-0XX: employees.branch legacy text vs branch_id FK
- GAP-0XX: hr_users.branch_id legacy mirror vs UBA
- GAP-0XX: duplicate migration 017 numbering
- GAP-0XX: no soft-delete on employees
- GAP-0XX: no audit trail on employee changes
- GAP-0XX: role naming ambiguity (employees.role vs hr_users.role vs hr_users.role_id)

---

## Verification Checklist

- [ ] كل الأقسام العشرة موجودة
- [ ] كل الحقول موثقة (نوع، NULL، DEFAULT، Constraints، وصف، مثال)
- [ ] الـ CHECK constraints موثقة
- [ ] الـ Test Cases ≥ 12
- [ ] الثغرات ≥ 5
- [ ] INDEX, CROSS-REFERENCE, GAPS-TRACKER محدثة
- [ ] TypeScript check يمر
- [ ] pm2 restart ناجح
- [ ] git commit

---

## Notes for the Executor

1. لا تخترع حقول — اقرأ الكود
2. لا تثق بالتعليقات — الكود هو الحقيقة
3. إذا وجدت تضارب → document it، don't fix it
4. استخدم أنواع SQL exact من migrations
5. الأمثلة واقعية (سورية)
6. employees.route Swagger schemas legacy (enum: [active, inactive]) — document the discrepancy with 095 refactor
