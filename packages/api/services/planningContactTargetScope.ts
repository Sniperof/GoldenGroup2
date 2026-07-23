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
