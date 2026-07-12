function sqlStringLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export function eligibleHrUserWithPermissionCondition(
  userAlias: string,
  roleAlias: string,
  employeeAlias: string,
  permissionKey: string,
): string {
  return `
    ${userAlias}.is_active = TRUE
    AND ${userAlias}.employee_id IS NOT NULL
    AND ${employeeAlias}.status = 'active'
    AND EXISTS (
      SELECT 1
      FROM role_permission_grants eligibility_rpg
      JOIN permissions eligibility_p ON eligibility_p.id = eligibility_rpg.permission_id
      WHERE eligibility_rpg.role_id = ${roleAlias}.id
        AND eligibility_p.key = ${sqlStringLiteral(permissionKey)}
    )
  `;
}
