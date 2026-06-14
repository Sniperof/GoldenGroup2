import { shouldAttachBranchContextHeader } from './branchContext';

/**
 * Drop-in replacement for fetch() that attaches the JWT Authorization header
 * from localStorage for all admin API calls.
 *
 * Also attaches X-Branch-Id when the current user is a super admin and has
 * selected a branch context. Non-super users never set this header; global-only
 * admin pages also skip it so they stay outside branch context.
 */

function getBranchContextHeader(): string | null {
  try {
    if (!shouldAttachBranchContextHeader(window.location.pathname)) return null;
    const rawUser = localStorage.getItem('hr_user');
    if (!rawUser) return null;
    const user = JSON.parse(rawUser);
    if (user?.isSuperAdmin !== true) return null;
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
