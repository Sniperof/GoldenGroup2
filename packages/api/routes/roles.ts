import { Router } from 'express';
import bcrypt from 'bcryptjs';
import pool from '../db.js';
import { requirePermission, requireSuperAdmin, clearPermissionCache } from '../middleware/permission.js';

const router = Router();

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
//   templates=true   → list template rows (super admin only).
//   branchId=NN      → super admin filter on a specific branch's clones.
// Default behaviour for branch admin: only their own branch's clones.
router.get('/roles', requirePermission('admin.roles.view'), async (req, res) => {
  try {
    const scope = req.scope!;
    const wantTemplates = req.query.templates === 'true';
    const filterBranchId = req.query.branchId ? Number(req.query.branchId) : null;

    const conditions: string[] = [];
    const params: any[] = [];

    if (wantTemplates) {
      if (!scope.isSuperAdmin) {
        return res.status(403).json({ error: 'قوالب الأدوار متاحة للإدارة العامة فقط' });
      }
      conditions.push('r.is_template = TRUE');
    } else if (scope.isSuperAdmin) {
      conditions.push('r.is_template = FALSE');
      if (filterBranchId != null) {
        params.push(filterBranchId);
        conditions.push(`r.branch_id = $${params.length}`);
      }
    } else {
      // Branch admin: only their own branch's clones
      if (scope.branchId == null) {
        return res.status(403).json({ error: 'الحساب غير مرتبط بأي فرع' });
      }
      params.push(scope.branchId);
      conditions.push('r.is_template = FALSE');
      conditions.push(`r.branch_id = $${params.length}`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const { rows } = await pool.query(
      `SELECT r.*,
        (SELECT COUNT(*) FROM hr_users WHERE role_id = r.id) AS user_count,
        (SELECT COUNT(*) FROM role_permissions WHERE role_id = r.id) AS permission_count
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
    'SELECT id, name, is_system, is_template, branch_id FROM roles WHERE id = $1',
    [roleId]
  );
  return rows[0] ?? null;
}
function canWriteRole(scope: Express.Request['scope'], role: any): boolean {
  if (!scope || !role) return false;
  if (scope.isSuperAdmin) return true;
  if (role.is_template) return false; // branch admins cannot touch templates
  return role.branch_id === scope.branchId;
}

// ── GET /roles/:id — Role detail with permissions ───────────────────────────
router.get('/roles/:id', requirePermission('admin.roles.view'), async (req, res) => {
  try {
    const scope = req.scope!;
    const role = await loadRoleForScope(Number(req.params.id));
    if (!role) return res.status(404).json({ error: 'الدور غير موجود' });
    // Read permission: branch admin cannot view templates or other branches.
    if (!scope.isSuperAdmin && (role.is_template || role.branch_id !== scope.branchId)) {
      return res.status(403).json({ error: 'غير مسموح' });
    }
    const { rows: roleRows } = await pool.query('SELECT * FROM roles WHERE id = $1', [req.params.id]);

    const { rows: permRows } = await pool.query(
      `SELECT p.* FROM role_permissions rp
       JOIN permissions p ON p.id = rp.permission_id
       WHERE rp.role_id = $1
       ORDER BY p.display_order`,
      [req.params.id]
    );

    res.json({ ...roleRows[0], permissions: permRows });
  } catch (err: any) {
    console.error('Error fetching role detail:', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/roles/:id/permissions', requirePermission('admin.roles.view'), async (req, res) => {
  try {
    const scope = req.scope!;
    const role = await loadRoleForScope(Number(req.params.id));
    if (!role) return res.status(404).json({ error: 'الدور غير موجود' });
    if (!scope.isSuperAdmin && (role.is_template || role.branch_id !== scope.branchId)) {
      return res.status(403).json({ error: 'غير مسموح' });
    }

    const { rows } = await pool.query(
      `SELECT p.* FROM role_permissions rp
       JOIN permissions p ON p.id = rp.permission_id
       WHERE rp.role_id = $1
       ORDER BY p.display_order`,
      [req.params.id]
    );

    res.json(rows);
  } catch (err: any) {
    console.error('Error fetching role permissions:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /roles — Create role ───────────────────────────────────────────────
// - Branch admin → creates a branch clone scoped to their branch.
// - Super admin  → can pass `isTemplate:true` (template, branch_id NULL)
//                  or `branchId` to target a specific branch's clone.
router.post('/roles', requirePermission('admin.roles.manage'), async (req, res) => {
  try {
    const scope = req.scope!;
    const { name, displayName, description, isTemplate, branchId } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'اسم الدور مطلوب' });
    if (!displayName?.trim()) return res.status(400).json({ error: 'الاسم المعروض مطلوب' });

    let targetBranchId: number | null;
    let createAsTemplate = false;
    if (scope.isSuperAdmin) {
      if (isTemplate === true) {
        createAsTemplate = true;
        targetBranchId = null;
      } else {
        if (!branchId) return res.status(400).json({ error: 'يجب تحديد الفرع المستهدف للدور' });
        targetBranchId = Number(branchId);
      }
    } else {
      if (isTemplate === true) {
        return res.status(403).json({ error: 'قوالب الأدوار متاحة للإدارة العامة فقط' });
      }
      if (scope.branchId == null) {
        return res.status(403).json({ error: 'الحساب غير مرتبط بأي فرع' });
      }
      targetBranchId = scope.branchId;
    }

    const { rows } = await pool.query(
      `INSERT INTO roles (name, display_name, description, branch_id, is_template)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [name.trim(), displayName.trim(), description || null, targetBranchId, createAsTemplate]
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
    const scope = req.scope!;
    const roleId = req.params.id;
    const role = await loadRoleForScope(Number(roleId));
    if (!role) return res.status(404).json({ error: 'الدور غير موجود' });
    if (!canWriteRole(scope, role)) {
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
    const scope = req.scope!;
    const roleId = req.params.id;
    const role = await loadRoleForScope(Number(roleId));
    if (!role) return res.status(404).json({ error: 'الدور غير موجود' });
    if (role.is_system) return res.status(400).json({ error: 'لا يمكن حذف دور نظامي' });
    if (!canWriteRole(scope, role)) {
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
    const scope = req.scope!;
    const { permissionIds } = req.body;
    const roleId = req.params.id;

    if (!Array.isArray(permissionIds)) {
      return res.status(400).json({ error: 'قائمة الصلاحيات مطلوبة' });
    }

    const role = await loadRoleForScope(Number(roleId));
    if (!role) return res.status(404).json({ error: 'الدور غير موجود' });
    if (!canWriteRole(scope, role)) {
      return res.status(403).json({ error: 'غير مسموح بتعديل صلاحيات هذا الدور' });
    }

    await client.query('BEGIN');
    await client.query('DELETE FROM role_permissions WHERE role_id = $1', [roleId]);
    if (permissionIds.length > 0) {
      const values = permissionIds.map((_: number, i: number) => `($1, $${i + 2})`).join(', ');
      await client.query(
        `INSERT INTO role_permissions (role_id, permission_id) VALUES ${values}`,
        [roleId, ...permissionIds]
      );
    }
    await client.query('COMMIT');

    clearPermissionCache();

    const { rows: permRows } = await pool.query(
      `SELECT p.* FROM role_permissions rp
       JOIN permissions p ON p.id = rp.permission_id
       WHERE rp.role_id = $1
       ORDER BY p.display_order`,
      [roleId]
    );
    res.json(permRows);
  } catch (err: any) {
    await client.query('ROLLBACK');
    console.error('Error assigning permissions:', err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ── POST /role-templates/:id/propagate ──────────────────────────────────────
// Super-admin pushes a template's permission set to all of its clones.
// Body: { branchIds?: number[] }  // if omitted, propagate to all branches.
router.post('/role-templates/:id/propagate', requireSuperAdmin, async (req, res) => {
  const client = await pool.connect();
  try {
    const templateId = Number(req.params.id);
    const { branchIds } = req.body as { branchIds?: number[] };

    const { rows: tRows } = await client.query(
      'SELECT id, is_template FROM roles WHERE id = $1',
      [templateId]
    );
    if (tRows.length === 0 || !tRows[0].is_template) {
      return res.status(404).json({ error: 'القالب غير موجود' });
    }

    await client.query('BEGIN');
    const targetFilter = branchIds && branchIds.length > 0
      ? `AND branch_id = ANY($2::int[])`
      : '';
    const params: any[] = [templateId];
    if (branchIds && branchIds.length > 0) params.push(branchIds);

    // For each clone of this template, replace its permissions with the
    // template's current permission set.
    const { rows: clones } = await client.query(
      `SELECT id FROM roles WHERE template_id = $1 AND is_template = FALSE ${targetFilter}`,
      params
    );

    for (const c of clones) {
      await client.query('DELETE FROM role_permissions WHERE role_id = $1', [c.id]);
      await client.query(
        `INSERT INTO role_permissions (role_id, permission_id)
         SELECT $1, permission_id FROM role_permissions WHERE role_id = $2`,
        [c.id, templateId]
      );
    }
    await client.query('COMMIT');
    clearPermissionCache();
    res.json({ propagated: clones.length });
  } catch (err: any) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Error propagating template:', err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
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

// ── GET /hr-users — List HR users ───────────────────────────────────────────
// Branch admin sees users of their branch; super admin sees all.
router.get('/hr-users', requirePermission('admin.roles.view'), async (req, res) => {
  try {
    const scope = req.scope!;
    const conditions: string[] = [];
    const params: any[] = [];
    if (!scope.isSuperAdmin) {
      if (scope.branchId == null) {
        return res.status(403).json({ error: 'الحساب غير مرتبط بأي فرع' });
      }
      params.push(scope.branchId);
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
    const scope = req.scope!;
    const { name, username, password, roleId, branchId, isSuperAdmin } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'اسم المستخدم مطلوب' });
    if (!username?.trim()) return res.status(400).json({ error: 'اسم الدخول مطلوب' });
    if (!password?.trim()) return res.status(400).json({ error: 'كلمة المرور مطلوبة' });

    let targetBranchId: number | null;
    let makeSuper = false;
    if (scope.isSuperAdmin) {
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
      if (scope.branchId == null) {
        return res.status(403).json({ error: 'الحساب غير مرتبط بأي فرع' });
      }
      targetBranchId = scope.branchId;
    }

    if (!roleId && !makeSuper) return res.status(400).json({ error: 'الدور مطلوب' });

    let roleName: string | null = null;
    if (roleId) {
      const { rows: roleRows } = await pool.query('SELECT name, branch_id, is_template FROM roles WHERE id = $1', [roleId]);
      if (roleRows.length === 0) return res.status(400).json({ error: 'الدور غير موجود' });
      // Ensure role belongs to target branch (and is not a template).
      if (roleRows[0].is_template || roleRows[0].branch_id !== targetBranchId) {
        return res.status(400).json({ error: 'الدور لا ينتمي للفرع المحدد' });
      }
      roleName = roleRows[0].name;
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
    const scope = req.scope!;
    const userIdParam = (Array.isArray(req.params.id) ? req.params.id[0] : req.params.id)!;
    const userId = parseInt(userIdParam);
    const { name, username, password, roleId, isActive } = req.body;

    const { rows: current } = await pool.query('SELECT * FROM hr_users WHERE id = $1', [userId]);
    if (current.length === 0) return res.status(404).json({ error: 'المستخدم غير موجود' });

    // Branch admin cannot edit users outside their branch and cannot edit super admins.
    if (!scope.isSuperAdmin) {
      if (current[0].is_super_admin) return res.status(403).json({ error: 'غير مسموح' });
      if (current[0].branch_id !== scope.branchId) return res.status(403).json({ error: 'غير مسموح' });
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
      const { rows: roleRows } = await pool.query('SELECT name, branch_id, is_template FROM roles WHERE id = $1', [roleId]);
      if (roleRows.length === 0) return res.status(400).json({ error: 'الدور غير موجود' });
      if (roleRows[0].is_template || roleRows[0].branch_id !== current[0].branch_id) {
        return res.status(400).json({ error: 'الدور لا ينتمي لفرع المستخدم' });
      }
      updates.push(`role_id = $${idx++}`);
      params.push(roleId);
      updates.push(`role = $${idx++}`);
      params.push(roleRows[0].name);
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
