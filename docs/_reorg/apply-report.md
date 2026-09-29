# docs reorg — step A APPLY report

Generated 2026-09-29T07:14:48.378Z

## Summary

```json
{
  "moves": 222,
  "deletes": 4,
  "filesRewritten": 121,
  "memoryFiles": 12,
  "links": 283,
  "rooted": 113,
  "relative": 60,
  "bare": 17,
  "patches": 1,
  "preBroken": 9,
  "postBroken": 9,
  "linksToDeleted": 1,
  "repairedPreBroken": 14,
  "NEW_BROKEN": 0,
  "errors": 0
}
```


## Moves by destination

| destination | files |
|---|---|
| `docs/archive/analysis` | 12 |
| `docs/archive/deliverables` | 2 |
| `docs/archive/handoffs` | 7 |
| `docs/archive/hermes` | 6 |
| `docs/archive/plans` | 14 |
| `docs/archive/prompts` | 76 |
| `docs/archive/sessions` | 2 |
| `docs/archive/superseded` | 8 |
| `docs/constitution/domains` | 2 |
| `docs/constitution/features` | 23 |
| `docs/constitution/standards` | 7 |
| `docs/constitution/templates` | 1 |
| `docs/constitution/trackers` | 6 |
| `docs/deliverables/animation-storyboard.md` | 1 |
| `docs/deliverables/phase1-acceptance-deck-notes.md` | 1 |
| `docs/deliverables/عرض-اعتماد-المرحلة-الأولى-مفصّل.pptx` | 1 |
| `docs/deliverables/عرض-المشروع-20-نقطة.pptx` | 1 |
| `docs/engineering/api` | 22 |
| `docs/engineering/audits` | 20 |
| `docs/engineering/design` | 1 |
| `docs/engineering/runbooks` | 9 |

## Deletes

- `docs/analysis/1.xlsx`
- `docs/constitution.rar`
- `docs/constitution/domains/org-structure.md`
- `docs/constitution/vault-migration-map.md`

## Renamed basenames (bare-token replacement)

- `CONSTITUTION-WORKFLOW.md` → `constitution-workflow.md`
- `06-gaps-and-questions.md` → `contracts-gaps-and-questions.md`
- `06a-current-implementation-audit.md` → `contracts-06a-current-implementation-audit.md`
- `07-task-backlog.md` → `contracts-task-backlog.md`
- `tasks-unified.md` → `tasks-unified-template.md`
- `device-installation-task.md` → `device-installation.md`
- `توثيق الزبون.md` → `client-documentation.md`
- `deployment-guide.md` → `docker-jenkins-new-server.md`
- `OPERATIONS.md` → `pm2-production-operations.md`
- `SERVER-DEPLOY.md` → `pm2-production-first-setup.md`

## Directory remaps

- `docs/analysis/snapshots/` → `docs/archive/analysis/snapshots/`
- `docs/constitution/handoffs/` → `docs/archive/handoffs/`
- `docs/constitution/hermes/` → `docs/archive/hermes/`
- `docs/constitution/tasks/` → `docs/archive/prompts/`
- `docs/design/` → `docs/engineering/design/`
- `docs/prompts/` → `docs/archive/prompts/`
- `docs/runbooks/` → `docs/engineering/runbooks/`
- `docs/session-handoff/` → `docs/archive/handoffs/`
- `docs/session-summaries/` → `docs/archive/sessions/`
- `docs/tasks/` → `docs/archive/prompts/`

## Files whose references change

| file | links | rooted | relative | bare | patch |
|---|---|---|---|---|---|
| `docs/constitution/GAPS-TRACKER.md` → `docs/constitution/trackers/GAPS-TRACKER.md` | 82 | 1 | 7 | 0 | 0 |
| `docs/constitution/CROSS-REFERENCE.md` → `docs/constitution/trackers/CROSS-REFERENCE.md` | 43 | 0 | 2 | 0 | 0 |
| `docs/constitution/INDEX.md` | 27 | 0 | 15 | 0 | 0 |
| `docs/constitution/contracts/README.md` | 8 | 0 | 0 | 7 | 0 |
| `docs/analysis/employees-records-audit-acceptance.md` → `docs/engineering/audits/employees-records-audit-acceptance.md` | 10 | 0 | 0 | 0 | 0 |
| `docs/constitution/plans/2026-06-02-dashboard-refactor.md` → `docs/archive/plans/2026-06-02-dashboard-refactor.md` | 9 | 0 | 0 | 0 | 0 |
| `docs/constitution/contracts/07-task-backlog.md` → `docs/constitution/trackers/contracts-task-backlog.md` | 7 | 0 | 0 | 1 | 0 |
| `docs/constitution/contracts/08-resolved-decisions.md` | 4 | 0 | 0 | 3 | 0 |
| `docs/analysis/customer-calls-report.md` → `docs/constitution/features/reports/customer-calls-report.md` | 6 | 0 | 0 | 0 | 0 |
| `docs/analysis/task-model.md` → `docs/constitution/domains/task-model.md` | 0 | 6 | 0 | 0 | 0 |
| `docs/constitution/handoffs/2026-06-10-legacy-cleanup-handoff.md` → `docs/archive/handoffs/2026-06-10-legacy-cleanup-handoff.md` | 1 | 0 | 5 | 0 | 0 |
| `docs/constitution/plans/2026-06-04-maintenance-phase-0-1-status.md` → `docs/archive/plans/2026-06-04-maintenance-phase-0-1-status.md` | 3 | 0 | 2 | 1 | 0 |
| `docs/constitution/domains/permissions-engineering-standard.md` → `docs/constitution/standards/permissions-engineering-standard.md` | 1 | 4 | 0 | 0 | 0 |
| `docs/constitution/features/route-assignment.md` | 0 | 5 | 0 | 0 | 0 |
| `docs/constitution/hermes/MASTER.md` → `docs/archive/hermes/MASTER.md` | 0 | 0 | 5 | 0 | 0 |
| `docs/analysis/temporary-contract-report.md` → `docs/constitution/features/reports/temporary-contract-report.md` | 4 | 0 | 0 | 0 | 0 |
| `docs/constitution/domains/reporting-analytics.md` | 1 | 3 | 0 | 0 | 0 |
| `docs/constitution/features/tasks/maintenance-test-scenarios.md` → `docs/archive/plans/maintenance-test-scenarios.md` | 4 | 0 | 0 | 0 | 0 |
| `docs/constitution/features/tasks/maintenance-v1.md` | 4 | 0 | 0 | 0 | 0 |
| `docs/session-handoff/2026-05-23-session-handoff.md` → `docs/archive/handoffs/2026-05-23-session-handoff.md` | 0 | 4 | 0 | 0 | 0 |
| `scripts/audit-permissions.mjs` | 0 | 3 | 0 | 0 | 1 |
| `docs/OPERATIONS.md` → `docs/engineering/runbooks/pm2-production-operations.md` | 1 | 0 | 0 | 2 | 0 |
| `docs/analysis/golden-warranty-report.md` → `docs/constitution/features/reports/golden-warranty-report.md` | 3 | 0 | 0 | 0 | 0 |
| `docs/analysis/name-lists-audit-acceptance.md` → `docs/engineering/audits/name-lists-audit-acceptance.md` | 3 | 0 | 0 | 0 | 0 |
| `docs/api/mobile-app-auth-api-reference.md` → `docs/engineering/api/mobile-app-auth-api-reference.md` | 0 | 3 | 0 | 0 | 0 |
| `docs/constitution/decisions/DEC-001-multi-branch-client-service.md` | 3 | 0 | 0 | 0 | 0 |
| `docs/constitution/decisions/DEC-017-app-devices-and-visits.md` | 0 | 2 | 1 | 0 | 0 |
| `docs/constitution/decisions/DEC-018-independent-complaints-domain.md` | 0 | 3 | 0 | 0 | 0 |
| `docs/constitution/domains/field-visits.md` | 1 | 1 | 1 | 0 | 0 |
| `docs/constitution/features/gifts.md` | 3 | 0 | 0 | 0 | 0 |
| `docs/constitution/features/planning-contact-targets.md` | 1 | 1 | 1 | 0 | 0 |
| `docs/constitution/features/tasks/device-activation.md` | 2 | 0 | 1 | 0 | 0 |
| `docs/constitution/features/tasks/device-delivery.md` | 2 | 0 | 1 | 0 | 0 |
| `docs/constitution/features/tasks/device-demo.md` | 2 | 0 | 1 | 0 | 0 |
| `docs/constitution/features/tasks/device-disconnection.md` | 2 | 0 | 1 | 0 | 0 |
| `docs/constitution/features/tasks/installment-collection.md` | 2 | 0 | 1 | 0 | 0 |
| `docs/constitution/features/tasks/maintenance-implementation-plan.md` → `docs/archive/plans/maintenance-implementation-plan.md` | 3 | 0 | 0 | 0 | 0 |
| `docs/constitution/features/tasks/maintenance.md` | 3 | 0 | 0 | 0 | 0 |
| `docs/constitution/features/unified-task-template.md` → `docs/constitution/templates/unified-task-template.md` | 0 | 0 | 3 | 0 | 0 |
| `docs/constitution/plans/2026-06-14-eligible-task-implementation-plan.md` → `docs/archive/plans/2026-06-14-eligible-task-implementation-plan.md` | 3 | 0 | 0 | 0 | 0 |
| `docs/constitution/request-section-contract.md` → `docs/constitution/features/request-section-contract.md` | 0 | 0 | 3 | 0 | 0 |
| `docs/plans/2026-05-10-device-demo-detail-plan.md` → `docs/archive/plans/2026-05-10-device-demo-detail-plan.md` | 0 | 3 | 0 | 0 | 0 |
| `docs/tasks/TASK_BRANCHES_CONSTITUTION_PROMPT.md` → `docs/archive/prompts/TASK_BRANCHES_CONSTITUTION_PROMPT.md` | 1 | 2 | 0 | 0 | 0 |
| `docs/tasks/TASK_CANDIDATES_CONSTITUTION_PROMPT.md` → `docs/archive/prompts/TASK_CANDIDATES_CONSTITUTION_PROMPT.md` | 1 | 2 | 0 | 0 | 0 |
| `docs/tasks/TASK_CONTRACTS_CONSTITUTION_PROMPT.md` → `docs/archive/prompts/TASK_CONTRACTS_CONSTITUTION_PROMPT.md` | 1 | 2 | 0 | 0 | 0 |
| `docs/tasks/TASK_DEVICES_MAINTENANCE_CONSTITUTION_PROMPT.md` → `docs/archive/prompts/TASK_DEVICES_MAINTENANCE_CONSTITUTION_PROMPT.md` | 1 | 2 | 0 | 0 | 0 |
| `docs/tasks/TASK_FIELD_VISITS_CONSTITUTION_PROMPT.md` → `docs/archive/prompts/TASK_FIELD_VISITS_CONSTITUTION_PROMPT.md` | 1 | 2 | 0 | 0 | 0 |
| `docs/tasks/TASK_GEO_UNITS_CONSTITUTION_PROMPT.md` → `docs/archive/prompts/TASK_GEO_UNITS_CONSTITUTION_PROMPT.md` | 1 | 2 | 0 | 0 | 0 |
| `docs/tasks/TASK_PERMISSIONS_ROLES_CONSTITUTION_PROMPT.md` → `docs/archive/prompts/TASK_PERMISSIONS_ROLES_CONSTITUTION_PROMPT.md` | 1 | 2 | 0 | 0 | 0 |
| `docs/tasks/TASK_TELEMARKETING_CONSTITUTION_PROMPT.md` → `docs/archive/prompts/TASK_TELEMARKETING_CONSTITUTION_PROMPT.md` | 1 | 2 | 0 | 0 | 0 |
| `packages/web/src/lib/api.ts` | 0 | 3 | 0 | 0 | 0 |
| `docs/APP-NOTIFICATIONS-SETUP.md` → `docs/engineering/runbooks/APP-NOTIFICATIONS-SETUP.md` | 1 | 0 | 0 | 1 | 0 |
| `docs/RASEL-OTP-SETUP.md` → `docs/engineering/runbooks/RASEL-OTP-SETUP.md` | 1 | 0 | 0 | 1 | 0 |
| `docs/SERVER-DEPLOY.md` → `docs/engineering/runbooks/pm2-production-first-setup.md` | 1 | 0 | 0 | 1 | 0 |
| `docs/analysis/candidates-records-performance-and-filters.md` → `docs/engineering/api/candidates-records-performance-and-filters.md` | 2 | 0 | 0 | 0 | 0 |
| `docs/analysis/daily-work-sales-file-report.md` → `docs/constitution/features/reports/daily-work-sales-file-report.md` | 2 | 0 | 0 | 0 | 0 |
| `docs/analysis/permission-inventory.md` → `docs/engineering/audits/permission-inventory.md` | 0 | 2 | 0 | 0 | 0 |
| `docs/analysis/sales-by-type-report.md` → `docs/constitution/features/reports/sales-by-type-report.md` | 2 | 0 | 0 | 0 | 0 |
| `docs/constitution/CONSTITUTION-WORKFLOW.md` → `docs/constitution/standards/constitution-workflow.md` | 0 | 2 | 0 | 0 | 0 |
| `docs/constitution/components/task-detail-page.md` | 1 | 0 | 1 | 0 | 0 |
| `docs/constitution/contracts/06a-current-implementation-audit.md` → `docs/archive/analysis/contracts-06a-current-implementation-audit.md` | 2 | 0 | 0 | 0 | 0 |
| `docs/constitution/decisions/DEC-009-eligible-task-and-contact-lifecycle.md` | 1 | 0 | 1 | 0 | 0 |
| `docs/constitution/decisions/DEC-013-account-creation-and-app-auth.md` | 0 | 2 | 0 | 0 | 0 |
| `docs/constitution/domains/geo-units.md` | 2 | 0 | 0 | 0 | 0 |
| `docs/constitution/domains/planning.md` | 0 | 1 | 1 | 0 | 0 |
| `docs/constitution/domains/visits.md` | 1 | 0 | 1 | 0 | 0 |
| `docs/constitution/features/tasks/device-retrieval.md` | 1 | 0 | 1 | 0 | 0 |
| `docs/constitution/features/tasks/gift-delivery.md` | 1 | 0 | 1 | 0 | 0 |
| `docs/constitution/plans/2026-06-01-implementation-status.md` → `docs/archive/plans/2026-06-01-implementation-status.md` | 0 | 1 | 1 | 0 | 0 |
| `docs/tasks/TASK_165_FRONTEND_REBUILD_PROMPT.md` → `docs/archive/prompts/TASK_165_FRONTEND_REBUILD_PROMPT.md` | 0 | 2 | 0 | 0 | 0 |
| `docs/tasks/TASK_EMPLOYEES_CONSTITUTION_PROMPT.md` → `docs/archive/prompts/TASK_EMPLOYEES_CONSTITUTION_PROMPT.md` | 0 | 2 | 0 | 0 | 0 |
| `docs/tasks/TASK_OPEN_TASKS_CONSTITUTION_PROMPT.md` → `docs/archive/prompts/TASK_OPEN_TASKS_CONSTITUTION_PROMPT.md` | 0 | 2 | 0 | 0 | 0 |
| `docs/visit-lifecycle-contract.md` → `docs/archive/superseded/visit-lifecycle-contract.md` | 0 | 2 | 0 | 0 | 0 |
| `docs/visit-lifecycle-fix-plan.md` → `docs/archive/superseded/visit-lifecycle-fix-plan.md` | 0 | 2 | 0 | 0 | 0 |
| `packages/api/routes/appServiceRequests.ts` | 0 | 2 | 0 | 0 | 0 |
| `packages/shared/types.ts` | 0 | 2 | 0 | 0 | 0 |
| `.env.example` | 0 | 1 | 0 | 0 | 0 |
| `AGENTS.md` | 0 | 1 | 0 | 0 | 0 |
| `docs/analysis/branches-departments-audit.md` → `docs/engineering/audits/branches-departments-audit.md` | 0 | 1 | 0 | 0 | 0 |
| `docs/analysis/clients-records-audit-acceptance.md` → `docs/engineering/audits/clients-records-audit-acceptance.md` | 1 | 0 | 0 | 0 | 0 |
| `docs/analysis/contracts-records-performance-filters-and-stats.md` → `docs/engineering/api/contracts-records-performance-filters-and-stats.md` | 1 | 0 | 0 | 0 | 0 |
| `docs/analysis/department-results-report.md` → `docs/constitution/features/reports/department-results-report.md` | 1 | 0 | 0 | 0 | 0 |
| `docs/analysis/sales-count-report.md` → `docs/constitution/features/reports/sales-count-report.md` | 1 | 0 | 0 | 0 | 0 |
| `docs/analysis/task-scheduling-patterns.md` → `docs/constitution/standards/task-scheduling-patterns.md` | 0 | 1 | 0 | 0 | 0 |
| `docs/analysis/technician-work-report.md` → `docs/constitution/features/reports/technician-work-report.md` | 1 | 0 | 0 | 0 | 0 |
| `docs/api/mobile-device-catalog-api-reference.md` → `docs/engineering/api/mobile-device-catalog-api-reference.md` | 0 | 1 | 0 | 0 | 0 |
| `docs/api/mobile-service-requests-api-reference.md` → `docs/engineering/api/mobile-service-requests-api-reference.md` | 0 | 1 | 0 | 0 | 0 |
| `docs/api/mobile-visits-api-reference.md` → `docs/engineering/api/mobile-visits-api-reference.md` | 0 | 1 | 0 | 0 | 0 |
| `docs/constitution/README.md` | 0 | 1 | 0 | 0 | 0 |
| `docs/constitution/contracts/02b-contract-warranties.md` | 1 | 0 | 0 | 0 | 0 |
| `docs/constitution/contracts/06-gaps-and-questions.md` → `docs/constitution/trackers/contracts-gaps-and-questions.md` | 1 | 0 | 0 | 0 | 0 |
| `docs/constitution/decisions/DEC-012-catalog-active-state.md` | 0 | 1 | 0 | 0 | 0 |
| `docs/constitution/decisions/DEC-016-water-check-unverified-intake.md` | 0 | 1 | 0 | 0 | 0 |
| `docs/constitution/domains/roles-and-permissions.md` | 0 | 0 | 1 | 0 | 0 |
| `docs/constitution/domains/section-audit-protocol.md` → `docs/constitution/standards/section-audit-protocol.md` | 1 | 0 | 0 | 0 | 0 |
| `docs/constitution/features/task-definition-constitution.md` → `docs/archive/superseded/task-definition-constitution.md` | 1 | 0 | 0 | 0 | 0 |
| `docs/constitution/features/unified-task-creation-guide.md` → `docs/engineering/runbooks/unified-task-creation-guide.md` | 0 | 1 | 0 | 0 | 0 |
| `docs/constitution/features/zone-study.md` | 0 | 1 | 0 | 0 | 0 |
| `docs/constitution/handoffs/2026-05-12-p1-p4-findings-handoff.md` → `docs/archive/handoffs/2026-05-12-p1-p4-findings-handoff.md` | 0 | 1 | 0 | 0 | 0 |
| `docs/constitution/hermes/MEMORY.md` → `docs/archive/hermes/MEMORY.md` | 0 | 1 | 0 | 0 | 0 |
| `docs/constitution/plans/2026-06-10-telemarketing-appointments-migration.md` → `docs/archive/plans/2026-06-10-telemarketing-appointments-migration.md` | 0 | 0 | 1 | 0 | 0 |
| `docs/constitution/plans/permissions-view-strategy.md` → `docs/constitution/features/permissions-view-strategy.md` | 0 | 0 | 1 | 0 | 0 |
| `docs/constitution/project-constitution.md` | 0 | 1 | 0 | 0 | 0 |
| `docs/constitution/tasks/TASK_CLIENT_ENTITY_MAP_ANALYSIS_PROMPT.md` → `docs/archive/prompts/TASK_CLIENT_ENTITY_MAP_ANALYSIS_PROMPT.md` | 0 | 1 | 0 | 0 | 0 |
| `docs/engineering-change-process.md` → `docs/constitution/standards/engineering-change-process.md` | 0 | 1 | 0 | 0 | 0 |
| `docs/prompts/2026-06-10-contract-fixes-execution.md` → `docs/archive/prompts/2026-06-10-contract-fixes-execution.md` | 0 | 1 | 0 | 0 | 0 |
| `docs/session-summaries/2026-05-21-devices-contracts-legal-identity.md` → `docs/archive/sessions/2026-05-21-devices-contracts-legal-identity.md` | 0 | 1 | 0 | 0 | 0 |
| `docs/tasks/TASK_NAME_COLLECTIONS_REFERRAL_SHEETS.md` → `docs/archive/prompts/TASK_NAME_COLLECTIONS_REFERRAL_SHEETS.md` | 0 | 1 | 0 | 0 | 0 |
| `docs/tasks/TASK_TELEMARKETING_409_FIX_PROMPT.md` → `docs/archive/prompts/TASK_TELEMARKETING_409_FIX_PROMPT.md` | 0 | 1 | 0 | 0 | 0 |
| `docs/tasks/TASK_UNIFY_MINI_CLIENT_SNAPSHOT.md` → `docs/archive/prompts/TASK_UNIFY_MINI_CLIENT_SNAPSHOT.md` | 0 | 1 | 0 | 0 | 0 |
| `packages/api/routes/appDevices.contract.test.ts` | 0 | 1 | 0 | 0 | 0 |
| `packages/api/routes/clients.ts` | 0 | 1 | 0 | 0 | 0 |
| `packages/api/routes/contracts.ts` | 0 | 1 | 0 | 0 | 0 |
| `packages/api/routes/telemarketing.ts` | 0 | 1 | 0 | 0 | 0 |
| `packages/web/src/components/requests/RequestDetailLayout.tsx` | 0 | 1 | 0 | 0 | 0 |
| `packages/web/src/components/requests/RequestsListView.tsx` | 0 | 1 | 0 | 0 | 0 |
| `packages/web/src/pages/Clients.tsx` | 0 | 1 | 0 | 0 | 0 |
| `packages/web/src/pages/candidates/CandidatesEntry.tsx` | 0 | 1 | 0 | 0 | 0 |
| `packages/web/src/pages/jobs/applicationAttachmentPolicy.test.ts` | 0 | 1 | 0 | 0 | 0 |
| `packages/web/src/pages/tasks/TaskGroupPage.tsx` | 0 | 1 | 0 | 0 | 0 |
| `scripts/audit-branch-scope.mjs` | 0 | 1 | 0 | 0 | 0 |

## ❗ NEW broken links caused by the move (0) — must be 0


## Pre-broken links auto-repaired by unique basename (14)

- docs/constitution/INDEX.md → tasks/TASK_UNIFY_MINI_CLIENT_SNAPSHOT.md  ⇒  docs/archive/prompts/TASK_UNIFY_MINI_CLIENT_SNAPSHOT.md
- docs/constitution/INDEX.md → tasks/TASK_UNIFY_MINI_CLIENT_SNAPSHOT_PROMPT.md  ⇒  docs/archive/prompts/TASK_UNIFY_MINI_CLIENT_SNAPSHOT_PROMPT.md
- docs/constitution/INDEX.md → tasks/TASK_NAME_COLLECTIONS_REFERRAL_SHEETS.md  ⇒  docs/archive/prompts/TASK_NAME_COLLECTIONS_REFERRAL_SHEETS.md
- docs/constitution/INDEX.md → tasks/TASK_NAME_COLLECTIONS_REFERRAL_SHEETS_PROMPT.md  ⇒  docs/archive/prompts/TASK_NAME_COLLECTIONS_REFERRAL_SHEETS_PROMPT.md
- docs/constitution/domains/geo-units.md → ../../GAPS-TRACKER.md#gap-062  ⇒  docs/constitution/trackers/GAPS-TRACKER.md
- docs/constitution/features/tasks/maintenance.md → packages/api/routes/emergencyResult.ts  ⇒  packages/api/routes/emergencyResult.ts
- docs/tasks/TASK_BRANCHES_CONSTITUTION_PROMPT.md → domains/branches.md  ⇒  docs/constitution/domains/branches.md
- docs/tasks/TASK_CANDIDATES_CONSTITUTION_PROMPT.md → domains/candidates.md  ⇒  docs/constitution/domains/candidates.md
- docs/tasks/TASK_CONTRACTS_CONSTITUTION_PROMPT.md → domains/contracts.md  ⇒  docs/constitution/domains/contracts.md
- docs/tasks/TASK_DEVICES_MAINTENANCE_CONSTITUTION_PROMPT.md → domains/devices-maintenance.md  ⇒  docs/constitution/domains/devices-maintenance.md
- docs/tasks/TASK_FIELD_VISITS_CONSTITUTION_PROMPT.md → domains/field-visits.md  ⇒  docs/constitution/domains/field-visits.md
- docs/tasks/TASK_GEO_UNITS_CONSTITUTION_PROMPT.md → domains/geo-units.md  ⇒  docs/constitution/domains/geo-units.md
- docs/tasks/TASK_PERMISSIONS_ROLES_CONSTITUTION_PROMPT.md → domains/permissions.md  ⇒  docs/constitution/domains/permissions.md
- docs/tasks/TASK_TELEMARKETING_CONSTITUTION_PROMPT.md → domains/telemarketing.md  ⇒  docs/constitution/domains/telemarketing.md

## Links still broken after the move (9) — pre-existing

- docs/constitution/INDEX.md → domains/org-structure.md
- docs/archive/analysis/contracts-06a-current-implementation-audit.md → ../../../migrations/190_create_installed_devices.sql
- docs/archive/analysis/contracts-06a-current-implementation-audit.md → ../../../migrations/191_installed_devices_trigger.sql
- docs/archive/analysis/contracts-06a-current-implementation-audit.md → ../../../migrations/178_device_status_extend.sql
- docs/archive/analysis/contracts-06a-current-implementation-audit.md → ../../../migrations/196_device_warranties.sql
- docs/archive/analysis/contracts-06a-current-implementation-audit.md → ../../../migrations/001_core_tables.sql
- docs/archive/analysis/contracts-06a-current-implementation-audit.md → ../../../migrations/197_device_installed_parts.sql
- docs/constitution/standards/web-device-access-policy.md → packages/api/middleware/auth.ts
- docs/archive/prompts/TASK_OPEN_TASKS_CONSTITUTION_PROMPT.md → domains/open-tasks.md

## Links already broken BEFORE the move (9) — left untouched

- docs/constitution/contracts/06a-current-implementation-audit.md → ../../../migrations/190_create_installed_devices.sql
- docs/constitution/contracts/06a-current-implementation-audit.md → ../../../migrations/191_installed_devices_trigger.sql
- docs/constitution/contracts/06a-current-implementation-audit.md → ../../../migrations/178_device_status_extend.sql
- docs/constitution/contracts/06a-current-implementation-audit.md → ../../../migrations/196_device_warranties.sql
- docs/constitution/contracts/06a-current-implementation-audit.md → ../../../migrations/001_core_tables.sql
- docs/constitution/contracts/06a-current-implementation-audit.md → ../../../migrations/197_device_installed_parts.sql
- docs/constitution/domains/web-device-access-policy.md → packages/api/middleware/auth.ts
- docs/constitution/features/tasks/device-activation.md → ./device-installation.md
- docs/tasks/TASK_OPEN_TASKS_CONSTITUTION_PROMPT.md → domains/open-tasks.md

## Links pointing to deleted files (1)

- docs/constitution/INDEX.md → domains/org-structure.md

## Report-only (not modified: migrations / temp dirs)

- `migrations/254_device_installation_canonical_result.sql (1)`
- `migrations/266_add_contracts_close_and_assign_permissions.sql (1)`
- `migrations/270_migrate_historic_telemarketing_appointments.sql (1)`
- `migrations/382_request_permission_families.sql (1)`
- `migrations/383_drop_request_info_add_stale_setting.sql (1)`
- `migrations/394_clients_records_performance_indexes.sql (1)`
- `migrations/438_candidates_records_performance_indexes.sql (1)`
- `scratch/device_task_guard_policy/build_device_task_guard_policy.mjs (1)`

## Memory files to update (outside repo)

- project_account_creation_app_auth.md (2)
- project_app_devices_and_visits.md (1)
- project_app_notifications.md (3)
- project_branch_scope_architecture.md (1)
- project_clients_perf_filters.md (1)
- project_eligible_task_definition.md (1)
- project_employees_section_audit.md (1)
- project_installed_devices_records.md (1)
- project_permissions_systemic_backlog.md (1)
- project_reporting_analytics.md (1)
- project_request_section_contract.md (2)
- project_section_audit_protocol.md (3)

## Full move list

| from | to |
|---|---|
| `docs/analysis/assigned-phase-implementation-plan.md` | `docs/archive/analysis/assigned-phase-implementation-plan.md` |
| `docs/analysis/branches-departments-audit.md` | `docs/engineering/audits/branches-departments-audit.md` |
| `docs/analysis/candidates-critical-audit-areas.csv` | `docs/engineering/audits/candidates-critical-audit-areas.csv` |
| `docs/analysis/candidates-permissions-test-matrix.csv` | `docs/engineering/audits/candidates-permissions-test-matrix.csv` |
| `docs/analysis/candidates-records-performance-and-filters.md` | `docs/engineering/api/candidates-records-performance-and-filters.md` |
| `docs/analysis/candidates-referral-sheets-filters-audit.md` | `docs/engineering/audits/candidates-referral-sheets-filters-audit.md` |
| `docs/analysis/catalog-active-state-legacy-mapping.md` | `docs/engineering/runbooks/catalog-active-state-legacy-mapping.md` |
| `docs/analysis/catalog-active-state-usage-audit.md` | `docs/archive/analysis/catalog-active-state-usage-audit.md` |
| `docs/analysis/clients-critical-audit-areas.csv` | `docs/engineering/audits/clients-critical-audit-areas.csv` |
| `docs/analysis/clients-permissions-test-matrix.csv` | `docs/engineering/audits/clients-permissions-test-matrix.csv` |
| `docs/analysis/clients-records-audit-acceptance.md` | `docs/engineering/audits/clients-records-audit-acceptance.md` |
| `docs/analysis/clients-records-performance-and-filters.md` | `docs/engineering/api/clients-records-performance-and-filters.md` |
| `docs/analysis/contracts-records-performance-filters-and-stats.md` | `docs/engineering/api/contracts-records-performance-filters-and-stats.md` |
| `docs/analysis/customer-calls-report.md` | `docs/constitution/features/reports/customer-calls-report.md` |
| `docs/analysis/daily-work-sales-file-report.md` | `docs/constitution/features/reports/daily-work-sales-file-report.md` |
| `docs/analysis/department-results-report.md` | `docs/constitution/features/reports/department-results-report.md` |
| `docs/analysis/device-demo-lifecycle.md` | `docs/archive/analysis/device-demo-lifecycle.md` |
| `docs/analysis/device-faults-report.md` | `docs/constitution/features/reports/device-faults-report.md` |
| `docs/analysis/employees-critical-audit-areas.csv` | `docs/engineering/audits/employees-critical-audit-areas.csv` |
| `docs/analysis/employees-permissions-test-matrix.csv` | `docs/engineering/audits/employees-permissions-test-matrix.csv` |
| `docs/analysis/employees-records-audit-acceptance.md` | `docs/engineering/audits/employees-records-audit-acceptance.md` |
| `docs/analysis/gift-permission-audit.md` | `docs/engineering/audits/gift-permission-audit.md` |
| `docs/analysis/golden-warranty-report.md` | `docs/constitution/features/reports/golden-warranty-report.md` |
| `docs/analysis/implementation-plan.md` | `docs/archive/analysis/implementation-plan.md` |
| `docs/analysis/installed-devices-records-performance-filters-and-stats.md` | `docs/engineering/api/installed-devices-records-performance-filters-and-stats.md` |
| `docs/analysis/mediator-gifts-report.md` | `docs/constitution/features/reports/mediator-gifts-report.md` |
| `docs/analysis/name-lists-audit-acceptance.md` | `docs/engineering/audits/name-lists-audit-acceptance.md` |
| `docs/analysis/name-lists-critical-audit-areas.csv` | `docs/engineering/audits/name-lists-critical-audit-areas.csv` |
| `docs/analysis/name-lists-permissions-test-matrix.csv` | `docs/engineering/audits/name-lists-permissions-test-matrix.csv` |
| `docs/analysis/permission-audit-findings.md` | `docs/engineering/audits/permission-audit-findings.md` |
| `docs/analysis/permission-endpoints.csv` | `docs/engineering/audits/permission-endpoints.csv` |
| `docs/analysis/permission-inventory.csv` | `docs/engineering/audits/permission-inventory.csv` |
| `docs/analysis/permission-inventory.md` | `docs/engineering/audits/permission-inventory.md` |
| `docs/analysis/retrieved-devices-report.md` | `docs/constitution/features/reports/retrieved-devices-report.md` |
| `docs/analysis/sales-by-type-report.md` | `docs/constitution/features/reports/sales-by-type-report.md` |
| `docs/analysis/sales-count-report.md` | `docs/constitution/features/reports/sales-count-report.md` |
| `docs/analysis/service-dues-report.md` | `docs/constitution/features/reports/service-dues-report.md` |
| `docs/analysis/sidebar-navigation-redesign.md` | `docs/archive/analysis/sidebar-navigation-redesign.md` |
| `docs/analysis/snapshots/MainLayout.sidebar-before-2026-09-08.manifest.md` | `docs/archive/analysis/snapshots/MainLayout.sidebar-before-2026-09-08.manifest.md` |
| `docs/analysis/snapshots/MainLayout.sidebar-before-2026-09-08.tsx.txt` | `docs/archive/analysis/snapshots/MainLayout.sidebar-before-2026-09-08.tsx.txt` |
| `docs/analysis/supervisor-alerts-review.md` | `docs/engineering/audits/supervisor-alerts-review.md` |
| `docs/analysis/task-lifecycle-analysis.md` | `docs/archive/analysis/task-lifecycle-analysis.md` |
| `docs/analysis/task-model.md` | `docs/constitution/domains/task-model.md` |
| `docs/analysis/task-scheduling-patterns.md` | `docs/constitution/standards/task-scheduling-patterns.md` |
| `docs/analysis/technician-work-report.md` | `docs/constitution/features/reports/technician-work-report.md` |
| `docs/analysis/temporary-contract-report.md` | `docs/constitution/features/reports/temporary-contract-report.md` |
| `docs/analysis/unified-task-model.md` | `docs/archive/analysis/unified-task-model.md` |
| `docs/analysis/unified-task-template-design.md` | `docs/archive/analysis/unified-task-template-design.md` |
| `docs/analysis/مهام الزيارات.pdf` | `docs/constitution/domains/مهام الزيارات.pdf` |
| `docs/api/complaints-api-reference.md` | `docs/engineering/api/complaints-api-reference.md` |
| `docs/api/mobile-agent-license-api-reference.md` | `docs/engineering/api/mobile-agent-license-api-reference.md` |
| `docs/api/mobile-app-auth-api-reference.md` | `docs/engineering/api/mobile-app-auth-api-reference.md` |
| `docs/api/mobile-app-contact-links-api-reference.md` | `docs/engineering/api/mobile-app-contact-links-api-reference.md` |
| `docs/api/mobile-branch-catalog-api-reference.md` | `docs/engineering/api/mobile-branch-catalog-api-reference.md` |
| `docs/api/mobile-device-catalog-api-reference.md` | `docs/engineering/api/mobile-device-catalog-api-reference.md` |
| `docs/api/mobile-device-request-api-guide.md` | `docs/engineering/api/mobile-device-request-api-guide.md` |
| `docs/api/mobile-devices-api-reference.md` | `docs/engineering/api/mobile-devices-api-reference.md` |
| `docs/api/mobile-emergency-maintenance-api-reference.md` | `docs/engineering/api/mobile-emergency-maintenance-api-reference.md` |
| `docs/api/mobile-geo-selector-integration-guide.md` | `docs/engineering/api/mobile-geo-selector-integration-guide.md` |
| `docs/api/mobile-golden-warranty-api-reference.md` | `docs/engineering/api/mobile-golden-warranty-api-reference.md` |
| `docs/api/mobile-home-banners-api-reference.md` | `docs/engineering/api/mobile-home-banners-api-reference.md` |
| `docs/api/mobile-mediator-address-integration-guide-pro.md` | `docs/engineering/api/mobile-mediator-address-integration-guide-pro.md` |
| `docs/api/mobile-name-nomination-api-reference.md` | `docs/engineering/api/mobile-name-nomination-api-reference.md` |
| `docs/api/mobile-name-nomination-v2-repair-report.md` | `docs/archive/analysis/mobile-name-nomination-v2-repair-report.md` |
| `docs/api/mobile-periodic-maintenance-api-reference.md` | `docs/engineering/api/mobile-periodic-maintenance-api-reference.md` |
| `docs/api/mobile-recruitment-api-reference.md` | `docs/engineering/api/mobile-recruitment-api-reference.md` |
| `docs/api/mobile-service-requests-api-reference.md` | `docs/engineering/api/mobile-service-requests-api-reference.md` |
| `docs/api/mobile-visits-api-reference.md` | `docs/engineering/api/mobile-visits-api-reference.md` |
| `docs/APP-NOTIFICATIONS-MOBILE-HANDOFF.md` | `docs/archive/handoffs/APP-NOTIFICATIONS-MOBILE-HANDOFF.md` |
| `docs/APP-NOTIFICATIONS-SETUP.md` | `docs/engineering/runbooks/APP-NOTIFICATIONS-SETUP.md` |
| `docs/constitution/CONSTITUTION-WORKFLOW.md` | `docs/constitution/standards/constitution-workflow.md` |
| `docs/constitution/contracts/06-gaps-and-questions.md` | `docs/constitution/trackers/contracts-gaps-and-questions.md` |
| `docs/constitution/contracts/06a-current-implementation-audit.md` | `docs/archive/analysis/contracts-06a-current-implementation-audit.md` |
| `docs/constitution/contracts/07-task-backlog.md` | `docs/constitution/trackers/contracts-task-backlog.md` |
| `docs/constitution/CROSS-REFERENCE.md` | `docs/constitution/trackers/CROSS-REFERENCE.md` |
| `docs/constitution/domains/branch-scope-and-visibility-standard.md` | `docs/constitution/standards/branch-scope-and-visibility-standard.md` |
| `docs/constitution/domains/permissions-engineering-standard.md` | `docs/constitution/standards/permissions-engineering-standard.md` |
| `docs/constitution/domains/section-audit-protocol.md` | `docs/constitution/standards/section-audit-protocol.md` |
| `docs/constitution/domains/tasks-unified.md` | `docs/constitution/features/tasks/tasks-unified-template.md` |
| `docs/constitution/domains/web-device-access-policy.md` | `docs/constitution/standards/web-device-access-policy.md` |
| `docs/constitution/features/device-installation-task.md` | `docs/constitution/features/tasks/device-installation.md` |
| `docs/constitution/features/Jobs & Recruitment Features/applications.md` | `docs/constitution/features/jobs/applications.md` |
| `docs/constitution/features/Jobs & Recruitment Features/interviews.md` | `docs/constitution/features/jobs/interviews.md` |
| `docs/constitution/features/Jobs & Recruitment Features/manual-application-entry.md` | `docs/constitution/features/jobs/manual-application-entry.md` |
| `docs/constitution/features/Jobs & Recruitment Features/public-jobs.md` | `docs/constitution/features/jobs/public-jobs.md` |
| `docs/constitution/features/Jobs & Recruitment Features/README.md` | `docs/archive/superseded/features-jobs-recruitment-README.md` |
| `docs/constitution/features/Jobs & Recruitment Features/training-courses.md` | `docs/constitution/features/jobs/training-courses.md` |
| `docs/constitution/features/Jobs & Recruitment Features/vacancies.md` | `docs/constitution/features/jobs/vacancies.md` |
| `docs/constitution/features/marketing-visits.md` | `docs/archive/superseded/marketing-visits.md` |
| `docs/constitution/features/task-definition-constitution.md` | `docs/archive/superseded/task-definition-constitution.md` |
| `docs/constitution/features/task-reference-template.md` | `docs/archive/superseded/task-reference-template.md` |
| `docs/constitution/features/tasks/maintenance-implementation-plan.md` | `docs/archive/plans/maintenance-implementation-plan.md` |
| `docs/constitution/features/tasks/maintenance-test-scenarios.md` | `docs/archive/plans/maintenance-test-scenarios.md` |
| `docs/constitution/features/unified-task-creation-guide.md` | `docs/engineering/runbooks/unified-task-creation-guide.md` |
| `docs/constitution/features/unified-task-template.md` | `docs/constitution/templates/unified-task-template.md` |
| `docs/constitution/features/توثيق الزبون.md` | `docs/constitution/features/client-documentation.md` |
| `docs/constitution/GAPS-TRACKER.md` | `docs/constitution/trackers/GAPS-TRACKER.md` |
| `docs/constitution/handoffs/2026-05-11-planning-appointments-handoff.md` | `docs/archive/handoffs/2026-05-11-planning-appointments-handoff.md` |
| `docs/constitution/handoffs/2026-05-12-p1-p4-findings-handoff.md` | `docs/archive/handoffs/2026-05-12-p1-p4-findings-handoff.md` |
| `docs/constitution/handoffs/2026-06-10-legacy-cleanup-handoff.md` | `docs/archive/handoffs/2026-06-10-legacy-cleanup-handoff.md` |
| `docs/constitution/hermes/CODE_MAP.md` | `docs/archive/hermes/CODE_MAP.md` |
| `docs/constitution/hermes/DECISION_LOG.md` | `docs/archive/hermes/DECISION_LOG.md` |
| `docs/constitution/hermes/ENTITY_CHEAT_SHEET.md` | `docs/archive/hermes/ENTITY_CHEAT_SHEET.md` |
| `docs/constitution/hermes/GAPS_QUICKREF.md` | `docs/archive/hermes/GAPS_QUICKREF.md` |
| `docs/constitution/hermes/MASTER.md` | `docs/archive/hermes/MASTER.md` |
| `docs/constitution/hermes/MEMORY.md` | `docs/archive/hermes/MEMORY.md` |
| `docs/constitution/plans/2026-05-31-execution-plan.md` | `docs/archive/plans/2026-05-31-execution-plan.md` |
| `docs/constitution/plans/2026-06-01-implementation-status.md` | `docs/archive/plans/2026-06-01-implementation-status.md` |
| `docs/constitution/plans/2026-06-02-dashboard-refactor.md` | `docs/archive/plans/2026-06-02-dashboard-refactor.md` |
| `docs/constitution/plans/2026-06-04-maintenance-phase-0-1-status.md` | `docs/archive/plans/2026-06-04-maintenance-phase-0-1-status.md` |
| `docs/constitution/plans/2026-06-10-contract-form-fixes.md` | `docs/archive/plans/2026-06-10-contract-form-fixes.md` |
| `docs/constitution/plans/2026-06-10-telemarketing-appointments-migration.md` | `docs/archive/plans/2026-06-10-telemarketing-appointments-migration.md` |
| `docs/constitution/plans/2026-06-14-eligible-task-implementation-plan.md` | `docs/archive/plans/2026-06-14-eligible-task-implementation-plan.md` |
| `docs/constitution/plans/2026-07-30-layered-planning-curation-plan.md` | `docs/constitution/trackers/2026-07-30-layered-planning-curation-plan.md` |
| `docs/constitution/plans/2026-08-17-complaints-v1-implementation-plan.md` | `docs/constitution/trackers/2026-08-17-complaints-v1-implementation-plan.md` |
| `docs/constitution/plans/permissions-view-strategy.md` | `docs/constitution/features/permissions-view-strategy.md` |
| `docs/constitution/plans/PLAN-001-split-planning-domain.md` | `docs/archive/plans/PLAN-001-split-planning-domain.md` |
| `docs/constitution/presentation-points.md` | `docs/archive/deliverables/presentation-points.md` |
| `docs/constitution/request-section-contract.md` | `docs/constitution/features/request-section-contract.md` |
| `docs/constitution/tasks/TASK_CLIENT_ENTITY_MAP_ANALYSIS_PROMPT.md` | `docs/archive/prompts/TASK_CLIENT_ENTITY_MAP_ANALYSIS_PROMPT.md` |
| `docs/constitution/tasks/TASK_DAY_SCHEDULES_CONSTITUTION_PROMPT.md` | `docs/archive/prompts/TASK_DAY_SCHEDULES_CONSTITUTION_PROMPT.md` |
| `docs/constitution/tasks/TASK_WORK_SCOPES_CONSTITUTION_PROMPT.md` | `docs/archive/prompts/TASK_WORK_SCOPES_CONSTITUTION_PROMPT.md` |
| `docs/context-handoff.md` | `docs/archive/handoffs/context-handoff.md` |
| `docs/deployment-guide.md` | `docs/engineering/runbooks/docker-jenkins-new-server.md` |
| `docs/design/complaints-v1-designer-handoff.md` | `docs/engineering/design/complaints-v1-designer-handoff.md` |
| `docs/engineering-change-process.md` | `docs/constitution/standards/engineering-change-process.md` |
| `docs/marketing-visit-device-demo-fields.md` | `docs/engineering/audits/marketing-visit-device-demo-fields.md` |
| `docs/OPERATIONS.md` | `docs/engineering/runbooks/pm2-production-operations.md` |
| `docs/oreder.txt` | `docs/archive/prompts/oreder.txt` |
| `docs/plans/2026-05-03-branch-team-planning-sprints.md` | `docs/archive/plans/2026-05-03-branch-team-planning-sprints.md` |
| `docs/plans/2026-05-10-device-demo-detail-plan.md` | `docs/archive/plans/2026-05-10-device-demo-detail-plan.md` |
| `docs/plans/2026-05-21-device-demo-result-gaps-plan.md` | `docs/archive/superseded/2026-05-21-device-demo-result-gaps-plan.md` |
| `docs/plans/2026-05-21-task-contract-linking-plan.md` | `docs/archive/plans/2026-05-21-task-contract-linking-plan.md` |
| `docs/presentation/animation-storyboard.md` | `docs/deliverables/animation-storyboard.md` |
| `docs/presentation/phase1-acceptance-deck-notes.md` | `docs/deliverables/phase1-acceptance-deck-notes.md` |
| `docs/presentation/عرض-اعتماد-المرحلة-الأولى-مفصّل.pptx` | `docs/deliverables/عرض-اعتماد-المرحلة-الأولى-مفصّل.pptx` |
| `docs/presentation/عرض-اعتماد-المرحلة-الأولى.pptx` | `docs/archive/deliverables/عرض-اعتماد-المرحلة-الأولى.pptx` |
| `docs/presentation/عرض-المشروع-20-نقطة.pptx` | `docs/deliverables/عرض-المشروع-20-نقطة.pptx` |
| `docs/prompts/2026-06-10-contract-fixes-execution.md` | `docs/archive/prompts/2026-06-10-contract-fixes-execution.md` |
| `docs/RASEL-OTP-SETUP.md` | `docs/engineering/runbooks/RASEL-OTP-SETUP.md` |
| `docs/runbooks/production-release-checklist.md` | `docs/engineering/runbooks/production-release-checklist.md` |
| `docs/runbooks/unified-media-storage-cicd-runbook.md` | `docs/engineering/runbooks/unified-media-storage-cicd-runbook.md` |
| `docs/SERVER-DEPLOY.md` | `docs/engineering/runbooks/pm2-production-first-setup.md` |
| `docs/session-handoff/2025-05-23-unified-visit-migration.md` | `docs/archive/handoffs/2025-05-23-unified-visit-migration.md` |
| `docs/session-handoff/2026-05-23-session-handoff.md` | `docs/archive/handoffs/2026-05-23-session-handoff.md` |
| `docs/session-summaries/2026-05-20-devices-contracts.md` | `docs/archive/sessions/2026-05-20-devices-contracts.md` |
| `docs/session-summaries/2026-05-21-devices-contracts-legal-identity.md` | `docs/archive/sessions/2026-05-21-devices-contracts-legal-identity.md` |
| `docs/swagger-completion.md` | `docs/archive/plans/swagger-completion.md` |
| `docs/tasks/TASK_154_CONTACT_TARGET_ZONE_UNIQUE_PROMPT.md` | `docs/archive/prompts/TASK_154_CONTACT_TARGET_ZONE_UNIQUE_PROMPT.md` |
| `docs/tasks/TASK_155_VISIT_TASKS_CONTRACT_ID_PROMPT.md` | `docs/archive/prompts/TASK_155_VISIT_TASKS_CONTRACT_ID_PROMPT.md` |
| `docs/tasks/TASK_156_PURCHASE_HISTORY_FIX_PROMPT.md` | `docs/archive/prompts/TASK_156_PURCHASE_HISTORY_FIX_PROMPT.md` |
| `docs/tasks/TASK_156_PURCHASE_HISTORY_MASTER_PROMPT.md` | `docs/archive/prompts/TASK_156_PURCHASE_HISTORY_MASTER_PROMPT.md` |
| `docs/tasks/TASK_156_PURCHASE_HISTORY_PRICE_FIX_PROMPT.md` | `docs/archive/prompts/TASK_156_PURCHASE_HISTORY_PRICE_FIX_PROMPT.md` |
| `docs/tasks/TASK_156_PURCHASE_HISTORY_PROMPT.md` | `docs/archive/prompts/TASK_156_PURCHASE_HISTORY_PROMPT.md` |
| `docs/tasks/TASK_156_PURCHASE_HISTORY_UI_FIX_PROMPT.md` | `docs/archive/prompts/TASK_156_PURCHASE_HISTORY_UI_FIX_PROMPT.md` |
| `docs/tasks/TASK_156_PURCHASE_HISTORY_V2_PROMPT.md` | `docs/archive/prompts/TASK_156_PURCHASE_HISTORY_V2_PROMPT.md` |
| `docs/tasks/TASK_157_CONTRACT_LINE_ITEMS_ENHANCEMENT_PROMPT.md` | `docs/archive/prompts/TASK_157_CONTRACT_LINE_ITEMS_ENHANCEMENT_PROMPT.md` |
| `docs/tasks/TASK_158_FIX_CONTACT_TARGET_FORWARD_REF_PROMPT.md` | `docs/archive/prompts/TASK_158_FIX_CONTACT_TARGET_FORWARD_REF_PROMPT.md` |
| `docs/tasks/TASK_158_PURCHASE_HISTORY_UNIFIED_PROMPT.md` | `docs/archive/prompts/TASK_158_PURCHASE_HISTORY_UNIFIED_PROMPT.md` |
| `docs/tasks/TASK_159_FIX_COMPANY_OWNED_CONTRACT_ZONES_PROMPT.md` | `docs/archive/prompts/TASK_159_FIX_COMPANY_OWNED_CONTRACT_ZONES_PROMPT.md` |
| `docs/tasks/TASK_160_FIX_DATE_TYPE_MISMATCH_PROMPT.md` | `docs/archive/prompts/TASK_160_FIX_DATE_TYPE_MISMATCH_PROMPT.md` |
| `docs/tasks/TASK_161_FIX_TEXT_DATE_INFERENCE_PROMPT.md` | `docs/archive/prompts/TASK_161_FIX_TEXT_DATE_INFERENCE_PROMPT.md` |
| `docs/tasks/TASK_162_ADD_BOOKED_TO_CONTACT_TARGET_STATS_PROMPT.md` | `docs/archive/prompts/TASK_162_ADD_BOOKED_TO_CONTACT_TARGET_STATS_PROMPT.md` |
| `docs/tasks/TASK_163_FIX_STATION_NAME_CONTRACT_ZONE_PROMPT.md` | `docs/archive/prompts/TASK_163_FIX_STATION_NAME_CONTRACT_ZONE_PROMPT.md` |
| `docs/tasks/TASK_164_FIX_EFF_ZONE_STATUS_FILTER_PROMPT.md` | `docs/archive/prompts/TASK_164_FIX_EFF_ZONE_STATUS_FILTER_PROMPT.md` |
| `docs/tasks/TASK_165_FRONTEND_REBUILD_PROMPT.md` | `docs/archive/prompts/TASK_165_FRONTEND_REBUILD_PROMPT.md` |
| `docs/tasks/TASK_165_FRONTEND_REBUILD_REFERENCE.md` | `docs/archive/prompts/TASK_165_FRONTEND_REBUILD_REFERENCE.md` |
| `docs/tasks/TASK_165_SNAPSHOT_SYSTEM_PROMPT.md` | `docs/archive/prompts/TASK_165_SNAPSHOT_SYSTEM_PROMPT.md` |
| `docs/tasks/TASK_165_VISIT_DETAIL_UI_FIX_PROMPT.md` | `docs/archive/prompts/TASK_165_VISIT_DETAIL_UI_FIX_PROMPT.md` |
| `docs/tasks/TASK_166_FIELD_VISITS_TEAM_FILTER_PROMPT.md` | `docs/archive/prompts/TASK_166_FIELD_VISITS_TEAM_FILTER_PROMPT.md` |
| `docs/tasks/TASK_BLOCK_CLOSED_CONTACT_FROM_SYNC_PROMPT.md` | `docs/archive/prompts/TASK_BLOCK_CLOSED_CONTACT_FROM_SYNC_PROMPT.md` |
| `docs/tasks/TASK_BRANCHES_CONSTITUTION_PROMPT.md` | `docs/archive/prompts/TASK_BRANCHES_CONSTITUTION_PROMPT.md` |
| `docs/tasks/TASK_BUILD_FIX_PROMPT.md` | `docs/archive/prompts/TASK_BUILD_FIX_PROMPT.md` |
| `docs/tasks/TASK_CANDIDATES_CONSTITUTION_PROMPT.md` | `docs/archive/prompts/TASK_CANDIDATES_CONSTITUTION_PROMPT.md` |
| `docs/tasks/TASK_CLEAN_BACKEND_SQL_BEFORE_DROP_PROMPT.md` | `docs/archive/prompts/TASK_CLEAN_BACKEND_SQL_BEFORE_DROP_PROMPT.md` |
| `docs/tasks/TASK_CLEANUP_TEST_DATA_PROMPT.md` | `docs/archive/prompts/TASK_CLEANUP_TEST_DATA_PROMPT.md` |
| `docs/tasks/TASK_CLIENTS_CONSTITUTION_PROMPT.md` | `docs/archive/prompts/TASK_CLIENTS_CONSTITUTION_PROMPT.md` |
| `docs/tasks/TASK_CONTRACT_DETAIL_BACKEND_FIXES.md` | `docs/archive/prompts/TASK_CONTRACT_DETAIL_BACKEND_FIXES.md` |
| `docs/tasks/TASK_CONTRACT_DETAIL_PAGE_PROMPT_V2.md` | `docs/archive/prompts/TASK_CONTRACT_DETAIL_PAGE_PROMPT_V2.md` |
| `docs/tasks/TASK_CONTRACT_DETAIL_PAGE_PROMPT_V3.md` | `docs/archive/prompts/TASK_CONTRACT_DETAIL_PAGE_PROMPT_V3.md` |
| `docs/tasks/TASK_CONTRACT_DETAIL_PAGE_PROMPT.md` | `docs/archive/prompts/TASK_CONTRACT_DETAIL_PAGE_PROMPT.md` |
| `docs/tasks/TASK_CONTRACTS_CONSTITUTION_PROMPT.md` | `docs/archive/prompts/TASK_CONTRACTS_CONSTITUTION_PROMPT.md` |
| `docs/tasks/TASK_DELIVERY_DETAIL_PROMPT.md` | `docs/archive/prompts/TASK_DELIVERY_DETAIL_PROMPT.md` |
| `docs/tasks/TASK_DELIVERY_LIST_PROMPT.md` | `docs/archive/prompts/TASK_DELIVERY_LIST_PROMPT.md` |
| `docs/tasks/TASK_DEVICE_DELIVERY_FINAL_PROMPT.md` | `docs/archive/prompts/TASK_DEVICE_DELIVERY_FINAL_PROMPT.md` |
| `docs/tasks/TASK_DEVICE_DELIVERY_PROMPT.md` | `docs/archive/prompts/TASK_DEVICE_DELIVERY_PROMPT.md` |
| `docs/tasks/TASK_DEVICE_INSTALLATION_PROMPT.md` | `docs/archive/prompts/TASK_DEVICE_INSTALLATION_PROMPT.md` |
| `docs/tasks/TASK_DEVICES_MAINTENANCE_CONSTITUTION_PROMPT.md` | `docs/archive/prompts/TASK_DEVICES_MAINTENANCE_CONSTITUTION_PROMPT.md` |
| `docs/tasks/TASK_EMPLOYEES_CONSTITUTION_PROMPT.md` | `docs/archive/prompts/TASK_EMPLOYEES_CONSTITUTION_PROMPT.md` |
| `docs/tasks/TASK_FIELD_VISITS_CONSTITUTION_PROMPT.md` | `docs/archive/prompts/TASK_FIELD_VISITS_CONSTITUTION_PROMPT.md` |
| `docs/tasks/TASK_FIELD_VISITS_LIST_PROMPT.md` | `docs/archive/prompts/TASK_FIELD_VISITS_LIST_PROMPT.md` |
| `docs/tasks/TASK_FINALIZE_CONTRACT_FORM_AND_DELETE_LEGACY_PROMPT.md` | `docs/archive/prompts/TASK_FINALIZE_CONTRACT_FORM_AND_DELETE_LEGACY_PROMPT.md` |
| `docs/tasks/TASK_FIX_CONTACT_TARGET_DAILY_PROMPT.md` | `docs/archive/prompts/TASK_FIX_CONTACT_TARGET_DAILY_PROMPT.md` |
| `docs/tasks/TASK_FIX_DATE_TYPE_MISMATCH_PROMPT.md` | `docs/archive/prompts/TASK_FIX_DATE_TYPE_MISMATCH_PROMPT.md` |
| `docs/tasks/TASK_FIX_SOLO_TEAM_VALIDATION_PROMPT.md` | `docs/archive/prompts/TASK_FIX_SOLO_TEAM_VALIDATION_PROMPT.md` |
| `docs/tasks/TASK_FIX_TEAM_PROPAGATION_FINAL_PROMPT.md` | `docs/archive/prompts/TASK_FIX_TEAM_PROPAGATION_FINAL_PROMPT.md` |
| `docs/tasks/TASK_FIX_TEAM_REPLACEMENT_PROPAGATION_PROMPT.md` | `docs/archive/prompts/TASK_FIX_TEAM_REPLACEMENT_PROPAGATION_PROMPT.md` |
| `docs/tasks/TASK_GEO_UNITS_CONSTITUTION_PROMPT.md` | `docs/archive/prompts/TASK_GEO_UNITS_CONSTITUTION_PROMPT.md` |
| `docs/tasks/TASK_IMPROVE_CLIENT_PROFILE_NETWORK_TAB.md` | `docs/archive/prompts/TASK_IMPROVE_CLIENT_PROFILE_NETWORK_TAB.md` |
| `docs/tasks/TASK_NAME_COLLECTIONS_REFERRAL_SHEETS_PROMPT.md` | `docs/archive/prompts/TASK_NAME_COLLECTIONS_REFERRAL_SHEETS_PROMPT.md` |
| `docs/tasks/TASK_NAME_COLLECTIONS_REFERRAL_SHEETS.md` | `docs/archive/prompts/TASK_NAME_COLLECTIONS_REFERRAL_SHEETS.md` |
| `docs/tasks/TASK_OPEN_TASKS_CONSTITUTION_PROMPT.md` | `docs/archive/prompts/TASK_OPEN_TASKS_CONSTITUTION_PROMPT.md` |
| `docs/tasks/TASK_PERMISSIONS_ROLES_CONSTITUTION_PROMPT.md` | `docs/archive/prompts/TASK_PERMISSIONS_ROLES_CONSTITUTION_PROMPT.md` |
| `docs/tasks/TASK_PHASE1_FIELD_VISIT_REASSIGN_PROMPT.md` | `docs/archive/prompts/TASK_PHASE1_FIELD_VISIT_REASSIGN_PROMPT.md` |
| `docs/tasks/TASK_PHASE2_VISIT_UNIFICATION_PROMPT.md` | `docs/archive/prompts/TASK_PHASE2_VISIT_UNIFICATION_PROMPT.md` |
| `docs/tasks/TASK_PHASE3_UNIFY_RESULTS_PROMPT.md` | `docs/archive/prompts/TASK_PHASE3_UNIFY_RESULTS_PROMPT.md` |
| `docs/tasks/TASK_REMOVE_POSTSALE_BYPASS_PROMPT.md` | `docs/archive/prompts/TASK_REMOVE_POSTSALE_BYPASS_PROMPT.md` |
| `docs/tasks/TASK_TELEMARKETING_409_FIX_PROMPT.md` | `docs/archive/prompts/TASK_TELEMARKETING_409_FIX_PROMPT.md` |
| `docs/tasks/TASK_TELEMARKETING_CONSTITUTION_PROMPT.md` | `docs/archive/prompts/TASK_TELEMARKETING_CONSTITUTION_PROMPT.md` |
| `docs/tasks/TASK_UNIFIED_DELIVERY_RESULT_UI_PROMPT.md` | `docs/archive/prompts/TASK_UNIFIED_DELIVERY_RESULT_UI_PROMPT.md` |
| `docs/tasks/TASK_UNIFIED_VISIT_MIGRATION_PHASES_6_10_PROMPT.md` | `docs/archive/prompts/TASK_UNIFIED_VISIT_MIGRATION_PHASES_6_10_PROMPT.md` |
| `docs/tasks/TASK_UNIFIED_VISIT_MIGRATION_PHASES_6_7_8_PROMPT.md` | `docs/archive/prompts/TASK_UNIFIED_VISIT_MIGRATION_PHASES_6_7_8_PROMPT.md` |
| `docs/tasks/TASK_UNIFIED_VISIT_MIGRATION_PHASES_9_10_VERIFY_PROMPT.md` | `docs/archive/prompts/TASK_UNIFIED_VISIT_MIGRATION_PHASES_9_10_VERIFY_PROMPT.md` |
| `docs/tasks/TASK_UNIFIED_VISIT_MIGRATION_PROMPT.md` | `docs/archive/prompts/TASK_UNIFIED_VISIT_MIGRATION_PROMPT.md` |
| `docs/tasks/TASK_UNIFY_MINI_CLIENT_SNAPSHOT_PROMPT.md` | `docs/archive/prompts/TASK_UNIFY_MINI_CLIENT_SNAPSHOT_PROMPT.md` |
| `docs/tasks/TASK_UNIFY_MINI_CLIENT_SNAPSHOT.md` | `docs/archive/prompts/TASK_UNIFY_MINI_CLIENT_SNAPSHOT.md` |
| `docs/tasks/TASK_UNIFY_REFERRERS_SINGLE_SOURCE.md` | `docs/archive/prompts/TASK_UNIFY_REFERRERS_SINGLE_SOURCE.md` |
| `docs/tasks/TASK_WARRANTY_PERIOD_SELECTION.md` | `docs/archive/prompts/TASK_WARRANTY_PERIOD_SELECTION.md` |
| `docs/tasks/TASK_ZONE_ID_TASK_AWARE_PROMPT.md` | `docs/archive/prompts/TASK_ZONE_ID_TASK_AWARE_PROMPT.md` |
| `docs/visit-lifecycle-contract.md` | `docs/archive/superseded/visit-lifecycle-contract.md` |
| `docs/visit-lifecycle-fix-plan.md` | `docs/archive/superseded/visit-lifecycle-fix-plan.md` |
| `docs/visit-lifecycle-flow.excalidraw` | `docs/archive/superseded/visit-lifecycle-flow.excalidraw` |
