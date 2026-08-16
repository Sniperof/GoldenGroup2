export const EMPLOYEE_USERNAME_CONFLICT_MESSAGE = 'اسم الدخول مستخدم مسبقاً، اختر اسماً آخر';

export function isEmployeeUsernameConflict(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const postgresError = error as { code?: string; constraint?: string };
  return postgresError.code === '23505' && postgresError.constraint === 'hr_users_username_key';
}
