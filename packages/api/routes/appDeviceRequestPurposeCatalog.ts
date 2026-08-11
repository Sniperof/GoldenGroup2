import { Router } from 'express';
import pool from '../db.js';

const router = Router();

router.get('/', async (_req, res) => {
  const { rows } = await pool.query<{
    id: number;
    value: string;
    metadata: Record<string, unknown> | null;
  }>(
    `SELECT id, value, metadata
       FROM system_lists
      WHERE category = 'device_request_purpose'
        AND is_active = TRUE
      ORDER BY display_order, id`,
  );
  return res.json({
    items: rows.map((row) => ({
      id: Number(row.id),
      code: String(row.metadata?.code ?? row.value),
      label: row.value,
    })),
  });
});

export default router;
