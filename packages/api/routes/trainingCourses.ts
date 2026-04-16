import { Router } from 'express';
import pool from '../db.js';
import { requirePermission } from '../middleware/permission.js';
import { paginatedResponse, parsePagination } from '../utils/paginate.js';
import {
  addTrainingCourseTrainees,
  completeTrainingCourse,
  createTrainingCourse,
  getEligibleTrainingTrainees,
  getTrainingCourseDetail,
  listTrainingCoursesFlow,
  recordTrainingAttendance,
  recordTrainingResult,
  startTrainingCourse,
} from '../services/trainingCourseService.js';

const router = Router();

router.get('/eligible/:jobVacancyId', requirePermission('jobs.training.view_eligible'), async (req, res) => {
  try {
    const jobVacancyId = Array.isArray(req.params.jobVacancyId) ? req.params.jobVacancyId[0] : req.params.jobVacancyId;
    const rows = await getEligibleTrainingTrainees(jobVacancyId);
    res.json(rows);
  } catch (err: any) {
    console.error('Error fetching eligible trainees:', err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/', requirePermission('jobs.training.create'), async (req, res) => {
  try {
    const result = await createTrainingCourse(req.body, req.user!);
    res.status(201).json(result);
  } catch (err: any) {
    if (err?.status) return res.status(err.status).json(err.payload ?? { error: err.message });
    console.error('Error creating training course:', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/', requirePermission('jobs.training.view_list'), async (req, res) => {
  try {
    const result = await listTrainingCoursesFlow(req.query as Record<string, string>);
    res.json(result);
  } catch (err: any) {
    console.error('Error fetching training courses:', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', requirePermission('jobs.training.view_detail'), async (req, res) => {
  try {
    const courseId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const result = await getTrainingCourseDetail(courseId);
    res.json(result);
  } catch (err: any) {
    if (err?.status) return res.status(err.status).json(err.payload ?? { error: err.message });
    console.error('Error fetching training course detail:', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id/trainees', requirePermission('jobs.training.view_detail'), async (req, res) => {
  try {
    const courseId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const resultState = Array.isArray(req.query.resultState) ? req.query.resultState[0] : req.query.resultState;
    const { page, limit, offset } = parsePagination(req.query, 10);

    const conditions = ['tct.training_course_id = $1'];
    const params: Array<string | number> = [courseId];

    if (resultState === 'recorded') conditions.push('tct.result IS NOT NULL');
    if (resultState === 'pending') conditions.push('tct.result IS NULL');

    const where = `WHERE ${conditions.join(' AND ')}`;

    const [listRes, countRes] = await Promise.all([
      pool.query(
        `SELECT tct.id, tct.training_course_id AS "trainingCourseId",
          tct.application_id AS "applicationId",
          a.first_name AS "firstName", a.last_name AS "lastName",
          ja.application_status AS "applicationStatus",
          tct.result, tct.result_recorded_at AS "resultRecordedAt", tct.added_at AS "addedAt"
         FROM training_course_trainees tct
         JOIN job_applications ja ON ja.id = tct.application_id
         JOIN applicants a ON a.id = ja.applicant_id
         ${where}
         ORDER BY tct.added_at ASC
         LIMIT $2 OFFSET $3`,
        [...params, limit, offset]
      ),
      pool.query(
        `SELECT COUNT(*)
         FROM training_course_trainees tct
         ${where}`,
        params
      ),
    ]);

    res.json(paginatedResponse(listRes.rows, parseInt(countRes.rows[0].count, 10), page, limit));
  } catch (err: any) {
    console.error('Error fetching training course trainees:', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id/attendance', requirePermission('jobs.training.view_detail'), async (req, res) => {
  try {
    const courseId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const { page, limit, offset } = parsePagination(req.query, 10);

    const [traineeRes, countRes, datesRes] = await Promise.all([
      pool.query(
        `SELECT tct.id, tct.training_course_id AS "trainingCourseId",
          tct.application_id AS "applicationId",
          a.first_name AS "firstName", a.last_name AS "lastName",
          ja.application_status AS "applicationStatus",
          tct.result, tct.result_recorded_at AS "resultRecordedAt", tct.added_at AS "addedAt"
         FROM training_course_trainees tct
         JOIN job_applications ja ON ja.id = tct.application_id
         JOIN applicants a ON a.id = ja.applicant_id
         WHERE tct.training_course_id = $1
         ORDER BY tct.added_at ASC
         LIMIT $2 OFFSET $3`,
        [courseId, limit, offset]
      ),
      pool.query(
        `SELECT COUNT(*) FROM training_course_trainees WHERE training_course_id = $1`,
        [courseId]
      ),
      pool.query(
        `SELECT DISTINCT attendance_date AS "attendanceDate"
         FROM training_attendance
         WHERE training_course_id = $1
         ORDER BY "attendanceDate" ASC`,
        [courseId]
      ),
    ]);

    const applicationIds = traineeRes.rows.map((row) => Number(row.applicationId));
    const attendanceRes = applicationIds.length > 0
      ? await pool.query(
          `SELECT application_id AS "applicationId",
            attendance_date AS "attendanceDate",
            status
           FROM training_attendance
           WHERE training_course_id = $1
             AND application_id = ANY($2::int[])
           ORDER BY attendance_date ASC, application_id ASC`,
          [courseId, applicationIds]
        )
      : { rows: [] };

    res.json({
      ...paginatedResponse(traineeRes.rows, parseInt(countRes.rows[0].count, 10), page, limit),
      attendanceDates: datesRes.rows.map((row) => row.attendanceDate),
      attendance: attendanceRes.rows,
    });
  } catch (err: any) {
    console.error('Error fetching training course attendance:', err);
    res.status(500).json({ error: err.message });
  }
});

router.patch('/:id/start', requirePermission('jobs.training.start'), async (req, res) => {
  try {
    const courseId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const result = await startTrainingCourse(courseId, req.user!);
    res.json(result);
  } catch (err: any) {
    if (err?.status) return res.status(err.status).json(err.payload ?? { error: err.message });
    console.error('Error starting training course:', err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/attendance', requirePermission('jobs.training.record_attendance'), async (req, res) => {
  try {
    const courseId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const result = await recordTrainingAttendance(courseId, req.body, req.user!);
    res.json(result);
  } catch (err: any) {
    if (err?.status) return res.status(err.status).json(err.payload ?? { error: err.message });
    console.error('Error recording attendance:', err);
    res.status(500).json({ error: err.message });
  }
});

router.patch('/:id/complete', requirePermission('jobs.training.complete'), async (req, res) => {
  try {
    const courseId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const result = await completeTrainingCourse(courseId, req.user!);
    res.json(result);
  } catch (err: any) {
    if (err?.status) return res.status(err.status).json(err.payload ?? { error: err.message });
    console.error('Error completing training course:', err);
    res.status(500).json({ error: err.message });
  }
});

router.patch('/:id/trainees/:applicationId/result', requirePermission('jobs.training.record_result'), async (req, res) => {
  try {
    const courseId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const applicationIdParam = Array.isArray(req.params.applicationId) ? req.params.applicationId[0] : req.params.applicationId;
    const result = await recordTrainingResult(courseId, parseInt(applicationIdParam), req.body, req.user!);
    res.json(result);
  } catch (err: any) {
    if (err?.status) return res.status(err.status).json(err.payload ?? { error: err.message });
    console.error('Error recording trainee result:', err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/trainees', requirePermission('jobs.training.add_trainees'), async (req, res) => {
  try {
    const courseId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const result = await addTrainingCourseTrainees(courseId, req.body, req.user!);
    res.json(result);
  } catch (err: any) {
    if (err?.status) return res.status(err.status).json(err.payload ?? { error: err.message });
    console.error('Error adding trainees:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
