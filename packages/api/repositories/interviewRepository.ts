import type { PoolClient } from 'pg';
import pool from '../db.js';
import { sanitizeText } from '../utils/sanitize.js';

// Unprefixed — safe for INSERT/UPDATE … RETURNING (single-table context).
export const INTERVIEW_COLS = `
  id, application_id AS "applicationId",
  interview_type AS "interviewType",
  interview_number AS "interviewNumber",
  interviewer_name AS "interviewerName",
  interviewer_user_id AS "interviewerUserId",
  interview_date AS "interviewDate",
  interview_time AS "interviewTime",
  interview_status AS "interviewStatus",
  internal_notes AS "internalNotes",
  created_at AS "createdAt"
`;

// Prefixed with "i." — required in multi-table SELECT queries (listInterviews,
// getInterviewDetailRow) where id / created_at would otherwise be ambiguous
// across the joined tables (42702).
const INTERVIEW_COLS_I = `
  i.id, i.application_id AS "applicationId",
  i.interview_type AS "interviewType",
  i.interview_number AS "interviewNumber",
  i.interviewer_name AS "interviewerName",
  i.interviewer_user_id AS "interviewerUserId",
  i.interview_date AS "interviewDate",
  i.interview_time AS "interviewTime",
  i.interview_status AS "interviewStatus",
  i.internal_notes AS "internalNotes",
  i.created_at AS "createdAt"
`;

export async function getApplicationInterviewContext(
  client: PoolClient,
  applicationId: string | number,
) {
  const { rows } = await client.query(
    `SELECT
       ja.id AS "applicationId",
       ja.job_vacancy_id AS "jobVacancyId",
       ja.branch_id AS "applicationBranchId",
       jv.branch_id AS "vacancyBranchId",
       COALESCE(ja.branch_id, jv.branch_id) AS "resolvedBranchId"
     FROM job_applications ja
     LEFT JOIN job_vacancies jv ON jv.id = ja.job_vacancy_id
     WHERE ja.id = $1`,
    [applicationId]
  );

  return rows[0] ?? null;
}

export async function getInterviewBranchContext(
  client: PoolClient,
  interviewId: string | number,
) {
  const { rows } = await client.query(
    `SELECT
       i.id,
       i.application_id AS "applicationId",
       i.interview_status,
       i.interviewer_user_id AS "interviewerUserId",
       ja.branch_id AS "applicationBranchId",
       jv.branch_id AS "vacancyBranchId",
       COALESCE(ja.branch_id, jv.branch_id) AS "resolvedBranchId"
     FROM interviews i
     JOIN job_applications ja ON ja.id = i.application_id
     LEFT JOIN job_vacancies jv ON jv.id = ja.job_vacancy_id
     WHERE i.id = $1`,
    [interviewId]
  );

  return rows[0] ?? null;
}

export async function listEligibleInterviewersForBranch(
  client: PoolClient,
  branchId: number,
  interviewerUserId?: number | null,
) {
  const params: Array<number | string> = [branchId];
  const includeCurrentClause = interviewerUserId != null
    ? ` OR u.id = $2`
    : '';
  if (interviewerUserId != null) {
    params.push(interviewerUserId);
  }

  const { rows } = await client.query(
    `SELECT DISTINCT
       u.id,
       u.name,
       u.username,
       r.display_name AS "roleDisplayName",
       b.name AS "branchName"
     FROM hr_users u
     JOIN roles r ON r.id = u.role_id
     JOIN user_branch_assignments uba
       ON uba.user_id = u.id
      AND uba.branch_id = $1
      AND uba.status = 'active'
     JOIN branches b ON b.id = uba.branch_id
     WHERE u.is_active = TRUE
       AND COALESCE(r.is_system, FALSE) = FALSE
       AND COALESCE(r.is_hidden, FALSE) = FALSE
       AND (
         EXISTS (
           SELECT 1
           FROM role_permission_grants rpg
           JOIN permissions p ON p.id = rpg.permission_id
           WHERE rpg.role_id = u.role_id
             AND p.key = 'jobs.interviews.conduct'
             AND rpg.scope_type IN ('BRANCH', 'GLOBAL')
         )
         ${includeCurrentClause}
       )
     ORDER BY u.name ASC`,
    params
  );

  return rows;
}

export async function getEligibleInterviewApplications(jobVacancyId: string) {
  const { rows } = await pool.query(
    `SELECT ja.id,
       a.first_name AS "applicantFirstName",
       a.last_name AS "applicantLastName",
       ja.current_stage AS "currentStage",
       ja.application_status AS "applicationStatus",
       ja.branch_id AS "applicationBranchId",
       jv.branch_id AS "vacancyBranchId",
       COALESCE(ja.branch_id, jv.branch_id) AS "branchId"
     FROM job_applications ja
     JOIN applicants a ON a.id = ja.applicant_id
     LEFT JOIN job_vacancies jv ON jv.id = ja.job_vacancy_id
     WHERE ja.job_vacancy_id = $1
       AND (
         (ja.current_stage = 'Shortlisted' AND ja.application_status = 'Qualified') OR
         (ja.current_stage = 'Interview' AND ja.application_status = 'Interview Scheduled') OR
         (ja.current_stage = 'Interview' AND ja.application_status = 'Interview Completed')
       )
       AND ja.id NOT IN (
         SELECT application_id FROM interviews WHERE interview_status = 'Interview Scheduled'
       )
     ORDER BY a.last_name, a.first_name`,
    [jobVacancyId]
  );

  return rows;
}

export async function listInterviews(filters: {
  applicationId?: unknown;
  interviewerName?: unknown;
  date?: unknown;
  jobVacancyId?: unknown;
  allowedBranchIds?: number[];
  requestedBranchId?: number | null;
  isSuperAdmin?: boolean;
}) {
  const { applicationId, interviewerName, date, jobVacancyId, allowedBranchIds, requestedBranchId, isSuperAdmin } = filters;
  const conditions: string[] = [];
  const params: any[] = [];
  let idx = 1;

  if (requestedBranchId != null) {
    conditions.push(`ja.branch_id = $${idx++}`);
    params.push(requestedBranchId);
  } else if (isSuperAdmin !== true) {
    conditions.push(`ja.branch_id = ANY($${idx++}::int[])`);
    params.push(allowedBranchIds ?? []);
  }

  if (applicationId) {
    conditions.push(`i.application_id = $${idx++}`);
    params.push(applicationId);
  }
  if (interviewerName) {
    conditions.push(`i.interviewer_name ILIKE $${idx++}`);
    params.push(`%${interviewerName}%`);
  }
  if (date) {
    conditions.push(`i.interview_date = $${idx++}`);
    params.push(date);
  }
  if (jobVacancyId) {
    conditions.push(`ja.job_vacancy_id = $${idx++}`);
    params.push(jobVacancyId);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await pool.query(
    `SELECT ${INTERVIEW_COLS_I},
      a.first_name AS "applicantFirstName",
      a.last_name AS "applicantLastName",
      jv.title AS "vacancyTitle",
      iu.username AS "interviewerUsername",
      ir.display_name AS "interviewerRoleDisplayName"
    FROM interviews i
    JOIN job_applications ja ON ja.id = i.application_id
    JOIN applicants a ON a.id = ja.applicant_id
    LEFT JOIN job_vacancies jv ON jv.id = ja.job_vacancy_id
    LEFT JOIN hr_users iu ON iu.id = i.interviewer_user_id
    LEFT JOIN roles ir ON ir.id = iu.role_id
    ${where}
    ORDER BY i.interview_date DESC, i.interview_time DESC`,
    params
  );

  return rows;
}

export async function getInterviewDetailRow(id: string) {
  const { rows } = await pool.query(
    `SELECT ${INTERVIEW_COLS_I},
      a.first_name AS "applicantFirstName",
      a.last_name AS "applicantLastName",
      a.dob AS "applicantDob",
      a.governorate AS "applicantGovernorate",
      a.city_or_area AS "applicantCityOrArea",
      a.academic_qualification AS "applicantAcademicQualification",
      a.previous_employment AS "applicantPreviousEmployment",
      a.driving_license AS "applicantDrivingLicense",
      a.expected_salary AS "applicantExpectedSalary",
      a.foreign_languages AS "applicantForeignLanguages",
      a.computer_skills AS "applicantComputerSkills",
      a.years_of_experience AS "applicantYearsOfExperience",
      jv.id AS "vacancyId",
      jv.title AS "vacancyTitle",
      jv.branch AS "vacancyBranch",
      iu.username AS "interviewerUsername",
      ir.display_name AS "interviewerRoleDisplayName"
    FROM interviews i
    JOIN job_applications ja ON ja.id = i.application_id
    JOIN applicants a ON a.id = ja.applicant_id
    LEFT JOIN job_vacancies jv ON jv.id = ja.job_vacancy_id
    LEFT JOIN hr_users iu ON iu.id = i.interviewer_user_id
    LEFT JOIN roles ir ON ir.id = iu.role_id
    WHERE i.id = $1`,
    [id]
  );

  return rows[0] ?? null;
}

export async function findInterviewStatusRecord(client: PoolClient, interviewId: string) {
  const { rows } = await client.query(
    'SELECT interview_status, application_id, interviewer_user_id AS "interviewerUserId" FROM interviews WHERE id = $1',
    [interviewId]
  );

  return rows[0] ?? null;
}

export async function findExistingScheduledInterview(client: PoolClient, applicationId: number) {
  const { rows } = await client.query(
    `SELECT id FROM interviews WHERE application_id = $1 AND interview_status = 'Interview Scheduled'`,
    [applicationId]
  );

  return rows;
}

export async function findInterviewerConflict(
  client: PoolClient,
  interviewerUserId: number | null,
  interviewerName: string,
  interviewDate: string,
  interviewTime: string,
) {
  const { rows } = await client.query(
    `SELECT id FROM interviews
     WHERE (
         ($1::int IS NOT NULL AND interviewer_user_id = $1)
         OR (interviewer_user_id IS NULL AND interviewer_name = $2)
       )
       AND interview_date = $3
       AND interview_time = $4
       AND interview_status = 'Interview Scheduled'`,
    [interviewerUserId, interviewerName, interviewDate, interviewTime]
  );

  return rows;
}

export async function insertInterview(
  client: PoolClient,
  input: {
    applicationId: number;
    interviewType: string;
    interviewNumber: string | number;
    interviewerUserId: number;
    interviewerName: string;
    interviewDate: string;
    interviewTime: string;
    internalNotes?: string | null;
  },
) {
  const { rows } = await client.query(
    `INSERT INTO interviews (
      application_id, interview_type, interview_number,
      interviewer_name, interviewer_user_id, interview_date, interview_time,
      interview_status, internal_notes
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,'Interview Scheduled',$8)
    RETURNING ${INTERVIEW_COLS}`,
    [
      input.applicationId,
      input.interviewType,
      input.interviewNumber,
      sanitizeText(input.interviewerName),
      input.interviewerUserId,
      input.interviewDate,
      input.interviewTime,
      input.internalNotes ? sanitizeText(input.internalNotes) : null,
    ]
  );

  return rows[0];
}

export async function markApplicationInterviewScheduled(client: PoolClient, applicationId: number) {
  await client.query(
    `UPDATE job_applications
     SET current_stage = 'Interview', application_status = 'Interview Scheduled',
         stage_status = 'Scheduled', updated_at = NOW()
     WHERE id = $1`,
    [applicationId]
  );
}

export async function updateInterviewRecord(
  client: PoolClient,
  interviewId: string,
  input: {
    interviewDate?: string | null;
    interviewTime?: string | null;
    interviewerUserId?: number | null;
    interviewerName?: string | null;
    interviewType?: string | null;
    interviewNumber?: string | number | null;
    internalNotes?: string | null;
  },
) {
  const { rows } = await client.query(
    `UPDATE interviews SET
      interview_date = COALESCE($1, interview_date),
      interview_time = COALESCE($2, interview_time),
      interviewer_name = COALESCE($3, interviewer_name),
      interviewer_user_id = COALESCE($4, interviewer_user_id),
      interview_type = COALESCE($5, interview_type),
      interview_number = COALESCE($6, interview_number),
      internal_notes = COALESCE($7, internal_notes)
    WHERE id = $8
    RETURNING ${INTERVIEW_COLS}`,
    [
      input.interviewDate || null,
      input.interviewTime || null,
      input.interviewerName ? sanitizeText(input.interviewerName) : null,
      input.interviewerUserId ?? null,
      input.interviewType || null,
      input.interviewNumber || null,
      input.internalNotes !== undefined
        ? (input.internalNotes ? sanitizeText(input.internalNotes) : null)
        : null,
      interviewId,
    ]
  );

  return rows[0];
}

export async function updateInterviewResultRecord(
  client: PoolClient,
  interviewId: string,
  interviewStatus: string,
  internalNotes?: string | null,
) {
  const { rows } = await client.query(
    `UPDATE interviews SET
      interview_status = $1,
      internal_notes = COALESCE($2, internal_notes)
    WHERE id = $3
    RETURNING ${INTERVIEW_COLS}`,
    [interviewStatus, internalNotes ? sanitizeText(internalNotes) : null, interviewId]
  );

  return rows[0];
}

export async function updateApplicationAfterInterviewResult(
  client: PoolClient,
  input: {
    applicationId: number;
    interviewStatus: string;
    stageStatus: string;
    decision: string | null;
  },
) {
  await client.query(
    `UPDATE job_applications
     SET current_stage = 'Interview', application_status = $1,
         stage_status = $2, decision = COALESCE($3, decision), updated_at = NOW()
     WHERE id = $4`,
    [input.interviewStatus, input.stageStatus, input.decision, input.applicationId]
  );
}
