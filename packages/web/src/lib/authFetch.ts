import { shouldAttachBranchContextHeader } from './branchContext';

/**
 * Drop-in replacement for fetch() that attaches the JWT Authorization header
 * from localStorage for all admin API calls.
 *
 * Also attaches X-Branch-Id when a branch context is selected — by the super-admin
 * switcher or by the per-page management filter shown to GLOBAL-grant operators
 * (e.g. مدير الشركة). The SERVER still gates the branch against the user's
 * allowedBranchIds, so this is safe. Global-only admin pages skip it so they stay
 * outside branch context. (Kept in sync with api.ts getBranchContextHeader.)
 */

function getBranchContextHeader(): string | null {
  try {
    if (!shouldAttachBranchContextHeader(window.location.pathname)) return null;
    const raw = localStorage.getItem('hr_branch_context');
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? String(n) : null;
  } catch {
    return null;
  }
}

export async function authFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const token = localStorage.getItem('hr_token');
  const branchCtx = getBranchContextHeader();
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(branchCtx ? { 'X-Branch-Id': branchCtx } : {}),
    ...(options.headers || {}),
  };
  return fetch(url, { ...options, headers });
}
