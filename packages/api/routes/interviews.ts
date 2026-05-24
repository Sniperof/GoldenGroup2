import { Router } from 'express';
import { requirePermission } from '../middleware/permission.js';
import {
  getEligibleInterviews,
  getInterviewById,
  getInterviewersForApplication,
  getInterviews,
  recordInterviewOutcome,
  scheduleInterviewForApplication,
  updateScheduledInterview,
} from '../services/interviewService.js';

const router = Router();

/**
 * @swagger
 * /api/admin/interviews/eligible/{jobVacancyId}:
 *   get:
 *     tags: [HR → Interviews]
 *     summary: Retrieve job applications eligible for interview
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
router.get('/eligible/:jobVacancyId', requirePermission('jobs.interviews.view_eligible'), async (req, res) => {
  try {
    const jobVacancyId = Array.isArray(req.params.jobVacancyId) ? req.params.jobVacancyId[0] : req.params.jobVacancyId;
    const rows = await getEligibleInterviews(jobVacancyId, req.authContext!);
    res.json(rows);
  } catch (err: any) {
    console.error('Error fetching eligible for interview:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/admin/interviews/interviewers:
 *   get:
 *     tags: [HR → Interviews]
 *     summary: Get eligible interviewers for an application
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         schema:
 *           type: integer
 *         required: false
 *       - in: query
 *         name: applicationId
 *         schema:
 *           type: integer
 *         required: true
 *       - in: query
 *         name: currentInterviewerUserId
 *         schema:
 *           type: integer
 *         required: false
 *     responses:
 *       200:
 *         description: Success
 */
router.get(
  '/interviewers',
  requirePermission('jobs.interviews.schedule', 'jobs.interviews.edit'),
  async (req, res) => {
    try {
      const applicationId = Array.isArray(req.query.applicationId)
        ? req.query.applicationId[0]
        : req.query.applicationId;
      const currentInterviewerUserId = Array.isArray(req.query.currentInterviewerUserId)
        ? req.query.currentInterviewerUserId[0]
        : req.query.currentInterviewerUserId;

      if (!applicationId) {
        return res.status(400).json({ error: 'معرّف طلب التوظيف مطلوب' });
      }

      const rows = await getInterviewersForApplication(
        String(applicationId),
        req.authContext!,
        currentInterviewerUserId != null ? Number.parseInt(String(currentInterviewerUserId), 10) : null,
      );
      res.json(rows);
    } catch (err: any) {
      if (err?.status) {
        return res.status(err.status).json(err.payload ?? { error: err.message });
      }
      console.error('Error fetching interviewers:', err);
      res.status(500).json({ error: err.message });
    }
  },
);

/**
 * @swagger
 * /api/admin/interviews:
 *   get:
 *     tags: [HR → Interviews]
 *     summary: List interviews
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         schema:
 *           type: integer
 *         required: false
 *       - in: query
 *         name: applicationId
 *         schema:
 *           type: integer
 *         required: false
 *       - in: query
 *         name: interviewerName
 *         schema:
 *           type: string
 *         required: false
 *       - in: query
 *         name: date
 *         schema:
 *           type: string
 *         required: false
 *       - in: query
 *         name: jobVacancyId
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
router.get('/', requirePermission('jobs.interviews.view_list'), async (req, res) => {
  try {
    const requestedBranchIdHeader = Array.isArray(req.headers['x-branch-id'])
      ? req.headers['x-branch-id'][0]
      : req.headers['x-branch-id'];
    const requestedBranchId = requestedBranchIdHeader != null && requestedBranchIdHeader !== ''
      ? Number.parseInt(String(requestedBranchIdHeader), 10)
      : null;
    const rows = await getInterviews(req.query, req.authContext!, requestedBranchId);
    res.json(rows);
  } catch (err: any) {
    if (err?.status) {
      return res.status(err.status).json(err.payload ?? { error: err.message });
    }
    console.error('Error fetching interviews:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/admin/interviews:
 *   post:
 *     tags: [HR → Interviews]
 *     summary: Schedule an interview for an application
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
 *             required: [applicationId, interviewType, interviewDate, interviewTime, interviewerName]
 *             properties:
 *               applicationId:
 *                 type: string
 *               interviewType:
 *                 type: string
 *               interviewDate:
 *                 type: string
 *               interviewTime:
 *                 type: string
 *               interviewerName:
 *                 type: string
 *               internalNotes:
 *                 type: string
 *     responses:
 *       201:
 *         description: Created
 */
router.post('/', requirePermission('jobs.interviews.schedule'), async (req, res) => {
  try {
    const row = await scheduleInterviewForApplication(req.body, {
      ...req.user!,
      authContext: req.authContext!,
    });
    res.status(201).json(row);
  } catch (err: any) {
    if (err?.status) {
      return res.status(err.status).json(err.payload ?? { error: err.message });
    }
    console.error('Error scheduling interview:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/admin/interviews/{id}:
 *   get:
 *     tags: [HR → Interviews]
 *     summary: Get an interview by ID
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
router.get('/:id', requirePermission('jobs.interviews.view_detail'), async (req, res) => {
  try {
    const interviewId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const row = await getInterviewById(interviewId, req.authContext!);
    res.json(row);
  } catch (err: any) {
    if (err?.status) {
      return res.status(err.status).json(err.payload ?? { error: err.message });
    }
    console.error('Error fetching interview:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/admin/interviews/{id}:
 *   put:
 *     tags: [HR → Interviews]
 *     summary: Edit a scheduled interview
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
 *             properties:
 *               interviewType:
 *                 type: string
 *               interviewDate:
 *                 type: string
 *               interviewTime:
 *                 type: string
 *               interviewerName:
 *                 type: string
 *               internalNotes:
 *                 type: string
 *     responses:
 *       200:
 *         description: Success
 */
router.put('/:id', requirePermission('jobs.interviews.edit'), async (req, res) => {
  try {
    const interviewId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const row = await updateScheduledInterview(interviewId, req.body, {
      ...req.user!,
      authContext: req.authContext!,
    });
    res.json(row);
  } catch (err: any) {
    if (err?.status) {
      return res.status(err.status).json(err.payload ?? { error: err.message });
    }
    console.error('Error updating interview:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/admin/interviews/{id}/result:
 *   patch:
 *     tags: [HR → Interviews]
 *     summary: Update interview result
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
 *             required: [interviewStatus]
 *             properties:
 *               interviewStatus:
 *                 type: string
 *                 enum: [Interview Completed, Interview Failed]
 *               internalNotes:
 *                 type: string
 *     responses:
 *       200:
 *         description: Success
 */
router.patch('/:id/result', requirePermission('jobs.interviews.record_result'), async (req, res) => {
  try {
    const interviewId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const row = await recordInterviewOutcome(interviewId, req.body, {
      ...req.user!,
      authContext: req.authContext!,
    });
    res.json(row);
  } catch (err: any) {
    if (err?.status) {
      return res.status(err.status).json(err.payload ?? { error: err.message });
    }
    console.error('Error updating interview:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
