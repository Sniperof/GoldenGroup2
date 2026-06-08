import { Router } from 'express';
import pool from '../db.js';

const router = Router();

/**
 * @swagger
 * /api/public/vacancies:
 *   get:
 *     tags: [Public → Vacancies]
 *     summary: List open vacancies for public users
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         schema:
 *           type: integer
 *         required: false
 *         description: Branch context ID
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
router.get('/', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT
        id, title, branch,
        governorate, city_or_area AS "cityOrArea", sub_area AS "subArea",
        neighborhood, detailed_address AS "detailedAddress",
        work_type AS "workType", required_gender AS "requiredGender",
        required_age_min AS "requiredAgeMin", required_age_max AS "requiredAgeMax",
        email,
        required_certificate AS "requiredCertificate",
        required_major AS "requiredMajor",
        required_experience_years AS "requiredExperienceYears",
        required_skills AS "requiredSkills", responsibilities,
        driving_license_required AS "drivingLicenseRequired",
        has_car_required AS "hasCarRequired",
        vacancy_count AS "vacancyCount",
        start_date AS "startDate", end_date AS "endDate", status
      FROM job_vacancies
      WHERE status = 'Open'
      ORDER BY created_at DESC`
    );
    res.json(rows);
  } catch (err: any) {
    console.error('Error fetching public vacancies:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/public/vacancies/{id}:
 *   get:
 *     tags: [Public → Vacancies]
 *     summary: Get a single open public vacancy by ID
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
router.get('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT
        id, title, branch,
        governorate, city_or_area AS "cityOrArea", sub_area AS "subArea",
        neighborhood, detailed_address AS "detailedAddress",
        work_type AS "workType", required_gender AS "requiredGender",
        required_age_min AS "requiredAgeMin", required_age_max AS "requiredAgeMax",
        email,
        required_certificate AS "requiredCertificate",
        required_major AS "requiredMajor",
        required_experience_years AS "requiredExperienceYears",
        required_skills AS "requiredSkills", responsibilities,
        driving_license_required AS "drivingLicenseRequired",
        has_car_required AS "hasCarRequired",
        vacancy_count AS "vacancyCount",
        start_date AS "startDate", end_date AS "endDate", status
      FROM job_vacancies
      WHERE id = $1 AND status = 'Open' AND CURRENT_DATE BETWEEN start_date AND end_date`,
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'الوظيفة غير متاحة' });
    res.json(rows[0]);
  } catch (err: any) {
    console.error('Error fetching public vacancy:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
