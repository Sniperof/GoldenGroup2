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
  // Multi-branch fields (migration 013+)
  branchId: z.number().nullable().optional(),
  isTemplate: z.boolean().optional(),
  templateId: z.number().nullable().optional(),
  // Protection/visibility fields (migration 029+)
  isProtected: z.boolean().optional(),
  isHidden: z.boolean().optional(),
  protectedReason: z.string().nullable().optional(),
  jobTaskCount: z.number().optional(),
});

export const RoleJobTaskSchema = z.object({
  id: z.number(),
  roleId: z.number(),
  title: z.string(),
  description: z.string().nullable(),
  displayOrder: z.number(),
  isActive: z.boolean(),
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

export const ScopeTypeSchema = z.enum(['GLOBAL', 'BRANCH', 'ASSIGNED']);

export const RolePermissionGrantSchema = PermissionSchema.extend({
  scopeType: ScopeTypeSchema,
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

export const UserBranchAssignmentStatusSchema = z.enum(['active', 'inactive']);

export const UserBranchAssignmentSchema = z.object({
  id: z.number(),
  userId: z.number(),
  branchId: z.number(),
  branchName: z.string(),
  isPrimary: z.boolean(),
  status: UserBranchAssignmentStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const BranchCatalogItemSchema = z.object({
  id: z.number(),
  name: z.string(),
  status: z.string(),
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
  grants: z.array(z.object({
    permissionId: z.number(),
    scopeType: ScopeTypeSchema,
  })),
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

export const UpsertUserBranchAssignmentInputSchema = z.object({
  userId: z.number(),
  branchId: z.number(),
  isPrimary: z.boolean().optional(),
  status: UserBranchAssignmentStatusSchema.optional(),
});

export const SetPrimaryUserBranchInputSchema = z.object({
  userId: z.number(),
  branchId: z.number(),
});

export const SetRoleJobTasksInputSchema = z.object({
  roleId: z.number(),
  tasks: z.array(z.object({
    title: z.string().min(1),
    description: z.string().nullable().optional(),
    isActive: z.boolean().optional(),
  })),
});

export const DeactivateUserBranchAssignmentInputSchema = z.object({
  userId: z.number(),
  branchId: z.number(),
});

// ── Role-users query result (hr_users with branch summary) ────────────────

/** Lightweight branch entry as returned inside getRoleUsers */
export const UserBranchSummarySchema = z.object({
  branchId: z.number(),
  branchName: z.string(),
  isPrimary: z.boolean(),
  status: z.string(),
});

/** HrUser enriched with their branch assignments (for role-users queries) */
export const HrUserWithBranchesSchema = HrUserSchema.extend({
  branchAssignments: z.array(UserBranchSummarySchema),
});

// ── Inferred TypeScript types ──────────────────────────────────────────────

export type UserBranchSummary = z.infer<typeof UserBranchSummarySchema>;
export type HrUserWithBranches = z.infer<typeof HrUserWithBranchesSchema>;
export type Role = z.infer<typeof RoleSchema>;
export type RoleJobTask = z.infer<typeof RoleJobTaskSchema>;
export type Permission = z.infer<typeof PermissionSchema>;
export type RolePermissionGrant = z.infer<typeof RolePermissionGrantSchema>;
export type HrUser = z.infer<typeof HrUserSchema>;
export type UserBranchAssignment = z.infer<typeof UserBranchAssignmentSchema>;
export type BranchCatalogItem = z.infer<typeof BranchCatalogItemSchema>;
export type CreateRoleInput = z.infer<typeof CreateRoleInputSchema>;
export type UpdateRoleInput = z.infer<typeof UpdateRoleInputSchema>;
export type SetPermissionsInput = z.infer<typeof SetPermissionsInputSchema>;
export type CreateHrUserInput = z.infer<typeof CreateHrUserInputSchema>;
export type UpdateHrUserInput = z.infer<typeof UpdateHrUserInputSchema>;
export type UpsertUserBranchAssignmentInput = z.infer<typeof UpsertUserBranchAssignmentInputSchema>;
export type SetPrimaryUserBranchInput = z.infer<typeof SetPrimaryUserBranchInputSchema>;
export type SetRoleJobTasksInput = z.infer<typeof SetRoleJobTasksInputSchema>;
export type DeactivateUserBranchAssignmentInput = z.infer<typeof DeactivateUserBranchAssignmentInputSchema>;
