/**
 * Roles module — shared Zod contract layer.
 *
 * These schemas are the single source of truth for the shape of every
 * request and response in the Roles tRPC router.  The TypeScript types
 * are inferred from the schemas so there is no manual duplication.
 */
import { z } from 'zod';

// ── Output schemas (what the API returns) ──────────────────────────────────

export const RoleSchema = z.object({
  id: z.number(),
  name: z.string(),
  displayName: z.string(),
  description: z.string().nullable(),
  isSystem: z.boolean(),
  isActive: z.boolean(),
  userCount: z.number(),
  permissionCount: z.number(),
  createdAt: z.string(),
});

export const PermissionSchema = z.object({
  id: z.number(),
  key: z.string(),
  module: z.string(),
  subModule: z.string(),
  action: z.string(),
  displayName: z.string(),
  displayOrder: z.number(),
});

export const HrUserSchema = z.object({
  id: z.number(),
  name: z.string(),
  username: z.string(),
  isActive: z.boolean(),
  roleId: z.number().nullable(),
  roleDisplayName: z.string().nullable(),
  createdAt: z.string(),
});

// ── Input schemas (what the client sends) ─────────────────────────────────

export const CreateRoleInputSchema = z.object({
  name: z.string().min(1),
  displayName: z.string().min(1),
  description: z.string().optional(),
});

export const UpdateRoleInputSchema = z.object({
  id: z.number(),
  displayName: z.string().optional(),
  description: z.string().optional(),
  isActive: z.boolean().optional(),
});

export const SetPermissionsInputSchema = z.object({
  roleId: z.number(),
  permissionIds: z.array(z.number()),
});

export const CreateHrUserInputSchema = z.object({
  name: z.string().min(1),
  username: z.string().min(1),
  password: z.string().min(1),
  roleId: z.number(),
});

export const UpdateHrUserInputSchema = z.object({
  id: z.number(),
  name: z.string().optional(),
  username: z.string().optional(),
  password: z.string().optional(),
  roleId: z.number().optional(),
  isActive: z.boolean().optional(),
});

// ── Inferred TypeScript types ──────────────────────────────────────────────

export type Role = z.infer<typeof RoleSchema>;
export type Permission = z.infer<typeof PermissionSchema>;
export type HrUser = z.infer<typeof HrUserSchema>;
export type CreateRoleInput = z.infer<typeof CreateRoleInputSchema>;
export type UpdateRoleInput = z.infer<typeof UpdateRoleInputSchema>;
export type SetPermissionsInput = z.infer<typeof SetPermissionsInputSchema>;
export type CreateHrUserInput = z.infer<typeof CreateHrUserInputSchema>;
export type UpdateHrUserInput = z.infer<typeof UpdateHrUserInputSchema>;
