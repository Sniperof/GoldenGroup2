import { Router } from 'express';
import { requirePermission, resolveTargetBranchId } from '../middleware/permission.js';
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

router.get('/', requirePermission('employees.view_list'), async (req, res) => {
  const scope = req.scope!;
  if (scope.isSuperAdmin) {
    const hb = Number(req.header('x-branch-id'));
    if (Number.isFinite(hb) && hb > 0) {
      return res.json(await getEmployees({ isSuperAdmin: false, branchId: hb }));
    }
    return res.json(await getEmployees({ isSuperAdmin: true, branchId: null }));
  }
  res.json(await getEmployees({ isSuperAdmin: false, branchId: scope.branchId }));
});

router.get('/manager-candidates', requirePermission('employees.view_list'), async (req, res) => {
  try {
    const scope = req.scope!;
    const requestedBranchId = req.query.branchId != null ? Number(req.query.branchId) : null;
    const departmentId = req.query.departmentId != null ? Number(req.query.departmentId) : null;
    const headerBranchId = Number(req.header('x-branch-id'));

    const targetBranchId = scope.isSuperAdmin
      ? (requestedBranchId ?? ((Number.isFinite(headerBranchId) && headerBranchId > 0) ? headerBranchId : null))
      : scope.branchId;

    if (targetBranchId == null || !Number.isFinite(targetBranchId)) {
      return res.status(400).json({ error: 'يجب تحديد الفرع المطلوب' });
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

router.get('/:id', requirePermission('employees.view_list'), async (req, res) => {
  try {
    const scope = req.scope!;
    const employeeId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    if (!scope.isSuperAdmin) {
      const ownerBranch = await getEmployeeBranchId(employeeId!);
      if (ownerBranch !== scope.branchId) return res.status(403).json({ error: 'غير مسموح' });
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

router.post('/', requirePermission('employees.create'), async (req, res) => {
  try {
    const targetBranchId = resolveTargetBranchId(req, res, req.body?.branchId);
    if (targetBranchId == null) return;
    const employee = await createEmployeeRecord(req.body, targetBranchId);
    res.json(employee);
  } catch (err: any) {
    if (err?.status) {
      return res.status(err.status).json(err.payload ?? { error: err.message });
    }
    throw err;
  }
});

router.put('/:id', requirePermission('employees.edit'), async (req, res) => {
  try {
    const scope = req.scope!;
    const employeeId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const ownerBranch = await getEmployeeBranchId(employeeId!);
    if (ownerBranch == null) {
      return res.status(404).json({ error: 'الموظف غير موجود' });
    }
    if (!scope.isSuperAdmin && ownerBranch !== scope.branchId) {
      return res.status(403).json({ error: 'غير مسموح' });
    }

    const targetBranchId = req.body?.branchId != null
      ? resolveTargetBranchId(req, res, req.body?.branchId)
      : ownerBranch;
    if (targetBranchId == null) return;

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
    const scope = req.scope!;
    const employeeIdParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    if (!scope.isSuperAdmin) {
      const ownerBranch = await getEmployeeBranchId(employeeIdParam!);
      if (ownerBranch !== scope.branchId) return res.status(403).json({ error: 'غير مسموح' });
    }
    const result = await saveEmployeeSystemAccount(Number(employeeIdParam), req.body, scope);
    res.json(result);
  } catch (err: any) {
    if (err?.status) {
      return res.status(err.status).json(err.payload ?? { error: err.message });
    }
    throw err;
  }
});

router.delete('/:id', requirePermission('employees.delete'), async (req, res) => {
  const scope = req.scope!;
  const employeeId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  if (!scope.isSuperAdmin) {
    const ownerBranch = await getEmployeeBranchId(employeeId!);
    if (ownerBranch !== scope.branchId) return res.status(403).json({ error: 'غير مسموح' });
  }
  const result = await deleteEmployeeRecord(employeeId);
  res.json(result);
});

export default router;
