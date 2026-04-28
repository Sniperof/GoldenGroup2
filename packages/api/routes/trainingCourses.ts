import { Router } from 'express';
import pool from '../db.js';
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

// GET /training-courses/trainers?branchId=X
// Returns users who have the jobs.training.be_trainer permission and are assigned to the given branch
router.get('/trainers', requirePermission('jobs.training.create'), async (req, res) => {
  try {
    const branchId = req.query.branchId ? Number(req.query.branchId) : null;
    if (!branchId || isNaN(branchId)) {
      return res.status(400).json({ error: 'branchId is required' });
    }

    const { rows } = await pool.query(
      `SELECT DISTINCT u.id, u.name,
              r.display_name AS "roleDisplayName",
              b.name AS "branchName"
         FROM hr_users u
         JOIN roles r ON r.id = u.role_id
         JOIN user_branch_assignments uba ON uba.user_id = u.id
           AND uba.branch_id = $1
           AND uba.status = 'active'
         JOIN branches b ON b.id = uba.branch_id
        WHERE u.is_active = TRUE
          AND COALESCE(r.is_system, FALSE) = FALSE
          AND COALESCE(r.is_hidden, FALSE) = FALSE
          AND EXISTS (
            SELECT 1
              FROM role_permission_grants rpg
              JOIN permissions p ON p.id = rpg.permission_id
             WHERE rpg.role_id = u.role_id
               AND p.key = 'jobs.training.be_trainer'
               AND rpg.scope_type IN ('BRANCH', 'GLOBAL')
          )
        ORDER BY u.name ASC`,
      [branchId],
    );

    res.json(rows);
  } catch (err: any) {
    console.error('Error fetching eligible trainers:', err);
    res.status(500).json({ error: err.message });
  }
});

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
