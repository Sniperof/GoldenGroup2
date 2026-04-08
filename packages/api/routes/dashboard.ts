import { Router } from 'express';
import pool from '../db.js';

const router = Router();

router.get('/', async (_req, res) => {
  const [clientsRes, employeesRes, routesRes, geoRes, recentClientsRes] = await Promise.all([
    pool.query('SELECT COUNT(*) FROM clients'),
    pool.query("SELECT COUNT(*) FROM employees WHERE status = 'active'"),
    pool.query('SELECT COUNT(*) FROM routes'),
    pool.query("SELECT COUNT(*) FROM geo_units WHERE level = 4"),
    pool.query(`
      SELECT id, name, mobile, created_at AS "createdAt"
      FROM clients ORDER BY created_at DESC LIMIT 10
    `),
  ]);

  res.json({
    totalClients: parseInt(clientsRes.rows[0].count),
    activeEmployees: parseInt(employeesRes.rows[0].count),
    totalRoutes: parseInt(routesRes.rows[0].count),
    coveredNeighborhoods: parseInt(geoRes.rows[0].count),
    recentClients: recentClientsRes.rows,
  });
});

export default router;
