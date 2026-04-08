import { createTRPCClient, httpBatchLink } from '@trpc/client';
import type { AppRouterContract } from './trpc-contract';

/**
 * Typed tRPC client.
 *
 * The `AppRouter` type is imported purely at the TypeScript level — it is
 * erased at build time and never bundled into the browser output.
 *
 * The client attaches the JWT from localStorage on every request, matching
 * the same auth pattern as the existing `authFetch` helper.
 */
export const trpc = createTRPCClient<any>({
  links: [
    httpBatchLink({
      url: '/trpc',
      headers() {
        const token = localStorage.getItem('hr_token');
        return token ? { Authorization: `Bearer ${token}` } : {};
      },
    }),
  ],
}) as unknown as AppRouterContract;
