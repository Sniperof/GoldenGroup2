import type { PoolClient } from 'pg';
import pool from '../db.js';
import { sanitizeText } from '../utils/sanitize.js';

export const INTERVIEW_COLS = `
  id, application_id AS "applicationId",
  interview_type AS "interviewType",
  interview_number AS "interviewNumber",
  interviewer_name AS "interviewerName",
  interview_date AS "interviewDate",
  interview_time AS "interviewTime",
  interview_status AS "interviewStatus",
  internal_notes AS "internalNotes",
  created_at AS "createdAt"
`;

export async function getEligibleInterviewApplications(jobVacancyId: string) {
  const { rows } = await pool.query(
    `SELECT ja.id,
       a.first_name AS "applicantFirstName",
       a.last_name AS "applicantLastName",
       ja.current_stage AS "currentStage",
       ja.application_status AS "applicationStatus"
     FROM job_applications ja
     JOIN applicants a ON a.id = ja.applicant_id
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
}) {
  const { applicationId, interviewerName, date, jobVacancyId } = filters;
  const conditions: string[] = [];
  const params: any[] = [];
  let idx = 1;

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
    `SELECT ${INTERVIEW_COLS},
      a.first_name AS "applicantFirstName",
      a.last_name AS "applicantLastName",
      jv.title AS "vacancyTitle"
    FROM interviews i
    JOIN job_applications ja ON ja.id = i.application_id
    JOIN applicants a ON a.id = ja.applicant_id
    JOIN job_vacancies jv ON jv.id = ja.job_vacancy_id
    ${where}
    ORDER BY i.interview_date DESC, i.interview_time DESC`,
    params
  );

  return rows;
}

export async function getInterviewDetailRow(id: string) {
  const { rows } = await pool.query(
    `SELECT ${INTERVIEW_COLS},
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
      jv.branch AS "vacancyBranch"
    FROM interviews i
    JOIN job_applications ja ON ja.id = i.application_id
    JOIN applicants a ON a.id = ja.applicant_id
    JOIN job_vacancies jv ON jv.id = ja.job_vacancy_id
    WHERE i.id = $1`,
    [id]
  );

  return rows[0] ?? null;
}

export async function findInterviewStatusRecord(client: PoolClient, interviewId: string) {
  const { rows } = await client.query(
    'SELECT interview_status, application_id FROM interviews WHERE id = $1',
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
  interviewerName: string,
  interviewDate: string,
  interviewTime: string,
) {
  const { rows } = await client.query(
    `SELECT id FROM interviews
     WHERE interviewer_name = $1
       AND interview_date = $2
       AND interview_time = $3
       AND interview_status = 'Interview Scheduled'`,
    [interviewerName, interviewDate, interviewTime]
  );

  return rows;
}

export async function insertInterview(
  client: PoolClient,
  input: {
    applicationId: number;
    interviewType: string;
    interviewNumber: string | number;
    interviewerName: string;
    interviewDate: string;
    interviewTime: string;
    internalNotes?: string | null;
  },
) {
  const { rows } = await client.query(
    `INSERT INTO interviews (
      application_id, interview_type, interview_number,
      interviewer_name, interview_date, interview_time,
      interview_status, internal_notes
    ) VALUES ($1,$2,$3,$4,$5,$6,'Interview Scheduled',$7)
    RETURNING ${INTERVIEW_COLS}`,
    [
      input.applicationId,
      input.interviewType,
      input.interviewNumber,
      sanitizeText(input.interviewerName),
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
      interview_type = COALESCE($4, interview_type),
      interview_number = COALESCE($5, interview_number),
      internal_notes = COALESCE($6, internal_notes)
    WHERE id = $7
    RETURNING ${INTERVIEW_COLS}`,
    [
      input.interviewDate || null,
      input.interviewTime || null,
      input.interviewerName ? sanitizeText(input.interviewerName) : null,
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
