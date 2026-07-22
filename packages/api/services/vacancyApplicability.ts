export const VACANCY_NOT_APPLICABLE_CODE = 'vacancy_not_applicable';
export const VACANCY_NOT_APPLICABLE_MESSAGE = 'الشاغر غير موجود أو غير متاح للتقديم';

type Queryable = {
  query: (sql: string, params?: any[]) => Promise<{ rows: any[] }>;
};

/**
 * Canonical applicability window for every flow that offers or accepts a new
 * application. Dates are inclusive: both start_date and end_date are valid.
 */
export function vacancyApplicabilitySql(alias = 'job_vacancies'): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(alias)) {
    throw new Error('Invalid SQL alias for vacancy applicability predicate');
  }
  return `${alias}.status = 'Open' AND CURRENT_DATE BETWEEN ${alias}.start_date AND ${alias}.end_date`;
}

export async function findApplicableVacancyById(
  db: Queryable,
  vacancyId: number | string,
  options: { forUpdate?: boolean } = {},
) {
  const { rows } = await db.query(
    `SELECT jv.id, jv.status, jv.branch_id AS "branchId",
            jv.start_date AS "startDate", jv.end_date AS "endDate"
       FROM job_vacancies jv
      WHERE jv.id = $1
        AND ${vacancyApplicabilitySql('jv')}
      ${options.forUpdate ? 'FOR UPDATE' : ''}`,
    [vacancyId],
  );
  return rows[0] ?? null;
}
