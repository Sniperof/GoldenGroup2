# Branch Team Planning / Assignment Scope — Sprint Plan

> For Claude Code: implement sprint-by-sprint on `staging` only. Do not touch production. Rebuild frontend after code changes. No `alert()`; use inline state-based feedback only.

## Goal

Refactor branch-team planning so the system stops relying on brittle employee job-title text inference, introduces explicit team-slot eligibility at the role level, and makes all downstream customer-scope logic use assignments to either the team's supervisor or technician.

## Current behavior confirmed from code

### Team composition today
- Team scheduling UI: `packages/web/src/pages/planning/TeamScheduler.tsx`
- Schedule save/validation API: `packages/api/routes/schedules.ts`
- Shared schedule types: `packages/shared/types.ts`
- Employee schedule pool API: `packages/api/routes/employees.ts` (`GET /employees/schedule-pool`)

Today the team UI and backend both treat `employees.role` as the source of truth for:
- `supervisor`
- `technician`
- `telemarketer`
- `trainee`

### Problem in current source of truth
- Employee write path derives `employees.role` from `jobTitle` text:
  - `packages/api/services/employeeService.ts`
  - `packages/api/utils/recruitmentPolicy.ts` → `deriveEmployeeRoleFromVacancyTitle()`
- This is brittle because naming changes in job titles change operational behavior.

### Route/work-coverage today
- Route assignment UI: `packages/web/src/pages/planning/RouteAssigner.tsx`
- Route assignment API: `packages/api/routes/routeAssignments.ts`
- Planning target scope builder: `packages/api/services/planningMarketingTargets.ts`

Today `planningMarketingTargets.ts` filters customers by:
1. same branch
2. selected route zones
3. assignment to the **team supervisor only** via `client_assignments.hr_user_id = supervisorHrUserId`

This must change.

---

# Sprint 1 — Fixed Team Structure + Role→Team Slot Mapping

## Business decision already made
A standard branch team must be:
- exactly 1 supervisor
- exactly 1 technician
- exactly 1 trainee
- 1 or more telemarketers

Each RBAC role must map to **one** team slot for team-formation eligibility.

## Main objective
Replace implicit employee operational-role inference with explicit team-slot eligibility attached to the RBAC role.

## Recommended implementation

### Data model
Add a new nullable column to `roles`:
- `team_slot_type TEXT NULL`

Allowed values:
- `SUPERVISOR`
- `TECHNICIAN`
- `TRAINEE`
- `TELEMARKETER`

Add a CHECK constraint.

Why `roles` and not a separate mapping table?
- Business rule is one role → one slot only.
- This is simpler and enough for the current design.

### Files likely affected
#### Migration
- create new migration, e.g. `060_roles_team_slot_type.sql`

#### Backend role APIs
- `packages/api/routes/roles.ts`
- possibly shared contracts if role payloads are typed elsewhere:
  - `packages/shared/contracts/roles.ts`
  - `packages/shared/types.ts`

#### System-lists / job-title linking UI (optional display only, not source of truth)
- `packages/api/routes/systemLists.ts`
- `packages/web/src/pages/admin/SystemLists.tsx`
- `packages/web/src/components/employees/EmployeeFormModal.tsx`

#### Team scheduling
- `packages/api/routes/employees.ts` (`/schedule-pool`)
- `packages/web/src/pages/planning/TeamScheduler.tsx`
- `packages/api/routes/schedules.ts`
- `packages/shared/types.ts`

## Required behavior after Sprint 1

### 1. Role-level team slot
When admin creates/edits a role, they can set exactly one team slot or leave it null.

### 2. Schedule pool eligibility
An employee appears in team scheduling only if all are true:
- employee is active
- employee is in the active branch
- employee system account exists and is active
- employee system account's role has `planning.schedule.appear`
- employee system account's role has matching `team_slot_type`

### 3. Team structure enforcement
On save of `day_schedules` for team slots (not solo slots):
- exactly one supervisor
- exactly one technician
- exactly one trainee
- at least one telemarketer
- no duplicate employee across any slot

### 4. Do not use `deriveEmployeeRoleFromVacancyTitle()` for planning eligibility anymore
You may keep old `employees.role` temporarily for compatibility elsewhere, but scheduling must stop trusting it as the authority.

## Suggested phased implementation inside Sprint 1
1. Add DB column + migration + backfill known template roles.
2. Extend role GET/PUT APIs and shared types.
3. Update admin role UI to edit/view slot type.
4. Update `/employees/schedule-pool` to compute eligibility from `hr_users.role_id -> roles.team_slot_type`.
5. Update `TeamScheduler.tsx` to use returned slot info rather than `employee.role` where possible.
6. Update `schedules.ts` validation to validate against the same computed slot source.
7. Rebuild frontend.

## Backfill notes
Backfill existing template roles conservatively:
- customer-service supervisor roles → `SUPERVISOR`
- technician roles → `TECHNICIAN`
- trainee roles → `TRAINEE`
- telemarketing roles → `TELEMARKETER`

Do not guess aggressively for unrelated roles; leave null when uncertain.

---

# Sprint 2 — Team Customer Scope = Supervisor OR Technician

## Business decision already made
All downstream logic built on planned team customer scope must include customers assigned to either:
- the team's supervisor
- or the team's technician

Not supervisor-only.

## Main objective
Change the planned team customer-scope definition from:
- branch + route zones + assigned to supervisor

to:
- branch + route zones + assigned to supervisor **or** technician

## Files affected
- `packages/api/services/planningMarketingTargets.ts`
- any helper you introduce for centralization
- any consumers that rely on this scope later in Sprint 3

## Required behavior after Sprint 2

### 1. Resolve both team actors
From `day_schedules.teams[teamIndex]`, resolve:
- `supervisorEmployeeId`
- `technicianEmployeeId`

Then resolve active `hr_users.id` for each if available.

### 2. Scope rule
A client is in team scope if:
- same branch
- neighborhood/zone in route coverage
- assigned in `client_assignments` to at least one of:
  - supervisor hr_user
  - technician hr_user

### 3. Edge cases
- if supervisor missing → keep current empty-response guard
- if technician missing in a supposedly valid team, return a clear reason or empty response depending on current planning response style
- if one of the two has no active `hr_user`, the other one still counts
- if neither has active `hr_user`, return empty response with clear `reason`

## Important recommendation
Do **not** duplicate this rule inline in many queries. Start extracting a reusable concept now.

Suggested helper names:
- `resolveTeamAssignmentActors(...)`
- `buildTeamAssignmentScope(...)`
- `getTeamAssignedHrUserIds(...)`

---

# Sprint 3 — Centralize Scope and Apply It Everywhere Downstream

## Business intent
Anything built later on top of planning scope must use the same rule.

## Main objective
Create one reusable source of truth for “team customer scope”, then make downstream flows use it consistently.

## Likely downstream consumers to audit
- `packages/api/services/planningMarketingTargets.ts`
- `packages/api/routes/telemarketing.ts`
- task-list generation from plan
- contact-target sync/generation paths if they reuse planning scope
- any future “generate from plan” features
- any counts shown in `RouteAssigner.tsx`

## Required behavior after Sprint 3

### 1. One shared scope builder
Introduce a backend service/helper that returns:
- branchId
- teamKey
- route zone ids
- eligible assigned hr_user ids (`supervisor` + `technician`)

### 2. Shared usage
Any code generating:
- lead counts
- lead lists
- telemarketing lists from plan
- future derived queues
must use the same scope helper.

### 3. Prevent drift
Avoid having one place use supervisor-only and another use supervisor-or-technician.

## Suggested implementation shape
Create a service, for example:
- `packages/api/services/teamPlanningScope.ts`

Possible exports:
- `resolveTeamPlanningScope({ date, teamKey, branchId })`
- `buildAssignedClientPredicate(...)` or just return hrUserIds array

Then refactor `planningMarketingTargets.ts` to consume it first.

---

# Sprint 4 — Cleanup / Compatibility Hardening

## Objective
Remove brittle leftovers and make the new model explicit in UI + validation.

## Items
1. Stop using `employees.role` for team-planning decisions.
2. Keep `employees.role` only if needed for legacy screens, but label it as legacy operational hint.
3. Show team-slot info in admin role views and employee/system-account detail where helpful.
4. Add tests for:
   - one role → one slot
   - invalid schedule shape rejected
   - supervisor-or-technician assignment scope
   - no duplicate employee in team
   - telemarketer minimum count = 1

## Likely test locations
- `packages/api/routes/schedules.*test*` or nearby pattern
- `packages/api/services/planningMarketingTargets.*test*`
- `packages/api/routes/roles.*test*` or contracts tests depending on existing structure

---

# Recommended implementation order for Claude

## Phase A — Sprint 1 foundation
1. Read current role + schedule + employee planning files.
2. Add `roles.team_slot_type` migration with safe backfill.
3. Expose the new field in role APIs/types/UI.
4. Refactor schedule-pool + schedule validation to use role slot mapping.
5. Rebuild frontend.

## Phase B — Sprint 2 scope change
1. Refactor planning target logic to resolve both supervisor and technician HR users.
2. Change counts and lead queries to use assignment to either one.
3. Keep response shape stable unless absolutely needed.

## Phase C — Sprint 3 centralization
1. Extract shared scope helper/service.
2. Move planning target logic onto it.
3. Audit downstream generation paths and switch them to the same helper.

## Phase D — Sprint 4 cleanup/tests
1. Remove remaining supervisor-only assumptions.
2. Add tests.
3. Rebuild and run targeted checks.

---

# Verification checklist

## Sprint 1 verify
- In admin roles UI, a role can be marked as one team slot.
- Employees only appear in schedule pool if their system role grants `planning.schedule.appear` and has correct `team_slot_type`.
- Team save rejects missing trainee/missing telemarketer/etc.

## Sprint 2 verify
- A customer assigned only to supervisor appears.
- A customer assigned only to technician appears.
- A customer assigned to neither does not appear.
- Branch and route-zone filters still apply.

## Sprint 3 verify
- RouteAssigner counts match telemarketing generate-from-plan scope.
- No downstream path still uses supervisor-only logic.

## Sprint 4 verify
- No planning code depends on job-title text inference.
- Existing unrelated flows still work.

---

# Claude Code Execution Prompt

Use this prompt with Claude Code in `/opt/golden-crm/apps/staging`:

```text
You are working on Golden CRM staging only. Do NOT touch production.

Task: implement the branch-team planning refactor described below, sprint by sprint, with minimal unnecessary changes and strong backward safety.

Business decisions already finalized:
1. Standard branch team = exactly 1 supervisor, exactly 1 technician, exactly 1 trainee, and 1 or more telemarketers.
2. Each RBAC role maps to exactly one team slot for team-formation eligibility: SUPERVISOR / TECHNICIAN / TRAINEE / TELEMARKETER (or null for unrelated roles).
3. All downstream planning customer-scope logic must use customers assigned to either the team's supervisor or technician — not supervisor only.
4. This downstream rule must be centralized and reused by later flows, not duplicated.

Current code landmarks:
- Team scheduling UI: packages/web/src/pages/planning/TeamScheduler.tsx
- Schedule API/validation: packages/api/routes/schedules.ts
- Employee schedule pool API: packages/api/routes/employees.ts
- Shared schedule types: packages/shared/types.ts
- Role APIs: packages/api/routes/roles.ts
- Employee write path: packages/api/services/employeeService.ts
- Brittle role inference helper: packages/api/utils/recruitmentPolicy.ts (deriveEmployeeRoleFromVacancyTitle)
- Route assignment UI: packages/web/src/pages/planning/RouteAssigner.tsx
- Route assignment API: packages/api/routes/routeAssignments.ts
- Current planning target scope builder: packages/api/services/planningMarketingTargets.ts
- System lists linked role support: packages/api/routes/systemLists.ts and packages/web/src/pages/admin/SystemLists.tsx

Implementation requirements:

Sprint 1:
- Add roles.team_slot_type nullable column with CHECK constraint for SUPERVISOR / TECHNICIAN / TRAINEE / TELEMARKETER.
- Backfill known role templates conservatively.
- Expose team_slot_type in role read/update APIs and any shared role types/contracts/UI that need it.
- Update employee schedule pool eligibility to depend on active employee + active system account + planning.schedule.appear permission + role.team_slot_type, not brittle employee job-title parsing.
- Update schedule validation so team slots enforce exactly one supervisor, one technician, one trainee, and at least one telemarketer. Keep solo logic intact unless a change is required.
- Avoid using alert() anywhere.

Sprint 2:
- Refactor packages/api/services/planningMarketingTargets.ts so team customer scope includes clients assigned to either the team's supervisor or technician.
- Use hr_users assignment ids because client_assignments stores hr_user_id.
- If one actor lacks an active hr_user but the other exists, still use the existing one.
- If neither exists, return a clear empty reason consistent with current response style.

Sprint 3:
- Extract a shared planning-scope helper/service so downstream flows can reuse the same logic.
- Refactor planningMarketingTargets to use it.
- Audit any obvious downstream “generate from plan” or telemarketing-related paths and switch them to the same scope source where appropriate.

Sprint 4:
- Clean up remaining supervisor-only assumptions in planning scope.
- Add or update targeted tests for the new behavior.

Constraints:
- Keep edits scoped.
- Preserve existing Arabic UX tone.
- Do not introduce alert(). Use inline/state-based error handling where UI changes are needed.
- Rebuild frontend after code changes.
- After implementation, provide:
  1. exact files changed
  2. summary by sprint
  3. migration/backfill notes
  4. verification commands run
  5. any unresolved risks

Execution notes:
- Read only the files needed.
- Make the migration idempotent where reasonable.
- Prefer centralization over repeating assignment-scope SQL in multiple places.
- Keep response shapes stable unless a change is necessary.
```

---

# Suggested verification commands for Claude

```bash
pnpm --filter @golden-crm/web build
pnpm --filter @golden-crm/api test || true
```

If there are no suitable tests yet, Claude should still run at least the frontend build and report what was not test-covered.
