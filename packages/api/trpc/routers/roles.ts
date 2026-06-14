import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import bcrypt from 'bcryptjs';
import pool from '../../db.js';
import { router, withPermission } from '../init.js';
import { clearPermissionCache } from '../../middleware/permission.js';
import { TEMPLATE_ROLE_ASSIGNMENT_ERROR, validateTemplateRoleAssignment, assertRoleWithinActorScope, ROLE_ESCALATION_ERROR } from '../../services/roleAssignmentGuard.js';
import {
  listPermissionCatalog,
  listRolePermissionGrants,
  replaceRolePermissionGrants,
  RolePermissionServiceError,
} from '../../services/rolePermissionService.js';
import {
  createRole,
  deleteRole,
  updateRole,
  RoleManagementError,
} from '../../services/roleManagementService.js';
import {
  UserBranchAssignmentError,
  listBranchCatalog,
  listUserBranchAssignments,
  upsertUserBranchAssignment,
  deactivateUserBranchAssignment,
  setPrimaryUserBranchAssignment,
} from '../../services/userBranchAssignmentService.js';
import { authorize } from '../../services/authorizationService.js';
import {
  BranchCatalogItemSchema,
  RoleSchema,
  PermissionSchema,
  RolePermissionGrantSchema,
  RoleJobTaskSchema,
  HrUserSchema,
  CreateRoleInputSchema,
  DeactivateUserBranchAssignmentInputSchema,
  UpdateRoleInputSchema,
  UpsertUserBranchAssignmentInputSchema,
  SetPermissionsInputSchema,
  SetRoleJobTasksInputSchema,
  CreateHrUserInputSchema,
  SetPrimaryUserBranchInputSchema,
  UpdateHrUserInputSchema,
  UserBranchAssignmentSchema,
} from '@golden-crm/shared/contracts/roles.js';

const VALID_SCOPE_TYPES = new Set(['GLOBAL', 'BRANCH', 'ASSIGNED']);
type ScopeType = 'GLOBAL' | 'BRANCH' | 'ASSIGNED';

// ── DB row → typed camelCase helpers ──────────────────────────────────────
// These replace the normalizeRole/normalizeHrUser functions in useRoleStore.

function toRole(r: Record<string, unknown>): z.infer<typeof RoleSchema> {
  return {
    id: r.id as number,
    name: r.name as string,
    displayName: r.display_name as string,
    description: (r.description as string) ?? null,
    isSystem: r.is_system as boolean,
    isActive: r.is_active as boolean,
    userCount: Number(r.user_count ?? 0),
    permissionCount: Number(r.permission_count ?? 0),
    createdAt: r.created_at as string,
    // Multi-branch fields (migration 013+)
    branchId: (r.branch_id as number) ?? null,
    isTemplate: (r.is_template as boolean) ?? false,
    templateId: (r.template_id as number) ?? null,
    // Protection/visibility fields (migration 029+)
    isProtected: (r.is_protected as boolean) ?? false,
    isHidden: (r.is_hidden as boolean) ?? false,
    protectedReason: (r.protected_reason as string) ?? null,
    jobTaskCount: Number(r.job_task_count ?? 0),
    teamSlotType: r.team_slot_type != null ? (r.team_slot_type as 'SUPERVISOR' | 'TECHNICIAN' | 'TRAINEE' | 'TELEMARKETER') : null,
  };
}

function toPermission(p: Record<string, unknown>): z.infer<typeof PermissionSchema> {
  const rawAllowedScopes = Array.isArray(p.allowed_scopes) ? p.allowed_scopes : [];
  const allowedScopes = rawAllowedScopes.filter(
    (scope): scope is ScopeType => VALID_SCOPE_TYPES.has(scope as ScopeType),
  );
  return {
    id: p.id as number,
    key: p.key as string,
    module: p.module as string,
    subModule: p.sub_module as string,
    action: p.action as string,
    displayName: p.display_name as string,
    displayOrder: p.display_order as number,
    allowedScopes: allowedScopes.length > 0 ? allowedScopes : ['GLOBAL', 'BRANCH', 'ASSIGNED'],
  };
}

function toHrUser(u: Record<string, unknown>): z.infer<typeof HrUserSchema> {
  return {
    id: u.id as number,
    name: u.name as string,
    username: u.username as string,
    isActive: u.is_active as boolean,
    roleId: (u.role_id as number) ?? null,
    roleDisplayName: (u.role_display_name as string) ?? null,
    createdAt: u.created_at as string,
  };
}

function toPermissionGrant(p: Record<string, unknown>): z.infer<typeof RolePermissionGrantSchema> {
  return {
    ...toPermission(p),
    scopeType: p.scope_type as z.infer<typeof RolePermissionGrantSchema>['scopeType'],
  };
}

function toRolePermissionError(err: unknown): TRPCError {
  if (!(err instanceof RolePermissionServiceError)) {
    return new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'خطأ في إدارة صلاحيات الدور' });
  }

  return new TRPCError({
    code: err.code === 'ROLE_NOT_FOUND' ? 'NOT_FOUND' : 'BAD_REQUEST',
    message: err.message,
  });
}

function toRoleManagementError(err: unknown): TRPCError {
  if (!(err instanceof RoleManagementError)) {
    return new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'خطأ في إدارة الدور' });
  }

  const code = err.code === 'ROLE_NOT_FOUND'
    ? 'NOT_FOUND'
    : err.code === 'ROLE_NAME_CONFLICT'
      ? 'CONFLICT'
      : 'BAD_REQUEST';
  return new TRPCError({ code, message: err.message });
}

function toRoleJobTask(task: Record<string, unknown>): z.infer<typeof RoleJobTaskSchema> {
  return {
    id: task.id as number,
    roleId: task.role_id as number,
    title: task.title as string,
    description: (task.description as string) ?? null,
    displayOrder: task.display_order as number,
    isActive: task.is_active as boolean,
  };
}

function toBranchCatalogItem(branch: z.infer<typeof BranchCatalogItemSchema>): z.infer<typeof BranchCatalogItemSchema> {
  return branch;
}

function toUserBranchAssignment(
  assignment: z.infer<typeof UserBranchAssignmentSchema>,
): z.infer<typeof UserBranchAssignmentSchema> {
  return assignment;
}

function toUserBranchAssignmentError(err: unknown): TRPCError {
  if (err instanceof TRPCError) {
    return err;
  }

  if (!(err instanceof UserBranchAssignmentError)) {
    return new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: '???? ????? ???? ????????' });
  }

  switch (err.code) {
    case 'USER_NOT_FOUND':
    case 'BRANCH_NOT_FOUND':
    case 'ASSIGNMENT_NOT_FOUND':
      return new TRPCError({ code: 'NOT_FOUND', message: err.message });
    case 'PRIMARY_BRANCH_REQUIRES_ACTIVE_ASSIGNMENT':
      return new TRPCError({ code: 'BAD_REQUEST', message: err.message });
    default:
      return new TRPCError({ code: 'BAD_REQUEST', message: err.message });
  }
}

// ── Roles tRPC router ──────────────────────────────────────────────────────

export const rolesRouter = router({

  // ── Roles ────────────────────────────────────────────────────────────────

  list: withPermission('admin.roles.view', 'admin.roles.users.manage')
    .query(async ({ ctx }) => {
      const result = await pool.query(
        `SELECT r.*,
          (SELECT COUNT(*) FROM hr_users WHERE role_id = r.id) AS user_count,
          (SELECT COUNT(*) FROM role_permission_grants WHERE role_id = r.id) AS permission_count,
          (SELECT COUNT(*) FROM role_job_tasks WHERE role_id = r.id AND is_active = TRUE) AS job_task_count
         FROM roles r
         WHERE r.is_template = TRUE
           AND r.name NOT LIKE 'job_title_%'
           AND r.name NOT LIKE 'DEV_%'
           AND COALESCE(r.is_hidden, FALSE) = FALSE
           AND COALESCE(r.is_system, FALSE) = FALSE
           AND COALESCE(r.is_protected, FALSE) = FALSE
         ORDER BY r.id`
      );

      const roles = result.rows.map(toRole);
      // assignable: can the current actor assign this role without escalating?
      // Drives the user-form dropdown so it only offers roles the actor may grant.
      const assignableFlags = await Promise.all(
        roles.map(r => assertRoleWithinActorScope(ctx.authContext, r.id).then(c => c.ok)),
      );
      return roles.map((r, i) => ({ ...r, assignable: assignableFlags[i] }));
    }),

  getById: withPermission('admin.roles.view')
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const { rows: roleRows } = await pool.query(
        'SELECT * FROM roles WHERE id = $1', [input.id]
      );
      if (!roleRows[0]) throw new TRPCError({ code: 'NOT_FOUND', message: 'الدور غير موجود' });

      const grants = await listRolePermissionGrants(input.id);
      return {
        ...toRole(roleRows[0]),
        permissions: grants.map(grant => toPermissionGrant(grant as unknown as Record<string, unknown>)),
      };
    }),

  getPermissions: withPermission('admin.roles.view')
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      try {
        const grants = await listRolePermissionGrants(input.id);
        return grants.map(grant => toPermissionGrant(grant as unknown as Record<string, unknown>));
      } catch (err) {
        throw toRolePermissionError(err);
      }
    }),

  getRoleJobTasks: withPermission('admin.roles.view')
    .input(z.object({ roleId: z.number() }))
    .query(async ({ input }) => {
      const { rows: roleRows } = await pool.query(
        'SELECT id FROM roles WHERE id = $1', [input.roleId]
      );
      if (!roleRows[0]) throw new TRPCError({ code: 'NOT_FOUND', message: '????? ??? ?????' });

      const { rows } = await pool.query(
        `SELECT id, role_id, title, description, display_order, is_active
         FROM role_job_tasks
         WHERE role_id = $1
         ORDER BY display_order ASC, id ASC`,
        [input.roleId],
      );
      return rows.map(toRoleJobTask);
    }),

  setRoleJobTasks: withPermission('admin.roles.manage')
    .input(SetRoleJobTasksInputSchema)
    .mutation(async ({ input }) => {
      const { rows: roleRows } = await pool.query(
        'SELECT id, is_system, is_protected FROM roles WHERE id = $1', [input.roleId]
      );
      const role = roleRows[0];
      if (!role) throw new TRPCError({ code: 'NOT_FOUND', message: '????? ??? ?????' });
      if (role.is_system || role.is_protected) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: '?? ???? ????? ?????? ???????? ???? ????? ?? ????' });
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('DELETE FROM role_job_tasks WHERE role_id = $1', [input.roleId]);

        for (const [index, task] of input.tasks.entries()) {
          const title = task.title.trim();
          if (!title) continue;
          await client.query(
            `INSERT INTO role_job_tasks (role_id, title, description, display_order, is_active)
             VALUES ($1, $2, $3, $4, $5)`,
            [
              input.roleId,
              title,
              task.description?.trim() || null,
              index + 1,
              task.isActive ?? true,
            ],
          );
        }

        const { rows } = await client.query(
          `SELECT id, role_id, title, description, display_order, is_active
           FROM role_job_tasks
           WHERE role_id = $1
           ORDER BY display_order ASC, id ASC`,
          [input.roleId],
        );
        await client.query('COMMIT');
        return rows.map(toRoleJobTask);
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    }),

  create: withPermission('admin.roles.manage')
    .input(CreateRoleInputSchema)
    .mutation(async ({ input }) => {
      try {
        return toRole(await createRole(input));
      } catch (err) {
        throw toRoleManagementError(err);
      }
    }),

  update: withPermission('admin.roles.manage')
    .input(UpdateRoleInputSchema)
    .mutation(async ({ input }) => {
      try {
        const { id, ...changes } = input;
        return toRole(await updateRole(id, changes));
      } catch (err) {
        throw toRoleManagementError(err);
      }
    }),

  delete: withPermission('admin.roles.manage')
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      try {
        await deleteRole(input.id);
        return { success: true as const };
      } catch (err) {
        throw toRoleManagementError(err);
      }
    }),

  setPermissions: withPermission('admin.roles.manage')
    .input(SetPermissionsInputSchema)
    .mutation(async ({ input }) => {
      try {
        const grants = await replaceRolePermissionGrants(input.roleId, input.grants);
        return grants.map(grant => toPermissionGrant(grant as unknown as Record<string, unknown>));
      } catch (err) {
        throw toRolePermissionError(err);
      }
    }),

  // ── Permissions ───────────────────────────────────────────────────────────

  allPermissions: withPermission('admin.roles.view')
    .query(async () => {
      const permissions = await listPermissionCatalog();
      return permissions.map(permission => toPermission(permission as unknown as Record<string, unknown>));
    }),

  // ── HR Users ──────────────────────────────────────────────────────────────

  // -- Role ? Users (filtered by role_id, with branch assignments) ----------

  getRoleUsers: withPermission('admin.roles.view')
    .input(z.object({ roleId: z.number() }))
    .query(async ({ input }) => {
      const { rows } = await pool.query(
        `SELECT
           u.id, u.name, u.username, u.is_active, u.created_at, u.role_id,
           r.display_name AS role_display_name,
           COALESCE(
             json_agg(
               json_build_object(
                 'branchId',   uba.branch_id,
                 'branchName', b.name,
                 'isPrimary',  uba.is_primary,
                 'status',     uba.status
               ) ORDER BY uba.is_primary DESC, uba.branch_id
             ) FILTER (WHERE uba.branch_id IS NOT NULL),
             '[]'::json
           ) AS branch_assignments
         FROM hr_users u
         LEFT JOIN roles r ON r.id = u.role_id
         LEFT JOIN user_branch_assignments uba ON uba.user_id = u.id
         LEFT JOIN branches b ON b.id = uba.branch_id
         WHERE u.role_id = $1
         GROUP BY u.id, u.name, u.username, u.is_active, u.created_at, u.role_id, r.display_name
         ORDER BY u.name`,
        [input.roleId],
      );
      return rows.map(u => ({
        id: u.id as number,
        name: u.name as string,
        username: u.username as string,
        isActive: u.is_active as boolean,
        roleId: (u.role_id as number) ?? null,
        roleDisplayName: (u.role_display_name as string) ?? null,
        createdAt: u.created_at as string,
        branchAssignments: (u.branch_assignments as Array<{
          branchId: number;
          branchName: string;
          isPrimary: boolean;
          status: string;
        }>),
      }));
    }),

  hrUsersList: withPermission('admin.roles.view', 'admin.roles.users.manage')
    .query(async ({ ctx }) => {
      const conditions: string[] = [];
      const params: unknown[] = [];
      const usersManageAccess = authorize(ctx.authContext, { permission: 'admin.roles.users.manage' });
      const rolesViewAccess = authorize(ctx.authContext, { permission: 'admin.roles.view' });
      const hasGlobalAccess = ctx.authContext.isSuperAdmin
        || usersManageAccess.reason === 'GRANTED_GLOBAL'
        || rolesViewAccess.reason === 'GRANTED_GLOBAL';
      if (!hasGlobalAccess) {
        const targetBranchId = ctx.authContext.actingBranchId ?? ctx.authContext.allowedBranchIds[0] ?? null;
        if (targetBranchId == null) {
          return [];
        }
        params.push(targetBranchId);
        conditions.push(`u.branch_id = $${params.length}`);
      } else if (ctx.xBranchId != null) {
        const branchAccess = authorize(ctx.authContext, {
          permission: 'admin.roles.users.manage',
          branchId: ctx.xBranchId,
        });
        const viewAccess = authorize(ctx.authContext, {
          permission: 'admin.roles.view',
          branchId: ctx.xBranchId,
        });
        if (!branchAccess.allowed && !viewAccess.allowed) {
          return [];
        }
        params.push(ctx.xBranchId);
        conditions.push(`u.branch_id = $${params.length}`);
      }
      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      const { rows } = await pool.query(
        `SELECT u.id, u.name, u.username, u.is_active, u.created_at, u.role_id,
          r.display_name AS role_display_name
         FROM hr_users u
         LEFT JOIN roles r ON r.id = u.role_id
         ${where}
         ORDER BY u.id`,
        params,
      );
      return rows.map(toHrUser);
    }),

  createHrUser: withPermission('admin.roles.users.manage')
    .input(CreateHrUserInputSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        const globalAccess = authorize(ctx.authContext, {
          permission: 'admin.roles.users.manage',
        });
        const targetBranchId = ctx.authContext.isSuperAdmin || globalAccess.reason === 'GRANTED_GLOBAL'
          ? ctx.xBranchId
          : ctx.authContext.actingBranchId ?? ctx.authContext.allowedBranchIds[0] ?? null;
        if (targetBranchId == null) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'يجب تحديد الفرع المستهدف للمستخدم' });
        }
        const access = authorize(ctx.authContext, {
          permission: 'admin.roles.users.manage',
          branchId: targetBranchId,
        });
        if (!access.allowed) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'غير مسموح بإسناد دور ضمن هذا الفرع' });
        }
        const roleCheck = await validateTemplateRoleAssignment(input.roleId);
        if (roleCheck.ok === false) {
          throw new TRPCError({
            code: roleCheck.reason === 'NOT_FOUND' ? 'NOT_FOUND' : 'BAD_REQUEST',
            message: roleCheck.reason === 'NOT_FOUND' ? '????? ??? ?????' : TEMPLATE_ROLE_ASSIGNMENT_ERROR,
          });
        }
        const scopeCheck = await assertRoleWithinActorScope(ctx.authContext, input.roleId);
        if (scopeCheck.ok === false) {
          throw new TRPCError({ code: 'FORBIDDEN', message: ROLE_ESCALATION_ERROR });
        }
        const passwordHash = await bcrypt.hash(input.password, 10);
        const { rows } = await pool.query(
          `INSERT INTO hr_users (name, username, password_hash, role, role_id, branch_id)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING id, name, username, is_active, created_at, role_id`,
          [input.name.trim(), input.username.trim(), passwordHash, roleCheck.role.name, input.roleId, targetBranchId]
        );
        return toHrUser(rows[0]);
      } catch (err: unknown) {
        const pg = err as { code?: string };
        if (pg.code === '23505') {
          throw new TRPCError({ code: 'CONFLICT', message: 'اسم الدخول مستخدم بالفعل' });
        }
        throw err;
      }
    }),

  updateHrUser: withPermission('admin.roles.users.manage')
    .input(UpdateHrUserInputSchema)
    .mutation(async ({ ctx, input }) => {
      const { id, name, username, password, roleId, isActive } = input;
      const { rows: cur } = await pool.query('SELECT * FROM hr_users WHERE id = $1', [id]);
      if (!cur[0]) throw new TRPCError({ code: 'NOT_FOUND', message: 'المستخدم غير موجود' });
      if (!ctx.authContext.isSuperAdmin) {
        if (cur[0].is_super_admin) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'غير مسموح' });
        }
        const targetBranchId = cur[0].branch_id as number | null;
        if (targetBranchId == null) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'غير مسموح' });
        }
        const access = authorize(ctx.authContext, {
          permission: 'admin.roles.users.manage',
          branchId: targetBranchId,
        });
        if (!access.allowed) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'غير مسموح بإسناد دور ضمن هذا الفرع' });
        }
      }

      const updates: string[] = [];
      const params: unknown[] = [];
      let idx = 1;

      if (name !== undefined) { updates.push(`name = $${idx++}`); params.push(name.trim()); }
      if (username !== undefined) { updates.push(`username = $${idx++}`); params.push(username.trim()); }
      if (password) {
        const hash = await bcrypt.hash(password, 10);
        updates.push(`password_hash = $${idx++}`);
        params.push(hash);
      }
      if (roleId !== undefined) {
        const roleCheck = await validateTemplateRoleAssignment(roleId);
        if (roleCheck.ok === false) {
          throw new TRPCError({
            code: roleCheck.reason === 'NOT_FOUND' ? 'NOT_FOUND' : 'BAD_REQUEST',
            message: roleCheck.reason === 'NOT_FOUND' ? '????? ??? ?????' : TEMPLATE_ROLE_ASSIGNMENT_ERROR,
          });
        }
        const scopeCheck = await assertRoleWithinActorScope(ctx.authContext, roleId);
        if (scopeCheck.ok === false) {
          throw new TRPCError({ code: 'FORBIDDEN', message: ROLE_ESCALATION_ERROR });
        }
        updates.push(`role_id = $${idx++}`); params.push(roleId);
        updates.push(`role = $${idx++}`);    params.push(roleCheck.role.name);
      }
      if (isActive !== undefined) { updates.push(`is_active = $${idx++}`); params.push(isActive); }

      if (!updates.length) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'لا توجد بيانات للتحديث' });
      }

      params.push(id);
      const { rows } = await pool.query(
        `UPDATE hr_users SET ${updates.join(', ')} WHERE id = $${idx}
         RETURNING id, name, username, is_active, created_at, role_id`,
        params
      );
      if (roleId !== undefined) clearPermissionCache(id);
      return toHrUser(rows[0]);
    }),

  branchCatalog: withPermission('users.branch_assignments.view')
    .query(async () => {
      const branches = await listBranchCatalog();
      return branches.map(toBranchCatalogItem);
    }),

  getUserBranchAssignments: withPermission('users.branch_assignments.view')
    .input(z.object({ userId: z.number() }))
    .query(async ({ input }) => {
      const assignments = await listUserBranchAssignments(input.userId);
      return assignments.map(toUserBranchAssignment);
    }),

  upsertUserBranchAssignment: withPermission('users.branch_assignments.manage')
    .input(UpsertUserBranchAssignmentInputSchema)
    .mutation(async ({ input }) => {
      try {
        const assignments = await upsertUserBranchAssignment(input);
        clearPermissionCache(input.userId);
        return assignments.map(toUserBranchAssignment);
      } catch (err) {
        throw toUserBranchAssignmentError(err);
      }
    }),

  deactivateUserBranchAssignment: withPermission('users.branch_assignments.manage')
    .input(DeactivateUserBranchAssignmentInputSchema)
    .mutation(async ({ input }) => {
      try {
        const assignments = await deactivateUserBranchAssignment(input);
        clearPermissionCache(input.userId);
        return assignments.map(toUserBranchAssignment);
      } catch (err) {
        throw toUserBranchAssignmentError(err);
      }
    }),

  setPrimaryUserBranchAssignment: withPermission('users.branch_assignments.manage')
    .input(SetPrimaryUserBranchInputSchema)
    .mutation(async ({ input }) => {
      try {
        const assignments = await setPrimaryUserBranchAssignment(input);
        clearPermissionCache(input.userId);
        return assignments.map(toUserBranchAssignment);
      } catch (err) {
        throw toUserBranchAssignmentError(err);
      }
    }),
});

