import type { ReactNode } from 'react';
import { Building2 } from 'lucide-react';
import { useAuthStore } from '../hooks/useAuthStore';
import { useBranchContextStore } from '../hooks/useBranchContextStore';
import { canCrossBranch } from '../lib/branchScope';

/**
 * Gate for Group 3 pages — single-branch operational surfaces (planning, telemarketer,
 * supervisor alerts). See branch-scope-and-visibility-standard.md §6 / Phase 3.
 *
 * Conceptually: "operate one branch" has no meaning across all branches at once. So a
 * cross-branch operator (super admin / مدير الشركة) who is viewing "all branches" must
 * pick a specific branch before entering — even a super admin. The page is replaced by
 * a friendly "choose a branch" prompt rather than rendering an ambiguous aggregate.
 *
 * A single-branch user (branch manager / supervisor) has an implicit branch and no
 * switcher, so this never blocks them — they always enter, scoped by the server to
 * their pinned branch.
 */
export default function RequireBranchContext({ children }: { children: ReactNode }) {
  const user = useAuthStore(s => s.user);
  const grants = useAuthStore(s => s.grants);
  const branchId = useBranchContextStore(s => s.branchId);

  const mustPickBranch = canCrossBranch(user, grants) && branchId == null;

  if (mustPickBranch) {
    return (
      <div className="h-full flex items-center justify-center p-8">
        <div className="max-w-sm text-center">
          <div className="mx-auto mb-4 w-14 h-14 rounded-2xl bg-sky-50 border border-sky-100 flex items-center justify-center">
            <Building2 className="w-7 h-7 text-sky-600" />
          </div>
          <h2 className="text-lg font-bold text-slate-800 mb-1.5">اختر فرعاً للدخول</h2>
          <p className="text-sm text-slate-500 leading-relaxed">
            هذه الصفحة لإدارة فرع واحد، ولا تُعرض على «كل الفروع». اختر فرعاً محدداً من
            المبدّل في الأعلى للمتابعة.
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
