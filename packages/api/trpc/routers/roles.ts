import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import bcrypt from 'bcryptjs';
import pool from '../../db.js';
import { router, withPermission } from '../init.js';
import { clearPermissionCache } from '../../middleware/permission.js';
import {
  RoleSchema,
  PermissionSchema,
  HrUserSchema,
  CreateRoleInputSchema,
  UpdateRoleInputSchema,
  SetPermissionsInputSchema,
  CreateHrUserInputSchema,
  UpdateHrUserInputSchema,
} from '@golden-crm/shared/contracts/roles.js';

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
  };
}

function toPermission(p: Record<string, unknown>): z.infer<typeof PermissionSchema> {
  return {
    id: p.id as number,
    key: p.key as string,
    module: p.module as string,
    subModule: p.sub_module as string,
    action: p.action as string,
    displayName: p.display_name as string,
    displayOrder: p.display_order as number,
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

// ── Roles tRPC router ──────────────────────────────────────────────────────

export const rolesRouter = router({

  // ── Roles ────────────────────────────────────────────────────────────────

  list: withPermission('admin.roles.view')
    .query(async () => {
      const { rows } = await pool.query(
        `SELECT r.*,
          (SELECT COUNT(*) FROM hr_users WHERE role_id = r.id) AS user_count,
          (SELECT COUNT(*) FROM role_permissions WHERE role_id = r.id) AS permission_count
         FROM roles r ORDER BY r.id`
      );
      return rows.map(toRole);
    }),

  getById: withPermission('admin.roles.view')
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const { rows: roleRows } = await pool.query(
        'SELECT * FROM roles WHERE id = $1', [input.id]
      );
      if (!roleRows[0]) throw new TRPCError({ code: 'NOT_FOUND', message: 'الدور غير موجود' });

      const { rows: permRows } = await pool.query(
        `SELECT p.* FROM role_permissions rp
         JOIN permissions p ON p.id = rp.permission_id
         WHERE rp.role_id = $1 ORDER BY p.display_order`,
        [input.id]
      );
      return { ...toRole(roleRows[0]), permissions: permRows.map(toPermission) };
    }),

  getPermissions: withPermission('admin.roles.view')
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const { rows: check } = await pool.query(
        'SELECT id FROM roles WHERE id = $1', [input.id]
      );
      if (!check[0]) throw new TRPCError({ code: 'NOT_FOUND', message: 'الدور غير موجود' });

      const { rows } = await pool.query(
        `SELECT p.* FROM role_permissions rp
         JOIN permissions p ON p.id = rp.permission_id
         WHERE rp.role_id = $1 ORDER BY p.display_order`,
        [input.id]
      );
      return rows.map(toPermission);
    }),

  create: withPermission('admin.roles.manage')
    .input(CreateRoleInputSchema)
    .mutation(async ({ input }) => {
      try {
        const { rows } = await pool.query(
          `INSERT INTO roles (name, display_name, description)
           VALUES ($1, $2, $3) RETURNING *`,
          [input.name.trim(), input.displayName.trim(), input.description ?? null]
        );
        return toRole(rows[0]);
      } catch (err: unknown) {
        const pg = err as { code?: string };
        if (pg.code === '23505') {
          throw new TRPCError({ code: 'CONFLICT', message: 'يوجد دور بنفس الاسم بالفعل' });
        }
        throw err;
      }
    }),

  update: withPermission('admin.roles.manage')
    .input(UpdateRoleInputSchema)
    .mutation(async ({ input }) => {
      const { id, displayName, description, isActive } = input;
      const { rows: cur } = await pool.query('SELECT * FROM roles WHERE id = $1', [id]);
      if (!cur[0]) throw new TRPCError({ code: 'NOT_FOUND', message: 'الدور غير موجود' });

      const { rows } = await pool.query(
        `UPDATE roles SET
          display_name = COALESCE($1, display_name),
          description  = COALESCE($2, description),
          is_active    = COALESCE($3, is_active),
          updated_at   = NOW()
         WHERE id = $4 RETURNING *`,
        [
          displayName ?? null,
          description !== undefined ? description : null,
          isActive !== undefined ? isActive : null,
          id,
        ]
      );
      return toRole(rows[0]);
    }),

  delete: withPermission('admin.roles.manage')
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const { rows } = await pool.query('SELECT * FROM roles WHERE id = $1', [input.id]);
      if (!rows[0]) throw new TRPCError({ code: 'NOT_FOUND', message: 'الدور غير موجود' });
      if (rows[0].is_system) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'لا يمكن حذف دور نظامي' });
      }
      const { rows: uc } = await pool.query(
        'SELECT COUNT(*) FROM hr_users WHERE role_id = $1', [input.id]
      );
      if (parseInt(uc[0].count as string) > 0) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'لا يمكن حذف دور مرتبط بمستخدمين' });
      }
      await pool.query('DELETE FROM roles WHERE id = $1', [input.id]);
      return { success: true as const };
    }),

  setPermissions: withPermission('admin.roles.manage')
    .input(SetPermissionsInputSchema)
    .mutation(async ({ input }) => {
      const client = await pool.connect();
      try {
        const { rows: check } = await client.query(
          'SELECT id FROM roles WHERE id = $1', [input.roleId]
        );
        if (!check[0]) throw new TRPCError({ code: 'NOT_FOUND', message: 'الدور غير موجود' });

        await client.query('BEGIN');
        await client.query(
          'DELETE FROM role_permissions WHERE role_id = $1', [input.roleId]
        );
        if (input.permissionIds.length > 0) {
          const values = input.permissionIds
            .map((_: number, i: number) => `($1, $${i + 2})`)
            .join(', ');
          await client.query(
            `INSERT INTO role_permissions (role_id, permission_id) VALUES ${values}`,
            [input.roleId, ...input.permissionIds]
          );
        }
        await client.query('COMMIT');
        clearPermissionCache();

        const { rows: permRows } = await pool.query(
          `SELECT p.* FROM role_permissions rp
           JOIN permissions p ON p.id = rp.permission_id
           WHERE rp.role_id = $1 ORDER BY p.display_order`,
          [input.roleId]
        );
        return permRows.map(toPermission);
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    }),

  // ── Permissions ───────────────────────────────────────────────────────────

  allPermissions: withPermission('admin.roles.view')
    .query(async () => {
      const { rows } = await pool.query('SELECT * FROM permissions ORDER BY display_order');
      return rows.map(toPermission);
    }),

  // ── HR Users ──────────────────────────────────────────────────────────────

  hrUsersList: withPermission('admin.roles.view')
    .query(async () => {
      const { rows } = await pool.query(
        `SELECT u.id, u.name, u.username, u.is_active, u.created_at, u.role_id,
          r.display_name AS role_display_name
         FROM hr_users u
         LEFT JOIN roles r ON r.id = u.role_id
         ORDER BY u.id`
      );
      return rows.map(toHrUser);
    }),

  createHrUser: withPermission('admin.roles.manage')
    .input(CreateHrUserInputSchema)
    .mutation(async ({ input }) => {
      try {
        const { rows: roleRows } = await pool.query(
          'SELECT name FROM roles WHERE id = $1', [input.roleId]
        );
        if (!roleRows[0]) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'الدور غير موجود' });
        }
        const passwordHash = await bcrypt.hash(input.password, 10);
        const { rows } = await pool.query(
          `INSERT INTO hr_users (name, username, password_hash, role, role_id)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id, name, username, is_active, created_at, role_id`,
          [input.name.trim(), input.username.trim(), passwordHash, roleRows[0].name, input.roleId]
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

  updateHrUser: withPermission('admin.roles.manage')
    .input(UpdateHrUserInputSchema)
    .mutation(async ({ input }) => {
      const { id, name, username, password, roleId, isActive } = input;
      const { rows: cur } = await pool.query('SELECT * FROM hr_users WHERE id = $1', [id]);
      if (!cur[0]) throw new TRPCError({ code: 'NOT_FOUND', message: 'المستخدم غير موجود' });

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
        const { rows: roleRows } = await pool.query(
          'SELECT name FROM roles WHERE id = $1', [roleId]
        );
        if (!roleRows[0]) throw new TRPCError({ code: 'NOT_FOUND', message: 'الدور غير موجود' });
        updates.push(`role_id = $${idx++}`); params.push(roleId);
        updates.push(`role = $${idx++}`);    params.push(roleRows[0].name);
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
});
