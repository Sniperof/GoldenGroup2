import { useAuthStore } from './useAuthStore';
import { useBranchContextStore } from './useBranchContextStore';

/**
 * Single source of truth for branch gating on LIST pages.
 *
 * Why this exists: the branch context (`useBranchContextStore`) is super-admin
 * only — non-super users never set it, and the SERVER already scopes them to
 * their own branches. Pages that hand-rolled `if (!branchId) return <pick a
 * branch>` therefore wrongly blocked every branch-scoped user. This hook
 * encodes the correct rule once so the bug cannot be reintroduced page by page.
 *
 * Rules:
 *  - `needsBranchSelection` is ALWAYS false for Group-1 operational lists: a
 *    super-admin on "all branches" sees the aggregate exactly like a GLOBAL
 *    company manager (branch-scope-and-visibility-standard.md §4 — "عام = الكل").
 *    Forcing a branch pick is reserved for Group-3 single-branch pages (§6),
 *    enforced separately by <RequireBranchContext>. (Previously this flagged a
 *    super-admin with no branch, which wrongly blocked them while GLOBAL users
 *    saw the aggregate — an inconsistency reported on the task tables.)
 *  - `effectiveBranchId` is sent to the API only when a branch is actually
 *    selected; otherwise omit it and let the server scope by the user's grants
 *    (super-admin → all branches; GLOBAL → their branches; BRANCH → their own).
 *
 * List pages MUST use this hook instead of reading `useBranchContextStore`
 * directly for gating (enforced by scripts/audit-branch-scope.mjs).
 */
export interface BranchListScope {
  isSuperAdmin: boolean;
  /** The user holds at least one BRANCH/ASSIGNED grant (implicitly scoped). */
  hasBranchScope: boolean;
  selectedBranchId: number | null;
  /** Pass to list APIs; undefined means "let the server scope me". */
  effectiveBranchId: number | undefined;
  /** True only for a super-admin with no branch picked yet. */
  needsBranchSelection: boolean;
}

export function useBranchListScope(): BranchListScope {
  const user = useAuthStore((s) => s.user);
  const grants = useAuthStore((s) => s.grants);
  const selectedBranchId = useBranchContextStore((s) => s.branchId);

  const isSuperAdmin = user?.isSuperAdmin === true;
  const hasBranchScope = (grants ?? []).some(
    (g) => g.scope === 'BRANCH' || g.scope === 'ASSIGNED',
  );

  return {
    isSuperAdmin,
    hasBranchScope,
    selectedBranchId,
    effectiveBranchId: selectedBranchId ?? undefined,
    // Group-1 lists never force a branch pick (§4/§6). Super-admin on "all
    // branches" loads the aggregate like a GLOBAL manager; the server scopes.
    needsBranchSelection: false,
  };
}
