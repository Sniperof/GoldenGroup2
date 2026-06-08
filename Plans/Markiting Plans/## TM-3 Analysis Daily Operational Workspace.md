

\## TM-3 Analysis: Daily Operational Workspace



\---



\### 1. Goal Summary



Transform the current TelemarketerWorkspace from a static, single-day, team-scoped view into a usable daily operations tool. The telemarketer should be able to navigate dates, see meaningful status counts, filter their queue, and understand their contact target history without leaving the workspace.



Scope constraints confirmed:

\- No visits, no VisitTask, no Marketing Visit

\- No FOP/OP additions

\- No supervisor/team-scoped queries yet (deferred to TM-4)

\- No PlanOverview changes

\- TelemarketerWorkspace only



\---



\### 2. Current Workspace Inspection (Findings)



\*\*State and data loading:\*\*

```

const \[date] = useState(getToday())        // frozen — no setter exposed

const \[selectedTeamKey, setSelectedTeamKey] = useState<string | null>(null)

// snapshot() loads ALL data, no date filter

// getTaskList(teamKey, date) filters in-memory by teamKey+date

```



\*\*What's there:\*\*

\- `remainingCount` = items where status !== 'completed'

\- `completedCount` = items where status === 'completed'

\- Team selector, customer detail panel, team agenda sidebar

\- Search input field exists (`searchQuery` state) but no filter logic connected



\*\*What's missing:\*\*

\- Date navigation (prev/next day)

\- Status breakdown: contacted, booked, rejected, no\_answer counts

\- Status filter on queue (show only no\_answer, only new, etc.)

\- Contact target linkage visible in UI (contactTargetId is on item type but never rendered)

\- `snapshot()` accepts no date — all historical data loaded at once



\---



\### 3. Current Backend Support



| Capability | Current State |

|---|---|

| Snapshot (task lists + calls + appointments) | `GET /telemarketing/snapshot` — no date param |

| Schedule (teams for a date) | `GET /schedules?date=X` — date-aware |

| Task list item status | PATCH `/telemarketing/task-list-items/:id` — works |

| Call log creation | POST `/telemarketing/call-logs` — works, updates lifecycle |

| Appointment creation | POST `/telemarketing/appointments` — works, updates lifecycle |

| Contact target lookup by item | Internal helper only, not exposed as endpoint |

| Status counts by date/team | Not available — must compute client-side |



\---



\### 4. UX Requirements Proposal



\*\*Must have (TM-3):\*\*

1\. Date navigation — prev/next day buttons, current date displayed

2\. Status cards — at least 4 counts: Remaining, Contacted, Booked, Rejected

3\. Status filter — filter task queue by item status (all / new / no\_answer / contacted / booked / rejected)

4\. Search — wire up existing `searchQuery` to filter by customer name



\*\*Nice to have (defer to TM-4 or TM-5):\*\*

\- Date range view / weekly summary

\- Contact target history inline in customer detail

\- Supervisor cross-team view



\---



\### 5. Daily State Model



Each task list item has a `status` field. The current values in use:



| Status Value | Meaning |

|---|---|

| `pending` | Not yet called |

| `no\_answer` | Called, no answer |

| `busy` | Called, busy |

| `contacted` | Spoke, no appointment |

| `booked` | Appointment created |

| `rejected` | Customer rejected |

| `completed` | Done (generic) |



Count cards for TM-3:

\- \*\*Remaining\*\* = items where status is `pending` or `no\_answer` or `busy`

\- \*\*Contacted\*\* = status is `contacted`

\- \*\*Booked\*\* = status is `booked`

\- \*\*Rejected\*\* = status is `rejected`



These are all computable in-memory from the already-loaded task list items. No new backend call needed for counts.



\---



\### 6. User Roles and Scope



For TM-3, scope stays at: \*\*telemarketer sees their assigned team only\*\* (unchanged from current). The `selectedTeamKey` already filters to one team. No role-based visibility changes needed.



The workspace should still show only the currently active date's task list. The existing `getTaskList(teamKey, date)` in-memory filter is correct — it only needs `date` to be navigable.



\---



\### 7. Supervisor Calling Scenario



\*\*Not in TM-3 scope.\*\* A supervisor seeing other telemarketers' queues requires:

\- A `scope` parameter on snapshot

\- Team-level aggregation

\- Different permission check (`telemarketing.targets.view`)



This is TM-4 territory. TM-3 only improves the single-user operational view.



\---



\### 8. Backend Scope and Security Plan



\*\*TM-3 requires one backend change:\*\* add optional `date` filter to snapshot endpoint.



Current:

```

GET /telemarketing/snapshot

→ returns ALL task lists ever, ALL call logs, ALL appointments

```



Proposed:

```

GET /telemarketing/snapshot?date=2026-04-30

→ filters task lists WHERE DATE(created\_at) = $date (or a date column)

→ returns related call logs and appointments for those task lists only

```



This is an optimization — the current in-memory filter already works correctly for display, but loading all historical data is wasteful and will break at scale.



\*\*Security\*\*: No new permissions needed. The `telemarketing.lists.view` guard already covers snapshot. The `date` param is user-supplied — must validate format (YYYY-MM-DD) to prevent injection.



\---



\### 9. Date Navigation Plan



\*\*Frontend changes only if not adding date to API call:\*\*



```typescript

// Replace:

const \[date] = useState(getToday())

// With:

const \[date, setDate] = useState(getToday())



// Add navigation:

const goToPrevDay = () => setDate(d => addDays(d, -1))

const goToNextDay = () => setDate(d => addDays(d, +1))

const isToday = date === getToday()

```



\*\*When date changes:\*\*

\- `api.schedules.get(date)` is already called with `date` — this auto-updates teams

\- `loadData()` must be re-triggered with new date (or snapshot must accept date param)

\- `getTaskList(selectedTeamKey, date)` already filters in-memory — works correctly once loadData is date-aware



\*\*Risk\*\*: If snapshot loads all data upfront (current behavior), changing date just changes the in-memory filter — no new network call. This is the minimal-change path. The date-filtered snapshot is an optimization for TM-4.



\*\*Minimal path for TM-3\*\*: Expose `setDate`, add prev/next buttons, no API change. The in-memory filter in `getTaskList` already uses `date`.



\---



\### 10. Status Filtering and Counts



\*\*Counts (computed in-memory, no backend needed):\*\*

```typescript

const taskListItems = getTaskList(selectedTeamKey, date)?.items ?? \[]

const remaining = taskListItems.filter(i => \['pending','no\_answer','busy'].includes(i.status)).length

const contacted = taskListItems.filter(i => i.status === 'contacted').length

const booked = taskListItems.filter(i => i.status === 'booked').length

const rejected = taskListItems.filter(i => i.status === 'rejected').length

```



\*\*Status filter state:\*\*

```typescript

type StatusFilter = 'all' | 'pending' | 'no\_answer' | 'contacted' | 'booked' | 'rejected'

const \[statusFilter, setStatusFilter] = useState<StatusFilter>('all')

```



\*\*Wire up existing search:\*\*

```typescript

const visibleItems = taskListItems

&#x20; .filter(i => statusFilter === 'all' || i.status === statusFilter)

&#x20; .filter(i => !searchQuery || i.customerName.toLowerCase().includes(searchQuery.toLowerCase()))

```



\---



\### 11. Contact Target Integration in Workspace



\*\*TM-2 added `contactTargetId` to `TaskListItem` type and it's returned by the API.\*\* It's not rendered anywhere in TM-3 scope.



In TM-3, do not surface contact target history in the workspace UI. That's a future concern (TM-5). However, the `contactTargetId` being present means the customer detail panel could show a "has history" indicator (small badge) with near-zero effort. This is optional and should be confirmed with user before adding.



\---



\### 12. Required Backend Changes for TM-3



| Change | Required | Priority |

|---|---|---|

| Add `date` query param to `GET /snapshot` | Optional optimization | Low |

| Validate date param format | If above added | Medium |

| New endpoint for status counts | Not needed — computed client-side | N/A |

| Contact target history endpoint | Not in TM-3 | N/A |



\*\*Conclusion: TM-3 requires zero mandatory backend changes.\*\* The in-memory filter path works. The snapshot date filter is a recommended optimization but not blocking.



\---



\### 13. Required Frontend Changes for TM-3



| File | Change | Size |

|---|---|---|

| `TelemarketerWorkspace.tsx` | Add `setDate` to useState | 1 line |

| `TelemarketerWorkspace.tsx` | Reload schedule + data when date changes (useEffect dep) | \~5 lines |

| `TelemarketerWorkspace.tsx` | Date nav UI (prev/next buttons + date display) | \~15 lines |

| `TelemarketerWorkspace.tsx` | Compute 4 status counts | \~8 lines |

| `TelemarketerWorkspace.tsx` | Status count cards in header | \~20 lines |

| `TelemarketerWorkspace.tsx` | `statusFilter` state + filter logic | \~10 lines |

| `TelemarketerWorkspace.tsx` | Status filter buttons / tabs | \~15 lines |

| `TelemarketerWorkspace.tsx` | Wire up existing `searchQuery` filter | \~5 lines |

| `useTelemarketingStore.ts` | Accept optional `date` in `loadData()` | \~5 lines |

| `api.ts` | Pass `date` param to snapshot (optional optimization) | \~3 lines |



\*\*Total: \~87 lines across 3 files. No new components needed.\*\*



\---



\### 14. Task Breakdown



\*\*Task 1 — Date Navigation\*\*

\- Files: `TelemarketerWorkspace.tsx`, `useTelemarketingStore.ts`

\- Change `const \[date]` to `const \[date, setDate]`

\- Add `useEffect` that calls `loadData(date)` when date changes

\- Add prev/next buttons and date label to header

\- Wire `schedules.get(date)` to re-fetch when date changes (check if already in useEffect deps)

\- Acceptance: clicking prev/next changes teams list and task queue to that date's data



\*\*Task 2 — Status Count Cards\*\*

\- Files: `TelemarketerWorkspace.tsx`

\- Derive 4 counts from `activeTaskList.items`

\- Render 4 cards (Remaining / Contacted / Booked / Rejected) in header row below date nav

\- Acceptance: counts match actual item statuses; update immediately after logging a call



\*\*Task 3 — Status Filter\*\*

\- Files: `TelemarketerWorkspace.tsx`

\- Add `statusFilter` state

\- Add filter buttons (All / Pending / No Answer / Contacted / Booked / Rejected)

\- Apply filter to `visibleItems` derivation

\- Acceptance: selecting "Booked" shows only booked items; count cards don't change



\*\*Task 4 — Wire Up Search\*\*

\- Files: `TelemarketerWorkspace.tsx`

\- Apply `searchQuery` filter to `visibleItems` after status filter

\- Acceptance: typing customer name reduces visible items



\*\*Task 5 — Snapshot Date Optimization (Optional)\*\*

\- Files: `packages/api/routes/telemarketing.ts`, `api.ts`, `useTelemarketingStore.ts`

\- Add `date` query param to snapshot

\- Filter `telemarketing\_task\_lists` by date in SQL

\- Acceptance: network response only contains current-date data



\---



\### 15. Testing Plan



| Test | Method |

|---|---|

| Date nav — prev day shows prev day's team list | Manual: click prev, verify team count changes |

| Date nav — future date shows no teams | Manual: navigate to tomorrow |

| Status counts — accurate after call log | Manual: log a call, verify count card updates |

| Status filter — All shows all items | Manual |

| Status filter — Booked shows only booked | Manual: book an appointment, filter by Booked |

| Search — filters by customer name | Manual: type partial name |

| Search + filter — both applied | Manual: booked filter + search |

| Reload page — returns to today | Manual: verify `useState(getToday())` |

| No data for date — empty state shown | Manual: navigate to old date with no plan |



No automated tests needed for TM-3 (all UI state logic).



\---



\### 16. Risks and Open Questions



\*\*Risk 1 — `loadData` is called once on mount, not reactive to `date`\*\*

Currently `useTelemarketingStore`'s `loadData` is called in a `useEffect(\[])` (no deps). If snapshot has no date filter, this is fine (all data loaded once). If date filter is added to snapshot, `loadData` must be re-called on date change. This is straightforward but must be done carefully to avoid race conditions.



\*\*Risk 2 — `selectedTeamKey` becomes stale after date change\*\*

If the user is on Team A for Monday, navigates to Tuesday which has Team B but not Team A, `selectedTeamKey` still holds 'A' but `availableTeams` no longer contains it. The workspace may show empty/broken state. Fix: reset `selectedTeamKey` to `null` (or to first available team) when date changes.



\*\*Risk 3 — Status vocabulary mismatch\*\*

The backend uses `pending`, `contacted`, `booked`, etc. The UI should display Arabic labels but filter by exact backend values. Must confirm the full set of valid status strings (check `telemarketing\_task\_list\_items.status` column type in schema).



\*\*Open Question 1\*\*: Should status filter buttons show counts inline (e.g., "No Answer (3)")? Recommended yes — it's trivial to add and very useful. Confirm with user.



\*\*Open Question 2\*\*: Should clicking a status count card also apply that filter? Natural UX — clicking "Booked: 2" card filters to booked items. Easy to wire up.



\*\*Open Question 3\*\*: Does `schedules.get(date)` return the same data structure for all dates, or does it fail/return empty for dates with no schedule? The `useEffect` for teams needs a null-safety check.



\---



\### 17. Final Recommendation



\*\*Implement TM-3 in order: Task 1 → Task 2 → Task 4 → Task 3 → Task 5 (optional)\*\*



\- Task 1 (date nav) first because Tasks 2–4 all depend on the correct date being active

\- Task 2 (counts) before Task 3 (filters) because count cards can also act as filter triggers

\- Task 4 (search) is one-liner once date nav works — do it before Task 3

\- Task 3 (status filter) is the most involved UI piece — last among the required tasks

\- Task 5 (snapshot optimization) is optional for TM-3; defer unless performance is already visible



\*\*Risk 2 (stale team selection) must be fixed in Task 1 — it will cause a confusing bug if missed.\*\*



All TM-3 changes are contained in `TelemarketerWorkspace.tsx` and `useTelemarketingStore.ts`. No schema changes, no new endpoints, no new migrations. This is a pure frontend improvement on top of TM-2's data model.

