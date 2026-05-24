# Session Handoff — 2026-05-23

## Active Branch
staging (/opt/golden-crm/apps/staging)

## Server Status
- golden-crm-staging: online (PM2), last restart ~21:29 UTC
- Logs: /var/log/golden-crm/staging/staging-error.log

---

## Completed Fixes (Applied on Staging)

### 1. TASK_158 — Fix Forward Reference (contact_target JOIN order)
- **File:** `packages/api/services/planningMarketingTargets.ts`
- **Issue:** `missing FROM-clause entry for table "ot"` when calculating marketing targets for contract-basis tasks.
- **Fix:** Moved `contact_target` LEFT JOIN to AFTER `ct_zone` LATERAL join.
- **Status:** Applied by Codex. ✅ Verified working — counts now calculate.

### 2. TASK_160 + TASK_161 — Date Type Mismatch (`text = date`)
- **File:** `packages/api/services/planningMarketingTargets.ts` (getAssignedLeadsForTeam)
- **Issue:** `$2` (text) compared with `date` columns without cast.
- **Fixes applied:**
  - `ct.date = $2` → `ct.date = $2::date`
  - `ot.assigned_for_date = $2` → `ot.assigned_for_date = $2::date`
  - `ct_excl.date::text = $2` → `ct_excl.date = $2::date`
- **Status:** Applied by Codex. ✅

### 3. TASK_163 — Fix Station Name for Contract Zones
- **File:** `packages/api/routes/planning.ts` (/assigned-tasks endpoint)
- **Issue:** Station column showed "الحميدية" (client neighborhood, zone 47) instead of "حي المساكن" (contract installation zone, zone 267) for `device_delivery`.
- **What Codex applied:** Added `eff_zone` LATERAL subquery to resolve effective zone based on `location_basis`.
- **Remaining issue (NOT YET FIXED):** `eff_zone` still filters `ot_eff.status = 'assigned'`, but the actual task is now `scheduled`. This causes `eff_zone` to return NULL → falls back to `gu.name` (الحميدية).

---

## Pending Fixes (Prompts Written, NOT YET Applied)

### TASK_159 — Fix getCompanyOwnedClients for Contract Zones
- **File:** `packages/api/services/customerOwnership.ts`
- **Issue:** `getCompanyOwnedClients()` only checks `clients.neighborhood`, not `contracts.installation_geo_unit_id`. So contract-basis tasks in zones ≠ client neighborhood never get synced/assigned.
- **Fix:** Add OR condition to include clients with contracts whose `installation_geo_unit_id` is in the zone list.
- **Prompt file:** `docs/tasks/TASK_159_FIX_COMPANY_OWNED_CONTRACT_ZONES_PROMPT.md`
- **Status:** ⏳ PENDING — send to Codex/Claude

### TASK_157 — Contract Line Items Enhancement
- **File:** `packages/web/src/pages/ClientProfile.tsx`
- **Scope:** Remove checkboxes, add summary cards, split list into installed vs pending, show price/installation date/source/old_part_removed.
- **Prompt file:** `docs/tasks/TASK_157_CONTRACT_LINE_ITEMS_ENHANCEMENT_PROMPT.md`
- **Status:** ⏳ PENDING — send to Codex/Claude

### TASK_162 — Add "Booked" Tab to Contact Target Stats
- **File:** `packages/web/src/pages/planning/PlanningContactTargets.tsx`
- **Issue:** Stats strip missing `booked` count. Tasks with status `scheduled` disappear from the strip.
- **Fix:** Add `{ key: 'booked', count: summary?.booked ?? 0 }` to `tabs` array (~line 375).
- **Prompt file:** `docs/tasks/TASK_162_ADD_BOOKED_TO_CONTACT_TARGET_STATS_PROMPT.md`
- **Status:** ⏳ PENDING — send to Codex/Claude

### TASK_164 — Fix eff_zone Status Filter
- **File:** `packages/api/routes/planning.ts`
- **Issue:** `eff_zone` LATERAL has `AND ot_eff.status = 'assigned'`, but the task is `scheduled`. This makes `eff_zone` return NULL → station falls back to neighborhood.
- **Fix:** Remove `AND ot_eff.status = 'assigned'` from `eff_zone` LATERAL. `assigned_team_key` + `assigned_for_date` are sufficient.
- **Prompt file:** `docs/tasks/TASK_164_FIX_EFF_ZONE_STATUS_FILTER_PROMPT.md`
- **Status:** ⏳ PENDING — send to Codex/Claude (JUST WRITTEN)

---

## Current DB State (Relevant Records)

### open_tasks
| id | task_type | status | assigned_team_key | assigned_for_date | client_id |
|----|-----------|--------|-------------------|-------------------|-----------|
| 1 | device_delivery | **scheduled** | team_0 | 2026-05-23 | 21 |

### clients
| id | name | neighborhood |
|----|------|--------------|
| 21 | samar domar almahmoud | 47 |

### contracts
| customer_id | installation_geo_unit_id |
|-------------|--------------------------|
| 21 | 267 |

### geo_units
| id | name |
|----|------|
| 47 | الحميدية |
| 267 | حي المساكن |

### contact_targets
| id | target_id | date | zone_id | status | latest_call_outcome |
|----|-----------|------|---------|--------|---------------------|
| 1 | 21 | 2026-05-23 | 267 | **closed** | booked_marketing_appointment |

---

## Key Architectural Facts

- `location_basis = 'contract'` tasks (`device_delivery`, `device_installation`, `device_activation`) use `contracts.installation_geo_unit_id` as their effective zone.
- `location_basis = 'client'` tasks (`device_demo`) use `clients.neighborhood`.
- `contact_targets` UNIQUE: `(branch_id, target_type, target_id, visit_type, source_type, date, zone_id)`
- Same client + same day + different zones = separate contact targets.
- `getCompanyOwnedClients` currently ONLY checks `clients.neighborhood` — this breaks contract-basis tasks whose installation zone differs from client neighborhood.

---

## Files Modified in This Session (by Codex/Claude)

- `packages/api/services/planningMarketingTargets.ts`
- `packages/api/routes/planning.ts`
- `packages/api/services/customerOwnership.ts` (pending TASK_159)
- `packages/web/src/pages/ClientProfile.tsx` (pending TASK_157)
- `packages/web/src/pages/planning/PlanningContactTargets.tsx` (pending TASK_162)

---

## Next Session Priority Order (Suggested)

1. **TASK_164** (1-line fix) — fix station name display
2. **TASK_159** — fix company-owned clients for contract zones (blocks sync)
3. **TASK_162** — add booked tab to stats strip
4. **TASK_157** — contract line items UI enhancement
