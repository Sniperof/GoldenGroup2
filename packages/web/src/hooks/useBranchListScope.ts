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
 *  - `needsBranchSelection` is true ONLY for a super-admin who hasn't picked a
 *    branch (they have no implicit branch and would otherwise pull every
 *    branch at once). Branch/Global users are never flagged.
 *  - `effectiveBranchId` is sent to the API only when a branch is actually
 *    selected; otherwise omit it and let the server scope by the user's grants.
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
    needsBranchSelection: isSuperAdmin && selectedBranchId == null,
  };
}
