import { Router } from 'express';
import { requirePermission } from '../middleware/permission.js';
import {
  createEmployeeRecord,
  deleteEmployeeRecord,
  getEmployeeById,
  getEmployees,
  saveEmployeeSystemAccount,
  updateEmployeeRecord,
} from '../services/employeeService.js';

const router = Router();

router.get('/', requirePermission('employees.view_list'), async (req, res) => {
  const { page, limit, search } = req.query;
  const opts =
    page !== undefined || limit !== undefined
      ? {
          page: page ? parseInt(page as string) : undefined,
          limit: limit ? parseInt(limit as string) : undefined,
          search: search as string | undefined,
        }
      : undefined;
  const result = await getEmployees(opts);
  res.json(result);
});

router.get('/:id', requirePermission('employees.view_list'), async (req, res) => {
  try {
    const employeeId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
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
    const employee = await createEmployeeRecord(req.body);
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
    const employeeId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const employee = await updateEmployeeRecord(employeeId, req.body);
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
    const employeeIdParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const result = await saveEmployeeSystemAccount(Number(employeeIdParam), req.body);
    res.json(result);
  } catch (err: any) {
    if (err?.status) {
      return res.status(err.status).json(err.payload ?? { error: err.message });
    }
    throw err;
  }
});

router.delete('/:id', requirePermission('employees.delete'), async (req, res) => {
  const employeeId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const result = await deleteEmployeeRecord(employeeId);
  res.json(result);
});

export default router;
