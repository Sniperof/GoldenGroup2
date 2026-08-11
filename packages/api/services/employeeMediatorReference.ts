import type { PoolClient } from 'pg';

type Queryable = Pick<PoolClient, 'query'>;

export class EmployeeMediatorReferenceError extends Error {
  status = 400;
  payload: { error: string; code: string };

  constructor(message: string) {
    super(message);
    this.name = 'EmployeeMediatorReferenceError';
    this.payload = {
      error: message,
      code: 'INVALID_EMPLOYEE_REFERRER',
    };
  }
}

export async function canonicalizeEmployeeReferrer(
  db: Queryable,
  referrer: any,
): Promise<any> {
  if (referrer?.type !== 'Employee') return referrer;

  const employeeId = Number(referrer.employeeId);
  const referralEntityId = referrer.referralEntityId == null
    ? employeeId
    : Number(referrer.referralEntityId);
  if (!Number.isInteger(employeeId) || employeeId <= 0) {
    throw new EmployeeMediatorReferenceError('الموظف الوسيط غير صالح');
  }
  if (!Number.isInteger(referralEntityId) || referralEntityId !== employeeId) {
    throw new EmployeeMediatorReferenceError('مرجع الموظف الوسيط غير متطابق');
  }

  const { rows } = await db.query(
    `SELECT id, name, employee_number AS "employeeNumber"
       FROM employees
      WHERE id = $1
      LIMIT 1`,
    [employeeId],
  );
  const employee = rows[0];
  if (!employee) {
    throw new EmployeeMediatorReferenceError('الموظف الوسيط غير موجود');
  }

  return {
    ...referrer,
    employeeId: Number(employee.id),
    referralEntityId: Number(employee.id),
    employeeNumber: employee.employeeNumber ?? null,
    fullName: employee.name,
  };
}
