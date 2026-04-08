import { router } from './init.js';
import { rolesRouter } from './routers/roles.js';

/**
 * Root tRPC router.
 * Only the Roles module is migrated in this PoC — other modules
 * continue to use the existing Express REST routes.
 */
export const appRouter = router({
  roles: rolesRouter,
});

/** The type exported here is imported (type-only) by the web package. */
export type AppRouter = typeof appRouter;
