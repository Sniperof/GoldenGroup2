import { SEVERABLE_TASK_TYPES } from './teamCapability.js';

const SQL_IDENTIFIER = /^[a-z_][a-z0-9_]*$/i;
const SQL_PARAMETER = /^\$\d+$/;

function assertSqlToken(value: string, pattern: RegExp, label: string): string {
  if (!pattern.test(value)) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
  return value;
}

export function buildExcludedTaskTeamPredicate(
  taskAlias: string,
  teamParameter: string,
  dateParameter: string,
): string {
  const alias = assertSqlToken(taskAlias, SQL_IDENTIFIER, 'task alias');
  const team = assertSqlToken(teamParameter, SQL_PARAMETER, 'team parameter');
  const date = assertSqlToken(dateParameter, SQL_PARAMETER, 'date parameter');

  return `${alias}.excluded_for_date = ${date}::date
           AND ${alias}.assigned_team_key = ${team}
           AND ${alias}.status IN ('open', 'needs_follow_up', 'assigned')`;
}

/**
 * True when a task is excluded from a team's planning preview on day D.
 *
 * The legacy `open_tasks.excluded_for_date` value remains a day-wide exclusion
 * during the compatibility window. New decisions live in
 * `planning_task_exclusions` and can be day-wide or team-specific.
 */
export function buildPlanningTaskExcludedPredicate(
  taskAlias: string,
  teamParameter: string,
  dateParameter: string,
): string {
  const alias = assertSqlToken(taskAlias, SQL_IDENTIFIER, 'task alias');
  const team = assertSqlToken(teamParameter, SQL_PARAMETER, 'team parameter');
  const date = assertSqlToken(dateParameter, SQL_PARAMETER, 'date parameter');

  return `(
    COALESCE(${alias}.excluded_for_date = ${date}::date, FALSE)
    OR EXISTS (
      SELECT 1
      FROM planning_task_exclusions planning_exclusion
      WHERE planning_exclusion.open_task_id = ${alias}.id
        AND planning_exclusion.branch_id = ${alias}.branch_id
        AND planning_exclusion.planning_date = ${date}::date
        AND planning_exclusion.revoked_at IS NULL
        AND (
          planning_exclusion.exclusion_scope = 'all_teams'
          OR (
            planning_exclusion.exclusion_scope = 'team'
            AND planning_exclusion.team_key = ${team}
          )
        )
    )
  )`;
}

// DEC-026 D7 — task types outside the grain (see teamCapability.ts).
const SEVERABLE_TASK_TYPES_SQL = [...SEVERABLE_TASK_TYPES].map(type => `'${type.replace(/'/g, "''")}'`).join(', ');

export function buildPlanningTaskAvailablePredicate(
  taskAlias: string,
  teamParameter: string,
  dateParameter: string,
): string {
  return `NOT ${buildPlanningTaskExcludedPredicate(taskAlias, teamParameter, dateParameter)}`;
}

/**
 * Prevent two teams from owning the same constitutional contact grain
 * (customer + work location + day). A team-only task exclusion can make the
 * task available elsewhere, but not while a sibling task at the same location
 * is still assigned/committed to another team or that other team's contact
 * target has already entered the call lifecycle.
 *
 * DEC-026 D7: emergency_maintenance is outside the grain in both directions —
 * an emergency task is never blocked by the grain, and a sibling emergency
 * task held by another team never blocks this one.
 */
export function buildPlanningContactContextAvailablePredicate(
  taskAlias: string,
  taskTypeConfigAlias: string,
  installedDeviceAlias: string,
  teamParameter: string,
  dateParameter: string,
): string {
  const task = assertSqlToken(taskAlias, SQL_IDENTIFIER, 'task alias');
  const config = assertSqlToken(taskTypeConfigAlias, SQL_IDENTIFIER, 'task type config alias');
  const device = assertSqlToken(installedDeviceAlias, SQL_IDENTIFIER, 'installed device alias');
  const team = assertSqlToken(teamParameter, SQL_PARAMETER, 'team parameter');
  const date = assertSqlToken(dateParameter, SQL_PARAMETER, 'date parameter');
  const currentLocation = `CASE
    WHEN ${config}.location_basis IN ('contract', 'device')
      THEN ${device}.installation_geo_unit_id
    ELSE COALESCE(context_client.neighborhood, context_client.district)
  END`;

  const severable = SEVERABLE_TASK_TYPES_SQL;
  return `(${task}.task_type IN (${severable}) OR NOT (
    EXISTS (
      SELECT 1
      FROM open_tasks context_task
      JOIN task_type_config context_config
        ON context_config.task_type = context_task.task_type
      JOIN clients context_client
        ON context_client.id = context_task.client_id
      LEFT JOIN installed_devices context_device
        ON context_device.id = context_task.device_id
       AND context_config.location_basis IN ('contract', 'device')
      WHERE context_task.id <> ${task}.id
        AND context_task.task_type NOT IN (${severable})
        AND context_task.branch_id = ${task}.branch_id
        AND context_task.client_id = ${task}.client_id
        AND context_task.assigned_for_date = ${date}::date
        AND context_task.assigned_team_key IS NOT NULL
        AND context_task.assigned_team_key <> ${team}
        AND context_task.status IN (
          'assigned', 'in_scheduling', 'scheduled', 'waiting_execution',
          'in_execution', 'ended', 'completed'
        )
        AND (
          CASE
            WHEN context_config.location_basis IN ('contract', 'device')
              THEN context_device.installation_geo_unit_id
            ELSE COALESCE(context_client.neighborhood, context_client.district)
          END
        ) IS NOT DISTINCT FROM ${currentLocation}
    )
    OR EXISTS (
      SELECT 1
      FROM contact_targets context_target
      JOIN clients context_client
        ON context_client.id = ${task}.client_id
      WHERE context_target.branch_id = ${task}.branch_id
        AND context_target.target_type = 'client'
        AND context_target.target_id = ${task}.client_id
        AND context_target.date = ${date}::date
        AND context_target.team_key IS NOT NULL
        AND context_target.team_key <> ${team}
        AND context_target.status IN (
          'queued', 'in_call_list', 'contacted', 'booked', 'closed'
        )
        AND context_target.work_location_geo_unit_id
          IS NOT DISTINCT FROM ${currentLocation}
    )
  ))`;
}

/**
 * DEC-005 D27 — a contact target's visit_type is DERIVED from the tasks linked
 * to it: one shared contact_target_visit_type, or 'mixed' when a demo, a
 * service and/or a collection task meet at the same (client + location + D).
 * Never last-writer-wins from whichever task was processed last.
 * Closed links are ignored; a target with no live links keeps its value.
 */
export async function refreshContactTargetVisitType(
  db: { query: (sql: string, params?: unknown[]) => Promise<unknown> },
  contactTargetId: number,
): Promise<void> {
  await db.query(
    `UPDATE contact_targets ct
        SET visit_type = derived.visit_type,
            updated_at = NOW()
       FROM (
         SELECT CASE
                  WHEN COUNT(DISTINCT COALESCE(ttc.contact_target_visit_type, 'marketing')) = 1
                    THEN MIN(COALESCE(ttc.contact_target_visit_type, 'marketing'))
                  ELSE 'mixed'
                END AS visit_type
           FROM contact_target_open_tasks link
           JOIN open_tasks ot ON ot.id = link.open_task_id
           JOIN task_type_config ttc ON ttc.task_type = ot.task_type
          WHERE link.contact_target_id = $1
            AND link.link_status <> 'closed'
         HAVING COUNT(*) > 0
       ) derived
      WHERE ct.id = $1
        AND ct.visit_type IS DISTINCT FROM derived.visit_type`,
    [contactTargetId],
  );
}
