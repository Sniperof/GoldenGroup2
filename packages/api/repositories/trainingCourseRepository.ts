import type { PoolClient } from 'pg';
import pool from '../db.js';
import { sanitizeText } from '../utils/sanitize.js';

export async function getEligibleTrainingApplications(jobVacancyId: string) {
  const { rows } = await pool.query(
    `SELECT ja.id AS "applicationId",
       a.first_name AS "firstName", a.last_name AS "lastName",
       a.mobile_number AS "mobileNumber",
       ja.application_status AS "applicationStatus"
     FROM job_applications ja
     JOIN applicants a ON a.id = ja.applicant_id
     WHERE ja.job_vacancy_id = $1
       AND ja.current_stage = 'Training'
       AND ja.application_status IN ('Approved', 'Retraining')
       AND ja.id NOT IN (
         SELECT tct.application_id FROM training_course_trainees tct
         JOIN training_courses tc ON tc.id = tct.training_course_id
         WHERE tc.training_status = 'Training Started'
       )
     ORDER BY a.last_name, a.first_name`,
    [jobVacancyId]
  );
  return rows;
}

export async function findTrainingVacancyById(jobVacancyId: number) {
  const { rows } = await pool.query(`SELECT id FROM job_vacancies WHERE id = $1`, [jobVacancyId]);
  return rows[0] ?? null;
}

export async function findTrainingApplicationById(applicationId: number) {
  const { rows } = await pool.query(
    `SELECT id, current_stage, application_status, job_vacancy_id FROM job_applications WHERE id = $1`,
    [applicationId]
  );
  return rows[0] ?? null;
}

export async function findActiveTrainingForApplication(applicationId: number) {
  const { rows } = await pool.query(
    `SELECT tc.id FROM training_course_trainees tct
     JOIN training_courses tc ON tc.id = tct.training_course_id
     WHERE tct.application_id = $1 AND tc.training_status = 'Training Started'`,
    [applicationId]
  );
  return rows;
}

export async function findTrainingCourseTrainee(courseId: string, applicationId: number) {
  const { rows } = await pool.query(
    `SELECT id FROM training_course_trainees WHERE training_course_id = $1 AND application_id = $2`,
    [courseId, applicationId]
  );
  return rows[0] ?? null;
}

export async function createTrainingCourseRecord(client: PoolClient, input: {
  training_name: string;
  job_vacancy_id: number;
  branch: string;
  device_name?: string | null;
  trainer: string;
  start_date: string;
  end_date: string;
  notes?: string | null;
  created_by_user_id: number;
}) {
  const { rows } = await client.query(
    `INSERT INTO training_courses
      (training_name, job_vacancy_id, branch, device_name, trainer, start_date, end_date, notes, created_by_user_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING *`,
    [
      sanitizeText(input.training_name.trim()),
      input.job_vacancy_id,
      sanitizeText(input.branch.trim()),
      input.device_name ? sanitizeText(input.device_name) : null,
      sanitizeText(input.trainer.trim()),
      input.start_date,
      input.end_date,
      input.notes ? sanitizeText(input.notes) : null,
      input.created_by_user_id,
    ]
  );
  return rows[0];
}

export async function findApplicationStatusById(client: PoolClient, applicationId: number) {
  const { rows } = await client.query(`SELECT application_status FROM job_applications WHERE id = $1`, [applicationId]);
  return rows[0] ?? null;
}

export async function addTrainingCourseTraineeRecord(client: PoolClient, courseId: string | number, applicationId: number) {
  await client.query(`INSERT INTO training_course_trainees (training_course_id, application_id) VALUES ($1, $2)`, [courseId, applicationId]);
}

export async function updateApplicationTrainingScheduled(client: PoolClient, applicationId: number) {
  await client.query(
    `UPDATE job_applications SET application_status = 'Training Scheduled', stage_status = 'Scheduled', updated_at = NOW() WHERE id = $1`,
    [applicationId]
  );
}

export async function getTrainingCourseTraineesSummary(courseId: string | number) {
  const { rows } = await pool.query(
    `SELECT tct.application_id AS "applicationId",
       a.first_name AS "firstName", a.last_name AS "lastName"
     FROM training_course_trainees tct
     JOIN job_applications ja ON ja.id = tct.application_id
     JOIN applicants a ON a.id = ja.applicant_id
     WHERE tct.training_course_id = $1`,
    [courseId]
  );
  return rows;
}

export async function countTrainingCourses(where: string, params: any[]) {
  const { rows } = await pool.query(`SELECT COUNT(*) FROM training_courses tc ${where}`, params);
  return parseInt(rows[0].count);
}

export async function listTrainingCourses(where: string, params: any[], limit: number, offset: number) {
  const listParams = [...params, limit, offset];
  const { rows } = await pool.query(
    `SELECT tc.*,
      (SELECT COUNT(*) FROM training_course_trainees WHERE training_course_id = tc.id) AS registered_trainees_count,
      (SELECT COUNT(*) FROM training_course_trainees WHERE training_course_id = tc.id AND result = 'Passed') AS graduated_trainees_count
     FROM training_courses tc
     ${where}
     ORDER BY tc.created_at DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    listParams
  );
  return rows;
}

export async function getTrainingCourseById(courseId: string, client?: PoolClient) {
  const executor = client ?? pool;
  const { rows } = await executor.query(`SELECT * FROM training_courses WHERE id = $1`, [courseId]);
  return rows[0] ?? null;
}

export async function getTrainingVacancySummary(vacancyId: number) {
  const { rows } = await pool.query(`SELECT id, title, branch FROM job_vacancies WHERE id = $1`, [vacancyId]);
  return rows[0] ?? null;
}

export async function getTrainingCourseTraineesDetail(courseId: string) {
  const { rows } = await pool.query(
    `SELECT tct.id, tct.training_course_id AS "trainingCourseId",
       tct.application_id AS "applicationId",
       a.first_name AS "firstName", a.last_name AS "lastName",
       ja.application_status AS "applicationStatus",
       tct.result, tct.result_recorded_at AS "resultRecordedAt", tct.added_at AS "addedAt"
     FROM training_course_trainees tct
     JOIN job_applications ja ON ja.id = tct.application_id
     JOIN applicants a ON a.id = ja.applicant_id
     WHERE tct.training_course_id = $1
     ORDER BY tct.added_at ASC`,
    [courseId]
  );
  return rows;
}

export async function getTrainingCourseAttendance(courseId: string) {
  const { rows } = await pool.query(
    `SELECT application_id AS "applicationId",
       attendance_date AS "attendanceDate", status
     FROM training_attendance
     WHERE training_course_id = $1
     ORDER BY attendance_date ASC, application_id ASC`,
    [courseId]
  );
  return rows;
}

export async function getTrainingCourseTraineeIds(client: PoolClient, courseId: string) {
  const { rows } = await client.query(`SELECT application_id FROM training_course_trainees WHERE training_course_id = $1`, [courseId]);
  return rows;
}

export async function updateTrainingCourseStatus(client: PoolClient, courseId: string, trainingStatus: string) {
  await client.query(`UPDATE training_courses SET training_status = $1, updated_at = NOW() WHERE id = $2`, [trainingStatus, courseId]);
}

export async function updateApplicationTrainingStarted(client: PoolClient, applicationId: number) {
  await client.query(
    `UPDATE job_applications SET application_status = 'Training Started', stage_status = 'In Progress', updated_at = NOW() WHERE id = $1`,
    [applicationId]
  );
}

export async function getTrainingCourseTraineeResult(client: PoolClient, courseId: string, applicationId: number) {
  const { rows } = await client.query(
    `SELECT result FROM training_course_trainees WHERE training_course_id = $1 AND application_id = $2`,
    [courseId, applicationId]
  );
  return rows[0] ?? null;
}

export async function countTrainingAttendanceByApplication(client: PoolClient, courseId: string, applicationId: number) {
  const { rows } = await client.query(
    `SELECT COUNT(*) FROM training_attendance WHERE training_course_id = $1 AND application_id = $2`,
    [courseId, applicationId]
  );
  return parseInt(rows[0].count);
}

export async function updateApplicationTrainingCompleted(client: PoolClient, applicationId: number) {
  await client.query(
    `UPDATE job_applications SET application_status = 'Training Completed', stage_status = 'Completed', updated_at = NOW() WHERE id = $1`,
    [applicationId]
  );
}

export async function upsertTrainingAttendanceRecord(client: PoolClient, input: {
  courseId: string;
  applicationId: number;
  attendanceDate: string;
  status: string;
  recordedByUserId: number;
}) {
  const { rows } = await client.query(
    `INSERT INTO training_attendance
      (training_course_id, application_id, attendance_date, status, recorded_by_user_id)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (training_course_id, application_id, attendance_date)
     DO UPDATE SET status = EXCLUDED.status, recorded_by_user_id = EXCLUDED.recorded_by_user_id
     RETURNING *`,
    [input.courseId, input.applicationId, input.attendanceDate, input.status, input.recordedByUserId]
  );
  return rows[0];
}

export async function getTrainingCourseTraineeWithVacancy(client: PoolClient, courseId: string, applicationId: number) {
  const { rows } = await client.query(
    `SELECT tct.*, ja.job_vacancy_id FROM training_course_trainees tct
     JOIN job_applications ja ON ja.id = tct.application_id
     WHERE tct.training_course_id = $1 AND tct.application_id = $2`,
    [courseId, applicationId]
  );
  return rows[0] ?? null;
}

export async function countRetrainingResultsByApplication(client: PoolClient, applicationId: number) {
  const { rows } = await client.query(
    `SELECT COUNT(*) FROM training_course_trainees WHERE application_id = $1 AND result = 'Retraining'`,
    [applicationId]
  );
  return parseInt(rows[0].count);
}

export async function getVacancyMaxRetrainingCount(client: PoolClient, vacancyId: number) {
  const { rows } = await client.query(`SELECT max_retraining_count FROM job_vacancies WHERE id = $1`, [vacancyId]);
  return rows[0]?.max_retraining_count ?? 1;
}

export async function updateTrainingCourseTraineeResult(client: PoolClient, courseId: string, applicationId: number, result: string, recordedByUserId: number) {
  await client.query(
    `UPDATE training_course_trainees
     SET result = $1, result_recorded_at = NOW(), result_recorded_by = $2
     WHERE training_course_id = $3 AND application_id = $4`,
    [result, recordedByUserId, courseId, applicationId]
  );
}

export async function updateApplicationAfterTrainingResult(client: PoolClient, input: {
  applicationId: number;
  newStage: string;
  newStatus: string;
  newStageStatus: string;
  newDecision: string | null;
}) {
  await client.query(
    `UPDATE job_applications SET current_stage = $1, application_status = $2,
      stage_status = $3, decision = $4, updated_at = NOW() WHERE id = $5`,
    [input.newStage, input.newStatus, input.newStageStatus, input.newDecision, input.applicationId]
  );
}
