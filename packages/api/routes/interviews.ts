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

// GET /api/admin/interviews/eligible/:jobVacancyId
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

// GET /api/admin/interviews?applicationId=&interviewerName=&date=&jobVacancyId=
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

// POST /api/admin/interviews â€” schedule an interview
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

// GET /api/admin/interviews/:id
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

// PUT /api/admin/interviews/:id â€” edit a scheduled interview
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

// PATCH /api/admin/interviews/:id/result â€” update interview result
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
