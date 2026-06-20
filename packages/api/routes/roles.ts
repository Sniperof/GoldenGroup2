import { Router, type Response } from 'express';
import bcrypt from 'bcryptjs';
import pool from '../db.js';
import { requirePermission, requireSuperAdmin, clearPermissionCache } from '../middleware/permission.js';
import { TEMPLATE_ROLE_ASSIGNMENT_ERROR, validateTemplateRoleAssignment, assertRoleWithinActorScope, ROLE_ESCALATION_ERROR } from '../services/roleAssignmentGuard.js';
import {
  listPermissionCatalog,
  listRolePermissionGrants,
  replaceRolePermissionGrants,
  RolePermissionServiceError,
  type RolePermissionGrantInput,
} from '../services/rolePermissionService.js';
import {
  createRole,
  deleteRole,
  updateRole,
  RoleManagementError,
} from '../services/roleManagementService.js';
import { authorize, resolveListAccessScope } from '../services/authorizationService.js';

const router = Router();
const VALID_SCOPE_TYPES = new Set(['GLOBAL', 'BRANCH', 'ASSIGNED']);

// Resolves which branch an "assignable users" lookup should filter by. The
// OPERATION branch (?branchId) drives it so a GLOBAL deputy sees the staff of
// the branch being operated on (like super-admin), while BRANCH actors stay
// confined to their assigned branches. Returns a branch id, null (no filter =
// all, for GLOBAL/super without a requested branch), or 'DENY' (out of scope).
function resolveAssignableBranchFilter(
  authContext: any,
  req: any,
  globalPermissions: string[],
): number | null | 'DENY' {
  const requested = Number(req.query.branchId);
  const hasRequested = Number.isInteger(requested) && requested > 0;
  const isGlobalAssigner = authContext.isSuperAdmin === true ||
    (authContext.grants ?? []).some((g: any) => globalPermissions.includes(g.permission) && g.scope === 'GLOBAL');
  if (isGlobalAssigner) {
    return hasRequested ? requested : null;
  }
  const branchId = hasRequested ? requested : (authContext.actingBranchId ?? authContext.allowedBranchIds[0] ?? null);
  if (branchId == null || !authContext.allowedBranchIds.includes(branchId)) return 'DENY';
  return branchId;
}
const VALID_TEAM_SLOT_TYPES = new Set(['SUPERVISOR', 'TECHNICIAN', 'TRAINEE', 'TELEMARKETER']);

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
/**
 * @swagger
 * /api/admin/roles:
 *   get:
 *     tags: [Admin → Roles & Permissions]
 *     summary: List role templates
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         schema:
 *           type: integer
 *         required: false
 *       - in: query
 *         name: includeLegacy
 *         schema:
 *           type: string
 *         required: false
 *     responses:
 *       200:
 *         description: Success
 */
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

function sendRolePermissionError(res: Response, error: unknown) {
  if (!(error instanceof RolePermissionServiceError)) {
    return false;
  }

  const status = error.code === 'ROLE_NOT_FOUND' ? 404 : 400;
  res.status(status).json({ error: error.message });
  return true;
}

function sendRoleManagementError(res: Response, error: unknown) {
  if (!(error instanceof RoleManagementError)) {
    return false;
  }

  const status = error.code === 'ROLE_NOT_FOUND'
    ? 404
    : error.code === 'ROLE_NAME_CONFLICT'
      ? 409
      : 400;
  res.status(status).json({ error: error.message });
  return true;
}

// ── GET /roles/:id — Role detail with permissions ───────────────────────────
/**
 * @swagger
 * /api/admin/roles/{id}:
 *   get:
 *     tags: [Admin → Roles & Permissions]
 *     summary: Get role details by ID
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         schema:
 *           type: integer
 *         required: false
 *       - in: path
 *         name: id
 *         schema:
 *           type: integer
 *         required: true
 *     responses:
 *       200:
 *         description: Success
 *       404:
 *         description: Not Found
 */
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

    const grants = await listRolePermissionGrants(Number(req.params.id));
    res.json({
      ...roleRows[0],
      permissions: grants.map(grant => ({ ...grant, scopeType: grant.scope_type })),
    });
  } catch (err: any) {
    console.error('Error fetching role detail:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/admin/roles/{id}/permissions:
 *   get:
 *     tags: [Admin → Roles & Permissions]
 *     summary: Get permissions granted to a role
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         schema:
 *           type: integer
 *         required: false
 *       - in: path
 *         name: id
 *         schema:
 *           type: integer
 *         required: true
 *     responses:
 *       200:
 *         description: Success
 */
router.get('/roles/:id/permissions', requirePermission('admin.roles.view'), async (req, res) => {
  try {
    const authContext = req.authContext!;
    const role = await loadRoleForScope(Number(req.params.id));
    if (!role) return res.status(404).json({ error: 'الدور غير موجود' });
    if (!authContext.isSuperAdmin && (role.is_template || role.branch_id !== authContext.actingBranchId)) {
      return res.status(403).json({ error: 'غير مسموح' });
    }

    const grants = await listRolePermissionGrants(Number(req.params.id));
    res.json(grants.map(grant => ({ ...grant, scopeType: grant.scope_type })));
  } catch (err: any) {
    if (sendRolePermissionError(res, err)) return;
    console.error('Error fetching role permissions:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /roles — Create role ───────────────────────────────────────────────
// New product-managed roles are always templates. Branch access belongs to
// user_branch_assignments, not role rows.
/**
 * @swagger
 * /api/admin/roles:
 *   post:
 *     tags: [Admin → Roles & Permissions]
 *     summary: Create a custom role template
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         schema:
 *           type: integer
 *         required: false
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, displayName]
 *             properties:
 *               name:
 *                 type: string
 *               displayName:
 *                 type: string
 *               description:
 *                 type: string
 *               teamSlotType:
 *                 type: string
 *                 enum: [SUPERVISOR, TECHNICIAN, TRAINEE, TELEMARKETER]
 *     responses:
 *       201:
 *         description: Created
 */
router.post('/roles', requirePermission('admin.roles.manage'), async (req, res) => {
  try {
    const createdRole = await createRole({
      name: req.body?.name,
      displayName: req.body?.displayName,
      description: req.body?.description,
      teamSlotType: req.body?.teamSlotType,
    });
    return res.status(201).json(createdRole);

    const { name, displayName, description, teamSlotType } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'اسم الدور مطلوب' });
    if (!displayName?.trim()) return res.status(400).json({ error: 'الاسم المعروض مطلوب' });

    if (teamSlotType !== undefined && teamSlotType !== null && !VALID_TEAM_SLOT_TYPES.has(teamSlotType)) {
      return res.status(400).json({ error: 'نوع خانة الفريق غير صالح' });
    }

    const { rows } = await pool.query(
      `INSERT INTO roles (name, display_name, description, branch_id, is_template, template_id, team_slot_type)
       VALUES ($1, $2, $3, NULL, TRUE, NULL, $4)
       RETURNING *`,
      [name.trim(), displayName.trim(), description || null, teamSlotType ?? null]
    );
    res.status(201).json(rows[0]);
  } catch (err: any) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'يوجد دور بنفس الاسم بالفعل في هذا الفرع' });
    }
    if (sendRoleManagementError(res, err)) return;
    console.error('Error creating role:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /roles/:id — Update role ────────────────────────────────────────────
/**
 * @swagger
 * /api/admin/roles/{id}:
 *   put:
 *     tags: [Admin → Roles & Permissions]
 *     summary: Update role details
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         schema:
 *           type: integer
 *         required: false
 *       - in: path
 *         name: id
 *         schema:
 *           type: integer
 *         required: true
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               displayName:
 *                 type: string
 *               description:
 *                 type: string
 *               isActive:
 *                 type: boolean
 *               teamSlotType:
 *                 type: string
 *                 enum: [SUPERVISOR, TECHNICIAN, TRAINEE, TELEMARKETER]
 *     responses:
 *       200:
 *         description: Success
 */
router.put('/roles/:id', requirePermission('admin.roles.manage'), async (req, res) => {
  try {
    const updatedRole = await updateRole(Number(req.params.id), {
      displayName: req.body?.displayName,
      description: req.body?.description,
      isActive: req.body?.isActive,
      teamSlotType: req.body?.teamSlotType,
    });
    return res.json(updatedRole);

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

    const { displayName, description, isActive, teamSlotType } = req.body;

    if (teamSlotType !== undefined && teamSlotType !== null && !VALID_TEAM_SLOT_TYPES.has(teamSlotType)) {
      return res.status(400).json({ error: 'نوع خانة الفريق غير صالح' });
    }

    const teamSlotTypeProvided = teamSlotType !== undefined;
    const { rows } = await pool.query(
      `UPDATE roles SET
        display_name = COALESCE($1, display_name),
        description = COALESCE($2, description),
        is_active = COALESCE($3, is_active),
        team_slot_type = CASE WHEN $4 THEN $5::text ELSE team_slot_type END,
        updated_at = NOW()
       WHERE id = $6
       RETURNING *`,
      [displayName || null, description !== undefined ? description : null, isActive !== undefined ? isActive : null, teamSlotTypeProvided, teamSlotType ?? null, roleId]
    );
    res.json(rows[0]);
  } catch (err: any) {
    if (sendRoleManagementError(res, err)) return;
    console.error('Error updating role:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /roles/:id — Delete role ─────────────────────────────────────────
/**
 * @swagger
 * /api/admin/roles/{id}:
 *   delete:
 *     tags: [Admin → Roles & Permissions]
 *     summary: Delete custom role template
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         schema:
 *           type: integer
 *         required: false
 *       - in: path
 *         name: id
 *         schema:
 *           type: integer
 *         required: true
 *     responses:
 *       200:
 *         description: Success
 */
router.delete('/roles/:id', requirePermission('admin.roles.manage'), async (req, res) => {
  try {
    await deleteRole(Number(req.params.id));
    return res.json({ message: 'تم حذف الدور بنجاح' });

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
/**
 * @swagger
 * /api/admin/roles/{id}/permissions:
 *   put:
 *     tags: [Admin → Roles & Permissions]
 *     summary: Update permissions granted to a role
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         schema:
 *           type: integer
 *         required: false
 *       - in: path
 *         name: id
 *         schema:
 *           type: integer
 *         required: true
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               permissionIds:
 *                 type: array
 *                 items:
 *                   type: integer
 *               grants:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required: [permissionId, scopeType]
 *                   properties:
 *                     permissionId:
 *                       type: integer
 *                     scopeType:
 *                       type: string
 *                       enum: [GLOBAL, BRANCH, ASSIGNED]
 *     responses:
 *       200:
 *         description: Success
 */
router.put('/roles/:id/permissions', requirePermission('admin.roles.manage'), async (req, res) => {
  try {
    const { permissionIds, grants } = req.body;
    const roleId = Number(req.params.id);

    const normalizedGrants: RolePermissionGrantInput[] | null = Array.isArray(grants)
      ? grants.map((grant: any) => ({
          permissionId: Number(grant.permissionId),
          scopeType: String(grant.scopeType ?? '') as RolePermissionGrantInput['scopeType'],
        }))
      : Array.isArray(permissionIds)
        ? permissionIds.map((permissionId: unknown) => ({
            permissionId: Number(permissionId),
            scopeType: 'GLOBAL' as const,
          }))
        : null;

    if (!normalizedGrants) {
      return res.status(400).json({ error: 'قائمة الصلاحيات مطلوبة' });
    }

    const updatedGrants = await replaceRolePermissionGrants(roleId, normalizedGrants);
    return res.json(updatedGrants.map(grant => ({ ...grant, scopeType: grant.scope_type })));
  } catch (err: any) {
    if (sendRolePermissionError(res, err)) return;
    console.error('Error assigning permissions:', err);
    return res.status(500).json({ error: err.message });
  }
});

/*
 * Legacy inline implementation retained temporarily for history while the
 * mixed-encoding REST router is cleaned up. It is not executable.
 *
    // Deduplicate: keep last occurrence of each permissionId
    const grantMap = new Map<number, { permissionId: number; scopeType: string }>();
    for (const grant of normalizedGrants) {
      grantMap.set(grant.permissionId, grant);
    }
    const deduplicatedGrants = Array.from(grantMap.values());

    if (deduplicatedGrants.some(grant => !Number.isInteger(grant.permissionId) || !VALID_SCOPE_TYPES.has(grant.scopeType))) {
      return res.status(400).json({ error: 'صلاحيات أو نطاقات غير صالحة' });
    }

    // Validate that each scopeType is allowed for the given permission
    if (deduplicatedGrants.length > 0) {
      const permIds = deduplicatedGrants.map(g => g.permissionId);
      const { rows: permRows } = await pool.query(
        'SELECT id, allowed_scopes FROM permissions WHERE id = ANY($1)',
        [permIds]
      );
      const permScopeMap = new Map<number, string[]>(permRows.map((p: any) => [p.id as number, (p.allowed_scopes ?? []) as string[]]));

      for (const grant of deduplicatedGrants) {
        const allowed: string[] | undefined = permScopeMap.get(grant.permissionId);
        if (!allowed) {
          return res.status(400).json({ error: `الصلاحية رقم ${grant.permissionId} غير موجودة` });
        }
        if (!allowed.includes(grant.scopeType)) {
          return res.status(400).json({
            error: `النطاق "${grant.scopeType}" غير مسموح لهذه الصلاحية. النطاقات المسموحة: ${allowed.join(', ')}`
          });
        }
      }
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
    if (deduplicatedGrants.length > 0) {
      const grantValues = deduplicatedGrants
        .map((_, i) => `($1, $${i * 2 + 2}, $${i * 2 + 3})`)
        .join(', ');
      await client.query(
        `INSERT INTO role_permission_grants (role_id, permission_id, scope_type) VALUES ${grantValues}`,
        [roleId, ...deduplicatedGrants.flatMap(grant => [grant.permissionId, grant.scopeType])]
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
    if (sendRoleManagementError(res, err)) return;
    await client.query('ROLLBACK');
    console.error('Error assigning permissions:', err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ── POST /role-templates/:id/propagate ──────────────────────────────────────
*/

// Deprecated: roles are centrally managed and no longer propagated to branch clones.
/**
 * @swagger
 * /api/admin/role-templates/{id}/propagate:
 *   post:
 *     tags: [Admin → Roles & Permissions]
 *     summary: Propagate template role changes (Deprecated)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         schema:
 *           type: integer
 *         required: false
 *       - in: path
 *         name: id
 *         schema:
 *           type: integer
 *         required: true
 *     responses:
 *       410:
 *         description: Deprecated
 */
router.post('/role-templates/:id/propagate', requireSuperAdmin, async (req, res) => {
  void req;
  return res.status(410).json({
    error: '?? ????? ??????? ??????? ??? ??????. ??????? ????? ???????? ??????? ????? ?????????? ?? ???????.',
  });
});

// ── GET /permissions — List all permissions (global catalog) ────────────────
/**
 * @swagger
 * /api/admin/permissions:
 *   get:
 *     tags: [Admin → Roles & Permissions]
 *     summary: List all permissions in global catalog
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         schema:
 *           type: integer
 *         required: false
 *     responses:
 *       200:
 *         description: Success
 */
router.get('/permissions', requirePermission('admin.roles.view'), async (_req, res) => {
  try {
    res.json(await listPermissionCatalog());
  } catch (err: any) {
    console.error('Error fetching permissions:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /permissions/scopes — Update allowed scopes for permissions (super admin only)
/**
 * @swagger
 * /api/admin/permissions/scopes:
 *   put:
 *     tags: [Admin → Roles & Permissions]
 *     summary: Update allowed scope types for permissions
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         schema:
 *           type: integer
 *         required: false
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [updates]
 *             properties:
 *               updates:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required: [id, allowedScopes]
 *                   properties:
 *                     id:
 *                       type: integer
 *                     allowedScopes:
 *                       type: array
 *                       items:
 *                         type: string
 *                         enum: [GLOBAL, BRANCH, ASSIGNED]
 *     responses:
 *       200:
 *         description: Success
 */
router.put('/permissions/scopes', requireSuperAdmin, async (req, res) => {
  try {
    const { updates } = req.body;

    if (!Array.isArray(updates) || updates.length === 0) {
      return res.status(400).json({ error: 'قائمة التحديثات مطلوبة' });
    }

    const normalizedUpdates = [];

    for (const update of updates) {
      if (!Number.isInteger(update.id)) {
        return res.status(400).json({ error: 'معرّف الصلاحية غير صالح' });
      }
      if (!Array.isArray(update.allowedScopes) || update.allowedScopes.length === 0) {
        return res.status(400).json({ error: `يجب تحديد نطاق واحد على الأقل للصلاحية رقم ${update.id}` });
      }
      const allowedScopes = Array.from(new Set(['GLOBAL', ...update.allowedScopes]));
      if (!allowedScopes.every((s: string) => VALID_SCOPE_TYPES.has(s))) {
        return res.status(400).json({ error: `نطاق غير صالح للصلاحية رقم ${update.id}` });
      }
      normalizedUpdates.push({ ...update, allowedScopes });
      if (!allowedScopes.includes('GLOBAL')) {
        return res.status(400).json({ error: `يجب أن يتضمن النطاق GLOBAL للصلاحية رقم ${update.id}` });
      }
    }

    const ids = normalizedUpdates.map((u: any) => u.id);
    const { rows: existing } = await pool.query(
      'SELECT id FROM permissions WHERE id = ANY($1)',
      [ids]
    );
    const existingIds = new Set(existing.map((r: any) => r.id));
    const invalidId = ids.find((id: number) => !existingIds.has(id));
    if (invalidId !== undefined) {
      return res.status(400).json({ error: `الصلاحية رقم ${invalidId} غير موجودة` });
    }

    for (const update of normalizedUpdates) {
      await pool.query(
        'UPDATE permissions SET allowed_scopes = $1 WHERE id = $2',
        [update.allowedScopes, update.id]
      );
    }

    clearPermissionCache();

    const { rows } = await pool.query('SELECT * FROM permissions ORDER BY display_order');
    res.json(rows);
  } catch (err: any) {
    console.error('Error updating permission scopes:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /hr-users/assignable — Users eligible to be assigned to clients ──────
// Returns active HR users whose role has the 'clients.can_be_assigned' grant.
// Branch-scoped: non-super-admins see only users from their own branch.
// Requires clients.assignment.manage: seeing clients is not enough to enumerate
// possible assignees for ownership changes.
/**
 * @swagger
 * /api/admin/hr-users/assignable:
 *   get:
 *     tags: [Admin → Roles & Permissions]
 *     summary: List HR users assignable to clients
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         schema:
 *           type: integer
 *         required: false
 *       - in: query
 *         name: branchId
 *         schema:
 *           type: integer
 *         required: false
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         required: false
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *         required: false
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *         required: false
 *     responses:
 *       200:
 *         description: Success
 */
router.get('/hr-users/assignable', requirePermission('clients.assignment.manage'), async (req, res) => {
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

// ── GET /hr-users/name-list-assignable — Users eligible to own a name list ───
// Mirrors /hr-users/assignable but for the name-lists family: gated by
// candidates.name_lists.assignment.manage, returns active users whose role has
// candidates.name_lists.can_be_assigned, branch-filtered for non-super-admins.
router.get('/hr-users/name-list-assignable', requirePermission('candidates.name_lists.assignment.manage'), async (req, res) => {
  try {
    const authContext = req.authContext!;
    const conditions: string[] = [
      `u.is_active = TRUE`,
      `u.role_id IN (
        SELECT rpg.role_id
          FROM role_permission_grants rpg
          JOIN permissions p ON p.id = rpg.permission_id
         WHERE p.key = 'candidates.name_lists.can_be_assigned'
      )`,
    ];
    const params: any[] = [];

    const branchFilter = resolveAssignableBranchFilter(authContext, req, ['candidates.name_lists.assignment.manage']);
    if (branchFilter === 'DENY') return res.json([]);
    if (branchFilter != null) {
      params.push(branchFilter);
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

// ── GET /hr-users/candidate-assignable — Users eligible to own a candidate ───
// Mirrors /hr-users/name-list-assignable for the candidate-names family: gated
// by candidates.edit/create (assignment rides on edit), returns active users
// whose role has candidates.can_be_assigned, branch-filtered for non-super.
router.get('/hr-users/candidate-assignable', requirePermission('candidates.edit', 'candidates.create'), async (req, res) => {
  try {
    const authContext = req.authContext!;
    const conditions: string[] = [
      `u.is_active = TRUE`,
      `u.role_id IN (
        SELECT rpg.role_id
          FROM role_permission_grants rpg
          JOIN permissions p ON p.id = rpg.permission_id
         WHERE p.key = 'candidates.can_be_assigned'
      )`,
    ];
    const params: any[] = [];

    // Scope to the OPERATION branch (?branchId), not the actor's acting branch,
    // so a GLOBAL deputy sees the staff of the branch they're adding into — same
    // as super-admin. BRANCH actors are confined to their assigned branches.
    const branchFilter = resolveAssignableBranchFilter(authContext, req, ['candidates.edit', 'candidates.create']);
    if (branchFilter === 'DENY') return res.json([]);
    if (branchFilter != null) {
      params.push(branchFilter);
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
/**
 * @swagger
 * /api/admin/hr-users:
 *   get:
 *     tags: [Admin → Roles & Permissions]
 *     summary: List HR users
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         schema:
 *           type: integer
 *         required: false
 *       - in: query
 *         name: branchId
 *         schema:
 *           type: integer
 *         required: false
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         required: false
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *         required: false
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *         required: false
 *     responses:
 *       200:
 *         description: Success
 */
router.get('/hr-users', requirePermission('admin.users.view_list'), async (req, res) => {
  try {
    const authContext = req.authContext!;
    const conditions: string[] = [];
    const params: any[] = [];

    // Records-section treatment (branch-scope standard): GLOBAL sees every user
    // (optionally narrowed by the external branch filter), BRANCH sees the union
    // of its allowed branches. Mirrors the clients/employees list-plan pattern.
    const plan = resolveListAccessScope(authContext, 'admin.users.view_list');
    if (plan.scope === 'NONE') {
      return res.status(403).json({ error: 'ليس لديك صلاحية عرض المستخدمين' });
    }
    const rawBranch = req.header('x-branch-id');
    const requestedBranchId = rawBranch == null || rawBranch === '' ? null : Number(rawBranch);
    const hasRequestedBranch = Number.isInteger(requestedBranchId) && (requestedBranchId as number) > 0;

    if (plan.scope === 'GLOBAL') {
      if (hasRequestedBranch) {
        params.push(requestedBranchId);
        conditions.push(`u.branch_id = $${params.length}`);
      }
    } else {
      if (plan.allowedBranchIds.length === 0) {
        return res.json([]);
      }
      if (hasRequestedBranch && !plan.allowedBranchIds.includes(requestedBranchId as number)) {
        return res.status(403).json({ error: 'ليس لديك صلاحية الوصول لهذا الفرع' });
      }
      params.push(hasRequestedBranch ? [requestedBranchId] : plan.allowedBranchIds);
      conditions.push(`u.branch_id = ANY($${params.length}::int[])`);
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
/**
 * @swagger
 * /api/admin/hr-users:
 *   post:
 *     tags: [Admin → Roles & Permissions]
 *     summary: Create an HR user
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         schema:
 *           type: integer
 *         required: false
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, username, password]
 *             properties:
 *               name:
 *                 type: string
 *               username:
 *                 type: string
 *               password:
 *                 type: string
 *               roleId:
 *                 type: integer
 *               branchId:
 *                 type: integer
 *               isSuperAdmin:
 *                 type: boolean
 *     responses:
 *       201:
 *         description: Created
 */
router.post('/hr-users', requirePermission('admin.roles.users.manage'), async (req, res) => {
  try {
    const authContext = req.authContext!;
    const { name, username, password, roleId, branchId, isSuperAdmin } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'اسم المستخدم مطلوب' });
    if (!username?.trim()) return res.status(400).json({ error: 'اسم الدخول مطلوب' });
    if (!password?.trim()) return res.status(400).json({ error: 'كلمة المرور مطلوبة' });

    let targetBranchId: number | null;
    let makeSuper = false;
    const globalUserRoleAccess = authorize(authContext, { permission: 'admin.roles.users.manage' });
    if (authContext.isSuperAdmin || globalUserRoleAccess.reason === 'GRANTED_GLOBAL') {
      if (isSuperAdmin === true) {
        if (!authContext.isSuperAdmin) {
          return res.status(403).json({ error: 'ط¥ظ†ط´ط§ط، ط³ظˆط¨ط± ط£ط¯ظ…ظ† ظ…طھط§ط­ ظ„ظ„ط¥ط¯ط§ط±ط© ط§ظ„ط¹ط§ظ…ط© ظپظ‚ط·' });
        }
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
      const scopeCheck = await assertRoleWithinActorScope(authContext, Number(roleId));
      if (scopeCheck.ok === false) {
        return res.status(403).json({ error: ROLE_ESCALATION_ERROR });
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
/**
 * @swagger
 * /api/admin/hr-users/{id}:
 *   put:
 *     tags: [Admin → Roles & Permissions]
 *     summary: Update an HR user details
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         schema:
 *           type: integer
 *         required: false
 *       - in: path
 *         name: id
 *         schema:
 *           type: integer
 *         required: true
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               username:
 *                 type: string
 *               password:
 *                 type: string
 *               roleId:
 *                 type: integer
 *               isActive:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Success
 */
router.put('/hr-users/:id', requirePermission('admin.roles.users.manage'), async (req, res) => {
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
      const scopeCheck = await assertRoleWithinActorScope(authContext, Number(roleId));
      if (scopeCheck.ok === false) {
        return res.status(403).json({ error: ROLE_ESCALATION_ERROR });
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



