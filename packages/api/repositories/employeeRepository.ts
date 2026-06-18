import pool from '../db.js';

const HIRED_APPLICATION_JOINS = `
  FROM employees e
  LEFT JOIN branches b ON b.id = e.branch_id
  LEFT JOIN departments d ON d.id = e.department_id
  LEFT JOIN employees dm ON dm.id = e.direct_manager_id
  LEFT JOIN geo_units gov ON gov.id = e.residence_governorate_id
  LEFT JOIN geo_units region ON region.id = e.residence_region_id
  LEFT JOIN geo_units sub ON sub.id = e.residence_sub_area_id
  LEFT JOIN geo_units neigh ON neigh.id = e.residence_neighborhood_id
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

const EMPLOYEE_RESIDENCE_SQL = `
  NULLIF(
    CONCAT_WS(
      ' - ',
      COALESCE(NULLIF(gov.name, ''), NULLIF(a.governorate, '')),
      COALESCE(NULLIF(region.name, ''), NULLIF(a.city_or_area, '')),
      COALESCE(NULLIF(sub.name, ''), NULLIF(a.sub_area, '')),
      COALESCE(NULLIF(neigh.name, ''), NULLIF(a.neighborhood, '')),
      COALESCE(NULLIF(e.detailed_address, ''), NULLIF(a.detailed_address, ''))
    ),
    ''
  )
`;

const EMPLOYEE_RESIDENCE_SHORT_SQL = `
  NULLIF(
    CONCAT_WS(
      ' - ',
      COALESCE(NULLIF(sub.name, ''), NULLIF(a.sub_area, '')),
      COALESCE(NULLIF(neigh.name, ''), NULLIF(a.neighborhood, ''))
    ),
    ''
  )
`;

const EMPLOYEE_SELECT_COLS = `
  e.id,
  e.employee_number AS "employeeNumber",
  e.name,
  COALESCE(NULLIF(e.first_name, ''), NULLIF(a.first_name, '')) AS "firstName",
  NULLIF(e.father_name, '') AS "fatherName",
  COALESCE(NULLIF(e.last_name, ''), NULLIF(a.last_name, '')) AS "lastName",
  e.role,
  COALESCE(NULLIF(e.mobile, ''), NULLIF(a.mobile_number, '')) AS mobile,
  e.branch_id AS "branchId",
  COALESCE(NULLIF(b.name, ''), NULLIF(e.branch, ''), NULLIF(jv.branch, '')) AS branch,
  e.department_id AS "departmentId",
  d.name AS "departmentName",
  ${EMPLOYEE_RESIDENCE_SQL} AS residence,
  ${EMPLOYEE_RESIDENCE_SHORT_SQL} AS "residenceShort",
  e.status,
  e.avatar,
  COALESCE(NULLIF(e.job_title, ''), NULLIF(jv.title, '')) AS "jobTitle",
  e.created_at AS "createdAt",
  -- Linked system account (hr_users.id). Contracts.sale_owner_id and other
  -- ownership columns FK to hr_users(id), NOT employees(id) — callers that pick
  -- an "owner" must use this id, not e.id. NULL when the employee has no account.
  (SELECT u.id FROM hr_users u WHERE u.employee_id = e.id AND u.is_active = TRUE ORDER BY u.id LIMIT 1) AS "hrUserId"
`;

const EMPLOYEE_DETAIL_COLS = `
  ${EMPLOYEE_SELECT_COLS},
  COALESCE(e.contacts, '[]'::jsonb) AS contacts,
  COALESCE(e.birth_date, a.dob) AS "birthDate",
  COALESCE(NULLIF(e.gender, ''), NULLIF(a.gender, '')) AS gender,
  COALESCE(NULLIF(e.marital_status, ''), NULLIF(a.marital_status, '')) AS "maritalStatus",
  NULLIF(e.military_service, '') AS "militaryService",
  e.residence_governorate_id AS "residenceGovernorateId",
  COALESCE(NULLIF(gov.name, ''), NULLIF(a.governorate, '')) AS "residenceGovernorate",
  e.residence_region_id AS "residenceRegionId",
  COALESCE(NULLIF(region.name, ''), NULLIF(a.city_or_area, '')) AS "residenceRegion",
  e.residence_sub_area_id AS "residenceSubAreaId",
  COALESCE(NULLIF(sub.name, ''), NULLIF(a.sub_area, '')) AS "residenceSubArea",
  e.residence_neighborhood_id AS "residenceNeighborhoodId",
  COALESCE(NULLIF(neigh.name, ''), NULLIF(a.neighborhood, '')) AS "residenceNeighborhood",
  COALESCE(NULLIF(e.detailed_address, ''), NULLIF(a.detailed_address, '')) AS "detailedAddress",
  COALESCE(NULLIF(e.academic_qualification, ''), NULLIF(a.academic_qualification, '')) AS "academicQualification",
  COALESCE(NULLIF(e.specialization, ''), NULLIF(a.specialization, '')) AS specialization,
  COALESCE(e.years_of_experience, a.years_of_experience) AS "yearsOfExperience",
  COALESCE(e.driving_license, CASE
    WHEN a.driving_license IN ('true', 'TRUE', 'yes', 'YES', '1') THEN TRUE
    WHEN a.driving_license IN ('false', 'FALSE', 'no', 'NO', '0') THEN FALSE
    ELSE NULL
  END) AS "drivingLicense",
  COALESCE(e.has_car, CASE
    WHEN a.has_car = TRUE THEN TRUE
    WHEN a.has_car = FALSE THEN FALSE
    ELSE NULL
  END) AS "hasCar",
  COALESCE(NULLIF(e.job_skills, ''), NULLIF(a.computer_skills, '')) AS "jobSkills",
  COALESCE(e.foreign_languages, '[]'::jsonb) AS "foreignLanguages",
  e.hire_date AS "hireDate",
  e.start_work_date AS "startWorkDate",
  NULLIF(e.contract_type, '') AS "contractType",
  NULLIF(e.work_type, '') AS "workType",
  COALESCE(NULLIF(e.previous_employment, ''), NULLIF(a.previous_employment, '')) AS "previousEmployment",
  e.direct_manager_id AS "directManagerId",
  dm.name AS "directManagerName",
  NULLIF(e.referrer_type, '') AS "referrerType",
  NULLIF(e.source_channel, '') AS "sourceChannel",
  NULLIF(e.referrer_name, '') AS "referrerName",
  NULLIF(e.referral_notes, '') AS "referralNotes",
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
  ja.decision,
  ja.branch_id AS "branchId"
`;

export async function listEmployees(filter?: {
  branchId?: number | null;
  branchIds?: number[] | null;
  includeScheduleAppearanceFlag?: boolean;
}) {
  const scheduleAppearanceSelect = filter?.includeScheduleAppearanceFlag
    ? `, EXISTS (
         SELECT 1
           FROM hr_users su
           JOIN role_permission_grants srpg ON srpg.role_id = su.role_id
           JOIN permissions sp ON sp.id = srpg.permission_id
          WHERE su.employee_id = e.id
            AND su.is_active = TRUE
            AND sp.key = 'planning.schedule.appear'
       ) AS "canAppearInSchedule",
       (SELECT r2.team_slot_type
          FROM hr_users u2
          JOIN roles r2 ON r2.id = u2.role_id
         WHERE u2.employee_id = e.id
           AND u2.is_active = TRUE
         LIMIT 1) AS "teamSlotType"`
    : '';

  // Accept either a single branch (legacy callers) or a union of branches
  // (BRANCH-scope users see every branch they are assigned to, not one).
  const branchIds = filter?.branchIds != null
    ? filter.branchIds
    : (filter?.branchId != null ? [filter.branchId] : null);

  if (branchIds != null) {
    if (branchIds.length === 0) {
      return [];
    }
    const { rows } = await pool.query(
      `SELECT ${EMPLOYEE_SELECT_COLS}
              ${scheduleAppearanceSelect}
       ${HIRED_APPLICATION_JOINS}
       WHERE e.branch_id = ANY($1)
       ORDER BY e.created_at DESC NULLS LAST, e.id DESC`,
      [branchIds]
    );
    return rows;
  }

  const { rows } = await pool.query(
    `SELECT ${EMPLOYEE_SELECT_COLS}
            ${scheduleAppearanceSelect}
     ${HIRED_APPLICATION_JOINS}
     ORDER BY e.created_at DESC NULLS LAST, e.id DESC`
  );
  return rows;
}

export async function getEmployeeBranchId(employeeId: number | string): Promise<number | null> {
  const { rows } = await pool.query('SELECT branch_id FROM employees WHERE id = $1', [employeeId]);
  return rows[0]?.branch_id ?? null;
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

export async function findEmployeeAvatarRecord(employeeId: number | string) {
  const { rows } = await pool.query(
    `SELECT id, avatar, branch_id AS "branchId"
     FROM employees
     WHERE id = $1`,
    [employeeId]
  );
  return rows[0] ?? null;
}

export async function updateHrUserNameByEmployeeId(name: string, employeeId: number | string) {
  await pool.query('UPDATE hr_users SET name = $1 WHERE employee_id = $2', [name, employeeId]);
}

export async function findEmployeeBasic(employeeId: number) {
  const { rows } = await pool.query(
    `SELECT id, name, branch_id AS "branchId", department_id AS "departmentId"
     FROM employees
     WHERE id = $1`,
    [employeeId]
  );
  return rows[0] ?? null;
}

export async function findRoleById(roleId: number) {
  const { rows } = await pool.query(
    'SELECT id, name, display_name, is_active, branch_id, is_template FROM roles WHERE id = $1',
    [roleId]
  );
  return rows[0] ?? null;
}

export async function findBranchById(branchId: number) {
  const { rows } = await pool.query(
    'SELECT id, name FROM branches WHERE id = $1',
    [branchId]
  );
  return rows[0] ?? null;
}

export async function findDepartmentInBranch(departmentId: number, branchId: number) {
  const { rows } = await pool.query(
    `SELECT id, name, branch_id AS "branchId"
     FROM departments
     WHERE id = $1 AND branch_id = $2`,
    [departmentId, branchId]
  );
  return rows[0] ?? null;
}

export async function findGeoUnitsByIds(ids: number[]) {
  if (ids.length === 0) return [];
  const { rows } = await pool.query(
    `SELECT id, name
     FROM geo_units
     WHERE id = ANY($1::int[])`,
    [ids]
  );
  return rows;
}

export async function findEmployeeDuplicateByContactNumbers(
  contactNumbers: string[],
  excludeEmployeeId?: number | string | null,
) {
  if (contactNumbers.length === 0) return null;

  const params: Array<string[] | number | string> = [contactNumbers];
  let where = `
    (
      e.mobile = ANY($1::text[])
      OR EXISTS (
        SELECT 1
        FROM jsonb_array_elements(COALESCE(e.contacts, '[]'::jsonb)) AS c
        WHERE c->>'number' = ANY($1::text[])
      )
    )
  `;

  if (excludeEmployeeId != null) {
    params.push(excludeEmployeeId);
    where += ` AND e.id <> $2`;
  }

  const { rows } = await pool.query(
    `SELECT e.id, e.name, e.employee_number AS "employeeNumber"
     FROM employees e
     WHERE ${where}
     ORDER BY e.id
     LIMIT 1`,
    params
  );

  return rows[0] ?? null;
}

export async function findEmployeeBranchId(employeeId: number): Promise<number | null> {
  const { rows } = await pool.query('SELECT branch_id FROM employees WHERE id = $1', [employeeId]);
  return (rows[0]?.branch_id as number) ?? null;
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

export async function listEmployeeManagerCandidates(branchId: number, departmentId?: number | null) {
  const { rows } = await pool.query(
    `SELECT
      e.id,
      e.name,
      COALESCE(NULLIF(e.job_title, ''), r.display_name) AS "jobTitle",
      e.department_id AS "departmentId",
      d.name AS "departmentName",
      r.display_name AS "roleDisplayName",
      (
        (CASE WHEN $2::int IS NOT NULL AND e.department_id = $2 THEN 1 ELSE 0 END)
        +
        (CASE
          WHEN COALESCE(r.display_name, '') ILIKE '%مدير%'
            OR COALESCE(r.name, '') ILIKE '%manager%'
            OR COALESCE(e.job_title, '') ILIKE '%مدير%'
            OR COALESCE(e.job_title, '') ILIKE '%manager%'
          THEN 1 ELSE 0
        END)
      ) > 0 AS "isRecommendedManager"
    FROM employees e
    JOIN hr_users u ON u.employee_id = e.id AND u.is_active = TRUE
    LEFT JOIN roles r ON r.id = u.role_id
    LEFT JOIN departments d ON d.id = e.department_id
    WHERE e.branch_id = $1
      AND e.status = 'active'
    ORDER BY
      "isRecommendedManager" DESC,
      CASE WHEN $2::int IS NOT NULL AND e.department_id = $2 THEN 0 ELSE 1 END,
      e.name ASC`,
    [branchId, departmentId ?? null]
  );
  return rows;
}

export async function listScopedEmployeeManagerCandidates(branchId: number, departmentId?: number | null) {
  const { rows } = await pool.query(
    `SELECT
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
        COALESCE(r.display_name, '') ILIKE '%مدير%'
        OR COALESCE(r.name, '') ILIKE '%manager%'
        OR COALESCE(e.job_title, '') ILIKE '%مدير%'
        OR COALESCE(e.job_title, '') ILIKE '%manager%'
      )
      AND ($2::int IS NULL OR e.department_id = $2)
    ORDER BY
      "isRecommendedManager" DESC,
      e.name ASC`,
    [branchId, departmentId ?? null]
  );
  return rows;
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
