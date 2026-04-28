import pool from '../db.js';
import { insertAuditLog } from '../utils/auditLog.js';
import {
  addTrainingCourseTraineeRecord,
  countRetrainingResultsByApplication,
  countTrainingAttendanceByApplication,
  countTrainingCourses,
  createTrainingCourseRecord,
  findActiveTrainingForApplication,
  findApplicationStatusById,
  findTrainingApplicationById,
  findTrainingCourseTrainee,
  findTrainingVacancyById,
  getEligibleTrainingApplications,
  getTrainingCourseAttendance,
  getTrainingCourseById,
  getTrainingCourseTraineeIds,
  getTrainingCourseTraineeResult,
  getTrainingCourseTraineesDetail,
  getTrainingCourseTraineesSummary,
  getTrainingCourseTraineeWithVacancy,
  getTrainingVacancySummary,
  getVacancyMaxRetrainingCount,
  listTrainingCourses,
  updateApplicationAfterTrainingResult,
  updateApplicationTrainingCompleted,
  updateApplicationTrainingScheduled,
  updateApplicationTrainingStarted,
  updateTrainingCourseStatus,
  updateTrainingCourseTraineeResult,
  upsertTrainingAttendanceRecord,
} from '../repositories/trainingCourseRepository.js';

type ServiceError = Error & { status?: number; payload?: Record<string, unknown> };
type TrainingActor = { id: number; role: string };

function createServiceError(status: number, payload: Record<string, unknown>): ServiceError {
  const err = new Error(String(payload.error ?? 'Service error')) as ServiceError;
  err.status = status;
  err.payload = payload;
  return err;
}

function mapCourse(row: any) {
  return {
    id: row.id,
    trainingName: row.training_name,
    jobVacancyId: row.job_vacancy_id,
    branch: row.branch,
    deviceName: row.device_name,
    trainer: row.trainer,
    startDate: row.start_date,
    endDate: row.end_date,
    trainingStatus: row.training_status,
    notes: row.notes,
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function validateTrainingApplicationEligibility(applicationId: number, jobVacancyId: number) {
  const app = await findTrainingApplicationById(applicationId);
  if (!app) throw createServiceError(400, { error: `الطلب رقم ${applicationId} غير موجود` });
  if (app.current_stage !== 'Training') throw createServiceError(400, { error: `الطلب رقم ${applicationId} ليس في مرحلة التدريب` });
  if (!['Approved', 'Retraining'].includes(app.application_status)) throw createServiceError(400, { error: `الطلب رقم ${applicationId} ليس في حالة مؤهلة للتدريب` });
  if (Number(app.job_vacancy_id) !== Number(jobVacancyId)) throw createServiceError(400, { error: `الطلب رقم ${applicationId} لا ينتمي لنفس الشاغر الوظيفي` });
  const activeRows = await findActiveTrainingForApplication(applicationId);
  if (activeRows.length > 0) throw createServiceError(400, { error: `الطلب رقم ${applicationId} مسجل بالفعل في دورة نشطة` });
}

export async function getEligibleTrainingTrainees(jobVacancyId: string) {
  return getEligibleTrainingApplications(jobVacancyId);
}

export async function createTrainingCourse(body: any, user: TrainingActor) {
  const client = await pool.connect();
  try {
    const { training_name, job_vacancy_id, branch, device_name, trainer, start_date, end_date, notes, trainee_application_ids } = body;
    if (!training_name?.trim()) throw createServiceError(400, { error: 'اسم الدورة مطلوب' });
    if (!job_vacancy_id) throw createServiceError(400, { error: 'معرّف الشاغر الوظيفي مطلوب' });
    if (!branch?.trim()) throw createServiceError(400, { error: 'الفرع مطلوب' });
    if (!trainer?.trim()) throw createServiceError(400, { error: 'اسم المدرب مطلوب' });
    if (!start_date || !end_date) throw createServiceError(400, { error: 'تواريخ الدورة مطلوبة' });
    if (new Date(start_date) > new Date(end_date)) throw createServiceError(400, { error: 'تاريخ البدء يجب أن يكون قبل أو يساوي تاريخ الانتهاء' });
    const today = new Date(); today.setHours(0, 0, 0, 0);
    if (new Date(start_date) < today) throw createServiceError(400, { error: 'لا يمكن جدولة دورة بتاريخ بدء في الماضي' });
    if (!Array.isArray(trainee_application_ids) || trainee_application_ids.length === 0) throw createServiceError(400, { error: 'يجب إضافة متدرب واحد على الأقل' });
    const uniqueIds = new Set(trainee_application_ids);
    if (uniqueIds.size !== trainee_application_ids.length) throw createServiceError(400, { error: 'يوجد تكرار في قائمة المتدربين' });
    const vacancy = await findTrainingVacancyById(job_vacancy_id);
    if (!vacancy) throw createServiceError(404, { error: 'الشاغر الوظيفي غير موجود' });
    for (const appId of trainee_application_ids) await validateTrainingApplicationEligibility(Number(appId), Number(job_vacancy_id));

    await client.query('BEGIN');
    const course = await createTrainingCourseRecord(client, { training_name, job_vacancy_id, branch, device_name, trainer, start_date, end_date, notes, created_by_user_id: user.id });
    for (const appId of trainee_application_ids) {
      const oldStatus = await findApplicationStatusById(client, Number(appId));
      await addTrainingCourseTraineeRecord(client, course.id, Number(appId));
      await updateApplicationTrainingScheduled(client, Number(appId));
      await insertAuditLog(client, { entityType: 'TrainingCourse', entityId: course.id, applicationId: Number(appId), actionType: 'Training Scheduled', performedByRole: user.role, performedByUserId: user.id, oldValue: oldStatus?.application_status, newValue: 'Training Scheduled' });
    }
    await client.query('COMMIT');
    const trainees = await getTrainingCourseTraineesSummary(course.id);
    return { ...mapCourse(course), trainees };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function listTrainingCoursesFlow(query: Record<string, string>) {
  const { branch, start_date, end_date, trainer, device_name, training_status, job_vacancy_id, search, page = '1', per_page = '25' } = query;
  const conditions: string[] = [];
  const params: any[] = [];
  let idx = 1;
  if (branch) { conditions.push(`tc.branch ILIKE $${idx++}`); params.push(`%${branch}%`); }
  if (start_date) { conditions.push(`tc.start_date >= $${idx++}`); params.push(start_date); }
  if (end_date) { conditions.push(`tc.end_date <= $${idx++}`); params.push(end_date); }
  if (trainer) { conditions.push(`tc.trainer ILIKE $${idx++}`); params.push(`%${trainer}%`); }
  if (device_name) { conditions.push(`tc.device_name ILIKE $${idx++}`); params.push(`%${device_name}%`); }
  if (training_status) { conditions.push(`tc.training_status = $${idx++}`); params.push(training_status); }
  if (job_vacancy_id) { conditions.push(`tc.job_vacancy_id = $${idx++}`); params.push(job_vacancy_id); }
  if (search) { conditions.push(`(tc.training_name ILIKE $${idx} OR CAST(tc.id AS TEXT) = $${idx})`); params.push(`%${search}%`); idx++; }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const perPageN = Math.min(parseInt(per_page) || 25, 100);
  const pageN = Math.max(parseInt(page) || 1, 1);
  const offset = (pageN - 1) * perPageN;
  const totalCount = await countTrainingCourses(where, params);
  const rows = await listTrainingCourses(where, params, perPageN, offset);
  return {
    courses: rows.map(r => ({ ...mapCourse(r), registeredTraineesCount: parseInt(r.registered_trainees_count), graduatedTraineesCount: parseInt(r.graduated_trainees_count) })),
    totalCount, page: pageN, perPage: perPageN,
  };
}

export async function getTrainingCourseDetail(courseId: string) {
  const course = await getTrainingCourseById(courseId);
  if (!course) throw createServiceError(404, { error: 'الدورة التدريبية غير موجودة' });
  const vacancy = course.job_vacancy_id ? await getTrainingVacancySummary(course.job_vacancy_id) : null;
  const trainees = await getTrainingCourseTraineesDetail(courseId);
  const attendance = await getTrainingCourseAttendance(courseId);
  return { ...mapCourse(course), vacancy, trainees, attendance };
}

export async function startTrainingCourse(courseId: string, user: TrainingActor) {
  const client = await pool.connect();
  try {
    const course = await getTrainingCourseById(courseId, client);
    if (!course) throw createServiceError(404, { error: 'الدورة التدريبية غير موجودة' });
    if (course.training_status !== 'Training Scheduled') throw createServiceError(400, { error: 'يمكن بدء الدورة فقط إذا كانت في حالة "مجدولة"' });
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const startDate = new Date(course.start_date); startDate.setHours(0, 0, 0, 0);
    if (startDate > today) throw createServiceError(400, { error: 'لا يمكن بدء الدورة قبل تاريخ البدء المحدد' });
    const traineeRows = await getTrainingCourseTraineeIds(client, courseId);
    if (traineeRows.length === 0) throw createServiceError(400, { error: 'لا يمكن بدء دورة بدون متدربين' });
    await client.query('BEGIN');
    await updateTrainingCourseStatus(client, courseId, 'Training Started');
    for (const { application_id } of traineeRows) {
      await updateApplicationTrainingStarted(client, application_id);
      await insertAuditLog(client, { entityType: 'TrainingCourse', entityId: parseInt(courseId), applicationId: application_id, actionType: 'Training Started', performedByRole: user.role, performedByUserId: user.id, oldValue: 'Training Scheduled', newValue: 'Training Started' });
    }
    await client.query('COMMIT');
    const updated = await getTrainingCourseById(courseId);
    return mapCourse(updated);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function recordTrainingAttendance(courseId: string, body: any, user: TrainingActor) {
  const client = await pool.connect();
  try {
    const { attendance, attendance_date } = body;
    const course = await getTrainingCourseById(courseId, client);
    if (!course) throw createServiceError(404, { error: 'الدورة التدريبية غير موجودة' });
    if (course.training_status !== 'Training Started') throw createServiceError(400, { error: 'يمكن تسجيل الحضور فقط للدورات النشطة' });
    if (!attendance_date) throw createServiceError(400, { error: 'تاريخ الحضور مطلوب' });
    const attDate = new Date(attendance_date); attDate.setHours(0, 0, 0, 0);
    const sDate = new Date(course.start_date); sDate.setHours(0, 0, 0, 0);
    const eDate = new Date(course.end_date); eDate.setHours(0, 0, 0, 0);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    if (attDate < sDate || attDate > eDate) throw createServiceError(400, { error: 'تاريخ الحضور يجب أن يكون ضمن نطاق الدورة' });
    if (attDate > today) throw createServiceError(400, { error: 'لا يمكن تسجيل حضور لتاريخ مستقبلي' });
    if (!Array.isArray(attendance) || attendance.length === 0) throw createServiceError(400, { error: 'بيانات الحضور مطلوبة' });
    const traineeRows = await getTrainingCourseTraineeIds(client, courseId);
    const traineeSet = new Set(traineeRows.map((r: any) => Number(r.application_id)));
    for (const entry of attendance) {
      if (!traineeSet.has(Number(entry.application_id))) throw createServiceError(400, { error: `الطلب رقم ${entry.application_id} ليس متدرباً في هذه الدورة` });
      const trainee = await getTrainingCourseTraineeResult(client, courseId, Number(entry.application_id));
      if (trainee?.result != null) throw createServiceError(400, { error: `لا يمكن تعديل حضور المتدرب ${entry.application_id} بعد تسجيل النتيجة` });
    }
    await client.query('BEGIN');
    const results = [];
    for (const entry of attendance) {
      const row = await upsertTrainingAttendanceRecord(client, { courseId, applicationId: Number(entry.application_id), attendanceDate: attendance_date, status: entry.status, recordedByUserId: user.id });
      results.push(row);
      await insertAuditLog(client, { entityType: 'TrainingAttendance', entityId: parseInt(courseId), applicationId: Number(entry.application_id), actionType: 'Attendance Recorded', performedByRole: user.role, performedByUserId: user.id, newValue: JSON.stringify({ date: attendance_date, status: entry.status }) });
    }
    await client.query('COMMIT');
    return results;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function completeTrainingCourse(courseId: string, user: TrainingActor) {
  const client = await pool.connect();
  try {
    const course = await getTrainingCourseById(courseId, client);
    if (!course) throw createServiceError(404, { error: 'الدورة التدريبية غير موجودة' });
    if (course.training_status !== 'Training Started') throw createServiceError(400, { error: 'يمكن إكمال الدورة فقط إذا كانت في حالة "جارية"' });
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const endDate = new Date(course.end_date); endDate.setHours(0, 0, 0, 0);
    if (today < endDate) throw createServiceError(400, { error: 'لا يمكن إكمال الدورة قبل تاريخ الانتهاء المحدد' });
    const traineeRows = await getTrainingCourseTraineeIds(client, courseId);
    let courseDays = 0;
    const cur = new Date(course.start_date); cur.setHours(0, 0, 0, 0);
    const eDate2 = new Date(course.end_date); eDate2.setHours(0, 0, 0, 0);
    while (cur <= eDate2) { courseDays++; cur.setDate(cur.getDate() + 1); }
    for (const { application_id } of traineeRows) {
      const attendanceCount = await countTrainingAttendanceByApplication(client, courseId, application_id);
      if (attendanceCount < courseDays) throw createServiceError(400, { error: `لم يتم تسجيل الحضور لجميع أيام الدورة للمتدرب رقم ${application_id}` });
    }
    await client.query('BEGIN');
    await updateTrainingCourseStatus(client, courseId, 'Training Completed');
    for (const { application_id } of traineeRows) {
      const trainee = await getTrainingCourseTraineeResult(client, courseId, application_id);
      if (trainee?.result == null) {
        await updateApplicationTrainingCompleted(client, application_id);
        await insertAuditLog(client, { entityType: 'TrainingCourse', entityId: parseInt(courseId), applicationId: application_id, actionType: 'Training Completed', performedByRole: user.role, performedByUserId: user.id, oldValue: 'Training Started', newValue: 'Training Completed' });
      }
    }
    await client.query('COMMIT');
    const updated = await getTrainingCourseById(courseId);
    return mapCourse(updated);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function recordTrainingResult(courseId: string, applicationId: number, body: any, user: TrainingActor) {
  const client = await pool.connect();
  try {
    const { result } = body;
    if (!['Passed', 'Retraining', 'Rejected', 'Retreated'].includes(result)) throw createServiceError(400, { error: 'نتيجة غير صالحة' });
    const course = await getTrainingCourseById(courseId, client);
    if (!course) throw createServiceError(404, { error: 'الدورة التدريبية غير موجودة' });
    if (course.training_status !== 'Training Completed') throw createServiceError(400, { error: 'يمكن تسجيل النتيجة فقط بعد إكمال الدورة' });
    const trainee = await getTrainingCourseTraineeWithVacancy(client, courseId, applicationId);
    if (!trainee) throw createServiceError(404, { error: 'المتدرب غير موجود في هذه الدورة' });
    if (trainee.result != null) throw createServiceError(400, { error: 'تم تسجيل النتيجة بالفعل ولا يمكن تعديلها' });
    if (result === 'Retraining') {
      const retrainingCount = await countRetrainingResultsByApplication(client, applicationId);
      const maxRetraining = await getVacancyMaxRetrainingCount(client, trainee.job_vacancy_id);
      if (retrainingCount >= maxRetraining) throw createServiceError(400, { error: `تم استنفاد الحد الأقصى لإعادة التدريب (${maxRetraining}). يُسمح فقط بـ: ناجح، مرفوض، أو منسحب.` });
    }
    let newStage: string, newStatus: string, newDecision: string | null, newStageStatus: string;
    if (result === 'Passed') { newStage = 'Final Decision'; newStatus = 'Passed'; newDecision = 'Passed'; newStageStatus = 'Awaiting Decision'; }
    else if (result === 'Retraining') { newStage = 'Training'; newStatus = 'Retraining'; newDecision = 'Retraining'; newStageStatus = 'Ready'; }
    else if (result === 'Rejected') { newStage = 'Final Decision'; newStatus = 'Passed'; newDecision = null; newStageStatus = 'Awaiting Decision'; }
    else { newStage = 'Training'; newStatus = 'Retreated'; newDecision = 'Retreated'; newStageStatus = 'Completed'; }
    await client.query('BEGIN');
    await updateTrainingCourseTraineeResult(client, courseId, applicationId, result, user.id);
    await updateApplicationAfterTrainingResult(client, { applicationId, newStage, newStatus, newStageStatus, newDecision });
    await insertAuditLog(client, { entityType: 'TrainingCourse', entityId: parseInt(courseId), applicationId, actionType: 'Training Result Recorded', performedByRole: user.role, performedByUserId: user.id, oldValue: 'Training Completed', newValue: result });
    await client.query('COMMIT');
    return { applicationId, result, newStage, newStatus };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function addTrainingCourseTrainees(courseId: string, body: any, user: TrainingActor) {
  const client = await pool.connect();
  try {
    const { application_ids } = body;
    const course = await getTrainingCourseById(courseId, client);
    if (!course) throw createServiceError(404, { error: 'الدورة التدريبية غير موجودة' });
    if (course.training_status !== 'Training Scheduled') throw createServiceError(400, { error: 'يمكن إضافة متدربين فقط للدورات المجدولة' });
    if (!Array.isArray(application_ids) || application_ids.length === 0) throw createServiceError(400, { error: 'يجب تحديد متدرب واحد على الأقل' });
    const uniqueIds = new Set(application_ids);
    if (uniqueIds.size !== application_ids.length) throw createServiceError(400, { error: 'يوجد تكرار في قائمة المتدربين' });
    for (const appId of application_ids) {
      await validateTrainingApplicationEligibility(Number(appId), Number(course.job_vacancy_id));
      const exists = await findTrainingCourseTrainee(courseId, Number(appId));
      if (exists) throw createServiceError(400, { error: `الطلب رقم ${appId} مسجل بالفعل في هذه الدورة` });
    }
    await client.query('BEGIN');
    const added = [];
    for (const appId of application_ids) {
      const oldStatus = await findApplicationStatusById(client, Number(appId));
      await addTrainingCourseTraineeRecord(client, courseId, Number(appId));
      await updateApplicationTrainingScheduled(client, Number(appId));
      await insertAuditLog(client, { entityType: 'TrainingCourse', entityId: parseInt(courseId), applicationId: Number(appId), actionType: 'Training Scheduled', performedByRole: user.role, performedByUserId: user.id, oldValue: oldStatus?.application_status, newValue: 'Training Scheduled' });
      added.push(Number(appId));
    }
    await client.query('COMMIT');
    return { added };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
