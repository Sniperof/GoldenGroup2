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

  return `NOT (
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
  )`;
}
