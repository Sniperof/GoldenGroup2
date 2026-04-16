import pool from '../db.js';
import { paginatedResponse, type PaginatedResult } from '../utils/paginate.js';

const HIRED_APPLICATION_JOINS = `
  FROM employees e
  LEFT JOIN LATERAL (
    SELECT ja.id, ja.applicant_id, ja.job_vacancy_id
    FROM job_applications ja
    WHERE ja.hired_employee_id = e.id
    ORDER BY ja.updated_at DESC NULLS LAST, ja.id DESC
    LIMIT 1
  ) linked_app ON TRUE
  LEFT JOIN applicants a ON a.id = linked_app.applicant_id
  LEFT JOIN job_vacancies jv ON jv.id = linked_app.job_vacancy_id
`;

const APPLICANT_RESIDENCE_SQL = `
  NULLIF(
    CONCAT_WS(
      ' - ',
      NULLIF(a.governorate, ''),
      NULLIF(a.city_or_area, ''),
      NULLIF(a.sub_area, ''),
      NULLIF(a.neighborhood, ''),
      NULLIF(a.detailed_address, '')
    ),
    ''
  )
`;

const APPLICANT_RESIDENCE_SHORT_SQL = `
  NULLIF(
    CONCAT_WS(
      ' - ',
      NULLIF(a.sub_area, ''),
      NULLIF(a.neighborhood, '')
    ),
    ''
  )
`;

const EMPLOYEE_SELECT_COLS = `
  e.id,
  e.name,
  e.role,
  e.mobile,
  COALESCE(NULLIF(jv.branch, ''), e.branch) AS branch,
  COALESCE(${APPLICANT_RESIDENCE_SQL}, e.residence) AS residence,
  ${APPLICANT_RESIDENCE_SHORT_SQL} AS "residenceShort",
  e.status,
  e.avatar,
  COALESCE(NULLIF(jv.title, ''), e.job_title) AS "jobTitle",
  e.created_at AS "createdAt"
`;

const EMPLOYEE_DETAIL_COLS = `
  ${EMPLOYEE_SELECT_COLS},
  u.id AS "systemUserId",
  u.username AS "systemUsername",
  u.is_active AS "systemIsActive",
  u.role_id AS "systemRoleId",
  r.display_name AS "systemRoleDisplayName"
`;

const APP_COLS = `
  ja.id,
  ja.job_vacancy_id AS "jobVacancyId",
  ja.applicant_id AS "applicantId",
  ja.referrer_id AS "referrerId",
  ja.submission_type AS "submissionType",
  ja.application_source AS "applicationSource",
  ja.entered_by_user_id AS "enteredByUserId",
  ja.entered_by_name AS "enteredByName",
  ja.current_stage AS "currentStage",
  ja.application_status AS "applicationStatus",
  ja.duplicate_flag AS "duplicateFlag",
  ja.hired_employee_id AS "hiredEmployeeId",
  ja.is_escalated AS "isEscalated",
  ja.escalated_at AS "escalatedAt",
  ja.internal_notes AS "internalNotes",
  ja.created_at AS "createdAt",
  ja.updated_at AS "updatedAt",
  ja.is_archived AS "isArchived",
  ja.archived_at AS "archivedAt",
  ja.stage_status AS "stageStatus",
  ja.decision
`;

export async function listEmployees(opts?: {
  page?: number;
  limit?: number;
  search?: string;
}): Promise<any[] | PaginatedResult<any>> {
  const conditions: string[] = [];
  const params: any[] = [];
  let idx = 1;

  if (opts?.search) {
    conditions.push(`(e.name ILIKE $${idx} OR e.mobile ILIKE $${idx})`);
    params.push(`%${opts.search}%`);
    idx++;
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  if (opts?.page !== undefined || opts?.limit !== undefined) {
    const page = Math.max(1, opts.page ?? 1);
    const limit = Math.min(200, Math.max(1, opts.limit ?? 20));
    const offset = (page - 1) * limit;

    const [{ rows }, { rows: countRows }] = await Promise.all([
      pool.query(
        `SELECT ${EMPLOYEE_SELECT_COLS}
         ${HIRED_APPLICATION_JOINS}
         ${where}
         ORDER BY e.created_at DESC NULLS LAST, e.id DESC
         LIMIT $${idx} OFFSET $${idx + 1}`,
        [...params, limit, offset],
      ),
      pool.query(`SELECT COUNT(*) FROM employees e ${where}`, params),
    ]);
    return paginatedResponse(rows, parseInt(countRows[0].count), page, limit);
  }

  const { rows } = await pool.query(
    `SELECT ${EMPLOYEE_SELECT_COLS}
     ${HIRED_APPLICATION_JOINS}
     ${where}
     ORDER BY e.created_at DESC NULLS LAST, e.id DESC`,
    params,
  );
  return rows;
}

export async function fetchEmployeeListItem(employeeId: number | string) {
  const { rows } = await pool.query(
    `SELECT ${EMPLOYEE_SELECT_COLS}
     ${HIRED_APPLICATION_JOINS}
     WHERE e.id = $1`,
    [employeeId]
  );
  return rows[0] ?? null;
}

export async function fetchEmployeeDetailRow(employeeId: number | string) {
  const { rows } = await pool.query(
    `SELECT ${EMPLOYEE_DETAIL_COLS}
     ${HIRED_APPLICATION_JOINS}
     LEFT JOIN hr_users u ON u.employee_id = e.id
     LEFT JOIN roles r ON r.id = u.role_id
     WHERE e.id = $1`,
    [employeeId]
  );
  return rows[0] ?? null;
}

export async function fetchLatestHiringApplication(employeeId: number | string) {
  const { rows } = await pool.query(
    `SELECT ${APP_COLS}
     FROM job_applications ja
     WHERE ja.hired_employee_id = $1
     ORDER BY ja.updated_at DESC NULLS LAST, ja.id DESC
     LIMIT 1`,
    [employeeId]
  );
  return rows[0] ?? null;
}

export async function fetchApplicantById(applicantId: number) {
  const { rows } = await pool.query(
    `SELECT id, first_name AS "firstName", last_name AS "lastName",
      dob, gender, marital_status AS "maritalStatus", email,
      mobile_number AS "mobileNumber", secondary_mobile AS "secondaryMobile",
      governorate, city_or_area AS "cityOrArea",
      sub_area AS "subArea", neighborhood, detailed_address AS "detailedAddress",
      academic_qualification AS "academicQualification",
      specialization,
      previous_employment AS "previousEmployment",
      driving_license AS "drivingLicense",
      has_whatsapp_primary AS "hasWhatsappPrimary",
      has_whatsapp_secondary AS "hasWhatsappSecondary",
      expected_salary AS "expectedSalary",
      computer_skills AS "computerSkills",
      foreign_languages AS "foreignLanguages",
      years_of_experience AS "yearsOfExperience",
      cv_url AS "cvUrl", photo_url AS "photoUrl",
      applicant_segment AS "applicantSegment",
      created_at AS "createdAt"
    FROM applicants WHERE id = $1`,
    [applicantId]
  );
  return rows[0] ?? null;
}

export async function fetchVacancyById(vacancyId: number) {
  const { rows } = await pool.query(
    `SELECT id, title, branch,
      governorate, city_or_area AS "cityOrArea", sub_area AS "subArea",
      neighborhood, detailed_address AS "detailedAddress",
      work_type AS "workType", required_gender AS "requiredGender",
      required_age_min AS "requiredAgeMin", required_age_max AS "requiredAgeMax",
      email, required_certificate AS "requiredCertificate",
      required_major AS "requiredMajor",
      required_experience_years AS "requiredExperienceYears",
      required_skills AS "requiredSkills", responsibilities,
      driving_license_required AS "drivingLicenseRequired",
      vacancy_count AS "vacancyCount",
      start_date AS "startDate", end_date AS "endDate",
      status, created_at AS "createdAt", updated_at AS "updatedAt"
    FROM job_vacancies WHERE id = $1`,
    [vacancyId]
  );
  return rows[0] ?? null;
}

export async function fetchReferrerById(referrerId: number) {
  const { rows } = await pool.query(
    `SELECT id, type, employee_id AS "employeeId",
      full_name AS "fullName", last_name AS "lastName",
      mobile_number AS "mobileNumber", governorate,
      city_or_area AS "cityOrArea", sub_area AS "subArea",
      neighborhood, detailed_address AS "detailedAddress",
      referrer_work AS "referrerWork", referrer_notes AS "referrerNotes"
    FROM referrers WHERE id = $1`,
    [referrerId]
  );
  return rows[0] ?? null;
}

export async function fetchApplicationInterviews(applicationId: number) {
  const { rows } = await pool.query(
    `SELECT id, application_id AS "applicationId",
      interview_type AS "interviewType",
      interview_number AS "interviewNumber",
      interviewer_name AS "interviewerName",
      interview_date AS "interviewDate",
      interview_time AS "interviewTime",
      interview_status AS "interviewStatus",
      internal_notes AS "internalNotes",
      created_at AS "createdAt"
    FROM interviews
    WHERE application_id = $1
    ORDER BY created_at ASC`,
    [applicationId]
  );
  return rows;
}

export async function fetchApplicationTrainings(applicationId: number) {
  const { rows } = await pool.query(
    `SELECT
      tct.id,
      tct.training_course_id AS "trainingCourseId",
      tct.result,
      tct.result_recorded_at AS "resultRecordedAt",
      tct.added_at AS "addedAt",
      tc.training_name AS "trainingName",
      tc.trainer,
      tc.branch,
      tc.device_name AS "deviceName",
      tc.start_date AS "startDate",
      tc.end_date AS "endDate",
      tc.training_status AS "trainingStatus",
      tc.notes
    FROM training_course_trainees tct
    JOIN training_courses tc ON tc.id = tct.training_course_id
    WHERE tct.application_id = $1
    ORDER BY tct.added_at ASC`,
    [applicationId]
  );
  return rows;
}

export async function createEmployee(input: {
  name: string;
  role: string;
  mobile: string | null;
  branch: string | null;
  residence: string | null;
  status: string;
  avatar: string;
  jobTitle: string | null;
}) {
  const { rows } = await pool.query(
    `INSERT INTO employees (name, role, mobile, branch, residence, status, avatar, job_title)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [input.name, input.role, input.mobile, input.branch, input.residence, input.status, input.avatar, input.jobTitle]
  );
  return rows[0].id as number;
}

export async function findEmployeeAvatarRecord(employeeId: number | string) {
  const { rows } = await pool.query(
    `SELECT id, avatar
     FROM employees
     WHERE id = $1`,
    [employeeId]
  );
  return rows[0] ?? null;
}

export async function updateEmployee(input: {
  employeeId: number | string;
  name: string;
  role: string;
  mobile: string | null;
  branch: string | null;
  residence: string | null;
  status: string;
  avatar: string;
  jobTitle: string | null;
}) {
  await pool.query(
    `UPDATE employees
     SET name = $1, role = $2, mobile = $3, branch = $4, residence = $5, status = $6, avatar = $7, job_title = $8
     WHERE id = $9
     RETURNING id`,
    [input.name, input.role, input.mobile, input.branch, input.residence, input.status, input.avatar, input.jobTitle, input.employeeId]
  );
}

export async function updateHrUserNameByEmployeeId(name: string, employeeId: number | string) {
  await pool.query('UPDATE hr_users SET name = $1 WHERE employee_id = $2', [name, employeeId]);
}

export async function findEmployeeBasic(employeeId: number) {
  const { rows } = await pool.query('SELECT id, name FROM employees WHERE id = $1', [employeeId]);
  return rows[0] ?? null;
}

export async function findRoleById(roleId: number) {
  const { rows } = await pool.query('SELECT id, name, display_name, is_active FROM roles WHERE id = $1', [roleId]);
  return rows[0] ?? null;
}

export async function findEmployeeSystemAccount(employeeId: number) {
  const { rows } = await pool.query(
    `SELECT id, username, is_active AS "isActive", role_id AS "roleId"
     FROM hr_users
     WHERE employee_id = $1`,
    [employeeId]
  );
  return rows[0] ?? null;
}

export async function insertEmployeeSystemAccount(input: {
  employeeName: string;
  username: string;
  passwordHash: string;
  roleName: string;
  roleId: number;
  employeeId: number;
  isActive: boolean;
}) {
  const { rows } = await pool.query(
    `INSERT INTO hr_users (name, username, password_hash, role, role_id, employee_id, is_active)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, username, is_active AS "isActive", role_id AS "roleId"`,
    [input.employeeName, input.username, input.passwordHash, input.roleName, input.roleId, input.employeeId, input.isActive]
  );
  return rows[0];
}

export async function updateEmployeeSystemAccount(input: {
  accountId: number;
  username?: string;
  passwordHash?: string;
  roleId: number;
  roleName: string;
  employeeName: string;
  isActive?: boolean;
}) {
  const updates: string[] = [];
  const params: any[] = [];
  let idx = 1;

  if (input.username) {
    updates.push(`username = $${idx++}`);
    params.push(input.username);
  }
  if (input.passwordHash) {
    updates.push(`password_hash = $${idx++}`);
    params.push(input.passwordHash);
  }

  updates.push(`role_id = $${idx++}`);
  params.push(input.roleId);
  updates.push(`role = $${idx++}`);
  params.push(input.roleName);
  updates.push(`name = $${idx++}`);
  params.push(input.employeeName);

  if (typeof input.isActive === 'boolean') {
    updates.push(`is_active = $${idx++}`);
    params.push(input.isActive);
  }

  params.push(input.accountId);
  const { rows } = await pool.query(
    `UPDATE hr_users
     SET ${updates.join(', ')}
     WHERE id = $${idx}
     RETURNING id, username, is_active AS "isActive", role_id AS "roleId"`,
    params
  );
  return rows[0];
}

export async function findRoleDisplayName(roleId: number) {
  const { rows } = await pool.query('SELECT display_name FROM roles WHERE id = $1', [roleId]);
  return rows[0]?.display_name ?? null;
}

export async function unlinkEmployeeSystemAccounts(employeeId: number | string) {
  await pool.query('UPDATE hr_users SET employee_id = NULL WHERE employee_id = $1', [employeeId]);
}

export async function deleteEmployee(employeeId: number | string) {
  await pool.query('DELETE FROM employees WHERE id = $1', [employeeId]);
}
