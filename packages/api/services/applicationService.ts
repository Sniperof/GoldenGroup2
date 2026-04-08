import pool from '../db.js';
import { insertAuditLog } from '../utils/auditLog.js';
import {
  checkPublicApplicationDuplicate,
  findVacancyById,
  insertApplicant,
  insertJobApplication,
  insertReferrer,
} from '../repositories/applicationRepository.js';

type PublicApplicationResult = {
  id: number;
  jobVacancyId: number;
  applicantId: number;
  referrerId: number | null;
  submissionType: string;
  applicationSource: string;
  currentStage: string;
  applicationStatus: string;
  duplicateFlag: boolean;
  createdAt: string;
};

type ServiceError = Error & {
  status?: number;
  payload?: Record<string, unknown>;
};

function createServiceError(status: number, payload: Record<string, unknown>): ServiceError {
  const err = new Error(String(payload.error ?? 'Service error')) as ServiceError;
  err.status = status;
  err.payload = payload;
  return err;
}

export async function createPublicApplication(body: any): Promise<PublicApplicationResult> {
  const client = await pool.connect();
  try {
    const a = body.applicant || {};

    if (!a.firstName?.trim()) throw createServiceError(400, { error: 'Ã˜Â§Ã™â€žÃ˜Â§Ã˜Â³Ã™â€¦ Ã˜Â§Ã™â€žÃ˜Â£Ã™Ë†Ã™â€ž Ã™â€¦Ã˜Â·Ã™â€žÃ™Ë†Ã˜Â¨' });
    if (!a.lastName?.trim()) throw createServiceError(400, { error: 'Ã˜Â§Ã˜Â³Ã™â€¦ Ã˜Â§Ã™â€žÃ˜Â¹Ã˜Â§Ã˜Â¦Ã™â€žÃ˜Â© Ã™â€¦Ã˜Â·Ã™â€žÃ™Ë†Ã˜Â¨' });
    if (!a.mobileNumber?.trim()) throw createServiceError(400, { error: 'Ã˜Â±Ã™â€šÃ™â€¦ Ã˜Â§Ã™â€žÃ™â€¡Ã˜Â§Ã˜ÂªÃ™Â Ã™â€¦Ã˜Â·Ã™â€žÃ™Ë†Ã˜Â¨' });
    if (!/^\d{10,11}$/.test(a.mobileNumber)) throw createServiceError(400, { error: 'Ã˜Â±Ã™â€šÃ™â€¦ Ã˜Â§Ã™â€žÃ™â€¡Ã˜Â§Ã˜ÂªÃ™Â Ã™Å Ã˜Â¬Ã˜Â¨ Ã˜Â£Ã™â€  Ã™Å Ã™Æ’Ã™Ë†Ã™â€  10-11 Ã˜Â±Ã™â€šÃ™â€¦' });
    if (a.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a.email)) throw createServiceError(400, { error: 'Ã˜ÂµÃ™Å Ã˜ÂºÃ˜Â© Ã˜Â§Ã™â€žÃ˜Â¨Ã˜Â±Ã™Å Ã˜Â¯ Ã˜Â§Ã™â€žÃ˜Â¥Ã™â€žÃ™Æ’Ã˜ÂªÃ˜Â±Ã™Ë†Ã™â€ Ã™Å  Ã˜ÂºÃ™Å Ã˜Â± Ã˜ÂµÃ˜Â­Ã™Å Ã˜Â­Ã˜Â©' });
    if (!a.dob) throw createServiceError(400, { error: 'Ã˜ÂªÃ˜Â§Ã˜Â±Ã™Å Ã˜Â® Ã˜Â§Ã™â€žÃ™â€¦Ã™Å Ã™â€žÃ˜Â§Ã˜Â¯ Ã™â€¦Ã˜Â·Ã™â€žÃ™Ë†Ã˜Â¨' });
    if (!a.gender) throw createServiceError(400, { error: 'Ã˜Â§Ã™â€žÃ˜Â¬Ã™â€ Ã˜Â³ Ã™â€¦Ã˜Â·Ã™â€žÃ™Ë†Ã˜Â¨' });
    if (!a.maritalStatus) throw createServiceError(400, { error: 'Ã˜Â§Ã™â€žÃ˜Â­Ã˜Â§Ã™â€žÃ˜Â© Ã˜Â§Ã™â€žÃ˜Â§Ã˜Â¬Ã˜ÂªÃ™â€¦Ã˜Â§Ã˜Â¹Ã™Å Ã˜Â© Ã™â€¦Ã˜Â·Ã™â€žÃ™Ë†Ã˜Â¨Ã˜Â©' });
    if (!a.governorate?.trim()) throw createServiceError(400, { error: 'Ã˜Â§Ã™â€žÃ™â€¦Ã˜Â­Ã˜Â§Ã™ÂÃ˜Â¸Ã˜Â© Ã™â€¦Ã˜Â·Ã™â€žÃ™Ë†Ã˜Â¨Ã˜Â©' });
    if (!body.jobVacancyId) throw createServiceError(400, { error: 'Ã™â€¦Ã˜Â¹Ã˜Â±Ã™â€˜Ã™Â Ã˜Â§Ã™â€žÃ˜Â´Ã˜Â§Ã˜ÂºÃ˜Â± Ã˜Â§Ã™â€žÃ™Ë†Ã˜Â¸Ã™Å Ã™ÂÃ™Å  Ã™â€¦Ã˜Â·Ã™â€žÃ™Ë†Ã˜Â¨' });

    const submissionType = body.submissionType;
    if (!['Apply', 'Refer a Candidate'].includes(submissionType)) {
      throw createServiceError(400, { error: 'Ã™â€ Ã™Ë†Ã˜Â¹ Ã˜Â§Ã™â€žÃ˜ÂªÃ™â€šÃ˜Â¯Ã™Å Ã™â€¦ Ã˜ÂºÃ™Å Ã˜Â± Ã˜ÂµÃ˜Â§Ã™â€žÃ˜Â­' });
    }
    const applicationSource = body.applicationSource || 'Website';
    if (!['Mobile App', 'Website', 'External Platforms', 'Internal'].includes(applicationSource)) {
      throw createServiceError(400, { error: 'Ã™â€¦Ã˜ÂµÃ˜Â¯Ã˜Â± Ã˜Â§Ã™â€žÃ˜Â·Ã™â€žÃ˜Â¨ Ã˜ÂºÃ™Å Ã˜Â± Ã˜ÂµÃ˜Â§Ã™â€žÃ˜Â­' });
    }
    if (submissionType === 'Refer a Candidate' && !body.referrer?.fullName?.trim()) {
      throw createServiceError(400, { error: 'Ã˜Â§Ã˜Â³Ã™â€¦ Ã˜Â§Ã™â€žÃ™â€¦Ã™ÂÃ˜Â¹Ã˜Â±Ã™â€˜Ã™Â Ã™â€¦Ã˜Â·Ã™â€žÃ™Ë†Ã˜Â¨ Ã˜Â¹Ã™â€ Ã˜Â¯ Ã˜Â§Ã™â€žÃ˜ÂªÃ™â€šÃ˜Â¯Ã™Å Ã™â€¦ Ã™â€ Ã™Å Ã˜Â§Ã˜Â¨Ã˜Â© Ã˜Â¹Ã™â€  Ã™â€¦Ã˜Â±Ã˜Â´Ã˜Â­' });
    }

    await client.query('BEGIN');

    const vacancy = await findVacancyById(client, body.jobVacancyId);
    if (!vacancy) {
      await client.query('ROLLBACK');
      throw createServiceError(404, { error: 'Ã˜Â§Ã™â€žÃ˜Â´Ã˜Â§Ã˜ÂºÃ˜Â± Ã˜Â§Ã™â€žÃ™Ë†Ã˜Â¸Ã™Å Ã™ÂÃ™Å  Ã˜ÂºÃ™Å Ã˜Â± Ã™â€¦Ã™Ë†Ã˜Â¬Ã™Ë†Ã˜Â¯' });
    }
    if (vacancy.status !== 'Open') {
      await client.query('ROLLBACK');
      throw createServiceError(400, { error: 'Ã˜Â§Ã™â€žÃ˜Â´Ã˜Â§Ã˜ÂºÃ˜Â± Ã˜Â§Ã™â€žÃ™Ë†Ã˜Â¸Ã™Å Ã™ÂÃ™Å  Ã˜ÂºÃ™Å Ã˜Â± Ã™â€¦Ã™ÂÃ˜ÂªÃ™Ë†Ã˜Â­ Ã™â€žÃ™â€žÃ˜ÂªÃ™â€šÃ˜Â¯Ã™Å Ã™â€¦' });
    }

    const dupResult = await checkPublicApplicationDuplicate(client, a.mobileNumber, body.jobVacancyId);
    if (dupResult.blocked) {
      await client.query('ROLLBACK');
      throw createServiceError(409, {
        error: 'Ã™Å Ã™Ë†Ã˜Â¬Ã˜Â¯ Ã˜Â·Ã™â€žÃ˜Â¨ Ã™â€ Ã˜Â´Ã˜Â· Ã˜Â¨Ã˜Â§Ã™â€žÃ™ÂÃ˜Â¹Ã™â€ž Ã™â€žÃ™â€¡Ã˜Â°Ã˜Â§ Ã˜Â§Ã™â€žÃ˜Â±Ã™â€šÃ™â€¦ Ã™Ë†Ã˜Â§Ã™â€žÃ˜Â´Ã˜Â§Ã˜ÂºÃ˜Â± Ã˜Â§Ã™â€žÃ™Ë†Ã˜Â¸Ã™Å Ã™ÂÃ™Å ',
        duplicateApplicationId: dupResult.duplicateApplicationId,
      });
    }
    const duplicateFlag = 'duplicateFlag' in dupResult ? dupResult.duplicateFlag : undefined;

    const applicantId = await insertApplicant(client, a);

    let referrerId: number | null = null;
    if (submissionType === 'Refer a Candidate' && body.referrer) {
      referrerId = await insertReferrer(client, body.referrer);
    }

    const appRow = await insertJobApplication(client, {
      jobVacancyId: body.jobVacancyId,
      applicantId,
      referrerId,
      submissionType,
      applicationSource,
      enteredByUserId: body.enteredByUserId || null,
      enteredByName: body.enteredByName || null,
      duplicateFlag,
    });

    await insertAuditLog(client, {
      entityType: 'job_application',
      entityId: appRow.id,
      applicationId: appRow.id,
      actionType: 'Application Submitted',
      performedByRole: submissionType === 'Refer a Candidate' ? 'Referrer' : 'Applicant',
      newValue: JSON.stringify({
        applicantId, referrerId,
        jobVacancyId: body.jobVacancyId,
        submissionType, applicationSource, duplicateFlag,
      }),
    });

    await client.query('COMMIT');
    return appRow;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {}
    throw err;
  } finally {
    client.release();
  }
}
