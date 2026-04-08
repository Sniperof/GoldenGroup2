import { Router } from 'express';
import { requirePermission } from '../middleware/permission.js';
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
