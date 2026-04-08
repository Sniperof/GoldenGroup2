import { Router } from 'express';
import { createPublicApplication } from '../services/applicationService.js';

const router = Router();

// POST /api/public/applications
router.post('/', async (req, res) => {
  try {
    const result = await createPublicApplication(req.body);
    res.status(201).json(result);
  } catch (err: any) {
    if (err?.status) {
      return res.status(err.status).json(err.payload ?? { error: err.message });
    }
    console.error('Error submitting application:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
