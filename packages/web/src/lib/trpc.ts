import { createTRPCClient, httpBatchLink } from '@trpc/client';
import type { AppRouterContract } from './trpc-contract';
import { branchContextHeaderValue } from './branchContext';

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
  // Effective branch for the current section (see lib/branchContext.ts).
  return branchContextHeaderValue(window.location.pathname);
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
