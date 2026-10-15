# Device Demo Result Gaps (F1..F8) — 2026 Re-verification

Source plan: `docs/plans/2026-05-21-device-demo-result-gaps-plan.md`
Canonical spec today: `docs/constitution/features/tasks/device-demo.md`
Architecture drivers: `docs/constitution/decisions/DEC-003-visit-task-unification.md`, `DEC-004-visit-task-lifecycle-refinement.md`
Related existing tracker item found: `docs/constitution/GAPS-TRACKER.md` **GAP-089** ("إنشاء العقد من الزيارة وربط العرض الاختياري", قيد التنفيذ) already covers the F2/F7 territory.

## Summary table

| Gap | Verdict | One-line evidence |
|---|---|---|
| F1 — side table missing columns | **obsolete** | The "Strangler Bridge" (`marketing_visit_tasks`) it worried about is gone; `visit_task_device_demo_results` was redesigned (migration 235 + baseline `001_initial_schema.sql` L4045-4063) with `contract_id`, `offered_device_model_id`, `reason_code_id`, `closing_notes`, `is_device_sold`, `sale_reference_number` — functionally equivalent coverage under new names. |
| F2 — no auto contract on sale | **resolved** | `contractCreationContextService.ts` + "إنشاء عقد للزبون" button in `VisitDetailPage.tsx:752-761`, exactly the plan's proposed T7 fix (link + prefill, not full automation); tracked/extended further under GAP-089. |
| F3 — `device_sold` gives no `legacyResult` | **obsolete** | `marketing_visit_tasks.result`/`legacyResult` no longer exist anywhere in the codebase; replaced by `visit_task_results.final_decision` + `visit_task_device_demo_results.is_device_sold`. |
| F4 — `rescheduled` marks open_task `completed` | **resolved** | `applyDeviceDemoResult()` (`visitTaskResultReflection.ts:1449-1459, 1729-1743`) sets `open_tasks.status='needs_follow_up'` (not `completed`) on `rescheduled`, per DEC-004 D10/D22; no reporting code found that reads `visit_tasks.status` as a device-demo success proxy. |
| F5 — frontend sends `needs_reschedule`, API wants `rescheduled` | **resolved** | `MarketingVisitOutcomeModal.tsx` normalizes the internal UI value `needs_reschedule` → `'rescheduled'` before calling `onSubmit` (lines 341, 855); backend's `VALID` set only ever sees `'rescheduled'` (`visitTaskResultReflection.ts:1395,1449`). |
| F6 — hardcoded rejection reasons | **resolved** | Migration `346_device_demo_result_reason_lists.sql` seeds `device_demo_{reschedule,cancellation,offer_refusal}_reasons` in `system_lists`; `MarketingVisitOutcomeModal.tsx:497-500` fetches all 3 (+ `no_closing_reasons`) via `api.systemLists.getItemsByCode`; no `REJECTION_REASON_OPTIONS` constant remains. |
| F7 — one permission covers record+close+team+status | **resolved** | Migration `289_tasks_unified_result_permission_and_legacy_cleanup.sql` introduced `tasks.results.record`, seeded from prior `field_visits.edit` grants; `fieldVisits.ts:3190` guards result-recording with `tasks.results.record` while start/end/cancel/complete/close (`fieldVisits.ts:442,618,740,2252,2302`) use the separate `field_visits.edit`, and reopen uses `field_visits.reopen_closed` (`:3137`) — an org can now grant result-recording without closing rights. |
| F8 — deprecated `applyTaskResult` endpoint still live | **resolved** | `packages/api/routes/marketingVisits.ts` is deleted; `grep -rn "applyTaskResult"` across `packages/api` returns nothing; the only route left is the unified `POST /:visitId/tasks/:taskId/result` (`fieldVisits.ts:3190`) dispatching to per-task-type appliers (`VISIT_TASK_RESULT_APPLIERS`). |

**Still-real count: 0 / 8.** No new GAPS-TRACKER entries were needed.

---

## Per-gap evidence

### F1 — `visit_task_device_demo_results` missing columns (originally 🔴 critical)
Original worry: the migration-070/088/089 side table didn't capture `contract_id`, `currency`, `sold_device_model_id`, `offered_device_model_id`, `no_closing_reason`, `outcome`, `cancellation_reason_id`, `reschedule_reason_id` that `marketing_visit_tasks` had, so the "Strangler Bridge" would lose data on cutover.

Current reality:
- `marketing_visit_tasks` / the bridge concept doesn't exist any more (DEC-003 unified visits into `field_visits`/`visit_tasks`; `packages/api/routes/marketingVisits.ts` deleted).
- `visit_task_device_demo_results` (baseline schema `migrations/001_initial_schema.sql:4045-4063`, extended by `migrations/235_device_demo_result_model.sql`) now has: `id, visit_task_result_id, offer_type, offer_amount, installment_months, closed_by_employee_id, contract_id, discount_percentage, sale_reference_number, is_device_sold, offered_device_model_id, reason_code_id, closing_notes`.
- Mapping vs. old ask: `contract_id` ✅ present (column exists, currently always written as `NULL` in `applyDeviceDemoResult` — see below); `sold_device_model_id` merged into `offered_device_model_id` (code writes the sold device's id there when `is_device_sold`); `outcome` → separate `visit_task_results.final_decision` (by design, D5: "نتيجة واحدة فقط لكل visit_task", so `final_decision` lives on the parent result row, not duplicated on the side table); `no_closing_reason` → moved to per-offer granularity on `customer_device_pre_offers`/`open_task_pre_offers` (appropriate since one result can carry multiple offers); `cancellation_reason_id`/`reschedule_reason_id` → merged into one contextual `reason_code_id` (interpretation depends on `final_decision`, validated against different `system_lists` categories per case — `visitTaskResultReflection.ts:1452-1467`).
- `currency` is not a column on this header table, but is captured per-offer (`customer_device_pre_offers.currency`, confirmed in `DeviceDemoResultModal.tsx:166,198`). The only path that would lack a currency at all is the legacy "direct `device_sold` without offers" branch in `applyDeviceDemoResult` (`visitTaskResultReflection.ts:1436-1448`) — but this path is **dead code**: the current wizard's top-level `OUTCOME_OPTIONS` (`MarketingVisitOutcomeModal.tsx` ~L127-152) only offers `offer_presented` / `needs_reschedule` / `cancelled`; there is no user-reachable way to set `overallOutcome` to `'device_sold'` any more (matches device-demo.md's 2026-06-02 decision: "لا توجد نتيجة مباشرة باسم device_sold في الـ wizard").
- `contract_id` on this table is never written by `applyDeviceDemoResult` (always inserted `NULL`, line ~1508-1513) and nothing else in the codebase updates it (`grep "visit_task_device_demo_results"` in `contracts.ts` = no hits). The forward link is simply not used; instead the *reverse* link is authoritative: `contracts.source_open_task_id` / `source_task_offer_id` / `source_visit_id` (`contracts.ts:85-86`, `1283`). This is schema debt (an unused column) but not a data-loss bug, since the linkage is fully recoverable the other way.

**Verdict: obsolete.** The literal gap (bridge losing fields) can't recur because the bridge is gone; the redesigned schema captures what the current spec needs under different names/tables. Only cosmetic residue: an always-NULL `contract_id` column, and a fully dead `device_sold`-without-offers code path in both the service and the wizard.

---

### F2 — no auto contract creation on sale (originally 🔴 critical)
Original ask (deliberately **not** full automation): either a direct link from the task result to a prefilled contract-creation page, or a supervisor alert.

Current reality:
- `packages/api/routes/contracts.ts:727` — `GET /contracts/creation-context/visit/:visitId` (`requirePermission('contracts.create')`) → `loadContractCreationContext()` in `packages/api/services/contractCreationContextService.ts`.
- That service requires exactly one `device_demo` visit_task on the visit and `final_decision === 'offer_presented'` (rejects with `DEVICE_DEMO_RESULT_NOT_ELIGIBLE` otherwise, L124-131), then returns `acceptedOfferCount`/`eligibleOffers` plus the sale-owner (assigned supervisor).
- Frontend: `packages/web/src/pages/visits/VisitDetailPage.tsx:257-262` loads this context (gated by `hasPermission('contracts.create')`), and lines 752-761 render an **"إنشاء عقد للزبون"** button that only appears for the matching device-demo task, navigating to `/contracts/new?visitId=...`.
- Since the direct `device_sold`-without-offers path is dead (see F1), 100% of reachable sales go through `offer_presented` + an accepted offer, so this gate is not missing any live case.
- Confirmed already tracked as **GAP-089** in `docs/constitution/GAPS-TRACKER.md:979-988` ("إنشاء العقد من الزيارة وربط العرض الاختياري"), status "قيد التنفيذ — الخطوات 1-5 منجزة" (context read, POST guard, source pinning, DB constraints, visit button all done; remaining scope is a narrower "general referential check for an offer submitted with no visit context" — unrelated to F2's original ask).

**Verdict: resolved** (via the plan's own suggested lighter-weight approach, and further tracked/refined under GAP-089).

---

### F3 — `device_sold` never sets `legacyResult` (originally 🔴 critical in practice)
Original worry: `marketing_visit_tasks.result` stayed `NULL` for direct sales because `applyTaskOutcome()`'s legacy-result mapping had no branch for `device_sold`.

Current reality: `grep -rn "legacyResult" packages/api` → **no results**. The `marketing_visit_tasks` table/field and the entire `applyTaskOutcome()` function are gone. The current source of truth for "was this sold" is `visit_task_device_demo_results.is_device_sold` (a boolean, set unconditionally whenever `decision === 'device_sold'` OR any offer has `customer_response='accepted'` — `visitTaskResultReflection.ts:1488-1489`), plus `visit_task_results.final_decision`. There is no `result` column left to be `NULL`.

**Verdict: obsolete.** The field/mechanism the gap was about doesn't exist in the current model; its job is done by `is_device_sold` + `final_decision`, both always populated.

---

### F4 — `rescheduled` marks the original task `completed` (originally 🟡 important)
Original worry: `applyTaskOutcome()`'s `newOpenTaskStatus = outcome === 'cancelled' ? 'cancelled' : 'completed'` meant **the `open_task`** got marked `completed` even on `rescheduled`, corrupting success-rate reporting.

Current reality (`packages/api/services/visitTaskResultReflection.ts`):
- Decision-specific branch for `rescheduled` (L1449-1459) sets `openTaskNewStatus = 'needs_follow_up'` and stores `openTaskExpectedDate = body.expected_date`.
- Step 7 "Reflect onto open_task" (L1716-1755): when `openTaskNewStatus === 'needs_follow_up'`, it does `UPDATE open_tasks SET last_waiting_status = ..., status = 'needs_follow_up', expected_date = ..., expected_time = ...` — **not** `completed`. Only the genuine `offer_presented`(closed)/`device_sold` paths reach the `'completed'` branch.
- This matches DEC-004 D10 ("`open_task` يرجع لـ last_waiting_status") and D22 (Schedule-from-Expected) exactly.
- What *does* still get set to `'completed'` on `rescheduled` is `visit_tasks.status` (the single-attempt record, L1714: `newVtStatus = decision === 'cancelled' ? 'cancelled' : 'completed'`) — but per DEC-003 D6, `visit_tasks` are one-per-attempt and disposable; `'completed'` there means "this attempt's outcome has been recorded," not "the customer's device-demo story is done." The real success/outcome field for reporting is `visit_task_results.final_decision`, which correctly reads `'rescheduled'`.
- No reporting/dashboard code was found (`packages/api/services/reporting/*`) that reads `visit_tasks.status` as a device-demo success proxy — the constitution's own reporting layer notes (funnel/donuts for device_demo) are explicitly "not yet built," so the distortion the gap warned about has no live surface today.

**Verdict: resolved.** The specific field the gap was about (`open_task.status`) is fixed; the still-`completed` `visit_task.status` is an intentional, differently-named concept (attempt lifecycle, not outcome), and nothing currently reads it as a success signal.

---

### F5 — Frontend sends `needs_reschedule`, API only accepts `rescheduled` (originally 🟡 important)
Investigation asked: is `needs_reschedule` today a legitimate DEC-004 outcome (like `needs_follow_up`), or dead code from the abolished visit-level reschedule?

Findings:
- `needs_reschedule` is **not** a DEC-004-legit value anywhere in the data model. DEC-004 D18 explicitly *abolished* `field_visits.status ∈ {postponed_by_company, postponed_by_customer, needs_reschedule}` — visits only cancel, never reschedule; "rescheduling" moved to the **task** level as `open_task.status = 'needs_follow_up'` + `expected_date`/`expected_time` (D10, D22), and as `visit_task_results.final_decision = 'rescheduled'` for `device_demo` specifically (`docs/constitution/features/tasks/device-demo.md` §9-②).
- In `MarketingVisitOutcomeModal.tsx`, `needs_reschedule` survives only as an **internal UI radio-option value** (`OUTCOME_OPTIONS`, L127-152) and wizard state key. Before calling the parent's `onSubmit`, it is always normalized: `outcome: wizardState.overallOutcome === 'needs_reschedule' ? 'rescheduled' : wizardState.overallOutcome` (L855, also L341). So the value that actually crosses the wire is always `'rescheduled'`.
- `DeviceDemoResultModal.tsx:241-249` (`mapOutcomePayload`) and `visitTaskResultReflection.ts:1395,1449` (`VALID` set / `rescheduled` branch) agree on `'rescheduled'` — no mismatch reaches the API today.
- Separately (not part of the original F5, but directly relevant to "what does needs_reschedule mean today"): 4 **unrelated frontend files** — `packages/web/src/pages/visits/VisitDetailPage.tsx:38` (the live routed `/field-visits/:id` page!), `packages/web/src/pages/ClientProfile.tsx:1252`, `packages/web/src/pages/tasks/TaskGroupPage.tsx:209,220`, `packages/web/src/components/telemarketing/TeamAgendaPanel.tsx:27` — still carry a `needs_reschedule` (and `postponed_by_company`/`postponed_by_customer`) entry in their `field_visits.status` label/color maps, directly under a comment in `VisitDetailPage.tsx:26-27` that says *"DEC-004 D18: 7 canonical states + closed"*. Since the DB `CHECK` constraint on `field_visits.status` no longer permits these 3 values (per DEC-004 3.1), these map entries are unreachable dead code — cosmetic leftovers, not a functional bug (confirmed: `DeviceDemo.tsx:42-53`'s own `VISIT_STATUS_LABELS` correctly lists only the 7 live states, showing the newer files were already cleaned up).

**Verdict: resolved** for F5 as originally scoped (wizard→API value now matches, no rejected requests). Flagging the 4 dead-label-map files as a minor, separate, non-blocking cleanup note (not spun into a new GAP since it was not part of F1-F8 and has zero functional impact).

---

### F6 — hardcoded `REJECTION_REASON_OPTIONS` (originally 🟡 important)
- `migrations/346_device_demo_result_reason_lists.sql` seeds three `system_lists` categories: `device_demo_reschedule_reasons`, `device_demo_cancellation_reasons`, `device_demo_offer_refusal_reasons` (5-6 values each, idempotent `WHERE NOT EXISTS`).
- `visitTaskResultReflection.ts` validates against these categories server-side: `assertSystemListValue(..., 'device_demo_offer_refusal_reasons', ...)` (L1411-1417, per-offer rejection reason), `assertSystemListCategory(..., 'device_demo_reschedule_reasons', ...)` (L1452-1457), `assertSystemListCategory(..., 'device_demo_cancellation_reasons', ...)` (L1462-1467).
- `MarketingVisitOutcomeModal.tsx:497-500` fetches all of these (plus `no_closing_reasons`) via `api.systemLists.getItemsByCode(...)`. No `REJECTION_REASON_OPTIONS` constant remains in the file.
- Matches device-demo.md §10 exactly (reuse of `system_lists`, admin-manageable, no migration-seeded values beyond bootstrapping the categories once).

**Verdict: resolved.**

---

### F7 — one permission for record/close/team/status (originally 🟠 nice-to-have)
Investigation asked which permission keys guard device-demo result operations today.

- `packages/api/routes/fieldVisits.ts:3190` — `POST /:visitId/tasks/:taskId/result` → `requirePermission('tasks.results.record')`, double-checked in-handler via `authorize(authContext, { permission: 'tasks.results.record', branchId })` (L3208).
- `migrations/289_tasks_unified_result_permission_and_legacy_cleanup.sql` created `tasks.results.record` specifically, seeded from prior `field_visits.edit` grants — i.e., this *is* the historical fix for F7 (splitting result-recording out of the bundled visit-management permission).
- Visit lifecycle ops now use a **different** key entirely: `start` (L442), `end` (L618), `cancel` (L740), `complete` (L2252), `close` (L2302) all require `field_visits.edit`; `reopen` (L3137) requires its own `field_visits.reopen_closed` (per DEC-004 D11). There is no more single permission covering "record result" + "close" + "team" + "status" together — an org can grant `tasks.results.record` to a field technician without also granting `field_visits.edit` (close ability).
- Minor doc-drift noted (not a functional gap): `docs/constitution/features/tasks/device-demo.md` §14 still lists "تسجيل النتيجة → `field_visits.execute`" and "الإقفال → `field_visits.update_result`" — neither of these permission keys is what the code actually checks (`tasks.results.record` / `field_visits.edit`). Worth a docs correction pass, but out of scope for F1-F8's literal ask.

**Verdict: resolved** (and exceeds the plan's ask — not just "close" split off, but result-recording made its own independent permission axis).

---

### F8 — deprecated `applyTaskResult()` still reachable (originally 🟠 nice-to-have)
- `packages/api/routes/marketingVisits.ts` (the file that defined `applyTaskResult` and the `PATCH /:id/result` / `PATCH /:visitId/tasks/:taskId/result` routes) is deleted from the repo.
- `grep -rn "applyTaskResult\b" packages/api` → no matches anywhere.
- The only `PATCH .../result`-shaped route left in the whole API is `packages/api/routes/interviews.ts:372` (`jobs.interviews.record_result`) — an unrelated HR/recruiting domain, not device-demo.
- The current, single, unified device-demo/all-task-types result endpoint is `POST /field-visits/:visitId/tasks/:taskId/result` (`fieldVisits.ts:3190`), dispatching per `task_type` via a `VISIT_TASK_RESULT_APPLIERS` map (`visitTaskResultReflection.ts:40`: `device_demo: applyDeviceDemoResult`).

**Verdict: resolved** — fully removed rather than merely deprecated-with-warning as the plan's T8 suggested; no migration/rollout plan was needed since there's nothing left to migrate off of.

---

## Drafted GAPS-TRACKER entries

None. All 8 gaps resolved to `resolved` or `obsolete`; there are zero `still-real` items from this plan to add to `docs/constitution/GAPS-TRACKER.md`. (For reference, the tracker's still-open, closely-related item is **GAP-089** — "إنشاء العقد من الزيارة وربط العرض الاختياري" — already covering the F2/F7 contract-from-visit territory, with one small residual scope item of its own that is unrelated to F1-F8.)
