import { createTRPCClient, httpBatchLink } from '@trpc/client';
import type { AppRouterContract } from './trpc-contract';
import { shouldAttachBranchContextHeader } from './branchContext';

/**
 * Typed tRPC client.
 *
 * The `AppRouter` type is imported purely at the TypeScript level — it is
 * erased at build time and never bundled into the browser output.
 *
 * The client attaches the JWT from localStorage on every request, matching
 * the same auth pattern as the existing `authFetch` helper.
 */
function getBranchContextHeader(): string | null {
  try {
    if (!shouldAttachBranchContextHeader(window.location.pathname)) return null;
    // Attach for ANY cross-branch operator (super admin OR GLOBAL-grant manager),
    // mirroring the REST api.ts helper — the SERVER still gates the requested branch
    // against the user's allowedBranchIds, so this is safe. Previously gated to
    // super-admin only, which silently broke the switcher for GLOBAL managers
    // (e.g. the Users page filter did nothing for مدير الشركة).
    const raw = localStorage.getItem('hr_branch_context');
    if (!raw) return null;

    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? String(n) : null;
  } catch {
    return null;
  }
}

export const trpc = createTRPCClient<any>({
  links: [
    httpBatchLink({
      url: '/trpc',
      headers() {
        const token = localStorage.getItem('hr_token');
        const headers: Record<string, string> = {};
        if (token) {
          headers.Authorization = `Bearer ${token}`;
        }

        const branchCtx = getBranchContextHeader();
        if (branchCtx) {
          headers['X-Branch-Id'] = branchCtx;
        }

        return headers;
      },
    }),
  ],
}) as unknown as AppRouterContract;
