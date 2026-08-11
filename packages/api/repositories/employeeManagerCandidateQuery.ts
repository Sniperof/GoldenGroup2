export const DIRECT_MANAGER_ELIGIBILITY_PERMISSION = 'employees.direct_manager_eligible';
export const DIRECT_MANAGER_BRANCH_FALLBACK_PERMISSION = 'employees.direct_manager_branch_fallback';

export function buildScopedEmployeeManagerCandidatesQuery(
  branchId: number,
  departmentId?: number | null,
) {
  return {
    text: `SELECT
      e.id,
      e.name,
      COALESCE(NULLIF(e.job_title, ''), r.display_name) AS "jobTitle",
      e.department_id AS "departmentId",
      d.name AS "departmentName",
      r.display_name AS "roleDisplayName",
      ($2::int IS NOT NULL AND e.department_id = $2) AS "isRecommendedManager"
    FROM employees e
    JOIN hr_users u ON u.employee_id = e.id AND u.is_active = TRUE
    LEFT JOIN roles r ON r.id = u.role_id
    LEFT JOIN departments d ON d.id = e.department_id
    WHERE e.branch_id = $1
      AND e.status = 'active'
      AND (
        (
          EXISTS (
            SELECT 1
            FROM role_permission_grants department_manager_rpg
            JOIN permissions department_manager_p
              ON department_manager_p.id = department_manager_rpg.permission_id
            WHERE department_manager_rpg.role_id = r.id
              AND department_manager_p.key = $3
          )
          AND ($2::int IS NULL OR e.department_id = $2)
        )
        OR EXISTS (
          SELECT 1
          FROM role_permission_grants branch_fallback_rpg
          JOIN permissions branch_fallback_p
            ON branch_fallback_p.id = branch_fallback_rpg.permission_id
          WHERE branch_fallback_rpg.role_id = r.id
            AND branch_fallback_p.key = $4
        )
      )
    ORDER BY
      "isRecommendedManager" DESC,
      e.name ASC`,
    values: [
      branchId,
      departmentId ?? null,
      DIRECT_MANAGER_ELIGIBILITY_PERMISSION,
      DIRECT_MANAGER_BRANCH_FALLBACK_PERMISSION,
    ],
  };
}
