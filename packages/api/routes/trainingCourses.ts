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
  updateTrainingCourseEndDateFlow,
} from '../services/trainingCourseService.js';

const router = Router();

// GET /training-courses/trainers?branchId=X
// Returns users who have the jobs.training.be_trainer permission and are assigned to the given branch
/**
 * @swagger
 * /api/admin/training-courses/trainers:
 *   get:
 *     tags: [HR → Training]
 *     summary: Retrieve eligible trainers in a branch
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         schema:
 *           type: integer
 *         required: false
 *       - in: query
 *         name: branchId
 *         schema:
 *           type: integer
 *         required: true
 *     responses:
 *       200:
 *         description: Success
 */
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

/**
 * @swagger
 * /api/admin/training-courses/eligible/{jobVacancyId}:
 *   get:
 *     tags: [HR → Training]
 *     summary: Retrieve eligible training trainees for a vacancy
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         schema:
 *           type: integer
 *         required: false
 *       - in: path
 *         name: jobVacancyId
 *         schema:
 *           type: integer
 *         required: true
 *     responses:
 *       200:
 *         description: Success
 */
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

/**
 * @swagger
 * /api/admin/training-courses:
 *   post:
 *     tags: [HR → Training]
 *     summary: Create a training course
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         schema:
 *           type: integer
 *         required: false
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [trainingName, trainerUserId, branchId, startDate, endDate]
 *             properties:
 *               trainingName:
 *                 type: string
 *               trainerUserId:
 *                 type: integer
 *               branchId:
 *                 type: integer
 *               deviceName:
 *                 type: string
 *               startDate:
 *                 type: string
 *               endDate:
 *                 type: string
 *               notes:
 *                 type: string
 *     responses:
 *       201:
 *         description: Created
 */
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

/**
 * @swagger
 * /api/admin/training-courses:
 *   get:
 *     tags: [HR → Training]
 *     summary: List training courses
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         schema:
 *           type: integer
 *         required: false
 *       - in: query
 *         name: branchId
 *         schema:
 *           type: integer
 *         required: false
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         required: false
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *         required: false
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *         required: false
 *     responses:
 *       200:
 *         description: Success
 */
router.get('/', requirePermission('jobs.training.view_list'), async (req, res) => {
  try {
    const result = await listTrainingCoursesFlow(req.query as Record<string, string>);
    res.json(result);
  } catch (err: any) {
    console.error('Error fetching training courses:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/admin/training-courses/{id}:
 *   get:
 *     tags: [HR → Training]
 *     summary: Get a training course by ID
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         schema:
 *           type: integer
 *         required: false
 *       - in: path
 *         name: id
 *         schema:
 *           type: integer
 *         required: true
 *     responses:
 *       200:
 *         description: Success
 *       404:
 *         description: Not Found
 */
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

/**
 * @swagger
 * /api/admin/training-courses/{id}/start:
 *   patch:
 *     tags: [HR → Training]
 *     summary: Start a training course
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         schema:
 *           type: integer
 *         required: false
 *       - in: path
 *         name: id
 *         schema:
 *           type: integer
 *         required: true
 *     responses:
 *       200:
 *         description: Success
 */
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

/**
 * @swagger
 * /api/admin/training-courses/{id}/attendance:
 *   post:
 *     tags: [HR → Training]
 *     summary: Record training attendance for a course
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         schema:
 *           type: integer
 *         required: false
 *       - in: path
 *         name: id
 *         schema:
 *           type: integer
 *         required: true
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [attendanceDate, records]
 *             properties:
 *               attendanceDate:
 *                 type: string
 *               records:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required: [applicationId, status]
 *                   properties:
 *                     applicationId:
 *                       type: integer
 *                     status:
 *                       type: string
 *                       enum: [Present, Absent]
 *     responses:
 *       200:
 *         description: Success
 */
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


/**
 * @swagger
 * /api/admin/training-courses/{id}/end-date:
 *   patch:
 *     tags: [HR → Training]
 *     summary: Update training course end date
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         schema:
 *           type: integer
 *         required: false
 *       - in: path
 *         name: id
 *         schema:
 *           type: integer
 *         required: true
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [endDate]
 *             properties:
 *               endDate:
 *                 type: string
 *     responses:
 *       200:
 *         description: Success
 */
router.patch('/:id/end-date', requirePermission('jobs.training.create'), async (req, res) => {
  try {
    const courseId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const result = await updateTrainingCourseEndDateFlow(courseId, req.body, req.user!);
    res.json(result);
  } catch (err: any) {
    if (err?.status) return res.status(err.status).json(err.payload ?? { error: err.message });
    console.error('Error updating training course end date:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/admin/training-courses/{id}/complete:
 *   patch:
 *     tags: [HR → Training]
 *     summary: Complete a training course
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         schema:
 *           type: integer
 *         required: false
 *       - in: path
 *         name: id
 *         schema:
 *           type: integer
 *         required: true
 *     responses:
 *       200:
 *         description: Success
 */
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

/**
 * @swagger
 * /api/admin/training-courses/{id}/trainees/{applicationId}/result:
 *   patch:
 *     tags: [HR → Training]
 *     summary: Record result for a trainee
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         schema:
 *           type: integer
 *         required: false
 *       - in: path
 *         name: id
 *         schema:
 *           type: integer
 *         required: true
 *       - in: path
 *         name: applicationId
 *         schema:
 *           type: integer
 *         required: true
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [result]
 *             properties:
 *               result:
 *                 type: string
 *                 enum: [Passed, Failed, Retraining]
 *     responses:
 *       200:
 *         description: Success
 */
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

/**
 * @swagger
 * /api/admin/training-courses/{id}/trainees:
 *   post:
 *     tags: [HR → Training]
 *     summary: Add trainees to a course
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         schema:
 *           type: integer
 *         required: false
 *       - in: path
 *         name: id
 *         schema:
 *           type: integer
 *         required: true
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [applicationIds]
 *             properties:
 *               applicationIds:
 *                 type: array
 *                 items:
 *                   type: integer
 *     responses:
 *       200:
 *         description: Success
 */
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
