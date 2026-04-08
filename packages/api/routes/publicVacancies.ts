import { Router } from 'express';
import pool from '../db.js';

const router = Router();

// GET /api/public/vacancies — only open vacancies with all fields
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

// GET /api/public/vacancies/:id — single open vacancy within its active date range
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
