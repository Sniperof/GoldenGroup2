import { PoolClient } from 'pg';

const FINAL_STATUSES = ['Final Hired', 'Final Rejected', 'Retreated', 'Rejected', 'Interview Failed'];

/**
 * Checks for duplicate applications by mobile number + vacancy.
 *
 * Returns:
 *  - { blocked: true, duplicateApplicationId } if an ACTIVE (non-terminal) application exists.
 *  - { blocked: false, duplicateFlag } where duplicateFlag=true if a HISTORICAL (terminal) application exists.
 */
export async function checkDuplicate(
  client: PoolClient,
  mobileNumber: string,
  vacancyId: number | null
): Promise<{ blocked: true; duplicateApplicationId: number } | { blocked: false; duplicateFlag: boolean }> {
  const placeholders = FINAL_STATUSES.map((_, i) => `$${i + 3}`).join(',');

  const vacancyCondition = vacancyId === null ? 'ja.job_vacancy_id IS NULL' : 'ja.job_vacancy_id = $2';
  const queryParams: any[] = vacancyId === null ? [mobileNumber, null, ...FINAL_STATUSES] : [mobileNumber, vacancyId, ...FINAL_STATUSES];

  // Active check: same mobile + vacancy, NOT in terminal statuses
  const { rows: activeApps } = await client.query(
    `SELECT ja.id FROM job_applications ja
     JOIN applicants ap ON ap.id = ja.applicant_id
     WHERE ap.mobile_number = $1 AND ${vacancyCondition}
       AND ja.application_status NOT IN (${placeholders})`,
    queryParams
  );
  if (activeApps.length > 0) {
    return { blocked: true, duplicateApplicationId: activeApps[0].id };
  }

  // Historical check: same mobile + vacancy, IN terminal statuses (flag only)
  const { rows: histApps } = await client.query(
    `SELECT ja.id FROM job_applications ja
     JOIN applicants ap ON ap.id = ja.applicant_id
     WHERE ap.mobile_number = $1 AND ${vacancyCondition}
       AND ja.application_status IN (${placeholders})`,
    queryParams
  );
  return { blocked: false, duplicateFlag: histApps.length > 0 };
}

/**
 * Checks whether a vacancy has remaining capacity (vacancy_count > 0).
 * Uses FOR UPDATE to lock the row for the calling transaction.
 */
export async function checkVacancyCapacity(
  client: PoolClient,
  vacancyId: number
): Promise<{ sufficient: boolean; vacancyCount: number }> {
  const { rows } = await client.query(
    `SELECT vacancy_count AS "vacancyCount" FROM job_vacancies WHERE id = $1 FOR UPDATE`,
    [vacancyId]
  );
  if (rows.length === 0) return { sufficient: false, vacancyCount: 0 };
  const vacancyCount = rows[0].vacancyCount;
  return { sufficient: vacancyCount > 0, vacancyCount };
}
