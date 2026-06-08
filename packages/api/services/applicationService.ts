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
  branchId: number;
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

    if (!a.firstName?.trim()) throw createServiceError(400, { error: 'الاسم الأول مطلوب' });
    if (!a.lastName?.trim()) throw createServiceError(400, { error: 'اسم العائلة مطلوب' });
    if (!a.mobileNumber?.trim()) throw createServiceError(400, { error: 'رقم الهاتف مطلوب' });
    if (!/^\d{10,11}$/.test(a.mobileNumber)) throw createServiceError(400, { error: 'رقم الهاتف يجب أن يكون 10-11 رقم' });
    if (a.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a.email)) throw createServiceError(400, { error: 'صيغة البريد الإلكتروني غير صحيحة' });
    if (!a.dob) throw createServiceError(400, { error: 'تاريخ الميلاد مطلوب' });
    if (!a.gender) throw createServiceError(400, { error: 'الجنس مطلوب' });
    if (!a.maritalStatus) throw createServiceError(400, { error: 'الحالة الاجتماعية مطلوبة' });
    if (!a.governorate?.trim()) throw createServiceError(400, { error: 'المحافظة مطلوبة' });
    if (!a.detailedAddress?.trim()) throw createServiceError(400, { error: 'العنوان التفصيلي مطلوب' });
    if (typeof a.hasCar !== 'boolean') throw createServiceError(400, { error: 'يرجى تحديد هل تمتلك سيارة' });
    if (!body.jobVacancyId) throw createServiceError(400, { error: 'الشاغر الوظيفي حقل إلزامي' });

    const submissionType = body.submissionType;
    if (!['Apply', 'Refer a Candidate'].includes(submissionType)) {
      throw createServiceError(400, { error: 'نوع التقديم غير صالح' });
    }
    const applicationSource = body.applicationSource || 'Website';
    if (!['Mobile App', 'Website', 'External Platforms', 'Internal'].includes(applicationSource)) {
      throw createServiceError(400, { error: 'مصدر الطلب غير صالح' });
    }
    if (submissionType === 'Refer a Candidate' && !body.referrer?.fullName?.trim()) {
      throw createServiceError(400, { error: 'اسم المُعرّف مطلوب عند التقديم نيابة عن مرشح' });
    }

    await client.query('BEGIN');

    const vacancy = await findVacancyById(client, body.jobVacancyId);
    if (!vacancy) {
      await client.query('ROLLBACK');
      throw createServiceError(404, { error: 'الشاغر الوظيفي غير موجود' });
    }
    if (vacancy.status !== 'Open') {
      await client.query('ROLLBACK');
      throw createServiceError(400, { error: 'الشاغر الوظيفي غير مفتوح للتقديم' });
    }

    if (!vacancy.branchId) {
      await client.query('ROLLBACK');
      throw createServiceError(400, { error: '?? ???? ????? ??? ???? ?????? ??? ?????? ??? ????? ????.' });
    }

    const dupResult = await checkPublicApplicationDuplicate(client, a.mobileNumber, body.jobVacancyId);
    if (dupResult.blocked) {
      await client.query('ROLLBACK');
      throw createServiceError(409, {
        error: 'يوجد طلب نشط بالفعل لهذا الرقم والشاغر الوظيفي',
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
      branchId: vacancy.branchId,
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
