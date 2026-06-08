import { Router } from 'express';
import pool from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission, resolveTargetBranchId } from '../middleware/permission.js';

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

async function assertBranchAccess(
  req: any,
  res: any,
  branchId: number,
): Promise<boolean> {
  const authContext = req.authContext!;
  if (authContext.isSuperAdmin) return true;
  if (authContext.actingBranchId !== branchId) {
    res.status(403).json({ error: 'غير مسموح' });
    return false;
  }
  return true;
}

async function assertDeptBranchAccess(
  req: any,
  res: any,
  deptId: number,
): Promise<{ ok: boolean; branchId?: number }> {
  const authContext = req.authContext!;
  const { rows } = await pool.query('SELECT branch_id FROM departments WHERE id = $1', [deptId]);
  if (!rows[0]) {
    res.status(404).json({ error: 'القسم غير موجود' });
    return { ok: false };
  }
  if (!authContext.isSuperAdmin && rows[0].branch_id !== authContext.actingBranchId) {
    res.status(403).json({ error: 'غير مسموح' });
    return { ok: false };
  }
  return { ok: true, branchId: rows[0].branch_id };
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
router.get('/', requirePermission('departments.view_list'), async (req, res) => {
  try {
    const authContext = req.authContext!;
    const requestedBranchId = req.query.branchId ? Number(req.query.branchId) : null;

    let filterBranchId: number | null;

    if (authContext.isSuperAdmin) {
      const hb = Number(req.header('x-branch-id'));
      filterBranchId = requestedBranchId ?? (Number.isFinite(hb) && hb > 0 ? hb : null);
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
    res.json(rows);
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
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(`${SELECT_QUERY} WHERE d.id = $1`, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'القسم غير موجود' });
    const access = await assertDeptBranchAccess(req, res, rows[0].id);
    if (!access.ok) return;
    res.json(rows[0]);
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
router.post('/', requirePermission('employees.create'), async (req, res) => {
  try {
    const { name, departmentTypeId, deviceModelIds, notes, branchId: bodyBranchId } = req.body;

    if (!name?.trim()) {
      return res.status(400).json({ error: 'اسم القسم مطلوب' });
    }

    const targetBranchId = resolveTargetBranchId(req, res, bodyBranchId);
    if (targetBranchId == null) return;

    const { rows } = await pool.query(
      `INSERT INTO departments (name, department_type_id, branch_id, device_model_ids, notes)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [
        name.trim(),
        departmentTypeId ?? null,
        targetBranchId,
        JSON.stringify(deviceModelIds ?? []),
        notes?.trim() || null,
      ]
    );

    const { rows: full } = await pool.query(`${SELECT_QUERY} WHERE d.id = $1`, [rows[0].id]);
    res.status(201).json(full[0]);
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
router.put('/:id', requirePermission('employees.edit'), async (req, res) => {
  try {
    const deptId = Number(req.params.id);
    const access = await assertDeptBranchAccess(req, res, deptId);
    if (!access.ok) return;

    const { name, departmentTypeId, deviceModelIds, notes } = req.body;

    if (!name?.trim()) {
      return res.status(400).json({ error: 'اسم القسم مطلوب' });
    }

    await pool.query(
      `UPDATE departments
       SET name = $1, department_type_id = $2, device_model_ids = $3, notes = $4, updated_at = NOW()
       WHERE id = $5`,
      [
        name.trim(),
        departmentTypeId ?? null,
        JSON.stringify(deviceModelIds ?? []),
        notes?.trim() || null,
        deptId,
      ]
    );

    const { rows } = await pool.query(`${SELECT_QUERY} WHERE d.id = $1`, [deptId]);
    res.json(rows[0]);
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
router.delete('/:id', requirePermission('employees.delete'), async (req, res) => {
  try {
    const deptId = Number(req.params.id);
    const access = await assertDeptBranchAccess(req, res, deptId);
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
