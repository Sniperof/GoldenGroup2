import { Router } from 'express';
import pool from '../db.js';
import { requirePermission, resolveTargetBranchId } from '../middleware/permission.js';
import { authorize } from '../services/authorizationService.js';

const router = Router();

// ── Helpers ────────────────────────────────────────────────────────────────────

const SELECT_QUERY = `
SELECT
  d.id,
  d.name,
  d.branch_id           AS "branchId",
  d.department_type_id  AS "departmentTypeId",
  sl.value              AS "departmentTypeName",
  sl.metadata           AS "departmentTypeMetadata",
  d.device_model_ids    AS "deviceModelIds",
  d.notes,
  d.created_at          AS "createdAt",
  d.updated_at          AS "updatedAt",
  (SELECT COUNT(*) FROM employees e WHERE e.department_id = d.id) AS "employeeCount"
FROM departments d
LEFT JOIN system_lists sl ON sl.id = d.department_type_id
`;

async function assertDeptBranchAccess(
  req: any,
  res: any,
  deptId: number,
  permission:
    | 'departments.view_list'
    | 'departments.lookup'
    | 'departments.manage'
    | 'reference_data.lookup'
    | 'devices.department_availability.view'
    | 'devices.department_availability.manage',
): Promise<{ ok: boolean; branchId?: number }> {
  const authContext = req.authContext!;
  const { rows } = await pool.query('SELECT branch_id FROM departments WHERE id = $1', [deptId]);
  if (!rows[0]) {
    res.status(404).json({ error: 'القسم غير موجود' });
    return { ok: false };
  }

  const access = authorize(authContext, {
    permission,
    branchId: rows[0].branch_id,
  });
  if (!access.allowed) {
    res.status(403).json({ error: 'غير مسموح' });
    return { ok: false };
  }
  return { ok: true, branchId: rows[0].branch_id };
}

async function assertDeptAnyBranchAccess(
  req: any,
  res: any,
  deptId: number,
  permissions: string[],
): Promise<{ ok: boolean; branchId?: number }> {
  const { rows } = await pool.query('SELECT branch_id FROM departments WHERE id = $1', [deptId]);
  if (!rows[0]) {
    res.status(404).json({ error: 'القسم غير موجود' });
    return { ok: false };
  }

  const branchId = rows[0].branch_id;
  const allowed = permissions.some(permission => canAccessBranchPermission(req, permission, branchId));
  if (!allowed) {
    res.status(403).json({ error: 'غير مسموح' });
    return { ok: false };
  }

  return { ok: true, branchId };
}

function canAccessBranchPermission(req: any, permission: string, branchId?: number | null) {
  return authorize(req.authContext!, {
    permission,
    branchId: branchId ?? undefined,
  }).allowed;
}

function canReadDepartmentDevices(req: any, branchId?: number | null) {
  return canAccessBranchPermission(req, 'devices.department_availability.view', branchId)
    || canAccessBranchPermission(req, 'devices.department_availability.manage', branchId);
}

function sanitizeDepartmentDevices(req: any, rows: any[]) {
  return rows.map(row => (
    canReadDepartmentDevices(req, row.branchId)
      ? row
      : { ...row, deviceModelIds: [] }
  ));
}

function normalizeDeviceModelIds(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(id => Number(id))
    .filter(id => Number.isInteger(id) && id > 0);
}

// ── Routes ─────────────────────────────────────────────────────────────────────

// GET /api/departments?branchId=X
/**
 * @swagger
 * /api/departments:
 *   get:
 *     tags: [Admin → Departments]
 *     summary: List departments
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
 *         description: Filter departments by branch ID
 *     responses:
 *       200:
 *         description: A list of departments
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id:
 *                     type: integer
 *                   name:
 *                     type: string
 *                   branchId:
 *                     type: integer
 *                   departmentTypeId:
 *                     type: integer
 *                   departmentTypeName:
 *                     type: string
 *                   departmentTypeMetadata:
 *                     type: object
 *                   deviceModelIds:
 *                     type: array
 *                     items:
 *                       type: integer
 *                   notes:
 *                     type: string
 *                   createdAt:
 *                     type: string
 *                     format: date-time
 *                   updatedAt:
 *                     type: string
 *                     format: date-time
 *                   employeeCount:
 *                     type: integer
 *       500:
 *         description: Server error
 */
router.get('/', requirePermission('departments.view_list', 'departments.lookup', 'reference_data.lookup'), async (req, res) => {
  try {
    const authContext = req.authContext!;
    const requestedBranchId = req.query.branchId ? Number(req.query.branchId) : null;

    let filterBranchId: number | null;

    if (requestedBranchId != null && Number.isFinite(requestedBranchId) && requestedBranchId > 0) {
      // Honor an explicit branch pick (e.g. the employee form's operational
      // branch) for ANYONE whose lookup scope covers it — the filter follows
      // scope, not the user's home branch. A user without scope for that branch
      // is rejected here rather than silently served their own branch.
      const allowed = ['departments.view_list', 'departments.lookup', 'reference_data.lookup']
        .some(permission => canAccessBranchPermission(req, permission, requestedBranchId));
      if (!allowed) {
        return res.status(403).json({ error: 'غير مسموح' });
      }
      filterBranchId = requestedBranchId;
    } else if (authContext.isSuperAdmin) {
      const hb = Number(req.header('x-branch-id'));
      filterBranchId = Number.isFinite(hb) && hb > 0 ? hb : null;
    } else {
      filterBranchId = authContext.actingBranchId;
    }

    let query = SELECT_QUERY;
    const params: any[] = [];
    if (filterBranchId != null) {
      query += ` WHERE d.branch_id = $1`;
      params.push(filterBranchId);
    }
    query += ` ORDER BY d.created_at DESC, d.id DESC`;

    const { rows } = await pool.query(query, params);
    res.json(sanitizeDepartmentDevices(req, rows));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/departments/:id
/**
 * @swagger
 * /api/departments/{id}:
 *   get:
 *     tags: [Admin → Departments]
 *     summary: Get a department by ID
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
 *         description: Department ID
 *     responses:
 *       200:
 *         description: Department details
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: integer
 *                 name:
 *                   type: string
 *                 branchId:
 *                   type: integer
 *                 departmentTypeId:
 *                   type: integer
 *                 departmentTypeName:
 *                   type: string
 *                 departmentTypeMetadata:
 *                   type: object
 *                 deviceModelIds:
 *                   type: array
 *                   items:
 *                     type: integer
 *                 notes:
 *                   type: string
 *                 createdAt:
 *                   type: string
 *                   format: date-time
 *                 updatedAt:
 *                   type: string
 *                   format: date-time
 *                 employeeCount:
 *                   type: integer
 *       404:
 *         description: Department not found
 *       500:
 *         description: Server error
 */
router.get('/:id', requirePermission('departments.view_list', 'departments.lookup', 'reference_data.lookup'), async (req, res) => {
  try {
    const { rows } = await pool.query(`${SELECT_QUERY} WHERE d.id = $1`, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'القسم غير موجود' });
    const canViewManagement = canAccessBranchPermission(req, 'departments.view_list', rows[0].branchId);
    const access = await assertDeptBranchAccess(
      req,
      res,
      rows[0].id,
      canViewManagement ? 'departments.view_list' : 'departments.lookup',
    );
    if (!access.ok) return;
    res.json(sanitizeDepartmentDevices(req, [rows[0]])[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/departments
/**
 * @swagger
 * /api/departments:
 *   post:
 *     tags: [Admin → Departments]
 *     summary: Create a department
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
 *             required:
 *               - name
 *             properties:
 *               name:
 *                 type: string
 *               departmentTypeId:
 *                 type: integer
 *               deviceModelIds:
 *                 type: array
 *                 items:
 *                   type: integer
 *               notes:
 *                 type: string
 *               branchId:
 *                 type: integer
 *     responses:
 *       201:
 *         description: Department created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: integer
 *                 name:
 *                   type: string
 *                 branchId:
 *                   type: integer
 *                 departmentTypeId:
 *                   type: integer
 *                 departmentTypeName:
 *                   type: string
 *                 departmentTypeMetadata:
 *                   type: object
 *                 deviceModelIds:
 *                   type: array
 *                   items:
 *                     type: integer
 *                 notes:
 *                   type: string
 *                 createdAt:
 *                   type: string
 *                   format: date-time
 *                 updatedAt:
 *                   type: string
 *                   format: date-time
 *                 employeeCount:
 *                   type: integer
 *       400:
 *         description: Missing department name
 *       500:
 *         description: Server error
 */
router.post('/', requirePermission('departments.manage'), async (req, res) => {
  try {
    const { name, departmentTypeId, deviceModelIds, notes, branchId: bodyBranchId } = req.body;

    if (!name?.trim()) {
      return res.status(400).json({ error: 'اسم القسم مطلوب' });
    }

    const targetBranchId = resolveTargetBranchId(req, res, bodyBranchId);
    if (targetBranchId == null) return;

    const access = authorize(req.authContext!, {
      permission: 'departments.manage',
      branchId: targetBranchId,
    });
    if (!access.allowed) {
      return res.status(403).json({ error: 'غير مسموح' });
    }

    const normalizedDeviceModelIds = normalizeDeviceModelIds(deviceModelIds);
    if (
      normalizedDeviceModelIds.length > 0
      && !canAccessBranchPermission(req, 'devices.department_availability.manage', targetBranchId)
    ) {
      return res.status(403).json({ error: 'غير مسموح: لا تملك صلاحية تخصيص أجهزة لهذا القسم' });
    }

    const { rows } = await pool.query(
      `INSERT INTO departments (name, department_type_id, branch_id, device_model_ids, notes)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [
        name.trim(),
        departmentTypeId ?? null,
        targetBranchId,
        JSON.stringify(normalizedDeviceModelIds),
        notes?.trim() || null,
      ]
    );

    const { rows: full } = await pool.query(`${SELECT_QUERY} WHERE d.id = $1`, [rows[0].id]);
    res.status(201).json(sanitizeDepartmentDevices(req, full)[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/departments/:id
/**
 * @swagger
 * /api/departments/{id}:
 *   put:
 *     tags: [Admin → Departments]
 *     summary: Update a department by ID
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
 *         description: Department ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *             properties:
 *               name:
 *                 type: string
 *               departmentTypeId:
 *                 type: integer
 *               deviceModelIds:
 *                 type: array
 *                 items:
 *                   type: integer
 *               notes:
 *                 type: string
 *     responses:
 *       200:
 *         description: Department updated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: integer
 *                 name:
 *                   type: string
 *                 branchId:
 *                   type: integer
 *                 departmentTypeId:
 *                   type: integer
 *                 departmentTypeName:
 *                   type: string
 *                 departmentTypeMetadata:
 *                   type: object
 *                 deviceModelIds:
 *                   type: array
 *                   items:
 *                     type: integer
 *                 notes:
 *                   type: string
 *                 createdAt:
 *                   type: string
 *                   format: date-time
 *                 updatedAt:
 *                   type: string
 *                   format: date-time
 *                 employeeCount:
 *                   type: integer
 *       400:
 *         description: Missing department name
 *       404:
 *         description: Department not found
 *       500:
 *         description: Server error
 */
router.put('/:id', requirePermission('departments.manage', 'devices.department_availability.manage'), async (req, res) => {
  try {
    const deptId = Number(req.params.id);
    const access = await assertDeptAnyBranchAccess(req, res, deptId, [
      'departments.manage',
      'devices.department_availability.manage',
    ]);
    if (!access.ok) return;

    const { name, departmentTypeId, deviceModelIds, notes } = req.body;

    if (!name?.trim()) {
      return res.status(400).json({ error: 'اسم القسم مطلوب' });
    }

    const current = await pool.query(
      'SELECT name, department_type_id, device_model_ids, notes FROM departments WHERE id = $1',
      [deptId],
    );
    const currentRow = current.rows[0];
    const normalizedDeviceModelIds = normalizeDeviceModelIds(deviceModelIds);
    const currentDeviceModelIds = normalizeDeviceModelIds(currentRow?.device_model_ids);
    const deviceIdsChanged = JSON.stringify([...currentDeviceModelIds].sort()) !== JSON.stringify([...normalizedDeviceModelIds].sort());
    const departmentFieldsChanged =
      currentRow.name !== name.trim()
      || (currentRow.department_type_id ?? null) !== (departmentTypeId ?? null)
      || (currentRow.notes ?? null) !== (notes?.trim() || null);

    if (departmentFieldsChanged && !canAccessBranchPermission(req, 'departments.manage', access.branchId)) {
      return res.status(403).json({ error: 'غير مسموح: لا تملك صلاحية تعديل بيانات القسم' });
    }

    if (deviceIdsChanged && !canAccessBranchPermission(req, 'devices.department_availability.manage', access.branchId)) {
      return res.status(403).json({ error: 'غير مسموح: لا تملك صلاحية تخصيص أجهزة لهذا القسم' });
    }

    await pool.query(
      `UPDATE departments
       SET name = $1, department_type_id = $2, device_model_ids = $3, notes = $4, updated_at = NOW()
       WHERE id = $5`,
      [
        name.trim(),
        departmentTypeId ?? null,
        JSON.stringify(normalizedDeviceModelIds),
        notes?.trim() || null,
        deptId,
      ]
    );

    const { rows } = await pool.query(`${SELECT_QUERY} WHERE d.id = $1`, [deptId]);
    res.json(sanitizeDepartmentDevices(req, rows)[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/departments/:id
/**
 * @swagger
 * /api/departments/{id}:
 *   delete:
 *     tags: [Admin → Departments]
 *     summary: Delete a department by ID
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
 *         description: Department ID
 *     responses:
 *       200:
 *         description: Department deleted
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *       404:
 *         description: Department not found
 *       500:
 *         description: Server error
 */
router.delete('/:id', requirePermission('departments.manage'), async (req, res) => {
  try {
    const deptId = Number(req.params.id);
    const access = await assertDeptBranchAccess(req, res, deptId, 'departments.manage');
    if (!access.ok) return;

    // Unlink employees from this department before deleting
    await pool.query('UPDATE employees SET department_id = NULL WHERE department_id = $1', [deptId]);
    await pool.query('DELETE FROM departments WHERE id = $1', [deptId]);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
