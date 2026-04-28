import { Router } from 'express';
import bcrypt from 'bcryptjs';
import pool from '../db.js';
import { requirePermission, requireSuperAdmin, clearPermissionCache } from '../middleware/permission.js';
import { TEMPLATE_ROLE_ASSIGNMENT_ERROR, validateTemplateRoleAssignment } from '../services/roleAssignmentGuard.js';

const router = Router();
const VALID_SCOPE_TYPES = new Set(['GLOBAL', 'BRANCH', 'ASSIGNED']);

/**
 * Multi-branch rules enforced below:
 *   - Templates (is_template = TRUE, branch_id = NULL)  → HQ only.
 *   - Per-branch clones (is_template = FALSE, branch_id = X) →
 *       • branch admins can read/write only their own branch's clones.
 *       • super admins can read/write any branch's clones.
 *   - hr_users list/CRUD is scoped the same way.
 */

// ── GET /roles ──────────────────────────────────────────────────────────────
// Query params:
//   includeLegacy=true -> include legacy/dev template roles in admin inventory.
// Admin role management is template-only. Branch access is assigned to users,
// not encoded as branch-specific role clones.
router.get('/roles', requirePermission('admin.roles.view'), async (req, res) => {
  try {
    const includeLegacy = req.query.includeLegacy === 'true';

    const conditions: string[] = [];
    const params: any[] = [];

    conditions.push('r.is_template = TRUE');
    if (!includeLegacy) {
      conditions.push(`r.name NOT LIKE 'job_title_%'`);
      conditions.push(`r.name NOT LIKE 'DEV_%'`);
    }
    conditions.push('COALESCE(r.is_hidden, FALSE) = FALSE');
    conditions.push('COALESCE(r.is_system, FALSE) = FALSE');
    conditions.push('COALESCE(r.is_protected, FALSE) = FALSE');

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const { rows } = await pool.query(
      `SELECT r.*,
        (SELECT COUNT(*) FROM hr_users WHERE role_id = r.id) AS user_count,
        (SELECT COUNT(*) FROM role_permission_grants WHERE role_id = r.id) AS permission_count
       FROM roles r
       ${where}
       ORDER BY r.id`,
      params
    );
    res.json(rows.map((r: any) => ({
      ...r,
      user_count: parseInt(r.user_count),
      permission_count: parseInt(r.permission_count),
    })));
  } catch (err: any) {
    console.error('Error fetching roles:', err);
    res.status(500).json({ error: err.message });
  }
});

// Guard: can the caller read/write this role id?
async function loadRoleForScope(roleId: number) {
  const { rows } = await pool.query(
    'SELECT id, name, is_system, is_protected, is_hidden, protected_reason, is_template, branch_id FROM roles WHERE id = $1',
    [roleId]
  );
  return rows[0] ?? null;
}
function canWriteRole(context: { isSuperAdmin: boolean; actingBranchId: number | null }, role: any): boolean {
  if (!context || !role) return false;
  if (context.isSuperAdmin) return true;
  if (role.is_template) return false; // branch admins cannot touch templates
  return role.branch_id === context.actingBranchId;
}

// ── GET /roles/:id — Role detail with permissions ───────────────────────────
router.get('/roles/:id', requirePermission('admin.roles.view'), async (req, res) => {
  try {
    const authContext = req.authContext!;
    const role = await loadRoleForScope(Number(req.params.id));
    if (!role) return res.status(404).json({ error: 'الدور غير موجود' });
    // Read permission: branch admin cannot view templates or other branches.
    if (!authContext.isSuperAdmin && (role.is_template || role.branch_id !== authContext.actingBranchId)) {
      return res.status(403).json({ error: 'غير مسموح' });
    }
    const { rows: roleRows } = await pool.query('SELECT * FROM roles WHERE id = $1', [req.params.id]);

    const { rows: permRows } = await pool.query(
      `SELECT p.*, rpg.scope_type
       FROM role_permission_grants rpg
       JOIN permissions p ON p.id = rpg.permission_id
       WHERE rpg.role_id = $1
       ORDER BY p.display_order`,
      [req.params.id]
    );

    res.json({ ...roleRows[0], permissions: permRows.map(row => ({ ...row, scopeType: row.scope_type })) });
  } catch (err: any) {
    console.error('Error fetching role detail:', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/roles/:id/permissions', requirePermission('admin.roles.view'), async (req, res) => {
  try {
    const authContext = req.authContext!;
    const role = await loadRoleForScope(Number(req.params.id));
    if (!role) return res.status(404).json({ error: 'الدور غير موجود' });
    if (!authContext.isSuperAdmin && (role.is_template || role.branch_id !== authContext.actingBranchId)) {
      return res.status(403).json({ error: 'غير مسموح' });
    }

    const { rows } = await pool.query(
      `SELECT p.*, rpg.scope_type
       FROM role_permission_grants rpg
       JOIN permissions p ON p.id = rpg.permission_id
       WHERE rpg.role_id = $1
       ORDER BY p.display_order`,
      [req.params.id]
    );

    res.json(rows.map(row => ({ ...row, scopeType: row.scope_type })));
  } catch (err: any) {
    console.error('Error fetching role permissions:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /roles — Create role ───────────────────────────────────────────────
// New product-managed roles are always templates. Branch access belongs to
// user_branch_assignments, not role rows.
router.post('/roles', requirePermission('admin.roles.manage'), async (req, res) => {
  try {
    const { name, displayName, description } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'اسم الدور مطلوب' });
    if (!displayName?.trim()) return res.status(400).json({ error: 'الاسم المعروض مطلوب' });

    const { rows } = await pool.query(
      `INSERT INTO roles (name, display_name, description, branch_id, is_template, template_id)
       VALUES ($1, $2, $3, NULL, TRUE, NULL)
       RETURNING *`,
      [name.trim(), displayName.trim(), description || null]
    );
    res.status(201).json(rows[0]);
  } catch (err: any) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'يوجد دور بنفس الاسم بالفعل في هذا الفرع' });
    }
    console.error('Error creating role:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /roles/:id — Update role ────────────────────────────────────────────
router.put('/roles/:id', requirePermission('admin.roles.manage'), async (req, res) => {
  try {
    const authContext = req.authContext!;
    const roleId = req.params.id;
    const role = await loadRoleForScope(Number(roleId));
    if (!role) return res.status(404).json({ error: 'الدور غير موجود' });
    if (role.is_system || role.is_protected) {
      const reason = (role.protected_reason as string | null) ?? '';
      return res.status(400).json({
        error: reason
          ? `?? ???? ????? ??? ????? � ${reason}`
          : '?? ???? ????? ??? ????? � ??? ????? ?? ????',
      });
    }
    if (!canWriteRole(authContext, role)) {
      return res.status(403).json({ error: 'غير مسموح بتعديل هذا الدور' });
    }

    const { displayName, description, isActive } = req.body;
    const { rows } = await pool.query(
      `UPDATE roles SET
        display_name = COALESCE($1, display_name),
        description = COALESCE($2, description),
        is_active = COALESCE($3, is_active),
        updated_at = NOW()
       WHERE id = $4
       RETURNING *`,
      [displayName || null, description !== undefined ? description : null, isActive !== undefined ? isActive : null, roleId]
    );
    res.json(rows[0]);
  } catch (err: any) {
    console.error('Error updating role:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /roles/:id — Delete role ─────────────────────────────────────────
router.delete('/roles/:id', requirePermission('admin.roles.manage'), async (req, res) => {
  try {
    const authContext = req.authContext!;
    const roleId = req.params.id;
    const role = await loadRoleForScope(Number(roleId));
    if (!role) return res.status(404).json({ error: 'الدور غير موجود' });
    // Guard: system or explicitly protected roles cannot be deleted
    if (role.is_system || role.is_protected) {
      const reason = (role.protected_reason as string | null) ?? '';
      return res.status(400).json({
        error: reason
          ? `?? ???? ??? ??? ????? � ${reason}`
          : '?? ???? ??? ??? ????? � ??? ????? ?? ????',
      });
    }
    if (!canWriteRole(authContext, role)) {
      return res.status(403).json({ error: 'غير مسموح بحذف هذا الدور' });
    }

    const { rows: userCount } = await pool.query('SELECT COUNT(*) FROM hr_users WHERE role_id = $1', [roleId]);
    if (parseInt(userCount[0].count) > 0) {
      return res.status(400).json({ error: 'لا يمكن حذف دور مرتبط بمستخدمين' });
    }

    await pool.query('DELETE FROM roles WHERE id = $1', [roleId]);
    res.json({ message: 'تم حذف الدور بنجاح' });
  } catch (err: any) {
    console.error('Error deleting role:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /roles/:id/permissions — Assign permissions to role ─────────────────
router.put('/roles/:id/permissions', requirePermission('admin.roles.manage'), async (req, res) => {
  const client = await pool.connect();
  try {
    const authContext = req.authContext!;
    const { permissionIds, grants } = req.body;
    const roleId = req.params.id;

    const normalizedGrants = Array.isArray(grants)
      ? grants.map((grant: any) => ({
          permissionId: Number(grant.permissionId),
          scopeType: String(grant.scopeType ?? ''),
        }))
      : Array.isArray(permissionIds)
        ? permissionIds.map((permissionId: unknown) => ({
            permissionId: Number(permissionId),
            scopeType: 'BRANCH',
          }))
        : null;

    if (!normalizedGrants) {
      return res.status(400).json({ error: 'قائمة الصلاحيات مطلوبة' });
    }
    if (normalizedGrants.some(grant => !Number.isInteger(grant.permissionId) || !VALID_SCOPE_TYPES.has(grant.scopeType))) {
      return res.status(400).json({ error: 'صلاحيات أو نطاقات غير صالحة' });
    }

    const role = await loadRoleForScope(Number(roleId));
    if (!role) return res.status(404).json({ error: 'الدور غير موجود' });
    if (role.is_system || role.is_protected) {
      const reason = (role.protected_reason as string | null) ?? '';
      return res.status(400).json({
        error: reason
          ? `?? ???? ????? ??????? ??? ????? � ${reason}`
          : '?? ???? ????? ??????? ??? ????? � ??? ????? ?? ????',
      });
    }
    if (!canWriteRole(authContext, role)) {
      return res.status(403).json({ error: 'غير مسموح بتعديل صلاحيات هذا الدور' });
    }

    await client.query('BEGIN');
    await client.query('DELETE FROM role_permission_grants WHERE role_id = $1', [roleId]);
    await client.query('DELETE FROM role_permissions WHERE role_id = $1', [roleId]);
    if (normalizedGrants.length > 0) {
      const grantValues = normalizedGrants
        .map((_, i) => `($1, $${i * 2 + 2}, $${i * 2 + 3})`)
        .join(', ');
      await client.query(
        `INSERT INTO role_permission_grants (role_id, permission_id, scope_type) VALUES ${grantValues}`,
        [roleId, ...normalizedGrants.flatMap(grant => [grant.permissionId, grant.scopeType])]
      );

      const legacyValues = normalizedGrants.map((_, i) => `($1, $${i + 2})`).join(', ');
      await client.query(
        `INSERT INTO role_permissions (role_id, permission_id) VALUES ${legacyValues}
         ON CONFLICT (role_id, permission_id) DO NOTHING`,
        [roleId, ...normalizedGrants.map(grant => grant.permissionId)]
      );
    }
    await client.query('COMMIT');

    clearPermissionCache();

    const { rows: permRows } = await pool.query(
      `SELECT p.*, rpg.scope_type
       FROM role_permission_grants rpg
       JOIN permissions p ON p.id = rpg.permission_id
       WHERE rpg.role_id = $1
       ORDER BY p.display_order`,
      [roleId]
    );
    res.json(permRows.map(row => ({ ...row, scopeType: row.scope_type })));
  } catch (err: any) {
    await client.query('ROLLBACK');
    console.error('Error assigning permissions:', err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ── POST /role-templates/:id/propagate ──────────────────────────────────────
// Deprecated: roles are centrally managed and no longer propagated to branch clones.
router.post('/role-templates/:id/propagate', requireSuperAdmin, async (req, res) => {
  void req;
  return res.status(410).json({
    error: '?? ????? ??????? ??????? ??? ??????. ??????? ????? ???????? ??????? ????? ?????????? ?? ???????.',
  });
});

// ── GET /permissions — List all permissions (global catalog) ────────────────
router.get('/permissions', requirePermission('admin.roles.view'), async (_req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM permissions ORDER BY display_order');
    res.json(rows);
  } catch (err: any) {
    console.error('Error fetching permissions:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /hr-users/assignable — Users eligible to be assigned to clients ──────
// Returns active HR users whose role has the 'clients.can_be_assigned' grant.
// Branch-scoped: non-super-admins see only users from their own branch.
// Requires clients.view_list so any user who can see clients can fetch this list.
router.get('/hr-users/assignable', requirePermission('clients.view_list'), async (req, res) => {
  try {
    const authContext = req.authContext!;
    const conditions: string[] = [
      `u.is_active = TRUE`,
      `u.role_id IN (
        SELECT rpg.role_id
          FROM role_permission_grants rpg
          JOIN permissions p ON p.id = rpg.permission_id
         WHERE p.key = 'clients.can_be_assigned'
      )`,
    ];
    const params: any[] = [];

    if (!authContext.isSuperAdmin) {
      // Non-super-admins see only users in their own branch
      const branchId = authContext.actingBranchId ?? authContext.allowedBranchIds[0] ?? null;
      if (branchId == null) {
        return res.json([]); // no branch context → empty list
      }
      params.push(branchId);
      conditions.push(`u.branch_id = $${params.length}`);
    }

    const where = `WHERE ${conditions.join(' AND ')}`;
    const { rows } = await pool.query(
      `SELECT u.id, u.name, u.branch_id,
              r.display_name AS role_display_name
         FROM hr_users u
         LEFT JOIN roles r ON r.id = u.role_id
         ${where}
         ORDER BY u.name`,
      params,
    );
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /hr-users — List HR users ───────────────────────────────────────────
// Branch admin sees users of their branch; super admin sees all.
router.get('/hr-users', requirePermission('admin.roles.view'), async (req, res) => {
  try {
    const authContext = req.authContext!;
    const conditions: string[] = [];
    const params: any[] = [];
    if (!authContext.isSuperAdmin) {
      if (authContext.actingBranchId == null) {
        return res.status(403).json({ error: 'الحساب غير مرتبط بأي فرع' });
      }
      params.push(authContext.actingBranchId);
      conditions.push(`u.branch_id = $${params.length}`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const { rows } = await pool.query(
      `SELECT u.id, u.name, u.username, u.is_active, u.created_at, u.role_id,
        u.branch_id, u.is_super_admin,
        r.display_name AS role_display_name
       FROM hr_users u
       LEFT JOIN roles r ON r.id = u.role_id
       ${where}
       ORDER BY u.id`,
      params
    );
    res.json(rows);
  } catch (err: any) {
    console.error('Error fetching HR users:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /hr-users — Create HR user ────────────────────────────────────────
// Branch admin: new user is always scoped to the admin's branch.
// Super admin: must specify a target branchId (or omit to mint another super admin).
router.post('/hr-users', requirePermission('admin.roles.manage'), async (req, res) => {
  try {
    const authContext = req.authContext!;
    const { name, username, password, roleId, branchId, isSuperAdmin } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'اسم المستخدم مطلوب' });
    if (!username?.trim()) return res.status(400).json({ error: 'اسم الدخول مطلوب' });
    if (!password?.trim()) return res.status(400).json({ error: 'كلمة المرور مطلوبة' });

    let targetBranchId: number | null;
    let makeSuper = false;
    if (authContext.isSuperAdmin) {
      if (isSuperAdmin === true) {
        makeSuper = true;
        targetBranchId = null;
      } else {
        if (!branchId) return res.status(400).json({ error: 'يجب تحديد الفرع للمستخدم' });
        targetBranchId = Number(branchId);
      }
    } else {
      if (isSuperAdmin === true) {
        return res.status(403).json({ error: 'إنشاء سوبر أدمن متاح للإدارة العامة فقط' });
      }
      if (authContext.actingBranchId == null) {
        return res.status(403).json({ error: 'الحساب غير مرتبط بأي فرع' });
      }
      targetBranchId = authContext.actingBranchId;
    }

    if (!roleId && !makeSuper) return res.status(400).json({ error: 'الدور مطلوب' });

    let roleName: string | null = null;
    if (roleId) {
      const roleCheck = await validateTemplateRoleAssignment(Number(roleId));
      if (roleCheck.ok === false) {
        return res.status(400).json({
          error: roleCheck.reason === 'NOT_FOUND' ? '????? ??? ?????' : TEMPLATE_ROLE_ASSIGNMENT_ERROR,
        });
      }
      roleName = roleCheck.role.name;
    } else if (makeSuper) {
      roleName = 'ADMIN';
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const { rows } = await pool.query(
      `INSERT INTO hr_users (name, username, password_hash, role, role_id, branch_id, is_super_admin)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, name, username, is_active, created_at, role_id, branch_id, is_super_admin`,
      [name.trim(), username.trim(), passwordHash, roleName, roleId || null, targetBranchId, makeSuper]
    );
    res.status(201).json(rows[0]);
  } catch (err: any) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'اسم الدخول مستخدم بالفعل' });
    }
    console.error('Error creating HR user:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /hr-users/:id — Update HR user ──────────────────────────────────────
router.put('/hr-users/:id', requirePermission('admin.roles.manage'), async (req, res) => {
  try {
    const authContext = req.authContext!;
    const userIdParam = (Array.isArray(req.params.id) ? req.params.id[0] : req.params.id)!;
    const userId = parseInt(userIdParam);
    const { name, username, password, roleId, isActive } = req.body;

    const { rows: current } = await pool.query('SELECT * FROM hr_users WHERE id = $1', [userId]);
    if (current.length === 0) return res.status(404).json({ error: 'المستخدم غير موجود' });

    // Branch admin cannot edit users outside their branch and cannot edit super admins.
    if (!authContext.isSuperAdmin) {
      if (current[0].is_super_admin) return res.status(403).json({ error: 'غير مسموح' });
      if (current[0].branch_id !== authContext.actingBranchId) return res.status(403).json({ error: 'غير مسموح' });
    }

    const updates: string[] = [];
    const params: any[] = [];
    let idx = 1;

    if (name !== undefined) { updates.push(`name = $${idx++}`); params.push(name.trim()); }
    if (username !== undefined) { updates.push(`username = $${idx++}`); params.push(username.trim()); }
    if (password) {
      const passwordHash = await bcrypt.hash(password, 10);
      updates.push(`password_hash = $${idx++}`);
      params.push(passwordHash);
    }
    if (roleId !== undefined) {
      const roleCheck = await validateTemplateRoleAssignment(Number(roleId));
      if (roleCheck.ok === false) {
        return res.status(400).json({
          error: roleCheck.reason === 'NOT_FOUND' ? '????? ??? ?????' : TEMPLATE_ROLE_ASSIGNMENT_ERROR,
        });
      }
      updates.push(`role_id = $${idx++}`);
      params.push(roleId);
      updates.push(`role = $${idx++}`);
      params.push(roleCheck.role.name);
    }
    if (isActive !== undefined) { updates.push(`is_active = $${idx++}`); params.push(isActive); }

    if (updates.length === 0) return res.status(400).json({ error: 'لا توجد بيانات للتحديث' });

    params.push(userId);
    const { rows } = await pool.query(
      `UPDATE hr_users SET ${updates.join(', ')} WHERE id = $${idx}
       RETURNING id, name, username, is_active, created_at, role_id, branch_id, is_super_admin`,
      params
    );

    if (roleId !== undefined) {
      clearPermissionCache(userId);
    }

    res.json(rows[0]);
  } catch (err: any) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'اسم الدخول مستخدم بالفعل' });
    }
    console.error('Error updating HR user:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;



