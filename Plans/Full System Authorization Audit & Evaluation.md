\## Full System Authorization Audit \& Evaluation



\---



\### 1. Executive Assessment



\*\*Verdict: Architecturally sound. Production-ready with three tracked caveats.\*\*



The refactor successfully replaced a permission patchwork with a unified, auditable model. The decision point is singular (`authorize()`), the contract is typed (`AuthContext`), and both Express and tRPC consume the same engine. No authorization logic lives outside `authorizationService.ts`. For a system of this scale, that's the right outcome.



The remaining risks are all known, contained, and explainable — not structural surprises.



\---



\### 2. Architecture Evaluation



\#### What's working correctly



\*\*Single decision point\*\* — `authorize()` in \[authorizationService.ts:88](packages/api/services/authorizationService.ts) is the only place that evaluates grants. Zero shadow authorization logic found in routes or middleware.



\*\*Unified context\*\* — `AuthContext` is built once per request via `getOrBuildAuthContext` (Express) or `buildAuthContext` (tRPC) and reused. No route reads raw `req.user.roleId` to make permission decisions.



\*\*Policy helper layer\*\* — Domain policy files (`clientPolicy.ts`, `candidatePolicy.ts`, `referralSheetPolicy.ts`) correctly wrap `authorize()` and pass resource attributes. Routes import these instead of calling `authorize()` directly.



\*\*Express/tRPC parity\*\* — Both stacks reach the same `buildAuthContext` + `authorize()` chain. The tRPC path correctly passes `authContext` downstream via `ctx`:



```typescript

// init.ts:59

return next({ ctx: { ...ctx, authContext } });

```



\*\*ASSIGNED invariant is correct\*\* — `authorizeAssignedGrant` enforces both ownership AND branch membership atomically. A user who owns a resource but has been transferred to another branch is correctly denied.



\---



\### 3. Scope Model Evaluation



| Scope | Enforced | Correct Behavior |

|-------|----------|-----------------|

| `GLOBAL` | ✅ | Returns `GRANTED\_GLOBAL` immediately — no filters |

| `BRANCH` | ✅ | Checks `targetBranchId ?? actingBranchId` ∈ `allowedBranchIds` |

| `ASSIGNED` | ✅ | Requires `assignedUserId === context.userId` AND branch check |



\*\*Scope gap\*\*: No module currently uses `GLOBAL` scope in practice. All production grants are `BRANCH` or `ASSIGNED`. The `GLOBAL` path is correct but untested by any live grant.



\*\*Null propagation\*\* (`authorizeBranchGrant:228`) — when both `targetBranchId` and `actingBranchId` are null, the result is `MISSING\_BRANCH\_CONTEXT` rather than a silent deny. This is the right safe-failure mode.



\---



\### 4. Module-by-Module Review



| Module | Gate Middleware | Handler Re-check | ASSIGNED | Policy Helpers | Status |

|--------|----------------|------------------|----------|----------------|--------|

| `employees` | `requirePermission` | `authorize()` inline | No | No | ✅ Correct |

| `candidates` | `requirePermission` | `canXxxCandidate()` | ✅ Yes | ✅ Yes | ✅ Correct |

| `referral\_sheets` | `requirePermission` | `canXxxReferralSheet()` | ✅ Yes | ✅ Yes | ✅ Correct |

| `clients` | `requirePermission` | `canXxxClient()` | No | ✅ Yes | ✅ Correct |



\*\*Employees\*\* — no policy helper file; `authorize()` called directly in routes. This works but is inconsistent with the other three modules. Not a correctness issue, but a maintainability one.



\---



\### 5. Data Model \& Schema Assessment



\*\*Canonical tables\*\* (read by the runtime):

\- `role\_permission\_grants` — grants with scope, queried by `loadRolePermissionGrants` ✅

\- `user\_branch\_assignments` — branch access, queried by `loadUserBranchAssignments` ✅



\*\*Legacy tables\*\* (still maintained in parallel, not queried by the runtime):

\- `role\_permissions` — written to by all migrations for backward compat ⚠️

\- `hr\_users.branch\_id` — still exists, still used as fallback ⚠️



The two-table sync (`role\_permissions` + `role\_permission\_grants`) is functionally safe but is a maintenance trap. Every future migration must update both. There is no DB constraint or trigger enforcing consistency. A migration that updates only one table will silently diverge.



\---



\### 6. Security Review



\#### Top 5 Risks



\*\*Risk 1 — In-memory cache won't invalidate across processes\*\* (High)



```typescript

// authorizationService.ts:25

const cache = new Map<number, LoadedAuthorizationData>();

```



`clearAuthorizationCache(userId)` clears only the current process's map. In a multi-process deployment (PM2 cluster, horizontal scale), a revoked role or removed branch assignment will still be served from other processes for up to 5 minutes. For a CRM handling sensitive customer data, this is a real risk if an employee is terminated.



\*\*Mitigation path\*\*: Redis-backed cache with pub/sub invalidation, or reduce TTL to 60s as an interim measure.



\---



\*\*Risk 2 — `PHASE2B\_LEGACY\_FALLBACK` bypasses canonical branch model\*\* (Medium)



```typescript

// authorizationService.ts:214-217

// PHASE2B\_LEGACY\_FALLBACK

return legacyBranchId;

```



Any user without a row in `user\_branch\_assignments` silently falls back to `hr\_users.branch\_id`. This means: (a) `allowedBranchIds` is empty for such users (no grants ever pass BRANCH checks), but (b) `actingBranchId` is set, creating an inconsistent state where the acting branch exists but no branches are "allowed". The net effect is that BRANCH-scope grants will be denied for these users because `allowedBranchIds.includes(effectiveBranchId)` returns false against an empty array.



\*\*This is actually safe-fail\*\* — the fallback causes denial, not escalation. But it means the system is silently broken for unmigrated users. The fallback should be removed only after confirming all `hr\_users` have corresponding `user\_branch\_assignments` rows.



\---



\*\*Risk 3 — `resolveTargetBranchId` has a dead legacy path\*\* (Medium)



```typescript

// permission.ts:180-194

if (req.user.branchId == null) { ... }

if (requestedBranchId !== req.user.branchId) { ... }

return requestedBranchId;

```



Lines 180–194 execute only when `req.authContext` is null. After `requirePermission` or `requireNotHQOnly` run, `authContext` is always set. So this block is unreachable in correctly-ordered route chains. However, if any route calls `resolveTargetBranchId` without a prior auth middleware (a future mistake), it silently falls back to `req.user.branchId` — a single-branch check that bypasses `user\_branch\_assignments` entirely. This is a latent authorization hole.



\*\*Mitigation\*\*: Replace the fallback with `throw new Error('resolveTargetBranchId called before auth middleware')`.



\---



\*\*Risk 4 — Gate check in `requirePermission` is branch-unaware\*\* (Low)



```typescript

// permission.ts:82-84

const hasAny = keys.some(key => authorize(authContext, { permission: key }).allowed);

```



The gate calls `authorize` without `branchId` or `assignedUserId`. For BRANCH-scope grants, `authorizeBranchGrant` uses `actingBranchId` as the fallback. If a user has no acting branch (e.g., no header, no primary assignment), the gate denies them even if the route handler would resolve the branch from the request body. This is safe but can cause confusing 403s that aren't branch-access violations — they're acting-branch resolution failures masked as permission denials.



\---



\*\*Risk 5 — `canViewCandidate` uses wrong permission key\*\* (Low, Semantic)



```typescript

// candidatePolicy.ts

return authorize(context, { permission: 'candidates.view\_list', branchId: ... assignedUserId: ... });

```



`canViewCandidate` — used for single-record access — checks `candidates.view\_list` instead of a dedicated `candidates.view`. This means `view\_list` permission grants both list AND single-record access. If a role ever needs list-deny but view-allow (or vice versa), this is not expressible without a breaking change. Clients has the right model: separate `clients.view\_list` and `clients.view` permissions.



\#### Security Strengths



\- `toPositiveInteger` sanitizes all branch IDs from headers/body — injection via malformed IDs is impossible

\- `authorize()` treats unknown scope values as deny (the `default` case in the switch)

\- `isSuperAdmin` is evaluated once inside `authorize()` — no scatter of `if (isSuperAdmin) return true` across routes

\- All mutations check the resource's actual `branchId` from the DB, not a caller-supplied value



\---



\### 7. Consistency \& Maintainability



\*\*Consistent\*\*: `requireAuth` + `requirePermission` + policy helper pattern is uniform across all four modules.



\*\*Inconsistent\*\*: `employees` has no policy helper file. The inline `authorize()` calls in `employees.ts` are correct but diverge from the domain-helper pattern used everywhere else.



\*\*Inconsistent\*\*: `referralSheetPolicy.ts:36` — `canViewReferralSheet` checks `referral\_sheets.view\_list` permission (same issue as candidates). The module uses `view\_list` for both list and single-record access.



\*\*Consistent pattern to enforce\*\*: Every route that mutates should: (1) call `requirePermission(key)` at the middleware level, (2) load the resource subject from DB, (3) call the domain policy helper with the subject. All four modules follow this. No route grants access based solely on the gate check.



\---



\### 8. Production Readiness



| Check | Status | Notes |

|-------|--------|-------|

| Single decision point | ✅ | `authorize()` only |

| No superAdmin bypass in routes | ✅ | Handled inside `authorize()` |

| tRPC and Express parity | ✅ | Same engine, same context |

| ASSIGNED invariant correct | ✅ | Ownership + branch both required |

| Cache invalidation — single process | ✅ | `clearAuthorizationCache` works |

| Cache invalidation — multi-process | ❌ | In-memory only |

| All users on canonical branch model | ⚠️ | Fallback still active |

| Legacy table sync enforced | ⚠️ | Convention only, no constraint |

| `resolveTargetBranchId` legacy path | ⚠️ | Latent hole if misused |



\*\*Safe to deploy as-is\*\* for single-process, development, or staging. For multi-process production: cache risk must be addressed first.



\---



\### 9. Recommended Next Steps (Priority Order)



\*\*1. Remove `resolveTargetBranchId` legacy path\*\* — Replace lines 180–194 of `permission.ts` with a hard throw. This eliminates the latent authorization hole with zero behavior change for correctly-ordered routes. One-line fix, zero risk.



\*\*2. Migrate all users to `user\_branch\_assignments`\*\*  — Write a migration that inserts into `user\_branch\_assignments` for every `hr\_users` row that has a `branch\_id` but no assignment row. After confirming zero-fallback-hits in logs, delete the `PHASE2B\_LEGACY\_FALLBACK` block.



\*\*3. Add a `candidates.view` permission\*\* — Separate `canViewCandidate` from `view\_list`. The permission matrix needs a dedicated `candidates.view` key (same fix needed for `referral\_sheets.view`). This is a 2-migration + 2-policy-function change.



\*\*4. Create `employeePolicy.ts`\*\* — Centralize the inline `authorize()` calls from `employees.ts` into a policy file. Makes the module consistent and protects against copy-paste drift when new employee routes are added.



\*\*5. Address multi-process cache\*\* — For production horizontal scaling: switch to a Redis-backed store with `DEL user:auth:{userId}` on role/branch changes, or reduce TTL to 60s as an interim. This is the only high-severity item for scaled deployments.



\*\*6. Drop `role\_permissions` sync\*\* — Once all consumers are confirmed to read only from `role\_permission\_grants`, remove the parallel inserts from migrations and eventually drop the legacy table. Add a DB comment on `role\_permissions` now marking it deprecated to prevent new code from relying on it.



\---



\### 10. Red Flags



None that are architectural. The system has no authorization logic scattered in routes, no hardcoded role-name checks, no duplicate decision points, and no silent allow-by-default paths. The risks identified above are all safe-fail (they cause unnecessary denials, not unauthorized grants), which is the correct failure mode for an authorization system.



The only exception worth flagging explicitly: \*\*the in-memory cache in a multi-process deployment is a real security gap\*\*, not just a performance concern. If a compromised or terminated account's cache entry persists on a different process while the primary process has cleared it, that user retains access for up to 5 minutes. At CRM scale with sensitive customer data, that window matters.



\---



\*\*Summary\*\*: The refactor achieved its goal. The foundation is correct, the invariants are sound, and the failure modes are safe. The three items warranting action before scaled production deployment are: the legacy fallback removal, the `resolveTargetBranchId` dead path hardening, and multi-process cache strategy.

