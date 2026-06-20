import { useEffect } from 'react';
import { Building2, Layers } from 'lucide-react';
import { useAuthStore } from '../hooks/useAuthStore';
import { useBranchContextStore } from '../hooks/useBranchContextStore';
import { useBranchStore } from '../hooks/useBranchStore';
import { canCrossBranch } from '../lib/branchScope';

/**
 * The "showing: branch X / all branches" indicator that sits above an operational
 * list (Group 1). See branch-scope-and-visibility-standard.md §4 / §2.5.
 *
 * Purpose is purely orientation: after the external filter stopped reloading the page
 * (§2.3), a scope change is visually silent — this banner makes the current scope
 * explicit so the user is never confused about WHY a list looks the way it does, and
 * a leaked/stale branch value surfaces as a visible label instead of a mystery empty
 * list. No security, no data logic — the server stays the source of truth.
 *
 * Only rendered for cross-branch operators (those who actually have the filter). A
 * single-branch user always sees their one branch, so the label would be noise.
 *
 * Mount it ONLY on pages whose list re-fetches on the filter (so the banner never
 * claims a scope the list isn't actually honouring).
 */
export default function BranchScopeIndicator() {
  const user = useAuthStore(s => s.user);
  const grants = useAuthStore(s => s.grants);
  const branchId = useBranchContextStore(s => s.branchId);
  const branches = useBranchStore(s => s.branches);
  const fetchBranches = useBranchStore(s => s.fetchBranches);

  const canSwitch = canCrossBranch(user, grants);

  useEffect(() => {
    if (canSwitch && branches.length === 0) {
      fetchBranches().catch(() => {});
    }
  }, [canSwitch, branches.length, fetchBranches]);

  if (!canSwitch) return null;

  const allBranches = branchId == null;
  const branchName = allBranches ? null : branches.find(b => b.id === branchId)?.name;

  return (
    <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-sky-50 border border-sky-100 text-sky-700 text-xs font-medium">
      {allBranches ? <Layers className="w-3.5 h-3.5" /> : <Building2 className="w-3.5 h-3.5" />}
      <span className="text-slate-500">تعرض:</span>
      <span className="font-bold">
        {allBranches ? 'كل الفروع' : (branchName ?? `الفرع #${branchId}`)}
      </span>
    </div>
  );
}
