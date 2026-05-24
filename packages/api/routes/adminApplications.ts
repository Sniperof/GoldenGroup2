import { Router } from 'express';
import pool from '../db.js';
import { insertAuditLog } from '../utils/auditLog.js';
import {
  validateStageTransition, isTerminalStatus, isTrainingManagedStage,
  validateDecision, getDecisionEffect, deriveApplicationStatus, isTerminalDecision,
  validateStageStatusTransition, isInterviewManagedTransition,
} from '../domain/stageEngine.js';
import { checkVacancyCapacity, checkDuplicate } from '../utils/applicationHelpers.js';
import { sanitizeText } from '../utils/sanitize.js';
import { requirePermission, resolveTargetBranchId } from '../middleware/permission.js';
import {
  deriveEmployeeRoleFromVacancyTitle,
  getApplicationProcessingBlockReason,
  getEmployeeAvatar,
} from '../utils/recruitmentPolicy.js';
import {
  insertPreparedEmployeeProfile,
  prepareEmployeeWriteInput,
} from '../services/employeeService.js';

const router = Router();

const APP_COLS = `
  ja.id, ja.job_vacancy_id AS "jobVacancyId",
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

// -- Dual-write helpers: derive new columns from legacy status --
function deriveStageStatusFromLegacy(stage: string, legacyStatus: string): string {
  const map: Record<string, Record<string, string>> = {
    Submitted:       { New: 'Pending', 'In Review': 'Under Review', Qualified: 'Under Review', Rejected: 'Under Review' },
    Shortlisted:     { Qualified: 'Ready', Rejected: 'Ready' },
    Interview:       { 'Interview Scheduled': 'Scheduled', 'Interview Completed': 'Completed', 'Interview Failed': 'Completed' },
    Training:        { Approved: 'Ready', 'Training Scheduled': 'Scheduled', 'Training Started': 'In Progress', 'Training Completed': 'Completed', Retraining: 'Completed', Rejected: 'Completed' },
    'Final Decision': { Passed: 'Awaiting Decision', 'Final Hired': 'Awaiting Decision', 'Final Rejected': 'Awaiting Decision' },
  };
  return map[stage]?.[legacyStatus] ?? 'Pending';
}

async function assertAppBranchAccess(req: any, res: any, appId: string | number): Promise<boolean> {
  const authContext = req.authContext!;
  if (authContext.isSuperAdmin) return true;
  const { rows } = await pool.query('SELECT branch_id FROM job_applications WHERE id = $1', [appId]);
  if (!rows[0]) { res.status(404).json({ error: 'الطلب غير موجود' }); return false; }
  if (!authContext.allowedBranchIds.includes(rows[0].branch_id)) {
    res.status(403).json({ error: 'غير مسموح' });
    return false;
  }
  return true;
}

function deriveDecisionFromLegacy(legacyStatus: string): string | null {
  const decisionStatuses: Record<string, string> = {
    Qualified: 'Qualified', Rejected: 'Rejected', 'Interview Failed': 'Failed',
    Approved: 'Approved', Retraining: 'Retraining', Passed: 'Passed',
    'Final Hired': 'Hired', 'Final Rejected': 'Rejected', Retreated: 'Retreated',
  };
  return decisionStatuses[legacyStatus] ?? null;
}

// GET /api/admin/applications
/**
 * @swagger
 * /api/admin/applications:
 *   get:
 *     tags: [Admin → Applications]
 *     summary: List job applications
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         schema:
 *           type: integer
 *         required: false
 *       - in: query
 *         name: vacancyId
 *         schema:
 *           type: integer
 *         required: false
 *       - in: query
 *         name: branch
 *         schema:
 *           type: string
 *         required: false
 *       - in: query
 *         name: gender
 *         schema:
 *           type: string
 *         required: false
 *       - in: query
 *         name: stage
 *         schema:
 *           type: string
 *         required: false
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *         required: false
 *       - in: query
 *         name: applicationSource
 *         schema:
 *           type: string
 *         required: false
 *       - in: query
 *         name: isArchived
 *         schema:
 *           type: string
 *         required: false
 *       - in: query
 *         name: branchId
 *         schema:
 *           type: integer
 *         required: false
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         required: false
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *         required: false
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *         required: false
 *     responses:
 *       200:
 *         description: Success
 */
router.get('/', requirePermission('jobs.applications.view_list'), async (req, res) => {
  try {
    const authContext = req.authContext!;
    const { vacancyId, branch, gender, stage, status, search, applicationSource, isArchived } = req.query;
    const conditions: string[] = [];
    const params: any[] = [];
    let idx = 1;

    // Branch scoping
    if (!authContext.isSuperAdmin) {
      conditions.push(`ja.branch_id = ANY($${idx++}::int[])`);
      params.push(authContext.allowedBranchIds);
    } else {
      const hb = Number(req.header('x-branch-id'));
      if (Number.isFinite(hb) && hb > 0) {
        conditions.push(`ja.branch_id = $${idx++}`);
        params.push(hb);
      }
    }

    if (vacancyId) { conditions.push(`ja.job_vacancy_id = $${idx++}`); params.push(vacancyId); }
    if (branch) { conditions.push(`jv.branch = $${idx++}`); params.push(branch); }
    if (gender) { conditions.push(`a.gender = $${idx++}`); params.push(gender); }
    if (stage) { conditions.push(`ja.current_stage = $${idx++}`); params.push(stage); }
    if (status) { conditions.push(`ja.application_status = $${idx++}`); params.push(status); }
    if (applicationSource) { conditions.push(`ja.application_source = $${idx++}`); params.push(applicationSource); }
    if (search) {
      conditions.push(`(
        CAST(ja.id AS TEXT) LIKE $${idx}
        OR a.mobile_number LIKE $${idx}
        OR a.first_name ILIKE $${idx}
        OR a.last_name ILIKE $${idx}
      )`);
      params.push(`%${search}%`);
      idx++;
    }
    // M4.2: archived filter — default to non-archived
    if (isArchived === 'true') {
      conditions.push(`ja.is_archived = TRUE`);
    } else {
      conditions.push(`(ja.is_archived = FALSE OR ja.is_archived IS NULL)`);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const { rows } = await pool.query(
      `SELECT ${APP_COLS},
        a.first_name AS "applicantFirstName",
        a.last_name AS "applicantLastName",
        a.mobile_number AS "applicantMobile",
        a.gender AS "applicantGender",
        a.dob AS "applicantDob",
        a.governorate AS "applicantGovernorate",
        a.city_or_area AS "applicantCityOrArea",
        a.academic_qualification AS "applicantAcademicQualification",
        a.specialization AS "applicantSpecialization",
        a.driving_license AS "applicantDrivingLicense",
        a.has_car AS "applicantHasCar",
        a.computer_skills AS "applicantComputerSkills",
        a.years_of_experience AS "applicantYearsOfExperience",
        jv.title AS "vacancyTitle",
        jv.branch AS "vacancyBranch",
        jv.governorate AS "vacancyGovernorate",
        jv.city_or_area AS "vacancyCityOrArea",
        jv.required_gender AS "vacancyRequiredGender",
        jv.required_age_min AS "vacancyRequiredAgeMin",
        jv.required_age_max AS "vacancyRequiredAgeMax",
        jv.required_certificate AS "vacancyRequiredCertificate",
        jv.required_major AS "vacancyRequiredMajor",
        jv.required_experience_years AS "vacancyRequiredExperienceYears",
        jv.required_skills AS "vacancyRequiredSkills",
        jv.driving_license_required AS "vacancyDrivingLicenseRequired",
        jv.has_car_required AS "vacancyHasCarRequired",
        EXISTS (
          SELECT 1
          FROM interviews i
          WHERE i.application_id = ja.id
            AND i.interview_status = 'Interview Scheduled'
        ) AS "hasScheduledInterview"
      FROM job_applications ja
      JOIN applicants a ON a.id = ja.applicant_id
      LEFT JOIN job_vacancies jv ON jv.id = ja.job_vacancy_id
      ${where}
      ORDER BY ja.created_at DESC`,
      params
    );
    res.json(rows);
  } catch (err: any) {
    console.error('Error fetching applications:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/applications — manual admin entry (Internal / External Platforms)
/**
 * @swagger
 * /api/admin/applications:
 *   post:
 *     tags: [Admin → Applications]
 *     summary: Create job application (Internal/External entry)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         schema:
 *           type: integer
 *         required: false
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [jobVacancyId, submissionType, applicationSource, applicant]
 *             properties:
 *               jobVacancyId:
 *                 type: integer
 *               submissionType:
 *                 type: string
 *                 enum: [Apply, Refer a Candidate]
 *               applicationSource:
 *                 type: string
 *               branchId:
 *                 type: integer
 *               enteredByName:
 *                 type: string
 *               applicant:
 *                 type: object
 *                 required: [firstName, lastName, mobileNumber, dob, gender, maritalStatus, governorate, detailedAddress, hasCar]
 *                 properties:
 *                   firstName:
 *                     type: string
 *                   lastName:
 *                     type: string
 *                   dob:
 *                     type: string
 *                   gender:
 *                     type: string
 *                   maritalStatus:
 *                     type: string
 *                   email:
 *                     type: string
 *                   mobileNumber:
 *                     type: string
 *                   secondaryMobile:
 *                     type: string
 *                   governorate:
 *                     type: string
 *                   cityOrArea:
 *                     type: string
 *                   subArea:
 *                     type: string
 *                   neighborhood:
 *                     type: string
 *                   detailedAddress:
 *                     type: string
 *                   hasCar:
 *                     type: boolean
 *               referrer:
 *                 type: object
 *                 properties:
 *                   type:
 *                     type: string
 *                     enum: [Client, Employee]
 *                   fullName:
 *                     type: string
 *                   lastName:
 *                     type: string
 *                   mobileNumber:
 *                     type: string
 *     responses:
 *       201:
 *         description: Created
 */
router.post('/', requirePermission('jobs.applications.create'), async (req, res) => {
  const client = await pool.connect();
  try {
    const body = req.body;
    const a = body.applicant || {};

    if (!a.firstName?.trim()) return res.status(400).json({ error: 'الاسم الأول مطلوب' });
    if (!a.lastName?.trim()) return res.status(400).json({ error: 'اسم العائلة مطلوب' });
    if (!a.mobileNumber?.trim()) return res.status(400).json({ error: 'رقم الجوال مطلوب' });
    if (!/^\d{10,11}$/.test(a.mobileNumber)) return res.status(400).json({ error: 'رقم الجوال يجب أن يكون من 10 إلى 11 رقمًا' });
    if (a.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a.email)) return res.status(400).json({ error: 'البريد الإلكتروني غير صالح' });
    if (!a.dob) return res.status(400).json({ error: 'تاريخ الميلاد مطلوب' });
    if (!a.gender) return res.status(400).json({ error: 'الجنس مطلوب' });
    if (!a.maritalStatus) return res.status(400).json({ error: 'الحالة الاجتماعية مطلوبة' });
    if (!a.governorate?.trim()) return res.status(400).json({ error: 'المحافظة مطلوبة' });
    if (!a.detailedAddress?.trim()) return res.status(400).json({ error: 'العنوان التفصيلي مطلوب' });
    if (typeof a.hasCar !== 'boolean') return res.status(400).json({ error: 'يرجى تحديد هل تمتلك سيارة' });

    const jobVacancyId = Number(body.jobVacancyId);
    if (!Number.isInteger(jobVacancyId) || jobVacancyId <= 0) {
      return res.status(400).json({ error: 'الشاغر الوظيفي حقل إلزامي' });
    }

    const submissionType = body.submissionType;
    if (!['Apply', 'Refer a Candidate'].includes(submissionType)) {
      return res.status(400).json({ error: 'نوع الإرسال غير صالح' });
    }
    const applicationSource = body.applicationSource;
    if (!applicationSource) {
      return res.status(400).json({ error: 'مصدر الطلب مطلوب' });
    }
    // enteredByUserId now comes from auth context
    if (submissionType === 'Refer a Candidate' && !body.referrer?.fullName?.trim()) {
      return res.status(400).json({ error: 'اسم المحيل مطلوب عند الإحالة' });
    }

    await client.query('BEGIN');

    // Resolve branch_id: derived from vacancy if linked, otherwise from user/body
    let applicationBranchId: number | null = null;

    // Vacancy: if linked, must be Open and within date range
    if (jobVacancyId) {
      const { rows: vacRows } = await client.query(
        `SELECT id, status, branch_id FROM job_vacancies
         WHERE id = $1 AND status = 'Open' AND CURRENT_DATE BETWEEN start_date AND end_date`,
        [jobVacancyId]
      );
      if (vacRows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'الشاغر غير موجود أو غير متاح للتقديم' });
      }
      applicationBranchId = vacRows[0].branch_id;
      if (!applicationBranchId) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'تعذر تحديد فرع الشاغر' });
      }
      // Branch-admin can only apply to their own branch's vacancies
      const authContext = req.authContext!;
      if (!authContext.isSuperAdmin && !authContext.allowedBranchIds.includes(applicationBranchId)) {
        await client.query('ROLLBACK');
        return res.status(403).json({ error: 'غير مسموح: فرع الشاغر خارج النطاق المسموح' });
      }
    } else {
      // No vacancy: resolve from scope/body
      const resolved = resolveTargetBranchId(req, res, body.branchId);
      if (resolved == null) { await client.query('ROLLBACK'); return; }
      applicationBranchId = resolved;
    }
    if (applicationBranchId == null) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'تعذر تحديد فرع الطلب' });
    }

    // Duplicate check
    const dupResult = await checkDuplicate(client, a.mobileNumber, jobVacancyId);
    if (dupResult.blocked) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: 'يوجد طلب نشط بالفعل لهذا الرقم والشاغر الوظيفي',
        duplicateApplicationId: dupResult.duplicateApplicationId,
      });
    }
    const duplicateFlag = 'duplicateFlag' in dupResult ? dupResult.duplicateFlag : undefined;

    // Insert applicant
    const { rows: applicantRows } = await client.query(
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
        a.firstName, a.lastName, a.dob, a.gender, a.maritalStatus, a.email || null,
        a.mobileNumber, a.secondaryMobile || null,
        a.governorate, a.cityOrArea || null, a.subArea || null, a.neighborhood || null, a.detailedAddress || null,
        a.academicQualification || null, a.specialization || null, a.previousEmployment || null,
        a.drivingLicense || null, a.hasCar ?? false, a.expectedSalary ? parseInt(a.expectedSalary) : null,
        a.computerSkills || null, a.foreignLanguages || null,
        a.yearsOfExperience ? parseInt(a.yearsOfExperience) : null,
        a.cvUrl || null, a.photoUrl || null, a.applicantSegment || null,
        a.hasWhatsappPrimary || false, a.hasWhatsappSecondary || false,
      ]
    );
    const applicantId = applicantRows[0].id;
    const enteredByUserId = req.user!.id;

    // Insert referrer if 'Refer a Candidate'
    let referrerId: number | null = null;
    if (submissionType === 'Refer a Candidate' && body.referrer) {
      const r = body.referrer;
      const normalizedReferrerType = r.type === 'Customer' ? 'Client' : r.type;
      const referrerEntityId = normalizedReferrerType === 'Employee'
        ? (r.referralEntityId ?? r.employeeId ?? null)
        : (r.referralEntityId ?? null);
      const { rows: refRows } = await client.query(
        `INSERT INTO referrers (
          type, employee_id, referral_entity_id, full_name, last_name, mobile_number,
          governorate, city_or_area, sub_area, neighborhood,
          detailed_address, referrer_work, referrer_notes
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
        RETURNING id`,
        [
          normalizedReferrerType || 'Client',
          normalizedReferrerType === 'Employee' ? (r.employeeId ?? null) : null,
          referrerEntityId,
          sanitizeText(r.fullName), r.lastName ? sanitizeText(r.lastName) : null, r.mobileNumber || null,
          r.governorate ? sanitizeText(r.governorate) : null, r.cityOrArea ? sanitizeText(r.cityOrArea) : null,
          r.subArea ? sanitizeText(r.subArea) : null, r.neighborhood ? sanitizeText(r.neighborhood) : null,
          r.detailedAddress ? sanitizeText(r.detailedAddress) : null,
          r.referrerWork ? sanitizeText(r.referrerWork) : null,
          r.referrerNotes ? sanitizeText(r.referrerNotes) : null,
        ]
      );
      referrerId = refRows[0].id;
    }

    // Insert application
    const { rows: appRows } = await client.query(
      `INSERT INTO job_applications (
        job_vacancy_id, applicant_id, referrer_id, submission_type,
        application_source, entered_by_user_id, entered_by_name,
        current_stage, application_status, duplicate_flag,
        stage_status, decision, branch_id
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,'Submitted','New',$8,'Pending',NULL,$9)
      RETURNING id, job_vacancy_id AS "jobVacancyId", applicant_id AS "applicantId",
        referrer_id AS "referrerId", submission_type AS "submissionType",
        application_source AS "applicationSource",
        entered_by_user_id AS "enteredByUserId", entered_by_name AS "enteredByName",
        current_stage AS "currentStage", application_status AS "applicationStatus",
        duplicate_flag AS "duplicateFlag", created_at AS "createdAt",
        stage_status AS "stageStatus", decision`,
      [
        jobVacancyId, applicantId, referrerId,
        submissionType, applicationSource,
        enteredByUserId, body.enteredByName || null,
        duplicateFlag, applicationBranchId,
      ]
    );

    await insertAuditLog(client, {
      entityType: 'job_application',
      entityId: appRows[0].id,
      applicationId: appRows[0].id,
      actionType: 'Application Submitted (Admin)',
      performedByRole: req.user!.role,
      performedByUserId: req.user!.id,
      newValue: JSON.stringify({
        applicantId, referrerId,
        jobVacancyId,
        submissionType, applicationSource, duplicateFlag,
      }),
    });

    await client.query('COMMIT');
    res.status(201).json(appRows[0]);
  } catch (err: any) {
    await client.query('ROLLBACK');
    console.error('Error creating admin application:', err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// GET /api/admin/applications/:id
/**
 * @swagger
 * /api/admin/applications/{id}:
 *   get:
 *     tags: [Admin → Applications]
 *     summary: Get job application details by ID
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         schema:
 *           type: integer
 *         required: false
 *       - in: path
 *         name: id
 *         schema:
 *           type: integer
 *         required: true
 *     responses:
 *       200:
 *         description: Success
 *       404:
 *         description: Not Found
 */
router.get('/:id', requirePermission('jobs.applications.view_detail'), async (req, res) => {
  try {
    const authContext = req.authContext!;
    const { rows: appRows } = await pool.query(
      `SELECT ${APP_COLS}, ja.branch_id AS "branchId" FROM job_applications ja WHERE ja.id = $1`,
      [req.params.id]
    );
    if (appRows.length === 0) return res.status(404).json({ error: 'الطلب غير موجود' });
    const app = appRows[0];
    if (!authContext.isSuperAdmin && !authContext.allowedBranchIds.includes(app.branchId)) {
    res.status(403).json({ error: 'غير مسموح' });
    }

    // Fetch applicant
    const { rows: applicantRows } = await pool.query(
      `SELECT id, first_name AS "firstName", last_name AS "lastName",
        dob, gender, marital_status AS "maritalStatus", email,
        mobile_number AS "mobileNumber", secondary_mobile AS "secondaryMobile",
        governorate, city_or_area AS "cityOrArea",
        sub_area AS "subArea", neighborhood, detailed_address AS "detailedAddress",
        academic_qualification AS "academicQualification",
        specialization,
        previous_employment AS "previousEmployment",
        driving_license AS "drivingLicense",
        has_car AS "hasCar",
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
      [app.applicantId]
    );

    // Fetch vacancy
    const { rows: vacancyRows } = await pool.query(
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
        has_car_required AS "hasCarRequired",
        vacancy_count AS "vacancyCount",
        start_date AS "startDate", end_date AS "endDate",
        status, created_at AS "createdAt", updated_at AS "updatedAt"
      FROM job_vacancies WHERE id = $1`,
      [app.jobVacancyId]
    );

    // Fetch referrer
    let referrer = null;
    if (app.referrerId) {
      const { rows: refRows } = await pool.query(
        `SELECT id, type, employee_id AS "employeeId", referral_entity_id AS "referralEntityId",
          full_name AS "fullName", last_name AS "lastName",
          mobile_number AS "mobileNumber", governorate,
          city_or_area AS "cityOrArea", sub_area AS "subArea",
          neighborhood, detailed_address AS "detailedAddress",
          referrer_work AS "referrerWork", referrer_notes AS "referrerNotes"
        FROM referrers WHERE id = $1`,
        [app.referrerId]
      );
      if (refRows.length > 0) referrer = refRows[0];
    }

    // Fetch interviews
    const { rows: interviewRows } = await pool.query(
      `SELECT id, application_id AS "applicationId",
        interview_type AS "interviewType",
        interview_number AS "interviewNumber",
        interviewer_name AS "interviewerName",
        interview_date AS "interviewDate",
        interview_time AS "interviewTime",
        interview_status AS "interviewStatus",
        internal_notes AS "internalNotes",
        created_at AS "createdAt"
      FROM interviews WHERE application_id = $1
      ORDER BY created_at ASC`,
      [req.params.id]
    );

    // Fetch training enrollments with course info
    const { rows: trainingRows } = await pool.query(
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
      [req.params.id]
    );

    res.json({
      ...app,
      applicant: applicantRows[0] || null,
      vacancy: vacancyRows[0] || null,
      referrer,
      interviews: interviewRows,
      trainings: trainingRows,
    });
  } catch (err: any) {
    console.error('Error fetching application detail:', err);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/admin/applications/:id/stage
/**
 * @swagger
 * /api/admin/applications/{id}/stage:
 *   patch:
 *     tags: [Admin → Applications]
 *     summary: Transition application to a new stage
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         schema:
 *           type: integer
 *         required: false
 *       - in: path
 *         name: id
 *         schema:
 *           type: integer
 *         required: true
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [stage, status]
 *             properties:
 *               stage:
 *                 type: string
 *               status:
 *                 type: string
 *               internalNotes:
 *                 type: string
 *     responses:
 *       200:
 *         description: Success
 */
router.patch('/:id/stage', requirePermission('jobs.applications.change_stage'), async (req, res) => {
  const client = await pool.connect();
  try {
    const { stage, status, internalNotes } = req.body;
    const appId = req.params.id as string;
    if (!(await assertAppBranchAccess(req, res, appId))) { client.release(); return; }

    const { rows: currentRows } = await client.query(
      `SELECT ja.current_stage, ja.application_status,
        ja.stage_status, ja.decision, ja.is_escalated,
        jv.max_retraining_count
       FROM job_applications ja
       JOIN job_vacancies jv ON jv.id = ja.job_vacancy_id
       WHERE ja.id = $1`,
      [appId]
    );
    if (currentRows.length === 0) return res.status(404).json({ error: 'الطلب غير موجود' });
    const current = currentRows[0];
    const blockReason = getApplicationProcessingBlockReason(req.user?.role, {
      currentStage: current.current_stage,
      isEscalated: current.is_escalated,
    });
    if (blockReason) return res.status(403).json({ error: blockReason });

    // Block: escalated applications are frozen
    if (current.is_escalated) {
      return res.status(409).json({
        error: 'لا يمكن تعديل هذا الطلب: الطلب مصعّد. راجع مسار التصعيد أولاً.',
      });
    }

    // Block: Training stage transitions go exclusively through the training module
    if (isTrainingManagedStage(current.current_stage)) {
      return res.status(400).json({
        error: 'لا يمكن تعديل هذا الطلب لأن المرحلة التدريبية تُدار من وحدة التدريب حصريًا.',
      });
    }

    // Block: Interview result transitions go exclusively through the interview module
    if (isInterviewManagedTransition(current.current_stage, current.application_status, status)) {
      return res.status(400).json({
        error: 'لا يمكن تعديل هذا الطلب لأن انتقالات نتيجة المقابلة تُدار من وحدة المقابلات حصريًا.',
      });
    }

    // Count existing retraining transitions for this application
    let retrainingCount = 0;
    if (status === 'Retraining') {
      const { rows: rtRows } = await client.query(
        `SELECT COUNT(*) FROM audit_logs
         WHERE application_id = $1 AND action_type = 'Stage Transition'
           AND new_value LIKE '%"Retraining"%'`,
        [appId]
      );
      retrainingCount = parseInt(rtRows[0].count);
    }

    const validationError = validateStageTransition(
      current.current_stage, current.application_status,
      stage, status,
      { retrainingCount, maxRetrainingCount: 999 }
    );
    if (validationError) return res.status(400).json({ error: validationError });

    await client.query('BEGIN');

    // Derive new stage_status and decision from the legacy status for dual-write
    const derivedStageStatus = deriveStageStatusFromLegacy(stage, status);
    const derivedDecision = deriveDecisionFromLegacy(status);

    const { rows } = await client.query(
      `UPDATE job_applications SET
        current_stage = $1,
        application_status = $2,
        stage_status = $3,
        decision = $4,
        internal_notes = COALESCE($5, internal_notes),
        updated_at = NOW()
      WHERE id = $6
      RETURNING id, current_stage AS "currentStage", application_status AS "applicationStatus",
        stage_status AS "stageStatus", decision, updated_at AS "updatedAt"`,
      [stage, status, derivedStageStatus, derivedDecision, internalNotes || null, appId]
    );

    await insertAuditLog(client, {
      entityType: 'job_application',
      entityId: parseInt(appId),
      applicationId: parseInt(appId),
      actionType: 'Stage Transition',
      performedByRole: req.user!.role,
      performedByUserId: req.user!.id,
      oldValue: JSON.stringify({
        stage: current.current_stage, status: current.application_status,
        stageStatus: current.stage_status, decision: current.decision,
      }),
      newValue: JSON.stringify({ stage, status, stageStatus: derivedStageStatus, decision: derivedDecision }),
      internalReason: internalNotes || null,
    });

    await client.query('COMMIT');
    res.json(rows[0]);
  } catch (err: any) {
    await client.query('ROLLBACK');
    console.error('Error updating application stage:', err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// PATCH /api/admin/applications/:id/hire — Final Hired (no override allowed)
/**
 * @swagger
 * /api/admin/applications/{id}/hire:
 *   patch:
 *     tags: [Admin → Applications]
 *     summary: Finalize hiring for an application
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         schema:
 *           type: integer
 *         required: false
 *       - in: path
 *         name: id
 *         schema:
 *           type: integer
 *         required: true
 *     responses:
 *       200:
 *         description: Success
 */
router.patch('/:id/hire', requirePermission('jobs.applications.hire'), async (req, res) => {
  const client = await pool.connect();
  try {
    const appId = req.params.id as string;
    if (!(await assertAppBranchAccess(req, res, appId))) { client.release(); return; }

    await client.query('BEGIN');

    const { rows: appRows } = await client.query(
      `SELECT ja.id, ja.job_vacancy_id, ja.current_stage, ja.application_status, ja.is_escalated,
        jv.id AS vacancy_id
      FROM job_applications ja
      JOIN job_vacancies jv ON jv.id = ja.job_vacancy_id
      WHERE ja.id = $1`,
      [appId]
    );
    if (appRows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'الطلب غير موجود' });
    }
    const app = appRows[0];
    const blockReason = getApplicationProcessingBlockReason(req.user?.role, {
      currentStage: app.current_stage,
      isEscalated: app.is_escalated,
    });
    if (blockReason) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: blockReason });
    }

    // Block: escalated applications are frozen
    if (app.is_escalated) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: 'لا يمكن تعديل هذا الطلب: الطلب مصعّد. راجع مسار التصعيد أولاً.',
      });
    }

    // Must be at Final Decision with Passed status
    if (app.current_stage !== 'Final Decision' || app.application_status !== 'Passed') {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'لا يمكن التوظيف إلا من حالة "القرار النهائي" مع حالة "مقبول".',
      });
    }

    // Capacity check — no override allowed (FOR UPDATE lock is inside checkVacancyCapacity)
    const capacity = await checkVacancyCapacity(client, app.vacancy_id);
    if (!capacity.sufficient) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'لا يمكن التوظيف الآن. الشاغر لا يحتوي على مقاعد كافية.',
        vacancyCount: capacity.vacancyCount,
      });
    }

    await client.query(
      `UPDATE job_applications SET
        application_status = 'Final Hired',
        decision = 'Hired',
        updated_at = NOW()
      WHERE id = $1`,
      [appId]
    );

    const { rows: vacRows } = await client.query(
      `UPDATE job_vacancies SET
        vacancy_count = vacancy_count - 1,
        status = CASE WHEN vacancy_count - 1 <= 0 THEN 'Closed' ELSE status END,
        updated_at = NOW()
      WHERE id = $1
      RETURNING vacancy_count AS "vacancyCount", status`,
      [app.vacancy_id]
    );

    await insertAuditLog(client, {
      entityType: 'job_application',
      entityId: parseInt(appId),
      applicationId: parseInt(appId),
      actionType: 'Final Hired',
      performedByRole: req.user!.role,
      performedByUserId: req.user!.id,
      oldValue: JSON.stringify({ stage: app.current_stage, status: app.application_status }),
      newValue: JSON.stringify({
        stage: 'Final Decision', status: 'Final Hired',
        remainingSlots: vacRows[0]?.vacancyCount,
      }),
    });

    await client.query('COMMIT');
    res.json({
      applicationId: parseInt(appId),
      applicationStatus: 'Final Hired',
      currentStage: 'Final Decision',
      vacancyCount: vacRows[0]?.vacancyCount,
      vacancyStatus: vacRows[0]?.status,
    });
  } catch (err: any) {
    await client.query('ROLLBACK');
    console.error('Error hiring applicant:', err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// PATCH /api/admin/applications/:id/decision — New decision endpoint (stage_status/decision model)
/**
 * @swagger
 * /api/admin/applications/{id}/employee:
 *   post:
 *     tags: [Admin → Applications]
 *     summary: Mint an employee profile for a hired candidate
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         schema:
 *           type: integer
 *         required: false
 *       - in: path
 *         name: id
 *         schema:
 *           type: integer
 *         required: true
 *     responses:
 *       201:
 *         description: Created
 */
router.post('/:id/employee', requirePermission('employees.create'), async (req, res) => {
  const client = await pool.connect();
  try {
    const appId = req.params.id as string;
    if (!(await assertAppBranchAccess(req, res, appId))) { client.release(); return; }

    await client.query('BEGIN');

    const { rows: appRows } = await client.query(
      `SELECT ja.id, ja.current_stage, ja.application_status, ja.is_escalated,
        ja.hired_employee_id AS "hiredEmployeeId",
        ja.submission_type AS "submissionType",
        ja.application_source AS "applicationSource",
        a.first_name AS "firstName",
        a.last_name AS "lastName",
        a.mobile_number AS "mobileNumber",
        a.secondary_mobile AS "secondaryMobile",
        a.has_whatsapp_primary AS "hasWhatsappPrimary",
        a.has_whatsapp_secondary AS "hasWhatsappSecondary",
        a.dob AS "birthDate",
        a.gender,
        a.marital_status AS "maritalStatus",
        a.email,
        a.governorate AS "governorate",
        a.city_or_area AS "cityOrArea",
        a.sub_area AS "subArea",
        a.neighborhood AS "neighborhood",
        a.detailed_address AS "detailedAddress",
        a.photo_url AS "photoUrl",
        a.academic_qualification AS "academicQualification",
        a.specialization,
        a.previous_employment AS "previousEmployment",
        a.driving_license AS "drivingLicense",
        a.has_car AS "hasCar",
        a.computer_skills AS "computerSkills",
        a.foreign_languages AS "foreignLanguages",
        a.years_of_experience AS "yearsOfExperience",
        jv.title AS "vacancyTitle",
        jv.branch AS "vacancyBranch",
        jv.branch_id AS "vacancyBranchId",
        jv.work_type AS "vacancyWorkType",
        jv.has_car_required AS "vacancyHasCarRequired",
        ja.branch_id AS "applicationBranchId",
        r.type AS "referrerType",
        r.full_name AS "referrerName",
        r.referrer_notes AS "referralNotes"
       FROM job_applications ja
       JOIN applicants a ON a.id = ja.applicant_id
       LEFT JOIN job_vacancies jv ON jv.id = ja.job_vacancy_id
       LEFT JOIN referrers r ON r.id = ja.referrer_id
       WHERE ja.id = $1
       FOR UPDATE OF ja`,
      [appId]
    );

    if (appRows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'الطلب غير موجود' });
    }

    const app = appRows[0];
    const blockReason = getApplicationProcessingBlockReason(req.user?.role, {
      currentStage: app.current_stage,
      isEscalated: app.is_escalated,
    });
    if (blockReason) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: blockReason });
    }

    if (app.current_stage !== 'Final Decision' || app.application_status !== 'Final Hired') {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'لا يمكن إنشاء سجل موظف إلا بعد اعتماد القرار النهائي كمقبول.',
      });
    }

    if (app.hiredEmployeeId) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'تم إنشاء سجل الموظف لهذا الطلب مسبقًا.' });
    }

    const employeeBranchId = app.vacancyBranchId ?? app.applicationBranchId ?? null;
    if (!employeeBranchId) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'تعذر تحديد فرع الموظف من الطلب' });
    }

    const fallbackContacts = [
      app.mobileNumber ? {
        id: 'application-contact-1',
        type: 'mobile',
        number: app.mobileNumber,
        label: 'أساسي',
        hasWhatsApp: Boolean(app.hasWhatsappPrimary),
        status: 'active',
      } : null,
      app.secondaryMobile ? {
        id: 'application-contact-2',
        type: 'mobile',
        number: app.secondaryMobile,
        label: 'بديل',
        hasWhatsApp: Boolean(app.hasWhatsappSecondary),
        status: 'active',
      } : null,
    ].filter(Boolean);

    const mergedBody = {
      ...req.body,
      firstName: req.body?.firstName ?? app.firstName ?? '',
      lastName: req.body?.lastName ?? app.lastName ?? '',
      mobile: req.body?.mobile ?? app.mobileNumber ?? '',
      contacts: Array.isArray(req.body?.contacts) && req.body.contacts.length > 0 ? req.body.contacts : fallbackContacts,
      birthDate: req.body?.birthDate ?? app.birthDate ?? '',
      gender: req.body?.gender ?? app.gender ?? '',
      maritalStatus: req.body?.maritalStatus ?? app.maritalStatus ?? '',
      detailedAddress: req.body?.detailedAddress ?? app.detailedAddress ?? '',
      avatar: req.body?.avatar ?? app.photoUrl ?? null,
      jobTitle: req.body?.jobTitle ?? app.vacancyTitle ?? '',
      academicQualification: req.body?.academicQualification ?? app.academicQualification ?? '',
      specialization: req.body?.specialization ?? app.specialization ?? '',
      yearsOfExperience: req.body?.yearsOfExperience ?? app.yearsOfExperience ?? '',
      drivingLicense: req.body?.drivingLicense ?? app.drivingLicense ?? null,
      jobSkills: req.body?.jobSkills ?? app.computerSkills ?? '',
      foreignLanguages: req.body?.foreignLanguages ?? app.foreignLanguages ?? [],
      workType: req.body?.workType ?? app.vacancyWorkType ?? '',
      previousEmployment: req.body?.previousEmployment ?? app.previousEmployment ?? '',
      status: req.body?.status ?? 'active',
      referrerType: req.body?.referrerType
        ?? app.referrerType
        ?? (app.submissionType === 'Refer a Candidate' ? 'Unknown' : null),
      sourceChannel: req.body?.sourceChannel ?? app.applicationSource ?? null,
      referrerName: req.body?.referrerName ?? app.referrerName ?? null,
      referralNotes: req.body?.referralNotes ?? app.referralNotes ?? null,
    };

    const prepared = await prepareEmployeeWriteInput(mergedBody, employeeBranchId);
    const employeeId = await insertPreparedEmployeeProfile(client, prepared);

    const { rows: employeeRows } = await client.query(
      `SELECT
        id,
        employee_number AS "employeeNumber",
        name,
        role,
        mobile,
        branch,
        branch_id AS "branchId",
        residence,
        status,
        avatar,
        job_title AS "jobTitle",
        created_at AS "createdAt"
       FROM employees
       WHERE id = $1`,
      [employeeId]
    );

    const employee = employeeRows[0];

    await client.query(
      `UPDATE job_applications
       SET hired_employee_id = $1, updated_at = NOW()
       WHERE id = $2`,
      [employee.id, appId]
    );

    await insertAuditLog(client, {
      entityType: 'job_application',
      entityId: parseInt(appId),
      applicationId: parseInt(appId),
      actionType: 'Employee Record Created',
      performedByRole: req.user!.role,
      performedByUserId: req.user!.id,
      newValue: JSON.stringify({
        employeeId: employee.id,
        employeeNumber: employee.employeeNumber ?? null,
        employeeName: employee.name,
        role: employee.role,
        jobTitle: employee.jobTitle,
      }),
    });

    await client.query('COMMIT');
    res.status(201).json(employee);
  } catch (err: any) {
    await client.query('ROLLBACK');
    if (err?.status) {
      return res.status(err.status).json(err.payload ?? { error: err.message });
    }
    console.error('Error creating employee from application:', err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

/**
 * @swagger
 * /api/admin/applications/{id}/employee-legacy-disabled:
 *   post:
 *     tags: [Admin → Applications]
 *     summary: Legacy disabled employee endpoint
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         schema:
 *           type: integer
 *         required: false
 *       - in: path
 *         name: id
 *         schema:
 *           type: integer
 *         required: true
 *     responses:
 *       200:
 *         description: Success
 */
router.post('/:id/employee-legacy-disabled', requirePermission('employees.create'), async (req, res) => {
  const client = await pool.connect();
  try {
    const appId = req.params.id as string;
    if (!(await assertAppBranchAccess(req, res, appId))) { client.release(); return; }

    await client.query('BEGIN');

    const { rows: appRows } = await client.query(
      `SELECT ja.id, ja.current_stage, ja.application_status, ja.is_escalated,
        ja.hired_employee_id AS "hiredEmployeeId",
        a.first_name AS "firstName", a.last_name AS "lastName",
       a.mobile_number AS "mobileNumber",
        a.governorate AS "governorate",
       a.city_or_area AS "cityOrArea",
       a.sub_area AS "subArea",
       a.neighborhood AS "neighborhood",
       a.detailed_address AS "detailedAddress",
       a.photo_url AS "photoUrl",
       jv.title AS "vacancyTitle",
       jv.branch AS "vacancyBranch",
       jv.branch_id AS "vacancyBranchId",
       ja.branch_id AS "applicationBranchId"
       FROM job_applications ja
       JOIN applicants a ON a.id = ja.applicant_id
       LEFT JOIN job_vacancies jv ON jv.id = ja.job_vacancy_id
       WHERE ja.id = $1
       FOR UPDATE OF ja`,
      [appId]
    );

    if (appRows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'الطلب غير موجود' });
    }

    const app = appRows[0];
    const blockReason = getApplicationProcessingBlockReason(req.user?.role, {
      currentStage: app.current_stage,
      isEscalated: app.is_escalated,
    });
    if (blockReason) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: blockReason });
    }

    if (app.current_stage !== 'Final Decision' || app.application_status !== 'Final Hired') {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'لا يمكن إنشاء سجل موظف إلا بعد اعتماد القرار النهائي كمقبول.',
      });
    }

    if (app.hiredEmployeeId) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'تم إنشاء سجل الموظف لهذا الطلب مسبقًا.' });
    }

    // Derive the legacy operational role — may be null for job titles outside
    // supervisor / technician / telemarketer; that is acceptable since the DB
    // CHECK constraint has been dropped and role is now nullable.
    const role = deriveEmployeeRoleFromVacancyTitle(app.vacancyTitle);

    const fullName = `${app.firstName ?? ''} ${app.lastName ?? ''}`.trim();
    const avatar = getEmployeeAvatar(fullName, app.photoUrl);
    const residence = [
      app.governorate,
      app.cityOrArea,
      app.subArea,
      app.neighborhood,
      app.detailedAddress,
    ].filter(Boolean).join(' - ') || null;

    const employeeBranchId = app.vacancyBranchId ?? app.applicationBranchId ?? null;
    if (!employeeBranchId) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'تعذر تحديد فرع الموظف من الطلب' });
    }

    const { rows: employeeRows } = await client.query(
      `INSERT INTO employees (name, role, mobile, branch, residence, status, avatar, job_title, branch_id)
       VALUES ($1, $2, $3, $4, $5, 'active', $6, $7, $8)
       RETURNING id, name, role, mobile, branch, residence, status, avatar,
         job_title AS "jobTitle", created_at AS "createdAt"`,
      [fullName, role, app.mobileNumber, app.vacancyBranch ?? null, residence, avatar, app.vacancyTitle ?? null, employeeBranchId]
    );

    const employee = employeeRows[0];

    await client.query(
      `UPDATE job_applications
       SET hired_employee_id = $1, updated_at = NOW()
       WHERE id = $2`,
      [employee.id, appId]
    );

    await insertAuditLog(client, {
      entityType: 'job_application',
      entityId: parseInt(appId),
      applicationId: parseInt(appId),
      actionType: 'Employee Record Created',
      performedByRole: req.user!.role,
      performedByUserId: req.user!.id,
      newValue: JSON.stringify({
        employeeId: employee.id,
        employeeName: employee.name,
        role: employee.role,
        jobTitle: employee.jobTitle,
      }),
    });

    await client.query('COMMIT');
    res.status(201).json(employee);
  } catch (err: any) {
    await client.query('ROLLBACK');
    console.error('Error creating employee from application:', err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

/**
 * @swagger
 * /api/admin/applications/{id}/decision:
 *   patch:
 *     tags: [Admin → Applications]
 *     summary: Record decision on job application
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         schema:
 *           type: integer
 *         required: false
 *       - in: path
 *         name: id
 *         schema:
 *           type: integer
 *         required: true
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [stage, decision]
 *             properties:
 *               stage:
 *                 type: string
 *               decision:
 *                 type: string
 *               internalNotes:
 *                 type: string
 *     responses:
 *       200:
 *         description: Success
 */
router.patch('/:id/decision', requirePermission('jobs.applications.record_decision'), async (req, res) => {
  const client = await pool.connect();
  try {
    const { decision, internalNotes } = req.body;
    const appId = req.params.id as string;

    if (!decision) return res.status(400).json({ error: 'القرار مطلوب' });
    if (!(await assertAppBranchAccess(req, res, appId))) { client.release(); return; }

    const { rows: currentRows } = await client.query(
      `SELECT ja.current_stage, ja.application_status,
        ja.stage_status, ja.decision, ja.is_escalated,
        jv.max_retraining_count
       FROM job_applications ja
       JOIN job_vacancies jv ON jv.id = ja.job_vacancy_id
       WHERE ja.id = $1`,
      [appId]
    );
    if (currentRows.length === 0) return res.status(404).json({ error: 'الطلب غير موجود' });
    const current = currentRows[0];
    const blockReason = getApplicationProcessingBlockReason(req.user?.role, {
      currentStage: current.current_stage,
      isEscalated: current.is_escalated,
    });
    if (blockReason) return res.status(403).json({ error: blockReason });

    // Count existing retraining for limit check
    let retrainingCount = 0;
    if (decision === 'Retraining') {
      const { rows: rtRows } = await client.query(
        `SELECT COUNT(*) FROM audit_logs
         WHERE application_id = $1 AND action_type = 'Decision Made'
           AND new_value LIKE '%"Retraining"%'`,
        [appId]
      );
      retrainingCount = parseInt(rtRows[0].count);
    }

    // Validate using the new engine
    const validationError = validateDecision(
      current.current_stage,
      current.stage_status,
      decision,
      current.decision,
      { retrainingCount, maxRetrainingCount: current.max_retraining_count ?? 1 },
    );
    if (validationError) return res.status(400).json({ error: validationError });

    await client.query('BEGIN');

    // Get the effect of this decision on stage/stageStatus
    const effect = getDecisionEffect(current.current_stage, decision);
    const newStage = effect.newStage;
    const newStageStatus = effect.newStageStatus === 'current' ? current.stage_status : effect.newStageStatus;

    // Derive backward-compatible application_status
    const legacyStatus = deriveApplicationStatus(newStage, newStageStatus, decision);

    const { rows } = await client.query(
      `UPDATE job_applications SET
        current_stage = $1,
        stage_status = $2,
        decision = $3,
        application_status = $4,
        internal_notes = COALESCE($5, internal_notes),
        updated_at = NOW()
      WHERE id = $6
      RETURNING id, current_stage AS "currentStage", stage_status AS "stageStatus",
        decision, application_status AS "applicationStatus", updated_at AS "updatedAt"`,
      [newStage, newStageStatus, decision, legacyStatus, internalNotes || null, appId]
    );

    await insertAuditLog(client, {
      entityType: 'job_application',
      entityId: parseInt(appId),
      applicationId: parseInt(appId),
      actionType: 'Decision Made',
      performedByRole: req.user!.role,
      performedByUserId: req.user!.id,
      oldValue: JSON.stringify({
        stage: current.current_stage, stageStatus: current.stage_status,
        decision: current.decision, applicationStatus: current.application_status,
      }),
      newValue: JSON.stringify({
        stage: newStage, stageStatus: newStageStatus,
        decision, applicationStatus: legacyStatus,
      }),
      internalReason: internalNotes || null,
    });

    await client.query('COMMIT');
    res.json(rows[0]);
  } catch (err: any) {
    await client.query('ROLLBACK');
    console.error('Error making decision:', err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// PATCH /api/admin/applications/:id/escalate
/**
 * @swagger
 * /api/admin/applications/{id}/escalate:
 *   patch:
 *     tags: [Admin → Applications]
 *     summary: Escalate a job application
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         schema:
 *           type: integer
 *         required: false
 *       - in: path
 *         name: id
 *         schema:
 *           type: integer
 *         required: true
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [notes]
 *             properties:
 *               notes:
 *                 type: string
 *     responses:
 *       200:
 *         description: Success
 */
router.patch('/:id/escalate', requirePermission('jobs.applications.escalate'), async (req, res) => {
  const client = await pool.connect();
  try {
    const appId = req.params.id as string;
    if (!(await assertAppBranchAccess(req, res, appId))) { client.release(); return; }

    const reason = sanitizeText(String(req.body?.reason ?? '').trim());
    if (!reason) {
      client.release();
      return res.status(400).json({ error: 'سبب التصعيد مطلوب' });
    }

    await client.query('BEGIN');

    const { rows } = await client.query(
      `UPDATE job_applications SET
        is_escalated = TRUE,
        escalated_at = NOW(),
        updated_at = NOW()
      WHERE id = $1 AND is_escalated = FALSE
      RETURNING id, is_escalated AS "isEscalated", escalated_at AS "escalatedAt"`,
      [appId]
    );
    if (rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'الطلب غير موجود أو مصعّد مسبقاً' });
    }

    await insertAuditLog(client, {
      entityType: 'job_application',
      entityId: parseInt(appId),
      applicationId: parseInt(appId),
      actionType: 'Escalated',
      performedByRole: req.user!.role,
      performedByUserId: req.user!.id,
      internalReason: reason,
    });

    await client.query('COMMIT');
    res.json(rows[0]);
  } catch (err: any) {
    await client.query('ROLLBACK');
    console.error('Error escalating application:', err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// PATCH /api/admin/applications/:id/resolve-escalation
/**
 * @swagger
 * /api/admin/applications/{id}/resolve-escalation:
 *   patch:
 *     tags: [Admin → Applications]
 *     summary: Resolve escalation on a job application
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         schema:
 *           type: integer
 *         required: false
 *       - in: path
 *         name: id
 *         schema:
 *           type: integer
 *         required: true
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [notes, actionType]
 *             properties:
 *               notes:
 *                 type: string
 *               actionType:
 *                 type: string
 *                 enum: [resolve, reject, re_evaluate]
 *     responses:
 *       200:
 *         description: Success
 */
router.patch('/:id/resolve-escalation', requirePermission('jobs.applications.resolve_escalation'), async (req, res) => {
  const client = await pool.connect();
  try {
    const appId = (Array.isArray(req.params.id) ? req.params.id[0] : req.params.id)!;

    await client.query('BEGIN');

    const { rows } = await client.query(
      `UPDATE job_applications SET
        is_escalated = FALSE,
        escalated_at = NULL,
        updated_at = NOW()
      WHERE id = $1 AND is_escalated = TRUE
      RETURNING id, is_escalated AS "isEscalated", escalated_at AS "escalatedAt"`,
      [appId]
    );
    if (rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'لا يمكن إلغاء التصعيد لأن الطلب غير مصعّد' });
    }

    await insertAuditLog(client, {
      entityType: 'job_application',
      entityId: parseInt(appId),
      applicationId: parseInt(appId),
      actionType: 'Escalation Resolved',
      performedByRole: req.user!.role,
      performedByUserId: req.user!.id,
    });

    await client.query('COMMIT');
    res.json(rows[0]);
  } catch (err: any) {
    await client.query('ROLLBACK');
    console.error('Error resolving escalation:', err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// PATCH /api/admin/applications/:id/notes
/**
 * @swagger
 * /api/admin/applications/{id}/notes:
 *   patch:
 *     tags: [Admin → Applications]
 *     summary: Edit internal notes on a job application
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         schema:
 *           type: integer
 *         required: false
 *       - in: path
 *         name: id
 *         schema:
 *           type: integer
 *         required: true
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [internalNotes]
 *             properties:
 *               internalNotes:
 *                 type: string
 *     responses:
 *       200:
 *         description: Success
 */
router.patch('/:id/notes', requirePermission('jobs.applications.edit_notes'), async (req, res) => {
  try {
    const appId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    if (!(await assertAppBranchAccess(req, res, appId!))) return;
    const { notes } = req.body;
    const { rows } = await pool.query(
      `UPDATE job_applications SET internal_notes = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING id, internal_notes AS "internalNotes"`,
      [notes ? sanitizeText(notes) : null, appId]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'الطلب غير موجود' });
    res.json(rows[0]);
  } catch (err: any) {
    console.error('Error updating notes:', err);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/admin/applications/:id/archive
/**
 * @swagger
 * /api/admin/applications/{id}/archive:
 *   patch:
 *     tags: [Admin → Applications]
 *     summary: Archive a job application
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         schema:
 *           type: integer
 *         required: false
 *       - in: path
 *         name: id
 *         schema:
 *           type: integer
 *         required: true
 *     responses:
 *       200:
 *         description: Success
 */
router.patch('/:id/archive', requirePermission('jobs.applications.archive'), async (req, res) => {
  const client = await pool.connect();
  try {
    const appId = req.params.id as string;
    if (!(await assertAppBranchAccess(req, res, appId))) { client.release(); return; }

    const ARCHIVABLE_STATUSES = ['Final Hired', 'Final Rejected', 'Retreated'];

    await client.query('BEGIN');

    const { rows: current } = await client.query(
      `SELECT id, application_status AS "applicationStatus", is_archived AS "isArchived"
       FROM job_applications WHERE id = $1`,
      [appId]
    );
    if (current.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'الطلب غير موجود' });
    }
    if (!ARCHIVABLE_STATUSES.includes(current[0].applicationStatus)) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: `لا يمكن أرشفة الطلب إلا عندما تكون حالته إحدى الحالات التالية: ${ARCHIVABLE_STATUSES.join(', ')}`,
      });
    }
    if (current[0].isArchived) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'الطلب مؤرشف بالفعل' });
    }

    const { rows } = await client.query(
      `UPDATE job_applications SET
        is_archived = TRUE,
        archived_at = NOW(),
        updated_at = NOW()
      WHERE id = $1
      RETURNING id, is_archived AS "isArchived", archived_at AS "archivedAt"`,
      [appId]
    );

    await insertAuditLog(client, {
      entityType: 'job_application',
      entityId: parseInt(appId),
      applicationId: parseInt(appId),
      actionType: 'Application Archived',
      performedByRole: req.user!.role,
      performedByUserId: req.user!.id,
      oldValue: JSON.stringify({ isArchived: false }),
      newValue: JSON.stringify({ isArchived: true }),
    });

    await client.query('COMMIT');
    res.json(rows[0]);
  } catch (err: any) {
    await client.query('ROLLBACK');
    console.error('Error archiving application:', err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// GET /api/admin/applications/:id/audit-logs
/**
 * @swagger
 * /api/admin/applications/{id}/audit-logs:
 *   get:
 *     tags: [Admin → Applications]
 *     summary: View audit logs for an application
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         schema:
 *           type: integer
 *         required: false
 *       - in: path
 *         name: id
 *         schema:
 *           type: integer
 *         required: true
 *     responses:
 *       200:
 *         description: Success
 */
router.get('/:id/audit-logs', requirePermission('jobs.applications.view_audit_logs'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, entity_type AS "entityType", entity_id AS "entityId",
        application_id AS "applicationId",
        action_type AS "actionType",
        performed_by_role AS "performedByRole",
        performed_by_user_id AS "performedByUserId",
        old_value AS "oldValue",
        new_value AS "newValue",
        internal_reason AS "internalReason",
        timestamp
      FROM audit_logs
      WHERE application_id = $1
      ORDER BY timestamp DESC`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err: any) {
    console.error('Error fetching audit logs:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
