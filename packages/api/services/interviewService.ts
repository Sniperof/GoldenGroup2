import type { AuthContext } from '@golden-crm/shared';
import type { PoolClient } from 'pg';
import pool from '../db.js';
import { insertAuditLog } from '../utils/auditLog.js';
import {
  fetchApplicationPolicyState,
  getApplicationProcessingBlockReason,
} from '../utils/recruitmentPolicy.js';
import {
  findExistingScheduledInterview,
  findInterviewerConflict,
  findInterviewStatusRecord,
  getApplicationInterviewContext,
  getEligibleInterviewApplications,
  getInterviewBranchContext,
  getInterviewDetailRow,
  insertInterview,
  listEligibleInterviewersForBranch,
  listInterviews,
  markApplicationInterviewScheduled,
  updateApplicationAfterInterviewResult,
  updateInterviewRecord,
  updateInterviewResultRecord,
} from '../repositories/interviewRepository.js';

type ServiceError = Error & {
  status?: number;
  payload?: Record<string, unknown>;
};

type InterviewActor = {
  id: number;
  role: string;
  authContext: AuthContext;
};

function createServiceError(status: number, payload: Record<string, unknown>): ServiceError {
  const err = new Error(String(payload.error ?? 'Service error')) as ServiceError;
  err.status = status;
  err.payload = payload;
  return err;
}

function ensureBranchAccess(authContext: AuthContext, branchId: number | null | undefined) {
  if (branchId == null) {
    throw createServiceError(400, {
      error: 'لا يمكن تنفيذ المقابلة لأن طلب التوظيف غير مرتبط بفرع واضح.',
    });
  }

  if (!authContext.isSuperAdmin && !authContext.allowedBranchIds.includes(branchId)) {
    throw createServiceError(403, {
      error: 'لا تملك صلاحية الوصول إلى هذا الطلب خارج فروعك المسموح بها.',
    });
  }
}

async function resolveEligibleInterviewer(
  client: PoolClient,
  branchId: number,
  interviewerUserId: unknown,
  currentInterviewerUserId?: number | null,
) {
  const normalizedInterviewerUserId =
    typeof interviewerUserId === 'number'
      ? interviewerUserId
      : Number.parseInt(String(interviewerUserId ?? ''), 10);

  if (!Number.isInteger(normalizedInterviewerUserId) || normalizedInterviewerUserId <= 0) {
    throw createServiceError(400, { error: 'يجب اختيار المقابِل من القائمة المعتمدة.' });
  }

  const eligibleInterviewers = await listEligibleInterviewersForBranch(
    client,
    branchId,
    currentInterviewerUserId ?? null,
  );

  const selectedInterviewer = eligibleInterviewers.find(
    interviewer => Number(interviewer.id) === normalizedInterviewerUserId,
  );

  if (!selectedInterviewer) {
    throw createServiceError(400, {
      error: 'المقابِل المختار غير مؤهل لإجراء مقابلات ضمن هذا الفرع.',
    });
  }

  return {
    interviewerUserId: normalizedInterviewerUserId,
    interviewerName: String(selectedInterviewer.name),
    interviewer: selectedInterviewer,
  };
}

export async function getEligibleInterviews(jobVacancyId: string, authContext: AuthContext) {
  const rows = await getEligibleInterviewApplications(jobVacancyId);

  if (authContext.isSuperAdmin) {
    return rows;
  }

  return rows.filter(row => {
    const branchId =
      row.branchId != null
        ? Number(row.branchId)
        : row.applicationBranchId != null
          ? Number(row.applicationBranchId)
          : row.vacancyBranchId != null
            ? Number(row.vacancyBranchId)
            : null;

    return branchId != null && authContext.allowedBranchIds.includes(branchId);
  });
}

export async function getInterviewersForApplication(
  applicationId: string,
  authContext: AuthContext,
  currentInterviewerUserId?: number | null,
) {
  const client = await pool.connect();
  try {
    const context = await getApplicationInterviewContext(client, applicationId);
    if (!context) {
      throw createServiceError(404, { error: 'طلب التوظيف غير موجود' });
    }

    ensureBranchAccess(authContext, context.resolvedBranchId);

    return listEligibleInterviewersForBranch(
      client,
      Number(context.resolvedBranchId),
      currentInterviewerUserId ?? null,
    );
  } finally {
    client.release();
  }
}

export async function getInterviews(
  filters: {
    applicationId?: unknown;
    interviewerName?: unknown;
    date?: unknown;
    jobVacancyId?: unknown;
  },
  authContext: AuthContext,
  requestedBranchId?: number | null,
) {
  if (requestedBranchId != null) {
    ensureBranchAccess(authContext, requestedBranchId);
  }

  return listInterviews({
    ...filters,
    allowedBranchIds: authContext.allowedBranchIds,
    requestedBranchId: requestedBranchId ?? null,
    isSuperAdmin: authContext.isSuperAdmin,
  });
}

export async function getInterviewById(id: string, authContext: AuthContext) {
  const client = await pool.connect();
  try {
    const interviewContext = await getInterviewBranchContext(client, id);
    if (!interviewContext) {
      throw createServiceError(404, { error: 'المقابلة غير موجودة' });
    }

    ensureBranchAccess(authContext, interviewContext.resolvedBranchId);

    const row = await getInterviewDetailRow(id);
    if (!row) {
      throw createServiceError(404, { error: 'المقابلة غير موجودة' });
    }

    return {
      id: row.id,
      applicationId: row.applicationId,
      interviewType: row.interviewType,
      interviewNumber: row.interviewNumber,
      interviewerName: row.interviewerName,
      interviewerUserId: row.interviewerUserId ?? null,
      interviewerUsername: row.interviewerUsername ?? null,
      interviewerRoleDisplayName: row.interviewerRoleDisplayName ?? null,
      interviewDate: row.interviewDate,
      interviewTime: row.interviewTime,
      interviewStatus: row.interviewStatus,
      internalNotes: row.internalNotes,
      createdAt: row.createdAt,
      applicant: {
        firstName: row.applicantFirstName,
        lastName: row.applicantLastName,
        dob: row.applicantDob,
        governorate: row.applicantGovernorate,
        cityOrArea: row.applicantCityOrArea,
        academicQualification: row.applicantAcademicQualification,
        previousEmployment: row.applicantPreviousEmployment,
        drivingLicense: row.applicantDrivingLicense,
        expectedSalary: row.applicantExpectedSalary,
        foreignLanguages: row.applicantForeignLanguages,
        computerSkills: row.applicantComputerSkills,
        yearsOfExperience: row.applicantYearsOfExperience,
      },
      vacancy: {
        id: row.vacancyId,
        title: row.vacancyTitle,
        branch: row.vacancyBranch,
      },
    };
  } finally {
    client.release();
  }
}

export async function scheduleInterviewForApplication(body: any, user: InterviewActor) {
  const client = await pool.connect();
  try {
    if (!body.applicationId) throw createServiceError(400, { error: 'معرّف الطلب مطلوب' });
    if (!body.interviewType) throw createServiceError(400, { error: 'نوع المقابلة مطلوب' });
    if (!body.interviewNumber) throw createServiceError(400, { error: 'رقم المقابلة مطلوب' });
    if (!body.interviewDate) throw createServiceError(400, { error: 'تاريخ المقابلة مطلوب' });
    if (!body.interviewTime) throw createServiceError(400, { error: 'وقت المقابلة مطلوب' });
    if (!body.interviewerUserId) {
      throw createServiceError(400, { error: 'يجب اختيار المقابِل من القائمة المعتمدة.' });
    }

    await client.query('BEGIN');

    const applicationContext = await getApplicationInterviewContext(client, body.applicationId);
    if (!applicationContext) {
      throw createServiceError(404, { error: 'طلب التوظيف غير موجود' });
    }

    ensureBranchAccess(user.authContext, applicationContext.resolvedBranchId);

    const branchId = Number(applicationContext.resolvedBranchId);
    const selectedInterviewer = await resolveEligibleInterviewer(
      client,
      branchId,
      body.interviewerUserId,
    );

    const policyState = await fetchApplicationPolicyState(client, body.applicationId);
    if (!policyState) {
      throw createServiceError(404, { error: 'طلب التوظيف غير موجود' });
    }
    const blockReason = getApplicationProcessingBlockReason(user.role, policyState);
    if (blockReason) {
      throw createServiceError(403, { error: blockReason });
    }

    const existingScheduled = await findExistingScheduledInterview(client, Number(body.applicationId));
    if (existingScheduled.length > 0) {
      throw createServiceError(409, { error: 'يوجد مقابلة مجدولة بالفعل لهذا الطلب' });
    }

    const conflictRows = await findInterviewerConflict(
      client,
      selectedInterviewer.interviewerUserId,
      selectedInterviewer.interviewerName,
      body.interviewDate,
      body.interviewTime,
    );
    if (conflictRows.length > 0) {
      throw createServiceError(409, {
        error: 'المقابِل لديه مقابلة أخرى في نفس التاريخ والوقت',
      });
    }

    const row = await insertInterview(client, {
      applicationId: Number(body.applicationId),
      interviewType: body.interviewType,
      interviewNumber: body.interviewNumber,
      interviewerUserId: selectedInterviewer.interviewerUserId,
      interviewerName: selectedInterviewer.interviewerName,
      interviewDate: body.interviewDate,
      interviewTime: body.interviewTime,
      internalNotes: body.internalNotes ? body.internalNotes : null,
    });

    await markApplicationInterviewScheduled(client, Number(body.applicationId));

    await insertAuditLog(client, {
      entityType: 'interview',
      entityId: row.id,
      applicationId: Number(body.applicationId),
      actionType: 'Interview Scheduled',
      performedByRole: user.role,
      performedByUserId: user.id,
      newValue: JSON.stringify({
        interviewType: body.interviewType,
        interviewNumber: body.interviewNumber,
        interviewerName: selectedInterviewer.interviewerName,
        interviewerUserId: selectedInterviewer.interviewerUserId,
        interviewDate: body.interviewDate,
      }),
    });

    await client.query('COMMIT');
    return row;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {}
    throw err;
  } finally {
    client.release();
  }
}

export async function updateScheduledInterview(interviewId: string, body: any, user: InterviewActor) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const current = await findInterviewStatusRecord(client, interviewId);
    if (!current) {
      throw createServiceError(404, { error: 'المقابلة غير موجودة' });
    }
    if (current.interview_status !== 'Interview Scheduled') {
      throw createServiceError(400, { error: 'لا يمكن تعديل مقابلة مكتملة أو فاشلة' });
    }

    const interviewContext = await getInterviewBranchContext(client, interviewId);
    if (!interviewContext) {
      throw createServiceError(404, { error: 'المقابلة غير موجودة' });
    }

    ensureBranchAccess(user.authContext, interviewContext.resolvedBranchId);

    const branchId = Number(interviewContext.resolvedBranchId);

    const policyState = await fetchApplicationPolicyState(client, current.application_id);
    if (!policyState) {
      throw createServiceError(404, { error: 'طلب التوظيف غير موجود' });
    }
    const blockReason = getApplicationProcessingBlockReason(user.role, policyState);
    if (blockReason) {
      throw createServiceError(403, { error: blockReason });
    }

    if (body.interviewDate) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (new Date(body.interviewDate) < today) {
        throw createServiceError(400, { error: 'لا يمكن تعيين تاريخ مقابلة في الماضي' });
      }
    }

    let interviewerPatch:
      | {
          interviewerUserId: number;
          interviewerName: string;
        }
      | undefined;

    if (body.interviewerUserId != null) {
      interviewerPatch = await resolveEligibleInterviewer(
        client,
        branchId,
        body.interviewerUserId,
        current.interviewerUserId ?? null,
      );

      const nextDate = body.interviewDate || null;
      const nextTime = body.interviewTime || null;
      if (nextDate && nextTime) {
        const conflictRows = await findInterviewerConflict(
          client,
          interviewerPatch.interviewerUserId,
          interviewerPatch.interviewerName,
          nextDate,
          nextTime,
        );
        if (conflictRows.some(row => Number(row.id) !== Number(interviewId))) {
          throw createServiceError(409, {
            error: 'المقابِل لديه مقابلة أخرى في نفس التاريخ والوقت',
          });
        }
      }
    }

    const row = await updateInterviewRecord(client, interviewId, {
      interviewDate: body.interviewDate || null,
      interviewTime: body.interviewTime || null,
      interviewerUserId: interviewerPatch?.interviewerUserId ?? undefined,
      interviewerName: interviewerPatch?.interviewerName ?? undefined,
      interviewType: body.interviewType || null,
      interviewNumber: body.interviewNumber || null,
      internalNotes: body.internalNotes !== undefined ? body.internalNotes : undefined,
    });

    await insertAuditLog(client, {
      entityType: 'interview',
      entityId: Number.parseInt(interviewId, 10),
      applicationId: current.application_id,
      actionType: 'Interview Updated',
      performedByRole: user.role,
      performedByUserId: user.id,
      newValue: JSON.stringify({
        interviewDate: body.interviewDate,
        interviewTime: body.interviewTime,
        interviewerName: interviewerPatch?.interviewerName ?? undefined,
        interviewerUserId: interviewerPatch?.interviewerUserId ?? undefined,
        interviewType: body.interviewType,
        interviewNumber: body.interviewNumber,
      }),
    });

    await client.query('COMMIT');
    return row;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {}
    throw err;
  } finally {
    client.release();
  }
}

export async function recordInterviewOutcome(
  interviewId: string,
  body: any,
  user: InterviewActor,
) {
  const client = await pool.connect();
  try {
    const { interviewStatus, internalNotes } = body;

    if (!['Interview Completed', 'Interview Failed'].includes(interviewStatus)) {
      throw createServiceError(400, { error: 'حالة المقابلة غير صالحة' });
    }
    const newStageStatus = 'Completed';

    await client.query('BEGIN');

    const current = await findInterviewStatusRecord(client, interviewId);
    if (!current) {
      throw createServiceError(404, { error: 'المقابلة غير موجودة' });
    }
    if (current.interview_status !== 'Interview Scheduled') {
      throw createServiceError(400, { error: 'يمكن تحديث نتيجة المقابلة المجدولة فقط' });
    }

    const interviewContext = await getInterviewBranchContext(client, interviewId);
    if (!interviewContext) {
      throw createServiceError(404, { error: 'المقابلة غير موجودة' });
    }

    ensureBranchAccess(user.authContext, interviewContext.resolvedBranchId);

    const policyState = await fetchApplicationPolicyState(client, current.application_id);
    if (!policyState) {
      throw createServiceError(404, { error: 'طلب التوظيف غير موجود' });
    }
    const blockReason = getApplicationProcessingBlockReason(user.role, policyState);
    if (blockReason) {
      throw createServiceError(403, { error: blockReason });
    }

    const row = await updateInterviewResultRecord(
      client,
      interviewId,
      interviewStatus,
      internalNotes || null,
    );

    const decision = interviewStatus === 'Interview Failed' ? 'Failed' : null;
    await updateApplicationAfterInterviewResult(client, {
      applicationId: current.application_id,
      interviewStatus,
      stageStatus: newStageStatus,
      decision,
    });

    await insertAuditLog(client, {
      entityType: 'interview',
      entityId: Number.parseInt(interviewId, 10),
      applicationId: current.application_id,
      actionType: 'Interview Result Recorded',
      performedByRole: user.role,
      performedByUserId: user.id,
      oldValue: current.interview_status,
      newValue: interviewStatus,
      internalReason: internalNotes || null,
    });

    await client.query('COMMIT');
    return row;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {}
    throw err;
  } finally {
    client.release();
  }
}
