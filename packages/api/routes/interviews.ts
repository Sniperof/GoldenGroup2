import { Router } from 'express';
import { requirePermission } from '../middleware/permission.js';
import {
  getEligibleInterviews,
  getInterviewById,
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
    const rows = await getEligibleInterviews(jobVacancyId);
    res.json(rows);
  } catch (err: any) {
    console.error('Error fetching eligible for interview:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/interviews?applicationId=&interviewerName=&date=&jobVacancyId=&page=&limit=
router.get('/', requirePermission('jobs.interviews.view_list'), async (req, res) => {
  try {
    const q = req.query as Record<string, any>;
    const filters: Record<string, any> = {
      applicationId: q.applicationId,
      interviewerName: q.interviewerName,
      date: q.date,
      jobVacancyId: q.jobVacancyId,
    };
    if (q.page !== undefined || q.limit !== undefined) {
      filters.page = Math.max(1, parseInt(q.page as string) || 1);
      filters.limit = Math.min(200, Math.max(1, parseInt(q.limit as string) || 25));
    }
    const result = await getInterviews(filters);
    res.json(result);
  } catch (err: any) {
    console.error('Error fetching interviews:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/interviews â€” schedule an interview
router.post('/', requirePermission('jobs.interviews.schedule'), async (req, res) => {
  try {
    const row = await scheduleInterviewForApplication(req.body, req.user!);
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
    const row = await getInterviewById(interviewId);
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
    const row = await updateScheduledInterview(interviewId, req.body, req.user!);
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
    const row = await recordInterviewOutcome(interviewId, req.body, req.user!);
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
