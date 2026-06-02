import { Router } from 'express';
import { authorize, resolveActingBranch } from '../services/authorizationService.js';
import { requirePermission } from '../middleware/permission.js';
import { getEmployeeBranchId } from '../repositories/employeeRepository.js';
import {
  createEmployeeRecord,
  deleteEmployeeRecord,
  getEmployeeById,
  getEmployeeManagerCandidates,
  getEmployees,
  saveEmployeeSystemAccount,
  updateEmployeeRecord,
} from '../services/employeeService.js';

const router = Router();

function forbidBranchAccess(res: any, reason?: string) {
  if (reason === 'MISSING_BRANCH_CONTEXT') {
    return res.status(400).json({ error: 'يجب تحديد الفرع المطلوب لهذه العملية' });
  }

  return res.status(403).json({ error: 'غير مسموح' });
}

function getRequiredAuthContext(req: any) {
  if (!req.authContext) {
    throw new Error('AuthContext is required after requirePermission');
  }

  return req.authContext;
}

function resolveEmployeeTargetBranch(req: any, requestedBranchId?: number | string | null): number | null {
  const authContext = getRequiredAuthContext(req);

  return resolveActingBranch({
    headerBranchId: requestedBranchId ?? req.header('x-branch-id'),
    primaryBranchId: authContext.actingBranchId ?? authContext.allowedBranchIds[0] ?? null,
    allowedBranchIds: authContext.allowedBranchIds,
    isSuperAdmin: authContext.isSuperAdmin,
  });
}

/**
 * @swagger
 * /api/employees:
 *   get:
 *     tags: [Employees]
 *     summary: List employees
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         schema:
 *           type: integer
 *         required: false
 *         description: Branch context
 *     responses:
 *       200:
 *         description: List of employees
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
 *                   mobile:
 *                     type: string
 *                   status:
 *                     type: string
 *                   branchId:
 *                     type: integer
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       500:
 *         description: Server error
 */
router.get('/', requirePermission('employees.view_list'), async (req, res) => {
  try {
    const authContext = getRequiredAuthContext(req);
    const requestedBranchId = req.header('x-branch-id');
    const targetBranchId = resolveEmployeeTargetBranch(req, requestedBranchId);

    if (!authContext.isSuperAdmin && targetBranchId == null) {
      return res.status(403).json({ error: 'لا يوجد فرع فعّال متاح لهذه العملية' });
    }

    if (targetBranchId != null) {
      const access = authorize(authContext, {
        permission: 'employees.view_list',
        branchId: targetBranchId,
      });
      if (!access.allowed) {
        return forbidBranchAccess(res, access.reason);
      }
    }

    if (authContext.isSuperAdmin && targetBranchId == null) {
      return res.json(await getEmployees({ isSuperAdmin: true, branchId: null }));
    }

    res.json(await getEmployees({ isSuperAdmin: false, branchId: targetBranchId }));
  } catch (err: any) {
    if (err?.status) {
      return res.status(err.status).json(err.payload ?? { error: err.message });
    }
    throw err;
  }
});

router.get('/manager-candidates', requirePermission('employees.view_list'), async (req, res) => {
  try {
    const authContext = getRequiredAuthContext(req);
    const requestedBranchId = req.query.branchId != null ? Number(req.query.branchId) : null;
    const departmentId = req.query.departmentId != null ? Number(req.query.departmentId) : null;
    const targetBranchId = resolveEmployeeTargetBranch(req, requestedBranchId);

    if (targetBranchId == null || !Number.isFinite(targetBranchId)) {
      return res.status(400).json({ error: 'يجب تحديد الفرع المطلوب' });
    }

    const access = authorize(authContext, {
      permission: 'employees.view_list',
      branchId: targetBranchId,
    });
    if (!access.allowed) {
      return forbidBranchAccess(res, access.reason);
    }

    const candidates = await getEmployeeManagerCandidates(
      targetBranchId,
      Number.isFinite(departmentId) ? departmentId : null,
    );
    res.json(candidates);
  } catch (err: any) {
    if (err?.status) {
      return res.status(err.status).json(err.payload ?? { error: err.message });
    }
    throw err;
  }
});

router.get('/schedule-pool', requirePermission('planning.manage'), async (req, res) => {
  try {
    const authContext = getRequiredAuthContext(req);
    const targetBranchId = resolveEmployeeTargetBranch(req, req.header('x-branch-id'));

    if (targetBranchId == null) {
      return res.status(403).json({ error: 'لا يوجد فرع فعّال متاح لهذه العملية' });
    }

    if (targetBranchId != null) {
      const access = authorize(authContext, {
        permission: 'planning.manage',
        branchId: targetBranchId,
      });
      if (!access.allowed) {
        return forbidBranchAccess(res, access.reason);
      }
    }

    const employees = await getEmployees({
      isSuperAdmin: false,
      branchId: targetBranchId,
      includeScheduleAppearanceFlag: true,
    });

    res.json(employees.filter(employee =>
      employee.canAppearInSchedule === true &&
      employee.status === 'active' &&
      employee.teamSlotType != null,
    ));
  } catch (err: any) {
    if (err?.status) {
      return res.status(err.status).json(err.payload ?? { error: err.message });
    }
    throw err;
  }
});

router.get('/closers', requirePermission('employees.view_list'), async (req, res) => {
  try {
    const authContext = getRequiredAuthContext(req);
    const branchId = authContext.isSuperAdmin
      ? (Number(req.header('x-branch-id')) || null)
      : (authContext.actingBranchId ?? null);

    // Find users whose role has the sales.can_close permission. Some legacy
    // consumers need hr_users.id, while pre-offer/device-demo tables FK to
    // employees.id; target=employee returns the latter explicitly.
    const target = String(req.query?.target ?? '').trim();
    const branchFilter = branchId != null
      ? `AND (u.branch_id = ${Number(branchId)} OR rpg.scope_type = 'GLOBAL')`
      : '';

    const { rows } = await (await import('../db.js')).default.query(`
      SELECT DISTINCT
        ${target === 'employee' ? 'e.id' : 'u.id'} AS id,
        u.id AS "hrUserId",
        e.id AS "employeeId",
        COALESCE(e.name, u.name) AS name,
        COALESCE(r.display_name, u.role) AS "roleDisplayName"
      FROM hr_users u
      LEFT JOIN employees e ON e.id = u.employee_id
      JOIN roles r ON r.id = u.role_id
      JOIN role_permission_grants rpg ON rpg.role_id = r.id
      JOIN permissions p ON p.id = rpg.permission_id
      WHERE p.key = 'sales.can_close'
        AND u.is_active = true
        ${target === 'employee' ? 'AND e.id IS NOT NULL' : ''}
        ${branchFilter}
      ORDER BY COALESCE(e.name, u.name)
    `);

    return res.json(rows);
  } catch (err: any) {
    // Gracefully return empty array if permission doesn't exist or query fails
    console.error('[employees/closers]', err.message);
    return res.json([]);
  }
});

/**
 * @swagger
 * /api/employees/{id}:
 *   get:
 *     tags: [Employees]
 *     summary: Get employee by ID
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Employee ID
 *     responses:
 *       200:
 *         description: Employee details
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Employee not found
 *       500:
 *         description: Server error
 */
router.get('/:id', requirePermission('employees.view_list'), async (req, res) => {
  try {
    const authContext = getRequiredAuthContext(req);
    const employeeId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const ownerBranch = await getEmployeeBranchId(employeeId!);

    if (ownerBranch == null) {
      return res.status(404).json({ error: 'الموظف غير موجود' });
    }

    const access = authorize(authContext, {
      permission: 'employees.view_list',
      branchId: ownerBranch,
    });
    if (!access.allowed) {
      return forbidBranchAccess(res, access.reason);
    }

    const result = await getEmployeeById(employeeId);
    res.json(result);
  } catch (err: any) {
    if (err?.status) {
      return res.status(err.status).json(err.payload ?? { error: err.message });
    }
    throw err;
  }
});

/**
 * @swagger
 * /api/employees:
 *   post:
 *     tags: [Employees]
 *     summary: Create a new employee
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         schema:
 *           type: integer
 *         required: false
 *         description: Branch context
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, branchId]
 *             properties:
 *               name:
 *                 type: string
 *               mobile:
 *                 type: string
 *               branchId:
 *                 type: integer
 *               departmentId:
 *                 type: integer
 *               roleId:
 *                 type: integer
 *               status:
 *                 type: string
 *                 enum: [active, inactive]
 *     responses:
 *       200:
 *         description: Created employee
 *       400:
 *         description: Bad request
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       500:
 *         description: Server error
 */
router.post('/', requirePermission('employees.create'), async (req, res) => {
  try {
    const authContext = getRequiredAuthContext(req);

    // Users with GLOBAL scope for employees.create (e.g. SYSTEM_ADMIN) may have empty
    // allowedBranchIds, so resolveActingBranch would return null even with a valid body
    // branchId. Detect this case and accept the explicitly provided branchId directly.
    const bodyBranchId = Number(req.body?.branchId) > 0 && Number.isInteger(Number(req.body?.branchId))
      ? Number(req.body.branchId) : null;
    const hasGlobalGrant = authContext.grants.some(
      g => g.permission === 'employees.create' && g.scope === 'GLOBAL',
    );
    const targetBranchId = (hasGlobalGrant && bodyBranchId != null)
      ? bodyBranchId
      : resolveEmployeeTargetBranch(req, req.body?.branchId);

    if (targetBranchId == null) {
      return res.status(400).json({ error: 'يجب تحديد الفرع المستهدف لهذه العملية' });
    }

    const access = authorize(authContext, {
      permission: 'employees.create',
      branchId: targetBranchId,
    });
    if (!access.allowed) {
      return forbidBranchAccess(res, access.reason);
    }

    const employee = await createEmployeeRecord(req.body, targetBranchId);
    res.json(employee);
  } catch (err: any) {
    if (err?.status) {
      return res.status(err.status).json(err.payload ?? { error: err.message });
    }
    throw err;
  }
});

/**
 * @swagger
 * /api/employees/{id}:
 *   put:
 *     tags: [Employees]
 *     summary: Update an employee
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Employee ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               mobile:
 *                 type: string
 *               branchId:
 *                 type: integer
 *               departmentId:
 *                 type: integer
 *               status:
 *                 type: string
 *                 enum: [active, inactive]
 *     responses:
 *       200:
 *         description: Updated employee
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Employee not found
 *       500:
 *         description: Server error
 */
router.put('/:id', requirePermission('employees.edit'), async (req, res) => {
  try {
    const authContext = getRequiredAuthContext(req);
    const employeeId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const ownerBranch = await getEmployeeBranchId(employeeId!);

    if (ownerBranch == null) {
      return res.status(404).json({ error: 'الموظف غير موجود' });
    }

    const ownerAccess = authorize(authContext, {
      permission: 'employees.edit',
      branchId: ownerBranch,
    });
    if (!ownerAccess.allowed) {
      return forbidBranchAccess(res, ownerAccess.reason);
    }

    const targetBranchId = req.body?.branchId != null
      ? resolveEmployeeTargetBranch(req, req.body?.branchId)
      : ownerBranch;
    if (targetBranchId == null) {
      return res.status(400).json({ error: 'يجب تحديد الفرع المستهدف لهذه العملية' });
    }

    const targetAccess = authorize(authContext, {
      permission: 'employees.edit',
      branchId: targetBranchId,
    });
    if (!targetAccess.allowed) {
      return forbidBranchAccess(res, targetAccess.reason);
    }

    const employee = await updateEmployeeRecord(employeeId, req.body, targetBranchId);
    res.json(employee);
  } catch (err: any) {
    if (err?.status) {
      return res.status(err.status).json(err.payload ?? { error: err.message });
    }
    throw err;
  }
});

router.put('/:id/system-account', requirePermission('admin.roles.manage'), async (req, res) => {
  try {
    const authContext = getRequiredAuthContext(req);
    const employeeIdParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const ownerBranch = await getEmployeeBranchId(employeeIdParam!);

    if (ownerBranch == null) {
      return res.status(404).json({ error: 'الموظف غير موجود' });
    }

    const access = authorize(authContext, {
      permission: 'admin.roles.manage',
      branchId: ownerBranch,
    });
    if (!access.allowed) {
      return forbidBranchAccess(res, access.reason);
    }

    const result = await saveEmployeeSystemAccount(Number(employeeIdParam), req.body);
    res.json(result);
  } catch (err: any) {
    if (err?.status) {
      return res.status(err.status).json(err.payload ?? { error: err.message });
    }
    throw err;
  }
});

/**
 * @swagger
 * /api/employees/{id}:
 *   delete:
 *     tags: [Employees]
 *     summary: Delete an employee
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Employee ID
 *     responses:
 *       200:
 *         description: Deleted successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Employee not found
 *       500:
 *         description: Server error
 */
router.delete('/:id', requirePermission('employees.delete'), async (req, res) => {
  try {
    const authContext = getRequiredAuthContext(req);
    const employeeId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const ownerBranch = await getEmployeeBranchId(employeeId!);

    if (ownerBranch == null) {
      return res.status(404).json({ error: 'الموظف غير موجود' });
    }

    const access = authorize(authContext, {
      permission: 'employees.delete',
      branchId: ownerBranch,
    });
    if (!access.allowed) {
      return forbidBranchAccess(res, access.reason);
    }

    const result = await deleteEmployeeRecord(employeeId);
    res.json(result);
  } catch (err: any) {
    if (err?.status) {
      return res.status(err.status).json(err.payload ?? { error: err.message });
    }
    throw err;
  }
});

export default router;
