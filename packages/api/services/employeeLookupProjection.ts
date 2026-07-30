export interface EmployeeLookupRow {
  id: number;
  employeeNumber: number | string | null;
  name: string;
  mobile: string | null;
  jobTitle: string | null;
  branchId: number | null;
  departmentId: number | null;
  status: string;
}

export function projectEmployeeLookupRow(employee: any): EmployeeLookupRow {
  return {
    id: employee.id,
    employeeNumber: employee.employeeNumber ?? null,
    name: employee.name,
    mobile: employee.mobile,
    jobTitle: employee.jobTitle,
    branchId: employee.branchId,
    departmentId: employee.departmentId,
    status: employee.status,
  };
}
