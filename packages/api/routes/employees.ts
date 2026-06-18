import { Router } from 'express';
import { authorize, resolveActingBranch } from '../services/authorizationService.js';
import { requirePermission } from '../middleware/permission.js';
import { assertRoleWithinActorScope, ROLE_ESCALATION_ERROR } from '../services/roleAssignmentGuard.js';
import { getEmployeeBranchId } from '../repositories/employeeRepository.js';
import {
  createEmployeeRecord,
  deleteEmployeeRecord,
  getEmployeeById,
  getEmployeeLookup,
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

    // List visibility follows the GRANT scope, not the user's home branch:
    //  - GLOBAL (super-admin or company manager) → every branch, optionally
    //    narrowed by the management filter header.
    //  - BRANCH → the union of the user's assigned branches.
    // A BRANCH user must never be silently collapsed to one branch, and a
    // GLOBAL user must never be blocked just for lacking a home branch.
    const viewScope = authContext.isSuperAdmin
      ? 'GLOBAL'
      : (authContext.grants.find(g => g.permission === 'employees.view_list')?.scope ?? 'NONE');

    if (viewScope === 'NONE') {
      return res.status(403).json({ error: 'غير مسموح' });
    }

    const headerBranchId = req.header('x-branch-id');
    const requestedBranchId = headerBranchId != null && headerBranchId !== ''
      ? Number(headerBranchId)
      : null;

    if (viewScope === 'BRANCH' && authContext.allowedBranchIds.length === 0) {
      return res.status(403).json({ error: 'لا يوجد فرع فعّال متاح لهذه العملية' });
    }

    // A non-GLOBAL viewer may only narrow to a branch they are actually assigned to.
    if (requestedBranchId != null && viewScope === 'BRANCH'
      && !authContext.allowedBranchIds.includes(requestedBranchId)) {
      return forbidBranchAccess(res, 'BRANCH_FORBIDDEN');
    }

    if (requestedBranchId != null) {
      const access = authorize(authContext, {
        permission: 'employees.view_list',
        branchId: requestedBranchId,
      });
      if (!access.allowed) {
        return forbidBranchAccess(res, access.reason);
      }
    }

    // Resolve the branch filter from scope: explicit pick → that branch;
    // BRANCH → assigned union; GLOBAL with no pick → all branches.
    const branchIds = requestedBranchId != null
      ? [requestedBranchId]
      : (viewScope === 'BRANCH' ? authContext.allowedBranchIds : null);

    res.json(await getEmployees({ isSuperAdmin: authContext.isSuperAdmin, branchIds }));
  } catch (err: any) {
    if (err?.status) {
      return res.status(err.status).json(err.payload ?? { error: err.message });
    }
    throw err;
  }
});

router.get('/manager-candidates', requirePermission('employees.manager_lookup', 'employees.create', 'employees.edit', 'employees.view_list'), async (req, res) => {
  try {
    const authContext = getRequiredAuthContext(req);
    const requestedBranchId = req.query.branchId != null ? Number(req.query.branchId) : null;
    const departmentId = req.query.departmentId != null ? Number(req.query.departmentId) : null;
    const targetBranchId = resolveEmployeeTargetBranch(req, requestedBranchId);

    if (targetBranchId == null || !Number.isFinite(targetBranchId)) {
      return res.status(400).json({ error: 'يجب تحديد الفرع المطلوب' });
    }

    const managerLookupAccess = authorize(authContext, {
      permission: 'employees.manager_lookup',
      branchId: targetBranchId,
    });
    const createAccess = authorize(authContext, {
      permission: 'employees.create',
      branchId: targetBranchId,
    });
    const editAccess = authorize(authContext, {
      permission: 'employees.edit',
      branchId: targetBranchId,
    });
    const viewAccess = authorize(authContext, {
      permission: 'employees.view_list',
      branchId: targetBranchId,
    });
    const access = managerLookupAccess.allowed
      ? managerLookupAccess
      : createAccess.allowed
        ? createAccess
        : editAccess.allowed
          ? editAccess
          : viewAccess;
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

router.get('/lookup', requirePermission('employees.lookup', 'employees.create', 'employees.edit', 'employees.view_list'), async (req, res) => {
  try {
    const authContext = getRequiredAuthContext(req);
    const requestedBranchId = req.query.branchId != null ? Number(req.query.branchId) : req.header('x-branch-id');
    const targetBranchId = resolveEmployeeTargetBranch(req, requestedBranchId);

    if (!authContext.isSuperAdmin && targetBranchId == null) {
      return res.status(403).json({ error: 'لا يوجد فرع فعّال متاح لهذه العملية' });
    }

    if (targetBranchId != null) {
      const lookupAccess = authorize(authContext, {
        permission: 'employees.lookup',
        branchId: targetBranchId,
      });
      const createAccess = authorize(authContext, {
        permission: 'employees.create',
        branchId: targetBranchId,
      });
      const editAccess = authorize(authContext, {
        permission: 'employees.edit',
        branchId: targetBranchId,
      });
      const viewAccess = authorize(authContext, {
        permission: 'employees.view_list',
        branchId: targetBranchId,
      });
      const access = lookupAccess.allowed
        ? lookupAccess
        : createAccess.allowed
          ? createAccess
          : editAccess.allowed
            ? editAccess
            : viewAccess;
      if (!access.allowed) {
        return forbidBranchAccess(res, access.reason);
      }
    }

    if (authContext.isSuperAdmin && targetBranchId == null) {
      return res.json(await getEmployeeLookup({ isSuperAdmin: true, branchId: null }));
    }

    res.json(await getEmployeeLookup({ isSuperAdmin: false, branchId: targetBranchId }));
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

    // Find users whose role can close contracts (التسكير). The capability is
    // contracts.close — the legacy 'sales.can_close' key (migration 001) was
    // never granted to any role, so the old filter returned nobody. Some legacy
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
      WHERE p.key = 'contracts.close'
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

router.put('/:id/system-account', requirePermission('admin.roles.users.manage'), async (req, res) => {
  try {
    const authContext = getRequiredAuthContext(req);
    const employeeIdParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const ownerBranch = await getEmployeeBranchId(employeeIdParam!);

    if (ownerBranch == null) {
      return res.status(404).json({ error: 'الموظف غير موجود' });
    }

    const access = authorize(authContext, {
      permission: 'admin.roles.users.manage',
      branchId: ownerBranch,
    });
    if (!access.allowed) {
      return forbidBranchAccess(res, access.reason);
    }

    if (req.body?.roleId) {
      const scopeCheck = await assertRoleWithinActorScope(authContext, Number(req.body.roleId));
      if (scopeCheck.ok === false) {
        return res.status(403).json({ error: ROLE_ESCALATION_ERROR });
      }
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
