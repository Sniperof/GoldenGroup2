import { Router } from 'express';
import pool from '../db.js';

const router = Router();

router.get('/:date', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM day_schedules WHERE date = $1', [req.params.date]);
  if (rows.length > 0) {
    res.json(rows[0]);
  } else {
    res.json({ date: req.params.date, teams: [], solos: [] });
  }
});

router.put('/:date', async (req, res) => {
  const { teams, solos } = req.body;
  const { rows } = await pool.query(
    `INSERT INTO day_schedules (date, teams, solos) VALUES ($1, $2, $3)
    ON CONFLICT (date) DO UPDATE SET teams=$2, solos=$3 RETURNING *`,
    [req.params.date, JSON.stringify(teams || []), JSON.stringify(solos || [])]
  );
  res.json(rows[0]);
});

export default router;
