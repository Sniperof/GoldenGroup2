# Permission Audit Findings - Step 1

## Scope

This review inventories permission definitions in migrations and direct permission checks in the API, web application, and sidebar. It does not change application behavior.

In this codebase, permission and scope are inseparable. A permission key selects the capability, but the final decision also depends on `scope` and, for record-level actions, on the specific branch or ownership subject.

Generated detail files:

- `permission-inventory.csv`
- `permission-endpoints.csv`
- `permission-inventory.md`

## Confirmed Findings

### P1 - Employee permissions are used but not defined

The following keys are checked by both API and web code but are absent from the permission catalog:

- `employees.view_list`
- `employees.create`
- `employees.edit`
- `employees.delete`

Impact:

- Non-super-admin users cannot receive effective grants for these actions.
- Employee list/create/edit/delete behavior can disagree with the visible permission configuration UI.
- Migration `271_reference_data_lookup_permission.sql` attempts to copy grants from these keys, but absent source rows contribute no grants.

### P1 - Department mutations use employee permissions

This issue has been addressed in the departments pilot. Department create, update, and delete now use a dedicated `departments.manage` permission, and the handler checks the department's branch through `authorize(..., { branchId })`.

The original problem remains relevant as a pattern elsewhere: a role that should manage departments must not automatically gain employee mutation rights, and vice versa.

### P1 - Client ownership is enforced together with scope

Client edit, view, and delete flows do not stop at the permission key. They pass the client subject into `canViewClient`, `canEditClient`, and `canDeleteClient`, and those policies call `authorize(..., { branchId, assignedUserId })`.

That is why a supervisor with an `ASSIGNED` grant still cannot edit a client they do not own. Permission alone is not enough; scope and subject ownership decide the outcome.

### P1 - Three UI permission names have no catalog counterpart

- `devices.view` controls the devices sidebar item, while device writes use `catalog.manage` and device reads only require authentication.
- `tasks.view` controls the tasks sidebar/tab, while the legacy task API uses `tasks.view_list` and operational tasks use `open_tasks.view`.
- `field_visits.execute` controls the team view, while execution endpoints use `field_visits.edit`.

These mismatches can hide UI from ordinary users even when the API permission needed for the operation is granted.

### P2 - Permission naming contains overlapping models

Examples:

- `branches.manage` and `branches.edit` both authorize branch updates.
- `tasks.view`, `tasks.view_list`, and `open_tasks.view` describe overlapping surfaces but are not aliases in the authorization engine.
- UI labels contain `devices.manage`, while API writes use `catalog.manage`.

`requirePermission(a, b)` has OR semantics. Alternative keys are therefore compatibility paths or broader access paths, not cumulative requirements.

### P2 - Visibility permissions and operational lookup access are inconsistent

Some reference endpoints correctly require authentication only, including device models, spare parts, system lists, and task type lookups. Branch, department, and geographic lookups historically required their administration-page permissions, which caused routine forms to depend on sidebar visibility.

The intended separation should be:

| Concern | Permission type |
|---|---|
| Show an administration page/sidebar item | Surface `view` permission |
| Load reference data inside a permitted workflow | `reference_data.lookup` or authenticated lookup |
| Change domain records | Domain `create`, `edit`, `delete`, or `manage` permission |
| Limit which records are visible | Scope and subject authorization |

### P3 - Defined permissions with no detected enforcement

The static scan found 18 defined keys with no direct code check. These include task subtype permissions, telemarketing reporting permissions, and workflow capability flags. They may be planned, obsolete, or enforced indirectly; each needs an owner decision before removal.

## Reviewed Alternative Permissions

The client update endpoint accepts `clients.edit` or `clients.contacts.edit`, but performs a second body-sensitive check. `clients.contacts.edit` can update only the `contacts` field; broader changes still require `clients.edit`. This case is deliberate and is not currently a privilege escalation.

The audit found 25 endpoints with OR permission guards. They should remain review candidates because the middleware does not distinguish aliases from contextual alternatives.

## Inventory Totals

- 130 permission keys defined in migrations.
- 119 permission keys directly referenced by scanned code.
- 7 referenced keys without a visible catalog definition.
- 18 defined keys without a visible direct use.
- 25 endpoints with alternative permission guards.
- 0 duplicate catalog definitions detected by key.

## Recommended Order For Step 2

1. Define a canonical permission dictionary and aliases/deprecations.
2. Add dedicated department mutation permissions.
3. Resolve the four missing employee permissions.
4. Replace the three undefined UI keys with canonical permissions or define them intentionally.
5. Review the 25 OR guards and the 18 apparently unused definitions.
6. Add automated validation that fails when code references an undefined permission key.
