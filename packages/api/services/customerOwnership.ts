import type { CustomerOwnership } from '@golden-crm/shared';
import pool from '../db.js';

type BuildCustomerOwnershipSqlArgs = {
  clientAlias: string;
  branchNameExpression: string;
  outputAlias?: string;
};

export function buildClientLifecycleStatusSql(clientAlias: string): string {
  return `
    CASE
      WHEN EXISTS (
        SELECT 1 FROM contracts lifecycle_ct
         WHERE lifecycle_ct.customer_id = ${clientAlias}.id
           -- A draft (or rejected) contract has no operational effect yet: the
           -- client stays in its prior stage until the contract is approved.
           AND lifecycle_ct.status NOT IN ('draft', 'discarded')
      )
        THEN 'OP'
      WHEN EXISTS (
        SELECT 1
          FROM open_tasks lifecycle_ot
          JOIN visit_tasks lifecycle_vt ON lifecycle_vt.source_open_task_id = lifecycle_ot.id
          JOIN visit_task_results lifecycle_vtr ON lifecycle_vtr.visit_task_id = lifecycle_vt.id
         WHERE lifecycle_ot.client_id = ${clientAlias}.id
           AND lifecycle_ot.task_type = 'device_demo'
           AND lifecycle_vt.task_type = 'device_demo'
           AND (lifecycle_ot.status = 'closed' OR lifecycle_vt.status = 'closed')
           AND lifecycle_vtr.final_decision = 'offer_presented'
      )
        THEN 'FOP'
      ELSE 'LEAD'
    END
  `;
}

export function buildCustomerOwnershipSql(args: BuildCustomerOwnershipSqlArgs): string {
  const { clientAlias, branchNameExpression, outputAlias = 'ownership' } = args;
  const lifecycleStatusSql = buildClientLifecycleStatusSql(clientAlias);

  return `
    LEFT JOIN LATERAL (
      SELECT
        CASE
          WHEN (${lifecycleStatusSql}) IN ('OP', 'FOP')
            THEN CASE
              WHEN ${clientAlias}.branch_id IS NOT NULL THEN 'company_branch'
              ELSE 'company_global'
            END
          WHEN assignment_summary.eligible_personal_count > 1
            THEN 'personal_multi'
          WHEN assignment_summary.eligible_personal_count = 1
            THEN CASE
              WHEN assignment_summary.single_team_slot_type = 'SUPERVISOR'
                THEN 'personal_single_supervisor'
              ELSE 'personal_single_technician'
            END
          ELSE CASE
            WHEN ${clientAlias}.branch_id IS NOT NULL THEN 'company_branch'
            ELSE 'company_global'
          END
        END AS "ownerType",
        CASE
          WHEN (${lifecycleStatusSql}) IN ('OP', 'FOP')
            THEN COALESCE(${branchNameExpression}, 'الشركة العامة')
          WHEN assignment_summary.eligible_personal_count > 0
            THEN assignment_summary.personal_owner_label
          ELSE COALESCE(${branchNameExpression}, 'الشركة العامة')
        END AS "ownerLabel",
        CASE
          WHEN (${lifecycleStatusSql}) IN ('OP', 'FOP')
            THEN '[]'::json
          WHEN assignment_summary.eligible_personal_count > 0
            THEN assignment_summary.personal_assignments
          ELSE '[]'::json
        END AS "personalAssignments",
        CASE
          WHEN ${clientAlias}.branch_id IS NOT NULL THEN 'branch'
          ELSE 'global'
        END AS "companyOwnershipScope",
        CASE
          WHEN (${lifecycleStatusSql}) IN ('OP', 'FOP')
            THEN 'company_reclaimed_op_fop'
          WHEN assignment_summary.eligible_personal_count > 0
            THEN 'personal_assignment_active'
          WHEN assignment_summary.raw_assignment_count > 0
            THEN 'company_default_non_owner_assignments_ignored'
          ELSE 'company_default_unassigned'
        END AS "effectiveOwnershipReason"
      FROM LATERAL (
        SELECT
          COUNT(*) FILTER (
            WHERE u.id IS NOT NULL
              AND u.is_active = TRUE
              AND u.employee_id IS NOT NULL
              AND r.team_slot_type IN ('SUPERVISOR', 'TECHNICIAN')
              AND e.status = 'active'
          )::int AS eligible_personal_count,
          COUNT(*) FILTER (WHERE ca_all.id IS NOT NULL)::int AS raw_assignment_count,
          MAX(r.team_slot_type) AS single_team_slot_type,
          COALESCE(
            json_agg(
              json_build_object(
                'userId', u.id,
                'userName', u.name,
                'roleDisplayName', COALESCE(r.display_name, u.role),
                'teamSlotType', r.team_slot_type,
                'employeeId', u.employee_id
              )
              ORDER BY ca_all.assigned_at, ca_all.id
            ) FILTER (
              WHERE u.id IS NOT NULL
                AND u.is_active = TRUE
                AND u.employee_id IS NOT NULL
                AND r.team_slot_type IN ('SUPERVISOR', 'TECHNICIAN')
                AND e.status = 'active'
            ),
            '[]'::json
          ) AS personal_assignments,
          COALESCE(
            string_agg(u.name, ' + ' ORDER BY ca_all.assigned_at, ca_all.id) FILTER (
              WHERE u.id IS NOT NULL
                AND u.is_active = TRUE
                AND u.employee_id IS NOT NULL
                AND r.team_slot_type IN ('SUPERVISOR', 'TECHNICIAN')
                AND e.status = 'active'
            ),
            COALESCE(${branchNameExpression}, 'الشركة العامة')
          ) AS personal_owner_label
        FROM client_assignments ca_all
        LEFT JOIN hr_users u ON u.id = ca_all.hr_user_id
        LEFT JOIN roles r ON r.id = u.role_id
        LEFT JOIN employees e ON e.id = u.employee_id
        WHERE ca_all.client_id = ${clientAlias}.id
      ) assignment_summary
    ) ${outputAlias} ON TRUE
  `;
}

export function buildCustomerOwnershipSelectColumns(alias = 'ownership'): string {
  return `
    ${alias}."ownerType" AS "ownershipOwnerType",
    ${alias}."ownerLabel" AS "ownershipOwnerLabel",
    ${alias}."personalAssignments" AS "ownershipPersonalAssignments",
    ${alias}."companyOwnershipScope" AS "ownershipCompanyOwnershipScope",
    ${alias}."effectiveOwnershipReason" AS "ownershipEffectiveOwnershipReason"
  `;
}

/**
 * Returns ownership with personalAssignments stripped.
 * Use when the caller's visibility scope forbids seeing other assignees' identities
 * (e.g. ASSIGNED-scope clients list).
 */
export function redactPersonalAssignments(ownership: CustomerOwnership): CustomerOwnership {
  return { ...ownership, personalAssignments: [] };
}

/**
 * SQL predicate: "this client is PERSONALLY OWNED by the given user" — i.e. the
 * user holds an eligible personal assignment on the client. The eligibility rule
 * here MUST mirror the personal-ownership computation above (active user with an
 * active employee, in a SUPERVISOR/TECHNICIAN team slot) so "my customers" matches
 * exactly what renders as `personal_*` ownership. Used by the ASSIGNED-scope
 * "my customers' tasks" view (branch-scope-and-visibility-standard.md §7 — مُسنَد).
 *
 * `clientIdExpr` is the client-id SQL expression (e.g. `ot.client_id`);
 * `userIdPlaceholder` is the bound parameter placeholder (e.g. `$1`).
 */
export function personalOwnershipPredicate(clientIdExpr: string, userIdPlaceholder: string): string {
  return `EXISTS (
    SELECT 1
    FROM client_assignments ca
    JOIN hr_users u ON u.id = ca.hr_user_id
    LEFT JOIN roles r ON r.id = u.role_id
    LEFT JOIN employees e ON e.id = u.employee_id
    WHERE ca.client_id = ${clientIdExpr}
      AND ca.hr_user_id = ${userIdPlaceholder}
      AND u.is_active = TRUE
      AND u.employee_id IS NOT NULL
      AND r.team_slot_type IN ('SUPERVISOR', 'TECHNICIAN')
      AND e.status = 'active'
  )`;
}

export function mapCustomerOwnership(row: any): CustomerOwnership {
  return {
    ownerType: row.ownershipOwnerType,
    ownerLabel: row.ownershipOwnerLabel,
    personalAssignments: Array.isArray(row.ownershipPersonalAssignments) ? row.ownershipPersonalAssignments : [],
    companyOwnershipScope: row.ownershipCompanyOwnershipScope,
    effectiveOwnershipReason: row.ownershipEffectiveOwnershipReason,
  };
}

/**
 * Returns IDs of clients that are company-owned within the given branch and zones.
 * Company-owned = OP/FOP status OR no active personal assignment.
 */
export async function getCompanyOwnedClients(branchId: number, zoneIds: number[]): Promise<number[]> {
  if (zoneIds.length === 0) return [];

  const { rows } = await pool.query(
    `SELECT c.id
     FROM clients c
     WHERE c.branch_id = $1
       AND (c.is_active IS NULL OR c.is_active = TRUE)
       AND c.deleted_at IS NULL
       AND c.neighborhood = ANY($2::int[])
       AND (
         (${buildClientLifecycleStatusSql('c')}) IN ('OP', 'FOP')
         OR NOT EXISTS (
           SELECT 1
           FROM client_assignments ca
           JOIN hr_users u ON u.id = ca.hr_user_id
           WHERE ca.client_id = c.id
             AND u.employee_id IS NOT NULL
             AND u.is_active = TRUE
         )
       )`,
    [branchId, zoneIds],
  );

  return rows.map((r: any) => Number(r.id));
}
