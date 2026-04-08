import { Router } from 'express';
import bcrypt from 'bcryptjs';
import pool from '../db.js';
import { requirePermission, clearPermissionCache } from '../middleware/permission.js';

const router = Router();

// ── GET /roles — List all roles ─────────────────────────────────────────────
router.get('/roles', requirePermission('admin.roles.view'), async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT r.*,
        (SELECT COUNT(*) FROM hr_users WHERE role_id = r.id) AS user_count,
        (SELECT COUNT(*) FROM role_permissions WHERE role_id = r.id) AS permission_count
       FROM roles r ORDER BY r.id`
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

// ── GET /roles/:id — Role detail with permissions ───────────────────────────
router.get('/roles/:id', requirePermission('admin.roles.view'), async (req, res) => {
  try {
    const { rows: roleRows } = await pool.query('SELECT * FROM roles WHERE id = $1', [req.params.id]);
    if (roleRows.length === 0) return res.status(404).json({ error: 'الدور غير موجود' });

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

// ── POST /roles — Create role ───────────────────────────────────────────────
router.get('/roles/:id/permissions', requirePermission('admin.roles.view'), async (req, res) => {
  try {
    const roleId = req.params.id;
    const { rows: roleRows } = await pool.query('SELECT id FROM roles WHERE id = $1', [roleId]);
    if (roleRows.length === 0) return res.status(404).json({ error: 'Ø§Ù„Ø¯ÙˆØ± ØºÙŠØ± Ù…ÙˆØ¬ÙˆØ¯' });

    const { rows } = await pool.query(
      `SELECT p.* FROM role_permissions rp
       JOIN permissions p ON p.id = rp.permission_id
       WHERE rp.role_id = $1
       ORDER BY p.display_order`,
      [roleId]
    );

    res.json(rows);
  } catch (err: any) {
    console.error('Error fetching role permissions:', err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/roles', requirePermission('admin.roles.manage'), async (req, res) => {
  try {
    const { name, displayName, description } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'اسم الدور مطلوب' });
    if (!displayName?.trim()) return res.status(400).json({ error: 'الاسم المعروض مطلوب' });

    const { rows } = await pool.query(
      `INSERT INTO roles (name, display_name, description)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [name.trim(), displayName.trim(), description || null]
    );
    res.status(201).json(rows[0]);
  } catch (err: any) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'يوجد دور بنفس الاسم بالفعل' });
    }
    console.error('Error creating role:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /roles/:id — Update role ────────────────────────────────────────────
router.put('/roles/:id', requirePermission('admin.roles.manage'), async (req, res) => {
  try {
    const { displayName, description, isActive } = req.body;
    const roleId = req.params.id;

    const { rows: current } = await pool.query('SELECT * FROM roles WHERE id = $1', [roleId]);
    if (current.length === 0) return res.status(404).json({ error: 'الدور غير موجود' });

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
    const roleId = req.params.id;

    const { rows: roleRows } = await pool.query('SELECT * FROM roles WHERE id = $1', [roleId]);
    if (roleRows.length === 0) return res.status(404).json({ error: 'الدور غير موجود' });
    if (roleRows[0].is_system) return res.status(400).json({ error: 'لا يمكن حذف دور نظامي' });

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
    const { permissionIds } = req.body;
    const roleId = req.params.id;

    if (!Array.isArray(permissionIds)) {
      return res.status(400).json({ error: 'قائمة الصلاحيات مطلوبة' });
    }

    const { rows: roleRows } = await client.query('SELECT id FROM roles WHERE id = $1', [roleId]);
    if (roleRows.length === 0) return res.status(404).json({ error: 'الدور غير موجود' });

    await client.query('BEGIN');

    // Delete all existing permissions for this role
    await client.query('DELETE FROM role_permissions WHERE role_id = $1', [roleId]);

    // Insert new permissions
    if (permissionIds.length > 0) {
      const values = permissionIds.map((_: number, i: number) => `($1, $${i + 2})`).join(', ');
      await client.query(
        `INSERT INTO role_permissions (role_id, permission_id) VALUES ${values}`,
        [roleId, ...permissionIds]
      );
    }

    await client.query('COMMIT');

    // Invalidate permission cache for all users
    clearPermissionCache();

    // Return updated permissions list
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

// ── GET /permissions — List all permissions ─────────────────────────────────
router.get('/permissions', requirePermission('admin.roles.view'), async (_req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM permissions ORDER BY display_order');
    res.json(rows);
  } catch (err: any) {
    console.error('Error fetching permissions:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /hr-users — List HR users (for role assignment) ─────────────────────
router.get('/hr-users', requirePermission('admin.roles.view'), async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT u.id, u.name, u.username, u.is_active, u.created_at, u.role_id,
        r.display_name AS role_display_name
       FROM hr_users u
       LEFT JOIN roles r ON r.id = u.role_id
       ORDER BY u.id`
    );
    res.json(rows);
  } catch (err: any) {
    console.error('Error fetching HR users:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /hr-users — Create HR user ────────────────────────────────────────
router.post('/hr-users', requirePermission('admin.roles.manage'), async (req, res) => {
  try {
    const { name, username, password, roleId } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'اسم المستخدم مطلوب' });
    if (!username?.trim()) return res.status(400).json({ error: 'اسم الدخول مطلوب' });
    if (!password?.trim()) return res.status(400).json({ error: 'كلمة المرور مطلوبة' });
    if (!roleId) return res.status(400).json({ error: 'الدور مطلوب' });

    // Get role name for backward compatibility
    const { rows: roleRows } = await pool.query('SELECT name FROM roles WHERE id = $1', [roleId]);
    if (roleRows.length === 0) return res.status(400).json({ error: 'الدور غير موجود' });

    const passwordHash = await bcrypt.hash(password, 10);

    const { rows } = await pool.query(
      `INSERT INTO hr_users (name, username, password_hash, role, role_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, username, is_active, created_at, role_id`,
      [name.trim(), username.trim(), passwordHash, roleRows[0].name, roleId]
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
    const userIdParam = (Array.isArray(req.params.id) ? req.params.id[0] : req.params.id)!;
    const userId = parseInt(userIdParam);
    const { name, username, password, roleId, isActive } = req.body;

    const { rows: current } = await pool.query('SELECT * FROM hr_users WHERE id = $1', [userId]);
    if (current.length === 0) return res.status(404).json({ error: 'المستخدم غير موجود' });

    // Build dynamic update
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
      // Get role name for backward compatibility
      const { rows: roleRows } = await pool.query('SELECT name FROM roles WHERE id = $1', [roleId]);
      if (roleRows.length === 0) return res.status(400).json({ error: 'الدور غير موجود' });
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
       RETURNING id, name, username, is_active, created_at, role_id`,
      params
    );

    // Clear permission cache if role changed
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
