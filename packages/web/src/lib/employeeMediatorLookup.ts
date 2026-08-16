import type { Employee } from './types';

export type MediatorEmployee = {
  id: number;
  employeeNumber: number | string | null;
  name: string;
  jobTitle: string | null;
  branchName: string | null;
};

export type EmployeeMediatorReference = {
  employeeId: number;
  referralEntityId: number;
  employeeNumber: number | string;
  fullName: string;
};

export function toMediatorEmployee(employee: Partial<Employee> & Record<string, any>): MediatorEmployee {
  return {
    id: Number(employee.id),
    employeeNumber: employee.employeeNumber ?? employee.employee_number ?? null,
    name: String(employee.name ?? ''),
    jobTitle: employee.jobTitle ?? employee.job_title ?? null,
    branchName: employee.branchName ?? employee.branch_name ?? employee.branch ?? null,
  };
}

export function findEmployeeByNumber(employees: MediatorEmployee[], input: string): MediatorEmployee | null {
  const query = input.trim();
  if (!query) return null;

  return employees.find((employee) => {
    if (employee.employeeNumber == null || employee.employeeNumber === '') return false;
    return String(employee.employeeNumber) === query;
  }) ?? null;
}

export function formatEmployeeMediatorLabel(employee: MediatorEmployee): string {
  return [employee.name, employee.branchName, employee.jobTitle].filter(Boolean).join(' - ');
}

export function resolveEmployeeMediatorReference(
  employeeNumberInput: string,
  employee: MediatorEmployee | null,
): EmployeeMediatorReference | null {
  const query = employeeNumberInput.trim();
  const employeeId = Number(employee?.id);
  if (
    !query
    || !employee
    || employee.employeeNumber == null
    || employee.employeeNumber === ''
    || String(employee.employeeNumber) !== query
    || !Number.isInteger(employeeId)
    || employeeId <= 0
  ) {
    return null;
  }

  return {
    employeeId,
    referralEntityId: employeeId,
    employeeNumber: employee.employeeNumber,
    fullName: employee.name,
  };
}
