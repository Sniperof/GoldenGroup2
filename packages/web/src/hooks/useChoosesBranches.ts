import { useAuthStore } from './useAuthStore';
import { canCrossBranch } from '../lib/branchScope';

/**
 * True when the user chooses among branches (cross-branch reach, or several
 * assigned branches). For such a user "all (your) branches" names no branch, so
 * an add/create action must wait for a specific branch — the server answers
 * BRANCH_REQUIRED otherwise (it no longer falls back to the home branch).
 * Pages combine it with their own GLOBAL check in their add-gate.
 */
export function useChoosesBranches(): boolean {
  const user = useAuthStore(s => s.user);
  const grants = useAuthStore(s => s.grants);
  return canCrossBranch(user, grants);
}
