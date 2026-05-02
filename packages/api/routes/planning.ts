import { Router } from 'express';
import { requirePermission } from '../middleware/permission.js';
import { getPlanningMarketingTargets } from '../services/planningMarketingTargets.js';

const router = Router();

router.get('/marketing-targets', requirePermission('planning.manage'), async (req, res) => {
  try {
    const date = typeof req.query.date === 'string' ? req.query.date : '';
    const teamKey = typeof req.query.teamKey === 'string' ? req.query.teamKey : '';
    const branchId = req.authContext?.actingBranchId ?? null;

    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
    }

    if (!/^(team|solo)_\d+$/.test(teamKey)) {
      return res.status(400).json({ error: 'teamKey must be team_X or solo_X' });
    }

    if (branchId == null) {
      return res.status(400).json({ error: 'A branch context is required' });
    }

    return res.json(await getPlanningMarketingTargets({ date, teamKey, branchId }));
  } catch (err: any) {
    console.error('Failed to calculate planning marketing targets:', err);
    return res.status(500).json({ error: err.message || 'Failed to calculate marketing targets' });
  }
});

export default router;
