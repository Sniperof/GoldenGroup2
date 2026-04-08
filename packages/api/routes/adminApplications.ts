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
import { requirePermission } from '../middleware/permission.js';
import { requireRole } from '../middleware/auth.js';
import {
  deriveEmployeeRoleFromVacancyTitle,
  getApplicationProcessingBlockReason,
  getEmployeeAvatar,
} from '../utils/recruitmentPolicy.js';

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

// ── Dual-write helpers: derive new columns from legacy status ──
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

function deriveDecisionFromLegacy(legacyStatus: string): string | null {
  const decisionStatuses: Record<string, string> = {
    Qualified: 'Qualified', Rejected: 'Rejected', 'Interview Failed': 'Failed',
    Approved: 'Approved', Retraining: 'Retraining', Passed: 'Passed',
    'Final Hired': 'Hired', 'Final Rejected': 'Rejected', Retreated: 'Retreated',
  };
  return decisionStatuses[legacyStatus] ?? null;
}

// GET /api/admin/applications
router.get('/', requirePermission('jobs.applications.view_list'), async (req, res) => {
  try {
    const { vacancyId, branch, gender, stage, status, search, applicationSource, isArchived } = req.query;
    const conditions: string[] = [];
    const params: any[] = [];
    let idx = 1;

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
        EXISTS (
          SELECT 1
          FROM interviews i
          WHERE i.application_id = ja.id
            AND i.interview_status = 'Interview Scheduled'
        ) AS "hasScheduledInterview"
      FROM job_applications ja
      JOIN applicants a ON a.id = ja.applicant_id
      JOIN job_vacancies jv ON jv.id = ja.job_vacancy_id
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
router.post('/', requirePermission('jobs.applications.create'), async (req, res) => {
  const client = await pool.connect();
  try {
    const body = req.body;
    const a = body.applicant || {};

    if (!a.firstName?.trim()) return res.status(400).json({ error: 'الاسم الأول مطلوب' });
    if (!a.lastName?.trim()) return res.status(400).json({ error: 'اسم العائلة مطلوب' });
    if (!a.mobileNumber?.trim()) return res.status(400).json({ error: 'رقم الهاتف مطلوب' });
    if (!/^\d{10,11}$/.test(a.mobileNumber)) return res.status(400).json({ error: 'رقم الهاتف يجب أن يكون 10-11 رقم' });
    if (a.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a.email)) return res.status(400).json({ error: 'صيغة البريد الإلكتروني غير صحيحة' });
    if (!a.dob) return res.status(400).json({ error: 'تاريخ الميلاد مطلوب' });
    if (!a.gender) return res.status(400).json({ error: 'الجنس مطلوب' });
    if (!a.maritalStatus) return res.status(400).json({ error: 'الحالة الاجتماعية مطلوبة' });
    if (!a.governorate?.trim()) return res.status(400).json({ error: 'المحافظة مطلوبة' });

    const submissionType = body.submissionType;
    if (!['Apply', 'Refer a Candidate'].includes(submissionType)) {
      return res.status(400).json({ error: 'نوع التقديم غير صالح' });
    }
    const applicationSource = body.applicationSource;
    if (!applicationSource) {
      return res.status(400).json({ error: 'مصدر الطلب مطلوب' });
    }
    // enteredByUserId now comes from auth context
    if (submissionType === 'Refer a Candidate' && !body.referrer?.fullName?.trim()) {
      return res.status(400).json({ error: 'اسم المُعرّف مطلوب عند التقديم نيابة عن مرشح' });
    }

    await client.query('BEGIN');

    // Vacancy: if linked, must be Open and within date range
    if (body.jobVacancyId) {
      const { rows: vacRows } = await client.query(
        `SELECT id, status FROM job_vacancies
         WHERE id = $1 AND status = 'Open' AND CURRENT_DATE BETWEEN start_date AND end_date`,
        [body.jobVacancyId]
      );
      if (vacRows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'الشاغر غير موجود أو غير مفتوح للتقديم أو خارج الفترة المحددة' });
      }
    }

    // Duplicate check
    const dupResult = await checkDuplicate(client, a.mobileNumber, body.jobVacancyId || null);
    if (dupResult.blocked) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: body.jobVacancyId ? 'يوجد طلب نشط بالفعل لهذا الرقم والشاغر الوظيفي' : 'يوجد طلب عام نشط بالفعل لهذا الرقم',
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
        expected_salary, computer_skills, foreign_languages,
        years_of_experience, cv_url, photo_url, applicant_segment,
        has_whatsapp_primary, has_whatsapp_secondary
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26)
      RETURNING id`,
      [
        a.firstName, a.lastName, a.dob, a.gender, a.maritalStatus, a.email || null,
        a.mobileNumber, a.secondaryMobile || null,
        a.governorate, a.cityOrArea || null, a.subArea || null, a.neighborhood || null, a.detailedAddress || null,
        a.academicQualification || null, a.specialization || null, a.previousEmployment || null,
        a.drivingLicense || null, a.expectedSalary ? parseInt(a.expectedSalary) : null,
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
      const { rows: refRows } = await client.query(
        `INSERT INTO referrers (
          type, employee_id, full_name, last_name, mobile_number,
          governorate, city_or_area, sub_area, neighborhood,
          detailed_address, referrer_work, referrer_notes
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
        RETURNING id`,
        [
          r.type || 'Customer', r.employeeId || null,
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
        stage_status, decision
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,'Submitted','New',$8,'Pending',NULL)
      RETURNING id, job_vacancy_id AS "jobVacancyId", applicant_id AS "applicantId",
        referrer_id AS "referrerId", submission_type AS "submissionType",
        application_source AS "applicationSource",
        entered_by_user_id AS "enteredByUserId", entered_by_name AS "enteredByName",
        current_stage AS "currentStage", application_status AS "applicationStatus",
        duplicate_flag AS "duplicateFlag", created_at AS "createdAt",
        stage_status AS "stageStatus", decision`,
      [
        body.jobVacancyId || null, applicantId, referrerId,
        submissionType, applicationSource,
        enteredByUserId, body.enteredByName || null,
        duplicateFlag,
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
        jobVacancyId: body.jobVacancyId || null,
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
router.get('/:id', requirePermission('jobs.applications.view_detail'), async (req, res) => {
  try {
    const { rows: appRows } = await pool.query(
      `SELECT ${APP_COLS} FROM job_applications ja WHERE ja.id = $1`,
      [req.params.id]
    );
    if (appRows.length === 0) return res.status(404).json({ error: 'الطلب غير موجود' });
    const app = appRows[0];

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
        `SELECT id, type, employee_id AS "employeeId",
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
router.patch('/:id/stage', requirePermission('jobs.applications.change_stage'), async (req, res) => {
  const client = await pool.connect();
  try {
    const { stage, status, internalNotes } = req.body;
    const appId = req.params.id as string;

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
        error: 'لا يمكن تغيير المرحلة: الطلب مُصعَّد. يجب حل التصعيد أولاً.',
      });
    }

    // Block: Training stage transitions go exclusively through the training module
    if (isTrainingManagedStage(current.current_stage)) {
      return res.status(400).json({
        error: 'لا يمكن تغيير حالة الطلب في مرحلة التدريب إلا من خلال وحدة إدارة الدورات التدريبية',
      });
    }

    // Block: Interview result transitions go exclusively through the interview module
    if (isInterviewManagedTransition(current.current_stage, current.application_status, status)) {
      return res.status(400).json({
        error: 'يتم تحديث نتيجة المقابلة تلقائياً من خلال وحدة إدارة المقابلات فقط',
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
router.patch('/:id/hire', requirePermission('jobs.applications.hire'), async (req, res) => {
  const client = await pool.connect();
  try {
    const appId = req.params.id as string;

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
        error: 'لا يمكن تنفيذ التوظيف: الطلب مُصعَّد. يجب حل التصعيد أولاً.',
      });
    }

    // Must be at Final Decision with Passed status
    if (app.current_stage !== 'Final Decision' || app.application_status !== 'Passed') {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'يجب أن يكون الطلب في مرحلة "القرار النهائي" وحالة "ناجح" لإتمام التوظيف',
      });
    }

    // Capacity check — no override allowed (FOR UPDATE lock is inside checkVacancyCapacity)
    const capacity = await checkVacancyCapacity(client, app.vacancy_id);
    if (!capacity.sufficient) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'لا توجد شواغر متبقية. لا يمكن التوظيف.',
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
router.post('/:id/employee', requirePermission('employees.create'), async (req, res) => {
  const client = await pool.connect();
  try {
    const appId = req.params.id as string;

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
       jv.branch AS "vacancyBranch"
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

    const role = deriveEmployeeRoleFromVacancyTitle(app.vacancyTitle);
    if (!role) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'عنوان الوظيفة لا يطابق الأدوار المدعومة لإنشاء موظف تلقائيًا: مشرفة، فني، تيلماركتر.',
      });
    }

    const fullName = `${app.firstName ?? ''} ${app.lastName ?? ''}`.trim();
    const avatar = getEmployeeAvatar(fullName, app.photoUrl);
    const residence = [
      app.governorate,
      app.cityOrArea,
      app.subArea,
      app.neighborhood,
      app.detailedAddress,
    ].filter(Boolean).join(' - ') || null;

    const { rows: employeeRows } = await client.query(
      `INSERT INTO employees (name, role, mobile, branch, residence, status, avatar, job_title)
       VALUES ($1, $2, $3, $4, $5, 'active', $6, $7)
       RETURNING id, name, role, mobile, branch, residence, status, avatar,
         job_title AS "jobTitle", created_at AS "createdAt"`,
      [fullName, role, app.mobileNumber, app.vacancyBranch ?? null, residence, avatar, app.vacancyTitle ?? null]
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

router.patch('/:id/decision', requirePermission('jobs.applications.record_decision'), async (req, res) => {
  const client = await pool.connect();
  try {
    const { decision, internalNotes } = req.body;
    const appId = req.params.id as string;

    if (!decision) return res.status(400).json({ error: 'القرار مطلوب' });

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
router.patch('/:id/escalate', requirePermission('jobs.applications.escalate'), async (req, res) => {
  const client = await pool.connect();
  try {
    const appId = req.params.id as string;

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
      return res.status(400).json({ error: 'الطلب غير موجود أو مُصعَّد بالفعل' });
    }

    await insertAuditLog(client, {
      entityType: 'job_application',
      entityId: parseInt(appId),
      applicationId: parseInt(appId),
      actionType: 'Escalated',
      performedByRole: req.user!.role,
      performedByUserId: req.user!.id,
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
router.patch('/:id/resolve-escalation', requireRole('HR_MANAGER'), async (req, res) => {
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
      return res.status(400).json({ error: 'الطلب غير موجود أو غير مُصعَّد' });
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
router.patch('/:id/notes', requirePermission('jobs.applications.edit_notes'), async (req, res) => {
  try {
    const { notes } = req.body;
    const { rows } = await pool.query(
      `UPDATE job_applications SET internal_notes = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING id, internal_notes AS "internalNotes"`,
      [notes ? sanitizeText(notes) : null, req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'الطلب غير موجود' });
    res.json(rows[0]);
  } catch (err: any) {
    console.error('Error updating notes:', err);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/admin/applications/:id/archive
router.patch('/:id/archive', requirePermission('jobs.applications.archive'), async (req, res) => {
  const client = await pool.connect();
  try {
    const appId = req.params.id as string;

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
        error: `لا يمكن أرشفة الطلب إلا في الحالات النهائية: ${ARCHIVABLE_STATUSES.join(', ')}`,
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
