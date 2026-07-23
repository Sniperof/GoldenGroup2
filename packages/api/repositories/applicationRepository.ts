import type { PoolClient } from 'pg';
import { checkDuplicate } from '../utils/applicationHelpers.js';
import { sanitizeText } from '../utils/sanitize.js';
import { canonicalizeEmployeeReferrer } from '../services/employeeMediatorReference.js';

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
      has_car,
      expected_salary, computer_skills, foreign_languages,
      years_of_experience, cv_url, photo_url, applicant_segment,
      has_whatsapp_primary, has_whatsapp_secondary
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27)
    RETURNING id`,
    [
      applicant.firstName, applicant.lastName, applicant.dob, applicant.gender, applicant.maritalStatus, applicant.email || null,
      applicant.mobileNumber, applicant.secondaryMobile || null,
      applicant.governorate, applicant.cityOrArea || null, applicant.subArea || null, applicant.neighborhood || null, applicant.detailedAddress || null,
      applicant.academicQualification || null, applicant.specialization || null, applicant.previousEmployment || null,
      applicant.drivingLicense || null, applicant.hasCar ?? false, applicant.expectedSalary ? parseInt(applicant.expectedSalary) : null,
      applicant.computerSkills || null, applicant.foreignLanguages || null,
      applicant.yearsOfExperience ? parseInt(applicant.yearsOfExperience) : null,
      applicant.cvUrl || null, applicant.photoUrl || null, applicant.applicantSegment || null,
      applicant.hasWhatsappPrimary || false, applicant.hasWhatsappSecondary || false,
    ]
  );

  return rows[0].id as number;
}

export async function insertReferrer(client: PoolClient, referrer: any) {
  const canonicalReferrer = await canonicalizeEmployeeReferrer(client, referrer);
  const { rows } = await client.query(
    `INSERT INTO referrers (
      type, employee_id, referral_entity_id, full_name, last_name, mobile_number,
      governorate, city_or_area, sub_area, neighborhood,
      detailed_address, referrer_work, referrer_notes
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
    RETURNING id`,
    [
      (canonicalReferrer.type === 'Customer' ? 'Client' : canonicalReferrer.type) || 'Client',
      (canonicalReferrer.type === 'Employee' ? (canonicalReferrer.employeeId ?? null) : null),
      canonicalReferrer.referralEntityId ?? (canonicalReferrer.type === 'Employee' ? (canonicalReferrer.employeeId ?? null) : null) ?? null,
      sanitizeText(canonicalReferrer.fullName), canonicalReferrer.lastName ? sanitizeText(canonicalReferrer.lastName) : null, canonicalReferrer.mobileNumber || null,
      canonicalReferrer.governorate ? sanitizeText(canonicalReferrer.governorate) : null, canonicalReferrer.cityOrArea ? sanitizeText(canonicalReferrer.cityOrArea) : null,
      canonicalReferrer.subArea ? sanitizeText(canonicalReferrer.subArea) : null, canonicalReferrer.neighborhood ? sanitizeText(canonicalReferrer.neighborhood) : null,
      canonicalReferrer.detailedAddress ? sanitizeText(canonicalReferrer.detailedAddress) : null,
      canonicalReferrer.referrerWork ? sanitizeText(canonicalReferrer.referrerWork) : null,
      canonicalReferrer.referrerNotes ? sanitizeText(canonicalReferrer.referrerNotes) : null,
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
    branchId: number;
  },
) {
  const { rows } = await client.query(
    `INSERT INTO job_applications (
      job_vacancy_id, applicant_id, referrer_id, submission_type,
      application_source, entered_by_user_id, entered_by_name,
      current_stage, application_status, duplicate_flag, branch_id
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,'Submitted','New',$8,$9)
    RETURNING id, job_vacancy_id AS "jobVacancyId", applicant_id AS "applicantId",
      referrer_id AS "referrerId", submission_type AS "submissionType",
      application_source AS "applicationSource",
      current_stage AS "currentStage", application_status AS "applicationStatus",
      duplicate_flag AS "duplicateFlag", branch_id AS "branchId", created_at AS "createdAt"`,
    [
      input.jobVacancyId, input.applicantId, input.referrerId,
      input.submissionType, input.applicationSource,
      input.enteredByUserId || null, input.enteredByName || null,
      input.duplicateFlag, input.branchId,
    ]
  );

  return rows[0];
}
