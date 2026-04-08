import type { PoolClient } from 'pg';
import { checkDuplicate } from '../utils/applicationHelpers.js';
import { sanitizeText } from '../utils/sanitize.js';

export async function findVacancyById(client: PoolClient, vacancyId: number) {
  const { rows } = await client.query(
    `SELECT id, status FROM job_vacancies WHERE id = $1`,
    [vacancyId]
  );

  return rows[0] ?? null;
}

export async function checkPublicApplicationDuplicate(
  client: PoolClient,
  mobileNumber: string,
  jobVacancyId: number,
) {
  return checkDuplicate(client, mobileNumber, jobVacancyId);
}

export async function insertApplicant(client: PoolClient, applicant: any) {
  const { rows } = await client.query(
    `INSERT INTO applicants (
      first_name, last_name, dob, gender, marital_status, email,
      mobile_number, secondary_mobile, governorate, city_or_area,
      sub_area, neighborhood, detailed_address,
      academic_qualification, specialization, previous_employment, driving_license,
      expected_salary, computer_skills, foreign_languages,
      years_of_experience, cv_url, photo_url, applicant_segment,
      has_whatsapp_primary, has_whatsapp_secondary
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26)
    RETURNING id`,
    [
      applicant.firstName, applicant.lastName, applicant.dob, applicant.gender, applicant.maritalStatus, applicant.email || null,
      applicant.mobileNumber, applicant.secondaryMobile || null,
      applicant.governorate, applicant.cityOrArea || null, applicant.subArea || null, applicant.neighborhood || null, applicant.detailedAddress || null,
      applicant.academicQualification || null, applicant.specialization || null, applicant.previousEmployment || null,
      applicant.drivingLicense || null, applicant.expectedSalary ? parseInt(applicant.expectedSalary) : null,
      applicant.computerSkills || null, applicant.foreignLanguages || null,
      applicant.yearsOfExperience ? parseInt(applicant.yearsOfExperience) : null,
      applicant.cvUrl || null, applicant.photoUrl || null, applicant.applicantSegment || null,
      applicant.hasWhatsappPrimary || false, applicant.hasWhatsappSecondary || false,
    ]
  );

  return rows[0].id as number;
}

export async function insertReferrer(client: PoolClient, referrer: any) {
  const { rows } = await client.query(
    `INSERT INTO referrers (
      type, employee_id, full_name, last_name, mobile_number,
      governorate, city_or_area, sub_area, neighborhood,
      detailed_address, referrer_work, referrer_notes
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
    RETURNING id`,
    [
      referrer.type || 'Customer', referrer.employeeId || null,
      sanitizeText(referrer.fullName), referrer.lastName ? sanitizeText(referrer.lastName) : null, referrer.mobileNumber || null,
      referrer.governorate ? sanitizeText(referrer.governorate) : null, referrer.cityOrArea ? sanitizeText(referrer.cityOrArea) : null,
      referrer.subArea ? sanitizeText(referrer.subArea) : null, referrer.neighborhood ? sanitizeText(referrer.neighborhood) : null,
      referrer.detailedAddress ? sanitizeText(referrer.detailedAddress) : null,
      referrer.referrerWork ? sanitizeText(referrer.referrerWork) : null,
      referrer.referrerNotes ? sanitizeText(referrer.referrerNotes) : null,
    ]
  );

  return rows[0].id as number;
}

export async function insertJobApplication(
  client: PoolClient,
  input: {
    jobVacancyId: number;
    applicantId: number;
    referrerId: number | null;
    submissionType: string;
    applicationSource: string;
    enteredByUserId?: number | null;
    enteredByName?: string | null;
    duplicateFlag?: boolean;
  },
) {
  const { rows } = await client.query(
    `INSERT INTO job_applications (
      job_vacancy_id, applicant_id, referrer_id, submission_type,
      application_source, entered_by_user_id, entered_by_name,
      current_stage, application_status, duplicate_flag
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,'Submitted','New',$8)
    RETURNING id, job_vacancy_id AS "jobVacancyId", applicant_id AS "applicantId",
      referrer_id AS "referrerId", submission_type AS "submissionType",
      application_source AS "applicationSource",
      current_stage AS "currentStage", application_status AS "applicationStatus",
      duplicate_flag AS "duplicateFlag", created_at AS "createdAt"`,
    [
      input.jobVacancyId, input.applicantId, input.referrerId,
      input.submissionType, input.applicationSource,
      input.enteredByUserId || null, input.enteredByName || null,
      input.duplicateFlag,
    ]
  );

  return rows[0];
}
