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
  getEligibleInterviewApplications,
  getInterviewDetailRow,
  insertInterview,
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
};

function createServiceError(status: number, payload: Record<string, unknown>): ServiceError {
  const err = new Error(String(payload.error ?? 'Service error')) as ServiceError;
  err.status = status;
  err.payload = payload;
  return err;
}

export async function getEligibleInterviews(jobVacancyId: string) {
  return getEligibleInterviewApplications(jobVacancyId);
}

export async function getInterviews(filters: {
  applicationId?: unknown;
  interviewerName?: unknown;
  date?: unknown;
  jobVacancyId?: unknown;
  page?: number;
  limit?: number;
}) {
  return listInterviews(filters);
}

export async function getInterviewById(id: string) {
  const row = await getInterviewDetailRow(id);
  if (!row) {
    throw createServiceError(404, { error: 'Ø§Ù„Ù…Ù‚Ø§Ø¨Ù„Ø© ØºÙŠØ± Ù…ÙˆØ¬ÙˆØ¯Ø©' });
  }

  return {
    id: row.id,
    applicationId: row.applicationId,
    interviewType: row.interviewType,
    interviewNumber: row.interviewNumber,
    interviewerName: row.interviewerName,
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
}

export async function scheduleInterviewForApplication(body: any, user: InterviewActor) {
  const client = await pool.connect();
  try {
    if (!body.applicationId) throw createServiceError(400, { error: 'Ù…Ø¹Ø±Ù‘Ù Ø§Ù„Ø·Ù„Ø¨ Ù…Ø·Ù„ÙˆØ¨' });
    if (!body.interviewType) throw createServiceError(400, { error: 'Ù†ÙˆØ¹ Ø§Ù„Ù…Ù‚Ø§Ø¨Ù„Ø© Ù…Ø·Ù„ÙˆØ¨' });
    if (!body.interviewNumber) throw createServiceError(400, { error: 'Ø±Ù‚Ù… Ø§Ù„Ù…Ù‚Ø§Ø¨Ù„Ø© Ù…Ø·Ù„ÙˆØ¨' });
    if (!body.interviewerName?.trim()) throw createServiceError(400, { error: 'Ø§Ø³Ù… Ø§Ù„Ù…Ù‚Ø§Ø¨ÙÙ„ Ù…Ø·Ù„ÙˆØ¨' });
    if (!body.interviewDate) throw createServiceError(400, { error: 'ØªØ§Ø±ÙŠØ® Ø§Ù„Ù…Ù‚Ø§Ø¨Ù„Ø© Ù…Ø·Ù„ÙˆØ¨' });
    if (!body.interviewTime) throw createServiceError(400, { error: 'ÙˆÙ‚Øª Ø§Ù„Ù…Ù‚Ø§Ø¨Ù„Ø© Ù…Ø·Ù„ÙˆØ¨' });

    await client.query('BEGIN');

    const policyState = await fetchApplicationPolicyState(client, body.applicationId);
    if (!policyState) {
      await client.query('ROLLBACK');
      throw createServiceError(404, { error: 'Application not found' });
    }
    const blockReason = getApplicationProcessingBlockReason(user.role, policyState);
    if (blockReason) {
      await client.query('ROLLBACK');
      throw createServiceError(403, { error: blockReason });
    }

    const existingScheduled = await findExistingScheduledInterview(client, body.applicationId);
    if (existingScheduled.length > 0) {
      await client.query('ROLLBACK');
      throw createServiceError(409, { error: 'ÙŠÙˆØ¬Ø¯ Ù…Ù‚Ø§Ø¨Ù„Ø© Ù…Ø¬Ø¯ÙˆÙ„Ø© Ø¨Ø§Ù„ÙØ¹Ù„ Ù„Ù‡Ø°Ø§ Ø§Ù„Ø·Ù„Ø¨' });
    }

    const conflictRows = await findInterviewerConflict(
      client,
      body.interviewerName,
      body.interviewDate,
      body.interviewTime
    );
    if (conflictRows.length > 0) {
      await client.query('ROLLBACK');
      throw createServiceError(409, { error: 'Ø§Ù„Ù…Ù‚Ø§Ø¨ÙÙ„ Ù„Ø¯ÙŠÙ‡ Ù…Ù‚Ø§Ø¨Ù„Ø© Ø£Ø®Ø±Ù‰ ÙÙŠ Ù†ÙØ³ Ø§Ù„ØªØ§Ø±ÙŠØ® ÙˆØ§Ù„ÙˆÙ‚Øª' });
    }

    const row = await insertInterview(client, {
      applicationId: body.applicationId,
      interviewType: body.interviewType,
      interviewNumber: body.interviewNumber,
      interviewerName: body.interviewerName,
      interviewDate: body.interviewDate,
      interviewTime: body.interviewTime,
      internalNotes: body.internalNotes ? body.internalNotes : null,
    });

    await markApplicationInterviewScheduled(client, body.applicationId);

    await insertAuditLog(client, {
      entityType: 'interview',
      entityId: row.id,
      applicationId: body.applicationId,
      actionType: 'Interview Scheduled',
      performedByRole: user.role,
      performedByUserId: user.id,
      newValue: JSON.stringify({
        interviewType: body.interviewType,
        interviewNumber: body.interviewNumber,
        interviewerName: body.interviewerName,
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
      await client.query('ROLLBACK');
      throw createServiceError(404, { error: 'Ø§Ù„Ù…Ù‚Ø§Ø¨Ù„Ø© ØºÙŠØ± Ù…ÙˆØ¬ÙˆØ¯Ø©' });
    }
    if (current.interview_status !== 'Interview Scheduled') {
      await client.query('ROLLBACK');
      throw createServiceError(400, { error: 'Ù„Ø§ ÙŠÙ…ÙƒÙ† ØªØ¹Ø¯ÙŠÙ„ Ù…Ù‚Ø§Ø¨Ù„Ø© Ù…ÙƒØªÙ…Ù„Ø© Ø£Ùˆ ÙØ§Ø´Ù„Ø©' });
    }

    const policyState = await fetchApplicationPolicyState(client, current.application_id);
    if (!policyState) {
      await client.query('ROLLBACK');
      throw createServiceError(404, { error: 'Application not found' });
    }
    const blockReason = getApplicationProcessingBlockReason(user.role, policyState);
    if (blockReason) {
      await client.query('ROLLBACK');
      throw createServiceError(403, { error: blockReason });
    }

    if (body.interviewDate) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (new Date(body.interviewDate) < today) {
        await client.query('ROLLBACK');
        throw createServiceError(400, { error: 'Ù„Ø§ ÙŠÙ…ÙƒÙ† ØªØ¹ÙŠÙŠÙ† ØªØ§Ø±ÙŠØ® Ù…Ù‚Ø§Ø¨Ù„Ø© ÙÙŠ Ø§Ù„Ù…Ø§Ø¶ÙŠ' });
      }
    }

    const row = await updateInterviewRecord(client, interviewId, {
      interviewDate: body.interviewDate || null,
      interviewTime: body.interviewTime || null,
      interviewerName: body.interviewerName || null,
      interviewType: body.interviewType || null,
      interviewNumber: body.interviewNumber || null,
      internalNotes: body.internalNotes !== undefined ? body.internalNotes : undefined,
    });

    await insertAuditLog(client, {
      entityType: 'interview',
      entityId: parseInt(interviewId),
      applicationId: current.application_id,
      actionType: 'Interview Updated',
      performedByRole: user.role,
      performedByUserId: user.id,
      newValue: JSON.stringify({
        interviewDate: body.interviewDate,
        interviewTime: body.interviewTime,
        interviewerName: body.interviewerName,
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
  user: InterviewActor
) {
  const client = await pool.connect();
  try {
    const { interviewStatus, internalNotes } = body;

    if (!['Interview Completed', 'Interview Failed'].includes(interviewStatus)) {
      throw createServiceError(400, { error: 'Ø­Ø§Ù„Ø© Ø§Ù„Ù…Ù‚Ø§Ø¨Ù„Ø© ØºÙŠØ± ØµØ§Ù„Ø­Ø©' });
    }
    const newStageStatus = 'Completed';

    await client.query('BEGIN');

    const current = await findInterviewStatusRecord(client, interviewId);
    if (!current) {
      await client.query('ROLLBACK');
      throw createServiceError(404, { error: 'Ø§Ù„Ù…Ù‚Ø§Ø¨Ù„Ø© ØºÙŠØ± Ù…ÙˆØ¬ÙˆØ¯Ø©' });
    }
    if (current.interview_status !== 'Interview Scheduled') {
      await client.query('ROLLBACK');
      throw createServiceError(400, { error: 'ÙŠÙ…ÙƒÙ† ØªØ­Ø¯ÙŠØ« Ù†ØªÙŠØ¬Ø© Ø§Ù„Ù…Ù‚Ø§Ø¨Ù„Ø© Ø§Ù„Ù…Ø¬Ø¯ÙˆÙ„Ø© ÙÙ‚Ø·' });
    }

    const policyState = await fetchApplicationPolicyState(client, current.application_id);
    if (!policyState) {
      await client.query('ROLLBACK');
      throw createServiceError(404, { error: 'Application not found' });
    }
    const blockReason = getApplicationProcessingBlockReason(user.role, policyState);
    if (blockReason) {
      await client.query('ROLLBACK');
      throw createServiceError(403, { error: blockReason });
    }

    const row = await updateInterviewResultRecord(client, interviewId, interviewStatus, internalNotes || null);

    const decision = interviewStatus === 'Interview Failed' ? 'Failed' : null;
    await updateApplicationAfterInterviewResult(client, {
      applicationId: current.application_id,
      interviewStatus,
      stageStatus: newStageStatus,
      decision,
    });

    await insertAuditLog(client, {
      entityType: 'interview',
      entityId: parseInt(interviewId),
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
